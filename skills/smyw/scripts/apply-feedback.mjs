#!/usr/bin/env node
// smyw apply-feedback: take the revisedSpec block out of the feedback Markdown the user pasted
// back, back up the current spec as spec-v<N>.json and write it as version N+1.
// Usage: node apply-feedback.mjs <feedback.md> <spec.json>
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const [mdPath, specPath] = process.argv.slice(2);
if (!mdPath || !specPath) { console.log('用法: node apply-feedback.mjs <feedback.md> <spec.json>'); process.exit(2); }
const md = readFileSync(resolve(mdPath), 'utf8');
const FENCE = '\x60\x60\x60';
const at = md.lastIndexOf('revisedSpec');
const open = at < 0 ? -1 : md.indexOf(FENCE + 'json', at);
const userEdited = /##\s*用户直接对方案做的修改/.test(md);
if (open < 0) {
  if (userEdited) { console.error('✖ 用户改过方案结构，但反馈里没有 revisedSpec JSON。请用户在「反馈」页勾选「附带你修改后的完整方案 JSON」后重新复制。'); process.exit(1); }
  console.log('· 反馈里没有 revisedSpec，用户也没改结构：直接在现有 spec 上处理批注即可（记得 version + 1）。');
  process.exit(0);
}
const start = md.indexOf('\n', open) + 1;
const end = md.indexOf('\n' + FENCE, start);
if (end < 0) { console.error('✖ revisedSpec 代码块没有结束标记，粘贴的内容可能被截断了。请用户重新复制完整反馈。'); process.exit(1); }
let revised;
try { revised = JSON.parse(md.slice(start, end)); } catch (e) { console.error('✖ revisedSpec 不是合法 JSON（可能粘贴不完整）：' + e.message); process.exit(1); }
if (!revised || typeof revised !== 'object' || !['pages', 'flows', 'backend'].some((k) => Array.isArray(revised[k]))) { console.error('✖ revisedSpec 不像一个 smyw spec'); process.exit(1); }

const specFile = resolve(specPath);
const current = JSON.parse(readFileSync(specFile, 'utf8'));
const curVer = Number(current.version) || 1;
if (revised.basedOnVersion != null && Number(revised.basedOnVersion) !== curVer) console.log('⚠ 反馈基于 v' + revised.basedOnVersion + '，而当前 spec 是 v' + curVer + '：用户可能是在旧版本上提的意见，请核对。');
delete revised.basedOnVersion;
revised.version = curVer + 1;
const backup = join(dirname(specFile), 'spec-v' + curVer + '.json');
copyFileSync(specFile, backup);
writeFileSync(specFile, JSON.stringify(revised, null, 2) + '\n');
console.log('✔ 旧 spec 备份为 ' + backup);
console.log('✔ 已写入 v' + revised.version + '：' + specFile);
console.log('  接下来：落实批注 → node build.mjs ' + specPath);
