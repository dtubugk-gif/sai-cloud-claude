// SAI cloud Claude: Claude Code on a free Render web service, signed in with the user's own Claude subscription
// (CLAUDE_CODE_OAUTH_TOKEN, from `claude setup-token`, typed into Render by the user). SAI Cloud (the Cloudflare
// Worker) sends a chat here when the user's PC is off; the answer streams back as Claude Code's own stream-json
// lines, which the Sai GUI page already understands. Only SAI Cloud may call /chat: each call carries a one-time
// nonce that this server checks with SAI Cloud (so there's no shared secret to copy anywhere).
// Claude may only search and read the web here: no shell, no files (nothing on this server is the user's).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.PORT || 7860);
const CLOUD = (process.env.SAI_CLOUD_URL || 'https://sai-cloud.gravity-maze.workers.dev').replace(/\/$/, '');
const CLAUDE = process.env.CLAUDE_BIN || 'claude';
const MODELS = { nova: 'claude-sonnet-5-5', forge: 'claude-opus-5-5', titan: 'claude-fable-5-1', pulse: 'claude-haiku-4-5-20251001' };
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

// SAI Cloud made this nonce for this very request and forgets it once checked
async function allowed(req) {
  const nonce = String(req.headers['x-sai-nonce'] || ''), room = String(req.headers['x-sai-room'] || 'default');
  if (!/^[0-9a-f]{64}$/.test(nonce) || !/^[\w-]{1,64}$/.test(room)) return false;
  try {
    const r = await fetch(CLOUD + '/space/check?room=' + encodeURIComponent(room) + '&nonce=' + nonce, { headers: { 'user-agent': 'SAI cloud Claude' } });
    return r.status === 200;
  } catch (e) { return false; }
}

// The conversation so far goes in as one user message: earlier turns as a transcript, then the new message
// (with its photos). Claude Code starts fresh for each turn, so it always sees the whole chat.
function turn(messages) {
  const last = messages[messages.length - 1] || { role: 'user', content: '' };
  const textOf = c => typeof c === 'string' ? c : (c || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
  const earlier = messages.slice(0, -1).map(m => (m.role === 'user' ? 'User: ' : 'You (SAI): ') + textOf(m.content)).join('\n\n');
  const content = [];
  if (earlier) content.push({ type: 'text', text: '<conversation_so_far>\n' + earlier.slice(-150000) + '\n</conversation_so_far>\n\nThe user\'s new message:' });
  if (Array.isArray(last.content)) {
    for (const c of last.content) {
      if (c.type === 'image' && c.source && c.source.data) content.push({ type: 'image', source: { type: 'base64', media_type: c.source.media_type, data: c.source.data } });
      else if (c.type === 'text' && c.text) content.push({ type: 'text', text: c.text });
    }
  } else content.push({ type: 'text', text: String(last.content || '') });
  return { type: 'user', message: { role: 'user', content } };
}

function chat(req, res, body) {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY && !process.env.SAI_LOCAL_TEST) {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Cloud Claude is not signed in yet (no CLAUDE_CODE_OAUTH_TOKEN secret on the Space).' }));
    return;
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-'));
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--input-format', 'stream-json',
    '--model', MODELS[body.model] || MODELS.nova,
    '--tools', 'WebSearch,WebFetch', '--allowedTools', 'WebSearch,WebFetch', '--permission-mode', 'default',
    '--setting-sources', '', '--strict-mcp-config'];
  if (EFFORTS.has(body.effort)) args.push('--effort', body.effort);
  if (body.system) args.push('--append-system-prompt', String(body.system).slice(0, 30000));
  const child = spawn(CLAUDE, args, { cwd: work, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
  let err = '';
  child.stdout.on('data', d => res.write(d));
  child.stderr.on('data', d => { err += d; if (err.length > 4000) err = err.slice(-4000); });
  child.on('error', e => { err += String(e); });
  child.on('close', code => {
    if (code && err.trim()) res.write(JSON.stringify({ type: 'sai_error', message: err.trim().split('\n').slice(-3).join(' ') }) + '\n');
    res.end();
    fs.rm(work, { recursive: true, force: true }, () => { });
  });
  res.on('close', () => { if (child.exitCode === null) child.kill('SIGTERM'); });   // the phone pressed Stop
  child.stdin.write(JSON.stringify(turn(body.messages || [])) + '\n');
  child.stdin.end();
}

http.createServer((req, res) => {
  if (req.method === 'GET' && req.url.split('?')[0] === '/account') {
    // which kind of account the token signs in to (plan type only: no token, the email is masked)
    const c = spawn(CLAUDE, ['auth', 'status'], { env: process.env });
    let out = '';
    c.stdout.on('data', d => out += d);
    c.on('close', () => {
      let j = {};
      try { j = JSON.parse(out); } catch (e) { j = { raw: out.slice(0, 200) }; }
      const mask = s => s ? String(s).replace(/^(.{2}).*(@.*)$/, '$1***$2') : s;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ loggedIn: j.loggedIn, authMethod: j.authMethod, apiProvider: j.apiProvider, subscriptionType: j.subscriptionType, email: mask(j.email), orgName: mask(j.orgName), raw: j.raw }));
    });
    c.on('error', e => { res.writeHead(500); res.end(String(e)); });
    return;
  }
  if (req.method === 'GET') {   // health check (SAI Cloud pings this every 10 minutes so the free service doesn't sleep)
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('SAI cloud Claude is running.' + (process.env.CLAUDE_CODE_OAUTH_TOKEN ? '' : ' (not signed in yet)'));
    return;
  }
  if (req.method !== 'POST' || req.url.split('?')[0] !== '/chat') { res.writeHead(404); res.end(); return; }
  let raw = '';
  req.on('data', d => { raw += d; if (raw.length > 30e6) req.destroy(); });
  req.on('end', async () => {
    if (!(await allowed(req))) { res.writeHead(401); res.end('no'); return; }
    let body;
    try { body = JSON.parse(raw); } catch (e) { res.writeHead(400); res.end('bad json'); return; }
    chat(req, res, body);
  });
}).listen(PORT, () => console.log('SAI cloud Claude on ' + PORT));
