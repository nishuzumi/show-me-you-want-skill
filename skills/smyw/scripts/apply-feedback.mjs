#!/usr/bin/env node
// smyw apply-feedback: apply the smyw-patch block from the feedback Markdown the user pasted back to spec.json
// (supports smyw-patch@2 and legacy smyw-patch@1; --use-full applies an attached revisedSpec),
// back up the old spec as spec-v<N>.json and write v<N+1>.
// Usage: node apply-feedback.mjs <feedback.md> <spec.json> [--dry-run] [--use-full] [--force]
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { specHash } from './lib.mjs';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const useFull = args.includes('--use-full');
const force = args.includes('--force');
const [mdPath, specPath] = args.filter((a) => !['--dry-run', '--use-full', '--force'].includes(a));
if (!mdPath || !specPath) {
  console.log('用法: node apply-feedback.mjs <feedback.md> <spec.json> [--dry-run] [--use-full] [--force]');
  process.exit(2);
}
const fail = (msg) => { console.error('✖ ' + msg); process.exit(1); };
const log = (msg) => { if (dry) console.error(msg); else console.log(msg); };
const md = readFileSync(resolve(mdPath), 'utf8');
const FENCE = '\x60\x60\x60';

// every ```json block in the Markdown
const blocks = [];
for (let i = md.indexOf(FENCE + 'json'); i >= 0; i = md.indexOf(FENCE + 'json', i + 1)) {
  const start = md.indexOf('\n', i) + 1, end = md.indexOf('\n' + FENCE, start);
  if (end < 0) fail('JSON 代码块没有结束标记，粘贴的内容可能被截断了。请用户重新复制完整反馈。');
  try { blocks.push(JSON.parse(md.slice(start, end))); } catch (e) { fail('反馈里的 JSON 不完整（可能粘贴时被截断）：' + e.message); }
}
const patch = blocks.find((b) => b && (b.format === 'smyw-patch@2' || b.format === 'smyw-patch@1'));
const full = blocks.find((b) => b && !b.format && ['pages', 'flows', 'backend'].some((k) => Array.isArray(b[k])));
const userEdited = /##\s*用户直接对方案做的修改/.test(md);

const specFile = resolve(specPath);
const specRaw = readFileSync(specFile, 'utf8');
const spec = JSON.parse(specRaw);
const curVer = Number(spec.version) || 1;
const curHash = specHash(spec);
let next;

if (useFull) {
  if (!full) fail('指定了 --use-full，但反馈里没有附带 revisedSpec 完整方案 JSON。');
  if (!force) {
    if (full.basedOnVersion != null && Number(full.basedOnVersion) !== curVer) {
      fail('完整方案基于 v' + full.basedOnVersion + '，而当前 spec 是 v' + curVer + '。如确认要覆盖请加 --force。');
    }
    if (full.basedOnHash && full.basedOnHash !== curHash) {
      fail('完整方案基于同版本 v' + curVer + ' 的旧内容（哈希 ' + full.basedOnHash + ' ≠ 当前 ' + curHash + '），磁盘 spec 已改动。如确认要覆盖请加 --force。');
    }
  }
  next = full;
  delete next.basedOnVersion;
  delete next.basedOnHash;
  log('· 使用附带的完整方案（--use-full）');
} else if (patch) {
  if (!force && Number(patch.base) !== curVer) {
    fail('这份反馈是在 v' + patch.base + ' 上改的，而当前 spec 是 v' + curVer + '。请用户刷新到最新预览后重新复制反馈（或用 --use-full --force 应用附带的完整方案）。');
  }
  if (!force && patch.baseHash && patch.baseHash !== curHash) {
    fail('这份反馈基于 v' + curVer + ' 的旧内容（哈希 ' + patch.baseHash + ' ≠ 当前 ' + curHash + '）：spec.json 在生成预览后已被修改。请重新 build 让用户刷新，或核对后加 --force。');
  }
  next = applyPatch(spec, patch, full);
  log('· 应用 ' + patch.format + '：' + patch.ops.length + ' 条结构修改');
} else if (full) {
  if (!force) {
    if (full.basedOnVersion != null && Number(full.basedOnVersion) !== curVer) {
      fail('完整方案基于 v' + full.basedOnVersion + '，而当前 spec 是 v' + curVer + '。请核对或加 --force。');
    }
    if (full.basedOnHash && full.basedOnHash !== curHash) {
      fail('完整方案基于同版本 v' + curVer + ' 的旧内容（哈希 ' + full.basedOnHash + ' ≠ 当前 ' + curHash + '）。请核对或加 --force。');
    }
  }
  next = full;
  delete next.basedOnVersion;
  delete next.basedOnHash;
  log('· 反馈里没有补丁，使用附带的完整方案');
} else {
  if (userEdited) fail('用户改过方案结构，但反馈里没有 smyw-patch。请用户在「反馈」页重新点「复制反馈」，完整粘贴。');
  log('· 用户没有改方案结构：直接在现有 spec 上落实批注即可（记得 version + 1）。');
  process.exit(0);
}

next.version = curVer + 1;
delete next.versionNote;
delete next.basedOnVersion;
delete next.basedOnHash;
if (dry) { console.log(JSON.stringify(next, null, 2)); process.exit(0); }

const backup = join(dirname(specFile), 'spec-v' + curVer + '.json');
if (existsSync(backup)) {
  try {
    if (specHash(JSON.parse(readFileSync(backup, 'utf8'))) !== curHash) {
      log('⚠ 覆盖已有备份 ' + backup + '（内容与当前 spec.json 不同）');
    }
  } catch { /* unreadable prior backup will be replaced */ }
}
copyFileSync(specFile, backup);
writeFileSync(specFile, JSON.stringify(next, null, 2) + '\n');
console.log('✔ 旧 spec 备份为 ' + backup);
console.log('✔ 已写入 v' + next.version + '：' + specFile + '（已清空旧版 versionNote，请填写本轮说明）');
console.log('  接下来：落实批注 → node build.mjs ' + specPath);

function applyPatch(spec, patch, fullHint) {
  const isV2 = patch.format === 'smyw-patch@2';
  const KIDS = { spec: ['pages', 'flows', 'backend'], page: ['overlays'], node: ['children'], flow: ['steps'], mod: ['items'] };
  const CHILD_KIND = { pages: 'page', flows: 'flow', backend: 'mod', root: 'node', overlays: 'node', children: 'node', steps: 'step', items: 'item' };
  const FORBID_TOP = new Set(['pages', 'flows', 'backend', 'version', 'basedOnVersion', 'basedOnHash']);
  const hintFull = fullHint ? '（反馈里已附带完整方案，可加 --use-full 改用完整方案）' : '（可请用户勾选「附带完整方案 JSON」后重发并加 --use-full）';
  let idx;
  const reindex = () => {
    idx = new Map([['#spec', { obj: spec, kind: 'spec' }]]);
    const put = (o, kind, holder, key) => {
      if (!o || typeof o !== 'object' || o.id == null) return;
      const sid = String(o.id);
      if (idx.has(sid)) fail('spec 里有重复的 id "' + sid + '"，先修好再应用反馈');
      idx.set(sid, { obj: o, kind, holder, key });
      if (kind === 'page' && o.root) put(o.root, 'node', o, 'root');
      (KIDS[kind] || []).forEach((k) => (Array.isArray(o[k]) ? o[k] : []).forEach((c) => put(c, CHILD_KIND[k], o, k)));
    };
    ['pages', 'flows', 'backend'].forEach((k) => (spec[k] || []).forEach((o) => put(o, CHILD_KIND[k], spec, k)));
  };
  const get = (id, what) => {
    const e = idx.get(String(id));
    if (!e) fail(what + '：spec 里找不到 id "' + id + '"' + hintFull);
    return e;
  };
  const checkSlot = (pEntry, key, what) => {
    if (key === 'root') { if (pEntry.kind !== 'page') fail(what + '：只有 page 才有 root 槽位'); return; }
    const allowed = KIDS[pEntry.kind] || [];
    if (!allowed.includes(key)) fail(what + '：类型 ' + pEntry.kind + ' 不支持子槽位 "' + key + '"');
  };
  const detach = (e) => {
    if (e.key === 'root') { delete e.holder.root; return; }
    const list = e.holder[e.key];
    const i = list ? list.indexOf(e.obj) : -1;
    if (i >= 0) list.splice(i, 1);
  };
  const attach = (parentId, key, obj, what) => {
    const pe = get(parentId, what || '放入位置');
    checkSlot(pe, key, what || '放入位置');
    const p = pe.obj;
    if (key === 'root') {
      if (isV2 && p.root) fail((what || '放入位置') + '：页面 "' + parentId + '" 已有 root，不能直接覆盖');
      p.root = obj;
      return;
    }
    if (!Array.isArray(p[key])) p[key] = [];
    p[key].push(obj);
  };
  const collectSubtreeIds = (o, kind) => {
    const out = [];
    const walk = (x, k) => {
      if (!x || typeof x !== 'object') return;
      if (x.id != null) out.push(String(x.id));
      if (k === 'page' && x.root) walk(x.root, 'node');
      (KIDS[k] || []).forEach((ck) => { if (Array.isArray(x[ck])) x[ck].forEach((c) => walk(c, CHILD_KIND[ck])); });
    };
    walk(o, kind);
    return out;
  };
  const rank = isV2 ? ['add', 'move', 'del', 'set', 'order', 'top'] : ['del', 'move', 'add', 'set', 'order', 'top'];
  const ops = patch.ops.slice().sort((a, b) => rank.indexOf(a.op) - rank.indexOf(b.op));
  for (const op of ops) {
    reindex();
    if (op.op === 'del') {
      const e = idx.get(String(op.id));
      if (!e) { if (isV2) fail('删除：spec 里找不到 id "' + op.id + '"' + hintFull); continue; }
      detach(e);
    } else if (op.op === 'move') {
      const e = get(op.id, '移动');
      detach(e);
      attach(op.parent, op.key, e.obj, '移动目标');
    } else if (op.op === 'add') {
      const nodeKind = CHILD_KIND[op.key];
      if (!nodeKind) fail('新增：不支持的槽位 "' + op.key + '"');
      const ids = collectSubtreeIds(op.node, nodeKind);
      if (isV2) {
        const dup = ids.find((id) => idx.has(id));
        if (dup) fail('新增：id "' + dup + '" 已存在于 spec 中（重复 id 冲突）' + hintFull);
      } else {
        ids.forEach((id) => { const e = idx.get(id); if (e) detach(e); });
      }
      attach(op.parent, op.key, op.node, '新增位置');
    } else if (op.op === 'set') {
      const e = get(op.id, '修改');
      const forbid = new Set(KIDS[e.kind] || []);
      if (e.kind === 'page') forbid.add('root');
      forbid.add('id');
      const bad = Object.keys(op.set || {}).concat(op.unset || []).find((k) => forbid.has(k));
      if (isV2 && bad) fail('修改 #' + op.id + '：禁止通过 set 改写结构字段 "' + bad + '"');
      Object.assign(e.obj, op.set || {});
      (op.unset || []).forEach((k) => delete e.obj[k]);
    } else if (op.op === 'order') {
      const pe = get(op.parent, '排序');
      checkSlot(pe, op.key, '排序');
      const list = Array.isArray(pe.obj[op.key]) ? pe.obj[op.key] : [];
      const by = new Map(list.map((o) => [String(o.id), o]));
      if (isV2) {
        const seen = new Set();
        for (const id of op.ids || []) {
          const sid = String(id);
          if (seen.has(sid)) fail('排序 ' + op.parent + '.' + op.key + '：包含重复 id "' + sid + '"');
          if (!by.has(sid)) fail('排序 ' + op.parent + '.' + op.key + '：找不到子项 id "' + sid + '"' + hintFull);
          seen.add(sid);
        }
      }
      const idSet = new Set((op.ids || []).map(String));
      pe.obj[op.key] = (op.ids || []).map((id) => by.get(String(id))).filter(Boolean).concat(list.filter((o) => !idSet.has(String(o.id))));
    } else if (op.op === 'top') {
      const bad = Object.keys(op.set || {}).concat(op.unset || []).find((k) => FORBID_TOP.has(k));
      if (isV2 && bad) fail('顶层修改：禁止通过 top 改写保留字段 "' + bad + '"');
      Object.assign(spec, op.set || {});
      (op.unset || []).forEach((k) => delete spec[k]);
    } else {
      fail('不认识的补丁操作 "' + op.op + '"');
    }
  }
  reindex();
  return spec;
}
