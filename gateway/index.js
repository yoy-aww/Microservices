// gateway 服务：极简反向代理 + trace ID 注入
// 端口：3002
//
// 路由规则：客户端打 /api/{service}/{path}，gateway 转发到对应服务
//   /api/auth/register        -> http://localhost:3000/register
//   /api/auth/login           -> http://localhost:3000/login
//   /api/hello/protected      -> http://localhost:3001/protected
//   /api/hello/whoami         -> http://localhost:3001/whoami
//   /api/hello/public         -> http://localhost:3001/public
//   /api/auth/me?username=x   -> http://localhost:3000/me?username=x
//
// 这个 gateway 故意做得很薄：只做 trace ID 注入 + 反向代理。
// 它**不**做：
//   - JWT 验证（每个服务自己验，解耦）
//   - 限流 / 熔断 / 重试（生产必备，但这里为了教学故意不加，让你看到没它们的后果）
import http from 'node:http';
import crypto from 'node:crypto';
import { AUTH_URL, HELLO_URL } from '../shared/config.js';

const PORT = Number(process.env.GATEWAY_PORT ?? 3002);
const HOST = process.env.GATEWAY_HOST ?? '0.0.0.0';

// 服务名 -> 后端 URL
const SERVICES = {
  auth: AUTH_URL,
  hello: HELLO_URL,
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const traceId = req.headers['x-trace-id'] || crypto.randomUUID();

  // 解析 /api/{service}/{path...}
  const match = url.pathname.match(/^\/api\/([^\/]+)(\/.*)?$/);
  if (!match || !SERVICES[match[1]]) {
    return sendJson(res, 404, { error: 'unknown route', traceId });
  }

  const serviceName = match[1];
  const subPath = match[2] || '/';
  const target = new URL(subPath + url.search, SERVICES[serviceName]);

  console.log(`[gw] ${traceId} ${req.method} ${url.pathname} -> ${target.href}`);

  // 构造转发请求头：保留原头，但 host 必须换成目标
  const fwdHeaders = {
    ...req.headers,
    'x-trace-id': traceId,
    'content-type': req.headers['content-type'] || 'application/json',
    host: target.host,
  };

  // 收集请求体（GET/HEAD 没有 body）
  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await new Promise((resolve, reject) => {
      let buf = '';
      req.on('data', c => (buf += c));
      req.on('end', () => resolve(buf));
      req.on('error', reject);
    });
  }

  const startedAt = Date.now();
  try {
    const resp = await fetch(target, {
      method: req.method,
      headers: fwdHeaders,
      body,
    });
    const elapsed = Date.now() - startedAt;
    console.log(`[gw] ${traceId} <- ${resp.status} in ${elapsed}ms`);

    const respHeaders = Object.fromEntries(resp.headers.entries());
    res.writeHead(resp.status, {
      ...respHeaders,
      'x-trace-id': traceId,
      'x-elapsed-ms': String(elapsed),
    });
    const text = await resp.text();
    res.end(text);
  } catch (err) {
    console.error(`[gw] ${traceId} upstream error:`, err.message);
    return sendJson(res, 503, { error: 'upstream unreachable', detail: err.message, traceId });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[gateway] listening on http://${HOST}:${PORT}`);
  console.log(`[gateway] services: auth -> ${AUTH_URL}, hello -> ${HELLO_URL}`);
});

function sendJson(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}
