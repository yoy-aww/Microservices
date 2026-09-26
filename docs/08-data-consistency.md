# 08 · 数据一致性

> 微服务里最棘手的问题。每个服务有独立数据库，数据怎么保持一致？

## 为什么微服务有数据一致性问题

**单体架构**：所有数据在一个数据库，事务能跨表保证一致性。

```
┌────────────────────────────┐
│       单体应用               │
│  Service A  ─┐             │
│  Service B  ─┤ 同一个 DB   │
│  Service C  ─┘             │
└────────────────────────────┘
```

**微服务架构**：每个服务有独立数据库，**一个事务跨不了服务边界**。

```
┌──────┐   ┌──────┐   ┌──────┐
│ Auth │   │ User │   │Order │
│ DB   │   │ DB   │   │ DB   │
└──────┘   └──────┘   └──────┘
```

**核心矛盾**：CAP 定理——一致性（C）、可用性（A）、分区容错性（P）三者最多选两个。微服务是分布式系统，必然选 P，剩下 C 和 A 二选一。

## 几种一致性模型

### 1. 强一致（Strong Consistency）

**定义**：每次读都能读到最新的写。

**实现**：分布式事务（2PC / XA）

**代价**：
- 性能差（锁很多）
- 可用性强依赖所有参与方在线
- 实现复杂

**适合**：银行转账、库存扣减

### 2. 最终一致（Eventual Consistency）

**定义**：写入后，所有副本最终会读到新值，但中间可能有短暂不一致。

**实现**：异步消息、事件驱动

**代价**：
- 短时间内数据不一致
- 需要处理失败重试

**适合**：搜索索引、商品详情缓存、消息通知

### 3. 会话一致（Session Consistency）

**定义**：单个用户会话内读到一致数据，跨会话不保证。

**实现**：读写分离 + 用户路由

**适合**：电商浏览（同一用户看到的购物车一致即可）

### 4. 单调一致（Monotonic Consistency）

**定义**：一个用户不会读到比之前更旧的数据。

**适合**：聊天历史

## 微服务里的经典一致性模式

### 模式 1：Saga（编排式）

**问题**：跨多个服务的业务操作。

**例子**：下单流程

```
1. 创建订单 (Order Service)
2. 扣库存 (Inventory Service)
3. 扣款 (Payment Service)
4. 发通知 (Notification Service)
```

**任一步失败怎么办**？

### 编排式 Saga

**中央协调者**调度所有步骤：

```
┌──────────┐
│ Saga Orchestrator │
└─────┬────┘
      │
      ├──> Order Service: createOrder()
      ├──> Inventory Service: deductStock()
      ├──> Payment Service: charge()
      └──> Notification Service: notify()
```

**如果 Payment 失败**：

```
Saga Orchestrator:
  - 调 Order.cancel()（补偿）
  - 调 Inventory.restore()（补偿）
  - 标记整个 Saga 失败
```

**优点**：逻辑集中，易于理解
**缺点**：协调者是单点，挂了整个 Saga 卡住

### 协调式 Saga（事件驱动）

**没有中央协调者**，每个服务自己监听事件：

```
Order 创建订单 -> 发 "OrderCreated" 事件
     ↓
Inventory 收到 -> 扣库存 -> 发 "StockDeducted" 事件
     ↓
Payment 收到 -> 扣款 -> 发 "PaymentDone" 事件
     ↓
Notification 收到 -> 发通知
```

**如果 Payment 失败**：

```
Payment 发 "PaymentFailed" 事件
     ↓
Inventory 收到 -> 恢复库存 -> 发 "StockRestored" 事件
     ↓
Order 收到 -> 取消订单 -> 发 "OrderCancelled" 事件
```

**优点**：解耦，没有单点
**缺点**：事件流复杂，调试困难

### 模式 2：事务性 Outbox（Transactional Outbox）

**问题**：本地事务 + 发事件不一致。

**例子**：

```js
// ❌ 危险：本地事务提交了，但消息没发出去
await db.transaction(() => {
  await orderRepo.create(order);
});
await messageQueue.publish('OrderCreated', { orderId });
// ↑ 如果这里挂了，order 创建了但消息丢了
```

**解决方案**：Outbox Pattern

```
1. 在订单表加 outbox 字段
2. 本地事务：order + outbox 一起提交
3. 后台进程轮询 outbox，发消息
4. 消息发成功后，标记 outbox 已处理
```

```js
await db.transaction(() => {
  await orderRepo.create(order);
  await outboxRepo.insert({
    event: 'OrderCreated',
    payload: { orderId: order.id },
    status: 'pending',
  });
});
```

**优点**：本地事务保证 order 和 outbox 一起成功
**缺点**：有延迟（取决于轮询频率）

### 模式 3：CQRS（命令查询职责分离）

**问题**：写模型和读模型不一样。

**写路径**：

```
用户下单 -> Command Handler -> Order Service（写 DB）
```

**读路径**：

```
用户查订单 -> Query Handler -> Read Model（搜索库/缓存）
```

**好处**：
- 读写独立扩展
- 读模型可以优化为查询友好的格式（比如宽表）
- 写模型可以保持领域驱动的复杂性

**代价**：读模型有延迟（最终一致）

### 模式 4：补偿事务

**问题**：已经提交了，怎么"撤销"？

**思路**：不撤销，反向操作。

```
1. 扣款成功（已提交）
2. 发货失败
3. 退款（不是"撤销扣款"，是"发起一笔反向交易"）
```

**关键**：补偿操作也要可重试、幂等。

## 项目里的数据一致性问题

`auth/index.js` 用内存 Map 存用户：

```js
const users = new Map();

app.route('POST /register', async (req, res) => {
  users.set(username, { ... });
});
```

**故意这样写**，但有几个真实问题：

### 问题 1：内存数据不持久

- 服务重启 = 所有用户丢失
- 多副本部署 = 每个副本数据不一致

### 问题 2：并发写

```js
// 两个请求同时注册 alice
// 1 读 users.has('alice') = false
// 2 读 users.has('alice') = false
// 1 写 users.set('alice', ...)
// 2 写 users.set('alice', ...)  // 覆盖！
```

### 问题 3：跨服务一致性

`hello/index.js` 的 `/whoami` 反查 auth：

```
hello 收到请求
  └── fetch(auth/me)  // 同步调用
```

**如果 auth 的内存数据和 hello 看到的 token 不一致**：
- alice 在 auth 改了密码
- 旧 token 还在用（JWT 不失效）
- `/whoami` 查到的密码信息是新的，但 token 是旧的

**这种情况怎么解决**？
- 短过期 token（15 分钟）+ refresh token
- 关键操作强制重新登录
- 接受短暂不一致（最终一致）

## CAP 定理实战

**CAP**：Consistency, Availability, Partition tolerance

- 分布式系统必然遇到网络分区（P 必选）
- 剩下 C 和 A 二选一

### CP 系统

- 网络分区时拒绝服务，保证一致性
- 例子：ZooKeeper、CockroachDB
- 适合：金融、库存

### AP 系统

- 网络分区时继续服务，可能读到旧数据
- 例子：Cassandra、DynamoDB
- 适合：电商、社交

**微服务一般选 AP**，因为可用性更重要（用户等不了）。

## PACELC 定理

**CAP 的扩展**：

- **P**artition → **E**lse **L**atency 或 **C**onsistency
- 网络正常时，要么低延迟，要么强一致

**含义**：即使网络正常，强一致也要付延迟代价。

## 数据库选型

| 类型 | 一致性 | 延迟 | 适合 |
|------|--------|------|------|
| 关系型（PostgreSQL、MySQL） | 强一致 | 低 | 订单、用户 |
| NoSQL 文档（MongoDB） | 最终一致 | 低 | 商品详情 |
| NoSQL 键值（Redis） | 最终一致 | 极低 | 缓存 |
| NoSQL 列族（Cassandra） | 可配置 | 低 | 海量写入 |
| 搜索引擎（Elasticsearch） | 最终一致 | 低 | 全文搜索 |

**经验法则**：
- 强一致需求 → 关系型 + 应用层事务
- 最终一致需求 → NoSQL + 事件驱动
- 混合 → 关系型做主，NoSQL 做读副本（CQRS）

## 下一步

- 什么时候不该拆：[09-共享服务蔓延](./09-sharing-trap.md)
- 动手实验：[10-动手实验](./10-experiments.md)
