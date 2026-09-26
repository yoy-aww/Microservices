# 03 · JWT 深入

> 看懂 token 是怎么工作的。JWT 是微服务里"无状态认证"的核心。

## JWT 长什么样

登录拿到的 token 长这样：

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbGljZSIsInJvbGUiOiJ1c2VyIiwiaWF0IjoxNzkwMzg2MjU4LCJleHAiOjE3OTAzOTM0NTh9.x7yKp...
```

**三段结构，用 `.` 分隔**：

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 . eyJzdWIiOiJhbGljZSIsInJvbGUiOiJ1c2VyIiwiaWF0IjoxNzkwMzg2MjU4LCJleHAiOjE3OTAzOTM0NTh9 . x7yKp...
└──────── header ────────┘ └───────────── payload ──────────────┘ └── signature ──┘
```

**每段都是 Base64URL 编码的 JSON**（最后一段是签名）。

## 解码 header 和 payload

header（解码后）：

```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

- `alg`：签名算法，HS256 = HMAC-SHA256
- `typ`：类型，固定 "JWT"

payload（解码后）：

```json
{
  "sub": "alice",
  "role": "user",
  "iat": 1790386258,
  "exp": 1790393458
}
```

| 字段 | 含义 | 值 |
|------|------|-----|
| `sub` | 主体（一般是用户名） | "alice" |
| `role` | 角色 | "user" |
| `iat` | 签发时间（Unix 秒） | 2026-09-26 |
| `exp` | 过期时间（Unix 秒） | 2026-09-26 + 2h |

## 签名怎么生成

HS256 是**对称签名**：用同一个密钥签，也用同一个密钥验。

```js
import { SignJWT } from 'jose';
import { JWT_SECRET } from './config.js';

export async function signToken(payload, { expiresIn = '2h' } = {}) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })   // header
    .setIssuedAt()                            // iat
    .setExpirationTime(expiresIn)             // exp
    .sign(JWT_SECRET);                        // 签名
}
```

**签名步骤**（简化）：

```
1. base64Url(header) + "." + base64Url(payload)  -> "abc.def"
2. HMAC-SHA256("abc.def", secret)               -> 原始签名
3. base64Url(签名)                              -> "ghi"
4. 最终 token = "abc.def.ghi"
```

## 验证怎么工作

```js
export async function verifyToken(token) {
  const { payload } = await jwtVerify(token, JWT_SECRET);
  return payload;
}
```

**验证步骤**：

1. 拆成 3 段，base64 解码 header 和 payload
2. 用同一个密钥重算签名
3. 对比重算的签名和 token 里最后一段
4. 检查 `exp` 是否过期

**任何一步失败都抛异常**，调用方 `try/catch` 处理。

## 三种认证方案对比

### 方案 A：Session Cookie（有状态）

```
客户端 -> 服务端: POST /login
服务端: 存 session 到内存/Redis，返回 Set-Cookie: sid=xxx
客户端: 之后每个请求带 Cookie: sid=xxx
服务端: 查 Redis 里的 session
```

**优点**：服务端能立即吊销
**缺点**：需要共享 session 存储，多副本部署麻烦

### 方案 B：JWT（无状态）

```
客户端 -> 服务端: POST /login
服务端: 签 JWT，返回 token
客户端: 之后每个请求带 Authorization: Bearer <token>
服务端: 用共享密钥验 JWT，不用查数据库
```

**优点**：无状态，服务随便扩
**缺点**：无法立即吊销，密钥泄漏就完蛋

### 方案 C：OAuth 2.0 / OIDC

```
客户端 -> 授权服务器: POST /authorize
授权服务器 -> 客户端: 返回 authorization code
客户端 -> 授权服务器: POST /token?code=xxx
授权服务器 -> 客户端: 返回 access_token (JWT 或 opaque)
```

**优点**：跨域、第三方登录
**缺点**：复杂

**本项目用方案 B**（HS256 对称 JWT）。生产系统一般用方案 C 或 B 的变体（RS256 公私钥）。

## 密钥管理：教学 vs 生产

### 教学（本项目）

```js
// shared/config.js
export const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'dev-only-secret-change-me'
);
```

**故意这样写的理由**：
- 让所有服务都能拿到同一个密钥
- 演示"密钥泄漏 = 任何人能伪造 token"

**真实风险**：
- 密钥在代码里 = 任何拿到代码的人（包括 fork 的、CI 日志泄漏的）都能伪造 token
- 用同一个密钥签和验 = 任何一个服务被攻陷 = 所有服务都能伪造身份

### 生产（推荐做法）

```
┌─────────────┐         ┌──────────────────┐
│   auth 服务  │         │  其他所有服务      │
│             │         │                  │
│ 私钥 (sign) │ ──签──> │  公钥 (verify)   │
│             │         │                  │
└─────────────┘         └──────────────────┘
```

- auth 用 **私钥**签 token（只有它有）
- 其他服务用 **公钥**验 token（可以发给所有人）
- 算法换成 RS256 或 ES256
- 密钥存 **KMS / Vault / 环境变量**，绝不进代码

## JWT 的"最小暴露原则"

`auth/index.js` 里签发 token：

```js
const token = await signToken({ sub: user.username, role: 'user' });
```

**只放 2 个字段**：`sub` 和 `role`。

**故意不放**：
- `passwordHash`：放 token 里 = 任何拿到 token 的人都能拿到哈希
- `email`：用户可能改邮箱，token 里过期了
- `createdAt`：每次查数据库就行，没必要放 token

**原则**：JWT 会被到处传（前端、网关、日志），**只放绝对不能泄漏的字段**。

## JWT 的常见坑

### 1. 把敏感信息放 payload

payload 是 **base64 编码，不是加密**。任何人都能解码看内容。

```bash
# 解码 token 的 payload
echo "eyJzdWIiOiJhbGljZSI..." | base64 -d
```

所以 payload 里**只能放"本来就知道的"信息**（用户名、角色）。

### 2. 不验证 exp

过期 token 还能用 = 永久凭证。

```js
// ❌ 错误
const payload = JSON.parse(base64Decode(token.split('.')[1]));

// ✅ 正确
const payload = await verifyToken(token);  // 自动验 exp
```

### 3. 用 HS256 在生产

对称密钥泄漏 = 全线崩溃。生产用 RS256/ES256 公私钥对。

### 4. 没考虑密钥轮换

密钥要定期换。生产方案：
- 用 kid（key id）标识哪个密钥签的
- 验签时按 kid 找对应的公钥
- 旧密钥保留一段时间，让旧 token 慢慢过期

### 5. 不吊销 token

JWT 一旦签发，无法"撤销"——只能等过期。

应对：
- 设置短过期时间（15 分钟）
- 用 refresh token 续期
- 紧急吊销时更新密钥（所有旧 token 作废）

## 本项目里的 JWT 流转

```
1. 客户端 -> auth: POST /login {username, password}
2. auth: 验密码，签 JWT
   payload = { sub: "alice", role: "user", iat, exp }
   signature = HMAC-SHA256(header.payload, secret)
3. auth -> 客户端: { token: "xxx" }

4. 客户端 -> gateway -> hello: GET /protected, Authorization: Bearer xxx
5. hello: 用共享密钥验 JWT
   - 拆 3 段
   - 重算签名
   - 对比
   - 验 exp
6. hello -> 客户端: { message: "hello, alice" }
```

**关键**：hello **不需要**问 auth 服务，自己就能验。这就是 JWT 无状态的好处。

## 下一步

- 服务间怎么互相调用：[04-服务间通信](./04-service-comms.md)
- JWT 无状态带来的故障隔离问题：[05-故障隔离与弹性](./05-resilience.md)
