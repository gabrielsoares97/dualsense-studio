// DualSense Studio - servidor local (sem dependências).
// Serve a interface em http://localhost:5173 e guarda perfis em ./perfis.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 5173;
const ROOT = path.join(__dirname, 'app');
const PROFILES = path.join(__dirname, 'perfis');
const HELPER = path.join(__dirname, 'tools', 'input-helper.ps1');
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const ALLOWED_ORIGINS = new Set([...ALLOWED_HOSTS].map((h) => `http://${h}`));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
};

fs.mkdirSync(PROFILES, { recursive: true });

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) { reject(new Error('corpo grande demais')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Nome de perfil seguro para usar como arquivo.
function profileFile(name) {
  const clean = String(name).replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 60);
  if (!clean || clean.startsWith('.')) return null;
  return path.join(PROFILES, clean + '.json');
}

// --- Modo PC: processo auxiliar que gera mouse/teclado ---
// Só a página servida por este servidor recebe o token; outros sites não conseguem lê-lo.
let helper = null;
let helperReady = null;
let inputToken = null;

function startHelper() {
  if (helperReady) return helperReady;
  helperReady = new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HELPER], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => reject(new Error('o auxiliar demorou demais para iniciar')), 20000);
    child.stdout.on('data', (d) => {
      out += d;
      if (out.includes('pronto')) { clearTimeout(timer); helper = child; resolve(child); }
    });
    child.stderr.on('data', (d) => { err += d; });
    child.on('exit', (code) => {
      clearTimeout(timer);
      helper = null;
      helperReady = null;
      inputToken = null;
      reject(new Error(`o auxiliar encerrou (código ${code}) ${err.trim().slice(0, 300)}`));
    });
  });
  helperReady.catch(() => { helperReady = null; });
  return helperReady;
}

// Roda um script de tools/ que responde em JSON.
// audio-endpoints.ps1: volume do Windows do DualSense (os hápticos dependem dele).
// bluetooth.ps1: link Bluetooth ativo junto com o USB desliga o áudio do controle.
function runPs(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, 'tools', script), ...args], { windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('exit', (code) => {
      try { resolve(JSON.parse(out.trim() || '[]')); } catch { reject(new Error(err.trim() || `código ${code}`)); }
    });
  });
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/windows-audio' && req.method === 'GET') {
    try { return send(res, 200, await runPs('audio-endpoints.ps1', ['get'])); } catch (e) { return send(res, 500, { error: String(e.message || e) }); }
  }
  if (url.pathname === '/api/bluetooth' && req.method === 'GET') {
    try { return send(res, 200, await runPs('bluetooth.ps1', ['status'])); } catch (e) { return send(res, 500, { error: String(e.message || e) }); }
  }
  if (url.pathname === '/api/bluetooth/disconnect' && req.method === 'POST') {
    try {
      const { mac } = JSON.parse(await readBody(req));
      if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i.test(String(mac))) return send(res, 400, { error: 'MAC inválido' });
      return send(res, 200, await runPs('bluetooth.ps1', ['disconnect', mac]));
    } catch (e) {
      return send(res, 500, { error: String(e.message || e) });
    }
  }
  if (url.pathname === '/api/windows-audio' && req.method === 'POST') {
    try {
      const b = JSON.parse(await readBody(req));
      const flow = b.flow === 'capture' ? 'capture' : 'render';
      const vol = Number.isFinite(b.volume) ? Math.max(0, Math.min(100, Math.round(b.volume))) : -1;
      const mute = typeof b.mute === 'boolean' ? (b.mute ? 1 : 0) : -1;
      return send(res, 200, await runPs('audio-endpoints.ps1', ['set', flow, String(vol), String(mute)]));
    } catch (e) {
      return send(res, 500, { error: String(e.message || e) });
    }
  }
  if (url.pathname === '/api/input/start' && req.method === 'POST') {
    try {
      await startHelper();
      inputToken ||= crypto.randomBytes(24).toString('hex');
      return send(res, 200, { token: inputToken });
    } catch (e) {
      return send(res, 500, { error: String(e.message || e) });
    }
  }
  if (url.pathname === '/api/input' && req.method === 'POST') {
    if (!inputToken || req.headers['x-ds-token'] !== inputToken) return send(res, 401, { error: 'token inválido' });
    if (!helper) return send(res, 409, { error: 'auxiliar parado' });
    const body = await readBody(req);
    const lines = body.split('\n').filter((l) => /^(m -?\d+ -?\d+|md [lrm]|mu [lrm]|w -?\d+|hw -?\d+|kd \d+|ku \d+)$/.test(l.trim()));
    if (lines.length) helper.stdin.write(lines.join('\n') + '\n');
    res.writeHead(204);
    return res.end();
  }
  if (url.pathname === '/api/profiles' && req.method === 'GET') {
    const list = fs.readdirSync(PROFILES)
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ name: f.slice(0, -5), mtime: fs.statSync(path.join(PROFILES, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return send(res, 200, list);
  }
  const m = url.pathname.match(/^\/api\/profiles\/(.+)$/);
  if (m) {
    const file = profileFile(decodeURIComponent(m[1]));
    if (!file) return send(res, 400, { error: 'nome inválido' });
    if (req.method === 'GET') {
      if (!fs.existsSync(file)) return send(res, 404, { error: 'não encontrado' });
      return send(res, 200, fs.readFileSync(file, 'utf8'));
    }
    if (req.method === 'PUT') {
      const body = await readBody(req);
      JSON.parse(body); // valida
      fs.writeFileSync(file, body);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return send(res, 200, { ok: true });
    }
  }
  return send(res, 404, { error: 'rota desconhecida' });
}

const server = http.createServer(async (req, res) => {
  try {
    // Bloqueia DNS rebinding e requisições de outros sites.
    if (!ALLOWED_HOSTS.has(String(req.headers.host))) return send(res, 403, 'host não permitido', 'text/plain; charset=utf-8');
    const origin = req.headers.origin;
    if (req.method !== 'GET' && req.method !== 'HEAD' && (!origin || !ALLOWED_ORIGINS.has(origin))) {
      return send(res, 403, { error: 'origem não permitida' });
    }
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);

    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT)) return send(res, 403, 'proibido', 'text/plain');
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, 'não encontrado', 'text/plain; charset=utf-8');
      send(res, 200, data, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    });
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
});

// Abre o Chrome (ou o Edge) em modo aplicativo: janela própria, sem barra de endereço.
// WebHID e a escolha de saída de áudio só existem em navegadores baseados no Chromium.
function openBrowser() {
  const url = `http://localhost:${PORT}`;
  const env = process.env;
  const candidates = [
    path.join(env.ProgramFiles || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(env.ProgramFiles || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
  ];
  const browser = candidates.find((p) => p && fs.existsSync(p));
  if (browser) {
    spawn(browser, [`--app=${url}`, '--window-size=1480,940'], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    console.log('Chrome/Edge não encontrado. Use um navegador baseado no Chromium para o controle funcionar.');
  }
}
const shouldOpen = process.argv.includes('--abrir');

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`Porta ${PORT} já está em uso - o DualSense Studio já está rodando. Abrindo a janela...`);
    if (shouldOpen) openBrowser();
    setTimeout(() => process.exit(0), 500);
    return;
  }
  throw e;
});

const shutdown = () => { if (helper) helper.kill(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`DualSense Studio rodando em http://localhost:${PORT}`);
  console.log('Feche esta janela para encerrar.');
  if (shouldOpen) openBrowser();
});
