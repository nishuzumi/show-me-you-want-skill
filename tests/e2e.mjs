#!/usr/bin/env node
// End-to-end check of the canvas UI: build the examples, drive them in headless Chrome via CDP,
// exercise units / detail / camera / edit / comment / export, rebuild from the pasted feedback,
// and run the page inside a DSH-style sandboxed iframe (opaque origin: no storage / clipboard / dialogs).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
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
execFileSync('node', [join(skill, 'scripts', 'build.mjs'), '--no-archive', join(skill, 'examples', 'helpdesk-ai', 'spec.json')], { stdio: 'ignore' });
execFileSync('node', [join(skill, 'scripts', 'build.mjs'), '--no-archive', join(skill, 'examples', 'base-ui', 'spec.json')], { stdio: 'ignore' });
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
check('runtime booted from file:// with storage in clean split preview', await ev('return smyw.storageOk === true && smyw.ui.tab === "canvas" && smyw.ui.diffView === "split" && smyw.ui.diffMode === false'));
const ov = await ev('return { groups: document.querySelectorAll(".cv-group").length, cmpBoxes: document.querySelectorAll(".cv-cmp-box").length, bridges: document.querySelectorAll(".cv-bridge-arrow").length, beforeFrames: document.querySelectorAll(".cv-frame.cv-before").length, afterFrames: document.querySelectorAll(".cv-frame.cv-after").length, units: smyw.units.length, items: document.querySelectorAll(".cv-item").length, beforeHasAdded: document.querySelectorAll(".cv-frame.cv-before .mk-added").length, afterHasRemoved: document.querySelectorAll(".cv-frame.cv-after .mk-removed").length, pins: document.querySelectorAll("#cv-world .cv-pin").length, selects: document.querySelectorAll("#cv-world select.wf-select").length, cam: smyw.ui.cam }');
check('split view wraps each page in a comparison box with before/after bridge, real selects, and Figma comment pins', ov.groups === 3 && ov.cmpBoxes === 3 && ov.bridges === 3 && ov.beforeFrames === 3 && ov.afterFrames === 3 && ov.units >= 5 && ov.items === ov.units && ov.beforeHasAdded === 0 && ov.afterHasRemoved === 0 && ov.pins >= 3 && ov.selects >= 1 && ov.cam && ov.cam.k > 0 && ov.cam.k <= 1, ov);
check('clean preview hides diff outlines by default', await ev('const el = document.querySelector("#cv-world .cv-frame.cv-after .mk-u.mk-modified"); return document.getElementById("cv-vp").classList.contains("clean-mode") && el && getComputedStyle(el).outlineStyle === "none"'));
await ev('smyw.setDiffMode(true); return true'); await sleep(150);
check('diff mode dims unchanged nodes and highlights modified in yellow', await ev('const vp = document.getElementById("cv-vp"); const el = document.querySelector("#cv-world .cv-frame.cv-after .mk-u.mk-modified"); return vp.classList.contains("diff-mode") && vp.classList.contains("fade") && el && getComputedStyle(el).outlineColor === "rgb(226, 164, 0)"'));
check('whole added/removed modules: only the outer box is marked', await ev('return document.querySelectorAll("#cv-world .mk-added.mk-u .mk, #cv-world .mk-removed.mk-u .mk").length === 0'));
check('whole page added = green frame, removed = red frame, with opposite void placeholders', await ev('return !!document.querySelector(".cv-frame.cv-after.mk-added[data-page=tag-admin]") && !!document.querySelector(".cv-frame.cv-before.cv-void[data-page=tag-admin]") && !!document.querySelector(".cv-frame.cv-before.mk-removed[data-page=category-admin]") && !!document.querySelector(".cv-frame.cv-after.cv-void[data-page=category-admin]")'));
check('unchanged modules are real modules, not placeholders', await ev('return [...document.querySelectorAll("#cv-world .wf-comp")].some(e => e.textContent.includes("SideNav"))'));
check('toolbar offers split and wipe views only (no after-only or merged)', await ev('const bs = [...document.querySelectorAll(".cv-tools [data-dv]")].map(b => b.dataset.dv); return bs.join(",") === "split,wipe"'));
await ev('smyw.setDiffView("wipe"); return true'); await sleep(200);
const wipe = await ev('const box = document.querySelector(".cv-wipe[data-page=task-list]"); const bf = box && box.querySelector(".cv-wipe-before > .cv-frame"); const af = box && box.querySelector(".cv-wipe-after > .cv-frame"); smyw.setWipePos("task-list", 35); return { view: smyw.ui.diffView, wipes: document.querySelectorAll(".cv-wipe").length, handles: document.querySelectorAll(".cv-wipe-handle").length, pos: box ? box.style.getPropertyValue("--wipe") : "", sameH: !!(bf && af && bf.offsetHeight === af.offsetHeight) }');
check('wipe view overlays before/after frames with draggable handle, equalized height, and adjustable slider position', wipe.view === 'wipe' && wipe.wipes === 3 && wipe.handles === 3 && wipe.pos === '35%' && wipe.sameH, wipe);
await ev('smyw.setDiffView("split"); smyw.setDiffMode(false); return true'); await sleep(200);
await shot('01-canvas');

console.log('detail panel');
await ev('[...document.querySelectorAll(".cv-item")].find(b => b.textContent.includes("新建任务")).click(); return true');
await sleep(500);
const dt = await ev('return { unit: smyw.ui.unit, cmp: document.querySelectorAll("#inspector .dt-cmp .dt-render").length, diff: !!document.querySelector("#inspector .diff"), hl: !!document.querySelector("#cv-world .u-sel"), steps: [...document.querySelectorAll("#inspector .dt-list li")].length, stickyTop: !!document.querySelector("#inspector > .ins-top"), scrollBody: !!document.querySelector("#inspector > .ins-scroll"), dockedCbox: !!document.querySelector("#inspector > .ins-foot .cbox"), noTip: !document.querySelector("#inspector .ins-tip") }');
check('clicking a change opens before/after detail with sticky header, docked comment box, field diff and related steps', dt.unit === 'btn-new' && dt.cmp === 2 && dt.diff && dt.hl && dt.steps >= 1 && dt.stickyTop && dt.scrollBody && dt.dockedCbox && dt.noTip, dt);
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
await ev('smyw.op.convert("task-list", "task-form-card", "dialog"); return true');
const conv = await ev(FIND + 'const ov = P.overlays[P.overlays.length-1]; const main = find(P.root, "main"); const btn = find(P.root, ov.trigger); return { ovType: ov.type, ghost: !!find(P.root, "task-form-card"), btnChange: btn && btn.change, btnIndex: main.children.indexOf(btn), inner: ov.children.map(c => c.type), drawn: !!document.querySelector(".cv-ov .t-modal") }');
check('proposed inline card → Dialog opened by a new button at the same spot', conv.ovType === 'dialog' && !conv.ghost && conv.btnChange === 'added' && conv.btnIndex === 1 && conv.inner.join() === 'input,select,row' && conv.drawn, conv);
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
await ev('smyw.ui.sel = null; smyw.ui.unit = null; smyw.render(); smyw.fit(); return true'); await sleep(300);
const pal = await ev([
  'const pdrag = (src, x, y) => { const r = src.getBoundingClientRect(); const o = { bubbles: true, pointerId: 3, button: 0, buttons: 1, clientX: r.left + 4, clientY: r.top + 4 }; src.dispatchEvent(new PointerEvent("pointerdown", o)); for (let i = 1; i <= 5; i++) document.dispatchEvent(new PointerEvent("pointermove", Object.assign({}, o, { clientX: o.clientX + (x - o.clientX) * i / 5, clientY: o.clientY + (y - o.clientY) * i / 5 }))); const ind = document.querySelector(".drop-before, .drop-after, .drop-inside"); const cls = ind ? ind.className : ""; document.dispatchEvent(new PointerEvent("pointerup", Object.assign({}, o, { clientX: x, clientY: y, buttons: 0 }))); return cls; };',
  'const item = [...document.querySelectorAll(".pal-item")].find(e => e.textContent === "按钮");',
  'const dst = document.querySelector("#cv-world [data-id=header][data-side=after]");',
  'const r = dst.getBoundingClientRect(); pdrag(item, r.left + r.width/2, r.top + r.height/2);',
  FIND, 'return find(P.root, "header").children.map(c => c.type + ":" + c.change);'
].join('\n'));
check('palette drag adds a new button inside the header', pal.includes('button:added') && pal.length === 3, pal);
check('before frame stays read-only (no draggable nodes) in edit mode', await ev('return document.querySelectorAll("#cv-world .cv-frame.cv-before [data-drag]").length === 0'));
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
check('markdown contains global opinion, answers, comments, ops, revisedSpec', /和现有页面不统一/.test(md) && /标签需要支持自定义颜色吗？/.test(md) && /用户菜单改成头像/.test(md) && /改成弹窗/.test(md) && /smyw-patch/.test(md) && /revisedSpec/.test(md), md.slice(0, 300));
await shot('05-feedback');
const copied = await ev('const ok = await smyw.copyFeedback(); const out = document.getElementById("smyw-out"); return { ok, selected: out ? out.selectionEnd - out.selectionStart : -1, len: out ? out.value.length : -1 }');
check('copy feedback either copies or selects the whole text', copied.ok === true || (copied.selected === copied.len && copied.len > 0), copied);
const pasted = await ev('return document.getElementById("smyw-out").value');
const fullMd = await ev('return smyw.buildMarkdown(true)');
const fbx = await ev('return smyw.exportJSON()');
check('copied feedback carries only the patch by default (much smaller than the full spec)', /smyw-patch/.test(pasted) && !/revisedSpec（备用/.test(pasted) && pasted.length * 2 < fullMd.length, { pasted: pasted.length, full: fullMd.length, ops: fbx.patch.ops.length });
writeFileSync(join(work, 'feedback-v1.md'), pasted);
// the patch applied to the spec on disk must give exactly the full revised spec
const canon = (o) => Array.isArray(o) ? o.map(canon) : o && typeof o === 'object' ? Object.keys(o).filter((k) => !['version', 'basedOnVersion'].includes(k) && !(Array.isArray(o[k]) && !o[k].length)).sort().reduce((r, k) => (r[k] = canon(o[k]), r), {}) : o;
const dry = JSON.parse(execFileSync('node', [join(skill, 'scripts', 'apply-feedback.mjs'), join(work, 'feedback-v1.md'), join(work, 'spec.json'), '--dry-run']).toString().split('\n').slice(1).join('\n'));
check('applying the patch reproduces the full revised spec exactly', JSON.stringify(canon(dry)) === JSON.stringify(canon(fbx.revisedSpec)));
execFileSync('node', [join(skill, 'scripts', 'apply-feedback.mjs'), join(work, 'feedback-v1.md'), join(work, 'spec.json')], { stdio: 'ignore' });
const v2spec = JSON.parse(readFileSync(join(work, 'spec.json'), 'utf8'));
check('apply-feedback.mjs turns the pasted Markdown into spec v2', v2spec.version === 2 && v2spec.pages.length === 3 && !JSON.stringify(v2spec).includes('"_um"'));
writeFileSync(join(work, 'stale.md'), pasted);
let staleErr = ''; try { execFileSync('node', [join(skill, 'scripts', 'apply-feedback.mjs'), join(work, 'stale.md'), join(work, 'spec.json'), '--dry-run'], { stdio: 'pipe' }); } catch (err) { staleErr = String(err.stderr); }
check('a patch made on an older version is refused', /v1/.test(staleErr) && /v2/.test(staleErr), staleErr);

console.log('round trip: v2 → build → render');
execFileSync('node', [join(skill, 'scripts', 'build.mjs'), join(work, 'spec.json')], { stdio: 'ignore' });
await open(join(work, 'preview.html'));
const v2 = await ev('return { ver: smyw.state.spec.version, vers: smyw.versions.map(v => v.version), leftVer: smyw.ui.leftVer, rightVer: smyw.ui.rightVer, dialog: !!document.querySelector(".cv-ov [data-bui=dialog]"), inlineInV1: !!document.querySelector("#cv-world [data-id=task-form-card][data-side=before].mk-removed"), inlineInV2: !!document.querySelector("#cv-world [data-id=task-form-card][data-side=after]"), ghost: !!document.querySelector("#cv-world [data-id=search][data-side=before].mk-removed"), trig: !!document.querySelector("#cv-world .is-trigger") }');
check('v2 defaults to v1→v2 incremental diff (task-form-card removed in v1, Dialog added in v2)', v2.ver === 2 && v2.vers.join(',') === '0,1,2' && v2.leftVer === 1 && v2.rightVer === 2 && v2.dialog && v2.inlineInV1 && !v2.inlineInV2 && v2.ghost && v2.trig, v2);
await ev('document.querySelector("[data-ver-toggle]").click(); return true'); await sleep(200);
const v2Full = await ev('return { leftVer: smyw.ui.leftVer, rightVer: smyw.ui.rightVer, inlineGone: !document.querySelector("#cv-world [data-id=task-form-card]"), dialog: !!document.querySelector(".cv-ov [data-bui=dialog]") }');
check('one-click toggle switches to v0→v2 full diff (v1-only inline card gone)', v2Full.leftVer === 0 && v2Full.rightVer === 2 && v2Full.inlineGone && v2Full.dialog, v2Full);
await ev('const t = document.querySelector("#cv-world .is-trigger"); t.click(); return true'); await sleep(300);
check('selecting a trigger lists its interactions and offers to try it in play mode', await ev('return [...document.querySelectorAll("#inspector .dt-list li")].some(li => li.textContent.includes("打开")) && [...document.querySelectorAll("#inspector button")].some(b => b.textContent.includes("在演示里点一下"))'));
await shot('06-v2');

console.log('multi-version snapshots & arbitrary version comparison');
const mvDir = mkdtempSync(join(tmpdir(), 'smyw-mv-'));
const mvV1 = {
  title: '多版本测试', version: 1, stage: 'prototype', versionNote: '初版：加按钮与统计',
  pages: [{
    id: 'p1', name: '主面板', route: '/panel',
    root: { id: 'p1-root', type: 'page', children: [
      { id: 'hdr', type: 'header', component: '<PanelHeader>', children: [
        { id: 'h1', type: 'heading', label: '面板 v1', change: 'modified', before: { label: '面板 v0' }, note: 'v1 改名' },
        { id: 'v1-only-btn', type: 'button', label: 'v1 临时按钮', change: 'added', note: 'v1 新增的按钮' },
        { id: 'open-err', type: 'button', label: '查看错误', change: 'unchanged' },
        { id: 'open-same', type: 'button', label: '查看帮助', change: 'unchanged' },
        { id: 'toggle-tab2', type: 'button', label: '展开摘要', change: 'unchanged', on: [{ action: 'toggle', target: 'rev-summary' }] }
      ] },
      { id: 'box-a', type: 'card', label: '区域 A', component: '<BoxA>', children: [
        { id: 'move-me', type: 'button', label: '可移动按钮', change: 'unchanged' }
      ] },
      { id: 'box-b', type: 'card', label: '区域 B', component: '<BoxB>', children: [] },
      { id: 'rev-summary', type: 'card', label: '往届摘要面板', hidden: true, change: 'unchanged', children: [
        { id: 'rev-txt', type: 'text', label: 'v1 摘要内容', change: 'modified', before: { label: 'v0 摘要内容' } }
      ] }
    ] },
    overlays: [
      { id: 'err-dlg', type: 'dialog', label: '错误调试弹窗', trigger: 'open-err', change: 'unchanged', children: [
        { id: 'err-msg', type: 'text', label: 'v1 错误信息', change: 'modified', before: { label: 'v0 错误信息' } }
      ] },
      { id: 'same-dlg', type: 'dialog', label: '帮助弹窗', trigger: 'open-same', change: 'unchanged', children: [
        { id: 'same-msg', type: 'text', label: '固定帮助说明', change: 'unchanged' }
      ] }
    ]
  }],
  flows: [{ id: 'f1', name: '核心流程', steps: [
    { id: 's1', actor: 'user', text: '进入面板', change: 'unchanged' },
    { id: 's-v1', actor: 'frontend', text: 'v1 临时步骤', change: 'added' }
  ] }],
  backend: [{ id: 'm1', name: 'PanelAPI', kind: 'api', items: [
    { id: 'b1', kind: 'api', name: 'GET /panel', change: 'unchanged' },
    { id: 'b-v1', kind: 'api', name: 'POST /temp', change: 'added' }
  ] }]
};
writeFileSync(join(mvDir, 'spec.json'), JSON.stringify(mvV1, null, 2));
execFileSync('node', [join(skill, 'scripts', 'build.mjs'), join(mvDir, 'spec.json')], { stdio: 'ignore' });
const mvV2 = {
  title: '多版本测试', version: 2, stage: 'prototype', versionNote: '第二版：删临时按钮、移动按钮、补次页',
  pages: [
    {
      id: 'p1', name: '主面板', route: '/panel',
      root: { id: 'p1-root', type: 'page', children: [
        { id: 'hdr', type: 'header', component: '<PanelHeader>', children: [
          { id: 'h1', type: 'heading', label: '面板 v2', change: 'modified', before: { label: '面板 v0' }, note: 'v2 再次改名' },
          { id: 'open-err', type: 'button', label: '查看错误', change: 'unchanged' },
          { id: 'open-same', type: 'button', label: '查看帮助', change: 'unchanged' },
          { id: 'toggle-tab2', type: 'button', label: '展开摘要', change: 'unchanged', on: [{ action: 'toggle', target: 'rev-summary' }] }
        ] },
        { id: 'box-a', type: 'card', label: '区域 A', component: '<BoxA>', children: [
          { id: 'move-me-old', type: 'button', label: '可移动按钮', change: 'removed', movedTo: 'move-me' }
        ] },
        { id: 'box-b', type: 'card', label: '区域 B', component: '<BoxB>', children: [
          { id: 'move-me', type: 'button', label: '可移动按钮', change: 'added', movedFrom: 'move-me-old' },
          { id: 'v2-banner', type: 'text', label: 'v2 新增提示条', change: 'added', note: 'v2 新增' }
        ] },
        { id: 'rev-summary', type: 'card', label: '往届摘要面板', hidden: true, change: 'unchanged', children: [
          { id: 'rev-txt', type: 'text', label: 'v2 精简摘要内容', change: 'modified', before: { label: 'v0 摘要内容' } }
        ] }
      ] },
      overlays: [
        { id: 'err-dlg', type: 'dialog', label: '错误调试弹窗', trigger: 'open-err', change: 'unchanged', children: [
          { id: 'err-msg', type: 'text', label: 'v2 新错误详情', change: 'modified', before: { label: 'v0 错误信息' } }
        ] },
        { id: 'same-dlg', type: 'dialog', label: '帮助弹窗', trigger: 'open-same', change: 'unchanged', children: [
          { id: 'same-msg', type: 'text', label: '固定帮助说明', change: 'unchanged' }
        ] }
      ]
    },
    {
      id: 'p2', name: '设置页', route: '/settings',
      root: { id: 'p2-root', type: 'page', children: [
        { id: 'p2-title', type: 'heading', label: '新设置', component: '<Settings>', change: 'modified', before: { label: '旧设置' }, note: 'v2 首次改到已有设置页' }
      ] },
      overlays: []
    }
  ],
  flows: [{ id: 'f1', name: '核心流程', steps: [
    { id: 's1', actor: 'user', text: '进入面板', change: 'unchanged' },
    { id: 's-v2', actor: 'backend', text: 'v2 新增后端步骤', change: 'added' }
  ] }],
  backend: [{ id: 'm1', name: 'PanelAPI', kind: 'api', items: [
    { id: 'b1', kind: 'api', name: 'GET /panel', change: 'unchanged' },
    { id: 'b-v2', kind: 'api', name: 'POST /v2', change: 'added' }
  ] }]
};
writeFileSync(join(mvDir, 'spec.json'), JSON.stringify(mvV2, null, 2));
execFileSync('node', [join(skill, 'scripts', 'build.mjs'), join(mvDir, 'spec.json')], { stdio: 'ignore' });
check('build.mjs auto-archives spec-v1.json and spec-v2.json', existsSync(join(mvDir, 'spec-v1.json')) && existsSync(join(mvDir, 'spec-v2.json')));
await open(join(mvDir, 'preview.html'));
await ev('localStorage.clear(); return true');
const mvInit = await ev('const opts = [...document.querySelectorAll(".ver-sel[data-ver=right] option")].map(o => o.textContent); const bridge = (document.querySelector(".cv-bridge-lbl") || {}).textContent; const sides = [...document.querySelectorAll(".cv-group[data-page=p1] > .cv-cmp-box .cv-side-tag")].map(e => e.textContent); return { left: smyw.ui.leftVer, right: smyw.ui.rightVer, opts, bridge, sides, v1Removed: !!document.querySelector("#cv-world [data-id=v1-only-btn][data-side=before].mk-removed"), ghostMove: !!document.querySelector("#cv-world [data-id=move-me__from][data-side=before].mk-removed"), realMove: !!document.querySelector("#cv-world [data-id=move-me][data-side=after].mk-added"), v2Added: !!document.querySelector("#cv-world [data-id=v2-banner][data-side=after].mk-added") }');
check('multi-version opens on v1→v2 with versionNote labels, virtual move ghost, and incremental diff', mvInit.left === 1 && mvInit.right === 2 && mvInit.bridge === 'v1→v2' && mvInit.sides.join(',') === 'v1,v2 最新' && mvInit.opts.some((t) => t.includes('精简') || t.includes('第二版')) && mvInit.v1Removed && mvInit.ghostMove && mvInit.realMove && mvInit.v2Added, mvInit);
const mvPanels = await ev('const area = document.querySelector(".cv-group[data-page=p1] > .cv-panels-area"); const mainBox = document.querySelector(".cv-group[data-page=p1] > .cv-cmp-box"); const revCmp = area && area.querySelector(".cv-ov-cmp[data-ov-group=rev-summary]"); const dlgCmp = area && area.querySelector(".cv-ov-cmp[data-ov-group=err-dlg]"); const sameCards = document.querySelectorAll("#cv-world .cv-ov[data-ov=same-dlg]").length; const revB = revCmp && revCmp.querySelector(".cv-ov[data-side=before]").getBoundingClientRect(); const revA = revCmp && revCmp.querySelector(".cv-ov[data-side=after]").getBoundingClientRect(); return { belowMain: !!(area && mainBox && area.getBoundingClientRect().top >= mainBox.getBoundingClientRect().bottom - 2), noSideCols: !document.querySelector(".cv-group[data-page=p1] > .cv-ovcol"), revPaired: !!(revCmp && revB && revA && revA.left - revB.right < 120), dlgPaired: !!dlgCmp, sameSingle: sameCards === 1 }');
check('interactive panels are grouped below main page: modified panels pair side-by-side & unchanged panels render once', mvPanels.belowMain && mvPanels.noSideCols && mvPanels.revPaired && mvPanels.dlgPaired && mvPanels.sameSingle, mvPanels);
await ev('smyw.setDiffView("wipe"); return true'); await sleep(150);
const mvPanelWipe = await ev('const pw = document.querySelector(".cv-ov-wipe[data-wipe-key=\'p1::err-dlg\']"); smyw.setWipePos("p1::err-dlg", 28); const bf = pw && pw.querySelector(".cv-wipe-before > .cv-ov"); const af = pw && pw.querySelector(".cv-wipe-after > .cv-ov"); return { hasWipe: !!pw, pos: pw ? pw.style.getPropertyValue("--wipe") : "", sameH: !!(bf && af && bf.offsetHeight === af.offsetHeight), sameSingle: document.querySelectorAll("#cv-world .cv-ov[data-ov=same-dlg]").length === 1 }');
check('wipe mode applies independently to modified interactive panels with equalized heights', mvPanelWipe.hasWipe && mvPanelWipe.pos === '28%' && mvPanelWipe.sameH && mvPanelWipe.sameSingle, mvPanelWipe);
await ev('smyw.setDiffView("split"); return true'); await sleep(150);
await ev('smyw.setVersions(0, 2); return true'); await sleep(150);
const mvV0V2 = await ev('const p2b = document.querySelector("#cv-world .cv-frame.cv-before[data-page=p2]"); return { left: smyw.ui.leftVer, right: smyw.ui.rightVer, v1Gone: !document.querySelector("#cv-world [data-id=v1-only-btn]"), p2HasOldBefore: !!(p2b && p2b.textContent.includes("旧设置")), toggleTxt: (document.querySelector("[data-ver-toggle]") || {}).textContent }');
check('v0→v2 merges first-seen before of newly touched existing page p2 and hides v1-only deleted node', mvV0V2.left === 0 && mvV0V2.right === 2 && mvV0V2.v1Gone && mvV0V2.p2HasOldBefore && /只看本轮 v1→v2/.test(mvV0V2.toggleTxt), mvV0V2);
await ev('smyw.setVersions(0, 1); return true'); await sleep(150);
const mvHist = await ev('smyw.setMode("edit"); const editBtn = [...document.querySelectorAll(".seg button")].find(b => b.textContent === "编辑方案"); smyw.op.comment({ kind: "node", page: "p1", id: "v1-only-btn", side: "after" }, "文案", "建议", "历史版本上的批注"); return { mode: smyw.ui.mode, editDisabled: !!(editBtn && editBtn.disabled), banner: !!document.querySelector(".ver-banner"), v1Added: !!document.querySelector("#cv-world [data-id=v1-only-btn][data-side=after].mk-added"), v2Absent: !document.querySelector("#cv-world [data-id=v2-banner]"), where: smyw.state.comments[0] && smyw.state.comments[0].where }');
check('v0→v1 historical view is read-only with banner and prefixes comments with [v0→v1]', mvHist.mode === 'view' && mvHist.editDisabled && mvHist.banner && mvHist.v1Added && mvHist.v2Absent && /^\[v0→v1\]/.test(mvHist.where || ''), mvHist);
await ev('document.querySelector(".ver-back").click(); return true'); await sleep(150);
const mvBack = await ev('const keptCmt = smyw.state.comments.length === 1; smyw.setMode("edit"); smyw.op.edit("p1", "v2-banner", "label", "v2 更新后提示条"); const updated = document.querySelector("#cv-world [data-id=v2-banner][data-side=after]").textContent.includes("v2 更新后提示条"); smyw.op.restore("p1", "v1-only-btn"); const restoredInV1V2 = !!document.querySelector("#cv-world [data-id=v1-only-btn][data-side=after]:not(.mk)"); smyw.op.restore("p1", "move-me__from"); const patchBase = smyw.specPatch().base; return { left: smyw.ui.leftVer, right: smyw.ui.rightVer, keptCmt, updated, restoredInV1V2, patchBase }');
check('editing & restoring in v1→v2 live-updates view, restores v1-deleted nodes & move ghosts, and keeps comments/patch base v2', mvBack.left === 1 && mvBack.right === 2 && mvBack.keptCmt && mvBack.updated && mvBack.restoredInV1V2 && mvBack.patchBase === 2, mvBack);
await ev('smyw.setTab("feedback"); return true'); await sleep(100);
await ev('document.querySelector(".cmt .where").click(); return true'); await sleep(200);
check('jumping to a historical comment from feedback locates it on the canvas', await ev('return smyw.ui.tab === "canvas" && smyw.ui.sel && smyw.ui.sel.id === "v1-only-btn"'));

console.log('helpdesk-ai example (one real screen, multi-trigger connectors)');
await open(join(skill, 'examples', 'helpdesk-ai', 'preview.html'));
await ev('localStorage.clear(); return true');
const ds = await ev('return { units: smyw.units.map(u => u.id), groups: document.querySelectorAll(".cv-group").length, frames: document.querySelectorAll(".cv-frame").length, cols: ["queue", "detail", "customer"].every(id => !!document.querySelector("#cv-world .cv-frame.cv-after [data-id=" + id + "]")) }');
check('queue, detail and customer panel are drawn as one screen (split into before/after) with 8 changes', ds.groups === 1 && ds.frames === 2 && ds.units.length === 8 && ds.cols, ds);
await ev('smyw.setDiffMode(true); return 1');
const panel = await ev('await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return { areaBelow: !!document.querySelector(".cv-group[data-page=inbox] > .cv-panels-area"), menu: !!document.querySelector("#cv-world .cv-ov[data-ov=assign-menu]"), revealed: !!document.querySelector("#cv-world .cv-rev[data-ov=c-sim-1-detail]"), slot: !!document.querySelector("#cv-world .cv-frame.cv-after .wf-slot[data-id=c-sim-1-detail]"), nested: !!document.querySelector("#cv-world .cv-rev[data-ov=as-3-sub]"), noSpaghetti: document.querySelectorAll("#cv-links path.cv-link").length === 0 }');
check('secondary menus and click-revealed content render in paired tray below page without unasked spaghetti links', panel.areaBelow && panel.menu && panel.revealed && panel.slot && panel.nested && panel.noSpaghetti, panel);
await ev('smyw.ui.showLinks = true; smyw.render(); return 1');
const link = await ev('await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); const p = document.querySelector("#cv-links path.cv-link[data-from=ai-edit]"); if (!p) return null; const t = document.querySelector("#cv-world .cv-frame.cv-after [data-id=ai-edit]").getBoundingClientRect(); const o = document.querySelector("#cv-world .cv-ov[data-ov=ai-drawer]").getBoundingClientRect(); const pr = p.getBoundingClientRect(); return { to: p.dataset.to, connectsDown: pr.top <= t.bottom + 12 && pr.bottom >= o.top - 12, toDrawer: document.querySelectorAll("#cv-links path[data-to=ai-drawer]").length, removedDashed: !!document.querySelector("#cv-links path.dashed[data-to=quick-modal]"), moveLink: !!document.querySelector("#cv-links path[data-diff-link=move][data-from=t-resolve]") }');
check('curved connectors: showLinks draws trigger-to-panel connectors, removed dashed, and cross-frame move links', link && link.to === 'ai-drawer' && link.connectsDown && link.toDrawer === 2 && link.removedDashed && link.moveLink, link);
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
const fbi = await ev('return [...document.querySelectorAll("#inspector .bui-import")].map(x => x.textContent)');
check('form detail shows both Form and Field imports', fbi.some((t) => t.includes("@base-ui/react/form")) && fbi.some((t) => t.includes("@base-ui/react/field")), fbi);
await shot('07-helpdesk-unit');

console.log('base-ui example (Base UI primitives)');
await open(join(skill, 'examples', 'base-ui', 'preview.html'));
await ev('localStorage.clear(); return true');
const bu = await ev('return { buiScript: !!document.getElementById("smyw-bui"), dialogs: document.querySelectorAll("#cv-world [data-bui=dialog]").length, switchNode: !!document.querySelector("#cv-world [data-bui=switch]"), toast: !!document.querySelector("#cv-world [data-bui=toast]"), tabLabels: [...document.querySelectorAll("#cv-world [data-id=team-tabs-list] .wf-lbl")].map(x => x.textContent), inlineTabs: !document.querySelector("#cv-world .cv-rev[data-ov=roles]") && !!document.querySelector("#cv-world [data-id=members]") && !document.querySelector("#cv-world [data-id=roles]") }');
check('base-ui example renders Dialog / Switch / Toast primitives and keeps Tabs panels in-place', bu.buiScript && bu.dialogs === 1 && bu.switchNode && bu.toast && bu.tabLabels.includes('成员') && bu.inlineTabs, bu);
await ev('document.querySelector("#cv-world [data-id=tab-roles]").click(); return 1'); await sleep(150);
check('clicking a tab button switches tab panels directly on the canvas', await ev('return !document.querySelector("#cv-world [data-id=members]") && !!document.querySelector("#cv-world [data-id=roles]")'));
await ev('document.querySelector("#cv-world [data-id=tab-members]").click(); return 1'); await sleep(150);
await ev('smyw.focusUnit("invite-dialog"); return 1'); await sleep(500);
const dbi = await ev('const b = document.querySelector("#inspector .bui"); return b ? { text: b.textContent, importOk: b.textContent.includes("@base-ui/react/dialog"), parts: b.textContent.includes("Root · Trigger") } : null');
check('Base UI detail shows the Dialog import and anatomy', !!dbi && dbi.importOk && dbi.parts, dbi);
await ev('smyw.ui.sel = { kind: "node", page: "team-settings", id: "notify-switch", side: "after" }; smyw.render(); return 1'); await sleep(300);
const sbi = await ev('return [...document.querySelectorAll("#inspector .bui")].map(x => x.textContent).join(" | ")');
check('switch detail maps to Base UI Switch', /Base UI · Switch/.test(sbi) && /@base-ui\/react\/switch/.test(sbi), sbi);
await ev('smyw.ui.sel = { kind: "node", page: "team-settings", id: "compact-toggle", side: "after" }; smyw.render(); return 1'); await sleep(300);
const tbi = await ev('return [...document.querySelectorAll("#inspector .bui")].map(x => x.textContent).join(" | ")');
check('toggle detail maps to Base UI Toggle, not Switch', /Base UI · Toggle/.test(tbi) && /@base-ui\/react\/toggle/.test(tbi) && !/@base-ui\/react\/switch/.test(tbi), tbi);
const swt = await ev('return { sw: !!document.querySelector("#cv-world [data-id=notify-switch] .wf-toggle"), tb: !!document.querySelector("#cv-world [data-id=compact-toggle] .wf-toggle-btn") }');
check('Switch renders as a switch and Toggle as a toggle button', swt.sw && swt.tb, swt);
await ev('smyw.ui.sel = { kind: "node", page: "team-settings", id: "invite-role", side: "after" }; smyw.render(); return 1'); await sleep(300);
const rbi = await ev('return [...document.querySelectorAll("#inspector .bui-import")].map(x => x.textContent)');
check('radio-group detail shows both RadioGroup and Radio imports', rbi.some((t) => t.includes("@base-ui/react/radio-group")) && rbi.some((t) => t.includes("@base-ui/react/radio")), rbi);
const exF = await ev('return { team: document.querySelector("#cv-world [data-id=team-name-field]").textContent, invite: document.querySelector("#cv-world [data-id=invite-email-field]").textContent, fieldset: !!document.querySelector("#cv-world [data-bui=fieldset]") }');
const countText = (s, w) => s.split(w).length - 1;
check('field example labels each field once and groups with Fieldset', countText(exF.team, '团队名称') === 1 && countText(exF.invite, '邮箱') === 1 && exF.fieldset, exF);
const exA = await ev('return { q: !!document.querySelector("#cv-world [data-id=quota-trigger]"), p: !!document.querySelector("#cv-world [data-id=prefs-trigger]"), qov: !!document.querySelector("#cv-world .cv-rev[data-ov=quota]"), pov: !!document.querySelector("#cv-world .cv-rev[data-ov=prefs]") }');
check('accordion example uses trigger buttons and hidden panels', exA.q && exA.p && exA.qov && exA.pov, exA);
await ev('smyw.play.start("team-settings"); return 1'); await sleep(300);
const sw0 = await ev('return { st: smyw.play.state.st["notify-switch"] ?? null, sub: (document.querySelector("#pl-frame [data-id=notify-switch] .wf-sub") || {}).textContent || "" }');
await ev('document.querySelector("#pl-frame [data-ia][data-id=notify-switch]").click(); return 1'); await sleep(200);
const sw1 = await ev('return { st: smyw.play.state.st["notify-switch"] ?? null, sub: (document.querySelector("#pl-frame [data-id=notify-switch] .wf-sub") || {}).textContent || "" }');
await ev('document.querySelector("#pl-frame [data-ia][data-id=notify-switch]").click(); return 1'); await sleep(200);
const sw2 = await ev('return { st: smyw.play.state.st["notify-switch"] ?? null, sub: (document.querySelector("#pl-frame [data-id=notify-switch] .wf-sub") || {}).textContent || "" }');
check('switch toggles on and back off in play mode', sw0.st == null && !sw0.sub && sw1.st === 'on' && /已开启/.test(sw1.sub) && sw2.st == null && !sw2.sub, { sw0, sw1, sw2 });
const tg0 = await ev('return { st: smyw.play.state.st["compact-toggle"] ?? null, sub: (document.querySelector("#pl-frame [data-id=compact-toggle] .wf-sub") || {}).textContent || "" }');
await ev('document.querySelector("#pl-frame [data-ia][data-id=compact-toggle]").click(); return 1'); await sleep(200);
const tg1 = await ev('return { st: smyw.play.state.st["compact-toggle"] ?? null, sub: (document.querySelector("#pl-frame [data-id=compact-toggle] .wf-sub") || {}).textContent || "" }');
await ev('document.querySelector("#pl-frame [data-ia][data-id=compact-toggle]").click(); return 1'); await sleep(200);
const tg2 = await ev('return { st: smyw.play.state.st["compact-toggle"] ?? null, sub: (document.querySelector("#pl-frame [data-id=compact-toggle] .wf-sub") || {}).textContent || "" }');
check('toggle toggles on and back off in play mode', tg0.st == null && !tg0.sub && tg1.st === 'on' && /已开启/.test(tg1.sub) && tg2.st == null && !tg2.sub, { tg0, tg1, tg2 });
const tab0 = await ev('return { m: !!document.querySelector("#pl-frame [data-id=members]"), r: !!document.querySelector("#pl-frame [data-id=roles]"), b: !!document.querySelector("#pl-frame [data-id=billing]") }');
await ev('document.querySelector("#pl-frame [data-ia][data-id=tab-roles]").click(); return 1'); await sleep(200);
const tab1 = await ev('return { m: !!document.querySelector("#pl-frame [data-id=members]"), r: !!document.querySelector("#pl-frame [data-id=roles]"), b: !!document.querySelector("#pl-frame [data-id=billing]") }');
await ev('document.querySelector("#pl-frame [data-ia][data-id=tab-billing]").click(); return 1'); await sleep(200);
const tab2 = await ev('return { m: !!document.querySelector("#pl-frame [data-id=members]"), r: !!document.querySelector("#pl-frame [data-id=roles]"), b: !!document.querySelector("#pl-frame [data-id=billing]") }');
check('play mode switches tabs through hidden panels', tab0.m && !tab0.r && !tab0.b && !tab1.m && tab1.r && !tab1.b && !tab2.m && !tab2.r && tab2.b, { tab0, tab1, tab2 });
const ac0 = await ev('return { q: !!document.querySelector("#pl-frame [data-id=quota]"), p: !!document.querySelector("#pl-frame [data-id=prefs]") }');
await ev('document.querySelector("#pl-frame [data-ia][data-id=quota-trigger]").click(); return 1'); await sleep(200);
const ac1 = await ev('return { q: !!document.querySelector("#pl-frame [data-id=quota]"), p: !!document.querySelector("#pl-frame [data-id=prefs]") }');
await ev('document.querySelector("#pl-frame [data-ia][data-id=quota-trigger]").click(); return 1'); await sleep(200);
const ac2 = await ev('return { q: !!document.querySelector("#pl-frame [data-id=quota]"), p: !!document.querySelector("#pl-frame [data-id=prefs]") }');
await ev('document.querySelector("#pl-frame [data-ia][data-id=prefs-trigger]").click(); return 1'); await sleep(200);
const ac3 = await ev('return { q: !!document.querySelector("#pl-frame [data-id=quota]"), p: !!document.querySelector("#pl-frame [data-id=prefs]") }');
check('play mode expands and collapses accordion panels', !ac0.q && !ac0.p && ac1.q && !ac1.p && !ac2.q && !ac2.p && !ac3.q && ac3.p, { ac0, ac1, ac2, ac3 });
await ev('smyw.play.stop(); smyw.play.start("team-settings"); return 1'); await sleep(300);
await ev('document.querySelector("#pl-frame [data-ia][data-id=invite]").click(); return 1'); await sleep(300);
const bplay = await ev('return { open: !!document.querySelector(".pl-back-modal [data-bui=dialog]"), dim: !!document.querySelector(".pl-back-modal.dim") }');
check('play mode opens the Base UI Dialog over a dimmed screen', bplay.open && bplay.dim, bplay);
await shot('09b-base-ui');
await ev('smyw.play.stop(); return 1');
await ev('smyw.state.spec.pages[0].root.children.push({ id: "proto-node", type: "__proto__", label: "未知组件", change: "added" }); smyw.ui.sel = { kind: "node", page: "team-settings", id: "proto-node", side: "after" }; smyw.ui.unit = null; smyw.render(); return 1');
const proto = await ev('return { rendered: !!document.querySelector("#cv-world [data-id=proto-node]"), bui: !!document.querySelector("#inspector .bui"), buiText: (document.querySelector("#inspector .bui") || {}).textContent || "", head: (document.querySelector("#inspector .ins-head") || {}).textContent || "", tab: smyw.ui.tab, sel: smyw.ui.sel }');
check('unknown component type falls back without crashing', proto.rendered && !proto.bui, proto);

console.log('DSH-style sandboxed iframe');
const probe = '<script>window.addEventListener("error", (e) => parent.postMessage({ err: String(e.message) }, "*"));' +
  'setTimeout(async () => { try { const m = window.smyw; const r = { booted: !!m, storageOk: m.storageOk, banner: document.body.textContent.includes("不允许保存进度") };' +
  'r.wf = document.querySelectorAll("#cv-world .wf").length; r.cam = !!m.ui.cam;' +
  'm.setMode("edit"); m.op.convert("task-list", "task-form-card", "menu"); r.ops = m.state.ops.length;' +
  'const rb = [...document.querySelectorAll("button")].find((b) => b.textContent === "重置"); rb.click(); r.resetAsk = [...document.querySelectorAll("button")].some((b) => b.textContent === "再点一次确认重置"); r.opsAfterFirstClick = m.state.ops.length;' +
  '[...document.querySelectorAll("button")].find((b) => b.textContent === "再点一次确认重置").click(); r.opsAfterReset = m.state.ops.length;' +
  'm.op.convert("task-list", "task-form-card", "dialog"); const ok = await m.copyFeedback(); const out = document.getElementById("smyw-out");' +
  'r.copy = ok; r.selectedAll = !!out && out.selectionStart === 0 && out.selectionEnd === out.value.length && out.value.includes("smyw-patch"); parent.postMessage(r, "*"); }' +
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
