// auth 服务：注册 / 登录 / 取 profile
// 职责：用户名密码校验 + 发 JWT + 存用户表
// 端口：3000
//
// 设计要点：
// - 用 Node 原生 http，不引 express。你想看清"一次 HTTP 请求到底长什么样"。
// - 用户表放内存 Map。真实系统换数据库，但接口不变。
// - 密码明文存只是为了看到完整流程，用 helper 包装，以后换哈希只改这一处。
import http from 'node:http';
import { signToken } from '../shared/jwt.js';

const PORT = Number(process.env.AUTH_PORT ?? 3000);
const HOST = process.env.AUTH_HOST ?? '0.0.0.0';

const users = new Map();

// 教学占位哈希——换成 crypto.scryptSync 或 bcrypt 只需改这里
function hashPassword(plain) { return 'plain:' + plain; }
function verifyPassword(plain, hash) { return hash === hashPassword(plain); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  // 接收上游传来的 trace-id（gateway 注入），用于跨服务日志关联
  const traceId = req.headers['x-trace-id'] || '(no-trace-id)';
  console.log(`[auth] ${traceId} ${req.method} ${url.pathname}`);
  try {
    // 分发：method + path
    if (req.method === 'POST' && url.pathname === '/register') return await handleRegister(req, res);
    if (req.method === 'POST' && url.pathname === '/login')    return await handleLogin(req, res);
    if (req.method === 'GET'  && url.pathname === '/me')       return await handleMe(url, res);
    return json(res, 404, { error: 'not found' });
  } catch (err) {
    console.error('[auth] handler error', err);
    return json(res, 500, { error: 'internal error', detail: err.message });
  }
});

async function handleRegister(req, res) {
  const { username, password } = await parseJson(req);
  if (!username || !password) return json(res, 400, { error: 'username and password required' });
  if (users.has(username))    return json(res, 409, { error: 'username already taken' });
  users.set(username, {
    username,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  });
  console.log(`[auth] registered: ${username}`);
  return json(res, 201, { ok: true, username });
}

async function handleLogin(req, res) {
  const { username, password } = await parseJson(req);
  const user = users.get(username);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return json(res, 401, { error: 'invalid credentials' });
  }
  // token 里只放最少必要信息：sub(用户名) + role
  // 不放 passwordHash、email 等敏感字段——这是 JWT 的"最小暴露原则"
  const token = await signToken({ sub: user.username, role: 'user' });
  console.log(`[auth] login: ${username} -> ${token.slice(0, 40)}...`);
  return json(res, 200, { token });
}

async function handleMe(url, res) {
  const username = url.searchParams.get('username');
  const user = users.get(username);
  if (!user) return json(res, 404, { error: 'user not found' });
  return json(res, 200, { username: user.username, createdAt: user.createdAt });
}

server.listen(PORT, HOST, () => {
  console.log(`[auth] listening on http://${HOST}:${PORT}`);
});

function parseJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('invalid json')); }
    });
  });
}

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}
