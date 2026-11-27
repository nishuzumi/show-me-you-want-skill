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
/* Base UI is the component framework the agent composes with. A spec node's `type` can be any
 * Base UI primitive (dialog / switch / accordion / select …); the low-fi renderer draws each one
 * through a wireframe base type so the preview stays a single dependency-free HTML file. */
const BUI = (() => {
  try { return JSON.parse(document.getElementById('smyw-bui').textContent); } catch (e) { return { components: {} }; }
})();
const BUI_C = BUI.components || {};
const BASE_TYPE = {};
Object.keys(BUI_C).forEach((k) => { BASE_TYPE[k] = BUI_C[k].base || k; });
function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function bt(t) { return own(BASE_TYPE, t) ? BASE_TYPE[t] : t; }
function buiInfo(t) { if (own(BUI_C, t)) return BUI_C[t]; const b = bt(t); return b !== t && own(BUI_C, b) ? BUI_C[b] : null; }

const TYPE_LABEL = {
  page: '页面', section: '区块', row: '横排', col: '竖排', grid: '网格', card: '卡片', form: '表单',
  list: '列表', item: '列表项', nav: '导航', tabs: '标签页', header: '页头', footer: '页脚',
  sidebar: '侧栏', toolbar: '工具栏', panel: '面板', group: '分组',
  modal: '弹窗', drawer: '抽屉', popover: '气泡浮层', menu: '下拉菜单',
  button: '按钮', link: '链接', input: '输入框', textarea: '多行输入', select: '下拉框',
  checkbox: '复选框', radio: '单选组', toggle: 'Toggle 按钮', upload: '上传',
  heading: '标题', text: '文本', image: '图片', table: '表格', chart: '图表', stat: '数值',
  badge: '徽标', tag: '标签', icon: '图标', divider: '分割线', placeholder: '占位'
};
Object.keys(BUI_C).forEach((k) => { if (!TYPE_LABEL[k]) TYPE_LABEL[k] = BUI_C[k].name || k; });
const TYPE_ORDER = Object.keys(TYPE_LABEL);
const CONTAINER = new Set(['page', 'section', 'row', 'col', 'grid', 'card', 'form', 'list', 'item', 'nav', 'tabs', 'header', 'footer', 'sidebar', 'toolbar', 'panel', 'group', 'modal', 'drawer', 'popover', 'menu']);
const ROW_TYPES = new Set(['row', 'nav', 'toolbar', 'header', 'footer', 'item']);
const OVERLAY = new Set(['modal', 'drawer', 'popover', 'menu']);
const INLINE = new Set(['button', 'link', 'badge', 'tag', 'icon', 'checkbox', 'toggle']);
const ITEMS_TYPES = new Set(['nav', 'tabs', 'list', 'select', 'radio', 'menu']);
const USES_TEXT = new Set(['input', 'textarea', 'select', 'stat', 'upload']);
Object.keys(BUI_C).forEach((k) => {
  const c = BUI_C[k];
  const base = c.base || k;
  if (c.container) { CONTAINER.add(k); CONTAINER.add(base); }
  if (c.row) { ROW_TYPES.add(k); ROW_TYPES.add(base); }
  if (c.overlay) { OVERLAY.add(k); OVERLAY.add(base); }
  if (c.inline) { INLINE.add(k); INLINE.add(base); }
  if (c.items) { ITEMS_TYPES.add(k); ITEMS_TYPES.add(base); }
  if (c.text) { USES_TEXT.add(k); USES_TEXT.add(base); }
});
const TRIGGER_TYPES = new Set(['button', 'link', 'icon', 'item', 'tag', 'badge', 'text', 'image', 'heading']);
const CHANGE_LABEL = { added: '新增', removed: '删除', modified: '修改', unchanged: '不变' };
const CHANGES = new Set(Object.keys(CHANGE_LABEL));
const ACTORS = { user: '用户', frontend: '前端', backend: '后端', db: '数据库', external: '外部服务', system: '系统/任务' };
const MOD_KINDS = { module: '模块', service: '服务', controller: '控制器', api: '接口组', model: '数据模型', table: '数据表', store: '前端状态', component: '前端组件', job: '定时任务', config: '配置', other: '其他' };
const BE_KINDS = { api: 'API', function: '函数', method: '方法', model: '模型', field: '字段', table: '表', column: '列', job: '任务', event: '事件', config: '配置', state: '状态', other: '其他' };
const STAGES = { prototype: '原型阶段 · 尚未实现', implementing: '实现中', done: '已实现 · 回顾' };
const CATS = ['位置/布局', '交互方式', '组件类型', '样式/风格', '文案', '功能缺失', '功能多余', '数据/字段', '流程/逻辑', '接口/后端', '其他'];
const SEVS = ['必须改', '建议', '疑问'];
const STYLE_TAGS = ['整体风格不符', '和现有页面不统一', '配色', '信息密度过高', '信息密度过低', '层级/导航不清', '交互方式不对', '文案语气', '移动端适配'];
const PALETTE = [
  ['Base UI', ['dialog', 'drawer', 'popover', 'menu', 'select', 'switch', 'checkbox', 'tabs', 'accordion', 'toolbar', 'field', 'form', 'toast', 'tooltip', 'avatar', 'progress', 'separator', 'button', 'input']],
  ['容器', ['section', 'row', 'card', 'list', 'item']],
  ['控件', ['link', 'textarea', 'upload', 'radio']],
  ['展示', ['heading', 'text', 'table', 'image', 'chart', 'stat', 'badge', 'tag', 'icon', 'divider', 'placeholder']]
];
const VARIANTS = [['', '默认'], ['primary', '主要'], ['secondary', '次要'], ['danger', '危险'], ['ghost', '文字/幽灵'], ['icon', '仅图标']];
const WIDTHS = [['', '自动'], ['1/4', '1/4'], ['1/3', '1/3'], ['1/2', '1/2'], ['2/3', '2/3'], ['3/4', '3/4'], ['full', '整行']];
const LAYOUTS = [['', '默认'], ['col', '纵向'], ['row', '横向'], ['grid', '网格']];
const STEP_KINDS = [['', '普通步骤'], ['decision', '判断/分支'], ['note', '备注']];
const FIELD_LABEL = { label: '文字', type: '类型', text: '说明', fn: '函数/行为', variant: '样式', w: '宽度', layout: '排列', cols: '列数', items: '选项', columns: '表格列', trigger: '触发按钮', name: '名称', route: '路由', note: '说明', actor: '执行方', kind: '类型', page: '关联页面', rows: '行数', value: '当前值' };
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
let BASE = JSON.parse(RAW);
let BASE_HASH = hash(JSON.stringify(BASE));
let VERSIONS = (() => {
  try {
    const el = document.getElementById('smyw-versions');
    if (!el) return [];
    const arr = JSON.parse(el.textContent);
    return Array.isArray(arr) ? arr.filter((v) => v && typeof v === 'object' && v.spec) : [];
  } catch (e) { return []; }
})();
const LIVE_CFG = (() => {
  try {
    const el = document.getElementById('smyw-live');
    if (!el) return null;
    const obj = JSON.parse(el.textContent);
    return obj && obj.enabled && obj.token ? obj : null;
  } catch (e) { return null; }
})();
let LATEST_VER = Number(BASE.version) || (VERSIONS.length ? Number(VERSIONS[VERSIONS.length - 1].version) : 1);
let PREV_VER = VERSIONS.length >= 3 ? Number(VERSIONS[VERSIONS.length - 2].version) : 0;
let HAS_MULTI_VER = VERSIONS.length > 2;
function verByNum(n) { return VERSIONS.find((v) => Number(v.version) === Number(n)) || null; }
function versionSnap(ver) { const v = verByNum(ver); return v ? v.spec : null; }

let KEY = 'smyw:' + BASE_HASH;
let BASE_IDS = collectSpecIds(normalize(clone(BASE)));
let S = loadState() || freshState();
let CUR = S.spec;
let undoStack = [];
let redoStack = [];
const uiSaved = readJSON(KEY + ':ui') || {};
const initLeft = HAS_MULTI_VER && uiSaved.leftVer != null && verByNum(uiSaved.leftVer) ? Number(uiSaved.leftVer) : (HAS_MULTI_VER ? PREV_VER : 0);
const initRight = HAS_MULTI_VER && uiSaved.rightVer != null && verByNum(uiSaved.rightVer) ? Number(uiSaved.rightVer) : LATEST_VER;
const ui = { tab: ['canvas', 'flows', 'backend', 'feedback'].indexOf(uiSaved.tab) >= 0 ? uiSaved.tab : 'canvas', page: uiSaved.page, leftVer: initLeft, rightVer: initRight, diffView: ['split', 'wipe'].indexOf(uiSaved.diffView) >= 0 ? uiSaved.diffView : 'split', diffMode: uiSaved.diffMode === true, showPins: uiSaved.showPins !== false, showAllPanels: uiSaved.showAllPanels === true, listOpen: false, listCollapsed: uiSaved.listCollapsed === true, palQuery: '', wipePos: {}, preview: { vis: {}, st: {}, checks: {}, selects: {} }, mode: 'view', sel: null, unit: null, cam: null, showLinks: false, play: null, showFn: false, showComp: false, space: false, panMoved: false, includeSpec: false, confirmReset: false, toast: null };
const live = {
  enabled: !!LIVE_CFG,
  token: LIVE_CFG ? String(LIVE_CFG.token) : '',
  driver: LIVE_CFG ? String(LIVE_CFG.driver || 'queue') : 'queue',
  open: !!LIVE_CFG,
  sseState: LIVE_CFG ? 'connecting' : 'closed',
  agentConnected: !!(LIVE_CFG && LIVE_CFG.driver === 'claude'),
  busy: false,
  busyStatus: '',
  approved: false,
  confirmApprove: false,
  messages: [],
  stream: null,
  draft: '',
  attachSel: true,
  unread: 0,
  es: null
};
syncViewSpec();
if (!pageById(ui.page)) { const first = CUR.pages.find((p) => pageStatus(p) !== 'unchanged') || CUR.pages[0]; ui.page = first ? first.id : null; }
let drag = null;
let dropEl = null;
let toastTimer = 0;
let hoverKey = null;

function reloadSpec(nextSpec, nextVersions, opts) {
  if (!nextSpec || typeof nextSpec !== 'object') return false;
  const keepCam = ui.cam ? Object.assign({}, ui.cam) : null;
  const prevVer = LATEST_VER;
  BASE = clone(nextSpec);
  BASE_HASH = hash(JSON.stringify(BASE));
  VERSIONS = Array.isArray(nextVersions) ? nextVersions.filter((v) => v && typeof v === 'object' && v.spec) : VERSIONS;
  LATEST_VER = Number(BASE.version) || (VERSIONS.length ? Number(VERSIONS[VERSIONS.length - 1].version) : 1);
  PREV_VER = VERSIONS.length >= 3 ? Number(VERSIONS[VERSIONS.length - 2].version) : 0;
  HAS_MULTI_VER = VERSIONS.length > 2;
  KEY = 'smyw:' + BASE_HASH;
  BASE_IDS = collectSpecIds(normalize(clone(BASE)));
  S = freshState();
  undoStack = [];
  redoStack = [];
  if (HAS_MULTI_VER) {
    ui.leftVer = PREV_VER;
    ui.rightVer = LATEST_VER;
  } else {
    ui.leftVer = 0;
    ui.rightVer = LATEST_VER;
  }
  if (isHistoryView() && ui.mode === 'edit') ui.mode = 'view';
  syncViewSpec();
  validateSel();
  if (!pageById(ui.page)) { const first = CUR.pages.find((p) => pageStatus(p) !== 'unchanged') || CUR.pages[0]; ui.page = first ? first.id : null; }
  ui.cam = keepCam;
  save();
  render();
  if (!opts || opts.silent !== true) {
    const label = LATEST_VER !== prevVer ? ('v' + prevVer + ' → v' + LATEST_VER) : ('v' + LATEST_VER);
    toast('方案已热更新（' + label + '）');
  }
  return true;
}

function collectSpecIds(sp) {
  const s = new Set();
  (sp.pages || []).forEach((p) => { s.add(p.id); entries(p).forEach((e) => s.add(e.n.id)); });
  (sp.flows || []).forEach((f) => { s.add(f.id); (f.steps || []).forEach((x) => s.add(x.id)); });
  (sp.backend || []).forEach((m) => { s.add(m.id); (m.items || []).forEach((x) => s.add(x.id)); });
  return s;
}
function freshState() { return { spec: normalize(clone(BASE)), ops: [], comments: [], global: { tags: [], text: '', ref: '' }, answers: {}, approved: false, seq: 0 }; }
function loadState() { const s = readJSON(KEY); return s && s.spec && Array.isArray(s.ops) && Array.isArray(s.comments) ? s : null; }
function save() { writeJSON(KEY, S); writeJSON(KEY + ':ui', { tab: ui.tab, page: ui.page, leftVer: ui.leftVer, rightVer: ui.rightVer, diffView: ui.diffView, diffMode: ui.diffMode, showPins: ui.showPins, showAllPanels: ui.showAllPanels, listCollapsed: ui.listCollapsed }); }

// ------------------------------------------------------------------ multi-version diff engine
function isHistoryView() { return HAS_MULTI_VER && ui.rightVer !== LATEST_VER; }
function isFullBaseView() { return ui.leftVer === 0 && ui.rightVer === LATEST_VER; }
function verShort(v) {
  v = Number(v);
  if (v === 0) return 'v0 现状';
  if (v === LATEST_VER && HAS_MULTI_VER) return 'v' + v + ' 最新';
  return 'v' + v;
}
function verOptLabel(entry) {
  const v = Number(entry.version);
  const base = v === 0 ? 'v0 现状' : ('v' + v + (v === LATEST_VER ? ' 最新' : ''));
  const note = v === 0 ? '' : (entry.note ? ' · ' + short(entry.note, 22) : '');
  return base + note;
}
function sideLabel(side) {
  if (!HAS_MULTI_VER) return side === 'before' ? '改动前' : '改动后';
  return side === 'before' ? verShort(ui.leftVer) : verShort(ui.rightVer);
}

function extractAfterItems(arr) {
  if (!Array.isArray(arr)) return undefined;
  const out = [];
  arr.forEach((x) => {
    if (x && typeof x === 'object') {
      if (x.change === 'removed') return;
      if (x.label != null) out.push(String(x.label));
    } else if (x != null) out.push(String(x));
  });
  return out;
}
function extractAfterObj(o, childKeys) {
  if (!o || typeof o !== 'object' || o.change === 'removed') return null;
  const out = {};
  const skip = new Set(['change', 'before', 'movedFrom', 'movedTo', '_um'].concat(childKeys));
  Object.keys(o).forEach((k) => {
    if (skip.has(k)) return;
    if (k === 'items' && childKeys.indexOf('items') < 0) { out.items = extractAfterItems(o.items); return; }
    if (k === 'columns') { out.columns = extractAfterItems(o.columns); return; }
    out[k] = clone(o[k]);
  });
  childKeys.forEach((ck) => {
    if (ck === 'root') out.root = o.root ? extractAfterObj(o.root, ['children']) : { type: 'page', children: [] };
    else if (Array.isArray(o[ck])) {
      const subKeys = ck === 'children' || ck === 'overlays' ? ['children'] : [];
      const kids = o[ck].map((c) => extractAfterObj(c, subKeys)).filter(Boolean);
      if (kids.length || ck !== 'children') out[ck] = kids;
    }
  });
  return out;
}
function extractAfter(sp) {
  return {
    title: sp.title || '未命名变更', version: Number(sp.version) || 1, stage: sp.stage || 'prototype',
    summary: sp.summary, versionNote: sp.versionNote, changes: clone(sp.changes || []), questions: clone(sp.questions || []),
    pages: (sp.pages || []).map((p) => extractAfterObj(p, ['root', 'overlays'])).filter(Boolean),
    flows: (sp.flows || []).map((f) => extractAfterObj(f, ['steps'])).filter(Boolean),
    backend: (sp.backend || []).map((m) => extractAfterObj(m, ['items'])).filter(Boolean)
  };
}

function diffItemList(lRaw, rRaw) {
  const L = (lRaw || []).map(itemText), R = (rRaw || []).map(itemText);
  if (same(L, R)) return null;
  const m = L.length, n = R.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = L[i] === R[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (L[i] === R[j]) { out.push(R[j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ label: L[i], change: 'removed' }); i++; }
    else { out.push({ label: R[j], change: 'added' }); j++; }
  }
  while (i < m) { out.push({ label: L[i], change: 'removed' }); i++; }
  while (j < n) { out.push({ label: R[j], change: 'added' }); j++; }
  return out;
}
function mergeLists(lArr, rArr, onSame, onAdded, onRemoved) {
  const L = Array.isArray(lArr) ? lArr : [];
  const R = Array.isArray(rArr) ? rArr : [];
  const lMap = new Map(), rMap = new Map();
  L.forEach((x) => { if (x && x.id != null) lMap.set(String(x.id), x); });
  R.forEach((x) => { if (x && x.id != null) rMap.set(String(x.id), x); });
  const out = [];
  let li = 0;
  R.forEach((rx) => {
    const id = rx && rx.id != null ? String(rx.id) : null;
    if (id && lMap.has(id)) {
      while (li < L.length) {
        const lx = L[li];
        const lid = lx && lx.id != null ? String(lx.id) : null;
        if (lid === id) { li++; break; }
        if (!lid || !rMap.has(lid)) { const rm = onRemoved(lx); if (rm) out.push(rm); }
        li++;
      }
      const m = onSame(lMap.get(id), rx); if (m) out.push(m);
    } else {
      const ad = onAdded(rx); if (ad) out.push(ad);
    }
  });
  while (li < L.length) {
    const lx = L[li++];
    const lid = lx && lx.id != null ? String(lx.id) : null;
    if (!lid || !rMap.has(lid)) { const rm = onRemoved(lx); if (rm) out.push(rm); }
  }
  return out;
}
function cloneWithChange(o, change, childKeys, suffix) {
  const c = clone(o);
  const walk = (x, isTop) => {
    if (!x || typeof x !== 'object') return;
    if (suffix && x.id != null) x.id = String(x.id) + suffix;
    x.change = isTop ? change : 'unchanged';
    delete x.before; delete x.movedFrom; delete x.movedTo; delete x._um;
    if (isTop && change === 'removed') delete x.note;
    childKeys.forEach((ck) => {
      if (ck === 'root' && x.root) walk(x.root, false);
      else if (Array.isArray(x[ck])) x[ck].forEach((ch) => walk(ch, false));
    });
  };
  walk(c, true);
  return c;
}
function diffFields(lo, ro, skipSet, itemKeys, diffNote) {
  const out = clone(ro);
  const before = {};
  let changed = false;
  const keys = new Set(Object.keys(lo).concat(Object.keys(ro)));
  keys.forEach((k) => {
    if (skipSet.has(k)) return;
    if (k === 'note' && !diffNote) return;
    if (itemKeys && itemKeys.has(k)) {
      const merged = diffItemList(lo[k], ro[k]);
      if (merged) { out[k] = merged; changed = true; }
      return;
    }
    const lv = isEmpty(lo[k]) ? null : lo[k];
    const rv = isEmpty(ro[k]) ? null : ro[k];
    if (!same(lv, rv)) { before[k] = clone(lv); changed = true; }
  });
  if (!diffNote) {
    if (changed || (ro.note && ro.note !== lo.note)) { if (ro.note) out.note = ro.note; }
    else delete out.note;
  }
  if (Object.keys(before).length) out.before = before; else delete out.before;
  out.change = changed ? 'modified' : 'unchanged';
  return out;
}
function indexPageNodes(p) {
  const idx = new Map();
  const walk = (n, parId, listKey) => {
    if (!n || typeof n !== 'object') return;
    if (n.id != null) idx.set(String(n.id), { n: n, parId: parId, listKey: listKey });
    (n.children || []).forEach((c) => walk(c, n.id != null ? String(n.id) : null, 'children'));
  };
  if (p && p.root) walk(p.root, null, 'root');
  if (p && Array.isArray(p.overlays)) p.overlays.forEach((o) => walk(o, null, 'overlays'));
  return idx;
}
function diffPage(lp, rp) {
  const lIdx = indexPageNodes(lp), rIdx = indexPageNodes(rp);
  const NODE_SKIP = new Set(['id', 'children', 'change', 'before', 'movedFrom', 'movedTo', '_um']);
  const ITEM_KEYS = new Set(['items', 'columns']);
  const diffNode = (ln, rn) => {
    const out = diffFields(ln, rn, NODE_SKIP, ITEM_KEYS, false);
    const lKids = ln.children || [], rKids = rn.children || [];
    if (lKids.length || rKids.length) {
      out.children = diffNodeList(lKids, rKids);
    } else delete out.children;
    return out;
  };
  const diffNodeList = (lKids, rKids) => mergeLists(
    lKids, rKids,
    (ln, rn) => diffNode(ln, rn),
    (rn) => {
      const id = rn.id != null ? String(rn.id) : null;
      const ad = cloneWithChange(rn, 'added', ['children'], '');
      if (id && lIdx.has(id)) ad.movedFrom = id + '__from';
      return ad;
    },
    (ln) => {
      const id = ln.id != null ? String(ln.id) : null;
      if (id && rIdx.has(id)) {
        const g = cloneWithChange(ln, 'removed', ['children'], '__from');
        g.movedTo = id;
        return g;
      }
      return cloneWithChange(ln, 'removed', ['children'], '');
    }
  );
  const PAGE_SKIP = new Set(['id', 'root', 'overlays', 'change', 'before', 'movedFrom', 'movedTo', '_um']);
  const out = diffFields(lp, rp, PAGE_SKIP, null, false);
  out.root = diffNode(lp.root || { type: 'page', children: [] }, rp.root || { type: 'page', children: [] });
  out.overlays = diffNodeList(lp.overlays || [], rp.overlays || []);
  return out;
}
function diffSpecs(L, R) {
  const STEP_SKIP = new Set(['id', 'change', 'before', 'movedFrom', 'movedTo', '_um']);
  const FLOW_SKIP = new Set(['id', 'steps', 'change', 'before', 'movedFrom', 'movedTo', '_um']);
  const MOD_SKIP = new Set(['id', 'items', 'change', 'before', 'movedFrom', 'movedTo', '_um']);
  const BE_SKIP = new Set(['id', 'change', 'before', 'movedFrom', 'movedTo', '_um']);
  return {
    title: R.title || L.title || S.spec.title,
    version: R.version,
    stage: R.stage || S.spec.stage,
    summary: R.summary || '',
    versionNote: R.versionNote || '',
    changes: clone(R.changes || []),
    questions: ui.rightVer === LATEST_VER ? clone(S.spec.questions || []) : clone(R.questions || []),
    pages: mergeLists(L.pages, R.pages, diffPage, (rp) => cloneWithChange(rp, 'added', ['root', 'overlays'], ''), (lp) => cloneWithChange(lp, 'removed', ['root', 'overlays'], '')),
    flows: mergeLists(L.flows, R.flows, (lf, rf) => {
      const out = diffFields(lf, rf, FLOW_SKIP, null, false);
      out.steps = mergeLists(lf.steps, rf.steps, (ls, rs) => diffFields(ls, rs, STEP_SKIP, null, false), (rs) => cloneWithChange(rs, 'added', [], ''), (ls) => cloneWithChange(ls, 'removed', [], ''));
      return out;
    }, (rf) => cloneWithChange(rf, 'added', ['steps'], ''), (lf) => cloneWithChange(lf, 'removed', ['steps'], '')),
    backend: mergeLists(L.backend, R.backend, (lm, rm) => {
      const out = diffFields(lm, rm, MOD_SKIP, null, true);
      out.items = mergeLists(lm.items, rm.items, (li, ri) => diffFields(li, ri, BE_SKIP, null, true), (ri) => cloneWithChange(ri, 'added', [], ''), (li) => cloneWithChange(li, 'removed', [], ''));
      return out;
    }, (rm) => cloneWithChange(rm, 'added', ['items'], ''), (lm) => cloneWithChange(lm, 'removed', ['items'], ''))
  };
}
function syncViewSpec() {
  if (!HAS_MULTI_VER || isFullBaseView()) { CUR = S.spec; return; }
  const L = versionSnap(ui.leftVer);
  const R = ui.rightVer === LATEST_VER ? extractAfter(S.spec) : versionSnap(ui.rightVer);
  if (!L || !R) { CUR = S.spec; return; }
  CUR = normalize(diffSpecs(L, R));
}
function setVersions(l, r) {
  if (!HAS_MULTI_VER) return;
  const ln = Number(l), rn = Number(r);
  if (!verByNum(ln) || !verByNum(rn)) return;
  ui.leftVer = ln; ui.rightVer = rn;
  ui.sel = null; ui.unit = null; ui.cam = null; hoverKey = null;
  if (isHistoryView() && ui.mode === 'edit') ui.mode = 'view';
  syncViewSpec();
  validateSel();
  save(); render();
}

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
function pageById(id) { return CUR.pages.find((p) => p.id === id); }
function flowById(id) { return CUR.flows.find((f) => f.id === id); }
function curPage() { return pageById(ui.page) || CUR.pages[0]; }
function ePageById(id) { return S.spec.pages.find((p) => p.id === id); }
function eFlowById(id) { return S.spec.flows.find((f) => f.id === id); }
function eFindBe(id) { for (const m of S.spec.backend) { if (m.id === id) return { m: m, item: null }; const it = m.items.find((i) => i.id === id); if (it) return { m: m, item: it }; } return null; }
function entries(p) { const out = []; const walk = (n, par, list) => { out.push({ n: n, par: par, list: list }); (n.children || []).forEach((c) => walk(c, n, n.children)); }; walk(p.root, null, null); p.overlays.forEach((o) => walk(o, null, p.overlays)); return out; }
function findNode(p, id) { return entries(p).find((e) => e.n.id === id) || null; }
function contains(a, b) { return a === b || (a.children || []).some((c) => contains(c, b)); }
function isCont(n) { return CONTAINER.has(bt(n.type)) || !!(n.children && n.children.length); }
function afterVisibleIds(p) { const s = new Set(); const walk = (n) => { if (n.change === 'removed') return; s.add(n.id); (n.children || []).forEach(walk); }; walk(p.root); p.overlays.forEach(walk); return s; }
function parentChain(p, id) { let chain = null; const walk = (n, path) => { if (n.id === id) { chain = path; return true; } return (n.children || []).some((c) => walk(c, path.concat([n]))); }; if (!walk(p.root, [])) p.overlays.some((o) => walk(o, [])); return chain || []; }
function findBe(id) { for (const m of CUR.backend) { if (m.id === id) return { m: m, item: null }; const it = m.items.find((i) => i.id === id); if (it) return { m: m, item: it }; } return null; }
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

function allIds() { return collectSpecIds(S.spec); }
function newId(extraTaken) {
  const ids = allIds();
  let id;
  do { S.seq = (S.seq || 0) + 1; id = 'u' + S.seq; } while (ids.has(id) || BASE_IDS.has(id) || (extraTaken && extraTaken.has(id)));
  if (extraTaken) extraTaken.add(id);
  return id;
}

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
/* Interactions (prototype): node.on = [{ action, target, state }], node.hidden, node.states + node.state.
 * Overlays' trigger lists are folded in as { action: 'open' }. */
const IA_VERB = { open: '打开', close: '关闭', navigate: '跳到', toggle: '展开 / 收起', show: '显示', hide: '隐藏', state: '切换', back: '返回上一步' };
const IA_SHORT = { open: '打开', close: '关闭', navigate: '跳转', toggle: '展开/收起', show: '显示', hide: '隐藏', state: '切换', back: '返回' };
function nodeOn(n) { return Array.isArray(n && n.on) ? n.on.filter((x) => x && typeof x === 'object').map((x) => Object.assign({}, x, { action: x.action || x.do || 'open' })) : []; }
function interactionsOf(p, n, side) {
  const out = nodeOn(n);
  CUR.pages.forEach((q) => q.overlays.forEach((x) => {
    if (x === n || !visible(x, side) || !trigList(view(x, side)).includes(n.id)) return;
    if (!out.some((i) => i.action === 'open' && i.target === x.id)) out.push({ action: 'open', target: x.id });
  }));
  return out;
}
function stateNames(n) { return n && n.states && typeof n.states === 'object' && !Array.isArray(n.states) ? Object.keys(n.states) : []; }
function curState(n, ctx) {
  if (ctx === 'play' && ui.play && ui.play.st[n.id] !== undefined) return ui.play.st[n.id];
  if (ctx === 'canvas' && ui.preview.st[n.id] !== undefined) return ui.preview.st[n.id];
  return n.state || null;
}
function withState(n, v, ctx) { const s = curState(n, ctx); const ov = s && stateNames(n).indexOf(s) >= 0 ? n.states[s] : null; return ov && typeof ov === 'object' ? Object.assign({}, v, ov) : v; }
function playVisible(n) { const v = ui.play ? ui.play.vis[n.id] : undefined; return v === undefined ? !n.hidden : v; }
function canvasVisible(n) { const v = ui.preview.vis[n.id]; return v === undefined ? !n.hidden : v; }
function isTabPanel(p, n) {
  if (!p || !n || n === p.root) return false;
  const e = findNode(p, n.id);
  if (!e || !e.par || bt(e.par.type) !== 'tabs') return false;
  if (n.hidden) return true;
  return entries(p).some((x) => nodeOn(x.n).some((i) => i.target === n.id && i.action === 'hide'));
}
function tabTriggerTarget(p, n) {
  const show = nodeOn(n).find((i) => i.action === 'show' && i.target);
  if (!show) return null;
  const e = p && findNode(p, show.target);
  return e && isTabPanel(p, e.n) ? e.n : null;
}
function runCanvasIA(p, n) {
  const list = nodeOn(n);
  if (!list.length) return false;
  const tabActs = list.filter((i) => (i.action === 'show' || i.action === 'hide') && i.target && findNode(p, i.target) && isTabPanel(p, findNode(p, i.target).n));
  if (tabActs.length) {
    tabActs.forEach((i) => { ui.preview.vis[i.target] = i.action === 'show'; });
    render();
    return true;
  }
  return false;
}
function isRevealed(n, p) {
  if (!n || !n.hidden) return false;
  if (p && isTabPanel(p, n)) return false;
  return showersOf(n.id).length > 0;
}
function showersOf(id) { const out = []; CUR.pages.forEach((p) => entries(p).forEach((e) => { if (nodeOn(e.n).some((i) => i.target === id && /^(toggle|show)$/.test(i.action))) out.push(e.n); })); return out; }
function iaTargetName(i) {
  if (i.action === 'navigate') { const q = pageById(i.target); return q ? '页面「' + pageName(q) + '」' : '#' + i.target; }
  if (!i.target) return i.action === 'close' ? '所在的弹层' : '';
  const f = findNodeAnywhere(i.target); return f ? nlabel(f.e.n) : '#' + i.target;
}
function iaText(i) { return '点击 → ' + (IA_VERB[i.action] || i.action) + ' ' + iaTargetName(i) + (i.action === 'state' && i.state ? ' 为「' + i.state + '」' : '') + (i.note ? '（' + i.note + '）' : ''); }
function remapTriggers(p, map) { const vis = afterVisibleIds(p); entries(p).forEach((e) => { const n = e.n; const l = trigList(n); if (vis.has(n.id) && l.some((t) => map[t])) setField(n, 'trigger', trigValue(l.map((t) => map[t] || t))); }); }
function clearTriggers(p, ids) { const vis = afterVisibleIds(p); entries(p).forEach((e) => { const l = trigList(e.n); if (vis.has(e.n.id) && l.some((t) => ids.has(t))) setField(e.n, 'trigger', trigValue(l.filter((t) => !ids.has(t)))); }); }
function insertAt(tgt, node, pos) {
  if (!tgt.list || (pos === 'inside' && isCont(tgt.n))) { if (!tgt.n.children) tgt.n.children = []; tgt.n.children.push(node); return; }
  const i = tgt.list.indexOf(tgt.n);
  tgt.list.splice(pos === 'before' ? i : i + 1, 0, node);
}

// ------------------------------------------------------------------ labels
function tname(t) { return own(TYPE_LABEL, t) ? TYPE_LABEL[t] : (t || '元素'); }
function nlabel(n) { const s = short(n.label || n.text || (Array.isArray(n.items) && n.items.length ? itemText(n.items[0]) : '') || n.fn || '', 20); return tname(n.type) + (s ? '「' + s + '」' : ''); }
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
  if (live.enabled && live.busy) { toast('Agent 正在处理当前请求，请稍候再修改画布', true); return false; }
  const snap = JSON.stringify(S);
  let op;
  try { op = fn(); } catch (err) { S = JSON.parse(snap); syncViewSpec(); console.error(err); toast('操作失败：' + err.message, true); return false; }
  if (op === false) { S = JSON.parse(snap); syncViewSpec(); return false; }
  undoStack.push(snap); if (undoStack.length > 300) undoStack.shift();
  redoStack = [];
  if (op && op.desc) { op.ts = new Date().toISOString(); S.ops.push(op); }
  syncViewSpec(); save(); validateSel(); render();
  return true;
}
function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(S)); S = JSON.parse(undoStack.pop()); syncViewSpec(); save(); validateSel(); render(); }
function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(S)); S = JSON.parse(redoStack.pop()); syncViewSpec(); save(); validateSel(); render(); }
function selectNode(pid, id) { ui.sel = { kind: 'node', page: pid, id: id, side: 'after' }; }
function pfx(p) { return '页面「' + pageName(p) + '」：'; }

function makeNode(type) {
  const base = bt(type);
  const defaults = {
    button: '新按钮', heading: '新标题', text: '文本内容', input: '字段名', textarea: '字段名', select: '字段名', placeholder: '其余内容',
    dialog: '新弹窗', 'alert-dialog': '确认操作', drawer: '新抽屉', popover: '新气泡', menu: '新菜单', 'context-menu': '右键菜单',
    tooltip: '提示文字', 'preview-card': '预览卡片', toast: '操作成功', switch: '新开关', checkbox: '新复选框', 'checkbox-group': '多选',
    tabs: '标签页', accordion: '折叠面板', collapsible: '可折叠区块', toolbar: '工具栏', menubar: '菜单栏', 'navigation-menu': '导航',
    field: '字段', fieldset: '字段组', form: '表单', avatar: 'AB', progress: '进度', meter: '指标', slider: '滑块', separator: '',
    'radio-group': '单选', combobox: '选择或输入', autocomplete: '搜索', 'number-field': '数量', 'otp-field': '验证码', 'scroll-area': '滚动区域'
  };
  const n = { id: newId(), type: type, change: 'added' };
  if (base !== 'divider') n.label = defaults[type] || ('新' + tname(type));
  if (CONTAINER.has(type) || CONTAINER.has(base)) n.children = [];
  if (type === 'table' || base === 'table') n.columns = ['列 1', '列 2', '列 3'];
  if ((ITEMS_TYPES.has(type) || ITEMS_TYPES.has(base)) && base !== 'list') n.items = ['选项 1', '选项 2'];
  if (base === 'progress' || type === 'slider') n.value = 60;
  return n;
}
function opMove(pid, id, dest) {
  const p = ePageById(pid); if (!p) return false;
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
  const p = ePageById(pid); const e = p && findNode(p, id); if (!e || !e.list) return false;
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
  const p = ePageById(pid); if (!p) return false;
  const n = makeNode(type);
  let where;
  if (OVERLAY.has(type) || dest.overlays) { p.overlays.push(n); where = '弹层区'; }
  else if (!dest.targetId) { if (!p.root.children) p.root.children = []; p.root.children.push(n); where = '页面末尾'; }
  else { const t = findNode(p, dest.targetId); if (!t) return false; where = relText(t.n, dest.pos); insertAt(t, n, dest.pos); }
  selectNode(pid, n.id);
  return { type: 'add', page: pid, node: n.id, nodeType: type, desc: pfx(p) + '新增' + tname(type) + ' #' + n.id + '，放在' + where + (OVERLAY.has(type) ? '（需要指定由哪个按钮触发）' : '') };
}
function opDelete(pid, id) {
  const p = ePageById(pid); const e = p && findNode(p, id); if (!e || !e.list) return false;
  const name = ref(e.n);
  const ids = new Set(); (function walk(n) { ids.add(n.id); (n.children || []).forEach(walk); })(e.n);
  if (e.n.change === 'added') {
    e.list.splice(e.list.indexOf(e.n), 1);
    if (e.n.movedFrom) { const g = findNode(p, e.n.movedFrom); if (g) delete g.n.movedTo; }
  } else { e.n.change = 'removed'; delete e.n._um; }
  clearTriggers(p, ids);
  ui.sel = null;
  return { type: 'delete', page: pid, node: id, desc: pfx(p) + '删除' + name };
}
function restoreFromSnap(srcObj, childKeys) {
  childKeys = childKeys || ['children'];
  const taken = new Set([...allIds(), ...BASE_IDS]);
  const c = clone(srcObj);
  const idMap = {};
  const walk = (x, isTop) => {
    if (!x || typeof x !== 'object') return;
    const orig = x.id != null ? String(x.id) : '';
    if (!orig || taken.has(orig)) {
      const nid = newId(taken);
      if (orig) idMap[orig] = nid;
      x.id = nid;
    } else {
      x.id = orig;
      taken.add(orig);
    }
    x.change = isTop ? 'added' : 'unchanged';
    delete x.before; delete x.movedFrom; delete x.movedTo; delete x._um;
    childKeys.forEach((ck) => {
      if (ck === 'root' && x.root) walk(x.root, false);
      else if (Array.isArray(x[ck])) x[ck].forEach((ch) => walk(ch, false));
    });
  };
  walk(c, true);
  if (Object.keys(idMap).length) {
    const remap = (x) => {
      if (!x || typeof x !== 'object') return;
      if (x.trigger != null) {
        const l = trigList(x);
        if (l.some((t) => idMap[t])) x.trigger = trigValue(l.map((t) => idMap[t] || t));
      }
      if (Array.isArray(x.on)) {
        x.on.forEach((ia) => { if (ia && ia.target && idMap[String(ia.target)]) ia.target = idMap[String(ia.target)]; });
      }
      childKeys.forEach((ck) => {
        if (ck === 'root' && x.root) remap(x.root);
        else if (Array.isArray(x[ck])) x[ck].forEach(remap);
      });
    };
    remap(c);
  }
  return c;
}
function insertNearOldSib(targetList, oldList, oldItem, item, visIds) {
  const oldIdx = Array.isArray(oldList) ? oldList.indexOf(oldItem) : -1;
  if (oldIdx >= 0) {
    for (let i = oldIdx - 1; i >= 0; i--) {
      const pid = oldList[i] && oldList[i].id != null ? String(oldList[i].id) : null;
      if (!pid || (visIds && !visIds.has(pid))) continue;
      const k = targetList.findIndex((x) => x.id === pid);
      if (k >= 0) { targetList.splice(k + 1, 0, item); return; }
    }
    for (let i = oldIdx + 1; i < oldList.length; i++) {
      const nid = oldList[i] && oldList[i].id != null ? String(oldList[i].id) : null;
      if (!nid || (visIds && !visIds.has(nid))) continue;
      const k = targetList.findIndex((x) => x.id === nid);
      if (k >= 0) { targetList.splice(k, 0, item); return; }
    }
  }
  targetList.splice(oldIdx >= 0 ? Math.min(oldIdx, targetList.length) : targetList.length, 0, item);
}
function diffAgainstV0Ghost(ghostV0, nodeAfter) {
  const skip = new Set(['id', 'children', 'change', 'before', 'movedFrom', 'movedTo', '_um', 'note']);
  const before = {};
  const keys = new Set(Object.keys(ghostV0).concat(Object.keys(nodeAfter)));
  keys.forEach((k) => {
    if (skip.has(k)) return;
    const lv = isEmpty(ghostV0[k]) ? null : ghostV0[k];
    const rv = isEmpty(nodeAfter[k]) ? null : nodeAfter[k];
    if (!same(lv, rv)) before[k] = clone(lv);
  });
  return Object.keys(before).length ? before : null;
}
function opRestore(pid, id) {
  const p = ePageById(pid); if (!p) return false;
  const vis = afterVisibleIds(p);
  // Virtual move ghost (id + '__from') from multi-version diff: put the node back into its leftVer container.
  if (String(id).endsWith('__from')) {
    const realId = String(id).slice(0, -6);
    const cur = findNode(p, realId);
    const L = versionSnap(ui.leftVer);
    const lp = L && (L.pages || []).find((x) => x.id === pid);
    const old = lp && findNode(lp, realId);
    if (!cur || !cur.list || !old) return false;
    const isOv = old.list === lp.overlays;
    const oldParE = !isOv && old.par ? findNode(p, old.par.id) : null;
    const useOldPar = !isOv && oldParE && vis.has(oldParE.n.id) && !contains(cur.n, oldParE.n);
    const targetList = isOv ? p.overlays : (useOldPar ? (oldParE.n.children || (oldParE.n.children = [])) : (p.root.children || (p.root.children = [])));
    // Only move the node in-place (keeping realId) when it was added/moved since v0; otherwise use opMove so v0 baseline stays truthful.
    if (cur.n.change === 'added') {
      const name = ref(cur.n);
      cur.list.splice(cur.list.indexOf(cur.n), 1);
      const ghost = cur.n.movedFrom ? findNode(p, cur.n.movedFrom) : null;
      if (ghost && ghost.n.change === 'removed' && ghost.list === targetList) {
        ghost.list.splice(ghost.list.indexOf(ghost.n), 1);
        delete cur.n.movedFrom;
        const b = diffAgainstV0Ghost(ghost.n, cur.n);
        if (b) { cur.n.before = b; cur.n.change = 'modified'; }
        else { delete cur.n.before; cur.n.change = 'unchanged'; }
      }
      insertNearOldSib(targetList, old.list, old.n, cur.n, vis);
      selectNode(pid, cur.n.id);
      return { type: 'restore', page: pid, node: cur.n.id, desc: pfx(p) + '撤销移动：把' + name + '放回 v' + ui.leftVer + ' 的原位置' };
    }
    const oldIdx = Array.isArray(old.list) ? old.list.indexOf(old.n) : -1;
    let dest = isOv ? { overlays: true } : { targetId: useOldPar ? oldParE.n.id : p.root.id, pos: 'inside' };
    if (!isOv && oldIdx >= 0) {
      for (let i = oldIdx - 1; i >= 0; i--) {
        const sid = old.list[i] && old.list[i].id != null ? String(old.list[i].id) : null;
        if (sid && vis.has(sid) && targetList.some((x) => x.id === sid)) { dest = { targetId: sid, pos: 'after' }; break; }
      }
      if (dest.pos === 'inside') {
        for (let i = oldIdx + 1; i < old.list.length; i++) {
          const sid = old.list[i] && old.list[i].id != null ? String(old.list[i].id) : null;
          if (sid && vis.has(sid) && targetList.some((x) => x.id === sid)) { dest = { targetId: sid, pos: 'before' }; break; }
        }
      }
    }
    const op = opMove(pid, realId, dest);
    if (op) op.desc = pfx(p) + '撤销移动：把' + ref(cur.n) + '放回 v' + ui.leftVer + ' 的原位置';
    return op;
  }
  const e = findNode(p, id);
  if (e && e.n.change === 'removed') {
    if (e.n.movedTo) { const m = findNode(p, e.n.movedTo); if (m && m.list && m.n.change === 'added') m.list.splice(m.list.indexOf(m.n), 1); delete e.n.movedTo; }
    e.n.change = e.n.before ? 'modified' : 'unchanged';
    return { type: 'restore', page: pid, node: id, desc: pfx(p) + '恢复' + ref(e.n) + '（取消删除/移动）' };
  }
  // Deleted between leftVer (>0) and latest: copy back from leftVer snapshot.
  const L = versionSnap(ui.leftVer);
  const lp = L && (L.pages || []).find((x) => x.id === pid);
  const old = lp && findNode(lp, id);
  if (!old) return false;
  const restored = restoreFromSnap(old.n, ['children']);
  let list = p.root.children || (p.root.children = []);
  if (old.list === lp.overlays) list = p.overlays;
  else if (old.par) { const parE = findNode(p, old.par.id); if (parE && vis.has(parE.n.id)) list = parE.n.children || (parE.n.children = []); }
  insertNearOldSib(list, old.list, old.n, restored, vis);
  selectNode(pid, restored.id);
  return { type: 'restore', page: pid, node: restored.id, desc: pfx(p) + '从 v' + ui.leftVer + ' 恢复' + ref(restored) };
}
function opDuplicate(pid, id) {
  const p = ePageById(pid); const e = p && findNode(p, id); if (!e || !e.list) return false;
  const c = afterClone(e.n, {}); delete c.movedFrom;
  e.list.splice(e.list.indexOf(e.n) + 1, 0, c);
  selectNode(pid, c.id);
  return { type: 'duplicate', page: pid, node: c.id, origin: id, desc: pfx(p) + '复制' + ref(e.n) + ' 为 #' + c.id };
}
/* Inline element -> overlay (dialog / drawer / menu / popover) opened by a new button at the old spot. */
function opConvert(pid, id, kind) {
  const p = ePageById(pid); const e = p && findNode(p, id); if (!e || !e.list || e.list === p.overlays) return false;
  const label = e.n.label || tname(e.n.type);
  const name = ref(e.n);
  const kindName = kind === 'dialog' ? '弹窗' : tname(kind);
  const map = {};
  const content = afterClone(e.n, map);
  const b = { id: newId(), type: 'button', label: kind === 'menu' ? label + ' ▾' : label, change: 'added', fn: 'onClick → 打开' + kindName + '「' + short(label, 16) + '」' };
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
  return { type: 'convert', page: pid, node: id, kind: kind, overlay: ov.id, trigger: b.id, desc: pfx(p) + '把' + name + '改成' + kindName + ' #' + ov.id + '，原位置放一个按钮「' + b.label + '」#' + b.id + ' 点击后打开（按钮可再拖到别处）' };
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
function opRestorePage(pid) {
  const p = ePageById(pid);
  if (p && p.change === 'removed') { p.change = p.before ? 'modified' : 'unchanged'; return { type: 'restore-page', page: pid, desc: '恢复页面「' + pageName(p) + '」' }; }
  const L = versionSnap(ui.leftVer);
  const lp = L && (L.pages || []).find((x) => x.id === pid);
  if (!lp) return false;
  const rp = restoreFromSnap(lp, ['root', 'overlays', 'children']);
  S.spec.pages.push(rp); ui.page = rp.id;
  return { type: 'restore-page', page: rp.id, desc: '从 v' + ui.leftVer + ' 恢复页面「' + pageName(rp) + '」' };
}
function opFlowAdd() { const f = { id: newId(), name: '新流程', change: 'added', steps: [] }; S.spec.flows.push(f); ui.sel = { kind: 'flow', id: f.id }; return { type: 'add-flow', flow: f.id, desc: '新增流程「新流程」#' + f.id }; }
function opFlowDelete(fid) { const i = S.spec.flows.findIndex((f) => f.id === fid); if (i < 0) return false; const f = S.spec.flows[i]; if (f.change === 'added') S.spec.flows.splice(i, 1); else { f.change = 'removed'; delete f._um; } ui.sel = null; return { type: 'delete-flow', flow: fid, desc: '删除流程「' + f.name + '」' }; }
function opStepAdd(fid, afterId) {
  const f = eFlowById(fid); if (!f) return false;
  const prev = afterId ? f.steps.find((s) => s.id === afterId) : null;
  const s = { id: newId(), actor: prev ? prev.actor : 'frontend', text: '新步骤', change: 'added' };
  if (prev) f.steps.splice(f.steps.indexOf(prev) + 1, 0, s); else f.steps.push(s);
  ui.sel = { kind: 'step', id: s.id, side: 'after', flow: fid };
  return { type: 'add-step', flow: fid, step: s.id, desc: '流程「' + f.name + '」：' + (prev ? '在步骤' + stepLabel(prev) + '后' : '末尾') + '新增步骤 #' + s.id };
}
function opStepDelete(fid, id) {
  const f = eFlowById(fid); const s = f && f.steps.find((x) => x.id === id); if (!s) return false;
  if (s.change === 'added') { f.steps.splice(f.steps.indexOf(s), 1); if (s.movedFrom) { const g = f.steps.find((x) => x.id === s.movedFrom); if (g) delete g.movedTo; } } else { s.change = 'removed'; delete s._um; }
  ui.sel = null;
  return { type: 'delete-step', flow: fid, step: id, desc: '流程「' + f.name + '」：删除步骤' + stepLabel(s) + ' #' + id };
}
function opStepRestore(fid, id) {
  const f = eFlowById(fid); if (!f) return false;
  const s = f.steps.find((x) => x.id === id);
  if (s && s.change === 'removed') {
    if (s.movedTo) { const m = f.steps.find((x) => x.id === s.movedTo); if (m && m.change === 'added') f.steps.splice(f.steps.indexOf(m), 1); delete s.movedTo; }
    s.change = s.before ? 'modified' : 'unchanged';
    return { type: 'restore-step', flow: fid, step: id, desc: '流程「' + f.name + '」：恢复步骤' + stepLabel(s) };
  }
  const L = versionSnap(ui.leftVer);
  const lf = L && (L.flows || []).find((x) => x.id === fid);
  const ls = lf && (lf.steps || []).find((x) => x.id === id);
  if (!ls) return false;
  const rs = restoreFromSnap(ls, []);
  f.steps.push(rs);
  return { type: 'restore-step', flow: fid, step: rs.id, desc: '流程「' + f.name + '」：从 v' + ui.leftVer + ' 恢复步骤' + stepLabel(rs) };
}
function opStepMove(fid, id, dir) {
  const f = eFlowById(fid); if (!f) return false;
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
function opItemAdd(mid) { const f = eFindBe(mid); if (!f || f.item) return false; const it = { id: newId(), kind: 'function', name: 'newFunction()', change: 'added' }; f.m.items.push(it); ui.sel = { kind: 'be', id: it.id, side: 'after' }; return { type: 'add-item', id: it.id, module: mid, desc: '后端：模块「' + f.m.name + '」新增条目 #' + it.id }; }
function opBeDelete(id) {
  const f = eFindBe(id); if (!f) return false;
  const o = f.item || f.m;
  if (o.change === 'added') { if (f.item) f.m.items.splice(f.m.items.indexOf(o), 1); else S.spec.backend.splice(S.spec.backend.indexOf(o), 1); } else { o.change = 'removed'; delete o._um; }
  ui.sel = null;
  return { type: 'delete-be', id: id, desc: '后端：删除' + (f.item ? '模块「' + f.m.name + '」中的「' + o.name + '」' : '模块「' + o.name + '」') + ' #' + id };
}
function opBeRestore(id) {
  const f = eFindBe(id); const o = f && (f.item || f.m);
  if (o && o.change === 'removed') { o.change = o.before ? 'modified' : 'unchanged'; return { type: 'restore-be', id: id, desc: '后端：恢复「' + o.name + '」' }; }
  const L = versionSnap(ui.leftVer);
  if (!L) return false;
  for (const lm of (L.backend || [])) {
    if (lm.id === id) { const rm = restoreFromSnap(lm, ['items']); S.spec.backend.push(rm); return { type: 'restore-be', id: rm.id, desc: '后端：从 v' + ui.leftVer + ' 恢复模块「' + rm.name + '」' }; }
    const lit = (lm.items || []).find((x) => x.id === id);
    if (lit) { const em = S.spec.backend.find((x) => x.id === lm.id); if (!em) return false; const rit = restoreFromSnap(lit, []); em.items.push(rit); return { type: 'restore-be', id: rit.id, desc: '后端：从 v' + ui.leftVer + ' 恢复「' + rit.name + '」' }; }
  }
  return false;
}

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
function realNodeId(id) { const s = String(id == null ? '' : id); return s.endsWith('__from') ? s.slice(0, -6) : s; }
function addComment(target, category, severity, text) {
  const t = Object.assign({}, target);
  if (t.kind === 'node' && String(t.id || '').endsWith('__from')) {
    t.ghost = true;
    t.id = realNodeId(t.id);
  }
  if (HAS_MULTI_VER && !t.ver) t.ver = [ui.leftVer, ui.rightVer];
  mutate(() => { S.seq = (S.seq || 0) + 1; S.comments.push({ id: 'c' + S.seq, target: t, where: whereOf(t), category: category, severity: severity, text: text, ts: new Date().toISOString() }); return null; });
}
function sameTarget(a, b) { return a.kind === b.kind && realNodeId(a.id) === realNodeId(b.id) && (a.side || '') === (b.side || ''); }
function whereOf(t) {
  const verPfx = HAS_MULTI_VER ? '[v' + ui.leftVer + '→v' + ui.rightVer + '] ' : '';
  const sideT = t.side === 'before' ? sideLabel('before') : t.side === 'after' ? sideLabel('after') : '';
  if (t.kind === 'node') {
    const p = pageById(t.page);
    const lookupId = t.ghost ? (t.id + '__from') : t.id;
    const e = p && (findNode(p, lookupId) || findNode(p, t.id));
    const rid = realNodeId(t.id);
    return verPfx + '页面「' + (p ? pageName(p) : t.page) + '」› ' + sideT + ' › ' + (e ? pathText(p, e.n, t.side) : '') + ' #' + rid + (t.ghost ? '（原位置）' : '');
  }
  if (t.kind === 'page') { const p = pageById(t.id); return verPfx + '页面「' + (p ? pageName(p) : t.id) + '」（整页）'; }
  if (t.kind === 'flow') { const f = flowById(t.id); return verPfx + '流程「' + (f ? f.name : t.id) + '」（整个流程）'; }
  if (t.kind === 'step') { const f = flowById(t.flow); const s = f && f.steps.find((x) => x.id === t.id); return verPfx + '流程「' + (f ? f.name : t.flow) + '」› ' + sideT + ' › 步骤' + (s ? stepLabel(view(s, t.side)) : '') + ' #' + t.id; }
  if (t.kind === 'be') { const f = findBe(t.id); if (!f) return verPfx + '后端 #' + t.id; return verPfx + '后端 › ' + sideT + ' › 模块「' + f.m.name + '」' + (f.item ? ' › 「' + f.item.name + '」' : '') + ' #' + t.id; }
  return verPfx + '整体';
}
function commentCount(kind, id, side) { const rid = realNodeId(id); return S.comments.filter((c) => c.target.kind === kind && realNodeId(c.target.id) === rid && (c.target.side || '') === (side || '')).length; }
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
  if (!pageById(ui.page) && CUR.pages[0]) ui.page = CUR.pages[0].id;
}

// ------------------------------------------------------------------ change marks
/* Colors: added = green, removed = red, modified = yellow. side: before | after. */
function chgOf(o, side) {
  const c = o.change;
  if (c === 'added' && side !== 'before') return ['added', o.movedFrom ? '移入' : '新增'];
  if (c === 'removed' && side !== 'after') return ['removed', o.movedTo ? '移出' : '删除'];
  if (c === 'modified') return ['modified', side === 'before' ? '修改前' : '修改后'];
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
  CUR.pages.forEach((p) => {
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
function findNodeAnywhere(id) { for (const p of CUR.pages) { const e = findNode(p, id); if (e) return { p: p, e: e }; } return null; }
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
function nodeBody(v, side, n, o) {
  const t = bt(v.type), out = [], label = v.label;
  const interactive = o && o.ctx === 'canvas' && ui.mode === 'view';
  switch (t) {
    case 'heading': out.push(h('div', { class: 'wf-h' }, label || '标题')); break;
    case 'text': out.push(h('div', { class: 'wf-text' }, label || '')); if (v.lines) out.push(bars(v.lines)); break;
    case 'button': case 'link': case 'badge': case 'tag': out.push(h('span', { class: 'wf-lbl' }, label || tname(t))); break;
    case 'icon': out.push(h('span', { class: 'wf-lbl' }, '◎ ' + (label || ''))); break;
    case 'checkbox': {
      const ck = n && ui.preview.checks[n.id] !== undefined ? ui.preview.checks[n.id] : false;
      out.push(h('label', { class: 'wf-lbl wf-check-lbl', onpointerdown: (e) => { if (interactive) e.stopPropagation(); }, onclick: (e) => { if (interactive) e.stopPropagation(); } },
        h('input', { type: 'checkbox', checked: ck, disabled: !interactive, style: 'width:auto', onchange: (e) => { if (n) { ui.preview.checks[n.id] = e.target.checked; render(); } } }),
        h('span', null, label || '复选框')));
      break;
    }
    case 'switch': {
      const ck = n && ui.preview.checks[n.id] !== undefined ? ui.preview.checks[n.id] : (curState(n || v, o ? o.ctx : 'canvas') === 'on');
      out.push(h('span', {
        class: 'wf-lbl wf-switch-lbl',
        onpointerdown: (e) => { if (interactive) e.stopPropagation(); },
        onclick: (e) => {
          if (!interactive || !n) return;
          e.stopPropagation();
          ui.preview.checks[n.id] = !ck;
          if (stateNames(n).length) { const list = n.state ? stateNames(n) : [null].concat(stateNames(n)); ui.preview.st[n.id] = list[(list.indexOf(curState(n, 'canvas')) + 1) % list.length]; }
          render();
        }
      }, h('span', { class: 'wf-toggle' + (ck ? ' on' : '') }), h('span', null, label || '开关')));
      break;
    }
    case 'toggle': {
      const ck = n && ui.preview.checks[n.id] !== undefined ? ui.preview.checks[n.id] : (curState(n || v, o ? o.ctx : 'canvas') === 'on');
      out.push(h('span', {
        class: 'wf-lbl',
        onpointerdown: (e) => { if (interactive) e.stopPropagation(); },
        onclick: (e) => {
          if (!interactive || !n) return;
          e.stopPropagation();
          ui.preview.checks[n.id] = !ck;
          if (stateNames(n).length) { const list = n.state ? stateNames(n) : [null].concat(stateNames(n)); ui.preview.st[n.id] = list[(list.indexOf(curState(n, 'canvas')) + 1) % list.length]; }
          render();
        }
      }, h('span', { class: 'wf-toggle-btn' + (ck ? ' on' : '') }, label || 'Toggle')));
      break;
    }
    case 'radio': if (label) out.push(h('div', { class: 'wf-flabel' }, label)); out.push(h('div', { class: 'wf-items' }, visItems(v, side, 'items').map((x, idx) => h('label', { class: 'wf-radio-opt', onpointerdown: (e) => { if (interactive) e.stopPropagation(); }, onclick: (e) => { if (interactive) e.stopPropagation(); } }, h('input', { type: 'radio', name: n ? 'r-' + n.id + '-' + side : '', checked: idx === 0, style: 'width:auto' }), itemEl(x, side, ''))))); break;
    case 'select': {
      if (label) out.push(h('div', { class: 'wf-flabel' }, label));
      const opts = visItems(v, side, 'items');
      const curVal = (n && ui.preview.selects[n.id] !== undefined) ? ui.preview.selects[n.id] : null;
      const optEls = [];
      if (v.text && !opts.some((x) => itemText(x) === v.text)) optEls.push(h('option', { value: '' }, v.text));
      opts.forEach((x) => {
        const txt = itemText(x);
        const chg = (x && typeof x === 'object' && x.change && x.change !== 'unchanged' && (ui.diffMode || (o && o.ctx === 'detail'))) ? (x.change === 'added' ? '（+新增）' : x.change === 'removed' ? '（−删除）' : '') : '';
        optEls.push(h('option', { value: txt }, txt + chg));
      });
      if (!optEls.length) optEls.push(h('option', { value: '' }, v.text || '请选择'));
      const selEl = h('select', {
        class: 'wf-select',
        disabled: o && o.ctx === 'canvas' && ui.mode === 'edit',
        value: curVal != null ? curVal : (optEls[0] ? optEls[0].value : ''),
        onpointerdown: (e) => { if (interactive) e.stopPropagation(); },
        onclick: (e) => { if (interactive) e.stopPropagation(); },
        onchange: (e) => { e.stopPropagation(); if (n) ui.preview.selects[n.id] = e.target.value; }
      }, optEls);
      if (curVal != null) selEl.value = curVal;
      out.push(selEl);
      break;
    }
    case 'input': case 'textarea': {
      if (label) out.push(h('div', { class: 'wf-flabel' }, label));
      const filled = !!(n && curState(n, o ? o.ctx : 'canvas') && v.text);
      const el = h(t === 'textarea' ? 'textarea' : 'input', {
        class: t === 'textarea' ? 'wf-textarea' : 'wf-input',
        placeholder: filled ? '' : (v.text || ''),
        value: filled && t === 'input' ? v.text : undefined,
        readonly: !interactive,
        onpointerdown: (e) => { if (interactive) e.stopPropagation(); },
        onclick: (e) => { if (interactive) e.stopPropagation(); }
      }, filled && t === 'textarea' ? v.text : null);
      out.push(el);
      break;
    }
    case 'upload':
      if (label) out.push(h('div', { class: 'wf-flabel' }, label));
      out.push(h('div', { class: 'wf-field wf-upload' }, h('span', null, '⇪ ' + (v.text || '点击上传文件'))));
      break;
    case 'image': case 'chart': out.push(h('div', { class: 'wf-media ' + t }, h('span', null, t === 'chart' ? '▁▃▅▇▅▃' : '⛶'), h('span', null, label || tname(t)))); break;
    case 'avatar': out.push(h('div', { class: 'wf-avatar' }, String(label || '?').slice(0, 2).toUpperCase())); break;
    case 'progress': {
      if (label) out.push(h('div', { class: 'wf-flabel' }, label));
      const raw = Number(v.value);
      const pct = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 60;
      out.push(h('div', { class: 'wf-progress-row' }, h('div', { class: 'wf-progress' }, h('i', { style: { width: pct + '%' } })), h('span', { class: 'wf-progress-v' }, Number.isFinite(raw) ? pct + '%' : '')));
      break;
    }
    case 'slider': {
      if (label) out.push(h('div', { class: 'wf-flabel' }, label));
      const raw = Number(v.value);
      const pct = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 40;
      out.push(h('div', { class: 'wf-slider' }, h('i', { style: { width: pct + '%' } }), h('b', { style: { left: pct + '%' } }), h('span', null, Number.isFinite(raw) ? pct + '%' : '')));
      break;
    }
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
      if (label && t !== 'tabs' && t !== 'header' && t !== 'toolbar' && t !== 'footer' && t !== 'row' && t !== 'col') out.push(h('div', { class: 'wf-cap' }, label));
      if (ITEMS_TYPES.has(t) && v.items) out.push(itemsStrip(v, side, 'wf-it', t === 'list' || t === 'menu'));
  }
  if (v.text && !USES_TEXT.has(t)) out.push(h('div', { class: 'wf-sub' }, v.text));
  if (v.fn) out.push(h('div', { class: 'wf-fn', title: '函数 / 行为占位' }, 'ƒ ' + v.fn));
  return out;
}
function commentPin(n, p, eff, unitHere, c) {
  if (!ui.showPins || n === p.root) return null;
  const rid = realNodeId(n.id);
  const cmts = S.comments.filter((x) => x.target.kind === 'node' && realNodeId(x.target.id) === rid && (x.target.side || '') === eff);
  const showNote = !!(n.note && (eff === 'after' || n.change === 'removed' || ui.diffView !== 'split'));
  if (!showNote && !cmts.length) return null;
  const u = unitHere ? UNIT_BY.get(n.id) : null;
  const v = view(n, eff);
  const badgeTxt = cmts.length ? ('💬' + cmts.length) : (u ? String(u.n) : 'i');
  const pop = h('div', { class: 'cv-pin-pop' },
    h('div', { class: 'cv-pin-head' }, h('b', null, nlabel(v)), c ? chgChip(c[0]) : null),
    showNote ? h('div', { class: 'cv-pin-note' }, n.note) : null,
    n.before && n.change === 'modified' ? h('div', { class: 'cv-pin-diff' }, Object.keys(n.before).slice(0, 3).map((k) => h('div', null, (FIELD_LABEL[k] || k) + '：' + fmtVal(k, n.before[k]) + ' → ' + fmtVal(k, n[k])))) : null,
    v.component ? h('code', { class: 'cv-pin-code' }, v.component) : null,
    v.fn ? h('code', { class: 'cv-pin-code' }, 'ƒ ' + v.fn) : null,
    cmts.length ? h('div', { class: 'cv-pin-cmts' }, cmts.map((cm) => h('div', { class: 'cv-pin-cmt' }, h('span', { class: 'sev s' + SEVS.indexOf(cm.severity) }, cm.severity), ' ', cm.text))) : null,
    h('div', { class: 'cv-pin-foot' }, '点击打开详情 / 写批注'));
  return h('div', {
    class: 'cv-pin' + (cmts.length ? ' has-cmt' : '') + (c ? ' p-' + c[0] : ''),
    'data-pin': n.id,
    onpointerdown: (e) => e.stopPropagation(),
    onclick: (e) => {
      e.stopPropagation();
      ui.page = p.id;
      ui.unit = unitOf(p.id, n.id);
      ui.sel = { kind: 'node', page: p.id, id: n.id, side: eff };
      render();
    }
  }, badgeTxt, pop);
}
function applyWidth(el, w, parentLayout) {
  if (isEmpty(w)) return;
  const row = parentLayout === 'row';
  if (typeof w === 'number') { if (row) el.style.flex = w + ' 1 0'; return; }
  if (w === 'full') { if (row) el.style.flex = '0 0 100%'; else el.style.width = '100%'; return; }
  const m = /^(\d+)\/(\d+)$/.exec(String(w));
  if (m) { const pct = (100 * Number(m[1]) / Number(m[2])).toFixed(2); if (row) { el.style.flex = '0 0 calc(' + pct + '% - 9px)'; el.style.minWidth = '0'; } else el.style.width = pct + '%'; }
}
/* o: { side: before|after, ctx: canvas|detail|play, parentLayout, whole (inside an added/removed module),
 *      unit (enclosing unit id on the canvas), ghost (rendering a removed subtree) } */
function renderWF(n, p, o) {
  const side = o.side;
  if (!visible(n, side)) return null;
  const eff = side;
  if (o.ctx === 'play' && !playVisible(n)) return null;
  if (o.ctx === 'canvas' && isTabPanel(p, n) && !canvasVisible(n)) return null;
  if (o.ctx === 'canvas' && !o.asPanel && isRevealed(n, p)) {
    const sv = view(n, eff);
    const slot = h('div', { class: 'wf wf-slot', 'data-kind': 'node', 'data-id': n.id, 'data-side': eff, 'data-unit': o.unit || null, title: '点击后才出现，内容画在下方的交互面板区' },
      '⤷ ' + nlabel(sv) + ' · 点击 ' + showersOf(n.id).map((x) => '「' + short(x.label || x.text || x.id, 14) + '」').join('、') + ' 后在这里展开 →');
    applyWidth(slot, sv.w, o.parentLayout);
    return slot;
  }
  const v = withState(n, view(n, eff), o.ctx);
  const vt = v.type, t = bt(vt), kids = v.children || [], cont = isCont(v);
  const layout = v.layout || (t === 'grid' ? 'grid' : ROW_TYPES.has(t) ? 'row' : 'col');
  const isRoot = n === p.root;
  const ghost = !!o.ghost;
  const editing = ui.mode === 'edit' && o.ctx === 'canvas' && !ghost && side !== 'before';
  const ias = interactionsOf(p, n, eff);
  const trig = ias.length > 0;
  const tabTarget = o.ctx === 'canvas' ? tabTriggerTarget(p, n) : null;
  const isTabBtn = !!(o.inTabBar && tabTarget);
  const tabActive = isTabBtn ? canvasVisible(tabTarget) : false;
  const isTabBar = o.ctx === 'canvas' && o.parentType === 'tabs' && cont && kids.length > 0 && kids.some((ch) => tabTriggerTarget(p, ch));
  const c = (o.whole || isRoot || (o.ctx === 'play' && !ui.play.marks)) ? null : chgOf(n, o.ctx === 'play' ? 'after' : side);
  let mark = '', unitHere = null;
  if (c) {
    if (o.ctx === 'canvas' && !o.unit) { mark = 'mk mk-' + c[0] + ' mk-u side-' + side; unitHere = n.id; }
    else mark = 'mk mk-' + c[0] + (o.ctx === 'canvas' ? ' mk-inner side-' + side : ' mk-d side-' + side);
  }
  const unit = o.unit || unitHere;
  const cls = ['wf', 't-' + t, cont ? 'is-c lay-' + layout : 'is-leaf', INLINE.has(t) ? 'inline' : '', v.variant ? 'v-' + v.variant : '', trig ? 'is-trigger' : '', mark, (unit || o.whole) ? 'in-chg' : '', n.hidden && o.ctx !== 'play' && !isTabPanel(p, n) ? 'wf-cond' : '', isTabBtn ? 'wf-tab-btn' + (tabActive ? ' is-active-tab' : '') : '', isTabBar ? 'wf-tabs-bar' : ''].filter(Boolean).join(' ');
  const el = h('div', { class: cls, 'data-kind': 'node', 'data-id': n.id, 'data-side': eff, 'data-unit': unit, 'data-partner': n.movedFrom || n.movedTo || null, 'data-bui': own(BUI_C, vt) ? vt : null });
  if (o.ctx === 'play' && trig) { el.setAttribute('data-ia', '1'); el.setAttribute('data-pg', p.id); }
  if (o.ctx === 'canvas' && ui.mode === 'view' && nodeOn(n).some((i) => (i.action === 'show' || i.action === 'hide') && i.target && findNode(p, i.target) && isTabPanel(p, findNode(p, i.target).n))) {
    el.setAttribute('data-tab-ia', '1');
    el.addEventListener('click', (e) => { if (ui.mode === 'view' && !e.target.closest('.cv-pin')) { e.stopPropagation(); runCanvasIA(p, n); } });
  }
  applyWidth(el, v.w, o.parentLayout);
  if (layout === 'grid') el.style.setProperty('--cols', String(v.cols || 2));
  if (unitHere) { const u = UNIT_BY.get(n.id); el.append(h('span', { class: 'u-num u-' + c[0] }, String(u ? u.n : '?')), h('span', { class: 'u-tag u-' + c[0] }, c[1])); }
  else if (c && o.ctx === 'detail') el.append(h('span', { class: 'chg-tag chg-tag-' + c[0] + ' side-' + side }, c[1]));
  if (v.component && o.ctx !== 'play') el.append(h('span', { class: 'wf-comp', title: '代码里对应的组件 / 模块' }, v.component));
  if (n.hidden && o.ctx !== 'play' && !o.asPanel && !isTabPanel(p, n)) el.append(h('span', { class: 'cond-tag', title: '默认不显示' }, showersOf(n.id).length ? '点击后出现' : '按条件出现'));
  if (stateNames(n).length && o.ctx !== 'play') el.append(h('span', { class: 'st-tag', title: '在演示模式里点一下可以切换' }, '⇄ ' + (stateNames(n).length + (n.state ? 0 : 1)) + ' 个状态'));
  el.append(...nodeBody(v, side, n, o));
  if (cont) {
    const box = h('div', { class: 'wf-children' });
    const sub = { side: side, ctx: o.ctx, parentLayout: layout, parentType: t, inTabBar: isTabBar, whole: o.whole || n.change === 'added' || n.change === 'removed', unit: unit, ghost: ghost, depth: (o.depth || 0) + 1 };
    kids.forEach((ch) => { const r = renderWF(ch, p, sub); if (r) box.append(r); });
    if (box.childNodes.length) el.append(box);
    else if (editing && !(ITEMS_TYPES.has(t) && v.items)) { box.append(h('div', { class: 'wf-empty' }, isRoot ? '空页面：把组件从组件库拖到这里' : '拖入组件')); el.append(box); }
    else if (isRoot) { box.append(h('div', { class: 'wf-empty' }, '（空）')); el.append(box); }
    else if (!(ITEMS_TYPES.has(t) && v.items) && !v.text && t !== 'item' && n.change === 'unchanged' && !o.whole) el.append(h('div', { class: 'wf-same' }, '内容不变，未展开'));
  }
  if (o.ctx === 'detail' && n.note && !isRoot && o.depth && c) el.append(h('div', { class: 'wf-note' }, n.note));
  if (o.ctx === 'canvas') { const pin = commentPin(n, p, eff, unitHere, c); if (pin) el.append(pin); }
  else if (o.ctx !== 'play') { const b = cbadge('node', n.id, eff); if (b) el.append(b); }
  if (editing && !isRoot) el.setAttribute('data-drag', '1');
  return el;
}

// ------------------------------------------------------------------ app shell
function render() {
  syncViewSpec();
  computeUnits();
  if (ui.unit && !UNIT_BY.has(ui.unit)) ui.unit = null;
  const app = document.getElementById('app');
  const keepScroll = {};
  ['main', 'inspector', 'ins-scroll', 'cv-list', 'live-msgs'].forEach((id) => { const el = document.getElementById(id); if (el) keepScroll[id] = el.scrollTop; });
  const ae = document.activeElement;
  const fkey = ae && ae.dataset ? ae.dataset.f : null;
  if (ui.play) {
    const st0 = document.getElementById('pl-stage'); const sc = st0 && !ui.play.top ? st0.scrollTop : 0; ui.play.top = false;
    const ps0 = document.getElementById('pl-side'); const ss = ps0 ? ps0.scrollTop : 0;
    app.replaceChildren(...[renderHeader(), renderPlay(), live.enabled ? renderLiveDock() : null, ui.toast ? h('div', { class: 'toast' + (ui.toast.err ? ' err' : '') }, ui.toast.msg) : null].filter(Boolean));
    fitPlay(); requestAnimationFrame(fitPlay);
    const st1 = document.getElementById('pl-stage'); if (st1) st1.scrollTop = sc;
    const ps1 = document.getElementById('pl-side'); if (ps1) ps1.scrollTop = ss;
    if (keepScroll['live-msgs'] != null) { const lm = document.getElementById('live-msgs'); if (lm) lm.scrollTop = keepScroll['live-msgs']; }
    if (fkey) {
    const el = document.querySelector('[data-f="' + fkey + '"]');
    if (el) {
      el.focus();
      if (el.tagName === 'INPUT' && el.type === 'search') { const n = el.value.length; try { el.setSelectionRange(n, n); } catch (e) {} }
    }
  }
    return;
  }
  const canvas = ui.tab === 'canvas';
  const main = h('main', { class: 'main' + (canvas ? ' main-canvas' : ''), id: 'main', onclick: onMainClick, onmouseover: onMainOver }, renderTab());
  app.replaceChildren(...[renderHeader(), renderTabs(), renderBanners(), h('div', { class: 'body' }, main, canvas ? null : renderInspector()), live.enabled ? renderLiveDock() : null, ui.toast ? h('div', { class: 'toast' + (ui.toast.err ? ' err' : '') }, ui.toast.msg) : null].flat().filter(Boolean));
  Object.keys(keepScroll).forEach((id) => { const el = document.getElementById(id); if (el) el.scrollTop = keepScroll[id]; });
  if (canvas) layoutPanels();
  applySel();
  if (canvas) { if (ui.cam) applyCam(); else requestAnimationFrame(() => fitCam(false, true)); requestAnimationFrame(drawLinks); }
  if (fkey) {
    const el = document.querySelector('[data-f="' + fkey + '"]');
    if (el) {
      el.focus();
      if (el.tagName === 'INPUT' && el.type === 'search') { const n = el.value.length; try { el.setSelectionRange(n, n); } catch (e) {} }
    }
  }
}
function renderHeader() {
  const sp = S.spec;
  const fbCount = S.comments.length + S.ops.length;
  const hist = isHistoryView();
  const liveBtn = live.enabled ? h('button', {
    class: 'live-btn' + (live.open ? ' on' : ''),
    id: 'live-toggle-btn',
    onclick: () => toggleLivePane(),
    title: '打开或收起实时 Agent 对话窗'
  },
    h('span', { class: 'live-dot ' + liveDotClass() }),
    'Agent',
    live.unread && !live.open ? h('span', { class: 'cnt' }, String(live.unread)) : null
  ) : null;
  return h('header', { class: 'top' },
    h('h1', null, sp.title),
    h('span', { class: 'stage st-' + sp.stage }, STAGES[sp.stage]),
    h('span', { class: 'ver' }, HAS_MULTI_VER ? ('v' + LATEST_VER + '（共 ' + (VERSIONS.length - 1) + ' 版）') : ('v' + sp.version)),
    h('div', { class: 'acts-top' },
      liveBtn,
      h('button', { class: 'play-btn' + (ui.play ? ' on' : ''), onclick: () => (ui.play ? stopPlay() : startPlay()), title: '像 Figma 的演示模式一样点着试：弹窗、跳页、展开收起、切换状态' }, ui.play ? '■ 退出演示' : '▶ 演示'),
      ui.play ? null : h('div', { class: 'seg' },
        h('button', { class: ui.mode === 'view' ? 'on' : null, onclick: () => setMode('view'), title: '浏览改动、点任意元素写批注' }, '查看 / 批注'),
        h('button', { class: ui.mode === 'edit' ? 'on' : null, disabled: hist, onclick: () => setMode('edit'), title: hist ? ('查看历史版本时为只读；切回最新版 v' + LATEST_VER + ' 即可编辑方案') : '直接修改方案：拖动、增删、转为弹窗…' }, '编辑方案')),
      h('button', { disabled: !undoStack.length, onclick: undo, title: '撤销 (Ctrl+Z)' }, '↶ 撤销'),
      h('button', { disabled: !redoStack.length, onclick: redo, title: '重做 (Ctrl+Shift+Z)' }, '↷ 重做'),
      h('button', { class: 'primary', onclick: () => setTab('feedback') }, '反馈', fbCount ? h('span', { class: 'cnt' }, String(fbCount)) : null),
      h('button', { class: 'lnk' + (ui.confirmReset ? ' danger' : ''), onclick: resetAll, title: '丢弃所有修改和批注，恢复 Agent 给出的原始方案' }, ui.confirmReset ? '再点一次确认重置' : '重置')));
}
function renderTabs() {
  const sp = CUR;
  const fc = sp.flows.filter((f) => flowStatus(f) !== 'unchanged').length;
  const bc = sp.backend.filter((m) => modStatus(m) !== 'unchanged').length;
  const tabs = [['canvas', '界面改动', String(UNITS.length)], ['flows', '流程变化', fc + '/' + sp.flows.length], ['backend', '后端变化', bc + '/' + sp.backend.length], ['feedback', '反馈', String(S.comments.length + S.ops.length)]];
  let verBar = null;
  if (HAS_MULTI_VER) {
    const lSel = h('select', { class: 'ver-sel', 'data-ver': 'left', title: '左侧基准版本', onchange: (e) => setVersions(Number(e.target.value), ui.rightVer) },
      VERSIONS.map((v) => h('option', { value: String(v.version) }, verOptLabel(v))));
    lSel.value = String(ui.leftVer);
    const rSel = h('select', { class: 'ver-sel', 'data-ver': 'right', title: '右侧目标版本', onchange: (e) => setVersions(ui.leftVer, Number(e.target.value)) },
      VERSIONS.map((v) => h('option', { value: String(v.version) }, verOptLabel(v))));
    rSel.value = String(ui.rightVer);
    const atFull = isFullBaseView();
    const toggleBtn = h('button', {
      class: 'ver-btn' + (atFull ? ' on' : ''),
      'data-ver-toggle': '1',
      title: atFull ? ('切回本轮增量对比 v' + PREV_VER + ' → v' + LATEST_VER) : ('一键查看从现状到最新版的全量改动 v0 → v' + LATEST_VER),
      onclick: () => setVersions(atFull ? PREV_VER : 0, LATEST_VER)
    }, atFull ? ('只看本轮 v' + PREV_VER + '→v' + LATEST_VER) : ('对比现状 v0→v' + LATEST_VER));
    verBar = h('div', { class: 'ver-bar' },
      h('span', { class: 'ver-lbl' }, '版本对比'),
      lSel,
      h('span', { class: 'ver-arr' }, '→'),
      rSel,
      toggleBtn);
  }
  return h('nav', { class: 'tabs' }, tabs.map((t) => h('button', { class: ui.tab === t[0] ? 'on' : null, onclick: () => setTab(t[0]) }, t[1], t[2] ? h('span', { class: 'n' }, t[2]) : null)), verBar);
}
function renderBanners() {
  const out = [];
  if (!STORAGE_OK) out.push(h('div', { class: 'banner info' }, '当前预览环境不允许保存进度（例如在沙箱里预览），关闭或刷新后修改会丢失。改完请及时到「反馈」页复制反馈。'));
  if (isHistoryView()) {
    out.push(h('div', { class: 'banner info ver-banner' },
      '正在回看历史对比 v' + ui.leftVer + ' → v' + ui.rightVer + '（只读，仍可写批注）',
      h('button', { class: 'ver-back', onclick: () => setVersions(PREV_VER, LATEST_VER) }, '回到最新版 v' + PREV_VER + '→v' + LATEST_VER)));
  }
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
function setDiffView(v) { if (['split', 'wipe'].indexOf(v) < 0 || ui.diffView === v) return; ui.diffView = v; ui.cam = null; hoverKey = null; save(); render(); }
function setDiffMode(on) { ui.diffMode = !!on; save(); render(); }
function setShowPins(on) { ui.showPins = !!on; save(); render(); }
function setWipePos(key, pct) {
  const v = Math.max(0, Math.min(100, Math.round(Number(pct))));
  ui.wipePos[key] = v;
  const esc = CSS.escape(key);
  const box = document.querySelector('.cv-wipe[data-wipe-key="' + esc + '"]') || document.querySelector('.cv-wipe[data-page="' + esc + '"]:not(.cv-ov-wipe)');
  if (box) box.style.setProperty('--wipe', v + '%');
  const rng = document.querySelector('.cv-wipe-range[data-wipe-key="' + esc + '"]') || document.querySelector('.cv-wipe-range[data-page="' + esc + '"]:not([data-wipe-key])');
  if (rng && Number(rng.value) !== v) rng.value = String(v);
  const lbl = document.querySelector('.cv-wipe-pct[data-wipe-key="' + esc + '"]') || document.querySelector('.cv-wipe-pct[data-page="' + esc + '"]:not([data-wipe-key])');
  if (lbl) lbl.textContent = v + '%';
}
function setMode(m) {
  if (m === 'edit' && isHistoryView()) { toast('历史版本为只读，请先切回最新版 v' + LATEST_VER, true); return; }
  ui.mode = m;
  if (m === 'edit') {
    ui.listCollapsed = false;
    if (ui.tab === 'feedback') ui.tab = 'canvas';
  }
  save(); render();
}
function resetAll() {
  // No confirm(): sandboxed previews block modal dialogs. Ask for a second click instead.
  if (!ui.confirmReset) { ui.confirmReset = true; render(); setTimeout(() => { ui.confirmReset = false; render(); }, 4000); return; }
  ui.confirmReset = false;
  undoStack.push(JSON.stringify(S)); redoStack = [];
  S = freshState(); syncViewSpec(); ui.sel = null; ui.unit = null; save(); render();
}
function toast(msg, err) { ui.toast = { msg: msg, err: !!err }; render(); clearTimeout(toastTimer); toastTimer = setTimeout(() => { ui.toast = null; render(); }, err ? 9000 : 6000); }
function applySel() {
  const s = ui.sel;
  if (s) {
    const q = '[data-kind="' + s.kind + '"][data-id="' + CSS.escape(s.id) + '"]' + (s.side ? '[data-side="' + s.side + '"]' : '');
    document.querySelectorAll('#main ' + q).forEach((el) => {
      el.classList.add('sel');
      if (el.dataset.partner) document.querySelectorAll('#main [data-id="' + CSS.escape(el.dataset.partner) + '"]').forEach((x) => x.classList.add('partner'));
    });
  }
  if (ui.unit) {
    const u = UNIT_BY.get(ui.unit);
    const q = u && u.kind === 'page' ? '.cv-frame[data-page="' + CSS.escape(ui.unit) + '"]:not(.cv-void)' : '[data-kind="node"][data-id="' + CSS.escape(ui.unit) + '"]:not(.wf-slot)';
    document.querySelectorAll('#cv-world ' + q).forEach((el) => el.classList.add('u-sel'));
    document.querySelectorAll('.cv-item[data-u="' + CSS.escape(ui.unit) + '"]').forEach((el) => el.classList.add('on'));
  }
}
function unitEls(key) {
  const u = UNIT_BY.get(key); if (!u) return [];
  return [...document.querySelectorAll('#cv-world ' + (u.kind === 'page' ? '.cv-frame[data-page="' + CSS.escape(key) + '"]:not(.cv-void)' : '[data-kind="node"][data-id="' + CSS.escape(key) + '"]:not(.wf-slot)'))];
}
function unitEl(key) { return unitEls(key)[0] || null; }
function scrollToSel() {
  requestAnimationFrame(() => {
    if (ui.tab === 'canvas') { const el = document.querySelector('#cv-world .sel') || (ui.unit && unitEl(ui.unit)); if (el) focusEl(el); return; }
    const el = document.querySelector('#main .sel'); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}
function onMainClick(e) {
  if (ui.panMoved) { ui.panMoved = false; return; }
  if (e.target.closest('button, input, select, textarea, a, label, .pal-item, .pal-side, .cv-tools')) return;
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
  const k = e.target.closest && e.target.closest('[data-partner], .cv-frame.cv-before .mk-modified, .cv-frame.cv-after .mk-modified');
  let nextHover = null;
  if (k) {
    if (k.dataset.partner) {
      document.querySelectorAll('#main [data-id="' + CSS.escape(k.dataset.partner) + '"]').forEach((x) => x.classList.add('partner'));
      nextHover = k.dataset.id + '|' + k.dataset.partner;
    } else if (ui.diffView === 'split' && k.dataset.id && k.dataset.side) {
      const otherSide = k.dataset.side === 'before' ? 'after' : 'before';
      document.querySelectorAll('#cv-world [data-kind="node"][data-id="' + CSS.escape(k.dataset.id) + '"][data-side="' + otherSide + '"]').forEach((x) => x.classList.add('partner'));
      nextHover = k.dataset.id;
    }
  } else {
    const ovOrTrig = e.target.closest && e.target.closest('#cv-world .cv-ov[data-ov], #cv-world .wf.is-trigger[data-id]');
    if (ovOrTrig) nextHover = 'ov:' + (ovOrTrig.dataset.ov || ovOrTrig.dataset.id);
  }
  if (ui.sel && ui.sel.kind === 'node') {
    const sEl = document.querySelector('#main [data-kind="node"][data-id="' + CSS.escape(ui.sel.id) + '"]' + (ui.sel.side ? '[data-side="' + ui.sel.side + '"]' : ''));
    if (sEl && sEl.dataset.partner) document.querySelectorAll('#main [data-id="' + CSS.escape(sEl.dataset.partner) + '"]').forEach((x) => x.classList.add('partner'));
  }
  if (ui.tab === 'canvas' && nextHover !== hoverKey) {
    hoverKey = nextHover;
    drawLinks();
  }
}
function enclosingPanelId(p, nodeId) {
  if (!p || !nodeId) return null;
  const target = findNode(p, nodeId);
  if (!target) return null;
  for (const ov of p.overlays) { if (ov.id === nodeId || contains(ov, target.n)) return ov.id; }
  const chain = parentChain(p, nodeId);
  for (let i = chain.length - 1; i >= 0; i--) { if (isRevealed(chain[i], p)) return chain[i].id; }
  if (isRevealed(target.n, p)) return target.n.id;
  return null;
}
function focusUnit(key, opts) {
  computeUnits();
  if (window.innerWidth < 1100) ui.listOpen = false;
  const u = UNIT_BY.get(key); if (!u) return;
  if (ui.diffView === 'wipe') {
    const pct = u.change === 'removed' ? 100 : u.change === 'added' ? 0 : 50;
    ui.wipePos[u.page] = pct;
    const p = pageById(u.page);
    const ovId = u.kind === 'node' ? enclosingPanelId(p, u.id) : null;
    if (ovId) ui.wipePos[u.page + '::' + ovId] = pct;
  }
  ui.diffMode = true;
  ui.tab = 'canvas'; ui.unit = key; ui.page = u.page;
  ui.sel = u.kind === 'page' ? { kind: 'page', id: u.page } : { kind: 'node', page: u.page, id: u.id, side: u.change === 'removed' ? 'before' : 'after' };
  save(); render();
  if (!opts || opts.zoom !== false) requestAnimationFrame(() => {
    const els = unitEls(key);
    if (!els.length) return;
    focusEls(els);
  });
}
function focusNode(pid, id) {
  const p = pageById(pid); const e = p && findNode(p, id); if (!e) return;
  const vis = afterVisibleIds(p);
  const side = vis.has(id) && p.change !== 'removed' ? 'after' : 'before';
  if (ui.diffView === 'wipe') {
    const pct = side === 'before' ? 100 : 0;
    ui.wipePos[pid] = pct;
    const ovId = enclosingPanelId(p, id);
    if (ovId) ui.wipePos[pid + '::' + ovId] = pct;
  }
  ui.tab = 'canvas'; ui.page = pid; ui.unit = unitOf(pid, id);
  ui.sel = { kind: 'node', page: pid, id: id, side: side };
  save(); render(); scrollToSel();
}

// ------------------------------------------------------------------ canvas: camera
/* Curved connectors on the canvas: trigger element → overlay / revealed panel / page,
 * plus cross-frame move / modify connectors in split view. Drawn in world coordinates. */
const LINK_COLOR = { added: '#18a058', removed: '#e5484d', modified: '#e2a400', unchanged: '#333', nav: '#1f4fd8', move: '#1f4fd8' };
function drawLinks() {
  const w = worldEl(); if (!w) return;
  const old = document.getElementById('cv-links'); if (old) old.remove();
  const wr = w.getBoundingClientRect(); const k = wr.width / (w.offsetWidth || 1); if (!k) return;
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); Object.keys(attrs).forEach((x) => e.setAttribute(x, attrs[x])); return e; };
  const svg = mk('svg', { id: 'cv-links', class: 'cv-links', width: w.offsetWidth, height: w.offsetHeight });
  const defs = mk('defs', {});
  Object.keys(LINK_COLOR).forEach((c) => { const m = mk('marker', { id: 'cv-ah-' + c, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }); m.append(mk('path', { d: 'M0,0 L10,5 L0,10 Z', fill: LINK_COLOR[c] })); defs.append(m); });
  svg.append(defs);
  const loc = (r) => ({ l: (r.left - wr.left) / k, t: (r.top - wr.top) / k, r: (r.right - wr.left) / k, b: (r.bottom - wr.top) / k });
  const q = (root, sel) => root ? root.querySelector(sel) : null;
  const sel = ui.sel, unit = ui.unit;
  let n = 0;
  const addCurve = (A, B, color, label, opts) => {
    opts = opts || {};
    let x1, y1, x2, y2, c1x, c1y, c2x, c2y;
    if (opts.vertical) {
      const down = B.t >= A.b;
      x1 = (A.l + A.r) / 2; y1 = down ? A.b + 2 : A.t - 2;
      x2 = (B.l + B.r) / 2; y2 = down ? B.t - 3 : B.b + 3;
      const d = Math.max(52, Math.abs(y2 - y1) * 0.45) * (down ? 1 : -1);
      c1x = x1; c1y = y1 + d; c2x = x2; c2y = y2 - d;
    } else if (B.l >= A.r + 16 || B.r <= A.l - 16) {
      const right = B.l >= A.r + 16;
      x1 = right ? A.r + 2 : A.l - 2; y1 = (A.t + A.b) / 2; x2 = right ? B.l - 3 : B.r + 3; y2 = opts.centerY ? (B.t + B.b) / 2 : (B.t + Math.min(36, (B.b - B.t) / 2));
      const d = Math.max(opts.minCurve || 64, Math.abs(x2 - x1) * 0.42) * (right ? 1 : -1); c1x = x1 + d; c1y = y1; c2x = x2 - d; c2y = y2;
    } else {
      const down = B.t >= A.b;
      x1 = (A.l + A.r) / 2; y1 = down ? A.b + 2 : A.t - 2; x2 = Math.min(Math.max(x1, B.l + 24), B.r - 24); y2 = down ? B.t - 3 : B.b + 3;
      const d = Math.max(40, Math.abs(y2 - y1) * 0.5) * (down ? 1 : -1); c1x = x1 + 60; c1y = y1 + d; c2x = x2 + 60; c2y = y2 - d;
    }
    const attrs = { class: 'cv-link' + (opts.on ? ' on' : '') + (opts.dashed ? ' dashed' : ''), d: 'M' + x1 + ',' + y1 + ' C' + c1x + ',' + c1y + ' ' + c2x + ',' + c2y + ' ' + x2 + ',' + y2, stroke: LINK_COLOR[color], 'marker-end': 'url(#cv-ah-' + color + ')', 'data-from': opts.from || '', 'data-to': opts.to || '', 'data-action': opts.action || '' };
    if (opts.diffLink) attrs['data-diff-link'] = opts.diffLink;
    svg.append(mk('path', attrs));
    svg.append(mk('circle', { cx: x1, cy: y1, r: 4, fill: LINK_COLOR[color] }));
    if (label) {
      const mx = 0.125 * x1 + 0.375 * c1x + 0.375 * c2x + 0.125 * x2, my = 0.125 * y1 + 0.375 * c1y + 0.375 * c2y + 0.125 * y2;
      const lab = mk('text', { x: mx, y: my, class: 'cv-link-lab', fill: LINK_COLOR[color] }); lab.textContent = label; svg.append(lab);
    }
    n++;
  };
  CUR.pages.forEach((p) => {
    const grp = q(w, '.cv-group[data-page="' + CSS.escape(p.id) + '"]'); if (!grp) return;
    const isSplit = grp.classList.contains('is-split');
    const isDual = isSplit || grp.classList.contains('is-wipe');
    const sides = isDual ? ['before', 'after'] : ['after'];
    sides.forEach((modeSide) => {
      const sideFilter = '[data-side="' + modeSide + '"]';
      entries(p).forEach((e) => {
        if (!visible(e.n, modeSide)) return;
        const side = modeSide;
        const ias = interactionsOf(p, e.n, side); if (!ias.length) return;
        const sEl = q(grp, '[data-kind="node"][data-id="' + CSS.escape(e.n.id) + '"]' + sideFilter + ':not(.wf-slot)'); if (!sEl) return;
        ias.forEach((i) => {
          let tEl = null, color = 'unchanged';
          if (i.action === 'navigate') {
            const tp = CSS.escape(String(i.target || ''));
            tEl = (isDual ? q(w, '.cv-frame.cv-' + modeSide + '[data-page="' + tp + '"]:not(.cv-void)') : null) || q(w, '.cv-frame[data-page="' + tp + '"]:not(.cv-void)');
            const pg = pageById(i.target); color = pg && pg.change !== 'unchanged' ? pg.change : 'nav';
          } else if (i.target) {
            const t = CSS.escape(String(i.target));
            tEl = q(grp, '.cv-ov[data-ov="' + t + '"]' + sideFilter + ':not(.cv-ov-void)')
              || q(grp, '.cv-ov-solo[data-ov-group="' + t + '"][data-status="unchanged"] .cv-ov[data-ov="' + t + '"]')
              || q(grp, '[data-kind="node"][data-id="' + t + '"]' + sideFilter)
              || (!isDual ? q(w, '.cv-ov[data-ov="' + t + '"]:not(.cv-ov-void)') || q(w, '[data-kind="node"][data-id="' + t + '"]') : null);
            const f = findNodeAnywhere(i.target);
            if (f && LINK_COLOR[f.e.n.change]) color = f.e.n.change;
            else if (tEl && tEl.closest('.cv-ov-cmp[data-status="modified"]')) color = 'modified';
          }
          if (!tEl || tEl === sEl || tEl.contains(sEl) || sEl.contains(tEl)) return;
          const hovered = !!(hoverKey && (hoverKey === 'ov:' + e.n.id || hoverKey === 'ov:' + i.target));
          const related = !!(hovered || (sel && (sel.id === e.n.id || sel.id === i.target || (sel.kind === 'page' && sel.id === p.id))) || (unit && (unit === i.target || sEl.dataset.unit === unit || tEl.dataset.unit === unit)));
          const isPanelLink = tEl.classList.contains('cv-ov') || i.action === 'open' || i.action === 'toggle' || i.action === 'show';
          if (!isPanelLink && !ui.showLinks && !related) return;
          const tDock = tEl.closest('.cv-dock');
          const sDock = sEl.closest('.cv-dock');
          const isVertDock = !!(tDock && !sDock && (tDock.classList.contains('cv-dock-t') || tDock.classList.contains('cv-dock-b')));
          const isSameColDock = !!(tDock && sDock === tDock && (tDock.classList.contains('cv-dock-l') || tDock.classList.contains('cv-dock-r')));
          addCurve(loc(sEl.getBoundingClientRect()), loc(tEl.getBoundingClientRect()), color, IA_SHORT[i.action] || i.action, { on: related, dashed: color === 'removed', from: e.n.id, to: String(i.target || ''), action: i.action, vertical: isVertDock || isSameColDock });
        });
      });
    });
    if (isSplit) {
      const bf = q(grp, '.cv-frame.cv-before:not(.cv-void)'), af = q(grp, '.cv-frame.cv-after:not(.cv-void)');
      if (bf && af) {
        entries(p).forEach((e) => {
          if (e.n.movedTo) {
            const sEl = q(grp, '[data-kind="node"][data-id="' + CSS.escape(e.n.id) + '"][data-side="before"]:not(.wf-slot)');
            const tEl = q(grp, '[data-kind="node"][data-id="' + CSS.escape(e.n.movedTo) + '"][data-side="after"]:not(.wf-slot)');
            if (sEl && tEl) {
              const related = !!((sel && (sel.id === e.n.id || sel.id === e.n.movedTo)) || (unit && (unit === e.n.id || unit === e.n.movedTo || sEl.dataset.unit === unit || tEl.dataset.unit === unit)) || (hoverKey && (hoverKey === e.n.id + '|' + e.n.movedTo || hoverKey === e.n.movedTo + '|' + e.n.id)));
              if (related || ui.showLinks) addCurve(loc(sEl.getBoundingClientRect()), loc(tEl.getBoundingClientRect()), 'move', '移至', { on: related, dashed: true, centerY: true, minCurve: 36, from: e.n.id, to: e.n.movedTo, action: 'move', diffLink: 'move' });
            }
          } else if (e.n.change === 'modified' && e.n !== p.root) {
            const related = !!((sel && sel.id === e.n.id) || (unit && unit === e.n.id) || hoverKey === e.n.id);
            if (related) {
              const sEl = q(grp, '[data-kind="node"][data-id="' + CSS.escape(e.n.id) + '"][data-side="before"]:not(.wf-slot)');
              const tEl = q(grp, '[data-kind="node"][data-id="' + CSS.escape(e.n.id) + '"][data-side="after"]:not(.wf-slot)');
              if (sEl && tEl) addCurve(loc(sEl.getBoundingClientRect()), loc(tEl.getBoundingClientRect()), 'modified', '修改', { on: true, dashed: true, centerY: true, minCurve: 36, from: e.n.id, to: e.n.id, action: 'modify', diffLink: 'modified' });
            }
          }
        });
      }
    }
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
/* first = initial view: fit the first screen's main frame(s) at a readable zoom (don't let tall side overlay stacks shrink the page to 20%). */
function fitCam(animate, first) {
  const vp = vpEl(), w = worldEl(); if (!vp || !w) return;
  const r = vp.getBoundingClientRect();
  const tb = vp.querySelector('.cv-tools');
  const topPad = Math.max(58, (tb ? tb.offsetHeight : 36) + 24), pad = 28;
  let X = 0, Y = 0, W = w.offsetWidth, H = w.offsetHeight;
  if (first && w.children.length) {
    const g = w.children[0];
    const target = g.querySelector('.cv-cmp-box') || g.querySelector('.cv-pair') || g.querySelector('.cv-frame') || g;
    const tr = target.getBoundingClientRect();
    const k0 = ui.cam ? ui.cam.k : (w.getBoundingClientRect().width / (w.offsetWidth || 1) || 1);
    const wr = w.getBoundingClientRect();
    X = (tr.left - wr.left) / k0 - 20;
    Y = (tr.top - wr.top) / k0 - 20;
    W = tr.width / k0 + 40;
    H = Math.min(tr.height / k0 + 40, Math.max(900, (r.height - topPad - pad) / Math.max(0.25, (r.width - pad * 2) / W)));
  }
  if (!W || !r.width) return;
  const availW = Math.max(100, r.width - pad * 2);
  const availH = Math.max(100, r.height - topPad - pad);
  const k = Math.max(0.08, Math.min(1, availW / W, availH / H));
  ui.cam = { k: k, x: Math.max(pad, (r.width - W * k) / 2) - X * k, y: topPad + Math.max(0, Math.min(24, (availH - H * k) / 2)) - Y * k };
  if (animate) animateCam(); else applyCam();
}
function zoomAt(f, mx, my) {
  const c = ui.cam; if (!c) return;
  const k = Math.max(0.08, Math.min(3, c.k * f));
  c.x = mx - (mx - c.x) * (k / c.k); c.y = my - (my - c.y) * (k / c.k); c.k = k;
  applyCam();
}
function focusEls(els) {
  const vp = vpEl(), w = worldEl(); if (!vp || !w || !ui.cam) return;
  const list = (els || []).filter((el) => el && w.contains(el)); if (!list.length) return;
  const k0 = ui.cam.k, wr = w.getBoundingClientRect(), vr = vp.getBoundingClientRect();
  let l = 1e9, t = 1e9, r = -1e9, b = -1e9;
  list.forEach((el) => { const cr = el.getBoundingClientRect(); l = Math.min(l, (cr.left - wr.left) / k0); t = Math.min(t, (cr.top - wr.top) / k0); r = Math.max(r, (cr.right - wr.left) / k0); b = Math.max(b, (cr.bottom - wr.top) / k0); });
  const lw = Math.max(1, r - l), lh = Math.max(1, b - t);
  const topPad = 52, availH = Math.max(120, vr.height - topPad);
  const k = Math.max(0.15, Math.min(1.1, (vr.width * 0.8) / lw, (availH * 0.82) / lh));
  ui.cam = { k: k, x: vr.width / 2 - (l + lw / 2) * k, y: topPad + availH / 2 - (t + lh / 2) * k };
  animateCam();
}
function focusEl(el) { focusEls([el]); }
function wirePanZoom(vp) {
  let pan = null;
  vp.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input, select, textarea, .cv-tools, .cv-hint, .cv-wipe-handle, .cv-wipe-ctrl') || !ui.cam) return;
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
  if (!CUR.pages.length) return h('div', { class: 'cv-layout' }, h('div', { class: 'empty', style: 'flex:1' }, '本次变更不涉及界面。', ui.mode === 'edit' ? h('button', { onclick: () => mutate(opAddPage) }, '+ 新增页面') : null));
  const leftSide = ui.mode === 'edit' ? paletteSidebar() : changeList();
  return h('div', { class: 'cv-layout' + (ui.listOpen ? ' list-open' : '') + (ui.listCollapsed ? ' list-collapsed' : '') }, leftSide, canvasArea(), detailPanel());
}
function changeList() {
  const sp = CUR;
  const items = [];
  sp.pages.forEach((p) => {
    const us = UNITS.filter((u) => u.page === p.id);
    items.push(h('button', { class: 'cv-page', onclick: () => { ui.page = p.id; const f = document.querySelector('.cv-cmp-box[data-page="' + CSS.escape(p.id) + '"]') || document.querySelector('.cv-pair[data-page="' + CSS.escape(p.id) + '"]') || document.querySelector('.cv-frame[data-page="' + CSS.escape(p.id) + '"]'); if (f) focusEl(f); } },
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
  const nq = S.spec.questions.length;
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
  const diffOn = ui.diffMode || editing;
  const world = h('div', { class: 'cv-world is-split', id: 'cv-world' }, CUR.pages.map(pageGroup));
  const t = (key, label, title) => h('button', { class: ui[key] ? 'on' : null, title: title, onclick: () => { ui[key] = !ui[key]; render(); } }, label);
  const vbtn = (v, label, title) => h('button', { class: ui.diffView === v ? 'on' : null, 'data-dv': v, title: title, onclick: () => setDiffView(v) }, label);
  const unchangedPanels = CUR.pages.reduce((sum, p) => sum + collectPagePanels(p).filter((x) => x.status === 'unchanged').length, 0);
  const tools = h('div', { class: 'cv-tools' },
    h('button', { class: 'cv-listbtn' + (ui.listOpen ? ' on' : ''), title: editing ? '显示 / 隐藏组件库' : '显示 / 隐藏改动清单', onclick: () => { ui.listOpen = !ui.listOpen; render(); } }, editing ? '⊞ 组件库' : ('☰ 改动 ' + UNITS.length)),
    h('span', { class: 'cv-seg' },
      h('button', { class: !ui.diffMode ? 'on' : null, 'data-dm': 'clean', title: '默认：干净呈现前后页面效果，直接点选下拉框和标签页', onclick: () => setDiffMode(false) }, '纯净预览'),
      h('button', { class: ui.diffMode ? 'on' : null, 'data-dm': 'diff', title: '淡化未改动区域，并用绿/黄/红边框和编号突出所有改动', onclick: () => setDiffMode(true) }, '改动查看')),
    h('span', { class: 'cv-seg' },
      vbtn('split', '左右对比', '像 Git Split Diff 一样左右并排展示改动前与改动后，完整保留两侧页面布局'),
      vbtn('wipe', '滑块对比', '左右拖动中间滑块在同一画板上刮开对比改动前与改动后')),
    h('button', { class: ui.showPins ? 'on' : null, 'data-pins': '1', title: '像 Figma 一样在元素角落显示悬浮注释气泡（悬停查看，不占页面排版）', onclick: () => setShowPins(!ui.showPins) }, '💬 注释'),
    (!editing && unchangedPanels > 0) ? h('button', { class: ui.showAllPanels ? 'on' : null, 'data-all-panels': '1', title: '默认只显示有变化的弹窗/展开面板；点此切换显示未改动的交互面板', onclick: () => { ui.showAllPanels = !ui.showAllPanels; save(); render(); } }, '◻ 未改动面板 ' + unchangedPanels) : null,
    h('span', { class: 'cv-sep' }),
    h('button', { title: '缩小', onclick: () => { const r = vpEl().getBoundingClientRect(); zoomAt(1 / 1.25, r.width / 2, r.height / 2); } }, '−'),
    h('span', { id: 'cv-zoom', class: 'cv-zoom' }, ui.cam ? Math.round(ui.cam.k * 100) + '%' : ''),
    h('button', { title: '放大', onclick: () => { const r = vpEl().getBoundingClientRect(); zoomAt(1.25, r.width / 2, r.height / 2); } }, '+'),
    h('button', { title: '整个画布放进视口', onclick: () => fitCam(true) }, '适应'),
    h('span', { class: 'cv-sep' }),
    t('showLinks', '⇢ 全部连线', '交互面板箭头始终显示；打开可额外显示跳页、状态切换与跨画板移动连线'), t('showFn', 'ƒ 函数', '显示函数 / 接口占位'), t('showComp', '</> 组件', '显示每个模块对应的代码组件'));
  const listToggle = h('button', {
    class: 'cv-list-toggle' + (ui.listCollapsed ? ' collapsed' : ''),
    title: editing ? (ui.listCollapsed ? '展开左侧组件库' : '收起左侧组件库') : (ui.listCollapsed ? ('展开左侧改动清单（' + UNITS.length + ' 处）') : '收起左侧改动清单'),
    onclick: () => { ui.listCollapsed = !ui.listCollapsed; save(); render(); }
  }, ui.listCollapsed ? '›' : '‹');
  const vp = h('div', { class: 'cv-vp' + (diffOn ? ' diff-mode' : ' clean-mode') + (ui.diffMode ? ' fade' : '') + (ui.showPins ? '' : ' pins-off') + (ui.showFn ? ' show-fn' : '') + (ui.showComp ? ' show-comp' : '') + (editing ? ' editing' : ''), id: 'cv-vp' },
    world, listToggle, tools,
    h('div', { class: 'cv-hint' }, editing ? (ui.diffView === 'split' ? '从左侧组件库拖组件到右侧「' + sideLabel('after') + '」画板 · 拖组件改位置 · 拖空白处平移 · Ctrl/⌘+滚轮缩放' : '从左侧组件库拖组件到「' + sideLabel('after') + '」画板 · 将滑块拖到最左可完整编辑 · 拖空白处平移') : (ui.diffView === 'wipe' ? '左右拖动中间 ⇄ 滑块刮开对比前后版本 · 拖空白处平移 · Ctrl/⌘+滚轮缩放 · 悬停 💬 气泡看注释' : '拖动平移 · 滚轮上下移动 · Ctrl/⌘+滚轮缩放 · 下拉框与标签页可直接点击 · 悬停 💬 气泡看注释')));
  wirePanZoom(vp);
  return vp;
}
function pageFrame(p, side, showSideTag, fullVoidWidth) {
  const whole = p.change === 'added' || p.change === 'removed';
  const isVoid = (side === 'before' && p.change === 'added') || (side === 'after' && p.change === 'removed');
  const vPage = view(p, side);
  const sideTag = showSideTag ? h('span', { class: 'cv-side-tag ' + side }, sideLabel(side)) : null;
  if (isVoid) {
    const w = fullVoidWidth ? (Number(p.width) || 1280) : Math.min(Number(p.width) || 1280, 420);
    return h('div', { class: 'cv-frame cv-void cv-' + side, 'data-page': p.id, 'data-side': side, style: { width: w + 'px' } },
      h('div', { class: 'cv-fh', 'data-kind': 'page', 'data-id': p.id },
        sideTag, h('span', { class: 'dot dot-' + pageStatus(p) }), h('span', null, pageName(p)), p.route ? h('span', { class: 'route' }, p.route) : null),
      h('div', { class: 'cv-fb cv-void-body' }, side === 'before' ? (HAS_MULTI_VER ? sideLabel('before') + '没有这个页面' : '改动前没有这个页面') : (HAS_MULTI_VER ? sideLabel('after') + '已删除这个页面' : '这个页面将被删除')));
  }
  const ghost = side === 'before' && p.change === 'removed';
  const u = whole ? UNIT_BY.get(p.id) : null;
  const o = { side: side, ctx: 'canvas', parentLayout: 'col', whole: whole, unit: whole ? p.id : null, ghost: ghost };
  return h('div', { class: 'cv-frame cv-' + side + (whole ? ' mk mk-' + p.change + ' mk-u' : ''), 'data-page': p.id, 'data-side': side, style: { width: (Number(p.width) || 1280) + 'px' } },
    u ? h('span', { class: 'u-num u-' + p.change }, String(u.n)) : null,
    u ? h('span', { class: 'u-tag u-' + p.change }, p.change === 'added' ? '整页新增' : '整页删除') : null,
    h('div', { class: 'cv-fh', 'data-kind': 'page', 'data-id': p.id, 'data-unit': whole ? p.id : null },
      sideTag, h('span', { class: 'dot dot-' + pageStatus(p) }), h('span', null, pageName(vPage)), vPage.route ? h('span', { class: 'route' }, vPage.route) : null, cbadge('page', p.id)),
    h('div', { class: 'cv-fb' }, renderWF(p.root, p, o)));
}
function subtreeHasChange(n) {
  if (!n) return false;
  if (n.change && n.change !== 'unchanged') return true;
  return (n.children || []).some(subtreeHasChange);
}
function panelStatus(p, n) {
  if (p.change === 'added') return 'added';
  if (p.change === 'removed') return 'removed';
  const chain = parentChain(p, n.id);
  const ancAdded = chain.some((x) => x.change === 'added');
  const ancRemoved = chain.some((x) => x.change === 'removed');
  const inBefore = visible(n, 'before') && !ancAdded;
  const inAfter = visible(n, 'after') && !ancRemoved;
  if (!inBefore && inAfter) return 'added';
  if (inBefore && !inAfter) return 'removed';
  if (!inBefore && !inAfter) return 'removed';
  return subtreeHasChange(n) ? 'modified' : 'unchanged';
}
function collectPagePanels(p) {
  const seen = new Set();
  const reveals = [], overlays = [];
  const scan = (n) => {
    if (n !== p.root && isRevealed(n, p) && !seen.has(n.id)) {
      seen.add(n.id);
      reveals.push({ n: n, kind: 'reveal', status: panelStatus(p, n) });
    }
    (n.children || []).forEach(scan);
  };
  scan(p.root);
  p.overlays.forEach((ov) => {
    if (!seen.has(ov.id)) {
      seen.add(ov.id);
      overlays.push({ n: ov, kind: 'overlay', status: panelStatus(p, ov) });
    }
    scan(ov);
  });
  return reveals.concat(overlays);
}
function panelWidth(n, kind) {
  const v = view(n, n.change === 'removed' ? 'before' : 'after');
  if (kind === 'reveal') return Number(v.pw) || (bt(v.type) === 'list' || bt(v.type) === 'menu' ? 360 : 480);
  return Number(v.pw) || OV_W[bt(v.type)] || OV_W[v.type] || 420;
}
function panelTriggersNode(p, n, kind, side) {
  const v = view(n, side);
  if (kind === 'overlay') {
    const trs = trigList(v).map((t) => findNode(p, t)).filter((t) => t && visible(t.n, side));
    return trs.length
      ? h('span', { class: 'cv-ov-trig' }, '点击 ', trs.map((t, i) => [i ? '、' : '', h('button', { class: 'lnk', onclick: (e) => { e.stopPropagation(); focusNode(p.id, t.n.id); } }, nlabel(view(t.n, side)))]), ' 后打开')
      : h('span', { class: 'cv-ov-trig muted' }, '未指定触发元素');
  }
  const chain = parentChain(p, n.id).filter((x) => x !== p.root);
  const parent = chain[chain.length - 1];
  const sh = showersOf(n.id).filter((x) => visible(x, side));
  return h('span', { class: 'cv-ov-trig' },
    sh.length ? ['点击 ', sh.map((t, i) => [i ? '、' : '', h('button', { class: 'lnk', onclick: (e) => { e.stopPropagation(); focusNode(p.id, t.id); } }, nlabel(view(t, side)))]), ' 后展开'] : '展开面板',
    parent ? ' · 在 ' + nlabel(view(parent, side)) + ' 里' : '',
    ' ',
    h('button', { class: 'lnk', onclick: (e) => { e.stopPropagation(); const sl = document.querySelector('#cv-world .wf-slot[data-id="' + CSS.escape(n.id) + '"][data-side="' + side + '"]') || document.querySelector('#cv-world .wf-slot[data-id="' + CSS.escape(n.id) + '"]'); if (sl) focusEl(sl); } }, '看位置'));
}
function panelCard(n, p, kind, side, width, compactHead) {
  const whole = p.change === 'added' || p.change === 'removed';
  const ghost = side === 'before' && (p.change === 'removed' || n.change === 'removed');
  const v = view(n, side);
  let anchorIds = [], triggerAttr = null, bodyEl = null, changeAttr = ghost ? 'removed' : n.change;
  if (kind === 'overlay') {
    const trs = trigList(v).map((t) => findNode(p, t)).filter((t) => t && visible(t.n, side));
    anchorIds = trs.map((t) => t.n.id);
    triggerAttr = trigList(v).join(' ') || null;
    bodyEl = renderWF(n, p, { side: side, ctx: 'canvas', parentLayout: 'col', whole: whole, unit: whole ? p.id : null, ghost: ghost });
  } else {
    const chain = parentChain(p, n.id).filter((x) => x !== p.root);
    const anc = chain.find((x) => x.change !== 'unchanged');
    const sh = showersOf(n.id).filter((x) => visible(x, side));
    anchorIds = sh.map((x) => x.id);
    changeAttr = ghost ? 'removed' : (anc ? anc.change : n.change);
    bodyEl = renderWF(n, p, { side: side, ctx: 'canvas', parentLayout: 'col', asPanel: true, ghost: ghost, whole: whole || !!(anc && (anc.change === 'added' || anc.change === 'removed')), unit: (whole ? p.id : null) || (anc ? anc.id : null) });
  }
  const head = compactHead
    ? h('div', { class: 'cv-ovh cv-ovh-side' }, h('span', { class: 'cv-side-tag ' + side }, sideLabel(side)))
    : null;
  return h('div', {
    class: 'cv-ov' + (kind === 'reveal' ? ' cv-rev' : '') + (side === 'before' ? ' cv-ov-before' : ' cv-ov-after'),
    'data-ov': n.id, 'data-page': p.id, 'data-side': side,
    'data-anchor': anchorIds.join(' ') || null, 'data-trigger': triggerAttr,
    'data-slot': kind === 'reveal' ? n.id : null, 'data-change': changeAttr,
    style: { width: width + 'px' }
  }, head, bodyEl);
}
function voidPanelCard(n, p, kind, side, width, kindLbl) {
  return h('div', {
    class: 'cv-ov cv-ov-void ' + (side === 'before' ? 'cv-ov-before' : 'cv-ov-after'),
    'data-ov': n.id, 'data-page': p.id, 'data-side': side,
    style: { width: width + 'px' }
  },
    h('div', { class: 'cv-ovh cv-ovh-side' }, h('span', { class: 'cv-side-tag ' + side }, sideLabel(side))),
    h('div', { class: 'cv-ov-void-body' }, side === 'before' ? (sideLabel('before') + ' 中无此' + kindLbl) : (sideLabel('after') + ' 中已删除')));
}
function panelBox(item, p, isDualPage) {
  const { n, kind, status } = item;
  const w = panelWidth(n, kind);
  const mainSide = status === 'removed' ? 'before' : 'after';
  const v = view(n, mainSide);
  const kindLbl = kind === 'reveal' ? '展开面板' : tname(v.type);
  const titleText = nlabel(v);
  const trigEl = panelTriggersNode(p, n, kind, mainSide);
  const anchorSet = new Set();
  ['before', 'after'].forEach((sd) => {
    if (!visible(n, sd)) return;
    const vs = view(n, sd);
    if (kind === 'overlay') trigList(vs).forEach((id) => anchorSet.add(String(id)));
    else showersOf(n.id).forEach((x) => anchorSet.add(String(x.id)));
  });
  const anchorAttr = [...anchorSet].join(' ') || null;
  // In dual comparison view, every interactive panel renders as its own standalone before→after comparison box (matching the main page box).
  if (isDualPage) {
    const bridgeLbl = HAS_MULTI_VER ? ('v' + ui.leftVer + '→v' + ui.rightVer) : (status === 'added' ? '新增' : status === 'removed' ? '删除' : status === 'modified' ? '修改' : '对比');
    const statusChip = status === 'unchanged' ? h('span', { class: 'chip sm' }, '无改动') : chgChip(status);
    const bf = status === 'added' ? voidPanelCard(n, p, kind, 'before', w, kindLbl) : panelCard(n, p, kind, 'before', w, true);
    const af = status === 'removed' ? voidPanelCard(n, p, kind, 'after', w, kindLbl) : panelCard(n, p, kind, 'after', w, true);
    const boxAttrs = {
      class: 'cv-cmp-box cv-ov-cmp cv-ov-item' + (ui.diffView === 'wipe' ? ' is-wipe' : ''),
      'data-page': p.id, 'data-ov-group': n.id, 'data-status': status,
      'data-anchor': anchorAttr, 'data-slot': kind === 'reveal' ? n.id : null
    };
    if (ui.diffView === 'wipe') {
      const wkey = p.id + '::' + n.id;
      const pct = ui.wipePos[wkey] !== undefined ? ui.wipePos[wkey] : 50;
      const wipeBox = h('div', { class: 'cv-wipe cv-ov-wipe', 'data-page': p.id, 'data-wipe-key': wkey, style: { width: w + 'px', '--wipe': pct + '%' } },
        h('div', { class: 'cv-wipe-after' }, af),
        h('div', { class: 'cv-wipe-before' }, bf));
      wipeBox.append(h('div', { class: 'cv-wipe-handle', title: '左右拖动对比前后版本', onpointerdown: (e) => startWipeDrag(e, wkey, wipeBox) },
        h('div', { class: 'cv-wipe-line' }),
        h('div', { class: 'cv-wipe-knob' }, '⇄')));
      const range = h('input', { type: 'range', class: 'cv-wipe-range', 'data-wipe-key': wkey, min: '0', max: '100', value: String(pct), oninput: (e) => setWipePos(wkey, e.target.value), onclick: (e) => e.stopPropagation() });
      return h('div', boxAttrs,
        h('div', { class: 'cv-cmp-head cv-ov-cmp-head' },
          h('div', { class: 'cv-ov-cmp-meta' },
            h('span', { class: 'cv-cmp-title' }, h('span', { class: 'dot dot-' + status }), h('span', { class: 'chip sm' }, kindLbl), h('b', null, titleText), statusChip),
            trigEl),
          h('span', { class: 'cv-wipe-ctrl', onclick: (e) => e.stopPropagation() },
            h('button', { class: 'lnk cv-leg-a', title: '完整看右侧版本', onclick: () => setWipePos(wkey, 0) }, sideLabel('after')),
            range,
            h('button', { class: 'lnk cv-leg-b', title: '完整看左侧版本', onclick: () => setWipePos(wkey, 100) }, sideLabel('before')),
            h('span', { class: 'cv-wipe-pct', 'data-wipe-key': wkey }, pct + '%'))),
        wipeBox);
    }
    return h('div', boxAttrs,
      h('div', { class: 'cv-cmp-head cv-ov-cmp-head' },
        h('div', { class: 'cv-ov-cmp-meta' },
          h('span', { class: 'cv-cmp-title' }, h('span', { class: 'dot dot-' + status }), h('span', { class: 'chip sm' }, kindLbl), h('b', null, titleText), statusChip),
          trigEl),
        h('span', { class: 'cv-cmp-legend' }, h('span', { class: 'cv-leg-b' }, sideLabel('before')), ' → ', h('span', { class: 'cv-leg-a' }, sideLabel('after')))),
      h('div', { class: 'cv-pair cv-ov-pair' },
        bf,
        h('div', { class: 'cv-bridge cv-ov-bridge', 'aria-hidden': 'true' }, h('div', { class: 'cv-bridge-arrow' }, '→'), h('div', { class: 'cv-bridge-lbl' }, bridgeLbl)),
        af));
  }
  // On an unchanged single-frame page: render one standalone card.
  return h('div', { class: 'cv-ov-solo cv-ov-item is-' + status, 'data-page': p.id, 'data-ov-group': n.id, 'data-status': status, 'data-anchor': anchorAttr, 'data-slot': kind === 'reveal' ? n.id : null },
    h('div', { class: 'cv-ov-solo-head' },
      h('div', { class: 'cv-ov-cmp-meta' },
        h('span', { class: 'cv-cmp-title' }, h('span', { class: 'dot dot-' + status }), h('span', { class: 'chip sm' }, kindLbl), h('b', null, titleText), h('span', { class: 'chip sm' }, '无改动')),
        trigEl)),
    panelCard(n, p, kind, mainSide, w, false));
}
function panelDocks(p, editing, isDualPage) {
  const all = collectPagePanels(p);
  const showUnchanged = !!(editing || ui.showAllPanels);
  const list = showUnchanged ? all : all.filter((item) => item.status !== 'unchanged');
  if (!list.length && !editing) return [];
  return [
    h('div', { class: 'cv-dock cv-dock-t', 'data-dock': 't', 'data-page': p.id, hidden: true }),
    h('div', { class: 'cv-dock cv-dock-l', 'data-dock': 'l', 'data-page': p.id, hidden: true }),
    h('div', { class: 'cv-dock cv-dock-r', 'data-dock': 'r', 'data-page': p.id, hidden: !editing },
      editing ? h('div', { class: 'cv-ovdrop', 'data-drop': 'overlays', 'data-page': p.id }, '把组件拖到这里，变成点击后才出现的弹层') : null),
    h('div', { class: 'cv-dock cv-dock-b', 'data-dock': 'b', 'data-page': p.id, hidden: !list.length },
      list.map((item) => panelBox(item, p, isDualPage)))
  ];
}
function startWipeDrag(e, key, box) {
  e.preventDefault(); e.stopPropagation();
  const move = (ev) => {
    const r = box.getBoundingClientRect();
    if (!r.width) return;
    setWipePos(key, ((ev.clientX - r.left) / r.width) * 100);
  };
  const end = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', end);
    document.removeEventListener('pointercancel', end);
  };
  move(e);
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
}
function pageGroup(p) {
  const status = pageStatus(p);
  if (status === 'unchanged') {
    const frame = pageFrame(p, 'after', false);
    frame.classList.add('cv-main-slot');
    const editing = ui.mode === 'edit';
    return h('div', { class: 'cv-group is-single', 'data-page': p.id }, frame, ...panelDocks(p, editing, false));
  }
  const editing = ui.mode === 'edit' && p.change !== 'removed';
  const docks = panelDocks(p, editing, true);
  const bridgeLbl = HAS_MULTI_VER ? ('v' + ui.leftVer + '→v' + ui.rightVer) : (p.change === 'added' ? '新增' : p.change === 'removed' ? '删除' : '改版');
  if (ui.diffView === 'wipe') {
    const pct = ui.wipePos[p.id] !== undefined ? ui.wipePos[p.id] : 50;
    const bf = pageFrame(p, 'before', true, true);
    const af = pageFrame(p, 'after', true, true);
    const wipeBox = h('div', { class: 'cv-wipe', 'data-page': p.id, 'data-wipe-key': p.id, style: { width: (Number(p.width) || 1280) + 'px', '--wipe': pct + '%' } },
      h('div', { class: 'cv-wipe-after' }, af),
      h('div', { class: 'cv-wipe-before' }, bf));
    const handle = h('div', { class: 'cv-wipe-handle', title: '左右拖动对比前后版本', onpointerdown: (e) => startWipeDrag(e, p.id, wipeBox) },
      h('div', { class: 'cv-wipe-line' }),
      h('div', { class: 'cv-wipe-knob' }, '⇄'));
    wipeBox.append(handle);
    const range = h('input', { type: 'range', class: 'cv-wipe-range', 'data-page': p.id, 'data-wipe-key': p.id, min: '0', max: '100', value: String(pct), oninput: (e) => setWipePos(p.id, e.target.value), onclick: (e) => e.stopPropagation() });
    const cmpBox = h('div', { class: 'cv-cmp-box cv-main-slot is-wipe', 'data-page': p.id },
      h('div', { class: 'cv-cmp-head', 'data-kind': 'page', 'data-id': p.id, 'data-unit': (p.change === 'added' || p.change === 'removed') ? p.id : null },
        h('span', { class: 'cv-cmp-title' }, h('span', { class: 'dot dot-' + status }), h('b', null, pageName(p)), p.route ? h('span', { class: 'route' }, p.route) : null, chgChip(status)),
        h('span', { class: 'cv-wipe-ctrl', onclick: (e) => e.stopPropagation() },
          h('button', { class: 'lnk cv-leg-a', title: '滑块拉到最左，完整看右侧版本', onclick: () => setWipePos(p.id, 0) }, sideLabel('after')),
          range,
          h('button', { class: 'lnk cv-leg-b', title: '滑块拉到最右，完整看左侧版本', onclick: () => setWipePos(p.id, 100) }, sideLabel('before')),
          h('span', { class: 'cv-wipe-pct', 'data-page': p.id, 'data-wipe-key': p.id }, pct + '%'))),
      wipeBox);
    return h('div', { class: 'cv-group is-wipe', 'data-page': p.id }, cmpBox, ...docks);
  }
  const bf = pageFrame(p, 'before', true, false);
  const af = pageFrame(p, 'after', true, false);
  const cmpBox = h('div', { class: 'cv-cmp-box cv-main-slot', 'data-page': p.id },
    h('div', { class: 'cv-cmp-head', 'data-kind': 'page', 'data-id': p.id, 'data-unit': (p.change === 'added' || p.change === 'removed') ? p.id : null },
      h('span', { class: 'cv-cmp-title' }, h('span', { class: 'dot dot-' + status }), h('b', null, pageName(p)), p.route ? h('span', { class: 'route' }, p.route) : null, chgChip(status)),
      h('span', { class: 'cv-cmp-legend' }, h('span', { class: 'cv-leg-b' }, sideLabel('before')), ' → ', h('span', { class: 'cv-leg-a' }, sideLabel('after')))),
    h('div', { class: 'cv-pair', 'data-page': p.id },
      bf,
      h('div', { class: 'cv-bridge', 'aria-hidden': 'true' }, h('div', { class: 'cv-bridge-arrow' }, '→'), h('div', { class: 'cv-bridge-lbl' }, bridgeLbl)),
      af));
  return h('div', { class: 'cv-group is-split', 'data-page': p.id }, cmpBox, ...docks);
}
const OV_W = { drawer: 440, modal: 560, menu: 300, popover: 320 };
/* Equalize wipe heights and dock every interactive panel box on the closest edge (left / right / top / bottom) of its trigger button. */
function layoutPanels() {
  const w = worldEl(); if (!w) return;
  w.querySelectorAll('.cv-wipe').forEach((wp) => {
    const bf = wp.querySelector('.cv-wipe-before > .cv-frame, .cv-wipe-before > .cv-ov');
    const af = wp.querySelector('.cv-wipe-after > .cv-frame, .cv-wipe-after > .cv-ov');
    if (bf && af) {
      bf.style.minHeight = ''; af.style.minHeight = '';
      const mh = Math.max(bf.offsetHeight, af.offsetHeight);
      bf.style.minHeight = mh + 'px'; af.style.minHeight = mh + 'px';
    }
  });
  const k = w.getBoundingClientRect().width / (w.offsetWidth || 1) || 1;
  w.querySelectorAll('.cv-group').forEach((g) => {
    const mainSlot = g.querySelector(':scope > .cv-main-slot');
    const docks = {
      t: g.querySelector(':scope > .cv-dock-t'),
      l: g.querySelector(':scope > .cv-dock-l'),
      r: g.querySelector(':scope > .cv-dock-r'),
      b: g.querySelector(':scope > .cv-dock-b')
    };
    if (!mainSlot || !docks.b) return;
    const boxes = [...g.querySelectorAll(':scope > .cv-dock > .cv-ov-item')];
    if (!boxes.length) return;
    const frames = [...mainSlot.querySelectorAll('.cv-frame:not(.cv-void)')];
    const primaryFrame = mainSlot.querySelector('.cv-frame.cv-after:not(.cv-void)') || frames[0];
    if (!primaryFrame) return;

    const placed = new Map();
    const pending = [];
    const pickSide = (box, rx, ry) => {
      const st = box.dataset.status || '';
      const isSplit = g.classList.contains('is-split');
      if (isSplit && st === 'added') {
        if (rx > 0.62) return 'r';
        return ry < 0.44 ? 't' : 'b';
      }
      if (isSplit && st === 'removed') {
        if (rx < 0.58) return 'l';
        return ry < 0.44 ? 't' : 'b';
      }
      if (rx < 0.34) return 'l';
      if (rx > 0.66) return 'r';
      if (ry < 0.44) return 't';
      return 'b';
    };

    boxes.forEach((box, idx) => {
      box.style.marginTop = '';
      const ids = (box.dataset.anchor || '').split(/\s+/).filter(Boolean);
      if (box.dataset.slot) ids.push(box.dataset.slot);
      const refFrame = box.dataset.status === 'removed'
        ? (mainSlot.querySelector('.cv-frame.cv-before:not(.cv-void)') || primaryFrame)
        : primaryFrame;
      const fr = refFrame.getBoundingClientRect();
      let sumX = 0, sumY = 0, cnt = 0, rawY = null;
      ids.forEach((id) => {
        const el = refFrame.querySelector('[data-kind="node"][data-id="' + CSS.escape(id) + '"]') || refFrame.querySelector('.wf-slot[data-id="' + CSS.escape(id) + '"]');
        if (!el) return;
        const r = el.getBoundingClientRect();
        const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
        sumX += (cx - fr.left) / (fr.width || 1);
        sumY += (cy - fr.top) / (fr.height || 1);
        cnt++;
        const yRel = (r.top - fr.top) / k;
        if (rawY === null || yRel < rawY) rawY = yRel;
      });
      if (cnt > 0) {
        const rx = sumX / cnt, ry = sumY / cnt;
        placed.set(box.dataset.ovGroup, { box: box, dock: pickSide(box, rx, ry), rx: rx, ry: ry, rawY: rawY, idx: idx });
      } else {
        pending.push({ box: box, ids: ids, idx: idx });
      }
    });

    // Nested panels (triggered from inside another panel) follow their parent panel's dock.
    pending.forEach((item) => {
      let parentInfo = null;
      for (const id of item.ids) {
        const trigEl = g.querySelector('.cv-ov-item [data-kind="node"][data-id="' + CSS.escape(id) + '"]');
        const pBox = trigEl && trigEl.closest('.cv-ov-item');
        if (pBox && placed.has(pBox.dataset.ovGroup)) { parentInfo = placed.get(pBox.dataset.ovGroup); break; }
      }
      const dock = parentInfo ? parentInfo.dock : (item.box.dataset.status === 'removed' ? 'l' : 'r');
      placed.set(item.box.dataset.ovGroup, {
        box: item.box, dock: dock,
        rx: parentInfo ? parentInfo.rx + 0.01 : 0.5,
        ry: parentInfo ? parentInfo.ry + 0.05 : 0.5,
        rawY: parentInfo && parentInfo.rawY !== null ? parentInfo.rawY + 140 : null,
        idx: item.idx
      });
    });

    const buckets = { t: [], l: [], r: [], b: [] };
    placed.forEach((info) => buckets[info.dock].push(info));
    buckets.t.sort((a, b) => a.rx - b.rx || a.idx - b.idx);
    buckets.b.sort((a, b) => a.rx - b.rx || a.idx - b.idx);
    buckets.l.sort((a, b) => (a.rawY ?? 1e9) - (b.rawY ?? 1e9) || a.idx - b.idx);
    buckets.r.sort((a, b) => (a.rawY ?? 1e9) - (b.rawY ?? 1e9) || a.idx - b.idx);

    const drop = g.querySelector(':scope > .cv-dock > .cv-ovdrop');
    ['t', 'l', 'r', 'b'].forEach((d) => {
      const el = docks[d]; if (!el) return;
      buckets[d].forEach((info) => el.append(info.box));
      if (d === 'r' && drop) el.append(drop);
      el.hidden = el.children.length === 0;
    });

    // Vertically align left & right docked panels to their trigger button height without overlap.
    const mainTop = mainSlot.getBoundingClientRect().top;
    const frameOffset = (primaryFrame.getBoundingClientRect().top - mainTop) / k;
    ['l', 'r'].forEach((d) => {
      const list = buckets[d];
      if (!list.length) return;
      let cursor = 0;
      const gap = 22;
      list.forEach((info) => {
        const want = info.rawY !== null ? Math.max(0, Math.round(frameOffset + info.rawY - 16)) : cursor;
        const top = Math.max(cursor, want);
        const mt = top - cursor;
        if (mt > 0) info.box.style.marginTop = mt + 'px';
        cursor = top + (info.box.offsetHeight || 160) + gap;
      });
    });
  });
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
function commentTargetOf(s, u) {
  if (s) {
    if (s.kind === 'node') return { kind: 'node', page: s.page, id: s.id, side: s.side };
    if (s.kind === 'page') return { kind: 'page', id: s.id };
    if (s.kind === 'flow') return { kind: 'flow', id: s.id };
    if (s.kind === 'step') return { kind: 'step', flow: s.flow, id: s.id, side: s.side };
    if (s.kind === 'be') return { kind: 'be', id: s.id, side: s.side };
  }
  if (u) return u.kind === 'page' ? { kind: 'page', id: u.page } : { kind: 'node', page: u.page, id: u.id, side: u.change === 'removed' ? 'before' : 'after' };
  return null;
}
function detailPanel() {
  const u = ui.unit ? UNIT_BY.get(ui.unit) : null;
  const s = ui.sel;
  const parts = [];
  if (u) parts.push(unitDetail(u));
  if (s && (s.kind === 'node' || s.kind === 'page')) {
    const isUnitRoot = !!u && ((s.kind === 'node' && s.id === u.id) || (s.kind === 'page' && u.kind === 'page' && s.id === u.page));
    const body = s.kind === 'node' ? inspNode(s, isUnitRoot) : inspPage(s, isUnitRoot);
    if (body && body.length) parts.push(h('div', { class: 'dt-sec' }, isUnitRoot ? (ui.mode === 'edit' ? h('div', { class: 'sec-t' }, '修改这一处') : null) : h('div', { class: 'sec-t' }, '选中的元素'), body));
  }
  const cTarget = commentTargetOf(s && (s.kind === 'node' || s.kind === 'page') ? s : null, u);
  if (!parts.length && !cTarget) return null;
  return h('aside', { class: 'inspector dt', id: 'inspector' },
    h('div', { class: 'ins-top' }, h('span', null, u ? '改动 ' + u.n + ' / ' + UNITS.length : '元素'),
      u && UNITS.length > 1 ? h('span', { class: 'dt-nav' }, btn('‹ 上一处', () => focusUnit(UNITS[(u.n - 2 + UNITS.length) % UNITS.length].key)), btn('下一处 ›', () => focusUnit(UNITS[u.n % UNITS.length].key))) : null,
      h('button', { class: 'lnk', onclick: () => { ui.sel = null; ui.unit = null; render(); } }, '关闭 ✕')),
    h('div', { class: 'ins-scroll', id: 'ins-scroll' }, parts),
    cTarget ? h('div', { class: 'ins-foot' }, commentBox(cTarget)) : null);
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
  if (!isPage) { const bb = buiBlock(n.type); if (bb) out.push(bb); }
  if (holder.note) out.push(h('div', { class: 'ins-note' }, h('b', null, 'Agent 说明：'), holder.note));
  if (!isPage && n.before && n.change === 'modified') out.push(diffBox(n));
  if (!isPage && (n.movedFrom || n.movedTo)) {
    const other = n.movedFrom || n.movedTo;
    out.push(h('div', { class: 'ins-note' }, n.movedFrom ? '从别处移过来的。' : '被移到了别处。', h('button', { class: 'lnk', onclick: () => focusNode(p.id, other) }, '看另一处')));
  }
  const whole = u.change === 'added' || u.change === 'removed';
  const before = u.change === 'added' ? h('div', { class: 'dt-void' }, isPage ? (sideLabel('before') + '没有这个页面') : (sideLabel('before') + '没有这个模块')) : detailRender(n, p, 'before', whole);
  const after = u.change === 'removed' ? h('div', { class: 'dt-void' }, n.movedTo ? '移到了别处（点上面的「看另一处」）' : isPage ? '这个页面将被删除' : '这个模块将被删除') : detailRender(n, p, 'after', whole);
  out.push(h('div', { class: 'dt-cmp' },
    h('div', { class: 'side-before' }, h('div', { class: 'side-t' }, sideLabel('before')), before),
    h('div', { class: 'side-after' }, h('div', { class: 'side-t' }, sideLabel('after')), after)));
  const ids = subtreeIds(n);
  const inter = [];
  p.overlays.forEach((x) => {
    const xs = x.change === 'removed' ? 'before' : 'after';
    if (ids.has(x.id)) return;
    trigList(view(x, xs)).filter((tr) => ids.has(tr)).forEach((tr) => { const t = findNode(p, tr); inter.push(h('li', null, '点击 ', t ? nlabel(view(t.n, xs)) : '#' + tr, ' → 打开 ', h('button', { class: 'lnk', onclick: () => focusNode(p.id, x.id) }, '▸ ' + tname(x.type) + '「' + short(x.label || '', 18) + '」'))); });
  });
  if (!isPage && OVERLAY.has(bt(n.type))) { const ts = trigList(view(n, n.change === 'removed' ? 'before' : 'after')).map((tr) => findNode(p, tr)).filter(Boolean); inter.push(h('li', null, '由 ', ts.length ? ts.map((t, i) => [i ? '、' : '', h('button', { class: 'lnk', onclick: () => focusNode(p.id, t.n.id) }, nlabel(t.n))]) : '（未指定的元素）', ' 打开')); }
  CUR.flows.forEach((f) => {
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
const PAL_SVG = {
  dialog: '<rect x="6" y="4" width="76" height="36" rx="4" fill="#eef0f4"/><rect x="18" y="8" width="52" height="28" rx="4" fill="#fff" stroke="#334155" stroke-width="1.4"/><line x1="24" y1="15" x2="48" y2="15" stroke="#334155" stroke-width="2" stroke-linecap="round"/><line x1="24" y1="21" x2="62" y2="21" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round"/><rect x="49" y="26" width="15" height="6" rx="2" fill="#18181b"/><rect x="34" y="26" width="12" height="6" rx="2" fill="#e2e8f0"/>',
  drawer: '<rect x="6" y="4" width="76" height="36" rx="4" fill="#eef0f4" stroke="#cbd5e1"/><rect x="46" y="4" width="36" height="36" rx="3" fill="#fff" stroke="#334155" stroke-width="1.4"/><line x1="52" y1="13" x2="72" y2="13" stroke="#334155" stroke-width="2" stroke-linecap="round"/><line x1="52" y1="20" x2="76" y2="20" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round"/><line x1="52" y1="26" x2="70" y2="26" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round"/><rect x="52" y="31" width="24" height="5" rx="2" fill="#18181b"/>',
  popover: '<rect x="26" y="5" width="36" height="9" rx="3" fill="#e2e8f0"/><path d="M44 14l4 4h-8z" fill="#334155"/><rect x="14" y="18" width="60" height="21" rx="4" fill="#fff" stroke="#334155" stroke-width="1.3"/><line x1="21" y1="25" x2="54" y2="25" stroke="#64748b" stroke-width="2" stroke-linecap="round"/><line x1="21" y1="31" x2="66" y2="31" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round"/>',
  menu: '<rect x="20" y="5" width="48" height="34" rx="4" fill="#fff" stroke="#334155" stroke-width="1.3"/><rect x="23" y="9" width="42" height="7" rx="2" fill="#eef2ff"/><line x1="27" y1="12.5" x2="50" y2="12.5" stroke="#3e63dd" stroke-width="1.8" stroke-linecap="round"/><line x1="27" y1="22" x2="55" y2="22" stroke="#64748b" stroke-width="1.8" stroke-linecap="round"/><line x1="27" y1="31" x2="48" y2="31" stroke="#64748b" stroke-width="1.8" stroke-linecap="round"/>',
  select: '<rect x="10" y="13" width="68" height="18" rx="4" fill="#fff" stroke="#475569" stroke-width="1.3"/><line x1="17" y1="22" x2="48" y2="22" stroke="#64748b" stroke-width="2" stroke-linecap="round"/><path d="M65 20l4 4 4-4" fill="none" stroke="#334155" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  switch: '<rect x="22" y="13" width="44" height="18" rx="9" fill="#18181b"/><circle cx="57" cy="22" r="6.5" fill="#fff"/>',
  checkbox: '<rect x="16" y="14" width="16" height="16" rx="3.5" fill="#18181b"/><path d="M20 22l3 3 5.5-6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><line x1="38" y1="22" x2="70" y2="22" stroke="#475569" stroke-width="2.2" stroke-linecap="round"/>',
  tabs: '<line x1="10" y1="22" x2="78" y2="22" stroke="#cbd5e1" stroke-width="1.2"/><line x1="14" y1="15" x2="29" y2="15" stroke="#18181b" stroke-width="2.2" stroke-linecap="round"/><line x1="12" y1="22" x2="31" y2="22" stroke="#3e63dd" stroke-width="2.2"/><line x1="39" y1="15" x2="54" y2="15" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"/><line x1="62" y1="15" x2="74" y2="15" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"/><rect x="10" y="27" width="68" height="11" rx="3" fill="#f1f5f9"/>',
  accordion: '<rect x="10" y="6" width="68" height="14" rx="3" fill="#fff" stroke="#475569" stroke-width="1.2"/><line x1="16" y1="13" x2="46" y2="13" stroke="#334155" stroke-width="2" stroke-linecap="round"/><path d="M67 11l3 3 3-3" fill="none" stroke="#475569" stroke-width="1.4"/><rect x="10" y="23" width="68" height="15" rx="3" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.2"/><line x1="16" y1="29" x2="54" y2="29" stroke="#94a3b8" stroke-width="1.8" stroke-linecap="round"/><line x1="16" y1="34" x2="40" y2="34" stroke="#cbd5e1" stroke-width="1.8" stroke-linecap="round"/>',
  toolbar: '<rect x="8" y="13" width="72" height="18" rx="5" fill="#fff" stroke="#cbd5e1" stroke-width="1.2"/><rect x="13" y="17" width="14" height="10" rx="2.5" fill="#18181b"/><rect x="31" y="17" width="14" height="10" rx="2.5" fill="#e2e8f0"/><rect x="49" y="17" width="12" height="10" rx="2.5" fill="#e2e8f0"/><rect x="65" y="17" width="10" height="10" rx="2.5" fill="#e2e8f0"/>',
  field: '<line x1="12" y1="11" x2="36" y2="11" stroke="#475569" stroke-width="2" stroke-linecap="round"/><rect x="12" y="16" width="64" height="16" rx="3.5" fill="#fff" stroke="#475569" stroke-width="1.2"/><line x1="12" y1="37" x2="48" y2="37" stroke="#cbd5e1" stroke-width="1.6" stroke-linecap="round"/>',
  form: '<rect x="12" y="5" width="64" height="34" rx="4" fill="#fff" stroke="#cbd5e1" stroke-width="1.2"/><rect x="18" y="10" width="52" height="7" rx="2" fill="#f1f5f9" stroke="#94a3b8" stroke-width="1"/><rect x="18" y="20" width="52" height="7" rx="2" fill="#f1f5f9" stroke="#94a3b8" stroke-width="1"/><rect x="48" y="30" width="22" height="6" rx="2" fill="#18181b"/>',
  toast: '<rect x="12" y="12" width="64" height="20" rx="6" fill="#18181b"/><circle cx="22" cy="22" r="4" fill="#22c55e"/><line x1="30" y1="20" x2="62" y2="20" stroke="#fff" stroke-width="2" stroke-linecap="round"/><line x1="30" y1="25" x2="50" y2="25" stroke="#94a3b8" stroke-width="1.6" stroke-linecap="round"/>',
  tooltip: '<rect x="18" y="7" width="52" height="16" rx="4" fill="#18181b"/><line x1="26" y1="15" x2="62" y2="15" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="M40 23l4 5 4-5z" fill="#18181b"/><rect x="34" y="31" width="20" height="7" rx="3" fill="#e2e8f0"/>',
  avatar: '<circle cx="44" cy="22" r="14" fill="#e2e8f0" stroke="#64748b" stroke-width="1.3"/><circle cx="44" cy="18" r="4.5" fill="#64748b"/><path d="M35 31c1.8-4.2 5.2-6 9-6s7.2 1.8 9 6" fill="#64748b"/>',
  progress: '<rect x="10" y="18" width="68" height="8" rx="4" fill="#e2e8f0"/><rect x="10" y="18" width="44" height="8" rx="4" fill="#3e63dd"/>',
  separator: '<line x1="10" y1="14" x2="50" y2="14" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="22" x2="80" y2="22" stroke="#475569" stroke-width="1.6"/><line x1="10" y1="30" x2="62" y2="30" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round"/>',
  button: '<rect x="18" y="12" width="52" height="20" rx="6" fill="#18181b"/><line x1="30" y1="22" x2="58" y2="22" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>',
  input: '<rect x="10" y="13" width="68" height="18" rx="4" fill="#fff" stroke="#475569" stroke-width="1.3"/><line x1="17" y1="17" x2="17" y2="27" stroke="#3e63dd" stroke-width="1.5"/><line x1="21" y1="22" x2="48" y2="22" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round"/>',
  section: '<rect x="8" y="6" width="72" height="32" rx="4" fill="#f8fafc" stroke="#64748b" stroke-width="1.2" stroke-dasharray="3 2"/><line x1="14" y1="13" x2="38" y2="13" stroke="#475569" stroke-width="2" stroke-linecap="round"/><rect x="14" y="19" width="60" height="13" rx="2.5" fill="#e2e8f0"/>',
  row: '<rect x="8" y="10" width="21" height="24" rx="3" fill="#fff" stroke="#475569" stroke-width="1.2"/><rect x="33.5" y="10" width="21" height="24" rx="3" fill="#fff" stroke="#475569" stroke-width="1.2"/><rect x="59" y="10" width="21" height="24" rx="3" fill="#fff" stroke="#475569" stroke-width="1.2"/>',
  card: '<rect x="12" y="6" width="64" height="32" rx="5" fill="#fff" stroke="#475569" stroke-width="1.3"/><line x1="19" y1="14" x2="46" y2="14" stroke="#18181b" stroke-width="2.2" stroke-linecap="round"/><line x1="19" y1="22" x2="66" y2="22" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round"/><line x1="19" y1="29" x2="54" y2="29" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round"/>',
  list: '<circle cx="16" cy="12" r="2.2" fill="#475569"/><line x1="23" y1="12" x2="72" y2="12" stroke="#64748b" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="22" r="2.2" fill="#475569"/><line x1="23" y1="22" x2="66" y2="22" stroke="#64748b" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="32" r="2.2" fill="#475569"/><line x1="23" y1="32" x2="58" y2="32" stroke="#64748b" stroke-width="2" stroke-linecap="round"/>',
  item: '<rect x="10" y="13" width="68" height="18" rx="4" fill="#fff" stroke="#64748b" stroke-width="1.2"/><circle cx="20" cy="22" r="4" fill="#cbd5e1"/><line x1="29" y1="22" x2="66" y2="22" stroke="#475569" stroke-width="2" stroke-linecap="round"/>',
  link: '<line x1="22" y1="22" x2="66" y2="22" stroke="#3e63dd" stroke-width="2.2" stroke-linecap="round"/><line x1="22" y1="26" x2="66" y2="26" stroke="#3e63dd" stroke-width="1.2"/>',
  textarea: '<rect x="10" y="7" width="68" height="30" rx="4" fill="#fff" stroke="#475569" stroke-width="1.3"/><line x1="16" y1="14" x2="56" y2="14" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"/><line x1="16" y1="21" x2="68" y2="21" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round"/><line x1="16" y1="28" x2="44" y2="28" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round"/>',
  upload: '<rect x="10" y="7" width="68" height="30" rx="5" fill="#f8fafc" stroke="#64748b" stroke-width="1.3" stroke-dasharray="4 2.5"/><path d="M44 27V16m0 0l-4 4m4-4l4 4" fill="none" stroke="#334155" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  radio: '<circle cx="22" cy="15" r="5" fill="#fff" stroke="#18181b" stroke-width="1.5"/><circle cx="22" cy="15" r="2.5" fill="#18181b"/><line x1="32" y1="15" x2="66" y2="15" stroke="#475569" stroke-width="2" stroke-linecap="round"/><circle cx="22" cy="29" r="5" fill="#fff" stroke="#94a3b8" stroke-width="1.4"/><line x1="32" y1="29" x2="58" y2="29" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"/>',
  heading: '<line x1="12" y1="18" x2="64" y2="18" stroke="#18181b" stroke-width="3.6" stroke-linecap="round"/><line x1="12" y1="28" x2="44" y2="28" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round"/>',
  text: '<line x1="12" y1="13" x2="74" y2="13" stroke="#64748b" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="22" x2="70" y2="22" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="31" x2="48" y2="31" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round"/>',
  table: '<rect x="10" y="6" width="68" height="32" rx="3" fill="#fff" stroke="#475569" stroke-width="1.2"/><rect x="10" y="6" width="68" height="9" rx="2" fill="#e2e8f0"/><line x1="10" y1="15" x2="78" y2="15" stroke="#94a3b8"/><line x1="10" y1="26" x2="78" y2="26" stroke="#e2e8f0"/><line x1="33" y1="6" x2="33" y2="38" stroke="#cbd5e1"/><line x1="56" y1="6" x2="56" y2="38" stroke="#cbd5e1"/>',
  image: '<rect x="12" y="6" width="64" height="32" rx="4" fill="#f1f5f9" stroke="#64748b" stroke-width="1.2"/><circle cx="26" cy="16" r="3.5" fill="#94a3b8"/><path d="M14 35l16-14 12 10 10-8 22 12z" fill="#cbd5e1"/>',
  chart: '<line x1="14" y1="35" x2="74" y2="35" stroke="#64748b" stroke-width="1.4"/><rect x="20" y="21" width="9" height="14" rx="1.5" fill="#94a3b8"/><rect x="34" y="13" width="9" height="22" rx="1.5" fill="#3e63dd"/><rect x="48" y="18" width="9" height="17" rx="1.5" fill="#94a3b8"/><rect x="62" y="9" width="9" height="26" rx="1.5" fill="#18181b"/>',
  stat: '<line x1="16" y1="12" x2="42" y2="12" stroke="#94a3b8" stroke-width="1.8" stroke-linecap="round"/><rect x="16" y="18" width="32" height="13" rx="3" fill="#18181b"/><rect x="52" y="23" width="18" height="8" rx="4" fill="#dcfce7"/>',
  badge: '<rect x="24" y="14" width="40" height="16" rx="8" fill="#eef2ff" stroke="#3e63dd" stroke-width="1.2"/><line x1="33" y1="22" x2="55" y2="22" stroke="#3e63dd" stroke-width="2" stroke-linecap="round"/>',
  tag: '<rect x="20" y="14" width="48" height="16" rx="4" fill="#f4f4f5" stroke="#64748b" stroke-width="1.2"/><circle cx="28" cy="22" r="2.2" fill="#64748b"/><line x1="34" y1="22" x2="60" y2="22" stroke="#475569" stroke-width="2" stroke-linecap="round"/>',
  icon: '<rect x="28" y="6" width="32" height="32" rx="8" fill="#f4f4f5" stroke="#64748b" stroke-width="1.2"/><path d="M44 13l2.6 5.4 6 .8-4.3 4.2 1 6-5.3-2.8-5.3 2.8 1-6-4.3-4.2 6-.8z" fill="#334155"/>',
  divider: '<line x1="10" y1="22" x2="78" y2="22" stroke="#475569" stroke-width="1.8" stroke-dasharray="4 3"/>',
  placeholder: '<rect x="10" y="7" width="68" height="30" rx="4" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.2" stroke-dasharray="3 2"/><line x1="12" y1="9" x2="76" y2="35" stroke="#cbd5e1" stroke-width="1.1"/><line x1="76" y1="9" x2="12" y2="35" stroke="#cbd5e1" stroke-width="1.1"/>'
};
function palThumb(t) {
  const wrap = h('div', { class: 'pal-thumb', 'aria-hidden': 'true' });
  const body = PAL_SVG[t] || PAL_SVG[bt(t)] || PAL_SVG.card;
  wrap.innerHTML = '<svg viewBox="0 0 88 44" width="88" height="44">' + body + '</svg>';
  return wrap;
}
function paletteSidebar() {
  const q = String(ui.palQuery || '').trim().toLowerCase();
  const groups = [];
  PALETTE.forEach((g) => {
    const items = g[1].filter((t) => !q || tname(t).toLowerCase().includes(q) || t.toLowerCase().includes(q));
    if (!items.length) return;
    groups.push(h('div', { class: 'pal-sec' },
      h('div', { class: 'pal-sec-t' }, g[0], h('span', { class: 'hint' }, String(items.length))),
      h('div', { class: 'pal-grid' }, items.map((t) => h('div', {
        class: 'pal-item',
        'data-pal-type': t,
        title: '拖到画布上放置；或先选中目标位置再点击添加（' + t + '）',
        onpointerdown: (e) => { if (e.button === 0) startPointerDrag(e, { kind: 'new', type: t, label: '＋ ' + tname(t), srcEl: e.currentTarget }); },
        onclick: (e) => { e.stopPropagation(); if (ui.panMoved) return; quickAdd(t); }
      }, palThumb(t), h('span', { class: 'pal-lbl' }, tname(t)))))));
  });
  return h('aside', { class: 'cv-list pal-side', id: 'cv-list' },
    h('div', { class: 'pal-head' },
      h('div', { class: 'pal-head-t' }, h('b', null, '组件库'), h('span', { class: 'hint' }, '拖到画布放置')),
      h('input', {
        class: 'pal-search',
        type: 'search',
        'data-f': 'pal-search',
        placeholder: '搜索组件（如 弹窗 / switch / 表格）…',
        value: ui.palQuery || '',
        oninput: (e) => { ui.palQuery = e.target.value; render(); }
      })),
    groups.length ? groups : h('div', { class: 'hint', style: 'padding:20px 8px;text-align:center' }, '没有匹配的组件'),
    h('div', { class: 'pal-foot' }, h('button', { style: 'width:100%', onclick: () => mutate(opAddPage) }, '+ 新增页面')));
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
    pd.ghost = pd.kind === 'new'
      ? h('div', { class: 'drag-ghost drag-ghost-card' }, palThumb(pd.type), h('span', null, pd.label))
      : h('div', { class: 'drag-ghost' }, pd.label);
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

// ------------------------------------------------------------------ play (prototype) mode
/* Figma-style "Present": one screen at a time, clicking hotspots runs their interactions
 * (open overlay / navigate / toggle / switch state / close / back). Clicking elsewhere flashes the hotspots. */
function startPlay(pid) {
  const p = pageById(pid) || pageById(ui.page) || CUR.pages.find((x) => x.change !== 'removed') || CUR.pages[0];
  if (!p) { toast('没有可以演示的页面', true); return; }
  ui.play = { start: p.id, page: p.id, side: p.change === 'removed' ? 'before' : 'after', marks: false, ovs: [], stack: [], vis: {}, st: {}, anchor: {}, log: [], k: 1, top: true };
  ui.sel = null; render();
}
function stopPlay() { ui.play = null; ui.cam = null; render(); }
function ovHolding(id) { const P = ui.play; for (let i = P.ovs.length - 1; i >= 0; i--) { const f = findNodeAnywhere(P.ovs[i]); const t = findNodeAnywhere(id); if (f && t && contains(f.e.n, t.e.n)) return P.ovs[i]; } return null; }
function isOverlayId(id) { return CUR.pages.some((p) => p.overlays.some((x) => x.id === id)); }
function applyIA(i, p, n) {
  const P = ui.play;
  const openOv = (id) => { if (P.ovs.indexOf(id) < 0) { P.ovs.push(id); P.anchor[id] = n.id; } };
  switch (i.action) {
    case 'open': if (i.target && isOverlayId(i.target)) openOv(i.target); else if (i.target) P.vis[i.target] = true; break;
    case 'close': { const host = i.target || ovHolding(n.id) || P.ovs[P.ovs.length - 1]; P.ovs = P.ovs.filter((x) => x !== host); break; }
    case 'navigate': if (pageById(i.target) && i.target !== P.page) { P.stack.push({ page: P.page, ovs: P.ovs.slice() }); P.page = i.target; P.ovs = []; P.top = true; } break;
    case 'toggle': if (isOverlayId(i.target)) { if (P.ovs.indexOf(i.target) >= 0) P.ovs = P.ovs.filter((x) => x !== i.target); else openOv(i.target); } else { const f = findNodeAnywhere(i.target); if (f) P.vis[i.target] = !playVisible(f.e.n); } break;
    case 'show': if (isOverlayId(i.target)) openOv(i.target); else P.vis[i.target] = true; break;
    case 'hide': if (isOverlayId(i.target)) P.ovs = P.ovs.filter((x) => x !== i.target); else P.vis[i.target] = false; break;
    case 'state': { const f = findNodeAnywhere(i.target || n.id); if (!f) break; const t = f.e.n; if (i.state !== undefined && i.state !== null) P.st[t.id] = i.state; else { const list = t.state ? stateNames(t) : [null].concat(stateNames(t)); P.st[t.id] = list[(list.indexOf(curState(t, 'play')) + 1) % list.length]; } break; }
    case 'back': playBack(true); break;
  }
}
function runIA(pid, id) {
  const P = ui.play; if (!P) return false;
  const p = pageById(pid); const f = p && findNode(p, id); if (!f) return false;
  const list = interactionsOf(p, f.n, P.side); if (!list.length) return false;
  const who = nlabel(withState(f.n, f.n, 'play'));
  list.forEach((i) => applyIA(i, p, f.n));
  P.log.push(who + ' → ' + list.map((i) => (IA_VERB[i.action] || i.action) + ' ' + iaTargetName(i.action === 'state' && !i.target ? Object.assign({}, i, { target: f.n.id }) : i)).join('，'));
  render(); return true;
}
function playBack(noRender) {
  const P = ui.play;
  if (P.ovs.length) P.ovs.pop();
  else if (P.stack.length) { const x = P.stack.pop(); P.page = x.page; P.ovs = x.ovs; P.top = true; }
  if (!noRender) render();
}
function playGo(pid) { const P = ui.play; if (pid === P.page) return; P.stack.push({ page: P.page, ovs: P.ovs.slice() }); P.page = pid; P.ovs = []; P.top = true; render(); }
function playContext() {
  const P = ui.play; const p = pageById(P.page);
  const parts = ['页面「' + pageName(p) + '」'];
  if (P.ovs.length) parts.push('已打开 ' + P.ovs.map((id) => iaTargetName({ action: 'open', target: id })).join('、'));
  Object.keys(P.vis).forEach((id) => { const f = findNodeAnywhere(id); if (f && P.vis[id] !== !f.e.n.hidden) parts.push((P.vis[id] ? '展开了 ' : '收起了 ') + nlabel(f.e.n)); });
  Object.keys(P.st).forEach((id) => { const f = findNodeAnywhere(id); if (f && P.st[id] !== (f.e.n.state || null)) parts.push(nlabel(f.e.n) + ' 为「' + (P.st[id] || '默认') + '」'); });
  if (P.side === 'before') parts.push('改动前');
  return parts.join('，');
}
function flashHints() {
  const fr = document.getElementById('pl-frame'); if (!fr) return;
  fr.classList.remove('pl-hint'); void fr.offsetWidth; fr.classList.add('pl-hint');
  clearTimeout(ui.hintTimer); ui.hintTimer = setTimeout(() => fr.classList.remove('pl-hint'), 900);
}
function onPlayClick(e) {
  const bk = e.target.closest('[data-close]');
  if (bk && e.target === bk) { ui.play.ovs = ui.play.ovs.filter((x) => x !== bk.dataset.close); render(); return; }
  const ia = e.target.closest('#pl-frame [data-ia]');
  if (ia && runIA(ia.dataset.pg, ia.dataset.id)) return;
  if (e.target.closest('#pl-frame')) flashHints();
}
function playOverlay(id, side) {
  const f = findNodeAnywhere(id); if (!f) return null;
  const n = f.e.n; if (!visible(n, side)) return null;
  const v = view(n, side);
  const base = bt(v.type);
  const box = h('div', { class: 'pl-ov pl-ov-' + base, style: { width: (OV_W[base] || OV_W[v.type] || 420) + 'px' } }, renderWF(n, f.p, { side: side, ctx: 'play', parentLayout: 'col' }));
  return h('div', { class: 'pl-back pl-back-' + base + (base === 'modal' || base === 'drawer' ? ' dim' : ''), 'data-close': id }, box);
}
function renderPlay() {
  const P = ui.play; const p = pageById(P.page) || CUR.pages[0];
  const side = P.side;
  const gone = (side === 'after' && p.change === 'removed') || (side === 'before' && p.change === 'added');
  const body = gone ? h('div', { class: 'pl-void' }, side === 'after' ? '这个页面在改动后被删除了' : (sideLabel('before') + '没有这个页面')) : renderWF(p.root, p, { side: side, ctx: 'play', parentLayout: 'col' });
  const frame = h('div', { class: 'pl-frame' + (P.marks ? ' marks' : ''), id: 'pl-frame', style: { width: (Number(p.width) || 1280) + 'px' } },
    h('div', { class: 'pl-fh' }, h('span', { class: 'dot dot-' + pageStatus(p) }), pageName(p), p.route ? h('span', { class: 'route' }, p.route) : null),
    h('div', { class: 'pl-fb' }, body),
    P.ovs.map((id) => playOverlay(id, side)).filter(Boolean));
  const bar = h('div', { class: 'pl-bar' },
    btn('← 返回', () => playBack(), null, '关闭最上层弹层，或回到上一屏'), btn('⟲ 从头开始', () => startPlay(P.start)),
    h('b', null, pageName(p)), P.ovs.length ? h('span', { class: 'hint' }, '已打开 ' + P.ovs.length + ' 个弹层（点暗处关闭）') : null,
    h('span', { style: 'margin-left:auto' }), h('span', { class: 'hint' }, '能点的地方鼠标会变成手形；点空白处会闪出所有可点区域'));
  return h('div', { class: 'body pl' }, playSide(p), h('div', { class: 'pl-main' }, bar, h('div', { class: 'pl-stage', id: 'pl-stage', onclick: onPlayClick }, h('div', { class: 'pl-wrap', id: 'pl-wrap' }, frame))));
}
function playSide(p) {
  const P = ui.play; const side = P.side;
  const items = [];
  const scan = (n, pg) => { const walk = (x) => { if (!visible(x, side)) return; const ia = interactionsOf(pg, x, side); if (ia.length) items.push([pg, x, ia]); (x.children || []).forEach(walk); }; walk(n); };
  scan(p.root, p);
  P.ovs.forEach((id) => { const f = findNodeAnywhere(id); if (f) scan(f.e.n, f.p); });
  const conds = entries(p).filter((e) => e.n.hidden && visible(e.n, side) && !showersOf(e.n.id).length);
  const ta = h('textarea', { 'data-f': 'pl-c', placeholder: '对现在看到的画面写意见。会自动记下你当时在哪一屏、打开了什么。' });
  const sev = h('select', { 'data-f': 'pl-sev' }, SEVS.map((x) => h('option', { value: x }, x))); sev.value = '建议';
  const addC = () => { const t = ta.value.trim(); if (!t) { ta.focus(); return; } addComment({ kind: 'page', id: p.id }, '交互方式', sev.value, '［演示中：' + playContext() + '］' + t); toast('已记下，会出现在「反馈」里'); };
  return h('aside', { class: 'pl-side', id: 'pl-side' },
    h('div', { class: 'sec-t' }, '屏幕'),
    CUR.pages.map((q) => h('button', { class: 'cv-item' + (q.id === p.id ? ' on' : ''), onclick: () => playGo(q.id) }, h('span', { class: 'dot dot-' + pageStatus(q) }), ' ', pageName(q))),
    UNITS.length ? [h('div', { class: 'sec-t' }, '看哪个版本'),
      h('div', { class: 'seg' }, h('button', { class: side === 'before' ? 'on' : null, onclick: () => { P.side = 'before'; P.ovs = []; render(); } }, sideLabel('before')), h('button', { class: side === 'after' ? 'on' : null, onclick: () => { P.side = 'after'; P.ovs = []; render(); } }, sideLabel('after'))),
      h('label', { class: 'trig-opt' }, h('input', { type: 'checkbox', checked: P.marks, style: 'width:auto', onchange: (e) => { P.marks = e.target.checked; render(); } }), ' 显示改动框')] : null,
    h('div', { class: 'sec-t' }, '现在能点的（' + items.length + '）'),
    items.length ? h('ul', { class: 'dt-list pl-ia' }, items.map((x) => h('li', null, h('button', { class: 'lnk', onclick: () => runIA(x[0].id, x[1].id) }, nlabel(withState(x[1], x[1], 'play'))), h('div', { class: 'hint' }, x[2].map((i) => (IA_VERB[i.action] || i.action) + ' ' + iaTargetName(i)).join('；'))))) : h('div', { class: 'hint' }, '这一屏没有写交互'),
    conds.length ? [h('div', { class: 'sec-t' }, '按条件出现的区块（手动打开看看）'), conds.map((e) => h('label', { class: 'trig-opt' }, h('input', { type: 'checkbox', checked: playVisible(e.n), style: 'width:auto', onchange: (ev) => { P.vis[e.n.id] = ev.target.checked; render(); } }), ' ' + nlabel(e.n)))] : null,
    P.log.length ? [h('div', { class: 'sec-t' }, '刚才点了'), h('ol', { class: 'dt-list' }, P.log.slice(-6).map((x) => h('li', null, x)))] : null,
    h('div', { class: 'cbox' }, h('div', { class: 'sec-t' }, '对这个画面写批注'), sev, ta, h('div', { class: 'acts' }, h('button', { class: 'primary', onclick: addC }, '添加批注'))));
}
function fitPlay() {
  const st = document.getElementById('pl-stage'), wrap = document.getElementById('pl-wrap'), fr = document.getElementById('pl-frame'); if (!st || !fr || !ui.play) return;
  const W = fr.offsetWidth, k = Math.min(1, Math.max(0.3, (st.clientWidth - 48) / W));
  fr.style.transform = 'scale(' + k + ')'; wrap.style.width = W * k + 'px'; wrap.style.height = fr.offsetHeight * k + 'px'; ui.play.k = k;
  fr.querySelectorAll('.pl-back-menu, .pl-back-popover').forEach((bk) => {
    const box = bk.firstElementChild; const aid = ui.play.anchor[bk.dataset.close];
    const a = aid && (fr.querySelector('.pl-fb [data-id="' + CSS.escape(aid) + '"]') || fr.querySelector('.pl-ov [data-id="' + CSS.escape(aid) + '"]'));
    if (!a) { box.style.left = '40px'; box.style.top = '60px'; return; }
    const f0 = fr.getBoundingClientRect(), r = a.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min((r.left - f0.left) / k, W - box.offsetWidth - 8)) + 'px'; box.style.top = ((r.bottom - f0.top) / k + 4) + 'px';
  });
}

// ------------------------------------------------------------------ flows
function renderFlows() {
  const flows = CUR.flows;
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
  const title = h('div', { class: 'side-t' }, sideLabel(side));
  if (side === 'before' && f.change === 'added') return h('div', { class: 'side side-before' }, title, h('div', { class: 'frame void' }, '新流程 —— ' + sideLabel('before') + '不存在'));
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
  if (!CUR.backend.length) out.append(h('div', { class: 'empty' }, '本次变更没有描述后端变化。'));
  else out.append(h('div', { class: 'compare' }, beSide('before'), beSide('after')));
  if (ui.mode === 'edit') out.append(h('div', { style: 'margin-top:12px' }, h('button', { onclick: () => mutate(opModAdd) }, '+ 新增模块')));
  return out;
}
function beSide(side) {
  const mods = CUR.backend.filter((m) => visible(m, side));
  return h('div', { class: 'side side-' + side }, h('div', { class: 'side-t' }, sideLabel(side)),
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
  const cTarget = commentTargetOf(s, null);
  return h('aside', { class: 'inspector', id: 'inspector' },
    h('div', { class: 'ins-top' }, h('span', null, ui.mode === 'edit' ? '修改 / 批注' : '批注'), h('button', { class: 'lnk', onclick: () => { ui.sel = null; render(); } }, '关闭 ✕')),
    h('div', { class: 'ins-scroll', id: 'ins-scroll' }, body),
    cTarget ? h('div', { class: 'ins-foot' }, commentBox(cTarget)) : null);
}
function commentBox(target) {
  const list = S.comments.filter((c) => sameTarget(c.target, target));
  const cat = h('select', { 'data-f': 'c-cat' }, CATS.map((c) => h('option', { value: c }, c)));
  const sev = h('select', { 'data-f': 'c-sev' }, SEVS.map((c) => h('option', { value: c }, c)));
  sev.value = '建议';
  const ta = h('textarea', { 'data-f': 'c-text', placeholder: '写下你的意见。例如：这个编辑卡片不要常驻在列表下面，放进二级菜单，点「编辑」按钮再弹出。' });
  const add = () => { const t = ta.value.trim(); if (!t) { ta.focus(); return; } addComment(target, cat.value, sev.value, t); };
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add(); });
  return h('div', { class: 'cbox' }, h('div', { class: 'sec-t' }, '批注' + (list.length ? '（' + list.length + '）' : '')),
    list.length ? h('div', { class: 'cbox-list' }, list.map(commentItem)) : null,
    h('div', { class: 'row2' }, cat, sev), ta, h('div', { class: 'acts' }, h('button', { class: 'primary', onclick: add }, '添加批注'), h('span', { class: 'hint' }, 'Ctrl+Enter')));
}
function commentItem(c) {
  return h('div', { class: 'cmt' }, h('div', { class: 'cmt-meta' }, h('span', { class: 'sev s' + SEVS.indexOf(c.severity) }, c.severity), h('span', { class: 'chip sm' }, c.category),
    h('span', { style: 'margin-left:auto' }), h('button', { class: 'lnk', onclick: (e) => { e.stopPropagation(); mutate(() => { S.comments = S.comments.filter((x) => x.id !== c.id); return null; }); } }, '删除')),
    h('div', { class: 'ctext' }, c.text));
}
function buiBlock(type) {
  const bi = buiInfo(type); if (!bi) return null;
  const imps = [{ name: bi.name, pkg: bi.pkg }].concat(bi.extraImports || []);
  return h('div', { class: 'dt-block bui' },
    h('div', { class: 'sec-t' }, 'Base UI · ' + bi.name),
    imps.map((im) => h('code', { class: 'bui-import' }, "import { " + im.name + " } from '" + BUI.package + "/" + im.pkg + "'")),
    h('div', { class: 'hint' }, bi.summary),
    h('div', { class: 'bui-parts', title: '组合这些 parts' }, bi.parts.join(' · ')));
}
function inspNode(s, compact) {
  const p = pageById(s.page); const e = p && findNode(p, s.id); if (!e) return null;
  const n = e.n, v = view(n, s.side);
  const vis = afterVisibleIds(p);
  const editable = ui.mode === 'edit' && s.side === 'after' && vis.has(n.id);
  const out = [];
  if (!compact) out.push(h('div', { class: 'ins-head' }, h('span', { class: 'ins-type' }, tname(v.type)), h('b', null, v.label || ''), chgChip(chgOf(n, s.side) ? n.change : null)));
  if (!compact) out.push(h('div', { class: 'ins-path' }, h('span', null, (s.side === 'before' ? sideLabel('before') + ' › ' : sideLabel('after') + ' › ') + pathText(p, n, s.side)), h('code', null, '#' + n.id)));
  if (!compact && n.note) out.push(h('div', { class: 'ins-note' }, h('b', null, 'Agent 说明：'), n.note));
  const bb = !compact && buiBlock(v.type); if (bb) out.push(bb);
  if (!compact && n.before && n.change === 'modified') out.push(diffBox(n));
  if (!compact && (n.movedFrom || n.movedTo)) out.push(h('div', { class: 'ins-note' }, n.movedFrom ? '这是从原位置移过来的。' : '这个元素被移到了新位置。', h('button', { class: 'lnk', onclick: () => focusNode(p.id, n.movedFrom || n.movedTo) }, '定位另一处')));
  if (editable) out.push(nodeEditor(p, n, e));
  else {
    if (v.fn) out.push(fld('函数 / 行为', h('code', null, v.fn)));
    if (v.text) out.push(fld('说明', h('div', null, v.text)));
    if (ui.mode === 'edit' && s.side === 'before' && n.change === 'removed') out.push(h('div', { class: 'acts' }, btn(n.movedTo ? '撤销移动（放回原处）' : '恢复这个元素', () => mutate(() => opRestore(p.id, n.id)))));
  }
  const ias = interactionsOf(p, n, s.side);
  if (ias.length) out.push(h('div', { class: 'dt-block' }, h('div', { class: 'sec-t' }, '交互'),
    h('ul', { class: 'dt-list' }, ias.map((i) => { const f = i.target && i.action !== 'navigate' ? findNodeAnywhere(i.target) : null; return h('li', null, iaText(i), ' ', f ? btn('定位', () => focusNode(f.p.id, f.e.n.id), 'lnk') : null); })),
    h('div', { class: 'acts' }, btn('▶ 在演示里点一下', () => { startPlay(p.id); runIA(p.id, n.id); }))));
  if (n.hidden) { const sh = showersOf(n.id); out.push(h('div', { class: 'ins-note' }, '默认不显示。', sh.length ? ['由 ', sh.map((x, i) => [i ? '、' : '', h('button', { class: 'lnk', onclick: () => { const f = findNodeAnywhere(x.id); if (f) focusNode(f.p.id, x.id); } }, nlabel(x))]), ' 点击后出现。'] : '按条件出现（演示模式左侧可以手动打开）。')); }
  if (stateNames(n).length) out.push(h('div', { class: 'ins-note' }, '有 ' + (stateNames(n).length + (n.state ? 0 : 1)) + ' 个状态：' + (n.state ? '' : '默认、') + stateNames(n).map((x) => '「' + x + '」').join('、') + '。在演示模式里点触发它的元素即可切换。'));
  return out;
}
function nodeEditor(p, n, e) {
  const pid = p.id, id = n.id;
  const ctx = { target: { kind: 'node', page: pid, id: id }, name: (o) => ref(o), prefix: () => pfx(ePageById(pid)) };
  const res = () => { const pg = ePageById(pid); const x = pg && findNode(pg, id); return x && x.n; };
  const ed = (f) => editor(res, f, ctx);
  const cont = isCont(n);
  const f = [];
  f.push(fld('组件类型', sel('type', n.type, TYPE_ORDER.map((k) => [k, tname(k) + '  ' + k]), ed('type'))));
  if (bt(n.type) !== 'divider') f.push(fld(cont ? '标题（可空）' : '文字', inp('label', n.label, ed('label'))));
  f.push(fld(USES_TEXT.has(bt(n.type)) ? '占位提示 / 示例值' : '补充说明（灰色小字）', inp('text', n.text, ed('text'), { multi: !USES_TEXT.has(bt(n.type)) })));
  f.push(fld('函数 / 行为占位', inp('fn', n.fn, ed('fn'), { ph: '例如 onClick → openEditor()　或　GET /api/tags' })));
  if (INLINE.has(bt(n.type))) f.push(fld('样式变体', sel('variant', n.variant, VARIANTS, ed('variant'))));
  if (e.list && e.list !== p.overlays) f.push(fld('宽度', sel('w', n.w, WIDTHS, ed('w'))));
  if (cont) f.push(fld('子元素排列', sel('layout', n.layout, LAYOUTS, ed('layout'))));
  if (cont && n.layout === 'grid') f.push(fld('网格列数', inp('cols', n.cols, ed('cols'))));
  if (ITEMS_TYPES.has(bt(n.type))) f.push(fld('选项 / 条目（每行一个）', inp('items', visItems(n, 'after', 'items').map(itemText).join('\n'), ed('items'), { multi: true })));
  if (bt(n.type) === 'progress' || bt(n.type) === 'slider') f.push(fld('当前值（0–100）', inp('value', n.value, ed('value'))));
  if (bt(n.type) === 'table') f.push(fld('表格列（每行一个）', inp('columns', visItems(n, 'after', 'columns').map(itemText).join('\n'), ed('columns'), { multi: true })));
  if (OVERLAY.has(bt(n.type))) {
    const vis = afterVisibleIds(p);
    const cands = entries(p).filter((x) => vis.has(x.n.id) && TRIGGER_TYPES.has(bt(x.n.type)) && !contains(n, x.n)).map((x) => [x.n.id, nlabel(x.n) + ' #' + x.n.id]);
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
  if (e.list && e.list !== p.overlays && !OVERLAY.has(bt(n.type))) {
    conv.append(h('span', { class: 'hint', style: 'width:100%' }, '改成点击按钮才出现：'),
      btn('转为弹窗', () => mutate(() => opConvert(pid, id, 'dialog'))), btn('转为下拉菜单', () => mutate(() => opConvert(pid, id, 'menu')), null, '二级菜单：点按钮展开'),
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
  const out = [];
  if (!compact) {
    out.push(h('div', { class: 'ins-head' }, h('span', { class: 'ins-type' }, '页面'), h('b', null, pageName(p)), chgChip(pageStatus(p))));
    if (p.note) out.push(h('div', { class: 'ins-note' }, h('b', null, 'Agent 说明：'), p.note));
    if (p.before && p.change === 'modified') out.push(diffBox(p));
  }
  if (ui.mode === 'edit') {
    const ctx = { target: { kind: 'page', id: p.id }, name: (o) => '页面「' + o.name + '」', prefix: () => '' };
    const res = () => ePageById(s.id);
    if (p.change !== 'removed') out.push(h('div', { class: 'fields' }, fld('页面名称', inp('p-name', p.name, editor(res, 'name', ctx))), fld('路由 / 地址', inp('p-route', p.route, editor(res, 'route', ctx))), h('div', { class: 'acts' }, btn('删除这个页面', () => mutate(() => opDeletePage(p.id)), 'danger'))));
    else out.push(h('div', { class: 'acts' }, btn('恢复这个页面', () => mutate(() => opRestorePage(p.id)))));
  }
  return out;
}
function inspFlow(s) {
  const f = flowById(s.id); if (!f) return null;
  const out = [h('div', { class: 'ins-head' }, h('span', { class: 'ins-type' }, '流程'), h('b', null, f.name), chgChip(flowStatus(f)))];
  if (f.note) out.push(h('div', { class: 'ins-note' }, h('b', null, 'Agent 说明：'), f.note));
  if (ui.mode === 'edit' && f.change !== 'removed') {
    const ctx = { target: { kind: 'flow', id: f.id }, name: (o) => '流程「' + o.name + '」', prefix: () => '' };
    out.push(h('div', { class: 'fields' }, fld('流程名称', inp('f-name', f.name, editor(() => eFlowById(s.id), 'name', ctx))), h('div', { class: 'acts' }, btn('+ 添加步骤', () => mutate(() => opStepAdd(f.id, null))), btn('删除流程', () => mutate(() => opFlowDelete(f.id)), 'danger'))));
  }
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
    const res = () => { const ff = eFlowById(s.flow); return ff && ff.steps.find((x) => x.id === s.id); };
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
    const res = () => { const r = eFindBe(s.id); return r && (r.item || r.m); };
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
  return out;
}

// ------------------------------------------------------------------ feedback
function targetExists(t) {
  if (!t) return false;
  if (t.kind === 'node') { const p = pageById(t.page); return !!(p && (findNode(p, t.ghost ? (t.id + '__from') : t.id) || findNode(p, t.id))); }
  if (t.kind === 'page') return !!pageById(t.id);
  if (t.kind === 'flow') return !!flowById(t.id);
  if (t.kind === 'step') { const f = flowById(t.flow); return !!(f && f.steps.some((x) => x.id === t.id)); }
  if (t.kind === 'be') return !!findBe(t.id);
  return false;
}
function jump(t) {
  if (HAS_MULTI_VER && !targetExists(t)) {
    if (Array.isArray(t.ver) && t.ver.length === 2 && verByNum(t.ver[0]) && verByNum(t.ver[1])) {
      ui.leftVer = Number(t.ver[0]); ui.rightVer = Number(t.ver[1]);
      if (isHistoryView() && ui.mode === 'edit') ui.mode = 'view';
      ui.cam = null; syncViewSpec();
    }
    if (!targetExists(t)) {
      ui.leftVer = 0; ui.rightVer = LATEST_VER;
      ui.cam = null; syncViewSpec();
    }
    computeUnits();
  }
  const resolvedId = t.kind === 'node' && t.ghost && pageById(t.page) && findNode(pageById(t.page), t.id + '__from') ? (t.id + '__from') : t.id;
  if (t.kind === 'node' || t.kind === 'page') { ui.tab = 'canvas'; ui.page = t.page || t.id; ui.unit = t.kind === 'node' ? unitOf(t.page, resolvedId) : (UNIT_BY.has(t.id) ? t.id : null); }
  else if (t.kind === 'flow' || t.kind === 'step') ui.tab = 'flows';
  else if (t.kind === 'be') ui.tab = 'backend';
  ui.sel = Object.assign({}, t, { id: resolvedId });
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
      h('label', { class: 'hint', style: 'display:flex;gap:6px;align-items:center;margin-bottom:8px' }, h('input', { type: 'checkbox', checked: ui.includeSpec, style: 'width:auto', onchange: (e) => { ui.includeSpec = e.target.checked; render(); } }), '另外附带完整方案 JSON（备用：补丁应用失败时，Agent 可加 --use-full 改用完整方案）'),
      h('textarea', { class: 'md', id: 'smyw-out', 'data-f': 'smyw-out', readonly: true, value: md, onfocus: (e) => e.target.select() })));
}
function answersList() {
  return S.spec.questions.map((q, i) => { const qq = typeof q === 'string' ? { q: q } : q; const key = qq.id || String(i); return { id: key, question: qq.q || qq.question || '', answer: S.answers[key] || '' }; }).filter((a) => a.answer);
}
function stripSpec(sp) {
  const strip = (o) => {
    if (Array.isArray(o)) { o.forEach(strip); return; }
    if (!o || typeof o !== 'object') return;
    Object.keys(o).forEach((k) => { if (k.charAt(0) === '_' || (k === 'change' && o[k] === 'unchanged')) delete o[k]; else strip(o[k]); });
  };
  strip(sp);
  return sp;
}
function cleanSpec() {
  const sp = stripSpec(clone(S.spec));
  sp.basedOnVersion = BASE.version;
  sp.basedOnHash = BASE_HASH;
  return sp;
}
/* ---- node-level patch (smyw-patch@2): what the user changed, relative to the spec the agent wrote.
 * Every id-bearing object (page, node, flow, step, backend module / item) is addressed by id.
 * ops: add {parent,key,node} · move {id,parent,key} · del {id} · set {id,set,unset} · order {parent,key,ids} · top {set,unset}
 * Applied in order: add -> move -> del -> set -> order -> top.
 * New containers in add strip existing nodes (which arrive via explicit move ops), so add never collides with existing ids. */
const PATCH_SKIP_TOP = new Set(['pages', 'flows', 'backend', 'version', 'basedOnVersion', 'basedOnHash']);
function flatSpec(sp) {
  const nodes = new Map(), lists = new Map();
  const put = (o, kind, parent, key) => {
    if (!o || typeof o !== 'object' || o.id == null) return;
    const id = String(o.id), fields = {};
    const own = kind === 'page' ? ['root', 'overlays'] : kind === 'node' ? ['children'] : kind === 'flow' ? ['steps'] : kind === 'mod' ? ['items'] : [];
    Object.keys(o).forEach((k) => { if (own.indexOf(k) < 0) fields[k] = o[k]; });
    nodes.set(id, { kind: kind, parent: parent, key: key, fields: fields, obj: o });
    const kids = (k, list, ck) => { if (!Array.isArray(list)) return; lists.set(id + '\0' + k, { parent: id, key: k, ids: list.map((x) => String(x.id)) }); list.forEach((x) => put(x, ck, id, k)); };
    if (kind === 'page') { if (o.root) put(o.root, 'node', id, 'root'); kids('overlays', o.overlays, 'node'); }
    else if (kind === 'node') kids('children', o.children, 'node');
    else if (kind === 'flow') kids('steps', o.steps, 'step');
    else if (kind === 'mod') kids('items', o.items, 'item');
  };
  [['pages', 'page'], ['flows', 'flow'], ['backend', 'mod']].forEach((x) => { const list = sp[x[0]] || []; lists.set('#spec\0' + x[0], { parent: '#spec', key: x[0], ids: list.map((o) => String(o.id)) }); list.forEach((o) => put(o, x[1], '#spec', x[0])); });
  const top = {}; Object.keys(sp).forEach((k) => { if (!PATCH_SKIP_TOP.has(k)) top[k] = sp[k]; });
  return { nodes: nodes, lists: lists, top: top };
}
function fieldDiff(a, b) {
  const set = {}, unset = [];
  Object.keys(b).forEach((k) => { if (!same(a[k], b[k])) set[k] = b[k]; });
  Object.keys(a).forEach((k) => { if (!(k in b)) unset.push(k); });
  return Object.keys(set).length || unset.length ? { set: set, unset: unset } : null;
}
function stripExistingFromAdded(node, kind, existingNodes) {
  const c = clone(node);
  const walk = (x, k) => {
    if (!x || typeof x !== 'object') return;
    if (k === 'page') {
      if (x.root) {
        if (existingNodes.has(String(x.root.id))) delete x.root;
        else walk(x.root, 'node');
      }
      if (Array.isArray(x.overlays)) x.overlays = x.overlays.filter((ch) => !existingNodes.has(String(ch.id))).map((ch) => { walk(ch, 'node'); return ch; });
    } else if (k === 'node' && Array.isArray(x.children)) {
      x.children = x.children.filter((ch) => !existingNodes.has(String(ch.id))).map((ch) => { walk(ch, 'node'); return ch; });
    } else if (k === 'flow' && Array.isArray(x.steps)) {
      x.steps = x.steps.filter((ch) => !existingNodes.has(String(ch.id)));
    } else if (k === 'mod' && Array.isArray(x.items)) {
      x.items = x.items.filter((ch) => !existingNodes.has(String(ch.id)));
    }
  };
  walk(c, kind);
  return c;
}
function specPatch() {
  const A = flatSpec(stripSpec(normalize(clone(BASE)))), B = flatSpec(stripSpec(clone(S.spec)));
  const ops = [];
  const isNew = (id) => id !== '#spec' && !A.nodes.has(id);
  A.nodes.forEach((a, id) => { if (!B.nodes.has(id) && (a.parent === '#spec' || B.nodes.has(a.parent))) ops.push({ op: 'del', id: id }); });
  B.nodes.forEach((b, id) => {
    const a = A.nodes.get(id);
    if (!a) {
      if (isNew(b.parent)) return;
      ops.push({ op: 'add', parent: b.parent, key: b.key, node: stripExistingFromAdded(b.obj, b.kind, A.nodes) });
      return;
    }
    if (a.parent !== b.parent || a.key !== b.key) ops.push({ op: 'move', id: id, parent: b.parent, key: b.key });
    const d = fieldDiff(a.fields, b.fields);
    if (d) { const op = { op: 'set', id: id, set: d.set }; if (d.unset.length) op.unset = d.unset; ops.push(op); }
  });
  B.lists.forEach((entry, k) => {
    if (isNew(entry.parent)) {
      if (entry.ids.some((id) => A.nodes.has(id))) ops.push({ op: 'order', parent: entry.parent, key: entry.key, ids: entry.ids });
      return;
    }
    const prev = A.lists.get(k);
    if (!same(prev ? prev.ids : null, entry.ids)) ops.push({ op: 'order', parent: entry.parent, key: entry.key, ids: entry.ids });
  });
  const t = fieldDiff(A.top, B.top);
  if (t) { const op = { op: 'top', set: t.set }; if (t.unset.length) op.unset = t.unset; ops.push(op); }
  return { format: 'smyw-patch@2', base: BASE.version, baseHash: BASE_HASH, ops: ops };
}
function exportJSON() {
  return { format: 'smyw-feedback@1', title: S.spec.title, baseVersion: BASE.version, stage: S.spec.stage, exportedAt: new Date().toISOString(), approved: !!S.approved, global: S.global, answers: answersList(), comments: S.comments, ops: S.ops, patch: specPatch(), revisedSpec: cleanSpec() };
}
function buildMarkdown(withSpec) {
  const sp = S.spec, L = [], g = S.global;
  const patch = specPatch();
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
    patch.ops.length ? '- 把这份反馈原样保存为 .smyw/<dir>/feedback-v' + BASE.version + '.md，运行 node <skill>/scripts/apply-feedback.mjs <这份 md> <spec.json>：它把末尾的 smyw-patch（用户对 v' + BASE.version + ' 的结构修改，已重新标注 added/removed/modified、movedFrom/movedTo）应用到 spec.json，version + 1。不要凭上面的操作描述手工重放。' : '- 用户没有改方案结构：直接在现有 spec 上落实批注，version + 1。',
    '- 「必须改」全部落实；「建议」尽量采纳，不采纳要说明理由；「疑问」先回答再动手。',
    '- 线框只表达结构和交互，不代表视觉样式；样式/风格类意见在实现时按项目现有设计规范落实。', '');
  if (patch.ops.length) L.push('<details><summary>smyw-patch（相对 v' + BASE.version + ' 的结构修改，' + patch.ops.length + ' 条）</summary>', '', FENCE + 'json', JSON.stringify(patch), FENCE, '', '</details>', '');
  if (withSpec) L.push('<details><summary>revisedSpec（备用：修改后的完整方案 JSON）</summary>', '', FENCE + 'json', JSON.stringify(cleanSpec()), FENCE, '', '</details>', '');
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

// ------------------------------------------------------------------ live agent bridge & chat drawer
function liveDotClass() {
  if (live.sseState === 'closed') return 'off';
  if (live.busy) return 'busy';
  if (live.agentConnected) return 'on';
  return 'wait';
}
function liveStatusLabel() {
  if (live.sseState === 'closed') return '连接已断开';
  if (live.sseState === 'connecting') return '正在连接服务…';
  if (live.busy) return live.busyStatus || 'Agent 处理中…';
  if (live.approved) return '已确认方案';
  if (live.agentConnected) return live.driver === 'claude' ? 'Claude 会话就绪' : 'Agent 已连接';
  return '等待 Agent 接入（可先发消息入队）';
}
function liveSelContext() {
  if (!live.attachSel || !ui.sel) return null;
  const t = Object.assign({}, ui.sel);
  const rid = realNodeId(t.id);
  let label = '#' + rid;
  if (t.kind === 'node') {
    const p = pageById(t.page);
    const e = p && (findNode(p, t.id) || findNode(p, rid));
    if (e) label = nlabel(e.n) + ' #' + rid;
  } else if (t.kind === 'page') {
    const p = pageById(t.id);
    label = '页面「' + (p ? pageName(p) : t.id) + '」';
  } else if (t.kind === 'flow') {
    const f = flowById(t.id);
    label = '流程「' + (f ? f.name : t.id) + '」';
  } else if (t.kind === 'step') {
    const f = flowById(t.flow);
    const st = f && f.steps.find((x) => x.id === t.id);
    label = '步骤' + (st ? stepLabel(st) : (' #' + t.id));
  } else if (t.kind === 'be') {
    const f = findBe(t.id);
    label = f ? ('后端「' + (f.item ? f.item.name : f.m.name) + '」') : ('后端 #' + t.id);
  }
  return {
    kind: t.kind,
    id: rid,
    page: t.page || null,
    flow: t.flow || null,
    side: t.side || null,
    label: label,
    where: whereOf(t)
  };
}
function formatLiveText(text) {
  const parts = String(text || '').split(/(`[^`\n]+`)/g);
  return parts.map((p) => (p.length >= 2 && p[0] === '`' && p[p.length - 1] === '`') ? h('code', null, p.slice(1, -1)) : p);
}
function toggleLivePane(force) {
  if (!live.enabled) return;
  live.open = force != null ? !!force : !live.open;
  if (live.open) live.unread = 0;
  refreshLivePane(true);
  if (live.open) requestAnimationFrame(() => { scrollLiveBottom(); const ta = document.querySelector('[data-f="live-input"]'); if (ta) ta.focus(); });
}
function scrollLiveBottom() {
  const box = document.getElementById('live-msgs');
  if (box) box.scrollTop = box.scrollHeight;
}
function updateLiveToggleBtn() {
  const b = document.getElementById('live-toggle-btn');
  if (!b) return;
  b.classList.toggle('on', !!live.open);
  const dot = b.querySelector('.live-dot');
  if (dot) dot.className = 'live-dot ' + liveDotClass();
  const cnt = b.querySelector('.cnt');
  if (live.unread && !live.open) {
    if (cnt) cnt.textContent = String(live.unread);
    else b.append(h('span', { class: 'cnt' }, String(live.unread)));
  } else if (cnt) {
    cnt.remove();
  }
}
function refreshLivePane(autoScroll) {
  updateLiveToggleBtn();
  const cur = document.getElementById('live-dock');
  if (!cur) return;
  const ae = document.activeElement;
  const wasFocused = ae && ae.dataset && ae.dataset.f === 'live-input';
  const selStart = wasFocused ? ae.selectionStart : null;
  const selEnd = wasFocused ? ae.selectionEnd : null;
  const prevBox = document.getElementById('live-msgs');
  const prevTop = prevBox ? prevBox.scrollTop : 0;
  const next = renderLiveDock();
  cur.replaceWith(next);
  const newBox = document.getElementById('live-msgs');
  if (newBox) newBox.scrollTop = autoScroll ? newBox.scrollHeight : prevTop;
  if (wasFocused) {
    const ta = document.querySelector('[data-f="live-input"]');
    if (ta) {
      ta.focus();
      if (selStart != null && selEnd != null) { try { ta.setSelectionRange(selStart, selEnd); } catch (e) {} }
    }
  }
}
function refreshLiveStream() {
  const el = document.getElementById('live-stream-body');
  if (!el) { refreshLivePane(true); return; }
  el.replaceChildren(...formatLiveText(live.stream ? live.stream.text : ''));
  scrollLiveBottom();
}
function renderLiveFabIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '22');
  svg.setAttribute('height', '22');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z');
  svg.appendChild(p);
  return svg;
}
function renderLiveDock() {
  if (!live.open) {
    return h('div', { class: 'live-dock is-min', id: 'live-dock' },
      h('button', {
        class: 'live-fab' + (live.busy ? ' is-busy' : ''),
        id: 'live-fab',
        title: '展开实时 Agent 对话窗 · ' + liveStatusLabel(),
        onclick: () => toggleLivePane(true)
      },
        renderLiveFabIcon(),
        h('span', { class: 'live-fab-dot live-dot ' + liveDotClass() }),
        live.unread ? h('span', { class: 'live-fab-cnt' }, String(live.unread)) : null));
  }
  return h('div', { class: 'live-dock is-open', id: 'live-dock' }, renderLivePane());
}
function renderLivePane() {
  const selCtx = liveSelContext();
  const hasEdits = S.ops.length > 0 || S.comments.length > 0 || S.global.tags.length > 0 || !!S.global.text.trim() || Object.keys(S.answers || {}).length > 0;
  const msgsEl = h('div', { class: 'live-msgs', id: 'live-msgs' });
  if (!live.messages.length && !live.busy) {
    msgsEl.append(h('div', { class: 'live-empty' },
      h('div', { class: 'live-empty-t' }, '直接在这里和 Agent 讨论并修改原型'),
      h('div', { class: 'live-empty-s' }, '点选画布任意模块可自动带上节点上下文；你在图上拖动、改结构或写的批注，发送时也会一并同步给 Agent，改完后画布自动热更新。')));
  } else {
    live.messages.forEach((m) => {
      const cls = 'live-msg ' + (m.role === 'user' ? 'is-user' : m.role === 'system' ? 'is-sys' : 'is-ai') + (m.error ? ' is-err' : '');
      const meta = [];
      if (m.role === 'user') {
        if (m.context && m.context.label) meta.push(h('span', { class: 'live-tag' }, '@' + m.context.label));
        if (m.opsCount > 0) meta.push(h('span', { class: 'live-tag' }, '+' + m.opsCount + ' 处画布修改'));
        if (m.commentsCount > 0) meta.push(h('span', { class: 'live-tag' }, '+' + m.commentsCount + ' 条批注'));
      }
      const verJump = (m.versionFrom != null && m.versionTo != null && m.versionTo !== m.versionFrom && verByNum(m.versionFrom) && verByNum(m.versionTo))
        ? h('button', {
            class: 'live-ver-jump',
            onclick: () => { setVersions(m.versionFrom, m.versionTo); if (ui.tab !== 'canvas') setTab('canvas'); setDiffMode(true); }
          }, '查看本轮改动 v' + m.versionFrom + ' → v' + m.versionTo)
        : null;
      msgsEl.append(h('div', { class: cls, 'data-msg-id': m.id },
        meta.length ? h('div', { class: 'live-msg-meta' }, meta) : null,
        h('div', { class: 'live-msg-body' }, formatLiveText(m.text)),
        verJump ? h('div', { class: 'live-msg-acts' }, verJump) : null));
    });
  }
  if (live.busy) {
    msgsEl.append(h('div', { class: 'live-msg is-ai is-streaming' },
      h('div', { class: 'live-thinking' }, h('span', { class: 'live-spin' }), live.busyStatus || 'Agent 处理中…'),
      live.stream && live.stream.text ? h('div', { class: 'live-msg-body', id: 'live-stream-body' }, formatLiveText(live.stream.text)) : null));
  }

  const ctxItems = [];
  if (ui.sel) {
    if (selCtx) {
      ctxItems.push(h('span', { class: 'live-ctx-pill on' },
        '@' + selCtx.label,
        h('button', { class: 'live-ctx-x', title: '本次不附带选中元素', onclick: () => { live.attachSel = false; refreshLivePane(false); } }, '×')));
    } else {
      ctxItems.push(h('button', { class: 'live-ctx-pill', onclick: () => { live.attachSel = true; refreshLivePane(false); } }, '+ 附带当前选中元素'));
    }
  }
  if (hasEdits) {
    const bits = [];
    if (S.ops.length) bits.push(S.ops.length + ' 处画布修改');
    if (S.comments.length) bits.push(S.comments.length + ' 条批注');
    if (!bits.length) bits.push('整体意见/回答');
    ctxItems.push(h('span', { class: 'live-ctx-pill sync', title: '发送时会自动把当前画布上的修改补丁和批注同步给 Agent' }, '自动同步：' + bits.join(' · ')));
  }

  const sendDisabled = live.busy || live.sseState === 'closed' || (!live.draft.trim() && !hasEdits);
  const ta = h('textarea', {
    class: 'live-input',
    'data-f': 'live-input',
    rows: 2,
    disabled: live.busy || live.sseState === 'closed',
    placeholder: live.busy ? 'Agent 正在更新方案，请稍候…' : (selCtx ? ('针对 ' + selCtx.label + ' 提修改意见…（Enter 发送，Shift+Enter 换行）') : '描述你想改的地方或直接提问…（Enter 发送，Shift+Enter 换行）'),
    value: live.draft,
    oninput: (e) => {
      live.draft = e.target.value;
      const sb = document.getElementById('live-send-btn');
      if (sb) sb.disabled = live.busy || live.sseState === 'closed' || (!live.draft.trim() && !hasEdits);
    },
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendLiveChat();
      }
    }
  });

  const driverBadge = live.driver === 'claude' ? 'Claude Fork' : '实时桥接';
  return h('aside', { class: 'live-pane', id: 'live-pane' },
    h('div', { class: 'live-head' },
      h('div', { class: 'live-head-l' },
        h('span', { class: 'live-dot ' + liveDotClass() }),
        h('strong', null, '实时 Agent'),
        h('span', { class: 'chip sm' }, driverBadge)),
      h('div', { class: 'live-head-r' },
        h('button', {
          class: 'ok' + (live.approved ? ' on' : ''),
          disabled: live.busy || live.sseState === 'closed',
          onclick: approveLive,
          title: '通知 Agent 确认当前方案，可以开始写代码'
        }, live.approved ? '✓ 已确认' : (live.confirmApprove ? '再点一次确认' : '✓ 确认方案')),
        h('button', { class: 'live-close', onclick: () => toggleLivePane(false), title: '缩小为右下角悬浮图标' }, '—'))),
    h('div', { class: 'live-status-bar' }, liveStatusLabel()),
    msgsEl,
    h('div', { class: 'live-foot' },
      ctxItems.length ? h('div', { class: 'live-ctx-row' }, ctxItems) : null,
      h('div', { class: 'live-compose' },
        ta,
        h('button', { class: 'primary live-send', id: 'live-send-btn', disabled: sendDisabled, onclick: sendLiveChat }, live.busy ? '处理中' : '发送'))));
}

async function liveFetch(path, body) {
  const res = await fetch(path, {
    method: body !== undefined ? 'POST' : 'GET',
    headers: Object.assign({ 'X-SMYW-Token': live.token }, body !== undefined ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

async function sendLiveChat() {
  if (!live.enabled || live.busy || live.sseState === 'closed') return;
  const text = live.draft.trim();
  const patch = specPatch();
  const hasEdits = S.ops.length > 0 || S.comments.length > 0 || S.global.tags.length > 0 || !!S.global.text.trim() || Object.keys(S.answers || {}).length > 0 || patch.ops.length > 0;
  if (!text && !hasEdits) return;
  const ctx = liveSelContext();
  const payload = {
    text: text,
    context: ctx,
    hasEdits: hasEdits,
    opsCount: S.ops.length,
    commentsCount: S.comments.length,
    baseVersion: BASE.version,
    baseHash: BASE_HASH,
    patch: patch.ops.length ? patch : null,
    feedbackMarkdown: hasEdits ? buildMarkdown(false) : ''
  };
  live.draft = '';
  live.busy = true;
  live.busyStatus = '正在发送…';
  refreshLivePane(true);
  try {
    await liveFetch('/api/chat', payload);
  } catch (err) {
    live.busy = false;
    live.busyStatus = '';
    live.draft = text;
    toast('发送失败：' + err.message, true);
    refreshLivePane(false);
  }
}

async function approveLive() {
  if (!live.enabled || live.busy || live.sseState === 'closed') return;
  if (!live.approved && !live.confirmApprove) {
    live.confirmApprove = true;
    refreshLivePane(false);
    setTimeout(() => { if (live.confirmApprove) { live.confirmApprove = false; refreshLivePane(false); } }, 4000);
    return;
  }
  live.confirmApprove = false;
  const patch = specPatch();
  const hasEdits = S.ops.length > 0 || S.comments.length > 0 || S.global.tags.length > 0 || !!S.global.text.trim() || Object.keys(S.answers || {}).length > 0 || patch.ops.length > 0;
  try {
    S.approved = true;
    save();
    await liveFetch('/api/approve', {
      note: live.draft.trim(),
      hasEdits: hasEdits,
      opsCount: S.ops.length,
      commentsCount: S.comments.length,
      baseVersion: BASE.version,
      baseHash: BASE_HASH,
      feedbackMarkdown: hasEdits ? buildMarkdown(false) : ''
    });
    live.approved = true;
    toast('已通知 Agent 确认方案');
    refreshLivePane(true);
  } catch (err) {
    toast('确认失败：' + err.message, true);
  }
}

function connectLive() {
  if (!live.enabled || typeof EventSource === 'undefined') return;
  if (live.es) { try { live.es.close(); } catch (e) {} }
  const es = new EventSource('/api/events?token=' + encodeURIComponent(live.token));
  live.es = es;
  es.onopen = () => {
    live.sseState = 'open';
    refreshLivePane(false);
  };
  es.onerror = () => {
    if (live.sseState !== 'closed') {
      live.sseState = es.readyState === 2 ? 'closed' : 'connecting';
      refreshLivePane(false);
    }
  };
  es.addEventListener('init', (ev) => {
    try {
      const d = JSON.parse(ev.data);
      live.sseState = 'open';
      if (d.state) {
        live.agentConnected = !!d.state.agentConnected;
        live.busy = !!d.state.busy;
        live.busyStatus = d.state.busyStatus || '';
        live.approved = !!d.state.approved;
      }
      if (Array.isArray(d.messages)) live.messages = d.messages;
      live.stream = d.stream || null;
      refreshLivePane(true);
    } catch (e) {}
  });
  es.addEventListener('agent-state', (ev) => {
    try {
      const st = JSON.parse(ev.data);
      live.agentConnected = !!st.agentConnected;
      live.busy = !!st.busy;
      live.busyStatus = st.busyStatus || '';
      live.approved = !!st.approved;
      if (!live.busy) live.stream = null;
      refreshLivePane(false);
    } catch (e) {}
  });
  es.addEventListener('chunk', (ev) => {
    try {
      const d = JSON.parse(ev.data);
      if (!live.stream || live.stream.id !== d.id) live.stream = { id: d.id, text: '' };
      live.stream.text += d.delta || '';
      refreshLiveStream();
    } catch (e) {}
  });
  es.addEventListener('message', (ev) => {
    try {
      const d = JSON.parse(ev.data);
      const m = d && d.message;
      if (!m) return;
      const idx = live.messages.findIndex((x) => x.id === m.id);
      if (idx >= 0) live.messages[idx] = m;
      else live.messages.push(m);
      if (m.role !== 'user') {
        live.stream = null;
        if (!live.open) live.unread++;
      }
      refreshLivePane(true);
    } catch (e) {}
  });
  es.addEventListener('spec-updated', (ev) => {
    try {
      const d = JSON.parse(ev.data);
      if (d && d.spec) reloadSpec(d.spec, d.versions);
    } catch (e) {}
  });
  es.addEventListener('shutdown', () => {
    live.sseState = 'closed';
    live.busy = false;
    live.agentConnected = false;
    try { es.close(); } catch (e) {}
    refreshLivePane(false);
    toast('实时预览服务已关闭');
  });
}

// ------------------------------------------------------------------ boot
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement ? document.activeElement.tagName : '';
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !typing) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
  else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y') && !typing) { e.preventDefault(); redo(); }
  else if (!typing && (e.key === 'Delete' || e.key === 'Backspace') && ui.mode === 'edit' && ui.sel && ui.sel.kind === 'node' && ui.sel.side === 'after') { e.preventDefault(); const s = ui.sel; mutate(() => opDelete(s.page, s.id)); }
  else if (e.key === 'Escape' && ui.play) { if (ui.play.ovs.length) { ui.play.ovs.pop(); render(); } }
  else if (e.key === 'Escape') { ui.sel = null; ui.unit = null; render(); }
  else if (e.key === ' ' && !typing && ui.tab === 'canvas' && !ui.space && !ui.play) { ui.space = true; const v = vpEl(); if (v) v.classList.add('space'); e.preventDefault(); }
});
validateSel();
render();
if (live.enabled) connectLive();

/* Programmatic handle (used by tests; also handy from the devtools console). */
document.addEventListener('keyup', (e) => { if (e.key === ' ') { ui.space = false; const v = vpEl(); if (v) v.classList.remove('space'); } });
window.addEventListener('resize', () => { if (ui.tab === 'canvas' && ui.cam) applyCam(); });

window.smyw = {
  get state() { return S; }, get viewSpec() { return CUR; }, get versions() { return VERSIONS.map((v) => ({ version: v.version, note: v.note, stage: v.stage })); },
  ui: ui, render: render, undo: undo, redo: redo, setMode: setMode, setTab: setTab, setVersions: setVersions, setDiffView: setDiffView, setDiffMode: setDiffMode, setShowPins: setShowPins, setWipePos: setWipePos,
  setPage: (id) => { ui.page = id; ui.sel = null; render(); },
  play: { start: startPlay, stop: stopPlay, click: (pid, id) => runIA(pid, id), back: () => playBack(), get state() { return ui.play; } },
  get units() { syncViewSpec(); computeUnits(); return UNITS.map((u) => Object.assign({}, u)); },
  focusUnit: focusUnit, focusNode: focusNode, fit: () => fitCam(false), zoomAt: zoomAt,
  op: {
    move: (pid, id, dest) => mutate(() => opMove(pid, id, dest)),
    add: (pid, type, dest) => mutate(() => opAdd(pid, type, dest || {})),
    remove: (pid, id) => mutate(() => opDelete(pid, id)),
    restore: (pid, id) => mutate(() => opRestore(pid, id)),
    restorePage: (pid) => mutate(() => opRestorePage(pid)),
    convert: (pid, id, kind) => mutate(() => opConvert(pid, id, kind || 'dialog')),
    sibling: (pid, id, dir) => mutate(() => opSibling(pid, id, dir)),
    edit: (pid, id, field, val) => editor(() => { const p = ePageById(pid); const e = p && findNode(p, id); return e && e.n; }, field, { target: { kind: 'node', page: pid, id: id }, name: ref, prefix: () => pfx(ePageById(pid)) })(val),
    stepMove: (fid, id, dir) => mutate(() => opStepMove(fid, id, dir)),
    comment: (target, category, severity, text) => addComment(target, category, severity, text)
  },
  select: (sel) => { ui.sel = sel; render(); },
  reloadSpec: reloadSpec,
  live: { get state() { return live; }, toggle: toggleLivePane, send: sendLiveChat, approve: approveLive },
  exportJSON: exportJSON, buildMarkdown: buildMarkdown, specPatch: specPatch, copyFeedback: copyFeedback, storageOk: STORAGE_OK
};
})();
