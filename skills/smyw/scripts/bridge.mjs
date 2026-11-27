#!/usr/bin/env node
// smyw bridge CLI: lets the main AI conversation (lightweight doorbell) or a one-shot Preview Subagent
// interact with a running serve.mjs instance.
// Uses node:http with timeout=0 so long-poll wait never hits undici's 5-minute fetch headersTimeout.
// Commands:
//   node bridge.mjs wait   <spec.json|dir> [--brief] [--timeout 0]
//   node bridge.mjs status <spec.json|dir> "<progress text>" [--delta "<stream text>"]
//   node bridge.mjs reply  <spec.json|dir> --text "<reply>" [--file <md>] [--stdin] [--no-reload]
//   node bridge.mjs info   <spec.json|dir>
//   node bridge.mjs stop   <spec.json|dir>
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

function usage(code) {
  console.log([
    '用法:',
    '  node bridge.mjs wait   <spec.json|dir> [--brief] [--timeout 0]',
    '  node bridge.mjs status <spec.json|dir> "<进度说明>" [--delta "<流式增量>"]',
    '  node bridge.mjs reply  <spec.json|dir> --text "<回复内容>" [--file <reply.md>] [--stdin] [--no-reload]',
    '  node bridge.mjs info   <spec.json|dir>',
    '  node bridge.mjs stop   <spec.json|dir>',
    '',
    '说明:',
    '  --brief          wait 只输出极简指针 JSON（reqFile/logFile/preview），极大降低主 Agent token 消耗',
    '  --timeout <sec>  wait 超时秒数，默认 0（无限静默等待，零轮询，直到收到消息或服务关闭）',
    '  --url / --token  可选覆盖自动读取的同目录 .live.json'
  ].join('\n'));
  process.exit(code);
}

function fail(msg, code = 1) {
  console.error('✖ ' + msg);
  process.exit(code);
}

function resolveSession(targetPath, urlOpt, tokenOpt) {
  if (urlOpt && tokenOpt) {
    return { url: urlOpt.replace(/\/$/, ''), token: tokenOpt };
  }
  if (!targetPath) fail('缺少 <spec.json|dir> 路径参数。', 2);
  const abs = resolve(targetPath);
  let liveFile = abs;
  if (existsSync(abs) && statSync(abs).isDirectory()) {
    liveFile = join(abs, '.live.json');
  } else if (!abs.endsWith('.live.json')) {
    liveFile = join(dirname(abs), '.live.json');
  }
  if (!existsSync(liveFile)) {
    fail('找不到运行中的实时预览会话文件：' + liveFile + '（请先运行 serve.mjs 启动预览服务）');
  }
  let info;
  try { info = JSON.parse(readFileSync(liveFile, 'utf8')); }
  catch (e) { fail('无法解析会话文件 ' + liveFile + '：' + e.message); }
  const url = (urlOpt || info.url || '').replace(/\/$/, '');
  const token = tokenOpt || info.token;
  if (!url || !token) fail('会话文件缺少 url 或 token：' + liveFile);
  return { url, token, info, liveFile };
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

// Native node:http request with timeout=0 (avoids undici fetch's 5-minute headersTimeout during indefinite waits)
function api(session, method, path, body) {
  return new Promise((resolveApi) => {
    const u = new URL(session.url + path);
    const reqFn = u.protocol === 'https:' ? httpsRequest : httpRequest;
    const headers = { 'X-SMYW-Token': session.token };
    let payload = null;
    if (body !== undefined) {
      payload = Buffer.from(JSON.stringify(body), 'utf8');
      headers['Content-Type'] = 'application/json; charset=utf-8';
      headers['Content-Length'] = String(payload.length);
    }
    const req = reqFn({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method,
      headers,
      timeout: 0
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const txt = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = JSON.parse(txt); } catch { json = { raw: txt }; }
        if ((res.statusCode || 500) < 200 || (res.statusCode || 500) >= 300) {
          fail('接口 ' + path + ' 返回 ' + res.statusCode + '：' + (json.error || txt));
        }
        resolveApi(json);
      });
    });
    req.setTimeout(0);
    req.on('error', (e) => fail('无法连接实时预览服务 ' + session.url + '：' + e.message));
    if (payload) req.write(payload);
    req.end();
  });
}

const args = process.argv.slice(2);
if (!args.length || args[0] === '-h' || args[0] === '--help') usage(0);
const cmd = args[0];

let urlOpt = null, tokenOpt = null, timeout = 0, brief = false, textOpt = null, fileOpt = null, deltaOpt = null, useStdin = false, noReload = false;
const pos = [];
for (let i = 1; i < args.length; i++) {
  const a = args[i];
  if (a === '--url') urlOpt = args[++i];
  else if (a === '--token') tokenOpt = args[++i];
  else if (a === '--timeout' || a === '-t') timeout = Number(args[++i]);
  else if (a === '--brief' || a === '-b') brief = true;
  else if (a === '--text' || a === '-m') textOpt = args[++i];
  else if (a === '--file' || a === '-f') fileOpt = args[++i];
  else if (a === '--delta') deltaOpt = args[++i];
  else if (a === '--stdin') useStdin = true;
  else if (a === '--no-reload') noReload = true;
  else if (a === '-h' || a === '--help') usage(0);
  else pos.push(a);
}

const target = pos[0];

if (cmd === 'info') {
  const session = resolveSession(target, urlOpt, tokenOpt);
  const st = await api(session, 'GET', '/api/state');
  console.log(JSON.stringify({ url: session.url + '/', liveFile: session.liveFile, state: st.state, messageCount: (st.messages || []).length }, null, 2));
} else if (cmd === 'wait') {
  const session = resolveSession(target, urlOpt, tokenOpt);
  const sec = Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : 0;
  const qs = '?timeout=' + sec + (brief ? '&brief=1' : '');
  const data = await api(session, 'GET', '/api/bridge/wait' + qs);
  console.log(brief ? JSON.stringify(data) : JSON.stringify(data, null, 2));
} else if (cmd === 'status') {
  const session = resolveSession(target, urlOpt, tokenOpt);
  const statusText = textOpt != null ? textOpt : (pos[1] || '');
  if (!statusText && !deltaOpt) fail('status 需要提供进度文字或 --delta 参数。', 2);
  const data = await api(session, 'POST', '/api/bridge/status', { text: statusText || undefined, delta: deltaOpt || undefined });
  console.log(JSON.stringify(data));
} else if (cmd === 'reply') {
  const session = resolveSession(target, urlOpt, tokenOpt);
  let replyText = textOpt;
  if (fileOpt) replyText = readFileSync(resolve(fileOpt), 'utf8');
  else if (useStdin) replyText = await readStdin();
  else if (replyText == null && pos[1]) replyText = pos[1];
  const data = await api(session, 'POST', '/api/bridge/reply', { text: replyText || '', reload: !noReload });
  console.log(JSON.stringify(data, null, 2));
} else if (cmd === 'stop') {
  const session = resolveSession(target, urlOpt, tokenOpt);
  await api(session, 'POST', '/api/bridge/stop', {});
  console.log('✔ 已停止实时预览服务：' + session.url);
} else {
  fail('未知子命令 "' + cmd + '"（支持：wait | status | reply | info | stop）', 2);
}
