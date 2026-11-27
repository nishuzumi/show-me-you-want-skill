#!/usr/bin/env node
// Integration test for smyw live preview server (serve.mjs), bridge CLI (bridge.mjs),
// SSE streaming, auth/origin security, queue/subagent round-trip, and claude fork-session driver.
import { mkdtempSync, cpSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { startLiveServer } from '../skills/smyw/scripts/serve.mjs';
import { buildPreview } from '../skills/smyw/scripts/build.mjs';

const execFileAsync = promisify(execFile);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skill = join(root, 'skills', 'smyw');
const scriptsDir = join(skill, 'scripts');
const work = mkdtempSync(join(tmpdir(), 'smyw-live-test-'));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  console.log((ok ? '  ✔ ' : '  ✖ ') + name + (detail !== undefined && !ok ? ' — ' + JSON.stringify(detail).slice(0, 400) : ''));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Static build stays pure offline & runtime.js parses cleanly
console.log('1. static build & syntax check');
cpSync(join(skill, 'examples', 'task-tags', 'spec.json'), join(work, 'spec.json'));
const staticRes = buildPreview(join(work, 'spec.json'), { quiet: true });
check('static build embeds null smyw-live config', staticRes.html.includes('<script type="application/json" id="smyw-live">null</script>'));
const runtimeCode = readFileSync(join(skill, 'assets', 'runtime.js'), 'utf8');
let syntaxOk = true;
try { new Function(runtimeCode); } catch (e) { syntaxOk = false; console.error(e); }
check('runtime.js parses with zero syntax errors', syntaxOk);

// 2. Start live server (queue driver) & verify HTML + security
console.log('2. serve.mjs startup, HTML injection & security');
const srv = await startLiveServer({ specPath: join(work, 'spec.json'), driver: 'queue', quiet: true });
check('.live.json written beside spec.json', existsSync(srv.liveFile));
const htmlRes = await fetch(srv.url);
const html = await htmlRes.text();
const liveMatch = /<script type="application\/json" id="smyw-live">([^<]+)<\/script>/.exec(html);
const liveCfg = liveMatch ? JSON.parse(liveMatch[1]) : null;
check('live HTML injects enabled live config with matching token', htmlRes.status === 200 && liveCfg && liveCfg.enabled === true && liveCfg.token === srv.token && liveCfg.driver === 'queue', liveCfg);

const unauthRes = await fetch(srv.url + 'api/state');
check('missing token is rejected with 401', unauthRes.status === 401);
const badOriginRes = await fetch(srv.url + 'api/chat', {
  method: 'POST',
  headers: { 'X-SMYW-Token': srv.token, 'Origin': 'https://evil.example', 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: 'hack' })
});
check('cross-origin request is rejected with 403', badOriginRes.status === 403);

// 3. Connect SSE stream & test queue + bridge.mjs round-trip
console.log('3. SSE stream + bridge.mjs Subagent round-trip');
const sseEvents = [];
const sseAc = new AbortController();
const ssePromise = (async () => {
  const res = await fetch(srv.url + 'api/events?token=' + encodeURIComponent(srv.token), { signal: sseAc.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let ev = 'message', data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) ev = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (data) {
          try { sseEvents.push({ event: ev, data: JSON.parse(data) }); } catch {}
        }
      }
    }
  } catch { /* aborted on cleanup */ }
})();

const waitForEvent = async (pred, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const found = sseEvents.find(pred);
    if (found) return found;
    await sleep(30);
  }
  return null;
};

const initEv = await waitForEvent((e) => e.event === 'init');
check('SSE receives init event', !!initEv && initEv.data.state.driver === 'queue' && initEv.data.state.agentConnected === false, initEv);

// Start bridge.mjs wait --brief --timeout 0 in background (simulating low-token main Agent doorbell)
const waitChild = spawn('node', [join(scriptsDir, 'bridge.mjs'), 'wait', join(work, 'spec.json'), '--brief', '--timeout', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
let waitOut = '';
waitChild.stdout.on('data', (c) => { waitOut += c.toString('utf8'); });
const waitDone = new Promise((r) => waitChild.on('close', (code) => r(code)));

const connEv = await waitForEvent((e) => e.event === 'agent-state' && e.data.agentConnected === true);
check('bridge.mjs wait --brief --timeout 0 flips agentConnected to true over SSE', !!connEv);

// Browser sends chat message with selected context + canvas feedback markdown
const chatPayload = {
  text: '把这个按钮改成「新增任务」',
  context: { kind: 'node', page: 'task-list', id: 'btn-new', label: '按钮「新建任务」 #btn-new', where: '页面「任务列表」› 改动后 › 按钮「新建任务」 #btn-new' },
  hasEdits: true,
  opsCount: 0,
  commentsCount: 1,
  baseVersion: 1,
  feedbackMarkdown: '# 原型反馈\n## 批注\n1. **[必须改][文案]** #btn-new\n   改为新增任务\n'
};
const chatRes = await fetch(srv.url + 'api/chat', {
  method: 'POST',
  headers: { 'X-SMYW-Token': srv.token, 'Content-Type': 'application/json' },
  body: JSON.stringify(chatPayload)
});
check('/api/chat accepts message with 202', chatRes.status === 202);

// Concurrent request while busy must be rejected with 409
const busyRes = await fetch(srv.url + 'api/chat', {
  method: 'POST',
  headers: { 'X-SMYW-Token': srv.token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: '另一条并发请求' })
});
check('concurrent /api/chat while busy returns 409', busyRes.status === 409);

// Main Agent receives compact brief pointer (no raw feedbackMarkdown leaked into stdout), full payload is in reqFile
const waitCode = await waitDone;
const waitBrief = JSON.parse(waitOut);
const reqPayload = waitBrief.reqFile && existsSync(waitBrief.reqFile) ? JSON.parse(readFileSync(waitBrief.reqFile, 'utf8')) : null;
check('bridge.mjs wait --brief wakes with compact pointer & persists full reqFile + feedbackFile',
  waitCode === 0 && waitBrief.event === 'message' && waitBrief.kind === 'chat' &&
  !waitOut.includes('原型反馈') && !('item' in waitBrief) && Object.keys(waitBrief).length <= 4 &&
  !!reqPayload && reqPayload.context.id === 'btn-new' && existsSync(reqPayload.feedbackFile) && reqPayload.logFile === srv.logFile,
  { waitBrief, len: waitOut.length });

// Subagent pushes progress + streaming delta
await execFileAsync('node', [join(scriptsDir, 'bridge.mjs'), 'status', join(work, 'spec.json'), '正在修改 spec.json…', '--delta', '正在把按钮改为']);
const chunkEv = await waitForEvent((e) => e.event === 'chunk' && e.data.delta === '正在把按钮改为');
check('bridge.mjs status pushes streaming chunk over SSE', !!chunkEv);

// Subagent updates spec.json to v2 (even wait slightly so fs.watch fires first!) and calls bridge.mjs reply
const sp = JSON.parse(readFileSync(join(work, 'spec.json'), 'utf8'));
sp.version = 2;
sp.versionNote = '按钮文案改为新增任务';
const findNode = (n, id) => n.id === id ? n : (n.children || []).map((c) => findNode(c, id)).find(Boolean);
findNode(sp.pages[0].root, 'btn-new').label = '新增任务';
writeFileSync(join(work, 'spec.json'), JSON.stringify(sp, null, 2) + '\n');
await sleep(350);

const { stdout: replyRaw } = await execFileAsync('node', [join(scriptsDir, 'bridge.mjs'), 'reply', join(work, 'spec.json'), '--text', '已将按钮文字更新为「新增任务」。'], { encoding: 'utf8' });
const replyJson = JSON.parse(replyRaw);
const specUpEv = await waitForEvent((e) => e.event === 'spec-updated' && e.data.version === 2);
const aiMsgEv = await waitForEvent((e) => e.event === 'message' && e.data.message && e.data.message.role === 'assistant');
const liveLog = existsSync(srv.logFile) ? readFileSync(srv.logFile, 'utf8') : '';
check('bridge.mjs reply links versionFrom=1 → versionTo=2 even after fs.watch reload & appends .live-log.md',
  replyJson.ok && replyJson.reload.version === 2 &&
  !!specUpEv && specUpEv.data.versions.map((v) => v.version).join(',') === '0,1,2' &&
  !!aiMsgEv && aiMsgEv.data.message.versionFrom === 1 && aiMsgEv.data.message.versionTo === 2 &&
  liveLog.includes('@#btn-new') && liveLog.includes('v1→v2'),
  { replyJson, aiMsgEv, liveLog });

// Approve flow wakes waiting subagent & bridge.mjs stop shuts server cleanly
const waitApprove = spawn('node', [join(scriptsDir, 'bridge.mjs'), 'wait', join(work, 'spec.json'), '--timeout', '30'], { stdio: ['ignore', 'pipe', 'pipe'] });
let approveOut = '';
waitApprove.stdout.on('data', (c) => { approveOut += c.toString('utf8'); });
const approveDone = new Promise((r) => waitApprove.on('close', (code) => r(code)));
await sleep(120);
const appRes = await fetch(srv.url + 'api/approve', {
  method: 'POST',
  headers: { 'X-SMYW-Token': srv.token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ note: '没问题，开始实现吧' })
});
const appCode = await approveDone;
const appJson = JSON.parse(approveOut);
check('/api/approve wakes bridge.mjs wait with kind=approve', appRes.status === 200 && appCode === 0 && appJson.item.kind === 'approve' && appJson.item.version === 2, appJson);

await execFileAsync('node', [join(scriptsDir, 'bridge.mjs'), 'stop', join(work, 'spec.json')]);
const shutdownEv = await waitForEvent((e) => e.event === 'shutdown');
sseAc.abort();
await ssePromise;
await sleep(100);
check('bridge.mjs stop broadcasts shutdown and cleans up .live.json', !!shutdownEv && !existsSync(srv.liveFile));

// 4. Claude driver (--resume + --fork-session) with a mock claude CLI
console.log('4. claude driver (--resume + --fork-session streaming & follow-up resume)');
const workC = mkdtempSync(join(tmpdir(), 'smyw-claude-test-'));
cpSync(join(skill, 'examples', 'task-tags', 'spec.json'), join(workC, 'spec.json'));
const argsLog = join(workC, 'claude-args.jsonl');
const mockClaude = join(workC, 'mock-claude.mjs');
writeFileSync(mockClaude, [
  '#!/usr/bin/env node',
  'import { appendFileSync, readFileSync, writeFileSync } from "node:fs";',
  'const args = process.argv.slice(2);',
  'appendFileSync(' + JSON.stringify(argsLog) + ', JSON.stringify(args) + "\\n");',
  'const isFork = args.includes("--fork-session");',
  'const sid = "forked-sess-42";',
  'const specFile = ' + JSON.stringify(join(workC, 'spec.json')) + ';',
  'const sp = JSON.parse(readFileSync(specFile, "utf8"));',
  'sp.version = (Number(sp.version) || 1) + 1;',
  'sp.versionNote = isFork ? "Claude fork 首次修改" : "Claude 续聊修改";',
  'writeFileSync(specFile, JSON.stringify(sp, null, 2) + "\\n");',
  'const emit = (o) => process.stdout.write(JSON.stringify(o) + "\\n");',
  'emit({ type: "system", subtype: "init", session_id: sid });',
  'emit({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "Edit" } } });',
  'emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "好的，" } } });',
  'emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "已更新到 v" + sp.version + "。" } } });',
  'emit({ type: "result", session_id: sid, result: "好的，已更新到 v" + sp.version + "。" });'
].join('\n'));
chmodSync(mockClaude, 0o755);

const srvC = await startLiveServer({
  specPath: join(workC, 'spec.json'),
  driver: 'claude',
  resume: 'parent-sess-99',
  fork: true,
  claudeBin: mockClaude,
  quiet: true
});

const cEvents = [];
const cAc = new AbortController();
const cSse = (async () => {
  const res = await fetch(srvC.url + 'api/events?token=' + encodeURIComponent(srvC.token), { signal: cAc.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let ev = 'message', data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) ev = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (data) { try { cEvents.push({ event: ev, data: JSON.parse(data) }); } catch {} }
      }
    }
  } catch {}
})();
const waitC = async (pred, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const f = cEvents.find(pred); if (f) return f; await sleep(30); }
  return null;
};

await waitC((e) => e.event === 'init');
await fetch(srvC.url + 'api/chat', {
  method: 'POST',
  headers: { 'X-SMYW-Token': srvC.token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: '第一轮修改' })
});
const msg1 = await waitC((e) => e.event === 'message' && e.data.message && e.data.message.role === 'assistant');
const chunks1 = cEvents.filter((e) => e.event === 'chunk').map((e) => e.data.delta).join('');

// Second turn should resume the forked session without --fork-session
await fetch(srvC.url + 'api/chat', {
  method: 'POST',
  headers: { 'X-SMYW-Token': srvC.token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: '第二轮继续微调' })
});
const msg2 = await waitC((e) => e.event === 'message' && e.data.message && e.data.message.role === 'assistant' && e.data.message.id !== (msg1 && msg1.data.message.id));

const invocations = readFileSync(argsLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
check('claude driver turn 1 forks parent session, streams chunks, and hot-reloads v2',
  !!msg1 && chunks1 === '好的，已更新到 v2。' && msg1.data.message.versionFrom === 1 && msg1.data.message.versionTo === 2 &&
  invocations[0].includes('--resume') && invocations[0].includes('parent-sess-99') && invocations[0].includes('--fork-session'),
  { chunks1, msg1, args0: invocations[0] });
check('claude driver turn 2 resumes forked session without --fork-session and hot-reloads v3',
  !!msg2 && msg2.data.message.versionFrom === 2 && msg2.data.message.versionTo === 3 &&
  invocations[1].includes('--resume') && invocations[1].includes('forked-sess-42') && !invocations[1].includes('--fork-session'),
  { msg2, args1: invocations[1] });

cAc.abort();
await cSse;
await srvC.close();

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log('\n' + passed + '/' + results.length + ' passed' + (failed ? ', ' + failed + ' FAILED' : ''));
process.exit(failed ? 1 : 0);
