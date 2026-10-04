/* ============================================================
   MASTER DASHBOARD · CHATBOT WIDGET
   File: chatbot.js
   Floating chat panel anchored to a JARVIS button in the top bar.
   Talks to POST /api/chat, persists history in sessionStorage, and
   exposes window.JarvisChat for programmatic control + listening.
   ============================================================ */

(function () {
  'use strict';

  var STORAGE_KEY = 'jarvis-chat-history';
  var ENDPOINT = '/api/chat';
  var STATUS = { IDLE: 'idle', THINKING: 'thinking', ERROR: 'error' };

  // ---- DOM refs (populated in bind) ----
  var toggle = null;
  var panel = null;
  var headEl = null;
  var titleEl = null;
  var closeBtn = null;
  var clearBtn = null;
  var messagesEl = null;
  var formEl = null;
  var inputEl = null;
  var sendBtn = null;
  var statusEl = null;
  var emptyEl = null;

  // ---- State ----
  var messages = [];
  var status = STATUS.IDLE;
  var listeners = { 'chat:open': [], 'chat:close': [], 'chat:message': [] };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function splitThinking(text) {
    if (typeof text !== 'string') return { reply: '', thinking: '' };
    var re = /<think>([\s\S]*?)<\/think>/g;
    var thinking = [];
    var match;
    while ((match = re.exec(text)) !== null) thinking.push(match[1]);
    var reply = text.replace(re, '').trim();
    return { reply: reply, thinking: thinking.join('\n\n').trim() };
  }

  function loadHistory() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function (m) {
        return m && typeof m.content === 'string' &&
          (m.thinking === undefined || typeof m.thinking === 'string') &&
          (m.role === 'user' || m.role === 'assistant' || m.role === 'tool');
      });
    } catch (e) {
      return [];
    }
  }

  function saveHistory() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch (e) {
      /* private mode / quota — non-fatal */
    }
  }

  function emit(type, detail) {
    var list = listeners[type];
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      try { list[i](detail); } catch (err) { console.warn('[JarvisChat] listener error', err); }
    }
  }

  // ---- Rendering ----

  function makeBubble(msg) {
    var role = msg.role === 'user' ? 'user'
      : msg.role === 'tool' ? 'tool'
      : 'assistant';
    var bubble = document.createElement('div');
    bubble.className = 'chat-bubble chat-bubble--' + role;
    bubble.setAttribute('data-role', role);
    // textContent never injects HTML — safe for any user input.
    bubble.textContent = String(msg.content == null ? '' : msg.content);
    if (msg.role === 'assistant' && msg.thinking) {
      var details = document.createElement('details');
      details.className = 'chat-thinking';
      var summary = document.createElement('summary');
      summary.textContent = 'thinking';
      details.appendChild(summary);
      var pre = document.createElement('pre');
      pre.className = 'chat-thinking-body';
      pre.textContent = msg.thinking; // textContent — never innerHTML
      details.appendChild(pre);
      bubble.appendChild(details);
    }
    return bubble;
  }

  function renderAll() {
    if (!messagesEl) return;
    while (messagesEl.firstChild) {
      messagesEl.removeChild(messagesEl.firstChild);
    }
    if (messages.length === 0) {
      if (emptyEl) messagesEl.appendChild(emptyEl);
    } else {
      for (var i = 0; i < messages.length; i++) {
        messagesEl.appendChild(makeBubble(messages[i]));
      }
    }
    scrollToBottom();
  }

  function appendBubble(msg) {
    if (!messagesEl) return;
    if (messages.length === 1) {
      // First transition: empty → non-empty. Rebuild to swap empty state out.
      renderAll();
      return;
    }
    if (emptyEl && emptyEl.parentNode === messagesEl) {
      messagesEl.removeChild(emptyEl);
    }
    messagesEl.appendChild(makeBubble(msg));
    scrollToBottom();
  }

  function scrollToBottom() {
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ---- Status indicator ----

  function setStatus(state, text) {
    status = state;
    if (statusEl) {
      statusEl.setAttribute('data-state', state);
      var label = statusEl.children[1];
      if (label && text != null) label.textContent = String(text);
    }
  }

  // ---- Open / close ----

  function setOpen(open) {
    if (!panel || !toggle) return;
    if (open) {
      if (panel.classList.contains('open')) return;
      panel.hidden = false;
      requestAnimationFrame(function () {
        panel.classList.add('open');
      });
      toggle.setAttribute('aria-expanded', 'true');
      if (inputEl) setTimeout(function () { inputEl.focus(); }, 220);
      emit('chat:open', null);
    } else {
      if (!panel.classList.contains('open') && panel.hidden) return;
      panel.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      setTimeout(function () {
        if (!panel.classList.contains('open')) panel.hidden = true;
      }, 220);
      emit('chat:close', null);
    }
  }

  function open() { setOpen(true); }
  function close() { setOpen(false); }
  function togglePanel() {
    setOpen(!(!panel.hidden && panel.classList.contains('open')));
  }
  function isOpen() {
    return !panel.hidden && panel.classList.contains('open');
  }

  // ---- Clear ----

  function clear() {
    messages = [];
    saveHistory();
    renderAll();
    setStatus(STATUS.IDLE, 'ready');
  }

  // ---- Send ----

  function postChat(payload) {
    return fetch(ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: payload }),
    }).then(function (r) {
      // Read the body either way — on non-2xx the server sends { ok:false, error:'...' }
      // which is more useful than a bare 'HTTP 502'.
      return r.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { /* leave null */ }
        if (!r.ok) {
          var reason = (data && data.error) ? data.error : ('HTTP ' + r.status);
          throw new Error(reason);
        }
        return data;
      });
    });
  }

  function extractReply(data) {
    var content = '';
    var thinking = '';
    var toolCalls = [];
    if (!data || typeof data !== 'object') return { content: '', thinking: '', toolCalls: [] };
    if (typeof data.reply === 'string') {
      var split0 = splitThinking(data.reply);
      content = split0.reply;
      thinking = split0.thinking;
    } else if (typeof data.content === 'string') {
      var split1 = splitThinking(data.content);
      content = split1.reply;
      thinking = split1.thinking;
    } else if (data.message && typeof data.message.content === 'string') {
      var split2 = splitThinking(data.message.content);
      content = split2.reply;
      thinking = split2.thinking;
    } else if (Array.isArray(data.choices) && data.choices[0] && data.choices[0].message) {
      var split3 = splitThinking(String(data.choices[0].message.content || ''));
      content = split3.reply;
      thinking = split3.thinking;
    } else if (Array.isArray(data.content)) {
      var joined = data.content
        .filter(function (b) { return b && (b.type === 'text' || b.type == null); })
        .map(function (b) { return b.text || b.content || ''; })
        .filter(function (s) { return !!s; })
        .join('\n');
      var split4 = splitThinking(joined);
      content = split4.reply;
      thinking = split4.thinking;
    }
    if (Array.isArray(data.tool_calls)) {
      toolCalls = data.tool_calls;
    } else if (data.message && Array.isArray(data.message.tool_calls)) {
      toolCalls = data.message.tool_calls;
    }
    return { content: content, thinking: thinking, toolCalls: toolCalls };
  }

  function formatToolCall(tc) {
    if (!tc || typeof tc !== 'object') return 'tool call';
    var name = (tc.function && tc.function.name) || tc.name || 'tool';
    var args = tc.function ? tc.function.arguments : tc.arguments;
    var pretty;
    if (typeof args === 'string') {
      pretty = args;
    } else if (args && typeof args === 'object') {
      try { pretty = JSON.stringify(args); } catch (e) { pretty = String(args); }
    } else if (args == null) {
      pretty = '';
    } else {
      pretty = String(args);
    }
    return pretty ? (name + ' \u00b7 ' + pretty) : name;
  }

  function send(text) {
    var payload = (text == null ? '' : String(text)).trim();
    if (!payload) return Promise.reject(new Error('empty message'));

    open();

    var userMsg = { role: 'user', content: payload };
    messages.push(userMsg);
    appendBubble(userMsg);
    saveHistory();

    setStatus(STATUS.THINKING, 'thinking\u2026');
    if (inputEl) inputEl.disabled = true;
    if (sendBtn) sendBtn.disabled = true;

    // Send only user+assistant turns — keep the wire payload predictable.
    var snapshot = [];
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (m.role === 'user' || m.role === 'assistant') {
        snapshot.push({ role: m.role, content: m.content });
      }
    }

    function finish() {
      if (inputEl) { inputEl.disabled = false; inputEl.focus(); }
      if (sendBtn) sendBtn.disabled = false;
    }

    return postChat(snapshot)
      .then(function (data) {
        var reply = extractReply(data);
        for (var j = 0; j < reply.toolCalls.length; j++) {
          var tmsg = { role: 'tool', content: formatToolCall(reply.toolCalls[j]) };
          messages.push(tmsg);
          appendBubble(tmsg);
        }
        var assistantContent = reply.content || (reply.toolCalls.length ? '' : '(no response)');
        if (assistantContent) {
          var amsg = { role: 'assistant', content: assistantContent, thinking: reply.thinking || '' };
          messages.push(amsg);
          appendBubble(amsg);
        }
        saveHistory();
        setStatus(STATUS.IDLE, 'ready');
        emit('chat:message', { user: payload, assistant: assistantContent, toolCalls: reply.toolCalls });
        return { assistant: assistantContent, toolCalls: reply.toolCalls };
      })
      .catch(function (err) {
        console.warn('[JarvisChat] send failed', err);
        var reason = (err && err.message) ? err.message : 'network error';
        var fallback = 'Sorry \u2014 JARVIS is unreachable (' + reason + ').';
        var emsg = { role: 'assistant', content: fallback };
        messages.push(emsg);
        appendBubble(emsg);
        saveHistory();
        setStatus(STATUS.ERROR, 'error');
        throw err;
      })
      .then(finish, finish);
  }

  // ---- Public listener API ----

  function addEventListener(type, fn) {
    if (!listeners[type]) listeners[type] = [];
    listeners[type].push(fn);
  }

  function removeEventListener(type, fn) {
    var list = listeners[type];
    if (!list) return;
    var i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  // ---- Bind ----

  function bind() {
    toggle = document.getElementById('chatToggle');
    panel = document.getElementById('chatPanel');
    if (!toggle || !panel) return; // markup missing — bail silently

    headEl = document.getElementById('chatHead');
    titleEl = document.getElementById('chatTitle');
    closeBtn = document.getElementById('chatClose');
    clearBtn = document.getElementById('chatClear');
    messagesEl = document.getElementById('chatMessages');
    formEl = document.getElementById('chatForm');
    inputEl = document.getElementById('chatInput');
    sendBtn = document.getElementById('chatSend');
    statusEl = document.getElementById('chatStatus');

    if (messagesEl) {
      emptyEl = messagesEl.querySelector('.chat-empty');
    }

    messages = loadHistory();
    renderAll();
    setStatus(STATUS.IDLE, 'ready');

    toggle.addEventListener('click', function () { togglePanel(); });
    if (closeBtn) closeBtn.addEventListener('click', function () { close(); });
    if (clearBtn) clearBtn.addEventListener('click', function () { clear(); });

    if (formEl) {
      formEl.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!inputEl) return;
        var text = inputEl.value;
        inputEl.value = '';
        send(text).catch(function () { /* already surfaced in panel */ });
      });
    }

    document.addEventListener('click', function (e) {
      if (!panel || panel.hidden) return;
      if (panel.contains(e.target) || toggle.contains(e.target)) return;
      close();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panel && !panel.hidden) close();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  // ---- Public API ----
  window.JarvisChat = {
    open: open,
    close: close,
    toggle: togglePanel,
    isOpen: isOpen,
    send: send,
    clear: clear,
    addEventListener: addEventListener,
    removeEventListener: removeEventListener,
  };
})();