// hello 服务：第一个"被保护"的服务，需要 auth 签发的 JWT
// 职责：演示 JWT 验证 + 服务间调用 + 故障隔离
// 端口：3001
//
// 关键端点：
//   GET  /public    - 谁都能访问（演示"为什么需要 auth"）
//   GET  /protected - 必须带 Authorization: Bearer xxx（演示"服务间信任"）
//   GET  /whoami    - 验证 token 后反查 auth 拿用户信息（演示"服务间调用"）
//   GET  /stress    - 故意慢，让你看到"依赖故障会拖垮消费者"
import http from 'node:http';
import { verifyToken, extractBearerToken } from '../shared/jwt.js';
import { AUTH_URL } from '../shared/config.js';

const PORT = Number(process.env.HELLO_PORT ?? 3001);
const HOST = process.env.HELLO_HOST ?? '0.0.0.0';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  // 接收上游传来的 trace-id（gateway 注入），用于跨服务日志关联
  const traceId = req.headers['x-trace-id'] || '(no-trace-id)';
  console.log(`[hello] ${traceId} ${req.method} ${url.pathname}`);
  try {
    if (req.method === 'GET' && url.pathname === '/public')   return await handlePublic(res);
    if (req.method === 'GET' && url.pathname === '/protected') return await handleProtected(req, res);
    if (req.method === 'GET' && url.pathname === '/whoami')   return await handleWhoami(req, res, traceId);
    if (req.method === 'GET' && url.pathname === '/stress')   return await handleStress(res);
    return json(res, 404, { error: 'not found' });
  } catch (err) {
    console.error('[hello] handler error', err);
    return json(res, 500, { error: 'internal error', detail: err.message });
  }
});

// 公开端点：演示"没有 auth 的服务是什么感觉"——谁都能读
async function handlePublic(res) {
  return json(res, 200, { message: 'hello from public endpoint, no auth required' });
}

// 受保护端点：必须带合法 JWT
// 这是微服务里最常见的"服务间信任"模式：
//   客户端 -> [带 token] -> hello 服务
//   hello 服务：自己验 token，不用问 auth 服务
//   这比"每个请求都问 auth 服务"快得多，也解耦得多
async function handleProtected(req, res) {
  const token = extractBearerToken(req.headers['authorization']);
  if (!token) {
    return json(res, 401, { error: 'missing token' });
  }
  try {
    const payload = await verifyToken(token);
    return json(res, 200, {
      message: `hello, ${payload.sub}`,
      payload,
    });
  } catch (err) {
    console.warn(`[hello] invalid token: ${err.message}`);
    return json(res, 401, { error: 'invalid or expired token' });
  }
}

// 服务间调用：hello 服务收到请求后，反向调用 auth 服务拿用户信息
// 这是微服务里**最危险**的模式——引入了网络依赖
// 一旦 auth 挂了，hello 也跟着挂（演示故障隔离）
async function handleWhoami(req, res, traceId) {
  const token = extractBearerToken(req.headers['authorization']);
  if (!token) return json(res, 401, { error: 'missing token' });

  let payload;
  try {
    payload = await verifyToken(token);
  } catch {
    return json(res, 401, { error: 'invalid or expired token' });
  }

  // ⚠️ 关键：下面这行会让 hello 依赖 auth
  // 试试在另一个终端杀掉 auth 进程，再调 /whoami，看 hello 会怎样
  try {
    // 转发 trace-id 给下游服务，这样整条调用链能被串起来
    // 这是分布式追踪的核心：每个服务都必须透传 trace 上下文
    const resp = await fetch(
      `${AUTH_URL}/me?username=${encodeURIComponent(payload.sub)}`,
      { headers: { 'x-trace-id': traceId } }
    );
    if (!resp.ok) {
      return json(res, 502, { error: 'auth service returned error', status: resp.status });
    }
    const profile = await resp.json();
    return json(res, 200, {
      message: `whoami: ${profile.username} (fetched from auth service)`,
      profile,
    });
  } catch (err) {
    // auth 挂了：这里**没有**降级、**没有**熔断、**没有**重试
    // 这是刻意为之——让你看到"不处理依赖故障"的真实后果
    console.error('[hello] auth service unreachable:', err.message);
    return json(res, 503, {
      error: 'auth service unavailable',
      detail: err.message,
    });
  }
}

// 故意慢：模拟"下游慢"如何拖垮上游
// 你可以同时发 10 个请求，看 hello 进程的内存/CPU 怎么变化
async function handleStress(res) {
  await new Promise(r => setTimeout(r, 2000));
  return json(res, 200, { message: 'hello, that took 2s on purpose' });
}

server.listen(PORT, HOST, () => {
  console.log(`[hello] listening on http://${HOST}:${PORT}`);
});

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}
