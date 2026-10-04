// config.js
// Hot-reload runtime config. Read on every request, written via the
// /api/config PUT endpoint. Persists to runtime-config.json with 0600.

const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'runtime-config.json');

const DEFAULTS = {
  minimaxApiKey:        '',
  minimaxBaseUrl:       'https://api.MiniMax.com/v1',
  minimaxModel:         'MiniMax-M2',
  googleClientId:       '',
  googleClientSecret:   '',
  googleRedirectUri:    'http://127.0.0.1:8765/oauth/callback',
  toolMaxIterations:    10,
};

function load() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

function save(patch) {
  const next = { ...load(), ...patch };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

function get(key)    { return load()[key]; }
function getAll()    { return load(); }
function mask(value) { return value ? value.slice(0, 4) + '…' + value.slice(-4) : ''; }

module.exports = { load, save, get, getAll, mask, CONFIG_PATH };