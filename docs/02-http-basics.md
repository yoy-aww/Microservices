# 02 · HTTP 与 REST 基础

> 把"一次 HTTP 请求"看透。看懂这个，就能看懂项目里 80% 的代码。

## 一次请求到底长什么样

打开浏览器开发者工具，或者跑：

```bash
curl -i http://localhost:3002/api/hello/public
```

`-i` 显示响应头。你会看到：

```
HTTP/1.1 200 OK
connection: keep-alive
content-type: application/json
date: Sat, 26 Sep 2026 01:30:58 GMT
keep-alive: timeout=5
transfer-encoding: chunked
x-trace-id: bc1ea9bb-7494-47c2-bcbd-d7434a9ae7a1
x-elapsed-ms: 8

{"message":"hello from public endpoint, no auth required"}
```

**三段结构**：

```
状态行（响应只有这一行）：  HTTP/1.1 200 OK
响应头（key: value）：      content-type, x-trace-id, ...
（空行）：                    分隔头与体
响应体：                     {"message": "..."}
```

## 状态行

`HTTP/1.1 200 OK` 拆成 3 部分：

| 部分 | 含义 | 例子 |
|------|------|------|
| `HTTP/1.1` | 协议版本 | 1.0 / 1.1 / 2 / 3 |
| `200` | 状态码 | 100-599 |
| `OK` | 状态文本 | OK / Not Found / ... |

## HTTP 状态码分类

| 范围 | 含义 | 常见码 |
|------|------|--------|
| 1xx | 信息性 | 100 Continue |
| 2xx | 成功 | 200 OK, 201 Created, 204 No Content |
| 3xx | 重定向 | 301 Moved, 302 Found, 304 Not Modified |
| 4xx | 客户端错误 | 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found |
| 5xx | 服务端错误 | 500 Internal Error, 502 Bad Gateway, 503 Service Unavailable |

**401 vs 403**（最容易混）：
- **401**：你是谁？没登录或 token 无效
- **403**：知道你是谁，但你没权限

项目里的例子：
- `/api/hello/protected` 不带 token → **401**（"我没登录"）
- `/api/hello/protected` 带错误 token → **401**（"你的登录凭证无效"）
- 如果以后加个 admin 端点，普通用户访问 → **403**（"登录了但没权限"）

## HTTP 方法

| 方法 | 作用 | 幂等？ | 项目里的例子 |
|------|------|--------|--------------|
| GET | 读取资源 | 是 | /me, /protected, /public |
| POST | 创建/提交 | 否 | /register, /login |
| PUT | 整体替换 | 是 | (未实现) |
| PATCH | 部分更新 | 否 | (未实现) |
| DELETE | 删除 | 是 | (未实现) |

**幂等**：同样的请求发 N 次，结果一样。GET 和 DELETE 幂等，POST 不幂等（发两次 = 注册两次）。

## 头部（Header）

头部是 key-value 对。项目里出现的：

| Header | 作用 | 哪个服务设的 |
|--------|------|--------------|
| `content-type` | 说明 body 的格式 | 客户端 |
| `authorization` | Bearer token | 客户端 |
| `x-trace-id` | 链路追踪 ID | gateway 注入 |
| `x-elapsed-ms` | 处理耗时 | gateway 加 |
| `connection` | keep-alive 配置 | 服务端 |
| `transfer-encoding` | 分块传输 | 服务端 |

**自定义头**约定用 `x-` 前缀（虽然 HTTP/2 后这个约定弱了，但还能用）。

## Bearer Token 头

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

- `Authorization` 是标准头
- `Bearer` 是认证方案（RFC 6750）
- 后面跟实际 token

**为什么是 `Bearer`？** 因为"任何人持有这个 token 都能冒充用户"——token 本身就是凭证。

`shared/jwt.js` 里的 `extractBearerToken`：

```js
export function extractBearerToken(header) {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}
```

## 请求体

POST 请求有 body。项目里的例子：

```bash
curl -X POST http://localhost:3002/api/auth/login \
  -H "content-type: application/json" \
  -d '{"username":"alice","password":"secret123"}'
```

- `-H "content-type: application/json"`：告诉服务端 body 是 JSON
- `-d '...'`：实际 body 内容

服务端在 `auth/index.js` 里解析：

```js
async function parseJson(req) {
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
```

**关键点**：HTTP 请求 body 是**流**（stream），需要按 chunk 累加。这就是为什么用 `req.on('data', ...)` 而不是一次性读。

## HTTP/1.1 vs HTTP/2 vs HTTP/3

| 版本 | 关键改进 | 适用场景 |
|------|----------|----------|
| 1.1 | keep-alive 复用连接 | 默认，所有环境 |
| 2 | 多路复用、头部压缩、服务端推送 | HTTPS 必需 |
| 3 | 基于 QUIC（UDP），抗丢包 | 移动网络、CDN |

**项目用的是 HTTP/1.1**（Node `http` 模块默认）。`curl` 输出第一行就是 `HTTP/1.1`。

## REST 是什么

**REST 不是协议，是架构风格**。核心理念：

1. **资源导向**：URL 表示"东西"（`/users/123`），不是"动作"（`/getUser?id=123`）
2. **方法无歧义**：GET 读、POST 写、DELETE 删
3. **无状态**：每个请求带完整信息，服务端不存会话（这就是 JWT 的哲学）
4. **统一接口**：所有资源用同一套方法

**项目里的 REST 实践**：

- ✅ `POST /register` 创建用户
- ✅ `GET /me?username=alice` 查询用户
- ❌ `GET /get-user?username=alice`（用 GET 表示动作，不 REST）
- ⚠️ `POST /login` 不是创建资源，是触发动作（争议中）

## 下一步

- JWT 怎么工作：[03-JWT深入](./03-jwt.md)
- 服务怎么互相调用：[04-服务间通信](./04-service-comms.md)
