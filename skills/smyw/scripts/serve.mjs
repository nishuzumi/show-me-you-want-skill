#!/usr/bin/env node
// smyw live server: serves preview.html with a real-time Agent chat drawer over local HTTP + SSE.
// Supports two agent drivers:
//   - queue  (default): exposes a local bridge queue for the current AI conversation or a Preview Subagent via bridge.mjs
//   - claude          : on-demand Claude Code CLI adapter (--resume + --fork-session) with real-time token streaming
// Usage: node serve.mjs <spec.json> [--port 0] [--host 127.0.0.1] [--driver queue|claude] [--resume <id>] [--no-fork] [--no-theme] [--open]
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { writeFileSync, appendFileSync, mkdirSync, unlinkSync, existsSync, watch } from 'node:fs';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { buildPreview, loadSpecData, archiveSpec, findProjectRoot } from './build.mjs';
import { specHash } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 5 * 1024 * 1024;

function usage(code) {
  console.log([
    '用法: node serve.mjs <spec.json> [选项]',
    '  --port <n>            监听端口（默认 0，随机空闲端口）',
    '  --host <addr>         监听地址（默认 127.0.0.1）',
    '  --driver <name>       驱动：queue（默认，配合 bridge.mjs 由当前对话或 Subagent 接单）| claude',
    '  --resume <sessionId>  claude 驱动下继承的会话 ID（默认首次自动 --fork-session）',
    '  --no-fork             claude 驱动下直接续聊不 fork',
    '  --claude-bin <path>   claude CLI 路径（默认 claude）',
    '  --cwd <dir>           claude 驱动的工作目录（默认自动定位项目根）',
    '  --no-theme            跳过项目主题提取',
    '  --open                启动后尝试用默认浏览器打开',
  ].join('\n'));
  process.exit(code);
}

function nowIso() { return new Date().toISOString(); }
function uid(pfx) { return pfx + '-' + Date.now().toString(36) + '-' + randomBytes(3).toString('hex'); }

function readJsonBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > MAX_BODY) {
        done = true;
        const err = new Error('请求体过大（超过 5 MB）');
        err.status = 413;
        rejectBody(err);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) { resolveBody({}); return; }
      try { resolveBody(JSON.parse(raw)); }
      catch (e) { const err = new Error('无效 JSON：' + e.message); err.status = 400; rejectBody(err); }
    });
    req.on('error', (err) => { if (!done) { done = true; rejectBody(err); } });
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function openBrowser(url) {
  try {
    const cmd = process.platform === 'darwin' ? 'open' : (process.platform === 'win32' ? 'cmd' : 'xdg-open');
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.unref();
  } catch { /* ignore */ }
}

export async function startLiveServer(opts) {
  const specPath = resolve(opts.specPath);
  const specDir = dirname(specPath);
  const specName = basename(specPath);
  const host = opts.host || '127.0.0.1';
  const port = Number(opts.port) || 0;
  const driver = opts.driver === 'claude' ? 'claude' : 'queue';
  const noTheme = !!opts.noTheme;
  const claudeBin = opts.claudeBin || 'claude';
  const cwd = resolve(opts.cwd || findProjectRoot(specDir) || specDir);
  const token = opts.token || randomBytes(16).toString('hex');
  const liveFile = join(specDir, '.live.json');
  const inboxDir = join(specDir, '.inbox');
  const logFile = join(specDir, '.live-log.md');
  mkdirSync(inboxDir, { recursive: true });
  if (!existsSync(logFile)) {
    writeFileSync(logFile, '# smyw Live Session Log\n\n');
  }

  function compactText(s, max = 140) {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  }
  function appendLog(line) {
    try { appendFileSync(logFile, line + '\n'); } catch { /* non-fatal */ }
  }
  function saveRequestFile(item) {
    const reqPath = join(inboxDir, item.id + '.json');
    try {
      const payload = Object.assign({}, item, { specPath, logFile, reqFile: reqPath });
      writeFileSync(reqPath, JSON.stringify(payload, null, 2) + '\n');
      return reqPath;
    } catch {
      return null;
    }
  }
  function formatWaitResponse(item, brief) {
    if (!brief) return { event: 'message', item };
    const parts = [];
    if (item.context && item.context.id) parts.push('@#' + item.context.id);
    if (item.text) parts.push(compactText(item.text, 80));
    const extras = [];
    if (item.opsCount > 0) extras.push('+' + item.opsCount + '画布修改');
    if (item.commentsCount > 0) extras.push('+' + item.commentsCount + '批注');
    if (extras.length) parts.push('(' + extras.join(' ') + ')');
    return {
      event: 'message',
      kind: item.kind,
      reqFile: item.reqFile || null,
      preview: parts.join(' ') || (item.kind === 'approve' ? '用户已确认方案' : '新消息')
    };
  }

  // Initial load & validation
  let curData = loadSpecData(specPath, { quiet: !!opts.quiet });
  if (curData.errors.length) {
    const err = new Error('spec 校验失败：\n' + curData.errors.join('\n'));
    err.errors = curData.errors;
    throw err;
  }
  archiveSpec(specPath, curData.raw, curData.spec, true);
  let lastSpecHash = specHash(curData.spec);
  let lastSpecVersion = Number(curData.spec.version) || 1;

  // Live session state
  let claudeSessionId = opts.resume ? String(opts.resume) : null;
  let claudeNeedsFork = !!(claudeSessionId && opts.fork !== false);
  let closed = false;
  let busy = false;
  let busyStatus = '';
  let approved = false;
  let agentPickedUp = false;
  let lastAgentSeenAt = 0;
  let activeStreamId = null;
  let activeStreamText = '';
  let activeBaseVersion = lastSpecVersion;
  let activeClaudeProc = null;

  const messages = [];
  const sseClients = new Set();
  const pendingInbox = [];
  const waiters = [];

  function isAgentConnected() {
    if (driver === 'claude') return true;
    if (waiters.length > 0 || agentPickedUp) return true;
    return lastAgentSeenAt > 0 && (Date.now() - lastAgentSeenAt) < 15000;
  }

  function agentStatePayload() {
    return {
      driver,
      agentConnected: isAgentConnected(),
      busy,
      busyStatus,
      approved,
      version: lastSpecVersion,
      pendingCount: pendingInbox.length
    };
  }

  function broadcast(event, data) {
    const payload = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
    for (const res of sseClients) {
      try { res.write(payload); } catch { sseClients.delete(res); }
    }
  }

  function broadcastAgentState() {
    broadcast('agent-state', agentStatePayload());
  }

  function reloadFromDisk({ writeHtml = false, forceBroadcast = false } = {}) {
    let next;
    try {
      next = loadSpecData(specPath, { quiet: true });
    } catch (e) {
      return { ok: false, errors: [e.message] };
    }
    if (next.errors.length) return { ok: false, errors: next.errors };
    const nextHash = specHash(next.spec);
    const nextVer = Number(next.spec.version) || 1;
    const changed = nextHash !== lastSpecHash;
    const prevVer = lastSpecVersion;
    if (changed || forceBroadcast) {
      archiveSpec(specPath, next.raw, next.spec, true);
      // Reload once more so versions array includes any freshly archived file cleanly
      const fresh = loadSpecData(specPath, { quiet: true });
      curData = fresh.errors.length ? next : fresh;
      lastSpecHash = nextHash;
      lastSpecVersion = nextVer;
      if (writeHtml) {
        try {
          const built = buildPreview(specPath, { noTheme, quiet: true });
          if (built.html) writeFileSync(join(specDir, 'preview.html'), built.html);
        } catch { /* non-fatal */ }
      }
      broadcast('spec-updated', {
        spec: curData.spec,
        versions: curData.versions,
        version: nextVer,
        previousVersion: prevVer,
        summary: curData.summary
      });
      broadcastAgentState();
      return { ok: true, changed: true, previousVersion: prevVer, version: nextVer, data: curData };
    }
    return { ok: true, changed: false, previousVersion: prevVer, version: nextVer, data: curData };
  }

  function wakeWaiter(item) {
    while (waiters.length) {
      const w = waiters.shift();
      if (w.timer) clearTimeout(w.timer);
      if (w.res.writableEnded) continue;
      lastAgentSeenAt = Date.now();
      agentPickedUp = item.kind === 'chat';
      if (item.kind === 'chat') {
        busyStatus = 'Agent 已接单，处理中…';
        broadcastAgentState();
      }
      sendJson(w.res, 200, formatWaitResponse(item, w.brief));
      return true;
    }
    pendingInbox.push(item);
    return false;
  }

  function saveFeedbackFile(item) {
    if (!item.feedbackMarkdown) return null;
    const fname = 'feedback-v' + (item.baseVersion || lastSpecVersion) + '-live-' + item.id.slice(-6) + '.md';
    const fpath = join(specDir, fname);
    try {
      writeFileSync(fpath, item.feedbackMarkdown);
      return fpath;
    } catch {
      return null;
    }
  }

  function buildClaudePrompt(item) {
    const applyScript = join(here, 'apply-feedback.mjs');
    const buildScript = join(here, 'build.mjs');
    const lines = [
      '你正在作为 smyw 实时预览助手，响应用户在浏览器原型画布里发来的修改意见。',
      '',
      `- 当前 spec 文件：${specPath}（当前版本 v${lastSpecVersion}）`,
      `- apply-feedback 脚本：${applyScript}`,
      `- build 脚本：${buildScript}`,
    ];
    if (item.context && (item.context.where || item.context.id)) {
      lines.push(`- 用户当前选中元素：${item.context.where || ''}${item.context.id ? ' (#' + item.context.id + ')' : ''}${item.context.page ? ' [页面: ' + item.context.page + ']' : ''}`);
    }
    if (item.feedbackFile) {
      lines.push(`- 用户在画布上还有未应用的直接修改/批注，已保存到：${item.feedbackFile}`);
      if (item.opsCount > 0) {
        lines.push(`  请先运行：node "${applyScript}" "${item.feedbackFile}" "${specPath}" 应用结构补丁，再处理下面的文字需求。`);
      } else {
        lines.push('  请一并查看并落实其中的批注或整体意见。');
      }
    }
    lines.push('', '用户消息：', item.text || '（无文字）', '', '处理要求：');
    lines.push('1. 如用户只是提问或讨论方案，可以直接结合代码和 spec 回答，无需改 spec.json。');
    lines.push('2. 如需修改原型：精确编辑 spec.json（保持已有节点 id 稳定、version 递增 +1、写一句简短的 versionNote），然后运行：');
    lines.push(`   node "${buildScript}" "${specPath}"`);
    lines.push('   确保校验通过（无 ✖ 错误）。');
    lines.push('3. 最后用简洁中文回复用户：改了什么 / 回答了什么，无需粘贴整份 JSON。');
    return lines.join('\n');
  }

  function runClaudeTurn(item) {
    const prompt = buildClaudePrompt(item);
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
    if (claudeSessionId) {
      args.push('--resume', claudeSessionId);
      if (claudeNeedsFork) args.push('--fork-session');
    }
    activeStreamId = uid('msg');
    activeStreamText = '';
    busyStatus = claudeSessionId ? '正在调用分叉会话处理…' : 'Agent 思考中…';
    broadcastAgentState();

    const child = spawn(claudeBin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    activeClaudeProc = child;
    let buf = '';
    let stderrBuf = '';
    let finalResultText = '';

    const pushDelta = (delta) => {
      if (!delta) return;
      activeStreamText += delta;
      broadcast('chunk', { id: activeStreamId, delta });
    };

    const handleLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let ev;
      try { ev = JSON.parse(trimmed); } catch { return; }
      if (ev.session_id) {
        claudeSessionId = String(ev.session_id);
        claudeNeedsFork = false;
      }
      if (ev.type === 'stream_event' && ev.event) {
        const inner = ev.event;
        if (inner.type === 'content_block_delta' && inner.delta && inner.delta.type === 'text_delta' && inner.delta.text) {
          pushDelta(inner.delta.text);
        } else if (inner.type === 'content_block_start' && inner.content_block && inner.content_block.type === 'tool_use') {
          busyStatus = '正在调用 ' + (inner.content_block.name || '工具') + '…';
          broadcastAgentState();
        }
        return;
      }
      if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
        for (const blk of ev.message.content) {
          if (blk && blk.type === 'tool_use') {
            busyStatus = '正在执行 ' + (blk.name || '工具') + '…';
            broadcastAgentState();
          } else if (blk && blk.type === 'text' && blk.text) {
            if (!activeStreamText) pushDelta(blk.text);
            else if (blk.text.startsWith(activeStreamText) && blk.text.length > activeStreamText.length) {
              pushDelta(blk.text.slice(activeStreamText.length));
            }
          }
        }
        return;
      }
      if (ev.type === 'result' && typeof ev.result === 'string') {
        finalResultText = ev.result;
      }
    };

    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        handleLine(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
      }
    });
    child.stderr.on('data', (chunk) => { stderrBuf += chunk.toString('utf8'); });

    const finish = (errMsg) => {
      activeClaudeProc = null;
      if (buf.trim()) handleLine(buf);
      const reloadRes = reloadFromDisk({ writeHtml: true });
      const text = errMsg || activeStreamText.trim() || finalResultText.trim() || (reloadRes.changed ? ('已更新方案至 v' + reloadRes.version + '。') : '已完成处理。');
      const msg = {
        id: activeStreamId || uid('msg'),
        role: errMsg ? 'system' : 'assistant',
        text,
        ts: nowIso(),
        error: !!errMsg
      };
      if (reloadRes.ok && (reloadRes.changed || lastSpecVersion !== activeBaseVersion)) {
        msg.versionFrom = activeBaseVersion;
        msg.versionTo = lastSpecVersion;
      }
      messages.push(msg);
      appendLog('  - Agent' + (msg.versionTo != null ? (' (v' + msg.versionFrom + '→v' + msg.versionTo + ')') : '') + '：' + compactText(text, 180));
      activeStreamId = null;
      activeStreamText = '';
      busy = false;
      busyStatus = '';
      broadcast('message', { message: msg });
      broadcastAgentState();
    };

    child.on('error', (err) => {
      finish('无法启动 claude CLI（' + claudeBin + '）：' + err.message);
    });
    child.on('close', (code) => {
      if (code === 0) finish(null);
      else finish('claude 执行失败（退出码 ' + code + '）' + (stderrBuf.trim() ? '：' + stderrBuf.trim().slice(0, 300) : ''));
    });
  }

  // Watch spec.json on disk for automatic hot reload
  let watchTimer = null;
  let fsWatcher = null;
  try {
    fsWatcher = watch(specDir, (_evType, fname) => {
      if (fname && String(fname) !== specName) return;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => {
        if (!closed) reloadFromDisk({ writeHtml: false });
      }, 250);
    });
  } catch { /* watcher optional on exotic filesystems */ }

  let boundPort = port;
  function isAllowedOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    const allowed = new Set([
      'http://127.0.0.1:' + boundPort,
      'http://localhost:' + boundPort,
      'http://[::1]:' + boundPort
    ]);
    return allowed.has(origin);
  }
  function isAuthorized(req, urlObj) {
    return req.headers['x-smyw-token'] === token || urlObj.searchParams.get('token') === token;
  }

  const server = createServer(async (req, res) => {
    const urlObj = new URL(req.url || '/', 'http://' + host + ':' + boundPort);
    const pathname = urlObj.pathname;

    // Main HTML preview
    if (req.method === 'GET' && (pathname === '/' || pathname === '/preview.html')) {
      try {
        const built = buildPreview(specPath, {
          noTheme,
          quiet: true,
          liveConfig: {
            enabled: true,
            token,
            driver,
            specFile: specName,
            version: lastSpecVersion,
            resumed: !!claudeSessionId
          }
        });
        if (built.errors.length || !built.html) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('spec 校验失败：\n' + built.errors.join('\n'));
          return;
        }
        curData = built;
        lastSpecHash = specHash(built.spec);
        lastSpecVersion = Number(built.spec.version) || 1;
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        res.end(built.html);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('加载预览失败：' + e.message);
      }
      return;
    }

    // All /api/* require auth token & local origin check
    if (pathname.startsWith('/api/')) {
      if (!isAllowedOrigin(req)) { sendJson(res, 403, { error: 'Forbidden origin' }); return; }
      if (!isAuthorized(req, urlObj)) { sendJson(res, 401, { error: 'Unauthorized: missing or invalid X-SMYW-Token' }); return; }
    }

    // SSE stream
    if (req.method === 'GET' && pathname === '/api/events') {
      req.setTimeout(0);
      res.setTimeout(0);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.write('event: init\ndata: ' + JSON.stringify({
        state: agentStatePayload(),
        messages,
        stream: activeStreamId ? { id: activeStreamId, text: activeStreamText } : null
      }) + '\n\n');
      sseClients.add(res);
      const ping = setInterval(() => {
        if (res.writableEnded) { clearInterval(ping); sseClients.delete(res); return; }
        try { res.write(': ping\n\n'); } catch { clearInterval(ping); sseClients.delete(res); }
      }, 15000);
      req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
      return;
    }

    // Read current state
    if (req.method === 'GET' && pathname === '/api/state') {
      sendJson(res, 200, {
        state: agentStatePayload(),
        messages,
        spec: curData.spec,
        versions: curData.versions
      });
      return;
    }

    // User sends a chat message from the browser
    if (req.method === 'POST' && pathname === '/api/chat') {
      let body;
      try { body = await readJsonBody(req); } catch (e) { sendJson(res, e.status || 400, { error: e.message }); return; }
      const text = String(body.text || '').trim();
      const hasEdits = !!(body.hasEdits || body.opsCount > 0 || body.commentsCount > 0);
      if (!text && !hasEdits) { sendJson(res, 400, { error: '请输入修改意见或先在画布上做出修改/批注' }); return; }
      if (busy) { sendJson(res, 409, { error: 'Agent 正在处理上一条请求，请稍候' }); return; }

      const id = uid('req');
      const userMsg = {
        id,
        role: 'user',
        text: text || '请应用我在画布上做的修改与批注',
        ts: nowIso(),
        context: body.context || null,
        opsCount: Number(body.opsCount) || 0,
        commentsCount: Number(body.commentsCount) || 0
      };
      messages.push(userMsg);
      activeBaseVersion = lastSpecVersion;
      busy = true;
      busyStatus = driver === 'claude' ? 'Agent 思考中…' : (waiters.length ? '已发送给 Agent，处理中…' : '已入队，等待 Agent 接单…');

      const item = {
        id,
        kind: 'chat',
        text: userMsg.text,
        context: body.context || null,
        hasEdits,
        opsCount: userMsg.opsCount,
        commentsCount: userMsg.commentsCount,
        baseVersion: Number(body.baseVersion) || lastSpecVersion,
        baseHash: body.baseHash || lastSpecHash,
        feedbackMarkdown: typeof body.feedbackMarkdown === 'string' ? body.feedbackMarkdown : '',
        patch: body.patch || null,
        ts: userMsg.ts
      };
      if (hasEdits && item.feedbackMarkdown) {
        item.feedbackFile = saveFeedbackFile(item);
      }
      item.reqFile = saveRequestFile(item);
      item.logFile = logFile;
      const ctxHint = item.context && item.context.id ? (' [@#' + item.context.id + ']') : '';
      const edHint = hasEdits ? (' (+' + userMsg.opsCount + '改/' + userMsg.commentsCount + '批注)') : '';
      appendLog('- [' + new Date().toTimeString().slice(0, 8) + '] 用户' + ctxHint + '：' + compactText(userMsg.text, 140) + edHint);

      broadcast('message', { message: userMsg });
      broadcastAgentState();

      if (driver === 'claude') {
        runClaudeTurn(item);
      } else {
        wakeWaiter(item);
      }
      sendJson(res, 202, { ok: true, id, state: agentStatePayload() });
      return;
    }

    // User approves the proposal from the browser
    if (req.method === 'POST' && pathname === '/api/approve') {
      let body;
      try { body = await readJsonBody(req); } catch (e) { sendJson(res, e.status || 400, { error: e.message }); return; }
      approved = true;
      const id = uid('approve');
      const note = String(body.note || '').trim();
      const sysMsg = {
        id,
        role: 'system',
        kind: 'approve',
        text: '✅ 已确认方案（v' + lastSpecVersion + '）' + (note ? '：' + note : '，已通知 Agent 可以开始实现。'),
        ts: nowIso()
      };
      messages.push(sysMsg);
      const item = {
        id,
        kind: 'approve',
        text: note || '用户已确认当前方案，可以开始实现。',
        version: lastSpecVersion,
        hasEdits: !!(body.hasEdits || body.opsCount > 0 || body.commentsCount > 0),
        opsCount: Number(body.opsCount) || 0,
        commentsCount: Number(body.commentsCount) || 0,
        baseVersion: Number(body.baseVersion) || lastSpecVersion,
        baseHash: body.baseHash || lastSpecHash,
        feedbackMarkdown: typeof body.feedbackMarkdown === 'string' ? body.feedbackMarkdown : '',
        ts: sysMsg.ts
      };
      if (item.hasEdits && item.feedbackMarkdown) item.feedbackFile = saveFeedbackFile(item);
      item.reqFile = saveRequestFile(item);
      item.logFile = logFile;
      appendLog('- [' + new Date().toTimeString().slice(0, 8) + '] ✅ 用户已确认方案（v' + lastSpecVersion + '）' + (note ? '：' + compactText(note, 100) : ''));
      broadcast('message', { message: sysMsg });
      broadcastAgentState();
      if (driver === 'queue') wakeWaiter(item);
      sendJson(res, 200, { ok: true, id, state: agentStatePayload() });
      return;
    }

    // Bridge: agent/subagent long-polls for next message (timeout=0 waits indefinitely with zero polling)
    if (req.method === 'GET' && pathname === '/api/bridge/wait') {
      req.setTimeout(0);
      res.setTimeout(0);
      const rawTimeout = urlObj.searchParams.get('timeout');
      const timeoutSec = rawTimeout === null || rawTimeout === '' ? 0 : Math.max(0, Number(rawTimeout) || 0);
      const brief = urlObj.searchParams.get('brief') === '1' || urlObj.searchParams.get('brief') === 'true';
      lastAgentSeenAt = Date.now();
      if (pendingInbox.length) {
        const item = pendingInbox.shift();
        agentPickedUp = item.kind === 'chat';
        if (item.kind === 'chat') busyStatus = 'Agent 已接单，处理中…';
        broadcastAgentState();
        sendJson(res, 200, formatWaitResponse(item, brief));
        return;
      }
      const entry = { res, brief, timer: null };
      if (timeoutSec > 0) {
        entry.timer = setTimeout(() => {
          const i = waiters.indexOf(entry);
          if (i >= 0) waiters.splice(i, 1);
          lastAgentSeenAt = Date.now();
          if (!res.writableEnded) sendJson(res, 200, { event: 'timeout' });
          broadcastAgentState();
        }, timeoutSec * 1000);
      }
      waiters.push(entry);
      req.on('close', () => {
        if (entry.timer) clearTimeout(entry.timer);
        const i = waiters.indexOf(entry);
        if (i >= 0) waiters.splice(i, 1);
        broadcastAgentState();
      });
      broadcastAgentState();
      return;
    }

    // Bridge: agent/subagent reports progress or streaming chunk
    if (req.method === 'POST' && pathname === '/api/bridge/status') {
      let body;
      try { body = await readJsonBody(req); } catch (e) { sendJson(res, e.status || 400, { error: e.message }); return; }
      lastAgentSeenAt = Date.now();
      if (typeof body.text === 'string' && body.text.trim()) {
        busyStatus = body.text.trim();
        broadcastAgentState();
      }
      if (typeof body.delta === 'string' && body.delta) {
        if (!activeStreamId) activeStreamId = uid('msg');
        activeStreamText += body.delta;
        broadcast('chunk', { id: activeStreamId, delta: body.delta });
      }
      sendJson(res, 200, { ok: true, state: agentStatePayload() });
      return;
    }

    // Bridge: agent/subagent sends final reply & triggers spec hot reload
    if (req.method === 'POST' && pathname === '/api/bridge/reply') {
      let body;
      try { body = await readJsonBody(req); } catch (e) { sendJson(res, e.status || 400, { error: e.message }); return; }
      lastAgentSeenAt = Date.now();
      const doReload = body.reload !== false;
      const reloadRes = doReload ? reloadFromDisk({ writeHtml: body.writeHtml !== false }) : { ok: true, changed: false, version: lastSpecVersion, previousVersion: lastSpecVersion };
      const text = String(body.text || activeStreamText || '').trim() || (reloadRes.changed ? ('已更新方案至 v' + reloadRes.version + '。') : '已完成处理。');
      const msg = {
        id: activeStreamId || uid('msg'),
        role: 'assistant',
        text,
        ts: nowIso()
      };
      if (reloadRes.ok && (reloadRes.changed || lastSpecVersion !== activeBaseVersion)) {
        msg.versionFrom = activeBaseVersion;
        msg.versionTo = lastSpecVersion;
      } else if (body.versionFrom != null && body.versionTo != null) {
        msg.versionFrom = Number(body.versionFrom);
        msg.versionTo = Number(body.versionTo);
      }
      if (!reloadRes.ok && reloadRes.errors) {
        msg.warnings = reloadRes.errors;
      }
      messages.push(msg);
      appendLog('  - Agent' + (msg.versionTo != null ? (' (v' + msg.versionFrom + '→v' + msg.versionTo + ')') : '') + '：' + compactText(text, 180));
      activeStreamId = null;
      activeStreamText = '';
      agentPickedUp = false;
      busy = false;
      busyStatus = '';
      broadcast('message', { message: msg });
      broadcastAgentState();
      sendJson(res, 200, { ok: true, message: msg, reload: { ok: reloadRes.ok, changed: !!reloadRes.changed, version: reloadRes.version, errors: reloadRes.errors || [] } });
      return;
    }

    // Bridge: gracefully stop server
    if (req.method === 'POST' && pathname === '/api/bridge/stop') {
      sendJson(res, 200, { ok: true });
      setTimeout(() => { close(); }, 50);
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  });

  // Disable Node's default 5-minute requestTimeout so long-poll wait & SSE stay open indefinitely
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.keepAliveTimeout = 0;

  // Periodic agent presence freshness check for queue driver
  let lastKnownConnected = isAgentConnected();
  const presenceTimer = setInterval(() => {
    const cur = isAgentConnected();
    if (cur !== lastKnownConnected) {
      lastKnownConnected = cur;
      broadcastAgentState();
    }
  }, 5000);

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, host, () => {
      server.removeListener('error', rejectListen);
      resolveListen();
    });
  });

  const addr = server.address();
  boundPort = typeof addr === 'object' && addr ? addr.port : port;
  const url = 'http://' + host + ':' + boundPort + '/';
  const info = {
    pid: process.pid,
    url,
    port: boundPort,
    host,
    token,
    driver,
    specPath,
    inboxDir,
    logFile,
    startedAt: nowIso()
  };
  writeFileSync(liveFile, JSON.stringify(info, null, 2) + '\n');

  let closing = false;
  function close() {
    if (closing) return Promise.resolve();
    closing = true;
    closed = true;
    clearInterval(presenceTimer);
    clearTimeout(watchTimer);
    if (fsWatcher) { try { fsWatcher.close(); } catch {} }
    if (activeClaudeProc) { try { activeClaudeProc.kill('SIGTERM'); } catch {} }
    while (waiters.length) {
      const w = waiters.shift();
      if (w.timer) clearTimeout(w.timer);
      if (!w.res.writableEnded) sendJson(w.res, 200, { event: 'shutdown' });
    }
    for (const res of sseClients) {
      try {
        res.write('event: shutdown\ndata: {}\n\n');
        res.end();
      } catch {}
    }
    sseClients.clear();
    try { if (existsSync(liveFile)) unlinkSync(liveFile); } catch {}
    return new Promise((r) => server.close(() => r()));
  }

  return { server, url, port: boundPort, host, token, driver, liveFile, inboxDir, logFile, info, close, reloadFromDisk };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  let specPath = null, port = 0, host = '127.0.0.1', driver = 'queue', resume = null, fork = true, claudeBin = 'claude', cwd = null, noTheme = false, doOpen = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--port' || a === '-p') port = Number(args[++i]);
    else if (a === '--host') host = args[++i];
    else if (a === '--driver') driver = args[++i];
    else if (a === '--resume') resume = args[++i];
    else if (a === '--no-fork') fork = false;
    else if (a === '--claude-bin') claudeBin = args[++i];
    else if (a === '--cwd') cwd = args[++i];
    else if (a === '--no-theme') noTheme = true;
    else if (a === '--open') doOpen = true;
    else if (a === '-h' || a === '--help') usage(0);
    else if (!specPath) specPath = a;
    else usage(2);
  }
  if (!specPath) usage(2);
  if (!['queue', 'claude'].includes(driver)) {
    console.error('✖ 不支持的 driver "' + driver + '"（可选：queue | claude）');
    process.exit(2);
  }
  let srv;
  try {
    srv = await startLiveServer({ specPath, port, host, driver, resume, fork, claudeBin, cwd, noTheme });
  } catch (e) {
    console.error('✖ 启动实时预览服务失败：' + e.message);
    process.exit(1);
  }
  console.log('✔ smyw 实时预览服务已启动');
  console.log('  预览地址: ' + srv.url);
  console.log('  驱动模式: ' + srv.driver + (driver === 'claude' && resume ? (' (resume ' + resume + (fork ? ', fork-session' : '') + ')') : ''));
  console.log('  会话文件: ' + srv.liveFile);
  if (driver === 'queue') {
    console.log('  接单命令: node ' + join(here, 'bridge.mjs') + ' wait ' + resolve(specPath) + ' --brief');
  }
  if (doOpen) openBrowser(srv.url);

  const onSig = async () => { await srv.close(); process.exit(0); };
  process.on('SIGINT', onSig);
  process.on('SIGTERM', onSig);
}
