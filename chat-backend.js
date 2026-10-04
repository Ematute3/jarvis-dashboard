/* ============================================================
   MASTER DASHBOARD · CHAT BACKEND (REFERENCE)
   File: chat-backend.js
   Reference implementation for POST /api/chat. The real JARVIS backend
   should `import { handleChat, callMinimax, executeToolCall,
   TOOL_DEFINITIONS }` from this file and wire `handleChat` into its
   Express (or equivalent) router as `app.post('/api/chat', handleChat)`.

   Tools route to the same JARVIS endpoints the dashboard already uses
   (see docs/DATA-FLOW.md). Only Node 18+ built-ins (fetch) are used —
   no new dependencies. No API keys are hardcoded; everything comes
   from process.env.

   Caveats for the production backend team:
     - Set JARVIS_CALENDAR_NEW_URL to the endpoint your calendar
       service exposes for creating a new event (e.g. POST
       /api/calendar/events/new). Leaving it blank yields a structured
       "not implemented" error to the LLM, not a crash.
     - Implement POST /api/gmail/messages/:id/read and set
       JARVIS_GMAIL_MARK_READ_URL to /api/gmail/messages. Leaving it
       blank yields the same structured error.
   ============================================================ */

// --- Config (env-driven) -------------------------------------------------
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || ''; // never hardcode
const MINIMAX_BASE    = process.env.MINIMAX_BASE_URL || 'https://api.MiniMax.com/v1';
const MINIMAX_MODEL   = process.env.MINIMAX_MODEL   || 'MiniMax-M2';

// Base URL for the JARVIS backend that this chat handler will call.
// In dev, default to the local mock server so the same handlers work
// end-to-end without standing up the real backend.
const JARVIS_API_BASE = process.env.JARVIS_API_BASE || 'http://localhost:8765';

// TODO(prod-backend): point at the real "create calendar event" route.
const JARVIS_CALENDAR_NEW_URL = process.env.JARVIS_CALENDAR_NEW_URL || '';

// TODO(prod-backend): implement POST /api/gmail/messages/:id/read, then
// set this to /api/gmail/messages and the handler will append
// "/<id>/read" automatically.
const JARVIS_GMAIL_MARK_READ_URL = process.env.JARVIS_GMAIL_MARK_READ_URL || '';

// Cap the tool-call loop so a runaway LLM can't burn the request budget.
// One iteration = one round-trip to the LLM (which may itself contain
// several tool_calls that we all execute and append before re-calling).
const MAX_TOOL_ITERATIONS = 5;

// --- System prompt --------------------------------------------------------
const SYSTEM_PROMPT = `You are JARVIS, the user's personal dashboard assistant.
You have read access to Canvas (the user's courses and assignments),
Gmail (recent inbox messages), and Google Calendar (events), plus the
user's saved weekly class schedule. You can also write to Google
Calendar on the user's request.

Answer questions about courses, upcoming assignments, the user's
schedule, and recent emails. When the user asks you to add a calendar
event, ask for the date and time if it wasn't already specified, then
call add_event.

Always confirm with the user before performing any destructive action —
deleting or modifying an existing calendar event. For a brand-new event
on a clearly stated day you may proceed, but if anything is ambiguous,
ask first.

Keep replies concise — one to three sentences for most answers. Never
invent data: if a question is about the user's courses, assignments,
emails, or schedule and you cannot find it with the available tools,
say exactly "I don't see anything in your courses about that." (or
the matching phrase for emails, schedule, or calendar).`;

// --- Tool definitions (OpenAI-compatible JSON Schema) ---------------------
const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'add_event',
      description:
        "Create a new Google Calendar event. Requires the date and time; " +
        "ask the user if anything is missing. Only call once the user has " +
        "confirmed the details.",
      parameters: {
        type: 'object',
        properties: {
          title:    { type: 'string', description: 'Short event title.' },
          date:     { type: 'string', description: 'Date in YYYY-MM-DD.' },
          start:    { type: 'string', description: 'Start time in HH:MM (24h).' },
          end:      { type: 'string', description: 'End time in HH:MM (24h).' },
          location: { type: 'string', description: 'Optional location.' },
          notes:    { type: 'string', description: 'Optional notes.' },
        },
        required: ['title', 'date', 'start', 'end'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_courses',
      description: "List every course the user is enrolled in (Canvas + manual).",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_assignments',
      description:
        "List upcoming assignments. Pass a course_id to scope to one Canvas " +
        "course; omit to list across every Canvas course the user is in.",
      parameters: {
        type: 'object',
        properties: {
          course_id: { type: 'string', description: 'Optional Canvas course id.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_events',
      description:
        "List the user's Google Calendar events (server returns the next " +
        "window of upcoming events).",
      parameters: {
        type: 'object',
        properties: {
          days_ahead: {
            type: 'number',
            description: 'How many days ahead to look (informational; the server controls the actual window).',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_emails',
      description:
        "Search the user's recent inbox. The backend's Gmail endpoint has " +
        "no query parameter, so we fetch the last N messages and filter by " +
        "from/subject/body substring client-side.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Substring to match against from/subject/body.' },
          limit: { type: 'number', description: 'How many recent messages to scan (default 25).' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mark_email_read',
      description:
        "Mark a Gmail message as read. Requires the production backend to " +
        "expose POST /api/gmail/messages/:id/read — set " +
        "JARVIS_GMAIL_MARK_READ_URL to enable.",
      parameters: {
        type: 'object',
        properties: {
          message_id: { type: 'string', description: 'The Gmail message id to mark read.' },
        },
        required: ['message_id'],
        additionalProperties: false,
      },
    },
  },
];

// --- Helpers --------------------------------------------------------------

// Validate add_event args. Returns { ok: true, value } or { ok: false, error }.
function validateAddEvent(args) {
  if (!args || typeof args !== 'object') return { ok: false, error: 'No args.' };
  const { title, date, start, end } = args;
  if (typeof title !== 'string' || !title.trim()) {
    return { ok: false, error: 'title is required.' };
  }
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: 'date must be a string in YYYY-MM-DD.' };
  }
  if (typeof start !== 'string' || !/^\d{2}:\d{2}$/.test(start)) {
    return { ok: false, error: 'start must be a string in HH:MM.' };
  }
  if (typeof end !== 'string' || !/^\d{2}:\d{2}$/.test(end)) {
    return { ok: false, error: 'end must be a string in HH:MM.' };
  }
  const out = { title: title.trim(), date, start, end };
  if (typeof args.location === 'string' && args.location.trim()) out.location = args.location.trim();
  if (typeof args.notes === 'string' && args.notes.trim()) out.notes = args.notes.trim();
  return { ok: true, value: out };
}

// Call the MiniMax chat-completions endpoint. Returns the assistant message
// (with optional tool_calls) on success; { ok: false, error } on failure.
export async function callMinimax(messages, tools) {
  if (!MINIMAX_API_KEY) {
    return { ok: false, error: 'MINIMAX_API_KEY is not configured.' };
  }
  let r;
  try {
    r = await fetch(`${MINIMAX_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINIMAX_API_KEY}`,
      },
      body: JSON.stringify({
        model: MINIMAX_MODEL,
        messages,
        tools,
      }),
    });
  } catch (err) {
    return { ok: false, error: `LLM network error: ${err && err.message || err}` };
  }
  if (!r.ok) {
    let detail = '';
    try { detail = await r.text(); } catch (_) { detail = ''; }
    return { ok: false, error: `LLM HTTP ${r.status}: ${detail.slice(0, 200)}` };
  }
  let data;
  try { data = await r.json(); }
  catch (_) { return { ok: false, error: 'LLM returned non-JSON.' }; }
  const msg = data && data.choices && data.choices[0] && data.choices[0].message;
  return msg || { ok: false, error: 'LLM returned no choices.' };
}

// Dispatch a single tool call to the right JARVIS endpoint. NEVER throws —
// every error path returns { ok: false, error } so the LLM can see it and
// respond gracefully instead of the whole request crashing.
export async function executeToolCall(name, args) {
  try {
    switch (name) {
      case 'add_event': {
        const v = validateAddEvent(args);
        if (!v.ok) return v;
        if (!JARVIS_CALENDAR_NEW_URL) {
          return {
            ok: false,
            error: 'JARVIS_CALENDAR_NEW_URL is not configured. The production backend team needs to point this at the real "create calendar event" endpoint.',
          };
        }
        const r = await fetch(`${JARVIS_API_BASE}${JARVIS_CALENDAR_NEW_URL}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(v.value),
        });
        if (!r.ok) return { ok: false, error: `Calendar HTTP ${r.status}` };
        return await r.json();
      }

      case 'list_courses': {
        const r = await fetch(`${JARVIS_API_BASE}/api/courses/all`);
        if (!r.ok) return { ok: false, error: `Courses HTTP ${r.status}` };
        return await r.json();
      }

      case 'list_assignments': {
        if (typeof args.course_id === 'string' && args.course_id) {
          const r = await fetch(
            `${JARVIS_API_BASE}/api/canvas/courses/${encodeURIComponent(args.course_id)}/assignments`
          );
          if (!r.ok) return { ok: false, error: `Assignments HTTP ${r.status}` };
          return await r.json();
        }
        // No course_id: aggregate across every Canvas course.
        const coursesR = await fetch(`${JARVIS_API_BASE}/api/courses/all`);
        if (!coursesR.ok) return { ok: false, error: `Courses HTTP ${coursesR.status}` };
        const courses = await coursesR.json();
        const list = Array.isArray(courses) ? courses : [];
        const results = [];
        for (const c of list) {
          if (!c || c.source !== 'canvas' || !c.id) continue;
          try {
            const r = await fetch(
              `${JARVIS_API_BASE}/api/canvas/courses/${encodeURIComponent(c.id)}/assignments`
            );
            if (!r.ok) continue;
            const arr = await r.json();
            if (Array.isArray(arr)) results.push(...arr);
          } catch (_) { /* skip this course, keep going */ }
        }
        return results;
      }

      case 'list_events': {
        const r = await fetch(`${JARVIS_API_BASE}/api/calendar/events`);
        if (!r.ok) return { ok: false, error: `Calendar HTTP ${r.status}` };
        return await r.json();
      }

      case 'search_emails': {
        const query = typeof args.query === 'string' ? args.query : '';
        if (!query) return { ok: false, error: 'query is required.' };
        const limit = Number.isFinite(args.limit) && args.limit > 0 ? args.limit : 25;
        const r = await fetch(`${JARVIS_API_BASE}/api/gmail/messages?limit=${encodeURIComponent(limit)}`);
        if (!r.ok) return { ok: false, error: `Gmail HTTP ${r.status}` };
        const data = await r.json();
        const msgs = Array.isArray(data) ? data : (data.messages || []);
        const q = query.toLowerCase();
        const matches = msgs.filter((m) => {
          if (!m || typeof m !== 'object') return false;
          // Caveat — the dashboard's existing Gmail endpoint only ships
          // {from, subject, unread}; body is not part of the wire
          // contract, so substring matches against body will always be
          // false until the backend grows a richer payload. We include
          // body in the haystack so this just starts working the day
          // the backend ships it.
          const hay = `${m.from || ''} ${m.subject || ''} ${m.body || ''}`.toLowerCase();
          return hay.indexOf(q) !== -1;
        });
        return matches;
      }

      case 'mark_email_read': {
        if (typeof args.message_id !== 'string' || !args.message_id) {
          return { ok: false, error: 'message_id is required.' };
        }
        if (!JARVIS_GMAIL_MARK_READ_URL) {
          return {
            ok: false,
            error: 'JARVIS_GMAIL_MARK_READ_URL is not configured. The production backend team needs to add POST /api/gmail/messages/:id/read and set this env var.',
          };
        }
        const r = await fetch(
          `${JARVIS_API_BASE}${JARVIS_GMAIL_MARK_READ_URL}/${encodeURIComponent(args.message_id)}/read`,
          { method: 'POST' }
        );
        if (!r.ok) return { ok: false, error: `Gmail HTTP ${r.status}` };
        return await r.json();
      }

      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

// Express-style handler. The real backend will adapt this to its router.
export async function handleChat(req, res) {
  const body = req && req.body ? req.body : {};
  const userMessages = Array.isArray(body.messages) ? body.messages : null;
  if (!userMessages || userMessages.length === 0) {
    res.status(400).json({ ok: false, error: 'No messages provided.' });
    return;
  }

  // The system prompt goes in front of whatever the client sent.
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...userMessages];
  const allToolCalls = [];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const assistant = await callMinimax(messages, TOOL_DEFS);
    if (!assistant || assistant.ok === false) {
      res.status(502).json({
        ok: false,
        error: (assistant && assistant.error) || 'LLM did not return a response.',
        tool_calls: allToolCalls,
      });
      return;
    }

    // Append the assistant turn to the conversation.
    messages.push(assistant);

    const calls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
    if (calls.length === 0) {
      // Final assistant turn — no more tool calls.
      res.json({
        ok: true,
        reply: assistant.content || '',
        tool_calls: allToolCalls,
      });
      return;
    }

    // Execute every tool call the assistant asked for, then feed the
    // results back so the LLM can produce the final reply on the next
    // round-trip.
    for (const tc of calls) {
      const fn = tc.function || {};
      const name = fn.name;
      let parsedArgs = {};
      try { parsedArgs = JSON.parse(fn.arguments || '{}'); }
      catch (_) { parsedArgs = {}; }

      const result = await executeToolCall(name, parsedArgs);
      allToolCalls.push({ name, args: parsedArgs, result });

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }
  }

  // Hit the iteration cap. Surface what we have rather than hanging.
  res.json({
    ok: true,
    reply: "I got stuck in a loop trying to answer that — could you rephrase?",
    tool_calls: allToolCalls,
  });
}

// Re-exported for inspection / future testing.
export const TOOL_DEFINITIONS = TOOL_DEFS;
export const MAX_ITERATIONS  = MAX_TOOL_ITERATIONS;