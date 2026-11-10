#!/usr/bin/env node
// Screenshot helper: node tests/shot.mjs <preview.html> <outdir> [script.json]
// script.json: [{ "eval": "...js...", "shot": "name", "wait": ms }]
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const [file, outdir, stepsFile] = process.argv.slice(2);
mkdirSync(outdir, { recursive: true });
const steps = stepsFile ? JSON.parse(readFileSync(stepsFile, 'utf8')) : [{ shot: 'default' }];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dport = 9800 + Math.floor(Math.random() * 150);
const chrome = spawn(process.env.CHROME || '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=' + dport, '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'smyw-shot-')), 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch {} });
let target;
for (let i = 0; i < 60 && !target; i++) { await sleep(250); try { target = (await (await fetch('http://127.0.0.1:' + dport + '/json/list')).json()).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let seq = 0; const pending = new Map(); const errors = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); };
const send = (method, params) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params: params || {} })); });
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: Number(process.env.W || 1680), height: Number(process.env.H || 1000), deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'file://' + resolve(file) });
await sleep(1200);
for (const s of steps) {
  if (s.eval) { const r = await send('Runtime.evaluate', { expression: '(async () => { ' + s.eval + ' })()', awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) errors.push(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); else if (r.result.result.value !== undefined) console.log(s.shot || 'eval', JSON.stringify(r.result.result.value)); }
  await sleep(s.wait ?? 600);
  if (s.shot) { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(outdir, s.shot + '.png'), Buffer.from(r.result.data, 'base64')); }
}
console.log(errors.length ? 'ERRORS ' + JSON.stringify(errors) : 'no page errors');
process.exit(0);
