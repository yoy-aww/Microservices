# Microservices Learning Lab

用最小代码搭一个微服务系统，专门用来踩坑。

## 三个服务

| 服务 | 端口 | 职责 |
|------|------|------|
| auth | 3000 | 用户注册 / 登录 / 发 JWT |
| hello | 3001 | 受保护端点，演示服务间调用 |
| gateway | 3002 | 反向代理 + trace ID 注入 |

## 启动

```bash
# 一次性装依赖
npm install

# 启动 3 个服务（按 Ctrl+C 全停）
bash scripts/start-all.sh
```

打开另一个终端，跑演示：

```bash
bash scripts/demo.sh
```

## 目录结构

```
Microservices/
├── auth/index.js          # 用户注册 / 登录 / 发 JWT
├── hello/index.js         # 受保护端点 + 服务间调用
├── gateway/index.js       # 反向代理 + trace ID
├── shared/
│   ├── config.js          # 共享端点配置 + JWT 密钥
│   └── jwt.js             # JWT 签发/验证（jose 库）
├── scripts/
│   ├── start-all.sh       # 启动所有服务
│   └── demo.sh            # 端到端演示
└── package.json
```

## 可以主动尝试的"坑"

代码里故意留了几个"教学钩子"，对应微服务的核心概念：

### 1. 故障隔离
杀掉 auth 进程（在它的终端按 Ctrl+C），再调：

```bash
curl http://localhost:3002/api/hello/whoami -H "Authorization: Bearer <token>"
```

`/whoami` 会立刻 503，因为 hello 反查 auth 失败。
**没有降级、没有熔断、没有重试**——这是微服务最经典的坑。

### 2. 慢下游
```bash
curl http://localhost:3002/api/hello/stress
```

hello 故意 sleep 2 秒。同时发 10 个请求看 gateway 的延迟。
**没有超时控制**——上游会被下游拖死。

### 3. 链路追踪
demo.sh 第 8 步会打印一个 trace-id。去三个服务的终端里 grep 这个 ID：

```
[gw]    467b96ad-... GET /api/hello/whoami -> http://localhost:3001/whoami
[hello] 467b96ad-... GET /whoami
[auth]  467b96ad-... GET /me
```

**同一个 trace-id 串起整条链**——这就是 OpenTelemetry 的最小模型。

### 4. JWT 最小暴露
看 auth 里 signToken 的 payload：只放 `sub` 和 `role`。
**不放 passwordHash、email**——JWT 会被到处传，必须最小化。

### 5. 密钥泄漏
`shared/config.js` 里 `JWT_SECRET` 是硬编码的。
**任何拿到这个文件的人都能伪造 token**。
真实系统：每个服务有自己的验签公钥，签发方只发私钥。

### 6. 路由耦合
改 gateway 里 SERVICES 表加一个服务，**不需要改 auth/hello 一行代码**。
但每个服务的 `/login`、`/protected` 路径都写死了——**API 契约**靠代码约定，没有 schema registry。

## 下一步可以做的事

按学习深度递进：

1. **加熔断器**：hello 反查 auth 失败超过 N 次后短路一段时间（学 resilience）
2. **加 OpenTelemetry**：trace-id 升级为完整的 span 树（学可观测性）
3. **加 API Gateway 的限流**：单 IP 每秒最多 N 个请求（学流量治理）
4. **加 Docker**：每个服务一个容器，docker compose 一键起（学容器化）
5. **加数据库**：auth 的用户表换成 SQLite/Postgres（学服务自治数据）
6. **加事件驱动**：用户注册发 event 到消息队列，其他服务订阅（学最终一致性）
