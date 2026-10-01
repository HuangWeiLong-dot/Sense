#!/usr/bin/env node
/**
 * Sense 本地 CORS 代理。
 *
 * 为什么需要它：TypeSafe / OpenAI / DeepSeek 这些 API 都不返回
 * Access-Control-Allow-Origin，浏览器会在发起请求前就把它拦掉，前端代码无法绕过。
 * 让请求从本机的一个进程发出（服务端到服务端没有 CORS），浏览器侧就只剩
 * 「网页 → 127.0.0.1」这一跳，是我们自己能加头的。
 *
 * 隐私：只监听 127.0.0.1，只转发到你配置的上游，不落盘、不记录。
 * 数据路径：浏览器 → 本机代理 → 你自己选的 API。没有任何第三方中间服务器。
 *
 * 用法：
 *   node tools/cors-proxy.mjs            仅代理（默认 http://127.0.0.1:8787）
 *   同时把 dist/ 一起serve            存在 dist/ 时自动开启，直接开浏览器访问即可
 *   环境变量：SENSE_PROXY_PORT / SENSE_PROXY_HOST
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';

const HOST = process.env.SENSE_PROXY_HOST ?? '127.0.0.1';
const PORT = Number(process.env.SENSE_PROXY_PORT ?? 8787);
const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const PREFIX = '/__proxy/';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** 只允许本机来源使用代理，避免变成任意网站可用的开放代理。 */
function originAllowed(origin) {
  if (!origin) return true; // curl / Node 等非浏览器客户端不带 Origin
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
}

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

/** /__proxy/api.typesafe.ai/v1/systemone → https://api.typesafe.ai/v1/systemone */
function resolveTarget(pathname, search) {
  const rest = pathname.slice(PREFIX.length);
  if (!/^[a-z0-9.-]+(:\d+)?\/.+/i.test(rest)) return null;
  const scheme = /^(localhost|127\.0\.0\.1)(:\d+)?\//i.test(rest) ? 'http' : 'https';
  return `${scheme}://${rest}${search}`;
}

/** 首次连接偶尔会撞上 IPv6/IPv4 竞速导致的 CONNECT_TIMEOUT，重试一次即可稳定。 */
async function fetchUpstream(target, init, attempts = 2) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fetch(target, init);
    } catch (err) {
      lastError = err;
      const retryable = err?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT';
      if (!retryable || i === attempts - 1) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw lastError;
}

async function forward(req, res) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const origin = req.headers.origin;

  if (!originAllowed(origin)) {
    send(res, 403, { ...corsHeaders(null), 'content-type': 'application/json' },
      JSON.stringify({ error: '该来源不被允许。本地代理默认只服务 localhost。' }));
    return;
  }

  if (req.method === 'OPTIONS') {
    send(res, 204, corsHeaders(origin), '');
    return;
  }

  const target = resolveTarget(url.pathname, url.search);
  if (!target) {
    send(res, 400, { ...corsHeaders(origin), 'content-type': 'application/json' },
      JSON.stringify({ error: `用法：POST ${PREFIX}<host>/<path>，例如 ${PREFIX}api.typesafe.ai/v1/systemone` }));
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  const headers = { 'content-type': req.headers['content-type'] ?? 'application/json' };
  if (req.headers.authorization) headers.authorization = req.headers.authorization;

  try {
    const upstream = await fetchUpstream(target, { method: req.method, headers, body });
    const text = await upstream.text();
    process.stdout.write(
      `${req.method} ${url.pathname} → ${upstream.status} ${upstream.statusText || ''}\n`,
    );
    send(
      res,
      upstream.status,
      {
        ...corsHeaders(origin),
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
      },
      text,
    );
  } catch (err) {
    const cause = err?.cause ? ` [${err.cause.code ?? err.cause.message}]` : '';
    process.stderr.write(`转发失败 ${target}: ${err.message}${cause}\n`);
    send(res, 502, { ...corsHeaders(origin), 'content-type': 'application/json' },
      JSON.stringify({ error: `无法连接上游 ${target}：${err.message}${cause}` }));
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, rel);

  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, 'index.html');
    await readFile(file);
  } catch {
    file = join(DIST, 'index.html'); // SPA 回退
  }

  try {
    const data = await readFile(file);
    send(res, 200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }, data);
  } catch {
    send(res, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'Not found');
  }
}

const hasDist = await stat(DIST).then((s) => s.isDirectory()).catch(() => false);

createServer((req, res) => {
  const pathname = new URL(req.url, `http://${HOST}:${PORT}`).pathname;
  if (pathname.startsWith(PREFIX)) {
    void forward(req, res);
    return;
  }
  if (hasDist && req.method === 'GET') {
    void serveStatic(req, res);
    return;
  }
  send(res, 404, { 'content-type': 'application/json' },
    JSON.stringify({ error: '未知路径', hint: `代理前缀是 ${PREFIX}` }));
}).listen(PORT, HOST, () => {
  console.log(`Sense 本地 CORS 代理已启动 → http://${HOST}:${PORT}`);
  console.log(`  代理前缀：${PREFIX}<host>/<path>`);
  console.log(`  例：http://${HOST}:${PORT}${PREFIX}api.typesafe.ai/v1/systemone`);
  if (hasDist) console.log(`  同时托管 dist/：直接用浏览器打开 http://${HOST}:${PORT} 即可（同源，无需 CORS）`);
  else console.log('  未找到 dist/，只提供代理。先 npm run build 就能一起托管前端。');
  console.log('  只监听本机回环地址；不记录、不落盘任何请求内容。');
});
