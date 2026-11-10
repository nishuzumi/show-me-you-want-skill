#!/usr/bin/env node
// Regenerates the README screenshots in docs/screenshots/ from the bundled examples.
// Usage: node tests/readme-shots.mjs   (needs Google Chrome; CHROME=/path/to/chrome to override)
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skill = join(root, 'skills', 'smyw');
const out = join(root, 'docs', 'screenshots');
mkdirSync(out, { recursive: true });
for (const ex of ['helpdesk-ai', 'task-tags']) execFileSync('node', [join(skill, 'scripts', 'build.mjs'), join(skill, 'examples', ex, 'spec.json')], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dport = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(process.env.CHROME || '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none', '--remote-debugging-port=' + dport, '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'smyw-shots-')), 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch {} });
let target;
for (let i = 0; i < 60 && !target; i++) { await sleep(250); try { target = (await (await fetch('http://127.0.0.1:' + dport + '/json/list')).json()).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let seq = 0; const pending = new Map(); const errors = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); };
const send = (method, params) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params: params || {} })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: '(async () => { ' + expr + ' })()', awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(expr.slice(0, 80) + ' → ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result.result.value; };
const shot = async (name) => { await sleep(500); const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, name + '.png'), Buffer.from(r.result.data, 'base64')); console.log('  ' + name + '.png'); };
const size = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
const HELPERS = 'window.__fit = (sels, pad, bottom) => { pad = pad || 40; bottom = bottom || 0; const w = document.getElementById("cv-world"), vp = document.getElementById("cv-vp"), k0 = smyw.ui.cam.k, wr = w.getBoundingClientRect(); let L = 1e9, T = 1e9, R = -1e9, B = -1e9; for (const s of sels) { const r = document.querySelector(s).getBoundingClientRect(); L = Math.min(L, (r.left - wr.left) / k0); T = Math.min(T, (r.top - wr.top) / k0); R = Math.max(R, (r.right - wr.left) / k0); B = Math.max(B, (r.bottom - wr.top) / k0); } const vr = vp.getBoundingClientRect(); const H = vr.height - bottom; const k = Math.min(1.25, (vr.width - 2 * pad) / (R - L), (H - 2 * pad) / (B - T)); smyw.ui.cam = { k: k, x: (vr.width - (R - L) * k) / 2 - L * k, y: (H - (B - T) * k) / 2 - T * k }; smyw.render(); };' +
  'window.__pd = (src, x, y, phase) => { const r = src.getBoundingClientRect(); const o = { bubbles: true, pointerId: 9, button: 0, buttons: 1, clientX: r.left + 6, clientY: r.top + 6 }; if (phase !== "up") { src.dispatchEvent(new PointerEvent("pointerdown", o)); for (let i = 1; i <= 8; i++) document.dispatchEvent(new PointerEvent("pointermove", Object.assign({}, o, { clientX: o.clientX + (x - o.clientX) * i / 8, clientY: o.clientY + (y - o.clientY) * i / 8 }))); } if (phase !== "down") document.dispatchEvent(new PointerEvent("pointerup", Object.assign({}, o, { clientX: x, clientY: y, buttons: 0 }))); };' +
  'window.__mid = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.right, r.top, r.left]; }; return 1;';
const open = async (ex) => {
  await send('Page.navigate', { url: 'file://' + join(skill, 'examples', ex, 'preview.html') }); await sleep(600);
  await ev('localStorage.clear(); return 1'); await send('Page.reload', {});
  for (let i = 0; i < 50; i++) { await sleep(200); try { if (await ev('return !!(window.smyw && smyw.ui.cam)')) break; } catch {} }
  await sleep(400); await ev(HELPERS);
};
await send('Runtime.enable'); await send('Page.enable');
await size(1440, 900);

console.log('helpdesk-ai');
await open('helpdesk-ai');
await shot('01-overview');
await ev('smyw.focusUnit("reply"); return 1'); await sleep(500);
await shot('02-change-detail');
await ev('smyw.focusUnit("ai-suggest"); return 1'); await sleep(500);
await ev('const b = document.querySelector("#inspector .dt-block"); if (b) b.scrollIntoView({ block: "end" }); return 1');
await shot('03-whole-module-added');
await ev('smyw.focusUnit("t-resolve"); return 1'); await sleep(500);
await ev('__fit(["#cv-world [data-id=t-header]", "#cv-world [data-id=reply]"], 30); return 1');
await shot('04-moved');
await ev('smyw.ui.sel = null; smyw.ui.unit = null; smyw.render(); __fit(["#cv-world [data-id=ai-suggest]", "#cv-world [data-id=reply]", ".cv-ov[data-ov=ai-drawer]", ".cv-ov[data-ov=quick-modal]"], 30); return 1');
await shot('05-trigger-links');
await ev('smyw.ui.showFn = true; smyw.ui.showComp = true; smyw.ui.fade = true; smyw.render(); __fit(["#cv-world [data-id=detail]"], 30); return 1');
await shot('06-toolbar-toggles');
await ev('smyw.ui.showFn = false; smyw.ui.showComp = false; smyw.ui.fade = false; smyw.setTab("flows"); return 1');
await shot('07-flows');
await ev('[...document.querySelectorAll(".page-link")].find(b => b.textContent.includes("在界面上定位")).click(); return 1'); await sleep(500);
await shot('08-flow-jump-to-canvas');
await ev('smyw.setTab("backend"); return 1');
await shot('09-backend');

console.log('edit mode');
await ev('smyw.ui.sel = null; smyw.ui.unit = null; smyw.setTab("canvas"); smyw.setMode("edit"); return 1'); await sleep(300);
await ev('__fit(["#cv-world [data-id=detail]"], 30, 90); return 1');
await shot('10-edit-mode');
await ev('__fit(["#cv-world [data-id=t-header]", "#cv-world [data-id=reply]"], 30, 90); return 1');
await ev('const [x, y, , , l] = __mid("#cv-world [data-id=reply-send][data-side=after]"); __pd(document.querySelector("#cv-world [data-id=t-assign]"), l + 3, y, "down"); return 1');
await shot('11-drag-component');
await ev('const [x, y, , , l] = __mid("#cv-world [data-id=reply-send][data-side=after]"); __pd(document.querySelector("#cv-world [data-id=t-assign]"), l + 3, y, "up"); return 1'); await sleep(300);
await ev('__fit(["#cv-world [data-id=t-header]", "#cv-world [data-id=reply]"], 30, 90); return 1');
await shot('12-after-drag');
await ev('smyw.undo(); smyw.focusUnit("ai-suggest"); return 1'); await sleep(500);
await ev('const b = [...document.querySelectorAll("#inspector button")].find(x => x.textContent === "转为弹窗"); b.scrollIntoView({ block: "center" }); return 1');
await shot('13-convert-options');
await ev('smyw.op.convert("inbox", "ai-suggest", "modal"); smyw.ui.sel = null; smyw.ui.unit = null; smyw.render(); __fit([".cv-frame", ".cv-ovcol"], 30); return 1');
await shot('14-converted-to-modal');

console.log('comments & feedback');
await ev('smyw.setMode("view"); smyw.op.comment({ kind: "node", page: "inbox", id: "t-status", side: "after" }, "文案", "建议", "状态文字太长，改成「待确认」就行"); smyw.focusUnit("t-status"); return 1'); await sleep(500);
await ev('const ta = document.querySelector("#inspector [data-f=c-text]"); ta.value = "AI 草拟的工单要不要在队列里单独排序？"; ta.scrollIntoView({ block: "center" }); return 1');
await shot('15-comment');
await ev('const s = smyw.state; s.global.tags.push("和现有页面不统一", "信息密度过高"); s.global.text = "右侧客户信息太挤，相似工单可以折叠"; s.answers["q-auto"] = "自动生成（推荐）"; smyw.op.comment({ kind: "node", page: "inbox", id: "ai-suggest", side: "after" }, "交互方式", "必须改", "AI 建议默认折叠，点一下再展开"); smyw.setTab("feedback"); return 1');
await shot('16-feedback');
await ev('const o = document.getElementById("smyw-out"); o.scrollIntoView({ block: "end" }); return 1');
await shot('17-copy-feedback');

console.log('task-tags (multi-page)');
await open('task-tags');
await ev('[...document.querySelectorAll(".cv-tools button")].find(b => b.textContent === "适应").click(); return 1'); await sleep(500);
await shot('18-multi-page');

console.log('narrow window');
await size(760, 900);
await open('helpdesk-ai');
await shot('19-narrow-window');
await ev('smyw.focusUnit("ai-suggest"); return 1'); await sleep(500);
await shot('20-narrow-window-detail');

console.log(errors.length ? 'PAGE ERRORS ' + JSON.stringify(errors) : 'no page errors');
process.exit(errors.length ? 1 : 0);
