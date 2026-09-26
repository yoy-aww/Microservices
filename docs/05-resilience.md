# 05 · 故障隔离与弹性

> 下游挂了怎么办。这是微服务最核心的难题——也是新手最容易忽略的。

## 什么是弹性

**弹性（Resilience）**：系统在部分组件失败时，仍能正常工作的能力。

**核心思想**：不要假设下游一定正常。永远设计"下游挂了/慢了"的应对方案。

## 五种经典弹性模式

### 1. 超时（Timeout）

**问题**：下游卡死，上游永远等。

```js
// ❌ 下游挂了，fetch 默认可能等很久
const resp = await fetch(url);
```

```js
// ✅ 3 秒超时，自动 abort
const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
```

**经验值**：
- 普通查询：1-3 秒
- 大数据传输：10-30 秒
- 后台任务：60-300 秒

### 2. 重试（Retry）

**问题**：网络抖动、瞬时故障。

```js
async function retry(fn, { times = 3, baseDelay = 100 } = {}) {
  for (let i = 0; i < times; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === times - 1) throw err;
      // 指数退避：100ms, 200ms, 400ms
      await new Promise(r => setTimeout(r, baseDelay * 2 ** i));
    }
  }
}
```

**关键设计**：
- **只重试幂等操作**：GET、DELETE 安全，POST 危险（可能重复创建）
- **指数退避**：100ms → 200ms → 400ms，避免雪崩
- **加随机抖动**：避免重试风暴（多个客户端同时重试）

### 3. 熔断（Circuit Breaker）

**问题**：下游持续故障，上游每次都重试，越试越糟。

**熔断器状态机**：

```
        失败次数超阈值
  [Closed] ──────────────> [Open]
     ▲                        │
     │  半开窗口过期            │ 调用成功
     │                        ▼
     └──── [Half-Open] <────────┘
```

- **Closed（关闭）**：正常调用
- **Open（打开）**：直接拒绝，不调用下游
- **Half-Open（半开）**：让少量请求过去试试，成功则关闭熔断，失败则重新打开

**伪代码**：

```js
class CircuitBreaker {
  constructor({ threshold = 5, timeout = 60000 } = {}) {
    this.threshold = threshold;
    this.timeout = timeout;
    this.state = 'closed';
    this.failures = 0;
    this.lastFailureTime = 0;
  }

  async call(fn) {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'half-open';
      } else {
        throw new Error('circuit open');
      }
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  onSuccess() {
    this.failures = 0;
    this.state = 'closed';
  }

  onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.threshold) {
      this.state = 'open';
    }
  }
}
```

**经验值**：
- 阈值：3-10 次失败
- 熔断持续时间：30-60 秒

### 4. 降级（Fallback / Degrade）

**问题**：下游挂了，能不能给个"不完美但能用"的结果？

**例子**：
- 商品推荐服务挂了 → 返回热门商品列表
- 库存服务挂了 → 返回"暂时无法查询"而不是 500
- 用户信息挂了 → 显示"匿名用户"

**伪代码**：

```js
async function getUserProfile(username) {
  try {
    return await circuitBreaker.call(() => fetchProfile(username));
  } catch {
    // 降级：返回默认 profile
    return { username, displayName: '匿名' };
  }
}
```

### 5. 限流（Rate Limiting）

**问题**：下游处理不过来，上游继续打就雪崩。

**常见算法**：
- **令牌桶**：固定速率发令牌，请求拿不到令牌就拒绝
- **漏桶**：固定速率处理，超出的排队
- **滑动窗口**：最近 N 秒的请求数不能超过阈值

**经验值**：
- 用户接口：每秒 10-100 请求/用户
- 内部接口：每秒 1000+ 请求

## 本项目里的故障模式

`hello/index.js` 的 `/whoami`：

```js
async function handleWhoami(req, res, traceId) {
  // ...验 JWT...

  try {
    const resp = await fetch(
      `${AUTH_URL}/me?username=${encodeURIComponent(payload.sub)}`,
      { headers: { 'x-trace-id': traceId } }
    );
    // ...
  } catch (err) {
    // 直接 503
    return json(res, 503, {
      error: 'auth service unavailable',
      detail: err.message,
    });
  }
}
```

**故意没做**：
- ❌ 超时：fetch 默认等不到，可能等几十秒
- ❌ 重试：网络抖动一次就失败
- ❌ 熔断：每次都打 auth，挂了还在打
- ❌ 降级：直接 503，不返回默认值
- ❌ 限流：可以无限打

**这是教学用**，让你看清"裸奔"的后果。生产系统至少要有超时 + 重试。

## 故障传播

**什么是故障传播**：一个服务挂了，把依赖它的服务一起拖挂。

**典型场景**：

```
client -> gateway -> hello -> auth
                         ↑
                    auth 挂了
                         ↓
                  hello 卡住（没超时）
                         ↓
              gateway 卡住（没超时）
                         ↓
              client 卡住（超时）
```

**整个链路都卡死**——这就是"故障传播"。

**对策**：每一层都要有超时，且**上层超时 < 下层超时之和**。

## 故障隔离

**什么是故障隔离**：让故障影响范围最小化。

**几种隔离方式**：

### 进程隔离

每个服务独立进程，挂了一个不影响其他。

### 线程池隔离

```js
// 给 auth 调用单独的线程池，不会把 hello 所有请求都堵住
const authPool = new ThreadPool({ size: 10 });
await authPool.run(() => fetchAuth());
```

### 舱壁模式（Bulkhead）

船的舱壁：一个舱进水不影响整艘船。

```js
// 把"调 auth"和"调其他"放在不同的池
const authBucket = createBucket(10);   // auth 专用
const otherBucket = createBucket(50);  // 其他专用

// auth 挂了，只占 authBucket 的并发，不影响 otherBucket
```

### 熔断隔离

熔断器本身就是一种隔离——auth 挂了，hello 不再打 auth，保护 hello 的其他能力。

## 实战：给 /whoami 加超时

最小化改动版：

```js
async function handleWhoami(req, res, traceId) {
  // ...验 JWT...

  try {
    const resp = await fetch(
      `${AUTH_URL}/me?username=${encodeURIComponent(payload.sub)}`,
      {
        headers: { 'x-trace-id': traceId },
        signal: AbortSignal.timeout(3000),  // ← 加超时
      }
    );
    // ...
  } catch (err) {
    // ...
  }
}
```

**只加 2 行代码**，就能避免"auth 卡死 = hello 卡死"。

## 完整弹性策略示例

```js
async function callWithResilience(url, { timeout = 3000, retries = 3 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(timeout) });
    } catch (err) {
      lastErr = err;
      if (i === retries - 1) break;
      await new Promise(r => setTimeout(r, 100 * 2 ** i + Math.random() * 100));
    }
  }
  throw lastErr;
}
```

## 弹性的边界

弹性不是万能的。下面这些情况弹性救不了：

- **数据不一致**：异步重试可能导致重复提交
- **事务一致性**：分布式事务不能靠重试解决
- **业务逻辑错误**：重试也不会让错误的逻辑变对

**经验法则**：先想清楚"这个操作幂等吗？重试安全吗？"再加弹性策略。

## 下一步

- 怎么定位故障在哪：[06-可观测性](./06-observability.md)
- 数据一致性问题：[08-数据一致性](./08-data-consistency.md)
