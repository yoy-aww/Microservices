# 01 · 项目导览

> 看懂三个服务在干什么，以及它们怎么协作。

## 整体架构图

```
                ┌─────────────────────────────┐
                │     客户端 (curl / 浏览器)   │
                └──────────────┬──────────────┘
                               │ HTTP
                               ▼
                ┌─────────────────────────────┐
                │   gateway :3002             │
                │   - 反向代理                 │
                │   - 注入 x-trace-id          │
                └──────────┬──────────────────┘
                           │ /api/auth/*
                           │ /api/hello/*
              ┌────────────┴─────────────────┐
              │                              │
              ▼                              ▼
   ┌──────────────────┐          ┌──────────────────┐
   │  auth :3000      │          │  hello :3001     │
   │  - /register     │          │  - /public       │
   │  - /login        │◄─────────│  - /protected    │
   │  - /me           │  /whoami │  - /whoami       │
   └──────────────────┘  反查    │  - /stress       │
                                └──────────────────┘
```

## 三个服务各自的职责

### auth 服务（认证中心）

**做什么**：管理用户、发 JWT。

**端点**：

| 方法 | 路径 | 作用 |
|------|------|------|
| POST | /register | 注册新用户 |
| POST | /login | 校验密码，返回 JWT |
| GET | /me?username=x | 查询用户信息 |

**不做**：
- 不验证别人的请求（这是各服务自己的事）
- 不做限流（gateway 也没做）
- 不持久化（用户表在内存 Map，重启就丢）

### hello 服务（受保护的业务服务）

**做什么**：演示"被保护的服务"长什么样。

**端点**：

| 方法 | 路径 | 作用 | 需要 token？ |
|------|------|------|--------------|
| GET | /public | 公开端点 | 否 |
| GET | /protected | 返回 `hello, <用户名>` | 是 |
| GET | /whoami | 反查 auth 拿用户信息 | 是 |
| GET | /stress | 故意慢 2 秒 | 否 |

**关键差异**：
- `/protected` 只验证 JWT，**不**问 auth 服务（JWT 无状态）
- `/whoami` 验证 JWT 后，**反查** auth 拿用户表（依赖 auth）

### gateway 服务（统一入口）

**做什么**：路由 + trace-id 注入。

**路由规则**：

```
/api/auth/*    -> http://localhost:3000/*
/api/hello/*   -> http://localhost:3001/*
```

比如：
- `/api/hello/protected` → `http://localhost:3001/protected`（剥掉 `/api/hello`）
- `/api/auth/login` → `http://localhost:3000/login`

**关键**：客户端只跟 gateway 打交道，不直接知道 auth 和 hello 的存在。

## 一次完整的调用流程

演示 alice 登录并访问 `/protected`：

```
1. 客户端 -> gateway POST /api/auth/register
2. gateway -> auth POST /register (带 trace-id)
3. auth 存用户到内存，返回 {ok: true}
4. gateway -> 客户端 201 {ok: true}

5. 客户端 -> gateway POST /api/auth/login
6. gateway -> auth POST /login (带 trace-id)
7. auth 校验密码，签发 JWT，返回 {token: "xxx"}
8. gateway -> 客户端 200 {token: "xxx"}

9. 客户端 -> gateway GET /api/hello/protected (带 Bearer xxx)
10. gateway -> hello GET /protected (带 Bearer xxx, trace-id)
11. hello 用共享密钥自验 JWT，通过
12. hello -> 客户端 200 {message: "hello, alice"}
```

**关键观察**：
- 第 11 步 hello 自己验 JWT，**没有**问 auth 服务
- 所以如果 auth 挂了，第 12 步还能成功（JWT 无状态的好处）
- 但如果 alice 改密码了，旧 JWT 还能用，直到过期（JWT 无状态的代价）

## 共享模块

`shared/` 目录下的代码被 3 个服务共用：

### shared/config.js

```js
export const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:3000';
export const HELLO_URL = process.env.HELLO_URL ?? 'http://localhost:3001';
export const JWT_SECRET = new TextEncoder().encode('dev-only-secret-change-me');
```

- 服务间的 URL 配置（改环境变量就能换地址）
- JWT 密钥（**教学用**，故意明文——生产该用 KMS 或 Vault）

### shared/jwt.js

```js
import { SignJWT, jwtVerify } from 'jose';
import { JWT_SECRET } from './config.js';

export async function signToken(payload, opts) { ... }
export async function verifyToken(token) { ... }
export function extractBearerToken(header) { ... }
```

3 个函数：
- `signToken`：只 auth 用，签发 token
- `verifyToken`：所有需要验证的服务用（hello 就调它）
- `extractBearerToken`：从 `Authorization: Bearer xxx` 头里抠 token

## 文件清单

```
auth/index.js          90 行  认证服务
hello/index.js        117 行  业务服务
gateway/index.js       96 行  反向代理
shared/config.js       10 行  共享配置
shared/jwt.js          24 行  JWT 工具
scripts/start-all.sh   38 行  启动脚本
scripts/demo.sh        75 行  演示脚本
README.md             100 行  项目说明
```

**总计约 550 行**，够短能一眼看完，又够长能踩到微服务的核心坑。

## 设计哲学

为什么这样设计？三个原则：

1. **薄抽象**：不引框架（不用 express、不用 fastify），用 Node 原生 `http`。你想看清 HTTP 是什么样。
2. **故意不优雅**：密钥硬编码、无降级、无重试、内存用户表。每个都是"生产不能这么写"的反例。
3. **每个端点对应一个微服务概念**：
   - `/register` `/login`：认证与授权
   - `/protected`：无状态验证
   - `/whoami`：服务间调用 + 故障隔离
   - `/stress`：慢下游
   - trace-id：可观测性

## 下一步

- 想看请求/响应细节：[02-HTTP与REST基础](./02-http-basics.md)
- 想看 JWT 怎么工作：[03-JWT深入](./03-jwt.md)
- 想看服务间调用：[04-服务间通信](./04-service-comms.md)
