/* smyw runtime.
 * Renders a change spec as before/after wireframes, flow swimlanes and backend modules,
 * lets the user edit the proposal in place, and exports structured feedback for the agent.
 * The spec is a "merged tree": every node carries change = added | removed | modified | unchanged.
 * The before side hides added nodes and applies node.before overrides; the after side hides removed nodes. */
(() => {
'use strict';

const BT = '\u0060';
const FENCE = BT + BT + BT;

// ------------------------------------------------------------------ vocabulary
const TYPE_LABEL = {
  page: '页面', section: '区块', row: '横排', col: '竖排', grid: '网格', card: '卡片', form: '表单',
  list: '列表', item: '列表项', nav: '导航', tabs: '标签页', header: '页头', footer: '页脚',
  sidebar: '侧栏', toolbar: '工具栏', panel: '面板', group: '分组',
  modal: '弹窗', drawer: '抽屉', popover: '气泡浮层', menu: '下拉菜单',
  button: '按钮', link: '链接', input: '输入框', textarea: '多行输入', select: '下拉框',
  checkbox: '复选框', radio: '单选组', toggle: '开关', upload: '上传',
  heading: '标题', text: '文本', image: '图片', table: '表格', chart: '图表', stat: '数值',
  badge: '徽标', tag: '标签', icon: '图标', divider: '分割线', placeholder: '占位'
};
const TYPE_ORDER = Object.keys(TYPE_LABEL);
const CONTAINER = new Set(['page', 'section', 'row', 'col', 'grid', 'card', 'form', 'list', 'item', 'nav', 'tabs', 'header', 'footer', 'sidebar', 'toolbar', 'panel', 'group', 'modal', 'drawer', 'popover', 'menu']);
const ROW_TYPES = new Set(['row', 'nav', 'toolbar', 'header', 'footer', 'item']);
const OVERLAY = new Set(['modal', 'drawer', 'popover', 'menu']);
const INLINE = new Set(['button', 'link', 'badge', 'tag', 'icon', 'checkbox', 'toggle']);
const ITEMS_TYPES = new Set(['nav', 'tabs', 'list', 'select', 'radio', 'menu']);
const USES_TEXT = new Set(['input', 'textarea', 'select', 'stat', 'upload']);
const TRIGGER_TYPES = new Set(['button', 'link', 'icon', 'item', 'tag', 'badge', 'text', 'image', 'heading']);
const CHANGE_LABEL = { added: '新增', removed: '删除', modified: '修改', unchanged: '不变' };
const CHANGES = new Set(Object.keys(CHANGE_LABEL));
const ACTORS = { user: '用户', frontend: '前端', backend: '后端', db: '数据库', external: '外部服务', system: '系统/任务' };
const MOD_KINDS = { module: '模块', service: '服务', controller: '控制器', api: '接口组', model: '数据模型', table: '数据表', store: '前端状态', component: '前端组件', job: '定时任务', config: '配置', other: '其他' };
const BE_KINDS = { api: 'API', function: '函数', method: '方法', model: '模型', field: '字段', table: '表', column: '列', job: '任务', event: '事件', config: '配置', state: '状态', other: '其他' };
const STAGES = { prototype: '原型阶段 · 尚未实现', implementing: '实现中', done: '已实现 · 回顾' };
const AREAS = { frontend: '前端', backend: '后端', data: '数据', api: '接口', flow: '流程', other: '其他' };
const CATS = ['位置/布局', '交互方式', '组件类型', '样式/风格', '文案', '功能缺失', '功能多余', '数据/字段', '流程/逻辑', '接口/后端', '其他'];
const SEVS = ['必须改', '建议', '疑问'];
const STYLE_TAGS = ['整体风格不符', '和现有页面不统一', '配色', '信息密度过高', '信息密度过低', '层级/导航不清', '交互方式不对', '文案语气', '移动端适配'];
const PALETTE = [
  ['容器', ['section', 'row', 'card', 'form', 'list', 'item', 'tabs', 'toolbar']],
  ['浮层', ['modal', 'drawer', 'menu', 'popover']],
  ['控件', ['button', 'link', 'input', 'textarea', 'select', 'checkbox', 'radio', 'toggle', 'upload']],
  ['展示', ['heading', 'text', 'table', 'image', 'chart', 'stat', 'badge', 'tag', 'icon', 'divider', 'placeholder']]
];
const VARIANTS = [['', '默认'], ['primary', '主要'], ['secondary', '次要'], ['danger', '危险'], ['ghost', '文字/幽灵'], ['icon', '仅图标']];
const WIDTHS = [['', '自动'], ['1/4', '1/4'], ['1/3', '1/3'], ['1/2', '1/2'], ['2/3', '2/3'], ['3/4', '3/4'], ['full', '整行']];
const LAYOUTS = [['', '默认'], ['col', '纵向'], ['row', '横向'], ['grid', '网格']];
const STEP_KINDS = [['', '普通步骤'], ['decision', '判断/分支'], ['note', '备注']];
const FIELD_LABEL = { label: '文字', type: '类型', text: '说明', fn: '函数/行为', variant: '样式', w: '宽度', layout: '排列', cols: '列数', items: '选项', columns: '表格列', trigger: '触发按钮', name: '名称', route: '路由', note: '说明', actor: '执行方', kind: '类型', page: '关联页面', rows: '行数' };
const SKIP_COPY = new Set(['id', 'before', 'change', 'children', 'movedFrom', 'movedTo', '_um']);

// ------------------------------------------------------------------ small utils
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  let value;
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') { if (typeof v === 'string') el.style.cssText = v; else Object.assign(el.style, v); }
    else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') value = v;
    else if (k === 'checked' || k === 'draggable' || k === 'disabled') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  if (value !== undefined) el.value = value;
  return el;
}
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
function hash(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(36); }
function short(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); n = n || 24; return s.length > n ? s.slice(0, n - 1) + '…' : s; }
/* Storage may be blocked (e.g. a sandboxed preview iframe with an opaque origin). */
const STORAGE_OK = (() => { try { const k = 'smyw:probe'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch (e) { return false; } })();
function readJSON(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
function itemText(x) { return x && typeof x === 'object' ? String(x.label == null ? '' : x.label) : String(x); }
function btn(label, onclick, cls, title) { return h('button', { class: cls || null, title: title || null, onclick: (e) => { e.stopPropagation(); onclick(e); } }, label); }

// ------------------------------------------------------------------ state
const RAW = document.getElementById('smyw-spec').textContent;
const BASE = JSON.parse(RAW);
const KEY = 'smyw:' + hash(RAW);
let S = loadState() || freshState();
let undoStack = [];
let redoStack = [];
const uiSaved = readJSON(KEY + ':ui') || {};
const ui = { tab: ['canvas', 'flows', 'backend', 'feedback'].indexOf(uiSaved.tab) >= 0 ? uiSaved.tab : 'canvas', page: uiSaved.page, mode: 'view', sel: null, unit: null, cam: null, showFn: false, showComp: false, fade: false, space: false, panMoved: false, overlayOpen: null, includeSpec: true, confirmReset: false, toast: null };
if (!pageById(ui.page)) { const first = S.spec.pages.find((p) => pageStatus(p) !== 'unchanged') || S.spec.pages[0]; ui.page = first ? first.id : null; }
let drag = null;
let dropEl = null;
let toastTimer = 0;

function freshState() { return { spec: normalize(clone(BASE)), ops: [], comments: [], global: { tags: [], text: '', ref: '' }, answers: {}, approved: false, seq: 0 }; }
function loadState() { const s = readJSON(KEY); return s && s.spec && Array.isArray(s.ops) && Array.isArray(s.comments) ? s : null; }
function save() { writeJSON(KEY, S); writeJSON(KEY + ':ui', { tab: ui.tab, page: ui.page }); }

function normalize(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) spec = {};
  if (!spec.title) spec.title = '未命名变更';
  if (spec.version == null) spec.version = 1;
  if (!Object.prototype.hasOwnProperty.call(STAGES, spec.stage)) spec.stage = 'prototype';
  ['pages', 'flows', 'backend', 'changes', 'questions'].forEach((k) => { if (!Array.isArray(spec[k])) spec[k] = []; });
  const seen = new Set();
  let n = 0;
  const fixId = (o, pre) => { let id = o.id == null ? '' : String(o.id); if (!id || seen.has(id)) { do { id = pre + (++n); } while (seen.has(id)); } o.id = id; seen.add(id); };
  const fixChange = (o) => { if (!CHANGES.has(o.change)) o.change = 'unchanged'; };
  const fixNode = (o) => { fixId(o, 'n'); fixChange(o); if (!Array.isArray(o.children)) delete o.children; if (!o.type) o.type = o.children && o.children.length ? 'section' : 'text'; (o.children || []).forEach(fixNode); };
  spec.pages.forEach((p) => { fixId(p, 'page-'); fixChange(p); if (!p.name) p.name = p.id; if (!p.root || typeof p.root !== 'object') p.root = { type: 'page', children: [] }; if (!p.root.type) p.root.type = 'page'; fixNode(p.root); if (!Array.isArray(p.overlays)) p.overlays = []; p.overlays.forEach(fixNode); });
  spec.flows.forEach((f) => { fixId(f, 'flow-'); fixChange(f); if (!f.name) f.name = f.id; if (!Array.isArray(f.steps)) f.steps = []; f.steps.forEach((s) => { fixId(s, 's'); fixChange(s); if (!s.actor) s.actor = 'frontend'; }); });
  spec.backend.forEach((m) => { fixId(m, 'mod-'); fixChange(m); if (!m.name) m.name = m.id; if (!Array.isArray(m.items)) m.items = []; m.items.forEach((i) => { fixId(i, 'b'); fixChange(i); }); });
  return spec;
}

// ------------------------------------------------------------------ model helpers
function pageById(id) { return S.spec.pages.find((p) => p.id === id); }
function flowById(id) { return S.spec.flows.find((f) => f.id === id); }
function curPage() { return pageById(ui.page) || S.spec.pages[0]; }
function entries(p) { const out = []; const walk = (n, par, list) => { out.push({ n: n, par: par, list: list }); (n.children || []).forEach((c) => walk(c, n, n.children)); }; walk(p.root, null, null); p.overlays.forEach((o) => walk(o, null, p.overlays)); return out; }
function findNode(p, id) { return entries(p).find((e) => e.n.id === id) || null; }
function contains(a, b) { return a === b || (a.children || []).some((c) => contains(c, b)); }
function isCont(n) { return CONTAINER.has(n.type) || !!(n.children && n.children.length); }
function afterVisibleIds(p) { const s = new Set(); const walk = (n) => { if (n.change === 'removed') return; s.add(n.id); (n.children || []).forEach(walk); }; walk(p.root); p.overlays.forEach(walk); return s; }
function parentChain(p, id) { let chain = null; const walk = (n, path) => { if (n.id === id) { chain = path; return true; } return (n.children || []).some((c) => walk(c, path.concat([n]))); }; if (!walk(p.root, [])) p.overlays.some((o) => walk(o, [])); return chain || []; }
function findBe(id) { for (const m of S.spec.backend) { if (m.id === id) return { m: m, item: null }; const it = m.items.find((i) => i.id === id); if (it) return { m: m, item: it }; } return null; }
function visible(o, side) { return !(side === 'before' && o.change === 'added') && !(side === 'after' && o.change === 'removed'); }
function view(o, side) {
  if (side !== 'before' || !o.before) return o;
  const v = Object.assign({}, o);
  Object.keys(o.before).forEach((k) => { if (isEmpty(o.before[k])) delete v[k]; else v[k] = o.before[k]; });
  return v;
}
function nodeChanged(p) { return entries(p).some((e) => e.n.change !== 'unchanged'); }
function pageStatus(p) { return p.change !== 'unchanged' ? p.change : (nodeChanged(p) ? 'modified' : 'unchanged'); }
function flowStatus(f) { return f.change !== 'unchanged' ? f.change : (f.steps.some((s) => s.change !== 'unchanged') ? 'modified' : 'unchanged'); }
function modStatus(m) { return m.change !== 'unchanged' ? m.change : (m.items.some((s) => s.change !== 'unchanged') ? 'modified' : 'unchanged'); }

function allIds() { const s = new Set(); S.spec.pages.forEach((p) => { s.add(p.id); entries(p).forEach((e) => s.add(e.n.id)); }); S.spec.flows.forEach((f) => { s.add(f.id); f.steps.forEach((x) => s.add(x.id)); }); S.spec.backend.forEach((m) => { s.add(m.id); m.items.forEach((x) => s.add(x.id)); }); return s; }
function newId() { const ids = allIds(); let id; do { S.seq = (S.seq || 0) + 1; id = 'u' + S.seq; } while (ids.has(id)); return id; }

/* Record a field edit while keeping the merged-tree semantics: the first edit of an existing
 * element remembers the old value in before{} and marks it modified; editing back reverts. */
function setField(o, field, val) {
  if (isEmpty(val)) val = null;
  const old = isEmpty(o[field]) ? null : o[field];
  if (same(old, val)) return false;
  if (val === null) delete o[field]; else o[field] = val;
  if (o.change === 'added' || o.change === 'removed') return true;
  if (!o.before) o.before = {};
  if (!Object.prototype.hasOwnProperty.call(o.before, field)) o.before[field] = old;
  if (same(isEmpty(o.before[field]) ? null : o.before[field], val)) delete o.before[field];
  if (!Object.keys(o.before).length) { delete o.before; if (o._um) { o.change = 'unchanged'; delete o._um; } }
  else if (o.change === 'unchanged') { o.change = 'modified'; o._um = 1; }
  return true;
}
/* Turn an element (and its subtree) into its pre-change shape; used for the "moved out" ghost. */
function toBeforeState(o) {
  if (o.before) { Object.keys(o.before).forEach((k) => { if (isEmpty(o.before[k])) delete o[k]; else o[k] = o.before[k]; }); delete o.before; }
  delete o._um; delete o.movedFrom;
  if (o.children) o.children = o.children.filter((c) => c.change !== 'added').map((c) => { toBeforeState(c); c.change = 'unchanged'; return c; });
  return o;
}
/* Deep copy of the after-state with fresh ids, marked added. */
function afterClone(o, map) {
  if (o.change === 'removed') return null;
  const c = { id: newId() };
  if (map) map[o.id] = c.id;
  Object.keys(o).forEach((k) => { if (!SKIP_COPY.has(k)) c[k] = clone(o[k]); });
  c.change = 'added';
  if (o.children) c.children = o.children.map((x) => afterClone(x, map)).filter(Boolean);
  return c;
}
/* trigger may be one id or an array of ids (several buttons open the same overlay). */
function trigList(v) { const t = v && v.trigger; return t == null || t === '' ? [] : (Array.isArray(t) ? t : [t]).map(String); }
function trigValue(list) { return !list.length ? null : list.length === 1 ? list[0] : list; }
function remapTriggers(p, map) { const vis = afterVisibleIds(p); entries(p).forEach((e) => { const n = e.n; const l = trigList(n); if (vis.has(n.id) && l.some((t) => map[t])) setField(n, 'trigger', trigValue(l.map((t) => map[t] || t))); }); }
function clearTriggers(p, ids) { const vis = afterVisibleIds(p); entries(p).forEach((e) => { const l = trigList(e.n); if (vis.has(e.n.id) && l.some((t) => ids.has(t))) setField(e.n, 'trigger', trigValue(l.filter((t) => !ids.has(t)))); }); }
function insertAt(tgt, node, pos) {
  if (!tgt.list || (pos === 'inside' && isCont(tgt.n))) { if (!tgt.n.children) tgt.n.children = []; tgt.n.children.push(node); return; }
  const i = tgt.list.indexOf(tgt.n);
  tgt.list.splice(pos === 'before' ? i : i + 1, 0, node);
}

// ------------------------------------------------------------------ labels
function tname(t) { return TYPE_LABEL[t] || t || '元素'; }
function nlabel(n) { const s = short(n.label || n.text || n.fn || '', 20); return tname(n.type) + (s ? '「' + s + '」' : ''); }
function ref(n) { return nlabel(n) + ' #' + n.id; }
function pageName(p) { return (p && p.name) || (p && p.id) || ''; }
function stepLabel(s) { return '「' + short(s.text || s.fn || s.id, 24) + '」'; }
function locText(p, e) { if (e.list === p.overlays) return '弹层区'; if (!e.par) return '页面'; return e.par === p.root ? '页面顶层' : nlabel(e.par) + '内'; }
function relText(n, pos) { if (pos === 'inside' && isCont(n)) return nlabel(n) + '内部'; return nlabel(n) + (pos === 'before' ? '前面' : '后面'); }
function pathText(p, n, side) { const chain = parentChain(p, n.id).filter((x) => x !== p.root); return chain.map((x) => nlabel(view(x, side))).concat([nlabel(view(n, side))]).join(' › '); }
function optLabel(list, v) { const f = list.find((x) => x[0] === v); return f ? f[1] : v; }
function fmtVal(field, v) {
  if (isEmpty(v)) return '（空）';
  if (field === 'type') return tname(v);
  if (field === 'trigger') { const l = Array.isArray(v) ? v : [v]; return l.map((id) => { const f = findNodeAnywhere(id); return f ? nlabel(f.e.n) : '#' + id; }).join('、'); }
  if (field === 'variant') return optLabel(VARIANTS, v);
  if (field === 'w') return optLabel(WIDTHS, String(v));
  if (field === 'layout') return optLabel(LAYOUTS, v);
  if (field === 'actor') return ACTORS[v] || v;
  if (field === 'kind') return BE_KINDS[v] || MOD_KINDS[v] || optLabel(STEP_KINDS, v);
  if (Array.isArray(v)) return '「' + v.map(itemText).join('、') + '」';
  return '「' + short(v, 40) + '」';
}

// ------------------------------------------------------------------ mutations (each returns an op record, null, or false)
function mutate(fn) {
  const snap = JSON.stringify(S);
  let op;
  try { op = fn(); } catch (err) { S = JSON.parse(snap); console.error(err); toast('操作失败：' + err.message, true); return false; }
  if (op === false) { S = JSON.parse(snap); return false; }
  undoStack.push(snap); if (undoStack.length > 300) undoStack.shift();
  redoStack = [];
  if (op && op.desc) { op.ts = new Date().toISOString(); S.ops.push(op); }
  save(); validateSel(); render();
  return true;
}
function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(S)); S = JSON.parse(undoStack.pop()); save(); validateSel(); render(); }
function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(S)); S = JSON.parse(redoStack.pop()); save(); validateSel(); render(); }
function selectNode(pid, id) { ui.sel = { kind: 'node', page: pid, id: id, side: 'after' }; }
function pfx(p) { return '页面「' + pageName(p) + '」：'; }

function makeNode(type) {
  const defaults = { button: '新按钮', heading: '新标题', text: '文本内容', input: '字段名', textarea: '字段名', select: '字段名', placeholder: '其余内容' };
  const n = { id: newId(), type: type, change: 'added' };
  if (type !== 'divider') n.label = defaults[type] || ('新' + tname(type));
  if (CONTAINER.has(type)) n.children = [];
  if (type === 'table') n.columns = ['列 1', '列 2', '列 3'];
  if (ITEMS_TYPES.has(type) && type !== 'list') n.items = ['选项 1', '选项 2'];
  return n;
}
function opMove(pid, id, dest) {
  const p = pageById(pid); if (!p) return false;
  const src = findNode(p, id); if (!src || !src.list) return false;
  let tgt = null;
  if (!dest.overlays) { tgt = findNode(p, dest.targetId); if (!tgt || contains(src.n, tgt.n)) return false; }
  const name = ref(src.n);
  const from = locText(p, src);
  const to = dest.overlays ? '弹层区' : relText(tgt.n, dest.pos);
  let moved;
  if (src.n.change === 'added') { src.list.splice(src.list.indexOf(src.n), 1); moved = src.n; }
  else {
    const map = {};
    moved = afterClone(src.n, map); moved.movedFrom = src.n.id;
    toBeforeState(src.n); src.n.change = 'removed'; src.n.movedTo = moved.id;
    remapTriggers(p, map);
  }
  if (dest.overlays) p.overlays.push(moved); else insertAt(findNode(p, dest.targetId), moved, dest.pos);
  selectNode(pid, moved.id);
  return { type: 'move', page: pid, node: moved.id, origin: id, dest: dest, desc: pfx(p) + '把' + name + '从' + from + '移到' + to };
}
function opSibling(pid, id, dir) {
  const p = pageById(pid); const e = p && findNode(p, id); if (!e || !e.list) return false;
  const vis = afterVisibleIds(p);
  const sibs = e.list.filter((x) => vis.has(x.id));
  const j = sibs.indexOf(e.n) + dir;
  if (j < 0 || j >= sibs.length) return false;
  const name = ref(e.n);
  const op = opMove(pid, id, { targetId: sibs[j].id, pos: dir < 0 ? 'before' : 'after' });
  if (op) op.desc = pfx(p) + '把' + name + (dir < 0 ? '往前' : '往后') + '挪一位（' + (dir < 0 ? '到' : '到') + nlabel(sibs[j]) + (dir < 0 ? '前面' : '后面') + '）';
  return op;
}
function opAdd(pid, type, dest) {
  const p = pageById(pid); if (!p) return false;
  const n = makeNode(type);
  let where;
  if (OVERLAY.has(type) || dest.overlays) { p.overlays.push(n); where = '弹层区'; }
  else if (!dest.targetId) { if (!p.root.children) p.root.children = []; p.root.children.push(n); where = '页面末尾'; }
  else { const t = findNode(p, dest.targetId); if (!t) return false; where = relText(t.n, dest.pos); insertAt(t, n, dest.pos); }
  selectNode(pid, n.id);
  return { type: 'add', page: pid, node: n.id, nodeType: type, desc: pfx(p) + '新增' + tname(type) + ' #' + n.id + '，放在' + where + (OVERLAY.has(type) ? '（需要指定由哪个按钮触发）' : '') };
}
function opDelete(pid, id) {
  const p = pageById(pid); const e = p && findNode(p, id); if (!e || !e.list) return false;
  const name = ref(e.n);
  const ids = new Set(); (function walk(n) { ids.add(n.id); (n.children || []).forEach(walk); })(e.n);
  if (e.n.change === 'added') {
    e.list.splice(e.list.indexOf(e.n), 1);
    if (e.n.movedFrom) { const g = findNode(p, e.n.movedFrom); if (g) delete g.n.movedTo; }
  } else { e.n.change = 'removed'; delete e.n._um; }
  clearTriggers(p, ids);
  if (ui.overlayOpen && ids.has(ui.overlayOpen)) ui.overlayOpen = null;
  ui.sel = null;
  return { type: 'delete', page: pid, node: id, desc: pfx(p) + '删除' + name };
}
function opRestore(pid, id) {
  const p = pageById(pid); const e = p && findNode(p, id); if (!e || e.n.change !== 'removed') return false;
  if (e.n.movedTo) { const m = findNode(p, e.n.movedTo); if (m && m.list && m.n.change === 'added') m.list.splice(m.list.indexOf(m.n), 1); delete e.n.movedTo; }
  e.n.change = e.n.before ? 'modified' : 'unchanged';
  return { type: 'restore', page: pid, node: id, desc: pfx(p) + '恢复' + ref(e.n) + '（取消删除/移动）' };
}
function opDuplicate(pid, id) {
  const p = pageById(pid); const e = p && findNode(p, id); if (!e || !e.list) return false;
  const c = afterClone(e.n, {}); delete c.movedFrom;
  e.list.splice(e.list.indexOf(e.n) + 1, 0, c);
  selectNode(pid, c.id);
  return { type: 'duplicate', page: pid, node: c.id, origin: id, desc: pfx(p) + '复制' + ref(e.n) + ' 为 #' + c.id };
}
/* Inline element -> overlay (modal / drawer / menu / popover) opened by a new button at the old spot. */
function opConvert(pid, id, kind) {
  const p = pageById(pid); const e = p && findNode(p, id); if (!e || !e.list || e.list === p.overlays) return false;
  const label = e.n.label || tname(e.n.type);
  const name = ref(e.n);
  const map = {};
  const content = afterClone(e.n, map);
  const b = { id: newId(), type: 'button', label: kind === 'menu' ? label + ' ▾' : label, change: 'added', fn: 'onClick → 打开' + tname(kind) + '「' + short(label, 16) + '」' };
  const ov = { id: newId(), type: kind, label: label, change: 'added', trigger: b.id, children: [content] };
  // A card/section/form becomes the overlay itself (no "modal > card" double frame).
  const unwrap = ['card', 'section', 'form', 'panel', 'group', 'col'].indexOf(e.n.type) >= 0;
  if (unwrap) { ov.children = content.children || []; if (content.fn) ov.fn = content.fn; if (content.layout) ov.layout = content.layout; }
  const moved = unwrap ? ov : content;
  const idx = e.list.indexOf(e.n);
  if (e.n.change === 'added') {
    if (e.n.movedFrom) { moved.movedFrom = e.n.movedFrom; const g = findNode(p, e.n.movedFrom); if (g) g.n.movedTo = moved.id; }
    e.list.splice(idx, 1, b);
  } else {
    moved.movedFrom = e.n.id;
    toBeforeState(e.n); e.n.change = 'removed'; e.n.movedTo = moved.id;
    e.list.splice(idx + 1, 0, b);
  }
  remapTriggers(p, map);
  p.overlays.push(ov);
  selectNode(pid, b.id);
  return { type: 'convert', page: pid, node: id, kind: kind, overlay: ov.id, trigger: b.id, desc: pfx(p) + '把' + name + '改成' + tname(kind) + ' #' + ov.id + '，原位置放一个按钮「' + b.label + '」#' + b.id + ' 点击后打开（按钮可再拖到别处）' };
}
function opAddPage() {
  const p = { id: newId(), name: '新页面', route: '', change: 'added', root: { id: newId(), type: 'page', change: 'added', children: [] }, overlays: [] };
  S.spec.pages.push(p); ui.page = p.id; ui.sel = { kind: 'page', id: p.id };
  return { type: 'add-page', page: p.id, desc: '新增页面「新页面」#' + p.id };
}
function opDeletePage(pid) {
  const i = S.spec.pages.findIndex((p) => p.id === pid); if (i < 0) return false;
  const p = S.spec.pages[i];
  if (p.change === 'added') { S.spec.pages.splice(i, 1); const nx = S.spec.pages[0]; ui.page = nx ? nx.id : null; } else { p.change = 'removed'; delete p._um; }
  ui.sel = null;
  return { type: 'delete-page', page: pid, desc: '删除页面「' + pageName(p) + '」#' + pid };
}
function opRestorePage(pid) { const p = pageById(pid); if (!p || p.change !== 'removed') return false; p.change = p.before ? 'modified' : 'unchanged'; return { type: 'restore-page', page: pid, desc: '恢复页面「' + pageName(p) + '」' }; }
function opFlowAdd() { const f = { id: newId(), name: '新流程', change: 'added', steps: [] }; S.spec.flows.push(f); ui.sel = { kind: 'flow', id: f.id }; return { type: 'add-flow', flow: f.id, desc: '新增流程「新流程」#' + f.id }; }
function opFlowDelete(fid) { const i = S.spec.flows.findIndex((f) => f.id === fid); if (i < 0) return false; const f = S.spec.flows[i]; if (f.change === 'added') S.spec.flows.splice(i, 1); else { f.change = 'removed'; delete f._um; } ui.sel = null; return { type: 'delete-flow', flow: fid, desc: '删除流程「' + f.name + '」' }; }
function opStepAdd(fid, afterId) {
  const f = flowById(fid); if (!f) return false;
  const prev = afterId ? f.steps.find((s) => s.id === afterId) : null;
  const s = { id: newId(), actor: prev ? prev.actor : 'frontend', text: '新步骤', change: 'added' };
  if (prev) f.steps.splice(f.steps.indexOf(prev) + 1, 0, s); else f.steps.push(s);
  ui.sel = { kind: 'step', id: s.id, side: 'after', flow: fid };
  return { type: 'add-step', flow: fid, step: s.id, desc: '流程「' + f.name + '」：' + (prev ? '在步骤' + stepLabel(prev) + '后' : '末尾') + '新增步骤 #' + s.id };
}
function opStepDelete(fid, id) {
  const f = flowById(fid); const s = f && f.steps.find((x) => x.id === id); if (!s) return false;
  if (s.change === 'added') { f.steps.splice(f.steps.indexOf(s), 1); if (s.movedFrom) { const g = f.steps.find((x) => x.id === s.movedFrom); if (g) delete g.movedTo; } } else { s.change = 'removed'; delete s._um; }
  ui.sel = null;
  return { type: 'delete-step', flow: fid, step: id, desc: '流程「' + f.name + '」：删除步骤' + stepLabel(s) + ' #' + id };
}
function opStepRestore(fid, id) {
  const f = flowById(fid); const s = f && f.steps.find((x) => x.id === id); if (!s || s.change !== 'removed') return false;
  if (s.movedTo) { const m = f.steps.find((x) => x.id === s.movedTo); if (m && m.change === 'added') f.steps.splice(f.steps.indexOf(m), 1); delete s.movedTo; }
  s.change = s.before ? 'modified' : 'unchanged';
  return { type: 'restore-step', flow: fid, step: id, desc: '流程「' + f.name + '」：恢复步骤' + stepLabel(s) };
}
function opStepMove(fid, id, dir) {
  const f = flowById(fid); if (!f) return false;
  const vis = f.steps.filter((s) => visible(s, 'after'));
  const i = vis.findIndex((s) => s.id === id); const j = i + dir;
  if (i < 0 || j < 0 || j >= vis.length) return false;
  const s = vis[i], nb = vis[j];
  let m;
  if (s.change === 'added') { f.steps.splice(f.steps.indexOf(s), 1); m = s; }
  else { m = afterClone(s, null); m.movedFrom = s.id; toBeforeState(s); s.change = 'removed'; s.movedTo = m.id; }
  const k = f.steps.indexOf(nb);
  f.steps.splice(dir < 0 ? k : k + 1, 0, m);
  ui.sel = { kind: 'step', id: m.id, side: 'after', flow: fid };
  return { type: 'move-step', flow: fid, step: m.id, origin: id, desc: '流程「' + f.name + '」：步骤' + stepLabel(m) + (dir < 0 ? '提前到' : '推后到') + stepLabel(nb) + (dir < 0 ? '之前' : '之后') };
}
function opModAdd() { const m = { id: newId(), name: 'NewModule', kind: 'module', change: 'added', items: [] }; S.spec.backend.push(m); ui.sel = { kind: 'be', id: m.id, side: 'after' }; return { type: 'add-module', id: m.id, desc: '后端：新增模块 #' + m.id }; }
function opItemAdd(mid) { const f = findBe(mid); if (!f || f.item) return false; const it = { id: newId(), kind: 'function', name: 'newFunction()', change: 'added' }; f.m.items.push(it); ui.sel = { kind: 'be', id: it.id, side: 'after' }; return { type: 'add-item', id: it.id, module: mid, desc: '后端：模块「' + f.m.name + '」新增条目 #' + it.id }; }
function opBeDelete(id) {
  const f = findBe(id); if (!f) return false;
  const o = f.item || f.m;
  if (o.change === 'added') { if (f.item) f.m.items.splice(f.m.items.indexOf(o), 1); else S.spec.backend.splice(S.spec.backend.indexOf(o), 1); } else { o.change = 'removed'; delete o._um; }
  ui.sel = null;
  return { type: 'delete-be', id: id, desc: '后端：删除' + (f.item ? '模块「' + f.m.name + '」中的「' + o.name + '」' : '模块「' + o.name + '」') + ' #' + id };
}
function opBeRestore(id) { const f = findBe(id); const o = f && (f.item || f.m); if (!o || o.change !== 'removed') return false; o.change = o.before ? 'modified' : 'unchanged'; return { type: 'restore-be', id: id, desc: '后端：恢复「' + o.name + '」' }; }

/* Generic field editor: returns an onCommit(value) handler. */
function editor(resolve, field, ctx) {
  return (raw) => mutate(() => {
    const o = resolve(); if (!o) return false;
    let val = raw;
    if (field === 'items' || field === 'columns') val = String(raw).split('\n').map((s) => s.trim()).filter(Boolean);
    else if (field === 'cols' || field === 'rows') val = raw === '' ? null : (Number(raw) || null);
    else if (field === 'w' && /^\d+(\.\d+)?$/.test(String(raw))) val = Number(raw);
    else if (typeof val === 'string' && field !== 'text' && field !== 'note') val = val.trim();
    const old = o[field];
    const name = ctx.name(o);
    if (!setField(o, field, val)) return false;
    if (field === 'type' && CONTAINER.has(val) && !o.children) o.children = [];
    return { type: 'edit', target: ctx.target, field: field, from: old == null ? null : old, to: isEmpty(val) ? null : val, desc: ctx.prefix() + name + ' 的' + (FIELD_LABEL[field] || field) + '：' + fmtVal(field, old) + ' → ' + fmtVal(field, val) };
  });
}
function addComment(target, category, severity, text) {
  mutate(() => { S.seq = (S.seq || 0) + 1; S.comments.push({ id: 'c' + S.seq, target: target, where: whereOf(target), category: category, severity: severity, text: text, ts: new Date().toISOString() }); return null; });
}
function sameTarget(a, b) { return a.kind === b.kind && a.id === b.id && (a.side || '') === (b.side || ''); }
function whereOf(t) {
  const sideT = t.side === 'before' ? '改动前' : t.side === 'after' ? '改动后' : '';
  if (t.kind === 'node') { const p = pageById(t.page); const e = p && findNode(p, t.id); return '页面「' + (p ? pageName(p) : t.page) + '」› ' + sideT + ' › ' + (e ? pathText(p, e.n, t.side) : '') + ' #' + t.id; }
  if (t.kind === 'page') { const p = pageById(t.id); return '页面「' + (p ? pageName(p) : t.id) + '」（整页）'; }
  if (t.kind === 'flow') { const f = flowById(t.id); return '流程「' + (f ? f.name : t.id) + '」（整个流程）'; }
  if (t.kind === 'step') { const f = flowById(t.flow); const s = f && f.steps.find((x) => x.id === t.id); return '流程「' + (f ? f.name : t.flow) + '」› ' + sideT + ' › 步骤' + (s ? stepLabel(view(s, t.side)) : '') + ' #' + t.id; }
  if (t.kind === 'be') { const f = findBe(t.id); if (!f) return '后端 #' + t.id; return '后端 › ' + sideT + ' › 模块「' + f.m.name + '」' + (f.item ? ' › 「' + f.item.name + '」' : '') + ' #' + t.id; }
  return '整体';
}
function commentCount(kind, id, side) { return S.comments.filter((c) => c.target.kind === kind && c.target.id === id && (c.target.side || '') === (side || '')).length; }
function cbadge(kind, id, side) { const n = commentCount(kind, id, side); return n ? h('span', { class: 'cmt-badge', title: n + ' 条批注' }, '💬' + n) : null; }
function validateSel() {
  const s = ui.sel;
  if (s) {
    let ok = false;
    if (s.kind === 'node') { const p = pageById(s.page); ok = !!(p && findNode(p, s.id)); }
    else if (s.kind === 'page') ok = !!pageById(s.id);
    else if (s.kind === 'flow') ok = !!flowById(s.id);
    else if (s.kind === 'step') { const f = flowById(s.flow); ok = !!(f && f.steps.some((x) => x.id === s.id)); }
    else if (s.kind === 'be') ok = !!findBe(s.id);
    if (!ok) ui.sel = null;
  }
  if (!pageById(ui.page) && S.spec.pages[0]) ui.page = S.spec.pages[0].id;
  if (ui.overlayOpen) { const p = curPage(); const e = p && findNode(p, ui.overlayOpen); if (!e || !afterVisibleIds(p).has(e.n.id)) ui.overlayOpen = null; }
}

// ------------------------------------------------------------------ change marks
/* Colors: added = green, removed = red, modified = yellow. side: before | after | merged (canvas). */
function chgOf(o, side) {
  const c = o.change;
  if (c === 'added' && side !== 'before') return ['added', o.movedFrom ? '移入' : '新增'];
  if (c === 'removed' && side !== 'after') return ['removed', o.movedTo ? '移出' : '删除'];
  if (c === 'modified') return ['modified', side === 'before' ? '修改前' : side === 'after' ? '修改后' : '修改'];
  return null;
}
function chgClass(o, side) { const c = chgOf(o, side); return c ? 'chg chg-' + c[0] + ' side-' + side : ''; }
function chgTag(o, side) { const c = chgOf(o, side); return c ? h('span', { class: 'chg-tag chg-tag-' + c[0] + ' side-' + side }, c[1]) : null; }
function chgChip(change) { return change && change !== 'unchanged' ? h('span', { class: 'chip c-' + change }, CHANGE_LABEL[change]) : null; }

// ------------------------------------------------------------------ change units
/* A unit is the OUTERMOST changed module on a screen: a whole added/removed page, or a changed node whose ancestors are
 * unchanged. Only units get a numbered box on the canvas; everything inside a unit is explained in its detail panel. */
let UNITS = [];
let UNIT_BY = new Map();
function computeUnits() {
  const list = [];
  S.spec.pages.forEach((p) => {
    if (p.change === 'added' || p.change === 'removed') { list.push({ key: p.id, page: p.id, id: p.id, kind: 'page', change: p.change }); return; }
    const walk = (n) => { if (n !== p.root && n.change !== 'unchanged') { list.push({ key: n.id, page: p.id, id: n.id, kind: 'node', change: n.change }); return; } (n.children || []).forEach(walk); };
    walk(p.root); p.overlays.forEach(walk);
  });
  list.forEach((u, i) => { u.n = i + 1; });
  UNITS = list; UNIT_BY = new Map(list.map((u) => [u.key, u]));
  return list;
}
function unitNode(u) { if (!u) return null; const p = pageById(u.page); if (!p) return null; if (u.kind === 'page') return p.root; const e = findNode(p, u.id); return e ? e.n : null; }
function unitOf(pid, id) {
  const p = pageById(pid); if (!p) return null;
  if (p.change === 'added' || p.change === 'removed') return p.id;
  const e = findNode(p, id); if (!e) return null;
  const chain = parentChain(p, id).concat([e.n]).filter((x) => x !== p.root);
  const top = chain.find((x) => x.change !== 'unchanged');
  return top ? top.id : null;
}
function findNodeAnywhere(id) { for (const p of S.spec.pages) { const e = findNode(p, id); if (e) return { p: p, e: e }; } return null; }
function unitTitle(u) {
  const p = pageById(u.page);
  if (u.kind === 'page') return '页面「' + pageName(p) + '」' + (u.change === 'added' ? '（整页新增）' : '（整页删除）');
  const n = unitNode(u); if (!n) return u.id;
  const v = view(n, n.change === 'removed' ? 'before' : 'after');
  let s = nlabel(v);
  if (n.change === 'modified' && n.before && n.before.label && n.before.label !== n.label) s += '（原「' + short(n.before.label, 14) + '」）';
  return s;
}

// ------------------------------------------------------------------ wireframe rendering
function visItems(v, side, key) { return (v[key] || []).filter((x) => !(x && typeof x === 'object') || visible({ change: x.change || 'unchanged' }, side)); }
function itemEl(x, side, cls) {
  if (x && typeof x === 'object') { const c = chgOf({ change: x.change || 'unchanged' }, side); return h('span', { class: cls + (c ? ' chg chg-' + c[0] + ' side-' + side : ''), title: c ? c[1] : null }, itemText(x)); }
  return h('span', { class: cls }, String(x));
}
function itemsStrip(v, side, cls, col) { return h('div', { class: 'wf-items' + (col ? ' col' : '') }, visItems(v, side, 'items').map((x) => itemEl(x, side, cls))); }
function bars(n) { const out = h('div', { class: 'wf-bars' }); for (let i = 0; i < Math.min(Number(n) || 0, 6); i++) out.append(h('i', { style: { width: (92 - (i % 3) * 20) + '%' } })); return out; }
function nodeBody(v, side) {
  const t = v.type, out = [], label = v.label;
  switch (t) {
    case 'heading': out.push(h('div', { class: 'wf-h' }, label || '标题')); break;
    case 'text': out.push(h('div', { class: 'wf-text' }, label || '')); if (v.lines) out.push(bars(v.lines)); break;
    case 'button': case 'link': case 'badge': case 'tag': out.push(h('span', { class: 'wf-lbl' }, label || tname(t))); break;
    case 'icon': out.push(h('span', { class: 'wf-lbl' }, '◎ ' + (label || ''))); break;
    case 'checkbox': out.push(h('span', { class: 'wf-lbl' }, '☐ ' + (label || '复选框'))); break;
    case 'toggle': out.push(h('span', { class: 'wf-lbl' }, h('span', { class: 'wf-toggle' }), ' ' + (label || '开关'))); break;
    case 'radio': if (label) out.push(h('div', { class: 'wf-flabel' }, label)); out.push(h('div', { class: 'wf-items' }, visItems(v, side, 'items').map((x) => h('span', null, '○ ', itemEl(x, side, ''))))); break;
    case 'input': case 'textarea': case 'select': case 'upload':
      if (label) out.push(h('div', { class: 'wf-flabel' }, label));
      out.push(h('div', { class: 'wf-field' + (t === 'textarea' ? ' tall' : '') }, h('span', null, (t === 'upload' ? '⇪ ' : '') + (v.text || '')), t === 'select' ? h('span', null, '▾') : null));
      if (t === 'select' && v.items) out.push(itemsStrip(v, side, 'wf-it'));
      break;
    case 'image': case 'chart': out.push(h('div', { class: 'wf-media ' + t }, h('span', null, t === 'chart' ? '▁▃▅▇▅▃' : '⛶'), h('span', null, label || tname(t)))); break;
    case 'stat': if (v.text) out.push(h('div', { class: 'wf-stat' }, v.text)); out.push(h('div', { class: v.text ? 'wf-sub' : 'wf-stat sm' }, label || '指标')); break;
    case 'table': {
      if (label) out.push(h('div', { class: 'wf-cap' }, label));
      const cols = visItems(v, side, 'columns');
      const tbl = h('div', { class: 'wf-table', style: { gridTemplateColumns: 'repeat(' + Math.max(cols.length, 1) + ', minmax(0, 1fr))' } });
      cols.forEach((c) => tbl.append(itemEl(c, side, 'th')));
      const rows = Number(v.rows) || 2;
      for (let r = 0; r < rows; r++) cols.forEach(() => tbl.append(h('span', { class: 'td' })));
      out.push(tbl);
      break;
    }
    case 'divider': out.push(h('hr')); break;
    case 'placeholder': out.push(h('div', { class: 'wf-ph' }, label || '…')); break;
    default:
      if (label) out.push(h('div', { class: 'wf-cap' }, label));
      if (ITEMS_TYPES.has(t) && v.items) out.push(itemsStrip(v, side, 'wf-it', t === 'list' || t === 'menu'));
  }
  if (v.text && !USES_TEXT.has(t)) out.push(h('div', { class: 'wf-sub' }, v.text));
  if (v.fn) out.push(h('div', { class: 'wf-fn', title: '函数 / 行为占位' }, 'ƒ ' + v.fn));
  return out;
}
function applyWidth(el, w, parentLayout) {
  if (isEmpty(w)) return;
  const row = parentLayout === 'row';
  if (typeof w === 'number') { if (row) el.style.flex = w + ' 1 0'; return; }
  if (w === 'full') { if (row) el.style.flex = '0 0 100%'; else el.style.width = '100%'; return; }
  const m = /^(\d+)\/(\d+)$/.exec(String(w));
  if (m) { const pct = (100 * Number(m[1]) / Number(m[2])).toFixed(2); if (row) { el.style.flex = '0 0 calc(' + pct + '% - 9px)'; el.style.minWidth = '0'; } else el.style.width = pct + '%'; }
}
/* o: { side: before|after|merged, ctx: canvas|detail, parentLayout, whole (inside an added/removed module),
 *      unit (enclosing unit id on the canvas), ghost (rendering a removed subtree inside the merged canvas) } */
function renderWF(n, p, o) {
  const side = o.side;
  let eff = side;
  if (side === 'merged') { if (o.ghost && n.change === 'added') return null; eff = (o.ghost || n.change === 'removed') ? 'before' : 'after'; }
  else if (!visible(n, side)) return null;
  const v = view(n, eff);
  const t = v.type, kids = v.children || [], cont = isCont(v);
  const layout = v.layout || (ROW_TYPES.has(t) ? 'row' : 'col');
  const isRoot = n === p.root;
  const ghost = o.ghost || (side === 'merged' && n.change === 'removed');
  const editing = ui.mode === 'edit' && o.ctx === 'canvas' && !ghost;
  const trig = p.overlays.some((x) => (eff === 'after' ? visible(x, 'after') && trigList(x).includes(n.id) : visible(x, 'before') && trigList(view(x, 'before')).includes(n.id)));
  const c = (o.whole || isRoot) ? null : chgOf(n, side);
  let mark = '', unitHere = null;
  if (c) {
    if (o.ctx === 'canvas' && !o.unit) { mark = 'mk mk-' + c[0] + ' mk-u'; unitHere = n.id; }
    else mark = 'mk mk-' + c[0] + (o.ctx === 'canvas' ? ' mk-inner' : ' mk-d side-' + side);
  }
  const unit = o.unit || unitHere;
  const cls = ['wf', 't-' + t, cont ? 'is-c lay-' + layout : 'is-leaf', INLINE.has(t) ? 'inline' : '', v.variant ? 'v-' + v.variant : '', trig ? 'is-trigger' : '', mark, (unit || o.whole) ? 'in-chg' : ''].filter(Boolean).join(' ');
  const el = h('div', { class: cls, 'data-kind': 'node', 'data-id': n.id, 'data-side': eff, 'data-unit': unit, 'data-partner': n.movedFrom || n.movedTo || null, title: o.ctx === 'canvas' ? (n.note || null) : null });
  applyWidth(el, v.w, o.parentLayout);
  if (layout === 'grid') el.style.setProperty('--cols', String(v.cols || 2));
  if (unitHere) { const u = UNIT_BY.get(n.id); el.append(h('span', { class: 'u-num u-' + c[0] }, String(u ? u.n : '?')), h('span', { class: 'u-tag u-' + c[0] }, c[1])); }
  else if (c && o.ctx === 'detail') el.append(h('span', { class: 'chg-tag chg-tag-' + c[0] + ' side-' + side }, c[1]));
  if (v.component) el.append(h('span', { class: 'wf-comp', title: '代码里对应的组件 / 模块' }, v.component));
  el.append(...nodeBody(v, side));
  if (cont) {
    const box = h('div', { class: 'wf-children' });
    const sub = { side: side, ctx: o.ctx, parentLayout: layout, whole: o.whole || n.change === 'added' || n.change === 'removed', unit: unit, ghost: ghost, depth: (o.depth || 0) + 1 };
    kids.forEach((ch) => { const r = renderWF(ch, p, sub); if (r) box.append(r); });
    if (box.childNodes.length) el.append(box);
    else if (editing && !(ITEMS_TYPES.has(t) && v.items)) { box.append(h('div', { class: 'wf-empty' }, isRoot ? '空页面：把组件从组件库拖到这里' : '拖入组件')); el.append(box); }
    else if (isRoot) { box.append(h('div', { class: 'wf-empty' }, '（空）')); el.append(box); }
    else if (!(ITEMS_TYPES.has(t) && v.items) && !v.text && n.change === 'unchanged' && !o.whole) el.append(h('div', { class: 'wf-same' }, '内容不变，未展开'));
  }
  if (o.ctx === 'detail' && n.note && !isRoot && o.depth && c) el.append(h('div', { class: 'wf-note' }, n.note));
  const b = cbadge('node', n.id, eff); if (b) el.append(b);
  if (editing && !isRoot) el.setAttribute('data-drag', '1');
  return el;
}

// ------------------------------------------------------------------ app shell
function render() {
  computeUnits();
  if (ui.unit && !UNIT_BY.has(ui.unit)) ui.unit = null;
  const app = document.getElementById('app');
  const keepScroll = {};
  ['main', 'inspector', 'cv-list'].forEach((id) => { const el = document.getElementById(id); if (el) keepScroll[id] = el.scrollTop; });
  const ae = document.activeElement;
  const fkey = ae && ae.dataset ? ae.dataset.f : null;
  const canvas = ui.tab === 'canvas';
  const main = h('main', { class: 'main' + (canvas ? ' main-canvas' : ''), id: 'main', onclick: onMainClick, onmouseover: onMainOver }, renderTab());
  app.replaceChildren(...[renderHeader(), renderTabs(), renderBanners(), h('div', { class: 'body' }, main, canvas ? null : renderInspector()), ui.toast ? h('div', { class: 'toast' + (ui.toast.err ? ' err' : '') }, ui.toast.msg) : null].flat().filter(Boolean));
  Object.keys(keepScroll).forEach((id) => { const el = document.getElementById(id); if (el) el.scrollTop = keepScroll[id]; });
  applySel();
  if (canvas) { if (ui.cam) applyCam(); else requestAnimationFrame(() => fitCam(false, true)); requestAnimationFrame(drawLinks); }
  if (fkey) { const el = document.querySelector('[data-f="' + fkey + '"]'); if (el) el.focus(); }
}
function renderHeader() {
  const sp = S.spec;
  const fbCount = S.comments.length + S.ops.length;
  return h('header', { class: 'top' },
    h('h1', null, sp.title),
    h('span', { class: 'stage st-' + sp.stage }, STAGES[sp.stage]),
    h('span', { class: 'ver' }, 'v' + sp.version),
    h('div', { class: 'acts-top' },
      h('div', { class: 'seg' },
        h('button', { class: ui.mode === 'view' ? 'on' : null, onclick: () => setMode('view'), title: '浏览改动、点任意元素写批注' }, '查看 / 批注'),
        h('button', { class: ui.mode === 'edit' ? 'on' : null, onclick: () => setMode('edit'), title: '直接修改方案：拖动、增删、转为弹窗…' }, '编辑方案')),
      h('button', { disabled: !undoStack.length, onclick: undo, title: '撤销 (Ctrl+Z)' }, '↶ 撤销'),
      h('button', { disabled: !redoStack.length, onclick: redo, title: '重做 (Ctrl+Shift+Z)' }, '↷ 重做'),
      h('button', { class: 'primary', onclick: () => setTab('feedback') }, '反馈', fbCount ? h('span', { class: 'cnt' }, String(fbCount)) : null),
      h('button', { class: 'lnk' + (ui.confirmReset ? ' danger' : ''), onclick: resetAll, title: '丢弃所有修改和批注，恢复 Agent 给出的原始方案' }, ui.confirmReset ? '再点一次确认重置' : '重置')));
}
function renderTabs() {
  const sp = S.spec;
  const fc = sp.flows.filter((f) => flowStatus(f) !== 'unchanged').length;
  const bc = sp.backend.filter((m) => modStatus(m) !== 'unchanged').length;
  const tabs = [['canvas', '界面改动', String(UNITS.length)], ['flows', '流程变化', fc + '/' + sp.flows.length], ['backend', '后端变化', bc + '/' + sp.backend.length], ['feedback', '反馈', String(S.comments.length + S.ops.length)]];
  return h('nav', { class: 'tabs' }, tabs.map((t) => h('button', { class: ui.tab === t[0] ? 'on' : null, onclick: () => setTab(t[0]) }, t[1], t[2] ? h('span', { class: 'n' }, t[2]) : null)));
}
function renderBanners() {
  const out = [];
  if (!STORAGE_OK) out.push(h('div', { class: 'banner info' }, '当前预览环境不允许保存进度（例如在沙箱里预览），关闭或刷新后修改会丢失。改完请及时到「反馈」页复制反馈。'));
  if (S.spec.stage === 'prototype') out.push(h('div', { class: 'banner' }, '方案原型（结构线框），还没有写代码。线框只表达「有哪些模块、放在哪、怎么触发」，不代表最终视觉样式。'));
  return out;
}
function renderTab() {
  if (ui.tab === 'flows') return renderFlows();
  if (ui.tab === 'backend') return renderBackend();
  if (ui.tab === 'feedback') return renderFeedback();
  return renderCanvasTab();
}
function setTab(t) { ui.tab = t; save(); render(); }
function setMode(m) { ui.mode = m; if (m === 'edit' && ui.tab === 'feedback') ui.tab = 'canvas'; save(); render(); }
function resetAll() {
  // No confirm(): sandboxed previews block modal dialogs. Ask for a second click instead.
  if (!ui.confirmReset) { ui.confirmReset = true; render(); setTimeout(() => { ui.confirmReset = false; render(); }, 4000); return; }
  ui.confirmReset = false;
  undoStack.push(JSON.stringify(S)); redoStack = [];
  S = freshState(); ui.sel = null; ui.unit = null; save(); render();
}
function toast(msg, err) { ui.toast = { msg: msg, err: !!err }; render(); clearTimeout(toastTimer); toastTimer = setTimeout(() => { ui.toast = null; render(); }, err ? 9000 : 6000); }
function applySel() {
  const s = ui.sel;
  if (s) {
    const q = '[data-kind="' + s.kind + '"][data-id="' + CSS.escape(s.id) + '"]' + (s.side ? '[data-side="' + s.side + '"]' : '');
    document.querySelectorAll('#main ' + q).forEach((el) => el.classList.add('sel'));
  }
  if (ui.unit) {
    const u = UNIT_BY.get(ui.unit);
    const q = u && u.kind === 'page' ? '.cv-frame[data-page="' + CSS.escape(ui.unit) + '"]' : '[data-kind="node"][data-id="' + CSS.escape(ui.unit) + '"]';
    document.querySelectorAll('#cv-world ' + q).forEach((el) => el.classList.add('u-sel'));
    document.querySelectorAll('.cv-item[data-u="' + CSS.escape(ui.unit) + '"]').forEach((el) => el.classList.add('on'));
  }
}
function unitEl(key) {
  const u = UNIT_BY.get(key); if (!u) return null;
  return document.querySelector('#cv-world ' + (u.kind === 'page' ? '.cv-frame[data-page="' + CSS.escape(key) + '"]' : '[data-kind="node"][data-id="' + CSS.escape(key) + '"]'));
}
function scrollToSel() {
  requestAnimationFrame(() => {
    if (ui.tab === 'canvas') { const el = document.querySelector('#cv-world .sel') || (ui.unit && unitEl(ui.unit)); if (el) focusEl(el); return; }
    const el = document.querySelector('#main .sel'); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}
function onMainClick(e) {
  if (ui.panMoved) { ui.panMoved = false; return; }
  if (e.target.closest('button, input, select, textarea, a, label, .pal-item, .palette, .cv-tools')) return;
  const k = e.target.closest('[data-kind]');
  if (!k) { if (ui.sel && ui.tab !== 'canvas') { ui.sel = null; render(); } return; }
  const d = k.dataset;
  const sel = { kind: d.kind, id: d.id };
  if (d.side) sel.side = d.side;
  if (d.flow) sel.flow = d.flow;
  if (d.kind === 'node') {
    const pg = k.closest('[data-page]');
    sel.page = pg ? pg.dataset.page : ui.page;
    ui.page = sel.page;
    if (k.closest('#cv-world')) ui.unit = d.unit || null;
  } else if (d.kind === 'page') {
    ui.page = d.id;
    ui.unit = d.unit || null;
  }
  ui.sel = sel;
  render();
}
function onMainOver(e) {
  document.querySelectorAll('.partner').forEach((x) => x.classList.remove('partner'));
  const k = e.target.closest && e.target.closest('[data-partner]');
  if (k) document.querySelectorAll('#main [data-id="' + CSS.escape(k.dataset.partner) + '"]').forEach((x) => x.classList.add('partner'));
}
function focusUnit(key, opts) {
  computeUnits();
  if (window.innerWidth < 1100) ui.listOpen = false;
  const u = UNIT_BY.get(key); if (!u) return;
  ui.tab = 'canvas'; ui.unit = key; ui.page = u.page;
  ui.sel = u.kind === 'page' ? { kind: 'page', id: u.page } : { kind: 'node', page: u.page, id: u.id, side: u.change === 'removed' ? 'before' : 'after' };
  save(); render();
  if (!opts || opts.zoom !== false) requestAnimationFrame(() => { const el = unitEl(key); if (el) focusEl(el); });
}
function focusNode(pid, id) {
  const p = pageById(pid); const e = p && findNode(p, id); if (!e) return;
  const vis = afterVisibleIds(p);
  ui.tab = 'canvas'; ui.page = pid; ui.unit = unitOf(pid, id);
  ui.sel = { kind: 'node', page: pid, id: id, side: vis.has(id) && p.change !== 'removed' ? 'after' : 'before' };
  save(); render(); scrollToSel();
}

// ------------------------------------------------------------------ canvas: camera
/* Curved connectors on the canvas: trigger element → the overlay (modal / drawer / menu / popover) it opens.
 * Drawn in world coordinates, so they pan and zoom with the canvas. */
const LINK_COLOR = { added: '#18a058', removed: '#e5484d', modified: '#e2a400', unchanged: '#333' };
function drawLinks() {
  const w = worldEl(); if (!w) return;
  const old = document.getElementById('cv-links'); if (old) old.remove();
  const wr = w.getBoundingClientRect(); const k = wr.width / (w.offsetWidth || 1); if (!k) return;
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); Object.keys(attrs).forEach((a) => e.setAttribute(a, attrs[a])); return e; };
  const svg = mk('svg', { id: 'cv-links', class: 'cv-links', width: w.offsetWidth, height: w.offsetHeight });
  const defs = mk('defs', {});
  Object.keys(LINK_COLOR).forEach((c) => { const m = mk('marker', { id: 'cv-ah-' + c, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }); m.append(mk('path', { d: 'M0,0 L10,5 L0,10 Z', fill: LINK_COLOR[c] })); defs.append(m); });
  svg.append(defs);
  const loc = (r) => ({ l: (r.left - wr.left) / k, t: (r.top - wr.top) / k, r: (r.right - wr.left) / k, b: (r.bottom - wr.top) / k });
  let n = 0;
  w.querySelectorAll('.cv-ov[data-ov]').forEach((ovEl) => {
    const g = ovEl.closest('.cv-group'); if (!ovEl.dataset.trigger || !g) return;
    ovEl.dataset.trigger.split(' ').forEach((tid) => {
    const tEl = g.querySelector('.cv-frame [data-id="' + CSS.escape(tid) + '"]'); if (!tEl) return;
    const a = loc(tEl.getBoundingClientRect()), b = loc(ovEl.getBoundingClientRect());
    const x1 = a.r + 2, y1 = (a.t + a.b) / 2, x2 = b.l - 3, y2 = b.t + Math.min(36, (b.b - b.t) / 2);
    const dx = Math.max(90, Math.abs(x2 - x1) * 0.45);
    const c = LINK_COLOR[ovEl.dataset.change] ? ovEl.dataset.change : 'unchanged';
    const on = ui.unit === ovEl.dataset.ov || (ui.sel && (ui.sel.id === tid || ui.sel.id === ovEl.dataset.ov));
    svg.append(mk('path', { class: 'cv-link' + (on ? ' on' : '') + (c === 'removed' ? ' dashed' : ''), d: 'M' + x1 + ',' + y1 + ' C' + (x1 + dx) + ',' + y1 + ' ' + (x2 - dx) + ',' + y2 + ' ' + x2 + ',' + y2, stroke: LINK_COLOR[c], 'marker-end': 'url(#cv-ah-' + c + ')', 'data-from': tid, 'data-to': ovEl.dataset.ov }));
    svg.append(mk('circle', { cx: x1, cy: y1, r: 4, fill: LINK_COLOR[c] }));
    n++;
    });
  });
  if (n) w.append(svg);
}
function vpEl() { return document.getElementById('cv-vp'); }
function worldEl() { return document.getElementById('cv-world'); }
function applyCam() {
  const w = worldEl(); if (!w || !ui.cam) return;
  w.style.transform = 'translate(' + ui.cam.x + 'px,' + ui.cam.y + 'px) scale(' + ui.cam.k + ')';
  const z = document.getElementById('cv-zoom'); if (z) z.textContent = Math.round(ui.cam.k * 100) + '%';
}
function animateCam() { const w = worldEl(); if (!w) return; w.classList.add('anim'); applyCam(); setTimeout(() => w.classList.remove('anim'), 380); }
/* first = initial view: fit the first screen (and its overlays) rather than the whole board. */
function fitCam(animate, first) {
  const vp = vpEl(), w = worldEl(); if (!vp || !w) return;
  const r = vp.getBoundingClientRect();
  const g = first && w.children.length > 1 ? w.children[0] : null;
  const X = g ? g.offsetLeft - 20 : 0, Y = g ? g.offsetTop - 20 : 0;
  const W = g ? g.offsetWidth + 40 : w.offsetWidth, H = g ? g.offsetHeight + 40 : w.offsetHeight;
  if (!W || !r.width) return;
  const k = Math.max(0.08, Math.min(1, (r.width - 40) / W, (r.height - 40) / H));
  ui.cam = { k: k, x: Math.max(20, (r.width - W * k) / 2) - X * k, y: Math.max(20, Math.min(60, (r.height - H * k) / 2)) - Y * k };
  if (animate) animateCam(); else applyCam();
}
function zoomAt(f, mx, my) {
  const c = ui.cam; if (!c) return;
  const k = Math.max(0.08, Math.min(3, c.k * f));
  c.x = mx - (mx - c.x) * (k / c.k); c.y = my - (my - c.y) * (k / c.k); c.k = k;
  applyCam();
}
function focusEl(el) {
  const vp = vpEl(), w = worldEl(); if (!vp || !w || !ui.cam || !w.contains(el)) return;
  const k0 = ui.cam.k, r = el.getBoundingClientRect(), wr = w.getBoundingClientRect(), vr = vp.getBoundingClientRect();
  const lx = (r.left - wr.left) / k0, ly = (r.top - wr.top) / k0, lw = r.width / k0, lh = r.height / k0;
  const k = Math.max(0.15, Math.min(1.1, (vr.width * 0.8) / lw, (vr.height * 0.8) / lh));
  ui.cam = { k: k, x: vr.width / 2 - (lx + lw / 2) * k, y: vr.height / 2 - (ly + lh / 2) * k };
  animateCam();
}
function wirePanZoom(vp) {
  let pan = null;
  vp.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input, select, textarea, .cv-tools, .palette, .cv-hint') || !ui.cam) return;
    const onDraggable = ui.mode === 'edit' && e.target.closest('#cv-world [data-drag]');
    if (e.button === 0 && onDraggable && !ui.space) {
      const pg = onDraggable.closest('[data-page]');
      const p = pg && pageById(pg.dataset.page); const x = p && findNode(p, onDraggable.dataset.id);
      startPointerDrag(e, { kind: 'move', id: onDraggable.dataset.id, page: pg ? pg.dataset.page : null, label: x ? nlabel(x.n) : '组件', srcEl: onDraggable });
      return;
    }
    const ok = e.button === 1 || (e.button === 0 && (ui.space || ui.mode !== 'edit' || !onDraggable));
    if (!ok) return;
    pan = { x: e.clientX, y: e.clientY, cx: ui.cam.x, cy: ui.cam.y, moved: false, id: e.pointerId };
    if (e.button === 1 || ui.space) e.preventDefault();
  });
  const move = (e) => {
    if (!pan || e.pointerId !== pan.id) return;
    const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
    if (!pan.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
    if (!pan.moved) { pan.moved = true; vp.classList.add('panning'); }
    ui.cam.x = pan.cx + dx; ui.cam.y = pan.cy + dy; applyCam();
  };
  const end = (e) => { if (!pan || (e && e.pointerId !== pan.id)) return; if (pan.moved) { ui.panMoved = true; setTimeout(() => { ui.panMoved = false; }, 0); } pan = null; vp.classList.remove('panning'); };
  vp.addEventListener('pointermove', move); vp.addEventListener('pointerup', end); vp.addEventListener('pointercancel', end); vp.addEventListener('pointerleave', end);
  vp.addEventListener('wheel', (e) => {
    if (!ui.cam) return;
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
    else { ui.cam.x -= (e.shiftKey ? e.deltaY : e.deltaX); ui.cam.y -= (e.shiftKey ? 0 : e.deltaY); applyCam(); }
  }, { passive: false });
}

// ------------------------------------------------------------------ canvas tab
function renderCanvasTab() {
  if (!S.spec.pages.length) return h('div', { class: 'cv-layout' }, h('div', { class: 'empty', style: 'flex:1' }, '本次变更不涉及界面。', ui.mode === 'edit' ? h('button', { onclick: () => mutate(opAddPage) }, '+ 新增页面') : null));
  return h('div', { class: 'cv-layout' + (ui.listOpen ? ' list-open' : '') }, changeList(), canvasArea(), detailPanel());
}
function changeList() {
  const sp = S.spec;
  const items = [];
  sp.pages.forEach((p) => {
    const us = UNITS.filter((u) => u.page === p.id);
    items.push(h('button', { class: 'cv-page', onclick: () => { ui.page = p.id; const f = document.querySelector('.cv-frame[data-page="' + CSS.escape(p.id) + '"]'); if (f) focusEl(f); } },
      h('span', { class: 'dot dot-' + pageStatus(p) }), h('b', null, pageName(p)), p.route ? h('span', { class: 'pg-route' }, p.route) : null));
    if (!us.length) items.push(h('div', { class: 'hint', style: 'padding:2px 10px 8px' }, '这个界面没有改动'));
    us.forEach((u) => {
      const n = u.kind === 'page' ? pageById(u.page) : unitNode(u);
      items.push(h('button', { class: 'cv-item', 'data-u': u.key, onclick: () => focusUnit(u.key) },
        h('span', { class: 'u-dot u-' + u.change }, String(u.n)),
        h('span', { class: 'cv-item-b' }, h('span', { class: 'cv-item-t' }, chgChip(u.change), ' ', unitTitle(u)), n && n.note ? h('span', { class: 'cv-item-n' }, short(n.note, 60)) : null)));
    });
    if (ui.mode === 'edit') items.push(h('div', { class: 'hint', style: 'padding:0 10px 6px' }));
  });
  const nq = sp.questions.length;
  return h('aside', { class: 'cv-list', id: 'cv-list' },
    sp.summary ? h('details', { class: 'cv-sum', open: sp.summary.length < 140 ? true : null }, h('summary', null, '这次改什么'), h('div', { class: 'summary' }, sp.summary)) : null,
    h('div', { class: 'legend sm' }, h('span', null, h('i', { class: 'lg mod' }), '修改'), h('span', null, h('i', { class: 'lg add' }), '新增'), h('span', null, h('i', { class: 'lg rm' }), '删除')),
    h('div', { class: 'hint', style: 'margin:4px 0 10px' }, '只给最外层改动的模块画框编号；整块新增或删除时，里面的元素不再单独标。点编号或下面的条目，看这一处的改动前后。'),
    h('div', { class: 'sec-t' }, '界面改动（' + UNITS.length + '）'),
    items,
    ui.mode === 'edit' ? h('button', { style: 'margin-top:8px', onclick: () => mutate(opAddPage) }, '+ 新增页面') : null,
    nq ? h('button', { class: 'cv-q', onclick: () => setTab('feedback') }, 'Agent 有 ' + nq + ' 个问题想请你确认 →') : null);
}
function canvasArea() {
  const editing = ui.mode === 'edit';
  const world = h('div', { class: 'cv-world', id: 'cv-world' }, S.spec.pages.map(pageGroup));
  const t = (key, label, title) => h('button', { class: ui[key] ? 'on' : null, title: title, onclick: () => { ui[key] = !ui[key]; render(); } }, label);
  const tools = h('div', { class: 'cv-tools' },
    h('button', { class: 'cv-listbtn' + (ui.listOpen ? ' on' : ''), title: '显示 / 隐藏改动清单', onclick: () => { ui.listOpen = !ui.listOpen; render(); } }, '☰ 改动 ' + UNITS.length),
    h('button', { title: '缩小', onclick: () => { const r = vpEl().getBoundingClientRect(); zoomAt(1 / 1.25, r.width / 2, r.height / 2); } }, '−'),
    h('span', { id: 'cv-zoom', class: 'cv-zoom' }, ui.cam ? Math.round(ui.cam.k * 100) + '%' : ''),
    h('button', { title: '放大', onclick: () => { const r = vpEl().getBoundingClientRect(); zoomAt(1.25, r.width / 2, r.height / 2); } }, '+'),
    h('button', { title: '整个画布放进视口', onclick: () => fitCam(true) }, '适应'),
    h('span', { class: 'cv-sep' }),
    t('showFn', 'ƒ 函数', '在线框里显示函数 / 接口占位'), t('showComp', '</> 组件', '显示每个模块对应的代码组件'), t('fade', '淡化未改动', '把没有改动的元素调淡'));
  const vp = h('div', { class: 'cv-vp' + (ui.showFn ? ' show-fn' : '') + (ui.showComp ? ' show-comp' : '') + (ui.fade ? ' fade' : '') + (editing ? ' editing' : ''), id: 'cv-vp' },
    world, tools,
    editing ? palette() : null,
    h('div', { class: 'cv-hint' }, editing ? '拖组件 = 改位置 · 拖页面底板或空白处 = 平移（按住空格可在任意处平移）· Ctrl/⌘+滚轮缩放' : '拖动平移 · 滚轮上下移动 · Ctrl/⌘+滚轮缩放 · 要拖组件请切到「编辑方案」'));
  wirePanZoom(vp);
  return vp;
}
function pageGroup(p) {
  const whole = p.change === 'added' || p.change === 'removed';
  const ghost = p.change === 'removed';
  const u = whole ? UNIT_BY.get(p.id) : null;
  const o = { side: 'merged', ctx: 'canvas', parentLayout: 'col', whole: whole, unit: whole ? p.id : null, ghost: ghost };
  const frame = h('div', { class: 'cv-frame' + (whole ? ' mk mk-' + p.change + ' mk-u' : ''), 'data-page': p.id, style: { width: (Number(p.width) || 1280) + 'px' } },
    u ? h('span', { class: 'u-num u-' + p.change }, String(u.n)) : null,
    u ? h('span', { class: 'u-tag u-' + p.change }, p.change === 'added' ? '整页新增' : '整页删除') : null,
    h('div', { class: 'cv-fh', 'data-kind': 'page', 'data-id': p.id, 'data-unit': whole ? p.id : null },
      h('span', { class: 'dot dot-' + pageStatus(p) }), h('span', null, pageName(p)), p.route ? h('span', { class: 'route' }, p.route) : null, cbadge('page', p.id)),
    h('div', { class: 'cv-fb' }, renderWF(p.root, p, o)));
  const ovs = p.overlays.filter((x) => !(ghost && x.change === 'added'));
  const editing = ui.mode === 'edit' && !ghost;
  const col = (ovs.length || editing) ? h('div', { class: 'cv-ovcol', 'data-page': p.id },
    ovs.map((x) => overlayFrame(x, p, o)),
    editing ? h('div', { class: 'cv-ovdrop', 'data-drop': 'overlays' }, '把组件拖到这里，变成点击后才出现的弹层') : null) : null;
  return h('div', { class: 'cv-group' }, frame, col);
}
const OV_W = { drawer: 440, modal: 560, menu: 300, popover: 320 };
function overlayFrame(x, p, o) {
  const ghost = o.ghost || x.change === 'removed';
  const v = view(x, ghost ? 'before' : 'after');
  const trs = trigList(v).map((t) => findNode(p, t)).filter(Boolean);
  const vs = ghost ? 'before' : 'after';
  return h('div', { class: 'cv-ov', 'data-ov': x.id, 'data-trigger': trigList(v).join(' ') || null, 'data-change': ghost ? 'removed' : x.change, style: { width: (OV_W[v.type] || 420) + 'px' } },
    h('div', { class: 'cv-ovh' }, '▸ ' + tname(v.type) + ' · ', trs.length ? ['点击 ', trs.map((t, i) => [i ? '、' : '', h('button', { class: 'lnk', onclick: (e) => { e.stopPropagation(); focusNode(p.id, t.n.id); } }, nlabel(view(t.n, vs)))]), ' 后出现'] : '未指定由哪个元素打开'),
    renderWF(x, p, o));
}

// ------------------------------------------------------------------ canvas: detail panel
function stepRefs(s) { return s.node == null ? [] : (Array.isArray(s.node) ? s.node : [s.node]).map(String); }
function subtreeIds(n) { const s = new Set(); (function walk(x) { s.add(x.id); (x.children || []).forEach(walk); })(n); return s; }
function collectFns(n, side) {
  const out = [];
  (function walk(x) { if (!visible(x, side)) return; const v = view(x, side); if (v.fn && out.indexOf(v.fn) < 0) out.push(v.fn); (v.children || []).forEach(walk); })(n);
  return out;
}
function detailRender(n, p, side, whole) {
  const r = renderWF(n, p, { side: side, ctx: 'detail', parentLayout: 'col', whole: !!whole, depth: 0 });
  return r ? h('div', { class: 'dt-render', 'data-page': p.id }, r) : null;
}
function detailPanel() {
  const u = ui.unit ? UNIT_BY.get(ui.unit) : null;
  const s = ui.sel;
  const parts = [];
  if (u) parts.push(unitDetail(u));
  if (s && (s.kind === 'node' || s.kind === 'page')) {
    const isUnitRoot = !!u && ((s.kind === 'node' && s.id === u.id) || (s.kind === 'page' && u.kind === 'page' && s.id === u.page));
    const body = s.kind === 'node' ? inspNode(s, isUnitRoot) : inspPage(s, isUnitRoot);
    if (body) parts.push(h('div', { class: 'dt-sec' }, h('div', { class: 'sec-t' }, isUnitRoot ? (ui.mode === 'edit' ? '修改这一处 / 写批注' : '对这一处写批注') : '选中的元素'), body));
  }
  if (!parts.length) return null;
  return h('aside', { class: 'inspector dt', id: 'inspector' },
    h('div', { class: 'ins-top' }, h('span', null, u ? '改动 ' + u.n + ' / ' + UNITS.length : '元素'),
      u && UNITS.length > 1 ? h('span', { class: 'dt-nav' }, btn('‹ 上一处', () => focusUnit(UNITS[(u.n - 2 + UNITS.length) % UNITS.length].key)), btn('下一处 ›', () => focusUnit(UNITS[u.n % UNITS.length].key))) : null,
      h('button', { class: 'lnk', onclick: () => { ui.sel = null; ui.unit = null; render(); } }, '关闭 ✕')),
    parts);
}
function unitDetail(u) {
  const p = pageById(u.page);
  const n = unitNode(u);
  if (!p || !n) return null;
  const isPage = u.kind === 'page';
  const holder = isPage ? p : n;
  const out = [];
  out.push(h('div', { class: 'dt-head' }, h('span', { class: 'u-dot u-' + u.change }, String(u.n)), h('b', null, unitTitle(u)), chgChip(u.change)));
  out.push(h('div', { class: 'ins-path' }, h('span', null, isPage ? (p.route || '') : '页面「' + pageName(p) + '」› ' + pathText(p, n, u.change === 'removed' ? 'before' : 'after')), h('code', null, '#' + u.id)));
  if (holder.component || (n && n.component)) out.push(h('div', { class: 'ins-path' }, '代码：', h('code', null, holder.component || n.component)));
  if (holder.note) out.push(h('div', { class: 'ins-note' }, h('b', null, 'Agent 说明：'), holder.note));
  if (!isPage && n.before && n.change === 'modified') out.push(diffBox(n));
  if (!isPage && (n.movedFrom || n.movedTo)) {
    const other = n.movedFrom || n.movedTo;
    out.push(h('div', { class: 'ins-note' }, n.movedFrom ? '从别处移过来的。' : '被移到了别处。', h('button', { class: 'lnk', onclick: () => focusNode(p.id, other) }, '看另一处')));
  }
  const whole = u.change === 'added' || u.change === 'removed';
  const before = u.change === 'added' ? h('div', { class: 'dt-void' }, isPage ? '改动前没有这个页面' : '改动前没有这个模块') : detailRender(n, p, 'before', whole);
  const after = u.change === 'removed' ? h('div', { class: 'dt-void' }, n.movedTo ? '移到了别处（点上面的「看另一处」）' : isPage ? '这个页面将被删除' : '这个模块将被删除') : detailRender(n, p, 'after', whole);
  out.push(h('div', { class: 'dt-cmp' },
    h('div', { class: 'side-before' }, h('div', { class: 'side-t' }, '改动前'), before),
    h('div', { class: 'side-after' }, h('div', { class: 'side-t' }, '改动后'), after)));
  const ids = subtreeIds(n);
  const inter = [];
  p.overlays.forEach((x) => {
    const xs = x.change === 'removed' ? 'before' : 'after';
    if (ids.has(x.id)) return;
    trigList(view(x, xs)).filter((tr) => ids.has(tr)).forEach((tr) => { const t = findNode(p, tr); inter.push(h('li', null, '点击 ', t ? nlabel(view(t.n, xs)) : '#' + tr, ' → 打开 ', h('button', { class: 'lnk', onclick: () => focusNode(p.id, x.id) }, '▸ ' + tname(x.type) + '「' + short(x.label || '', 18) + '」'))); });
  });
  if (!isPage && OVERLAY.has(n.type)) { const ts = trigList(view(n, n.change === 'removed' ? 'before' : 'after')).map((tr) => findNode(p, tr)).filter(Boolean); inter.push(h('li', null, '由 ', ts.length ? ts.map((t, i) => [i ? '、' : '', h('button', { class: 'lnk', onclick: () => focusNode(p.id, t.n.id) }, nlabel(t.n))]) : '（未指定的元素）', ' 打开')); }
  S.spec.flows.forEach((f) => {
    f.steps.forEach((st, i) => {
      if (!stepRefs(st).some((r) => ids.has(r)) && !(isPage && st.page === p.id)) return;
      inter.push(h('li', null, h('span', { class: 'chip sm' }, ACTORS[st.actor] || st.actor), ' ', h('button', { class: 'lnk', onclick: () => { ui.tab = 'flows'; ui.sel = { kind: 'step', id: st.id, side: st.change === 'removed' ? 'before' : 'after', flow: f.id }; save(); render(); scrollToSel(); } }, '流程「' + f.name + '」第 ' + (i + 1) + ' 步'), '：' + (st.text || ''), ' ', chgChip(st.change)));
    });
  });
  if (inter.length) out.push(h('div', { class: 'dt-block' }, h('div', { class: 'sec-t' }, '相关交互'), h('ul', { class: 'dt-list' }, inter)));
  const fns = collectFns(n, u.change === 'removed' ? 'before' : 'after');
  if (fns.length) out.push(h('div', { class: 'dt-block' }, h('div', { class: 'sec-t' }, '涉及的函数 / 接口'), h('ul', { class: 'dt-list fns' }, fns.map((f) => h('li', null, h('code', null, f))))));
  return h('div', { class: 'dt-unit' }, out);
}

function questionsCard() {
  const qs = S.spec.questions; if (!qs.length) return null;
  return h('div', { class: 'card' }, h('h3', null, 'Agent 想请你确认'), qs.map((q, i) => {
    const qq = typeof q === 'string' ? { q: q } : q;
    const key = qq.id || String(i);
    const ans = S.answers[key] || '';
    return h('div', { class: 'q' }, h('div', { class: 'q-t' }, (i + 1) + '. ' + (qq.q || qq.question || '')),
      qq.options ? h('div', { class: 'q-opts' }, qq.options.map((o) => h('button', { class: ans === o ? 'on' : null, onclick: () => mutate(() => { S.answers[key] = ans === o ? '' : o; return null; }) }, o))) : null,
      h('textarea', { 'data-f': 'ans-' + key, placeholder: '你的回答（可选）', value: ans, onchange: (e) => { const val = e.target.value; mutate(() => { S.answers[key] = val; return null; }); } }));
  }));
}


// ------------------------------------------------------------------ editing on the canvas
function palette() {
  return h('div', { class: 'palette' }, h('b', { class: 'pal-gt' }, '组件库'), PALETTE.map((g) => h('span', { class: 'pal-g' }, h('span', { class: 'pal-gt' }, g[0]),
    g[1].map((t) => h('span', { class: 'pal-item', title: '拖到画布上；或先选中一个位置再点击',
      onpointerdown: (e) => { if (e.button === 0) startPointerDrag(e, { kind: 'new', type: t, label: '＋ ' + tname(t) }); },
      onclick: (e) => { e.stopPropagation(); quickAdd(t); } }, tname(t))))));
}
function quickAdd(type) {
  const s = ui.sel;
  const p = (s && s.page && pageById(s.page)) || curPage(); if (!p) return;
  let dest = {};
  if (s && s.kind === 'node' && s.side === 'after' && s.page === p.id) { const e = findNode(p, s.id); if (e && afterVisibleIds(p).has(e.n.id)) dest = { targetId: e.n.id, pos: isCont(e.n) ? 'inside' : 'after' }; }
  mutate(() => opAdd(p.id, type, dest));
}
function clearDrop() { if (dropEl) dropEl.classList.remove('drop-before', 'drop-after', 'drop-inside', 'hz'); dropEl = null; }
function pageOfEvent(e) { const t = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement); const g = t && t.closest('[data-page]'); return g ? pageById(g.dataset.page) : null; }
function dropTarget(e, p) {
  const t = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement);
  if (!t || !drag || !p || !t.closest('#cv-world')) return null;
  if (drag.kind === 'move' && drag.page !== p.id) return null;
  const el = t.closest('[data-kind="node"][data-side="after"]');
  const strip = t.closest('[data-drop="overlays"]');
  if (el) {
    const id = el.dataset.id; const x = findNode(p, id); if (!x) return null;
    if (drag.kind === 'move') { const s = findNode(p, drag.id); if (!s || contains(s.n, x.n)) return null; }
    const parentWf = el.parentElement && el.parentElement.closest('.wf');
    const hz = !!(parentWf && (parentWf.classList.contains('lay-row') || parentWf.classList.contains('lay-grid')));
    let pos;
    if (!x.list) pos = 'inside';
    else {
      const r = el.getBoundingClientRect();
      const f = hz ? (e.clientX - r.left) / (r.width || 1) : (e.clientY - r.top) / (r.height || 1);
      pos = isCont(x.n) ? (f < 0.25 ? 'before' : f > 0.75 ? 'after' : 'inside') : (f < 0.5 ? 'before' : 'after');
    }
    return { el: el, id: id, pos: pos, hz: hz };
  }
  if (strip) return { el: strip, overlays: true };
  return null;
}
/* Pointer-based drag & drop. Native HTML5 drag is not used: Safari refuses to start it inside
 * user-select:none (the canvas needs that for panning), and it is unreliable in sandboxed previews. */
let pd = null;
function startPointerDrag(e, info) { pd = Object.assign({ x: e.clientX, y: e.clientY, pid: e.pointerId, started: false }, info); }
function hoverDrop(x, y) {
  const t = document.elementFromPoint(x, y);
  const fake = { target: t, clientX: x, clientY: y };
  return dropTarget(fake, pageOfEvent(fake));
}
document.addEventListener('pointermove', (e) => {
  if (!pd || e.pointerId !== pd.pid) return;
  if (!pd.started) {
    if (Math.abs(e.clientX - pd.x) + Math.abs(e.clientY - pd.y) < 6) return;
    pd.started = true;
    drag = { kind: pd.kind, id: pd.id, page: pd.page, type: pd.type };
    pd.ghost = h('div', { class: 'drag-ghost' }, pd.label);
    document.body.append(pd.ghost);
    if (pd.srcEl) pd.srcEl.classList.add('dragging');
    document.documentElement.classList.add('is-dragging');
  }
  e.preventDefault();
  pd.ghost.style.left = (e.clientX + 14) + 'px'; pd.ghost.style.top = (e.clientY + 14) + 'px';
  clearDrop();
  const d = hoverDrop(e.clientX, e.clientY);
  if (d) { dropEl = d.el; d.el.classList.add(d.overlays ? 'drop-inside' : 'drop-' + d.pos); if (d.hz) d.el.classList.add('hz'); }
  pd.ghost.classList.toggle('no', !d);
});
function endPointerDrag(e, commit) {
  if (!pd || (e && e.pointerId !== pd.pid)) return;
  const p = pd; pd = null;
  if (!p.started) return;
  if (p.ghost) p.ghost.remove();
  if (p.srcEl) p.srcEl.classList.remove('dragging');
  document.documentElement.classList.remove('is-dragging');
  clearDrop();
  ui.panMoved = true; setTimeout(() => { ui.panMoved = false; }, 0);
  const d = commit && e ? hoverDrop(e.clientX, e.clientY) : null;
  const pg = d && pageOfEvent({ target: d.el });
  drag = null;
  if (!d || !pg) return;
  const dest = d.overlays ? { overlays: true } : { targetId: d.id, pos: d.pos };
  if (p.kind === 'move') mutate(() => opMove(pg.id, p.id, dest)); else mutate(() => opAdd(pg.id, p.type, dest));
}
document.addEventListener('pointerup', (e) => endPointerDrag(e, true));
document.addEventListener('pointercancel', (e) => endPointerDrag(e, false));

// ------------------------------------------------------------------ flows
function renderFlows() {
  const flows = S.spec.flows;
  const out = h('div', { class: 'flows' });
  if (!flows.length) out.append(h('div', { class: 'empty' }, '本次变更没有描述流程变化。'));
  flows.forEach((f) => {
    const st = flowStatus(f);
    out.append(h('div', { class: 'flow card' },
      h('div', { class: 'flow-head', 'data-kind': 'flow', 'data-id': f.id }, h('span', { class: 'dot dot-' + st }), h('h3', null, f.name), chgChip(st), f.note ? h('span', { class: 'muted' }, f.note) : null, cbadge('flow', f.id)),
      h('div', { class: 'compare' }, flowSide(f, 'before'), flowSide(f, 'after'))));
  });
  if (ui.mode === 'edit') out.append(h('button', { onclick: () => mutate(opFlowAdd) }, '+ 新增流程'));
  return out;
}
function flowSide(f, side) {
  const title = h('div', { class: 'side-t' }, side === 'before' ? '改动前' : '改动后');
  if (side === 'before' && f.change === 'added') return h('div', { class: 'side side-before' }, title, h('div', { class: 'frame void' }, '新流程 —— 改动前不存在'));
  if (side === 'after' && f.change === 'removed') return h('div', { class: 'side side-after' }, title, h('div', { class: 'frame void' }, '这个流程将被移除'));
  const steps = f.steps.filter((s) => visible(s, side));
  const actorKeys = [];
  f.steps.forEach((s) => { [s.actor, s.before && s.before.actor].forEach((a) => { if (a && actorKeys.indexOf(a) < 0) actorKeys.push(a); }); });
  const order = Object.keys(ACTORS);
  actorKeys.sort((a, b) => ((order.indexOf(a) + 1) || 99) - ((order.indexOf(b) + 1) || 99));
  if (!actorKeys.length) actorKeys.push('frontend');
  const grid = h('div', { class: 'lanes', style: { gridTemplateColumns: '28px repeat(' + actorKeys.length + ', minmax(0, 1fr))' } });
  actorKeys.forEach((a, i) => {
    grid.append(h('div', { class: 'lane-bg', style: { gridColumn: String(i + 2), gridRow: '1 / span ' + (steps.length + 1) } }));
    grid.append(h('div', { class: 'lane-h', style: { gridColumn: String(i + 2), gridRow: '1' } }, ACTORS[a] || a));
  });
  steps.forEach((s, i) => {
    const v = view(s, side);
    const col = actorKeys.indexOf(v.actor) + 2;
    grid.append(h('div', { class: 'step-n', style: { gridColumn: '1', gridRow: String(i + 2) } }, String(i + 1)));
    const pg = v.page ? pageById(v.page) : null;
    grid.append(h('div', { class: 'step ' + chgClass(s, side) + (v.kind ? ' k-' + v.kind : ''), 'data-kind': 'step', 'data-id': s.id, 'data-flow': f.id, 'data-side': side, 'data-partner': s.movedFrom || s.movedTo || null, title: s.note || null, style: { gridColumn: String(col), gridRow: String(i + 2) } },
      chgTag(s, side),
      h('div', { class: 'step-t' }, v.kind === 'decision' ? '◇ ' : '', v.text || ''),
      v.fn ? h('div', { class: 'wf-fn' }, 'ƒ ' + v.fn) : null,
      s.note && s.change !== 'unchanged' && visible(s, side) && chgOf(s, side) ? h('div', { class: 'wf-note' }, s.note) : null,
      stepRefs(s).length ? h('button', { class: 'lnk page-link', onclick: (ev) => { ev.stopPropagation(); const f = findNodeAnywhere(stepRefs(s)[0]); if (f) focusNode(f.p.id, f.e.n.id); } }, '↗ 在界面上定位') : pg ? h('button', { class: 'lnk page-link', onclick: (ev) => { ev.stopPropagation(); ui.tab = 'canvas'; ui.page = pg.id; ui.sel = null; save(); render(); requestAnimationFrame(() => { const fr = document.querySelector('.cv-frame[data-page="' + CSS.escape(pg.id) + '"]'); if (fr) focusEl(fr); }); } }, '↗ ' + pageName(pg)) : null,
      cbadge('step', s.id, side)));
  });
  const extra = ui.mode === 'edit' && side === 'after' ? h('button', { class: 'add-step', onclick: (e) => { e.stopPropagation(); mutate(() => opStepAdd(f.id, null)); } }, '+ 添加步骤') : null;
  return h('div', { class: 'side side-' + side }, title, h('div', { class: 'frame' }, steps.length ? grid : h('div', { class: 'muted' }, '（无步骤）'), extra));
}

// ------------------------------------------------------------------ backend
function renderBackend() {
  const out = h('div', { class: 'be' });
  if (!S.spec.backend.length) out.append(h('div', { class: 'empty' }, '本次变更没有描述后端变化。'));
  else out.append(h('div', { class: 'compare' }, beSide('before'), beSide('after')));
  if (ui.mode === 'edit') out.append(h('div', { style: 'margin-top:12px' }, h('button', { onclick: () => mutate(opModAdd) }, '+ 新增模块')));
  return out;
}
function beSide(side) {
  const mods = S.spec.backend.filter((m) => visible(m, side));
  return h('div', { class: 'side side-' + side }, h('div', { class: 'side-t' }, side === 'before' ? '改动前' : '改动后'),
    h('div', { class: 'frame be-frame' }, mods.length ? mods.map((m) => modBox(m, side)) : h('div', { class: 'muted' }, '（无）')));
}
function modBox(m, side) {
  const v = view(m, side);
  const items = m.items.filter((i) => visible(i, side));
  return h('div', { class: 'mod ' + chgClass(m, side), 'data-kind': 'be', 'data-id': m.id, 'data-side': side, title: m.note || null },
    chgTag(m, side),
    h('div', { class: 'mod-h' }, h('span', { class: 'chip' }, MOD_KINDS[v.kind] || v.kind || '模块'), h('b', null, v.name)),
    v.note ? h('div', { class: 'mod-note' }, v.note) : null,
    h('div', { class: 'mod-items' }, items.map((it) => {
      const iv = view(it, side);
      return h('div', { class: 'be-item ' + chgClass(it, side), 'data-kind': 'be', 'data-id': it.id, 'data-side': side },
        chgTag(it, side), h('span', { class: 'chip sm' }, BE_KINDS[iv.kind] || iv.kind || '条目'), h('code', null, iv.name || ''), iv.note ? h('span', { class: 'be-note' }, iv.note) : null, cbadge('be', it.id, side));
    }), ui.mode === 'edit' && side === 'after' ? h('button', { class: 'lnk', style: 'align-self:flex-start', onclick: (e) => { e.stopPropagation(); mutate(() => opItemAdd(m.id)); } }, '+ 添加条目') : null),
    cbadge('be', m.id, side));
}

// ------------------------------------------------------------------ inspector
function fld(label, input) { return h('label', { class: 'fld' }, h('span', null, label), input); }
function inp(key, value, onCommit, opts) {
  opts = opts || {};
  const el = h(opts.multi ? 'textarea' : 'input', { 'data-f': key, placeholder: opts.ph || null, value: value == null ? '' : String(value) });
  el.addEventListener('change', () => onCommit(el.value));
  if (!opts.multi) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
  return el;
}
function sel(key, value, options, onCommit) {
  const v = value == null ? '' : String(value);
  const opts = options.slice();
  if (!opts.some((o) => o[0] === v)) opts.push([v, v]);
  const el = h('select', { 'data-f': key }, opts.map((o) => h('option', { value: o[0] }, o[1])));
  el.value = v;
  el.addEventListener('change', () => onCommit(el.value));
  return el;
}
function diffBox(o) {
  return h('div', { class: 'diff' }, h('div', { class: 'sec-t' }, '修改了什么'), Object.keys(o.before).map((k) => h('div', { class: 'diff-row' }, h('span', { class: 'dk' }, FIELD_LABEL[k] || k), h('span', { class: 'dv old' }, fmtVal(k, o.before[k])), '→', h('span', { class: 'dv new' }, fmtVal(k, o[k])))));
}
function renderInspector() {
  const s = ui.sel; if (!s) return null;
  let body = null;
  if (s.kind === 'node') body = inspNode(s);
  else if (s.kind === 'page') body = inspPage(s);
  else if (s.kind === 'flow') body = inspFlow(s);
  else if (s.kind === 'step') body = inspStep(s);
  else if (s.kind === 'be') body = inspBe(s);
  if (!body) return null;
  return h('aside', { class: 'inspector', id: 'inspector' },
    h('div', { class: 'ins-top' }, h('span', null, ui.mode === 'edit' ? '修改 / 批注' : '批注'), h('button', { class: 'lnk', onclick: () => { ui.sel = null; render(); } }, '关闭 ✕')), body);
}
function commentBox(target) {
  const list = S.comments.filter((c) => sameTarget(c.target, target));
  const cat = h('select', { 'data-f': 'c-cat' }, CATS.map((c) => h('option', { value: c }, c)));
  const sev = h('select', { 'data-f': 'c-sev' }, SEVS.map((c) => h('option', { value: c }, c)));
  sev.value = '建议';
  const ta = h('textarea', { 'data-f': 'c-text', placeholder: '写下你的意见。例如：这个编辑卡片不要常驻在列表下面，放进二级菜单，点「编辑」按钮再弹出。' });
  const add = () => { const t = ta.value.trim(); if (!t) { ta.focus(); return; } addComment(target, cat.value, sev.value, t); };
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add(); });
  return h('div', { class: 'cbox' }, h('div', { class: 'sec-t' }, '批注' + (list.length ? '（' + list.length + '）' : '')), list.map(commentItem),
    h('div', { class: 'row2' }, cat, sev), ta, h('div', { class: 'acts' }, h('button', { class: 'primary', onclick: add }, '添加批注'), h('span', { class: 'hint' }, 'Ctrl+Enter')));
}
function commentItem(c) {
  return h('div', { class: 'cmt' }, h('div', { class: 'cmt-meta' }, h('span', { class: 'sev s' + SEVS.indexOf(c.severity) }, c.severity), h('span', { class: 'chip sm' }, c.category),
    h('span', { style: 'margin-left:auto' }), h('button', { class: 'lnk', onclick: (e) => { e.stopPropagation(); mutate(() => { S.comments = S.comments.filter((x) => x.id !== c.id); return null; }); } }, '删除')),
    h('div', { class: 'ctext' }, c.text));
}
function inspNode(s, compact) {
  const p = pageById(s.page); const e = p && findNode(p, s.id); if (!e) return null;
  const n = e.n, v = view(n, s.side);
  const vis = afterVisibleIds(p);
  const editable = ui.mode === 'edit' && s.side === 'after' && vis.has(n.id);
  const out = [];
  if (!compact) out.push(h('div', { class: 'ins-head' }, h('span', { class: 'ins-type' }, tname(v.type)), h('b', null, v.label || ''), chgChip(chgOf(n, s.side) ? n.change : null)));
  if (!compact) out.push(h('div', { class: 'ins-path' }, h('span', null, (s.side === 'before' ? '改动前 › ' : '改动后 › ') + pathText(p, n, s.side)), h('code', null, '#' + n.id)));
  if (!compact && n.note) out.push(h('div', { class: 'ins-note' }, h('b', null, 'Agent 说明：'), n.note));
  if (!compact && n.before && n.change === 'modified') out.push(diffBox(n));
  if (!compact && n.movedFrom || n.movedTo) out.push(h('div', { class: 'ins-note' }, n.movedFrom ? '这是从原位置移过来的。' : '这个元素被移到了新位置。', h('button', { class: 'lnk', onclick: () => focusNode(p.id, n.movedFrom || n.movedTo) }, '定位另一处')));
  if (editable) out.push(nodeEditor(p, n, e));
  else {
    if (v.fn) out.push(fld('函数 / 行为', h('code', null, v.fn)));
    if (v.text) out.push(fld('说明', h('div', null, v.text)));
    if (ui.mode === 'edit' && s.side === 'before' && n.change === 'removed') out.push(h('div', { class: 'acts' }, btn(n.movedTo ? '撤销移动（放回原处）' : '恢复这个元素', () => mutate(() => opRestore(p.id, n.id)))));
    if (ui.mode === 'view' && s.side === 'after') out.push(h('div', { class: 'ins-tip' }, '想直接改？点顶部「编辑方案」，就可以拖动、改类型、转为弹窗或删除。'));
  }
  const opens = p.overlays.filter((x) => visible(x, s.side) && trigList(view(x, s.side)).includes(n.id));
  opens.forEach((x) => out.push(h('div', { class: 'acts' }, btn('点击后打开：▸ ' + tname(x.type) + '「' + short(x.label || '', 16) + '」 →', () => focusNode(p.id, x.id)))));
  out.push(commentBox({ kind: 'node', page: p.id, id: n.id, side: s.side }));
  return out;
}
function nodeEditor(p, n, e) {
  const pid = p.id, id = n.id;
  const ctx = { target: { kind: 'node', page: pid, id: id }, name: (o) => ref(o), prefix: () => pfx(pageById(pid)) };
  const res = () => { const pg = pageById(pid); const x = pg && findNode(pg, id); return x && x.n; };
  const ed = (f) => editor(res, f, ctx);
  const cont = isCont(n);
  const f = [];
  f.push(fld('组件类型', sel('type', n.type, TYPE_ORDER.map((k) => [k, tname(k) + '  ' + k]), ed('type'))));
  if (n.type !== 'divider') f.push(fld(cont ? '标题（可空）' : '文字', inp('label', n.label, ed('label'))));
  f.push(fld(USES_TEXT.has(n.type) ? '占位提示 / 示例值' : '补充说明（灰色小字）', inp('text', n.text, ed('text'), { multi: !USES_TEXT.has(n.type) })));
  f.push(fld('函数 / 行为占位', inp('fn', n.fn, ed('fn'), { ph: '例如 onClick → openEditor()　或　GET /api/tags' })));
  if (INLINE.has(n.type)) f.push(fld('样式变体', sel('variant', n.variant, VARIANTS, ed('variant'))));
  if (e.list && e.list !== p.overlays) f.push(fld('宽度', sel('w', n.w, WIDTHS, ed('w'))));
  if (cont) f.push(fld('子元素排列', sel('layout', n.layout, LAYOUTS, ed('layout'))));
  if (cont && n.layout === 'grid') f.push(fld('网格列数', inp('cols', n.cols, ed('cols'))));
  if (ITEMS_TYPES.has(n.type)) f.push(fld('选项 / 条目（每行一个）', inp('items', visItems(n, 'after', 'items').map(itemText).join('\n'), ed('items'), { multi: true })));
  if (n.type === 'table') f.push(fld('表格列（每行一个）', inp('columns', visItems(n, 'after', 'columns').map(itemText).join('\n'), ed('columns'), { multi: true })));
  if (OVERLAY.has(n.type)) {
    const vis = afterVisibleIds(p);
    const cands = entries(p).filter((x) => vis.has(x.n.id) && TRIGGER_TYPES.has(x.n.type) && !contains(n, x.n)).map((x) => [x.n.id, nlabel(x.n) + ' #' + x.n.id]);
    const cur = trigList(n);
    const commit = ed('trigger');
    f.push(h('div', { class: 'fld' }, h('span', null, '由哪些元素触发（可多选）'), h('div', { class: 'trig-list' }, cands.length ? cands.map((c) => h('label', { class: 'trig-opt' },
      h('input', { type: 'checkbox', checked: cur.includes(c[0]), style: 'width:auto', onchange: (e) => { const next = e.target.checked ? cur.concat([c[0]]) : cur.filter((x) => x !== c[0]); commit(trigValue(next)); } }), ' ' + c[1])) : h('span', { class: 'hint' }, '页面上还没有可作为触发的按钮 / 链接'))));
  }
  const acts = h('div', { class: 'acts' });
  if (e.list) {
    acts.append(btn('↑ 前移', () => mutate(() => opSibling(pid, id, -1)), null, '和前一个元素交换位置'), btn('↓ 后移', () => mutate(() => opSibling(pid, id, 1))), btn('复制', () => mutate(() => opDuplicate(pid, id))), btn('删除', () => mutate(() => opDelete(pid, id)), 'danger'));
  }
  const conv = h('div', { class: 'acts' });
  if (e.list && e.list !== p.overlays && !OVERLAY.has(n.type)) {
    conv.append(h('span', { class: 'hint', style: 'width:100%' }, '改成点击按钮才出现：'),
      btn('转为弹窗', () => mutate(() => opConvert(pid, id, 'modal'))), btn('转为下拉菜单', () => mutate(() => opConvert(pid, id, 'menu')), null, '二级菜单：点按钮展开'),
      btn('转为抽屉', () => mutate(() => opConvert(pid, id, 'drawer'))), btn('转为气泡', () => mutate(() => opConvert(pid, id, 'popover'))));
  }
  let addRow = null;
  if (cont) {
    const ts = h('select', { 'data-f': 'add-type' }, TYPE_ORDER.filter((t) => t !== 'page').map((t) => h('option', { value: t }, tname(t))));
    ts.value = 'button';
    addRow = h('div', { class: 'addchild' }, ts, btn('添加到里面', () => mutate(() => opAdd(pid, ts.value, { targetId: id, pos: 'inside' }))));
  }
  return h('div', { class: 'fields' }, f, acts, conv.childNodes.length ? conv : null, addRow);
}
function inspPage(s, compact) {
  const p = pageById(s.id); if (!p) return null;
  const out = [h('div', { class: 'ins-head' }, h('span', { class: 'ins-type' }, '页面'), h('b', null, pageName(p)), chgChip(pageStatus(p)))];
  if (p.note) out.push(h('div', { class: 'ins-note' }, h('b', null, 'Agent 说明：'), p.note));
  if (p.before && p.change === 'modified') out.push(diffBox(p));
  if (ui.mode === 'edit') {
    const ctx = { target: { kind: 'page', id: p.id }, name: (o) => '页面「' + o.name + '」', prefix: () => '' };
    const res = () => pageById(s.id);
    if (p.change !== 'removed') out.push(h('div', { class: 'fields' }, fld('页面名称', inp('p-name', p.name, editor(res, 'name', ctx))), fld('路由 / 地址', inp('p-route', p.route, editor(res, 'route', ctx))), h('div', { class: 'acts' }, btn('删除这个页面', () => mutate(() => opDeletePage(p.id)), 'danger'))));
    else out.push(h('div', { class: 'acts' }, btn('恢复这个页面', () => mutate(() => opRestorePage(p.id)))));
  }
  out.push(commentBox({ kind: 'page', id: p.id }));
  return out;
}
function inspFlow(s) {
  const f = flowById(s.id); if (!f) return null;
  const out = [h('div', { class: 'ins-head' }, h('span', { class: 'ins-type' }, '流程'), h('b', null, f.name), chgChip(flowStatus(f)))];
  if (f.note) out.push(h('div', { class: 'ins-note' }, h('b', null, 'Agent 说明：'), f.note));
  if (ui.mode === 'edit' && f.change !== 'removed') {
    const ctx = { target: { kind: 'flow', id: f.id }, name: (o) => '流程「' + o.name + '」', prefix: () => '' };
    out.push(h('div', { class: 'fields' }, fld('流程名称', inp('f-name', f.name, editor(() => flowById(s.id), 'name', ctx))), h('div', { class: 'acts' }, btn('+ 添加步骤', () => mutate(() => opStepAdd(f.id, null))), btn('删除流程', () => mutate(() => opFlowDelete(f.id)), 'danger'))));
  }
  out.push(commentBox({ kind: 'flow', id: f.id }));
  return out;
}
function inspStep(s) {
  const f = flowById(s.flow); const st = f && f.steps.find((x) => x.id === s.id); if (!st) return null;
  const v = view(st, s.side);
  const out = [h('div', { class: 'ins-head' }, h('span', { class: 'ins-type' }, '步骤 · ' + (ACTORS[v.actor] || v.actor)), h('b', null, short(v.text, 30)), chgChip(chgOf(st, s.side) ? st.change : null))];
  out.push(h('div', { class: 'ins-path' }, '流程「' + f.name + '」', h('code', null, '#' + st.id)));
  if (st.note) out.push(h('div', { class: 'ins-note' }, h('b', null, 'Agent 说明：'), st.note));
  if (st.before && st.change === 'modified') out.push(diffBox(st));
  const editable = ui.mode === 'edit' && s.side === 'after' && visible(st, 'after') && f.change !== 'removed';
  if (editable) {
    const ctx = { target: { kind: 'step', flow: f.id, id: st.id }, name: (o) => '步骤' + stepLabel(o), prefix: () => '流程「' + f.name + '」：' };
    const res = () => { const ff = flowById(s.flow); return ff && ff.steps.find((x) => x.id === s.id); };
    const actorOpts = Object.keys(ACTORS).map((k) => [k, ACTORS[k]]);
    out.push(h('div', { class: 'fields' },
      fld('谁来做', sel('s-actor', st.actor, actorOpts, editor(res, 'actor', ctx))),
      fld('做什么', inp('s-text', st.text, editor(res, 'text', ctx), { multi: true })),
      fld('函数 / 接口占位', inp('s-fn', st.fn, editor(res, 'fn', ctx), { ph: '例如 POST /api/tasks → TaskService.create()' })),
      fld('步骤类型', sel('s-kind', st.kind, STEP_KINDS, editor(res, 'kind', ctx))),
      fld('关联页面', sel('s-page', st.page, [['', '（无）']].concat(S.spec.pages.map((p) => [p.id, pageName(p)])), editor(res, 'page', ctx))),
      h('div', { class: 'acts' }, btn('↑ 提前', () => mutate(() => opStepMove(f.id, st.id, -1))), btn('↓ 推后', () => mutate(() => opStepMove(f.id, st.id, 1))), btn('+ 在后面插入', () => mutate(() => opStepAdd(f.id, st.id))), btn('删除', () => mutate(() => opStepDelete(f.id, st.id)), 'danger'))));
  } else {
    if (v.fn) out.push(fld('函数 / 接口', h('code', null, v.fn)));
    if (ui.mode === 'edit' && s.side === 'before' && st.change === 'removed') out.push(h('div', { class: 'acts' }, btn('恢复这个步骤', () => mutate(() => opStepRestore(f.id, st.id)))));
  }
  out.push(commentBox({ kind: 'step', flow: f.id, id: st.id, side: s.side }));
  return out;
}
function inspBe(s) {
  const fb = findBe(s.id); if (!fb) return null;
  const o = fb.item || fb.m, isItem = !!fb.item;
  const v = view(o, s.side);
  const out = [h('div', { class: 'ins-head' }, h('span', { class: 'ins-type' }, isItem ? (BE_KINDS[v.kind] || v.kind || '条目') : (MOD_KINDS[v.kind] || v.kind || '模块')), h('b', null, h('code', null, v.name)), chgChip(chgOf(o, s.side) ? o.change : null))];
  if (isItem) out.push(h('div', { class: 'ins-path' }, '模块「' + fb.m.name + '」', h('code', null, '#' + o.id)));
  if (o.before && o.change === 'modified') out.push(diffBox(o));
  const editable = ui.mode === 'edit' && s.side === 'after' && visible(o, 'after') && visible(fb.m, 'after');
  if (editable) {
    const ctx = { target: { kind: 'be', id: o.id }, name: (x) => '「' + x.name + '」', prefix: () => '后端：' };
    const res = () => { const r = findBe(s.id); return r && (r.item || r.m); };
    const kinds = isItem ? BE_KINDS : MOD_KINDS;
    out.push(h('div', { class: 'fields' },
      fld('名称 / 签名', inp('b-name', o.name, editor(res, 'name', ctx))),
      fld('类型', sel('b-kind', o.kind, Object.keys(kinds).map((k) => [k, kinds[k]]), editor(res, 'kind', ctx))),
      fld('说明', inp('b-note', o.note, editor(res, 'note', ctx), { multi: true })),
      h('div', { class: 'acts' }, isItem ? null : btn('+ 添加条目', () => mutate(() => opItemAdd(o.id))), btn('删除', () => mutate(() => opBeDelete(o.id)), 'danger'))));
  } else {
    if (v.note) out.push(fld('说明', h('div', null, v.note)));
    if (ui.mode === 'edit' && s.side === 'before' && o.change === 'removed') out.push(h('div', { class: 'acts' }, btn('恢复', () => mutate(() => opBeRestore(o.id)))));
  }
  out.push(commentBox({ kind: 'be', id: o.id, side: s.side }));
  return out;
}

// ------------------------------------------------------------------ feedback
function jump(t) {
  if (t.kind === 'node' || t.kind === 'page') { ui.tab = 'canvas'; ui.page = t.page || t.id; ui.unit = t.kind === 'node' ? unitOf(t.page, t.id) : (UNIT_BY.has(t.id) ? t.id : null); }
  else if (t.kind === 'flow' || t.kind === 'step') ui.tab = 'flows';
  else if (t.kind === 'be') ui.tab = 'backend';
  ui.sel = Object.assign({}, t);
  validateSel(); save(); render(); scrollToSel();
}
function renderFeedback() {
  const g = S.global;
  const md = buildMarkdown(ui.includeSpec);
  const sorted = S.comments.slice().sort((a, b) => SEVS.indexOf(a.severity) - SEVS.indexOf(b.severity));
  return h('div', { class: 'fb' },
    h('div', { class: 'card' }, h('h3', null, '整体意见（风格、方向、不满意的地方）'),
      h('div', { class: 'tags' }, STYLE_TAGS.map((t) => h('button', { class: g.tags.indexOf(t) >= 0 ? 'on' : null, onclick: () => mutate(() => { const i = S.global.tags.indexOf(t); if (i >= 0) S.global.tags.splice(i, 1); else S.global.tags.push(t); return null; }) }, t))),
      fld('总体意见', h('textarea', { 'data-f': 'g-text', placeholder: '例如：整体太像后台表格了，希望和现有的卡片式首页保持一致；按钮太多，次要操作收进「更多」菜单。', value: g.text, onchange: (e) => { const v = e.target.value; mutate(() => { S.global.text = v; return null; }); } })),
      fld('风格参考（链接、产品名或描述）', h('input', { 'data-f': 'g-ref', placeholder: '例如：参考项目里的 /settings 页面；或 Linear 的列表风格', value: g.ref, onchange: (e) => { const v = e.target.value; mutate(() => { S.global.ref = v; return null; }); } }))),
    questionsCard(),
    h('div', { class: 'card' }, h('h3', null, '批注（' + S.comments.length + '）'),
      sorted.length ? sorted.map((c) => h('div', { class: 'cmt' }, h('div', { class: 'cmt-meta' }, h('span', { class: 'sev s' + SEVS.indexOf(c.severity) }, c.severity), h('span', { class: 'chip sm' }, c.category), h('button', { class: 'where', onclick: () => jump(c.target) }, c.where), h('span', { style: 'margin-left:auto' }), h('button', { class: 'lnk', onclick: () => mutate(() => { S.comments = S.comments.filter((x) => x.id !== c.id); return null; }) }, '删除')), h('div', { class: 'ctext' }, c.text)))
        : h('div', { class: 'muted' }, '还没有批注。在「页面 / 流程 / 后端」里点任意元素即可添加。')),
    h('div', { class: 'card' }, h('h3', null, '你对方案做的修改（' + S.ops.length + '）'),
      S.ops.length ? h('ol', { class: 'ops' }, S.ops.map((o) => h('li', null, o.desc))) : h('div', { class: 'muted' }, '还没有修改。切到顶部「编辑方案」可以直接拖动、增删组件。')),
    h('div', { class: 'card' }, h('h3', null, '把反馈交给 Agent'),
      h('div', { class: 'hint', style: 'margin-bottom:8px' }, '点「复制反馈」，粘贴到和 Agent 的对话里发送即可。如果浏览器不允许自动复制，会自动选中下面的全部文字，按 Ctrl+C / ⌘C 复制。'),
      h('div', { class: 'export-acts' },
        h('button', { class: 'primary', onclick: copyFeedback }, '复制反馈'),
        h('button', { class: 'ok' + (S.approved ? ' on' : ''), onclick: () => mutate(() => { S.approved = !S.approved; return null; }), title: '没有意见或意见不影响方向时勾选，Agent 会开始实现' }, S.approved ? '✓ 已确认方案' : '确认方案，可以开始做'),
        h('button', { onclick: () => download('feedback.md', buildMarkdown(ui.includeSpec), 'text/markdown'), title: '部分预览环境（沙箱）不允许下载' }, '下载 .md')),
      h('label', { class: 'hint', style: 'display:flex;gap:6px;align-items:center;margin-bottom:8px' }, h('input', { type: 'checkbox', checked: ui.includeSpec, style: 'width:auto', onchange: (e) => { ui.includeSpec = e.target.checked; render(); } }), '附带你修改后的完整方案 JSON（在「编辑方案」里改过结构时请保留勾选）'),
      h('textarea', { class: 'md', id: 'smyw-out', 'data-f': 'smyw-out', readonly: true, value: md, onfocus: (e) => e.target.select() })));
}
function answersList() {
  return S.spec.questions.map((q, i) => { const qq = typeof q === 'string' ? { q: q } : q; const key = qq.id || String(i); return { id: key, question: qq.q || qq.question || '', answer: S.answers[key] || '' }; }).filter((a) => a.answer);
}
function cleanSpec() {
  const sp = clone(S.spec);
  const strip = (o) => {
    if (Array.isArray(o)) { o.forEach(strip); return; }
    if (!o || typeof o !== 'object') return;
    Object.keys(o).forEach((k) => { if (k.charAt(0) === '_' || (k === 'change' && o[k] === 'unchanged')) delete o[k]; else strip(o[k]); });
  };
  strip(sp);
  sp.basedOnVersion = BASE.version;
  return sp;
}
function exportJSON() {
  return { format: 'smyw-feedback@1', title: S.spec.title, baseVersion: BASE.version, stage: S.spec.stage, exportedAt: new Date().toISOString(), approved: !!S.approved, global: S.global, answers: answersList(), comments: S.comments, ops: S.ops, revisedSpec: cleanSpec() };
}
function buildMarkdown(withSpec) {
  const sp = S.spec, L = [], g = S.global;
  L.push('# 原型反馈：' + sp.title, '');
  L.push('> 基于方案 v' + BASE.version + '（' + STAGES[sp.stage] + '）· 导出于 ' + new Date().toLocaleString() + ' · 批注 ' + S.comments.length + ' 条 · 方案修改 ' + S.ops.length + ' 处', '');
  if (S.approved) L.push('**✅ 用户已确认方案' + (S.comments.length || S.ops.length ? '（同时附带以下意见，请一并处理）' : '，可以开始实现') + '**', '');
  if (g.tags.length || g.text || g.ref) {
    L.push('## 整体意见');
    if (g.tags.length) L.push('- 标签：' + g.tags.join('、'));
    if (g.text) L.push('- 意见：' + g.text.replace(/\n/g, '\n  '));
    if (g.ref) L.push('- 风格参考：' + g.ref);
    L.push('');
  }
  const ans = answersList();
  if (ans.length) { L.push('## 对 Agent 问题的回答'); ans.forEach((a) => L.push('- **' + a.question + '**　' + a.answer.replace(/\n/g, '\n  '))); L.push(''); }
  if (S.comments.length) {
    L.push('## 批注');
    S.comments.slice().sort((a, b) => SEVS.indexOf(a.severity) - SEVS.indexOf(b.severity)).forEach((c, i) => L.push((i + 1) + '. **[' + c.severity + '][' + c.category + ']** ' + c.where + '\n   ' + c.text.replace(/\n/g, '\n   ')));
    L.push('');
  }
  if (S.ops.length) { L.push('## 用户直接对方案做的修改（按操作顺序）'); S.ops.forEach((o, i) => L.push((i + 1) + '. ' + o.desc)); L.push(''); }
  if (!S.comments.length && !S.ops.length && !g.tags.length && !g.text && !ans.length && !S.approved) L.push('（暂无反馈）', '');
  L.push('## 给 Agent 的处理说明',
    '- revisedSpec 是用户调整后的完整方案（已相对「改动前」重新标注 added/removed/modified，移动用 movedFrom/movedTo 关联）。以它为基础更新 spec，version + 1，重新构建预览。',
    '- 「必须改」全部落实；「建议」尽量采纳，不采纳要说明理由；「疑问」先回答再动手。',
    '- 线框只表达结构和交互，不代表视觉样式；样式/风格类意见在实现时按项目现有设计规范落实。', '');
  if (withSpec) L.push('<details><summary>revisedSpec（修改后的完整方案 JSON）</summary>', '', FENCE + 'json', JSON.stringify(cleanSpec(), null, 1), FENCE, '', '</details>', '');
  return L.join('\n');
}
async function copyText(s) {
  try { await navigator.clipboard.writeText(s); return true; } catch (e) { /* blocked: fall through */ }
  const ta = h('textarea', { style: 'position:fixed;left:-9999px;top:0' }); ta.value = s; document.body.append(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
  ta.remove(); return ok;
}
async function copyFeedback() {
  const ok = await copyText(buildMarkdown(ui.includeSpec));
  if (ok) { toast('已复制。粘贴到和 Agent 的对话里发送即可。'); return true; }
  if (ui.tab !== 'feedback') ui.tab = 'feedback';
  toast('浏览器不允许自动复制：已选中全部反馈，请按 Ctrl+C / ⌘C 复制。', true);
  // Select after the toast re-render; render() keeps focus on [data-f] fields and focus re-selects.
  const out = document.getElementById('smyw-out');
  if (out) { out.focus(); out.select(); out.scrollIntoView({ block: 'center' }); }
  return false;
}
function download(name, text, type) {
  try { const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' })), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
  catch (e) { toast('当前环境不允许下载，请改用「复制反馈」。', true); }
}

// ------------------------------------------------------------------ boot
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement ? document.activeElement.tagName : '';
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !typing) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
  else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y') && !typing) { e.preventDefault(); redo(); }
  else if (!typing && (e.key === 'Delete' || e.key === 'Backspace') && ui.mode === 'edit' && ui.sel && ui.sel.kind === 'node' && ui.sel.side === 'after') { e.preventDefault(); const s = ui.sel; mutate(() => opDelete(s.page, s.id)); }
  else if (e.key === 'Escape') { ui.sel = null; ui.unit = null; render(); }
  else if (e.key === ' ' && !typing && ui.tab === 'canvas' && !ui.space) { ui.space = true; const v = vpEl(); if (v) v.classList.add('space'); e.preventDefault(); }
});
validateSel();
render();

/* Programmatic handle (used by tests; also handy from the devtools console). */
document.addEventListener('keyup', (e) => { if (e.key === ' ') { ui.space = false; const v = vpEl(); if (v) v.classList.remove('space'); } });
window.addEventListener('resize', () => { if (ui.tab === 'canvas' && ui.cam) applyCam(); });

window.smyw = {
  get state() { return S; }, ui: ui, render: render, undo: undo, redo: redo, setMode: setMode, setTab: setTab,
  setPage: (id) => { ui.page = id; ui.sel = null; render(); },
  get units() { computeUnits(); return UNITS.map((u) => Object.assign({}, u)); },
  focusUnit: focusUnit, focusNode: focusNode, fit: () => fitCam(false), zoomAt: zoomAt,
  op: {
    move: (pid, id, dest) => mutate(() => opMove(pid, id, dest)),
    add: (pid, type, dest) => mutate(() => opAdd(pid, type, dest || {})),
    remove: (pid, id) => mutate(() => opDelete(pid, id)),
    restore: (pid, id) => mutate(() => opRestore(pid, id)),
    convert: (pid, id, kind) => mutate(() => opConvert(pid, id, kind || 'modal')),
    sibling: (pid, id, dir) => mutate(() => opSibling(pid, id, dir)),
    edit: (pid, id, field, val) => editor(() => { const p = pageById(pid); const e = p && findNode(p, id); return e && e.n; }, field, { target: { kind: 'node', page: pid, id: id }, name: ref, prefix: () => pfx(pageById(pid)) })(val),
    stepMove: (fid, id, dir) => mutate(() => opStepMove(fid, id, dir)),
    comment: (target, category, severity, text) => addComment(target, category, severity, text)
  },
  select: (sel) => { ui.sel = sel; render(); },
  exportJSON: exportJSON, buildMarkdown: buildMarkdown, copyFeedback: copyFeedback, storageOk: STORAGE_OK
};
})();
