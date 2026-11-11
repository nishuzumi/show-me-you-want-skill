#!/usr/bin/env node
// End-to-end check of the canvas UI: build the examples, drive them in headless Chrome via CDP,
// exercise units / detail / camera / edit / comment / export, rebuild from the pasted feedback,
// and run the page inside a DSH-style sandboxed iframe (opaque origin: no storage / clipboard / dialogs).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skill = join(root, 'skills', 'smyw');
const work = mkdtempSync(join(tmpdir(), 'smyw-e2e-'));
const shots = process.env.SHOTS || join(root, 'tests', 'screenshots');
const chromeBin = process.env.CHROME || '/usr/bin/google-chrome';
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? '  ✔ ' : '  ✖ ') + name + (detail !== undefined && !ok ? ' — ' + JSON.stringify(detail).slice(0, 500) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

cpSync(join(skill, 'examples', 'task-tags', 'spec.json'), join(work, 'spec.json'));
execFileSync('node', [join(skill, 'scripts', 'build.mjs'), join(work, 'spec.json')], { stdio: 'inherit' });
execFileSync('node', [join(skill, 'scripts', 'build.mjs'), join(skill, 'examples', 'helpdesk-ai', 'spec.json')], { stdio: 'ignore' });
execFileSync('mkdir', ['-p', shots]);

const dport = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(chromeBin, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=' + dport, '--user-data-dir=' + join(work, 'chrome'), 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill('SIGKILL'); } catch {} };
process.on('exit', cleanup);
let target;
for (let i = 0; i < 60 && !target; i++) { await sleep(250); try { target = (await (await fetch('http://127.0.0.1:' + dport + '/json/list')).json()).find((t) => t.type === 'page'); } catch {} }
if (!target) { console.error('chrome did not start'); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0; const pending = new Map(); const pageErrors = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  else if (d.method === 'Runtime.exceptionThrown') pageErrors.push(d.params.exceptionDetails.exception ? d.params.exceptionDetails.exception.description : d.params.exceptionDetails.text);
  else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') pageErrors.push(d.params.args.map((a) => a.value || a.description).join(' '));
};
const send = (method, params) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params: params || {} })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: '(async () => { ' + expr + ' })()', awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error('page eval failed: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result.result.value;
};
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shots, name + '.png'), Buffer.from(r.result.data, 'base64')); };
const open = async (file) => { await send('Page.navigate', { url: 'file://' + file }); for (let i = 0; i < 40; i++) { await sleep(150); try { if (await ev('return !!window.smyw && !!document.getElementById("cv-world")')) break; } catch {} } await sleep(300); };
const FIND = 'const find = (n, x) => n.id === x ? n : (n.children||[]).map(c => find(c, x)).find(Boolean); const P = smyw.state.spec.pages[0];';
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1000, deviceScaleFactor: 1, mobile: false });
await open(join(work, 'preview.html'));
await ev('localStorage.clear(); return true');

console.log('canvas overview');
check('runtime booted from file:// with storage', await ev('return smyw.storageOk === true && smyw.ui.tab === "canvas"'));
const ov = await ev('return { frames: document.querySelectorAll(".cv-frame").length, units: smyw.units.length, items: document.querySelectorAll(".cv-item").length, nums: document.querySelectorAll("#cv-world .u-num").length, cam: smyw.ui.cam }');
check('one frame per page, one numbered box per change unit, list matches', ov.frames === 3 && ov.units >= 5 && ov.items === ov.units && ov.nums === ov.units && ov.cam && ov.cam.k > 0 && ov.cam.k <= 1, ov);
check('whole added/removed modules: only the outer box is marked', await ev('return document.querySelectorAll("#cv-world .mk-added.mk-u .mk, #cv-world .mk-removed.mk-u .mk").length === 0'));
check('whole page added = green frame, removed = red frame', await ev('return !!document.querySelector(".cv-frame.mk-added[data-page=tag-admin]") && !!document.querySelector(".cv-frame.mk-removed[data-page=category-admin]")'));
const yel = await ev('const el = document.querySelector("#cv-world .mk-u.mk-modified"); return el ? getComputedStyle(el).outlineColor : null');
check('modified is drawn yellow', yel === 'rgb(226, 164, 0)', yel);
check('unchanged modules are real modules, not placeholders', await ev('return [...document.querySelectorAll("#cv-world .wf-comp")].some(e => e.textContent.includes("SideNav"))'));
await shot('01-canvas');

console.log('detail panel');
await ev('[...document.querySelectorAll(".cv-item")].find(b => b.textContent.includes("新建任务")).click(); return true');
await sleep(500);
const dt = await ev('return { unit: smyw.ui.unit, cmp: document.querySelectorAll("#inspector .dt-cmp .dt-render").length, diff: !!document.querySelector("#inspector .diff"), hl: !!document.querySelector("#cv-world .u-sel"), steps: [...document.querySelectorAll("#inspector .dt-list li")].length }');
check('clicking a change opens before/after detail with field diff and related steps', dt.unit === 'btn-new' && dt.cmp === 2 && dt.diff && dt.hl && dt.steps >= 1, dt);
await ev('smyw.focusUnit("task-form-card"); return true'); await sleep(500);
check('added unit: before side says it did not exist', await ev('return !!document.querySelector("#inspector .dt-void") && document.querySelectorAll("#inspector .dt-render").length === 1'));
await ev('const n = document.querySelector("#cv-world [data-id=f-save]"); n.click(); return true');
check('clicking inside a unit selects that unit and the element', await ev('return smyw.ui.unit === "task-form-card" && smyw.ui.sel.id === "f-save"'));
await shot('02-detail');

console.log('camera');
const k0 = await ev('return smyw.ui.cam.k');
await ev('const vp = document.getElementById("cv-vp"); const r = vp.getBoundingClientRect(); vp.dispatchEvent(new WheelEvent("wheel", { deltaY: -200, ctrlKey: true, clientX: r.left + 200, clientY: r.top + 200, bubbles: true, cancelable: true })); return true');
const k1 = await ev('return smyw.ui.cam.k');
check('ctrl+wheel zooms', k1 > k0, { k0, k1 });
const pan = await ev('const vp = document.getElementById("cv-vp"); const x0 = smyw.ui.cam.x; const r = vp.getBoundingClientRect(); const o = { bubbles: true, pointerId: 7, button: 0, clientX: r.left + 30, clientY: r.bottom - 60 }; const bg = document.elementFromPoint(o.clientX, o.clientY); bg.dispatchEvent(new PointerEvent("pointerdown", o)); vp.dispatchEvent(new PointerEvent("pointermove", Object.assign({}, o, { clientX: o.clientX + 120 }))); vp.dispatchEvent(new PointerEvent("pointerup", Object.assign({}, o, { clientX: o.clientX + 120 }))); return { dx: smyw.ui.cam.x - x0, bg: bg.className }');
check('dragging empty canvas pans', Math.abs(pan.dx - 120) < 1, pan);
await ev('[...document.querySelectorAll(".cv-tools button")].find(b => b.textContent === "适应").click(); return true'); await sleep(450);
check('fit button resets the camera', await ev('return smyw.ui.cam.k <= 1'));

console.log('flows link back to the canvas');
await ev('smyw.setTab("flows"); return true');
check('flow swimlanes render', await ev('return document.querySelectorAll(".lanes").length >= 3 && document.querySelectorAll(".step").length > 10'));
await ev('[...document.querySelectorAll(".page-link")].find(b => b.textContent.includes("在界面上定位")).click(); return true'); await sleep(500);
check('a flow step jumps to its element on the canvas', await ev('return smyw.ui.tab === "canvas" && !!smyw.ui.sel && !!document.querySelector("#cv-world .sel")'));
await shot('03-flows-jump');
await ev('smyw.setTab("backend"); return true');
check('backend modules render', await ev('return document.querySelectorAll(".mod").length >= 6 && !!document.querySelector(".frame [data-id=fld-tags].chg-added")'));
await ev('smyw.setTab("canvas"); return true');

console.log('edit on the canvas');
await ev('smyw.setMode("edit"); return true');
await ev('smyw.op.convert("task-list", "task-form-card", "modal"); return true');
const conv = await ev(FIND + 'const ov = P.overlays[P.overlays.length-1]; const main = find(P.root, "main"); const btn = find(P.root, ov.trigger); return { ovType: ov.type, ghost: !!find(P.root, "task-form-card"), btnChange: btn && btn.change, btnIndex: main.children.indexOf(btn), inner: ov.children.map(c => c.type), drawn: !!document.querySelector(".cv-ov .t-modal") }');
check('proposed inline card → modal opened by a new button at the same spot', conv.ovType === 'modal' && !conv.ghost && conv.btnChange === 'added' && conv.btnIndex === 1 && conv.inner.join() === 'input,select,row' && conv.drawn, conv);
await ev('smyw.op.convert("task-list", "toolbar", "menu"); return true');
const conv2 = await ev(FIND + 'const g = find(P.root, "toolbar"); const ov = P.overlays[P.overlays.length-1]; return { ghost: g.change, movedTo: g.movedTo, from: ov.movedFrom || (ov.children[0] && ov.children[0].movedFrom) }');
check('converting an EXISTING element leaves a red "移出" ghost', conv2.ghost === 'removed' && conv2.from === 'toolbar' && !!conv2.movedTo, conv2);
await ev('smyw.undo(); return true');
const dnd = await ev([
  'const pdrag = (src, x, y) => { const r = src.getBoundingClientRect(); const o = { bubbles: true, pointerId: 3, button: 0, buttons: 1, clientX: r.left + 4, clientY: r.top + 4 }; src.dispatchEvent(new PointerEvent("pointerdown", o)); for (let i = 1; i <= 5; i++) document.dispatchEvent(new PointerEvent("pointermove", Object.assign({}, o, { clientX: o.clientX + (x - o.clientX) * i / 5, clientY: o.clientY + (y - o.clientY) * i / 5 }))); const ind = document.querySelector(".drop-before, .drop-after, .drop-inside"); const cls = ind ? ind.className : ""; document.dispatchEvent(new PointerEvent("pointerup", Object.assign({}, o, { clientX: x, clientY: y, buttons: 0 }))); return cls; };',
  'const id = smyw.state.ops[smyw.state.ops.length-1].trigger;',
  'const src = document.querySelector("#cv-world [data-id=" + id + "][data-side=after]");',
  'const dst = document.querySelector("#cv-world [data-id=btn-new][data-side=after]");',
  'if (!src || !dst) return { err: "missing", src: !!src, dst: !!dst };',
  'const r = dst.getBoundingClientRect(); const indicator = pdrag(src, r.right - 2, r.top + r.height / 2);',
  FIND, 'const ids = find(P.root, "toolbar").children.map(c => c.id);',
  'return { indicator, ids, id, after: ids.indexOf(id) === ids.indexOf("btn-new") + 1 };'
].join('\n'));
check('dragging on the canvas moves the button into the toolbar', dnd.after && /drop-after/.test(dnd.indicator), dnd);
const pal = await ev([
  'const pdrag = (src, x, y) => { const r = src.getBoundingClientRect(); const o = { bubbles: true, pointerId: 3, button: 0, buttons: 1, clientX: r.left + 4, clientY: r.top + 4 }; src.dispatchEvent(new PointerEvent("pointerdown", o)); for (let i = 1; i <= 5; i++) document.dispatchEvent(new PointerEvent("pointermove", Object.assign({}, o, { clientX: o.clientX + (x - o.clientX) * i / 5, clientY: o.clientY + (y - o.clientY) * i / 5 }))); const ind = document.querySelector(".drop-before, .drop-after, .drop-inside"); const cls = ind ? ind.className : ""; document.dispatchEvent(new PointerEvent("pointerup", Object.assign({}, o, { clientX: x, clientY: y, buttons: 0 }))); return cls; };',
  'const item = [...document.querySelectorAll(".pal-item")].find(e => e.textContent === "按钮");',
  'const dst = document.querySelector("#cv-world [data-id=header]");',
  'const r = dst.getBoundingClientRect(); pdrag(item, r.left + r.width/2, r.top + r.height/2);',
  FIND, 'return find(P.root, "header").children.map(c => c.type + ":" + c.change);'
].join('\n'));
check('palette drag adds a new button inside the header', pal.includes('button:added') && pal.length === 3, pal);
await ev('smyw.op.edit("task-list", "user-menu", "label", "我的账户 ▾"); return true');
const edited = await ev(FIND + 'const u = find(P.root, "user-menu"); return { change: u.change, before: u.before, label: u.label, unit: smyw.units.some(x => x.id === "user-menu") }');
check('editing an existing element marks it modified (new yellow unit)', edited.change === 'modified' && edited.before.label === '用户 ▾' && edited.unit, edited);
await ev('smyw.op.edit("task-list", "user-menu", "label", "用户 ▾"); return true');
check('editing back to the original value reverts to unchanged', await ev(FIND + 'const u = find(P.root, "user-menu"); return u.change === "unchanged" && !u.before'));
await ev('smyw.op.move("task-list", "search", { targetId: "task-table", pos: "before" }); return true');
const mv = await ev(FIND + 'const old = find(P.root, "search"); const nw = find(P.root, old.movedTo); return { old: old.change, nw: nw && nw.change, ghostDrawn: !!document.querySelector("#cv-world [data-id=search][data-side=before].mk"), copyDrawn: !!document.querySelector("#cv-world [data-id=" + old.movedTo + "].mk-added") }');
check('moving an existing element: red ghost + green copy on the canvas', mv.old === 'removed' && mv.nw === 'added' && mv.ghostDrawn && mv.copyDrawn, mv);
await ev('smyw.op.remove("task-list", "pager"); return true');
check('undo restores, redo reapplies', await ev(FIND + 'const a0 = find(P.root, "pager").change; smyw.undo(); const a = find(smyw.state.spec.pages[0].root, "pager").change; smyw.redo(); const b = find(smyw.state.spec.pages[0].root, "pager").change; return a0 === "removed" && a === "unchanged" && b === "removed"'));
await ev('smyw.focusUnit("task-table"); return true'); await sleep(400);
check('detail panel carries the editor + comment box in edit mode', await ev('const i = document.getElementById("inspector"); return !!i && !!i.querySelector("[data-f=columns]") && !!i.querySelector("[data-f=c-text]") && [...i.querySelectorAll("button")].some(b => b.textContent === "转为弹窗")'));
await shot('04-edit-mode');

console.log('comments & feedback');
await ev('smyw.op.comment({ kind: "node", page: "task-list", id: "user-menu", side: "after" }, "样式/风格", "建议", "用户菜单改成头像"); smyw.op.comment({ kind: "step", flow: "flow-create", id: "c6", side: "after" }, "流程/逻辑", "疑问", "task_tags 要加唯一索引吗？"); return true');
await ev('const s = smyw.state; s.global.tags.push("和现有页面不统一"); s.global.text = "整体太像后台"; s.answers["q-color"] = "需要"; smyw.setTab("feedback"); return true');
const md = await ev('return smyw.buildMarkdown(true)');
check('markdown contains global opinion, answers, comments, ops, revisedSpec', /和现有页面不统一/.test(md) && /标签需要支持自定义颜色吗？/.test(md) && /用户菜单改成头像/.test(md) && /改成弹窗/.test(md) && /revisedSpec/.test(md), md.slice(0, 300));
await shot('05-feedback');
const copied = await ev('const ok = await smyw.copyFeedback(); const out = document.getElementById("smyw-out"); return { ok, selected: out ? out.selectionEnd - out.selectionStart : -1, len: out ? out.value.length : -1 }');
check('copy feedback either copies or selects the whole text', copied.ok === true || (copied.selected === copied.len && copied.len > 0), copied);
const pasted = await ev('return document.getElementById("smyw-out").value');
writeFileSync(join(work, 'feedback-v1.md'), pasted);
execFileSync('node', [join(skill, 'scripts', 'apply-feedback.mjs'), join(work, 'feedback-v1.md'), join(work, 'spec.json')], { stdio: 'ignore' });
const v2spec = JSON.parse(readFileSync(join(work, 'spec.json'), 'utf8'));
check('apply-feedback.mjs turns the pasted Markdown into spec v2', v2spec.version === 2 && v2spec.pages.length === 3 && !JSON.stringify(v2spec).includes('"_um"'));

console.log('round trip: v2 → build → render');
execFileSync('node', [join(skill, 'scripts', 'build.mjs'), join(work, 'spec.json')], { stdio: 'ignore' });
await open(join(work, 'preview.html'));
const v2 = await ev('return { ver: smyw.state.spec.version, modal: !!document.querySelector(".cv-ov .t-modal"), inlineGone: !document.querySelector("#cv-world [data-id=task-form-card]"), ghost: !!document.querySelector("#cv-world [data-id=search][data-side=before].mk-removed"), trig: !!document.querySelector("#cv-world .is-trigger") }');
check('v2 renders the user-edited structure (modal + trigger + moved-out ghost)', v2.ver === 2 && v2.modal && v2.inlineGone && v2.ghost && v2.trig, v2);
await ev('const t = document.querySelector("#cv-world .is-trigger"); t.click(); return true'); await sleep(300);
check('selecting a trigger lists its interactions and offers to try it in play mode', await ev('return [...document.querySelectorAll("#inspector .dt-list li")].some(li => li.textContent.includes("打开")) && [...document.querySelectorAll("#inspector button")].some(b => b.textContent.includes("在演示里点一下"))'));
await shot('06-v2');

console.log('helpdesk-ai example (one real screen, multi-trigger connectors)');
await open(join(skill, 'examples', 'helpdesk-ai', 'preview.html'));
await ev('localStorage.clear(); return true');
const ds = await ev('return { units: smyw.units.map(u => u.id), frames: document.querySelectorAll(".cv-frame").length, cols: ["queue", "detail", "customer"].every(id => !!document.querySelector("#cv-world [data-id=" + id + "]")) }');
check('queue, detail and customer panel are drawn as one screen with 8 changes', ds.frames === 1 && ds.units.length === 8 && ds.cols, ds);
await ev('document.querySelector("#pl-frame") ; return 1');
const panel = await ev('await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return { menu: !!document.querySelector("#cv-links path.cv-link[data-from=t-assign][data-to=assign-menu]"), revealed: !!document.querySelector("#cv-world .cv-rev[data-ov=c-sim-1-detail]"), slot: !!document.querySelector("#cv-world .cv-frame .wf-slot[data-id=c-sim-1-detail]"), revLink: !!document.querySelector("#cv-links path.cv-link[data-from=c-sim-1][data-to=c-sim-1-detail]"), nested: !!document.querySelector("#cv-world .cv-rev[data-ov=as-3-sub]") }');
check('secondary menus and click-revealed content are separate panels, linked to their trigger by default', panel.menu && panel.revealed && panel.slot && panel.revLink && panel.nested, panel);
await ev('smyw.ui.showLinks = true; smyw.render(); return 1');
const link = await ev('await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); const p = document.querySelector("#cv-links path.cv-link[data-from=ai-edit]"); if (!p) return null; const t = document.querySelector("#cv-world .cv-frame [data-id=ai-edit]").getBoundingClientRect(); const o = document.querySelector("#cv-world .cv-ov[data-ov=ai-drawer]").getBoundingClientRect(); const pr = p.getBoundingClientRect(); return { to: p.dataset.to, startsNearTrigger: Math.abs(pr.left - t.right) < 12, endsAtOverlay: Math.abs(pr.right - o.left) < 12, toDrawer: document.querySelectorAll("#cv-links path[data-to=ai-drawer]").length, removedDashed: !!document.querySelector("#cv-links path.dashed[data-to=quick-modal]") }');
check('curved connectors: every trigger links to its overlay, removed ones dashed', link && link.to === 'ai-drawer' && link.startsNearTrigger && link.endsAtOverlay && link.toDrawer === 2 && link.removedDashed, link);
await shot('07b-connector');
await ev('smyw.ui.showLinks = false; smyw.render(); return 1');

console.log('play (prototype) mode');
await ev('smyw.play.start("inbox"); return 1'); await sleep(300);
const pl = await ev('const ia = [...document.querySelectorAll("#pl-frame [data-ia]")].map(x => x.dataset.id); const fn = getComputedStyle(document.querySelector("#pl-frame .wf-fn")).display; return { ia, fn, hidden: !document.querySelector("#pl-frame [data-id=c-sim-1-detail]") }');
check('play mode renders the screen with hotspots, hides fn placeholders and hidden blocks', pl.ia.includes('ai-edit') && pl.ia.includes('reply-polish') && pl.fn === 'none' && pl.hidden, pl);
await ev('document.querySelector("#pl-frame [data-id=t-title]").click(); return 1');
check('clicking a non-hotspot flashes the hotspots', await ev('return document.getElementById("pl-frame").classList.contains("pl-hint")'));
await ev('document.querySelector("#pl-frame [data-ia][data-id=ai-edit]").click(); return 1'); await sleep(200);
check('clicking a trigger opens its drawer over a dimmed screen', await ev('return !!document.querySelector(".pl-back-drawer.dim [data-id=ai-drawer]")'));
await shot('09-play-drawer');
await ev('document.querySelector(".pl-ov [data-ia][data-id=d-apply]").click(); return 1'); await sleep(200);
const ap = await ev('return { closed: !document.querySelector(".pl-back"), filled: document.querySelector("#pl-frame [data-id=reply-text]").textContent.includes("原路退回") }');
check('an action can switch another element\'s state and close the drawer', ap.closed && ap.filled, ap);
await ev('document.querySelector("#pl-frame [data-ia][data-id=c-sim-1]").click(); return 1'); await sleep(100);
check('toggle shows a hidden block', await ev('return !!document.querySelector("#pl-frame [data-id=c-sim-1-detail]")'));
await ev('document.querySelector("#pl-frame [data-ia][data-id=reply-polish]").click(); return 1'); await sleep(100);
await ev('document.querySelector(".pl-back").click(); return 1'); await sleep(100);
check('clicking the dimmed backdrop closes the overlay; the click log is kept', await ev('return !document.querySelector(".pl-back") && smyw.play.state.log.length === 4'));
await ev('const ta = document.querySelector("[data-f=pl-c]"); ta.value = "抽屉太宽"; [...document.querySelectorAll("#pl-side button")].find(b => b.textContent === "添加批注").click(); return 1'); await sleep(100);
check('comments written while playing record the play context', await ev('return smyw.state.comments.some(c => c.text.includes("演示中") && c.text.includes("抽屉太宽"))'));
await ev('document.querySelector("#pl-frame [data-ia][data-id=t-assign]").click(); return 1'); await sleep(150);
const mn = await ev('const m = document.querySelector(".pl-back-menu .pl-ov"); const b = document.querySelector("#pl-frame [data-id=t-assign]").getBoundingClientRect(); if (!m) return null; const r = m.getBoundingClientRect(); document.querySelector(".pl-ov [data-ia][data-id=as-3]").click(); return { below: Math.abs(r.top - b.bottom) < 20, dim: document.querySelector(".pl-back-menu").classList.contains("dim") }');
const sub = await ev('return !!document.querySelector(".pl-ov [data-id=as-3-sub]")');
check('a dropdown opens anchored under its button (no dim) and its sub-menu expands in place', mn && mn.below && !mn.dim && sub, { mn, sub });
await ev('smyw.state.comments = []; smyw.play.stop(); return 1');
await ev('smyw.focusUnit("reply"); return true'); await sleep(600);
await shot('07-helpdesk-unit');

console.log('DSH-style sandboxed iframe');
const probe = '<script>window.addEventListener("error", (e) => parent.postMessage({ err: String(e.message) }, "*"));' +
  'setTimeout(async () => { try { const m = window.smyw; const r = { booted: !!m, storageOk: m.storageOk, banner: document.body.textContent.includes("不允许保存进度") };' +
  'r.wf = document.querySelectorAll("#cv-world .wf").length; r.cam = !!m.ui.cam;' +
  'm.setMode("edit"); m.op.convert("task-list", "task-form-card", "menu"); r.ops = m.state.ops.length;' +
  'const rb = [...document.querySelectorAll("button")].find((b) => b.textContent === "重置"); rb.click(); r.resetAsk = [...document.querySelectorAll("button")].some((b) => b.textContent === "再点一次确认重置"); r.opsAfterFirstClick = m.state.ops.length;' +
  '[...document.querySelectorAll("button")].find((b) => b.textContent === "再点一次确认重置").click(); r.opsAfterReset = m.state.ops.length;' +
  'm.op.convert("task-list", "task-form-card", "modal"); const ok = await m.copyFeedback(); const out = document.getElementById("smyw-out");' +
  'r.copy = ok; r.selectedAll = !!out && out.selectionStart === 0 && out.selectionEnd === out.value.length && out.value.includes("revisedSpec"); parent.postMessage(r, "*"); }' +
  'catch (e) { parent.postMessage({ err: e.message }, "*"); } }, 900);<\/script>';
const sandboxed = readFileSync(join(skill, 'examples', 'task-tags', 'preview.html'), 'utf8').replace('</body>', probe + '</body>');
const payload = Buffer.from(JSON.stringify({ html: sandboxed, assets: [] }), 'utf8').toString('base64');
const boot = '<!doctype html><meta charset="utf-8"><script>(()=>{const b=Uint8Array.from(atob("' + payload + '"),c=>c.charCodeAt(0));const x=JSON.parse(new TextDecoder().decode(b));document.open();document.write(x.html);document.close();})()<\/script>';
await send('Page.navigate', { url: 'about:blank' }); await sleep(300);
await send('Runtime.evaluate', { expression: 'window.__boot = ' + JSON.stringify(boot) + '; true' });
const sres = await ev('return await new Promise((resolve) => { window.addEventListener("message", (e) => resolve(e.data)); const f = document.createElement("iframe"); f.sandbox = "allow-scripts"; f.style.cssText = "width:1600px;height:960px;border:0"; f.src = URL.createObjectURL(new Blob([window.__boot], { type: "text/html" })); document.body.style.margin = "0"; document.body.append(f); setTimeout(() => resolve({ timeout: true }), 9000); })');
check('renders the canvas and edits inside the sandboxed iframe', sres.booted && sres.wf > 10 && sres.cam && sres.ops >= 1 && !sres.err, sres);
check('sandbox: blocked storage is detected and the user is warned', sres.storageOk === false && sres.banner === true, sres);
check('sandbox: reset asks for a second click instead of confirm()', sres.resetAsk === true && sres.opsAfterFirstClick >= 1 && sres.opsAfterReset === 0, sres);
check('sandbox: copy works or the whole feedback is selected for Ctrl+C', sres.copy === true || sres.selectedAll === true, sres);
await shot('08-sandboxed-iframe');

check('no page errors', pageErrors.length === 0, pageErrors);
const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed; screenshots in ' + shots);
cleanup();
process.exit(failed.length ? 1 : 0);
