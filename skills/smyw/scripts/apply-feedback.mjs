#!/usr/bin/env node
// smyw apply-feedback: apply the smyw-patch block from the feedback Markdown the user pasted back to spec.json
// (falls back to a full revisedSpec block if present), back up the old spec as spec-v<N>.json and write v<N+1>.
// Usage: node apply-feedback.mjs <feedback.md> <spec.json> [--dry-run]
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const [mdPath, specPath] = args.filter((a) => a !== '--dry-run');
if (!mdPath || !specPath) { console.log('用法: node apply-feedback.mjs <feedback.md> <spec.json> [--dry-run]'); process.exit(2); }
const fail = (msg) => { console.error('✖ ' + msg); process.exit(1); };
const md = readFileSync(resolve(mdPath), 'utf8');
const FENCE = '\x60\x60\x60';

// every \`\`\`json block in the Markdown
const blocks = [];
for (let i = md.indexOf(FENCE + 'json'); i >= 0; i = md.indexOf(FENCE + 'json', i + 1)) {
  const start = md.indexOf('\n', i) + 1, end = md.indexOf('\n' + FENCE, start);
  if (end < 0) fail('JSON 代码块没有结束标记，粘贴的内容可能被截断了。请用户重新复制完整反馈。');
  try { blocks.push(JSON.parse(md.slice(start, end))); } catch (e) { fail('反馈里的 JSON 不完整（可能粘贴时被截断）：' + e.message); }
}
const patch = blocks.find((b) => b && b.format === 'smyw-patch@1');
const full = blocks.find((b) => b && !b.format && ['pages', 'flows', 'backend'].some((k) => Array.isArray(b[k])));
const userEdited = /##\s*用户直接对方案做的修改/.test(md);

const specFile = resolve(specPath);
const spec = JSON.parse(readFileSync(specFile, 'utf8'));
const curVer = Number(spec.version) || 1;
let next;

if (patch) {
  if (Number(patch.base) !== curVer) fail('这份反馈是在 v' + patch.base + ' 上改的，而当前 spec 是 v' + curVer + '。请用户刷新到最新预览后重新复制反馈（或让用户勾选「附带完整方案 JSON」）。');
  next = applyPatch(spec, patch);
  console.log('· 应用 smyw-patch：' + patch.ops.length + ' 条结构修改');
} else if (full) {
  if (full.basedOnVersion != null && Number(full.basedOnVersion) !== curVer) console.log('⚠ 完整方案基于 v' + full.basedOnVersion + '，当前 spec 是 v' + curVer + '，请核对。');
  next = full; delete next.basedOnVersion;
  console.log('· 反馈里没有补丁，使用附带的完整方案');
} else {
  if (userEdited) fail('用户改过方案结构，但反馈里没有 smyw-patch。请用户在「反馈」页重新点「复制反馈」，完整粘贴。');
  console.log('· 用户没有改方案结构：直接在现有 spec 上落实批注即可（记得 version + 1）。');
  process.exit(0);
}
next.version = curVer + 1;
if (dry) { console.log(JSON.stringify(next, null, 2)); process.exit(0); }
const backup = join(dirname(specFile), 'spec-v' + curVer + '.json');
copyFileSync(specFile, backup);
writeFileSync(specFile, JSON.stringify(next, null, 2) + '\n');
console.log('✔ 旧 spec 备份为 ' + backup);
console.log('✔ 已写入 v' + next.version + '：' + specFile);
console.log('  接下来：落实批注 → node build.mjs ' + specPath);

function applyPatch(spec, patch) {
  const KIDS = { page: ['overlays'], node: ['children'], flow: ['steps'], mod: ['items'] };
  const CHILD_KIND = { pages: 'page', flows: 'flow', backend: 'mod', root: 'node', overlays: 'node', children: 'node', steps: 'step', items: 'item' };
  let idx;
  const reindex = () => {
    idx = new Map([['#spec', { obj: spec, kind: 'spec' }]]);
    const put = (o, kind, holder, key) => {
      if (!o || typeof o !== 'object' || o.id == null) return;
      if (idx.has(String(o.id))) fail('spec 里有重复的 id "' + o.id + '"，先修好再应用反馈');
      idx.set(String(o.id), { obj: o, kind, holder, key });
      if (kind === 'page' && o.root) put(o.root, 'node', o, 'root');
      (KIDS[kind] || []).forEach((k) => (Array.isArray(o[k]) ? o[k] : []).forEach((c) => put(c, CHILD_KIND[k], o, k)));
    };
    ['pages', 'flows', 'backend'].forEach((k) => (spec[k] || []).forEach((o) => put(o, CHILD_KIND[k], spec, k)));
  };
  const get = (id, what) => { const e = idx.get(String(id)); if (!e) fail(what + '：spec 里找不到 id "' + id + '"（spec 和预览对不上，或节点没写 id）。请让用户勾选「附带完整方案 JSON」后重新复制。'); return e; };
  const detach = (e) => { if (e.key === 'root') { delete e.holder.root; return; } const list = e.holder[e.key]; const i = list ? list.indexOf(e.obj) : -1; if (i >= 0) list.splice(i, 1); };
  const attach = (parentId, key, obj) => {
    const p = get(parentId, '放入位置').obj;
    if (key === 'root') { p.root = obj; return; }
    if (!Array.isArray(p[key])) p[key] = [];
    p[key].push(obj);
  };
  const order = (k) => ['del', 'move', 'add', 'set', 'order', 'top'].indexOf(k.op);
  const ops = patch.ops.slice().sort((a, b) => order(a) - order(b));
  for (const op of ops) {
    reindex();
    if (op.op === 'del') { const e = idx.get(String(op.id)); if (e) detach(e); }
    else if (op.op === 'move') { const e = get(op.id, '移动'); detach(e); attach(op.parent, op.key, e.obj); }
    else if (op.op === 'add') {
      const ids = []; (function walk(o) { if (o && typeof o === 'object') { if (o.id != null) ids.push(String(o.id)); ['root', 'overlays', 'children', 'steps'].forEach((k) => { const v = o[k]; if (Array.isArray(v)) v.forEach(walk); else if (k === 'root' && v) walk(v); }); if (Array.isArray(o.items)) o.items.forEach(walk); } })(op.node);
      ids.forEach((id) => { const e = idx.get(id); if (e) detach(e); }); // same id elsewhere = it was moved here
      attach(op.parent, op.key, op.node);
    }
    else if (op.op === 'set') { const o = get(op.id, '修改').obj; Object.assign(o, op.set || {}); (op.unset || []).forEach((k) => delete o[k]); }
    else if (op.op === 'order') {
      const p = get(op.parent, '排序').obj; const list = Array.isArray(p[op.key]) ? p[op.key] : [];
      const by = new Map(list.map((o) => [String(o.id), o]));
      p[op.key] = op.ids.map((id) => by.get(String(id))).filter(Boolean).concat(list.filter((o) => !op.ids.includes(String(o.id))));
    }
    else if (op.op === 'top') { Object.assign(spec, op.set || {}); (op.unset || []).forEach((k) => delete spec[k]); }
    else fail('不认识的补丁操作 "' + op.op + '"');
  }
  return spec;
}
