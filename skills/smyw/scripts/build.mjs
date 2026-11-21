#!/usr/bin/env node
// smyw build: validate a change spec and inline it into one self-contained preview HTML.
// Usage: node build.mjs <spec.json> [-o preview.html] [--check]
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, join, relative, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '..', 'assets');
const BUI = JSON.parse(readFileSync(join(assets, 'base-ui.json'), 'utf8'));
const BUI_COMPONENTS = BUI.components || {};

// The wireframe vocabulary plus the Base UI primitives the agent can compose with.
const TYPES = new Set(['page', 'section', 'row', 'col', 'grid', 'card', 'form', 'list', 'item', 'nav', 'tabs', 'header', 'footer', 'sidebar', 'toolbar', 'panel', 'group', 'modal', 'drawer', 'popover', 'menu', 'button', 'link', 'input', 'textarea', 'select', 'checkbox', 'radio', 'toggle', 'upload', 'heading', 'text', 'image', 'table', 'chart', 'stat', 'badge', 'tag', 'icon', 'divider', 'placeholder', ...Object.keys(BUI_COMPONENTS)]);
const OVERLAY = new Set(['modal', 'drawer', 'popover', 'menu', ...Object.keys(BUI_COMPONENTS).filter((k) => BUI_COMPONENTS[k].overlay)]);
const CHANGES = new Set(['added', 'removed', 'modified', 'unchanged']);
const IA_ACTIONS = new Set(['open', 'close', 'navigate', 'toggle', 'show', 'hide', 'state', 'back']);
const ACTORS = new Set(['user', 'frontend', 'backend', 'db', 'external', 'system']);

function usage(code) {
  console.log('用法: node build.mjs <spec.json> [-o <out.html>] [--check]\n  默认输出到 spec 同目录的 preview.html；--check 只校验不生成。');
  process.exit(code);
}

const args = process.argv.slice(2);
let specPath = null, out = null, checkOnly = false, noTheme = false, noArchive = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-o' || a === '--out') out = args[++i];
  else if (a === '--check') checkOnly = true;
  else if (a === '--no-theme') noTheme = true;
  else if (a === '--no-archive') noArchive = true;
  else if (a === '-h' || a === '--help') usage(0);
  else if (!specPath) specPath = a;
  else usage(2);
}
if (!specPath) usage(2);
specPath = resolve(specPath);

let raw;
try { raw = readFileSync(specPath, 'utf8'); } catch (e) { console.error('✖ 读不到 spec：' + specPath + '\n  ' + e.message); process.exit(1); }
let spec;
try { spec = JSON.parse(raw); } catch (e) {
  const m = /position (\d+)/.exec(e.message);
  let where = '';
  if (m) { const pos = Number(m[1]); const line = raw.slice(0, pos).split('\n').length; where = '（第 ' + line + ' 行附近）'; }
  console.error('✖ spec 不是合法 JSON' + where + '：' + e.message);
  process.exit(1);
}

const { errors, warnings, summary } = validate(spec);
for (const w of warnings) console.log('⚠ ' + w);
for (const e of errors) console.error('✖ ' + e);
console.log(summary);
if (errors.length) { console.error('✖ 有 ' + errors.length + ' 个错误，未生成。'); process.exit(1); }
if (checkOnly) { console.log('✔ 校验通过'); process.exit(0); }

const template = readFileSync(join(assets, 'template.html'), 'utf8');
const css = readFileSync(join(assets, 'style.css'), 'utf8');
const runtime = readFileSync(join(assets, 'runtime.js'), 'utf8');
const themeRes = noTheme ? { css: '', source: null } : extractProjectTheme(specPath, spec);
if (themeRes.source) console.log('· 主题：已从 ' + themeRes.source + ' 提取项目配色与圆角');
if (!noArchive) archiveCurrentSpec(specPath, raw, spec);
const versions = collectVersions(specPath, spec);
if (versions.length > 2) {
  const prev = versions[versions.length - 2].version, latest = versions[versions.length - 1].version;
  console.log('· 历史版本：' + versions.map((v) => 'v' + v.version + (v.version === 0 ? '（现状）' : '')).join(' → ') + '（默认对比 v' + prev + ' → v' + latest + '）');
}
const escJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const specJson = escJson(spec);
const versionsJson = escJson(versions);
const buiJson = escJson(BUI);
const html = template
  .replace('__TITLE__', () => escapeHtml((spec.title || 'smyw') + ' · 变更预览'))
  .replace('/*__STYLE__*/', () => css + (themeRes.css ? '\n' + themeRes.css : ''))
  .replace('/*__RUNTIME__*/', () => runtime.replace(/<\/script/gi, '<\\/script'))
  .replace('__BUI__', () => buiJson)
  .replace('__VERSIONS__', () => versionsJson)
  .replace('__SPEC__', () => specJson);
const outPath = resolve(out || join(dirname(specPath), 'preview.html'));
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html);
console.log('✔ 已生成 ' + outPath + '（' + Math.round(html.length / 1024) + ' KB）');
console.log('  ' + pathToFileURL(outPath).href);

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

/* Auto-archive current spec.json as spec-v<N>.json so manual version bumps never lose prior history. */
function archiveCurrentSpec(specFile, rawText, specObj) {
  const ver = Number(specObj.version) || 1;
  const dir = dirname(specFile);
  if (/^spec-v\d+\.json$/.test(basename(specFile))) return;
  const dest = join(dir, 'spec-v' + ver + '.json');
  if (resolve(dest) === resolve(specFile)) return;
  try {
    if (existsSync(dest) && readFileSync(dest, 'utf8') === rawText) return;
    writeFileSync(dest, rawText);
  } catch { /* ignore archive write error */ }
}

/* Extract a pure before or after snapshot from a merged smyw spec tree. */
function isEmptyVal(v) { return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0); }
function extractItemArr(arr, side) {
  if (!Array.isArray(arr)) return undefined;
  const out = [];
  for (const x of arr) {
    if (x && typeof x === 'object') {
      if (side === 'before' && x.change === 'added') continue;
      if (side === 'after' && x.change === 'removed') continue;
      const lbl = side === 'before' && x.before != null ? (typeof x.before === 'object' ? x.before.label : x.before) : x.label;
      if (lbl != null) out.push(String(lbl));
    } else if (x != null) out.push(String(x));
  }
  return out;
}
function extractObj(o, side, childKeys) {
  if (!o || typeof o !== 'object') return null;
  if (side === 'before' && o.change === 'added') return null;
  if (side === 'after' && o.change === 'removed') return null;
  const out = {};
  const skip = new Set(['change', 'before', 'movedFrom', 'movedTo', '_um', ...childKeys]);
  for (const k of Object.keys(o)) {
    if (skip.has(k)) continue;
    if (side === 'before' && k === 'note') continue;
    if (k === 'items' && !childKeys.includes('items')) { out.items = extractItemArr(o.items, side); continue; }
    if (k === 'columns') { out.columns = extractItemArr(o.columns, side); continue; }
    out[k] = JSON.parse(JSON.stringify(o[k]));
  }
  if (side === 'before' && o.before && typeof o.before === 'object') {
    for (const k of Object.keys(o.before)) {
      const bv = o.before[k];
      if (isEmptyVal(bv)) delete out[k];
      else if (k === 'items' && !childKeys.includes('items')) out.items = extractItemArr(bv, side);
      else if (k === 'columns') out.columns = extractItemArr(bv, side);
      else out[k] = JSON.parse(JSON.stringify(bv));
    }
  }
  for (const ck of childKeys) {
    if (ck === 'root') {
      out.root = o.root ? extractObj(o.root, side, ['children']) : { type: 'page', children: [] };
    } else if (Array.isArray(o[ck])) {
      const subKeys = ck === 'children' || ck === 'overlays' ? ['children'] : [];
      const kids = o[ck].map((c) => extractObj(c, side, subKeys)).filter(Boolean);
      if (kids.length || ck !== 'children') out[ck] = kids;
    }
  }
  return out;
}
function extractSpecSide(sp, side) {
  const out = { title: sp.title || '未命名变更', version: side === 'before' ? 0 : (Number(sp.version) || 1), stage: side === 'before' ? 'baseline' : (sp.stage || 'prototype') };
  if (side === 'after') {
    if (sp.summary) out.summary = sp.summary;
    if (sp.versionNote) out.versionNote = sp.versionNote;
    if (Array.isArray(sp.changes)) out.changes = sp.changes;
    if (Array.isArray(sp.questions)) out.questions = sp.questions;
  }
  out.pages = (Array.isArray(sp.pages) ? sp.pages : []).map((p) => extractObj(p, side, ['root', 'overlays'])).filter(Boolean);
  out.flows = (Array.isArray(sp.flows) ? sp.flows : []).map((f) => extractObj(f, side, ['steps'])).filter(Boolean);
  out.backend = (Array.isArray(sp.backend) ? sp.backend : []).map((m) => extractObj(m, side, ['items'])).filter(Boolean);
  return out;
}
function collectVersions(specFile, curSpec) {
  const curVer = Number(curSpec.version) || 1;
  const dir = dirname(specFile);
  const byVer = new Map();
  try {
    for (const f of readdirSync(dir)) {
      const m = /^spec-v(\d+)\.json$/.exec(f);
      if (!m) continue;
      try {
        const obj = JSON.parse(readFileSync(join(dir, f), 'utf8'));
        const v = Number(obj.version) || Number(m[1]);
        if (v > 0 && v <= curVer) byVer.set(v, obj);
      } catch { /* skip unreadable history */ }
    }
  } catch { /* ignore */ }
  byVer.set(curVer, curSpec);
  const nums = [...byVer.keys()].sort((a, b) => a - b);
  // Build v0 baseline by merging the first-seen before state of every existing page / flow / module across v1..vN.
  const firstSpec = byVer.get(nums[0]);
  const v0 = extractSpecSide(firstSpec, 'before');
  const seenPage = new Set(v0.pages.map((p) => p.id).filter(Boolean));
  const seenFlow = new Set(v0.flows.map((f) => f.id).filter(Boolean));
  const seenBe = new Set(v0.backend.map((m) => m.id).filter(Boolean));
  const addedEarlier = { pages: new Set(), flows: new Set(), backend: new Set() };
  const recordAdded = (sp) => {
    (sp.pages || []).forEach((p) => { if (p && p.change === 'added' && p.id) addedEarlier.pages.add(p.id); });
    (sp.flows || []).forEach((f) => { if (f && f.change === 'added' && f.id) addedEarlier.flows.add(f.id); });
    (sp.backend || []).forEach((m) => { if (m && m.change === 'added' && m.id) addedEarlier.backend.add(m.id); });
  };
  recordAdded(firstSpec);
  for (let i = 1; i < nums.length; i++) {
    const sp = byVer.get(nums[i]);
    const b = extractSpecSide(sp, 'before');
    b.pages.forEach((p) => { if (p.id && !seenPage.has(p.id) && !addedEarlier.pages.has(p.id)) { v0.pages.push(p); seenPage.add(p.id); } });
    b.flows.forEach((f) => { if (f.id && !seenFlow.has(f.id) && !addedEarlier.flows.has(f.id)) { v0.flows.push(f); seenFlow.add(f.id); } });
    b.backend.forEach((m) => { if (m.id && !seenBe.has(m.id) && !addedEarlier.backend.has(m.id)) { v0.backend.push(m); seenBe.add(m.id); } });
    recordAdded(sp);
  }
  const out = [{ version: 0, note: '改动前现状', stage: 'baseline', spec: v0 }];
  for (const v of nums) {
    const sp = byVer.get(v);
    out.push({ version: v, note: sp.versionNote ? String(sp.versionNote) : '', stage: sp.stage || 'prototype', spec: extractSpecSide(sp, 'after') });
  }
  return out;
}

/* Zero-token project theme extraction: find the target repo's globals.css / index.css and map :root
 * semantic tokens (--background, --primary, --card, --border, --radius…) onto --ui-* prototype vars. */
function findProjectRoot(fromDir) {
  let d = fromDir;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(d, '.smyw'))) return d;
    if (existsSync(join(d, 'package.json')) || existsSync(join(d, '.git'))) return d;
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}
function normCssVal(key, raw) {
  const v = String(raw || '').trim().replace(/\s*!important\s*$/, '');
  if (!v || /var\(/i.test(v)) return null;
  if (key !== 'radius' && key !== 'font-sans' && key !== 'font-mono' && /^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%(\s*\/\s*[\d.%]+)?$/.test(v)) return 'hsl(' + v + ')';
  return v;
}
function extractProjectTheme(specFile, specObj) {
  const TOKEN_MAP = {
    background: '--ui-bg', foreground: '--ui-fg', card: '--ui-card', 'card-foreground': '--ui-card-fg',
    primary: '--ui-primary', 'primary-foreground': '--ui-primary-fg',
    secondary: '--ui-secondary', 'secondary-foreground': '--ui-secondary-fg',
    muted: '--ui-muted', 'muted-foreground': '--ui-muted-fg',
    destructive: '--ui-destructive', border: '--ui-border', input: '--ui-input', ring: '--ui-ring',
    radius: '--ui-radius', 'font-sans': '--ui-font', 'font-mono': '--ui-mono'
  };
  const found = {};
  let source = null;
  const root = findProjectRoot(dirname(specFile));
  if (root) {
    const cands = ['src/app/globals.css', 'app/globals.css', 'src/index.css', 'src/globals.css', 'src/styles/globals.css', 'styles/globals.css', 'src/App.css', 'src/main.css'];
    for (const rel of cands) {
      const fp = join(root, rel);
      if (!existsSync(fp)) continue;
      let text = '';
      try { text = readFileSync(fp, 'utf8'); } catch { continue; }
      const rawVars = {};
      const rootRe = /:root\s*\{([^}]+)\}/g;
      let m;
      while ((m = rootRe.exec(text)) !== null) {
        const declRe = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
        let d;
        while ((d = declRe.exec(m[1])) !== null) rawVars[d[1]] = d[2].trim();
      }
      // Resolve simple var(--other) references within the same :root
      const resolveVar = (val, depth = 0) => {
        if (depth > 4) return val;
        return String(val).replace(/var\(--([a-zA-Z0-9-]+)\)/g, (all, k) => (rawVars[k] ? resolveVar(rawVars[k], depth + 1) : all));
      };
      let count = 0;
      for (const [k, uiVar] of Object.entries(TOKEN_MAP)) {
        if (!rawVars[k]) continue;
        const nv = normCssVal(k, resolveVar(rawVars[k]));
        if (nv) { found[uiVar] = nv; count++; }
      }
      if (count >= 3) { source = relative(root, fp); break; }
    }
  }
  if (specObj && specObj.theme && typeof specObj.theme === 'object' && !Array.isArray(specObj.theme)) {
    const alias = { bg: 'background', fg: 'foreground', text: 'foreground', accent: 'primary' };
    for (const [k, val] of Object.entries(specObj.theme)) {
      const tk = alias[k] || k;
      if (TOKEN_MAP[tk] && val != null && String(val).trim()) { found[TOKEN_MAP[tk]] = String(val).trim(); source = source ? source + ' + spec.theme' : 'spec.theme'; }
    }
  }
  const entries = Object.entries(found);
  if (!entries.length) return { css: '', source: null };
  return { css: '/* project theme */\n:root{' + entries.map(([k, v]) => k + ':' + v).join(';') + '}', source };
}

function validate(spec) {
  const errors = [], warnings = [];
  const z = () => ({ added: 0, removed: 0, modified: 0 });
  const cnt = { pages: z(), nodes: z(), steps: z(), be: z() };
  const bump = (b, o) => { if (o && b[o.change] !== undefined) b[o.change]++; };
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return { errors: ['spec 顶层必须是 JSON 对象'], warnings, summary: '' };
  if (!spec.title) warnings.push('缺少 title（预览标题）');
  if (spec.versionNote != null && typeof spec.versionNote !== 'string') errors.push('versionNote 必须是字符串（这一版的简短说明）');
  if (spec.stage && !['prototype', 'implementing', 'done'].includes(spec.stage)) warnings.push('stage 应为 prototype / implementing / done，收到 "' + spec.stage + '"');
  for (const k of ['pages', 'flows', 'backend', 'changes', 'questions']) if (spec[k] !== undefined && !Array.isArray(spec[k])) errors.push(k + ' 必须是数组');
  const ids = new Map();
  const iaRefs = [];
  let buiCount = 0;
  const reg = (o, where) => {
    if (o.id == null) return;
    const k = String(o.id);
    if (ids.has(k)) errors.push('重复的 id "' + k + '"：' + ids.get(k) + ' 与 ' + where + '（id 在整个 spec 内必须唯一）');
    else ids.set(k, where);
  };
  const chk = (o, where) => {
    if (o.change != null && !CHANGES.has(o.change)) errors.push(where + '：change 只能是 added / removed / modified / unchanged，收到 "' + o.change + '"');
    if (o.before != null && (typeof o.before !== 'object' || Array.isArray(o.before))) errors.push(where + '：before 必须是对象（旧字段值）');
    if (o.before && o.change !== 'modified' && o.change !== 'removed') warnings.push(where + '：写了 before 但 change 不是 modified，左侧仍会按 before 显示');
    if (o.change === 'modified' && !o.before && !o.note) warnings.push(where + '：change=modified 但既没有 before 也没有 note，用户看不出改了什么');
  };
  const pages = Array.isArray(spec.pages) ? spec.pages : [];
  for (const p of pages) {
    const pw = '页面「' + (p.name || p.id || '?') + '」';
    if (!p || typeof p !== 'object') { errors.push('pages 里有非对象元素'); continue; }
    reg(p, pw); chk(p, pw); bump(cnt.pages, p);
    if (!p.root || typeof p.root !== 'object') { errors.push(pw + '：缺少 root 节点'); continue; }
    const pageIds = new Set(), triggers = [], moves = [], placeholders = [];
    if (p.width != null && !(Number(p.width) >= 320)) warnings.push(pw + '：width 应为画布宽度像素（≥ 320），默认 1280');
    const walk = (n, parent, where0) => {
      if (!n || typeof n !== 'object' || Array.isArray(n)) { errors.push(where0 + '：children 里有非对象元素'); return; }
      const where = pw + ' › ' + (n.label || n.type || '?') + (n.id ? ' #' + n.id : '');
      reg(n, where); chk(n, where); if (n !== p.root) bump(cnt.nodes, n);
      if (n.id != null) pageIds.add(String(n.id)); else warnings.push(where + '：没有 id（会自动生成，但反馈里引用不稳定，建议补上）');
      if (n.type && !TYPES.has(n.type)) warnings.push(where + '：未知组件类型 "' + n.type + '"，将按通用方框显示');
      if (n.type && BUI_COMPONENTS[n.type]) buiCount++;
      if (n.before && n.before.children) errors.push(where + '：before 里不能放 children；子元素的增删请标在子元素自己身上');
      if (n.children !== undefined && !Array.isArray(n.children)) errors.push(where + '：children 必须是数组');
      if (parent && parent.change === 'removed' && n.change === 'added') warnings.push(where + '：父元素被删除，子元素却标为新增，右侧不会显示它');
      if (parent && parent.change === 'added' && n.change === 'removed') warnings.push(where + '：父元素是新增的，子元素却标为删除，左侧不会显示它');
      if (n.trigger != null && !(typeof n.trigger === 'string' || (Array.isArray(n.trigger) && n.trigger.every((x) => typeof x === 'string')))) errors.push(where + '：trigger 必须是元素 id 字符串，或 id 数组（多个按钮打开同一个弹层）');
      for (const t of n.trigger == null ? [] : (Array.isArray(n.trigger) ? n.trigger : [n.trigger])) triggers.push([String(t), where]);
      if (n.trigger && !OVERLAY.has(n.type)) warnings.push(where + '：只有弹层（modal / drawer / popover / menu，或 Base UI 的 Dialog / Drawer / Popover / Menu / Tooltip / Toast）才需要 trigger');
      if (n.movedFrom) moves.push([String(n.movedFrom), where, 'movedFrom']);
      if (n.movedTo) moves.push([String(n.movedTo), where, 'movedTo']);
      if (n.movedFrom && n.change !== 'added') warnings.push(where + '：有 movedFrom 的元素应标为 change=added');
      if (n.movedTo && n.change !== 'removed') warnings.push(where + '：有 movedTo 的元素应标为 change=removed');
      for (const key of ['items', 'columns']) if (n[key] !== undefined && !Array.isArray(n[key])) errors.push(where + '：' + key + ' 必须是数组');
      if (n.on !== undefined) {
        if (!Array.isArray(n.on)) errors.push(where + '：on 必须是数组，如 [{ "action": "open", "target": "xxx" }]');
        else n.on.forEach((x) => {
          const act = x && (x.action || x.do);
          if (!act || !IA_ACTIONS.has(act)) errors.push(where + '：on 的 action 只能是 open / close / navigate / toggle / show / hide / state / back，收到 "' + act + '"');
          else if (['open', 'navigate', 'toggle', 'show', 'hide'].includes(act) && !x.target) errors.push(where + '：action ' + act + ' 需要 target');
          if (x && x.target) iaRefs.push([String(x.target), act, where, x.state]);
          if (act === 'state' && !x.target) iaRefs.push([String(n.id), act, where, x.state]);
        });
      }
      if (n.hidden !== undefined && typeof n.hidden !== 'boolean') errors.push(where + '：hidden 必须是 true / false');
      if (n.states !== undefined && (!n.states || typeof n.states !== 'object' || Array.isArray(n.states))) errors.push(where + '：states 必须是对象，如 { "done": { "label": "已验收" } }');
      if (n.state != null && !(n.states && n.states[n.state])) warnings.push(where + '：state "' + n.state + '" 不在 states 里');
      if (!n.on && !n.hidden && !n.states && /点了.{0,8}才|点击后.{0,4}出现|才出现|点不开|可折叠|点开看/.test(String(n.label || '') + String(n.text || ''))) warnings.push(where + '：文字里在描述交互（「…才出现」「点不开」「可折叠」），改用 on / hidden / states，用户在「▶ 演示」里就能真的点');
      if (n.component != null && typeof n.component !== 'string') errors.push(where + '：component 必须是字符串（代码里的组件名 / 文件）');
      if (n.type === 'placeholder' && /不变|同上|其余|省略/.test(String(n.label || ''))) placeholders.push(where);
      (Array.isArray(n.children) ? n.children : []).forEach((c) => walk(c, n, where));
    };
    walk(p.root, null, pw);
    if (p.overlays !== undefined && !Array.isArray(p.overlays)) errors.push(pw + '：overlays 必须是数组');
    (Array.isArray(p.overlays) ? p.overlays : []).forEach((o) => {
      walk(o, null, pw + ' › 弹层');
      const optionalTrigger = o && BUI_COMPONENTS[o.type] && BUI_COMPONENTS[o.type].optionalTrigger;
      if (o && o.type && !OVERLAY.has(o.type)) warnings.push(pw + ' › 弹层 #' + o.id + '：overlays 里的元素通常是 modal / drawer / popover / menu 或 Base UI 的 Dialog / Drawer / Popover / Menu / Tooltip');
      if (o && !optionalTrigger && (!o.trigger || (Array.isArray(o.trigger) && !o.trigger.length))) warnings.push(pw + ' › 弹层「' + (o.label || o.id) + '」：没有 trigger，用户看不出它由哪个按钮打开');
    });
    for (const [t, where] of triggers) if (!pageIds.has(t)) iaRefs.push([t, 'trigger', where]);
    if (placeholders.length) warnings.push(pw + '：有 ' + placeholders.length + ' 个「（不变）」占位框。没改动的模块也要画成真实模块：写它在界面上的名字 + component，不展开 children 即可（会显示「内容不变，未展开」）');
    if (!JSON.stringify(p.root).includes('"component"')) warnings.push(pw + '：没有任何节点写 component。顶层区域（侧栏、主栏、面板…）请标上代码里的组件名，用户才能把框和真实模块对上');
    for (const [t, where, k] of moves) if (!pageIds.has(t)) warnings.push(where + '：' + k + ' "' + t + '" 在本页面找不到');
  }
  const flows = Array.isArray(spec.flows) ? spec.flows : [];
  const allNodeIds = new Set();
  const nodeById = new Map();
  for (const p of pages) { const walk = (n) => { if (n && typeof n === 'object' && n.id != null) nodeById.set(String(n.id), n); if (n && typeof n === 'object') (Array.isArray(n.children) ? n.children : []).forEach(walk); }; walk(p.root); (Array.isArray(p.overlays) ? p.overlays : []).forEach(walk); }
  for (const [t, act, where, st] of iaRefs) {
    if (act === 'navigate') { if (!pages.some((p) => p.id === t)) warnings.push(where + '：navigate 的 target "' + t + '" 不是页面 id'); continue; }
    const tn = nodeById.get(t);
    if (!tn) { warnings.push(where + '：' + (act === 'trigger' ? 'trigger' : act + ' 的 target') + ' "' + t + '" 找不到'); continue; }
    if (act === 'state' && st != null && !(tn.states && tn.states[st])) warnings.push(where + '：目标 #' + t + ' 没有状态 "' + st + '"（先在它的 states 里写上）');
  }
  for (const p of pages) { const walk = (n) => { if (n && typeof n === 'object') { if (n.id != null) allNodeIds.add(String(n.id)); (Array.isArray(n.children) ? n.children : []).forEach(walk); } }; walk(p.root); (Array.isArray(p.overlays) ? p.overlays : []).forEach(walk); }
  for (const f of flows) {
    const fw = '流程「' + (f.name || f.id || '?') + '」';
    reg(f, fw); chk(f, fw);
    if (!Array.isArray(f.steps)) { errors.push(fw + '：steps 必须是数组'); continue; }
    for (const s of f.steps) {
      const sw = fw + ' › 步骤「' + (s.text || s.id || '?') + '」';
      reg(s, sw); chk(s, sw); bump(cnt.steps, s);
      if (s.actor && !ACTORS.has(s.actor)) warnings.push(sw + '：actor "' + s.actor + '" 不是常用值（user / frontend / backend / db / external / system），会作为自定义泳道显示');
      if (s.page && !pages.some((p) => p.id === s.page)) warnings.push(sw + '：page "' + s.page + '" 不存在');
      for (const ref of s.node == null ? [] : (Array.isArray(s.node) ? s.node : [s.node])) if (!allNodeIds.has(String(ref))) warnings.push(sw + '：node "' + ref + '" 在页面里找不到');
    }
  }
  const backend = Array.isArray(spec.backend) ? spec.backend : [];
  for (const m of backend) {
    const mw = '后端模块「' + (m.name || m.id || '?') + '」';
    reg(m, mw); chk(m, mw); bump(cnt.be, m);
    if (m.items !== undefined && !Array.isArray(m.items)) { errors.push(mw + '：items 必须是数组'); continue; }
    for (const it of m.items || []) { const iw = mw + ' › ' + (it.name || it.id || '?'); reg(it, iw); chk(it, iw); bump(cnt.be, it); }
  }
  const f = (b) => '+' + b.added + ' −' + b.removed + ' ~' + b.modified;
  const summary = '· 页面 ' + pages.length + '（' + f(cnt.pages) + '）· 界面元素变化 ' + f(cnt.nodes) + ' · 流程 ' + flows.length + '（步骤 ' + f(cnt.steps) + '）· 后端 ' + backend.length + ' 个模块（' + f(cnt.be) + '）' + (buiCount ? ' · Base UI 组件 ' + buiCount : '');
  if (!pages.length && !flows.length && !backend.length) warnings.push('spec 里没有 pages / flows / backend，预览将是空的');
  return { errors, warnings, summary };
}
