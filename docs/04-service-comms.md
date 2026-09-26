# 04 · 服务间通信

> 微服务的核心。服务之间怎么协作，有几种方式，各自 trade-off 是什么。

## 两种基本模式

### 同步调用（Request-Response）

```
A 服务 -> B 服务: 请求
A 服务 <- B 服务: 响应
A 服务: 处理响应
```

**特点**：
- A 必须等 B 返回才能继续
- A 挂了/慢了，B 也跟着卡
- 强耦合

**协议**：HTTP REST、gRPC、Thrift

### 异步消息（Event）

```
A 服务 -> 消息队列: 发事件
消息队列 -> B 服务: 推送事件
B 服务: 处理事件（异步，不保证立刻）
```

**特点**：
- A 不关心 B 什么时候处理
- B 挂了 A 不受影响
- 弱耦合

**协议**：消息队列（Kafka、RabbitMQ、SQS）

## 同步 vs 异步：什么时候用哪个

| 场景 | 推荐 | 理由 |
|------|------|------|
| 用户登录拿 token | 同步 | 需要立即结果 |
| 查订单详情 | 同步 | 实时数据 |
| 用户注册后发邮件 | 异步 | 失败可以重试 |
| 支付成功通知商户 | 异步 | 商户可能挂 |
| 搜索索引更新 | 异步 | 几秒延迟可接受 |
| 购物车结账 | 同步 + 异步混合 | 下单同步，发货异步 |

**经验法则**：
- 需要"立刻看到结果"→ 同步
- 需要"最终做对就行"→ 异步

## 项目里的同步调用

`hello/index.js` 的 `/whoami`：

```js
const resp = await fetch(
  `${AUTH_URL}/me?username=${encodeURIComponent(payload.sub)}`,
  { headers: { 'x-trace-id': traceId } }
);
const profile = await resp.json();
```

**这是同步调用**：
- hello 等 auth 返回
- auth 挂了，hello 跟着挂
- 这就是 [05-故障隔离](./05-resilience.md) 要解决的问题

## 同步协议的对比

### HTTP REST

**例子**：`POST /login`

```
HTTP/1.1 POST /login HTTP/1.1
Host: auth:3000
Content-Type: application/json

{"username":"alice","password":"xxx"}
```

**优点**：
- 人类可读（curl 就能调）
- 工具生态丰富
- 跨语言

**缺点**：
- 文本协议，带宽占用大
- 客户端要自己拼 JSON
- 没有强类型

### gRPC

**例子**（用 .proto 定义）：

```proto
service Auth {
  rpc Login(LoginRequest) returns (LoginResponse);
}
```

**优点**：
- 二进制协议，快
- 强类型（proto 编译）
- 服务端推送、流式

**缺点**：
- 调试难（curl 调不了）
- 工具生态不如 REST
- 跨语言要装 SDK

### 怎么选

- 对外 API / 浏览器调用 → **REST**
- 内部服务间高频调用 → **gRPC**
- 跨语言、强类型要求 → **gRPC**
- 简单快速开发 → **REST**

## 项目里为什么用 REST

- 用 Node 原生 `http` 模块就能写，不引第三方库
- curl 就能调试，方便教学
- 你刚接触微服务，REST 心智负担低

## 服务间调用 vs 共享代码

这是个**核心架构选择**。看两种方案：

### 方案 A：服务间调用（本项目）

```
┌────────┐      ┌────────┐
│  A 服务 │ ──>  │  B 服务 │
└────────┘ HTTP └────────┘
```

**优点**：
- 各服务独立部署、独立扩展
- B 挂了不影响 A 部署
- 可以独立选择技术栈

**缺点**：
- 网络开销
- 强耦合（A 改 B 接口要改）
- 故障传播

### 方案 B：共享代码（npm 包 / monorepo）

```
┌────────────────────────────────┐
│  共享包（npm / monorepo）       │
│  - user-service 的接口          │
└────────────────────────────────┘
        ▲                ▲
        │                │
┌───────┴───┐      ┌─────┴────┐
│   A 服务   │      │   B 服务   │
└───────────┘      └───────────┘
```

**优点**：
- 没网络开销
- 改一次，全项目生效

**缺点**：
- 强耦合：B 改了接口，所有依赖者都要重新发版
- 部署一起，无法独立扩展
- 一个 bug 拖垮所有

**经验法则**：
- 服务独立演进、不同团队维护 → **服务间调用**
- 服务紧耦合、生命周期一致 → **共享代码**

## 本项目的设计选择

```
gateway ──> auth   （服务间调用）
hello   ──> auth   （服务间调用）
hello   ←─ shared （共享代码：JWT 工具）
```

**故意混合两种**，让你看清差异：
- 服务间调用：`hello` 反查 `auth` 拿用户信息
- 共享代码：3 个服务共用 `shared/jwt.js` 验 JWT

**这是真实系统的常见模式**：身份验证用共享代码（无状态、解耦），数据查询用服务间调用（强一致）。

## 服务间调用的常见坑

### 1. 没有超时

```js
// ❌ 危险：auth 挂了，hello 卡死
const resp = await fetch(`${AUTH_URL}/me`);
```

```js
// ✅ 安全：3 秒超时
const resp = await fetch(`${AUTH_URL}/me`, {
  signal: AbortSignal.timeout(3000)
});
```

### 2. 没有重试

```js
// ❌ 网络抖动一次就失败
const resp = await fetch(url);
```

```js
// ✅ 重试 3 次，指数退避
for (let i = 0; i < 3; i++) {
  try {
    return await fetch(url);
  } catch (e) {
    if (i === 2) throw e;
    await new Promise(r => setTimeout(r, 100 * 2 ** i));
  }
}
```

### 3. 调用链过深

```
client -> gateway -> service A -> service B -> service C -> service D
```

每一层都可能失败，整体可靠性 = 各层相乘：
- 各层 99% 可靠 → 5 层 = 95% 可靠
- 各层 95% 可靠 → 5 层 = 77% 可靠

**对策**：减少调用链深度，或者异步化。

### 4. 不传 trace-id

```js
// ❌ 调用链断在 hello -> auth
fetch(`${AUTH_URL}/me`);
```

```js
// ✅ 透传 trace-id
fetch(`${AUTH_URL}/me`, { headers: { 'x-trace-id': traceId } });
```

否则事后排查"这次请求到底走到哪了"会疯掉。

### 5. 信任下游

```js
// ❌ 假设 auth 一定返回正确的格式
const { username } = await resp.json();
```

```js
// ✅ 检查响应格式
const data = await resp.json();
if (!data.username) throw new Error('bad response from auth');
```

下游可能改接口、可能返回错误格式、可能挂了。永远不要假设。

## 下一步

- 怎么优雅处理下游故障：[05-故障隔离与弹性](./05-resilience.md)
- 怎么把调用链串起来：[06-可观测性](./06-observability.md)
