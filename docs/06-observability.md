# 06 · 可观测性

> 怎么知道系统在干什么。日志、Trace、指标三件套。

## 可观测性三支柱

```
┌─────────────────────────────────────────┐
│              可观测性                     │
├──────────┬──────────┬────────────────────┤
│   日志   │  指标    │      链路追踪       │
│  Logs    │ Metrics  │     Traces         │
└──────────┴──────────┴────────────────────┘
```

| 支柱 | 回答什么问题 | 数据形式 |
|------|--------------|----------|
| 日志 | "发生了什么？" | 文本事件 |
| 指标 | "整体怎么样？" | 数字聚合 |
| Trace | "请求走了哪些服务？" | 调用树 |

## 日志（Logs）

**项目里的日志**：

```
[gw] 789ad1c6-... POST /api/auth/register -> http://localhost:3000/register
[gw] 789ad1c6-... <- 201 in 26ms
[auth] 789ad1c6-... POST /register
[auth] registered: alice
```

**好日志的要素**：

1. **时间戳**（项目里没加——是个坑）
2. **服务名**（`[gw]` / `[auth]` / `[hello]`）
3. **级别**（DEBUG / INFO / WARN / ERROR）
4. **trace-id**（跨服务关联）
5. **关键信息**（请求路径、状态码、耗时）
6. **结构化**（JSON 比文本好查）

### 日志级别

| 级别 | 用途 | 频率 |
|------|------|------|
| DEBUG | 调试信息，生产关闭 | 高 |
| INFO | 正常业务事件 | 中 |
| WARN | 异常但可恢复 | 低 |
| ERROR | 错误，需要关注 | 很低 |

### 日志格式对比

**文本格式**（项目里用）：

```
[gw] 789ad1c6-... POST /api/auth/register -> http://localhost:3000/register
```

**优点**：人眼能读
**缺点**：机器难解析，字段对不齐

**JSON 格式**（生产推荐）：

```json
{
  "ts": "2026-09-26T01:30:58.123Z",
  "level": "INFO",
  "service": "gateway",
  "trace_id": "789ad1c6-...",
  "method": "POST",
  "path": "/api/auth/register",
  "target": "http://localhost:3000/register",
  "duration_ms": 26,
  "status": 201
}
```

**优点**：机器好解析，能用 ELK/Loki 做全文搜索
**缺点**：人眼读起来累

**改进建议**：本项目可以用 pino（Node 日志库）输出 JSON，然后 `jq` 解析。

## 指标（Metrics）

**指标是数字聚合**：不是单个事件，是统计量。

### 三大指标类型

| 类型 | 例子 | 用途 |
|------|------|------|
| Counter | 总请求数、总错误数 | 看趋势 |
| Gauge | 当前内存、CPU 使用率 | 看实时 |
| Histogram | 请求延迟分布 | 看分布（P50/P95/P99） |

### 经典指标：RED 方法

- **Rate**：每秒请求数
- **Errors**：错误率
- **Duration**：延迟分布

### 经典指标：USE 方法

- **Utilization**：资源使用率
- **Saturation**：饱和度
- **Errors**：错误率

### 项目里没有指标

本项目**故意没加指标**——这是生产必备、教学省了。

如果要加，最小实现：

```js
// 极简计数器
let requestCount = 0;
let errorCount = 0;
let durations = [];

http.createServer((req, res) => {
  requestCount++;
  const start = Date.now();
  res.on('finish', () => {
    durations.push(Date.now() - start);
    if (res.statusCode >= 400) errorCount++;
  });
  // ...
});

// 每分钟打一次
setInterval(() => {
  console.log({ requestCount, errorCount, p50: percentile(durations, 50) });
}, 60000);
```

**生产用 Prometheus + Grafana**：
- Prometheus 抓指标（pull 模式）
- Grafana 画仪表盘

## 链路追踪（Traces）

**Trace 是分布式系统的"GPS"**：一个请求穿过 N 个服务，trace 把整条路径串起来。

### Trace 的核心概念

```
Trace: 1aa4725c-7db6-44d5-af07-3f58249bac64 (一次完整请求)
│
├── Span 1: gateway.handle /api/hello/whoami (0ms - 33ms)
│   │
│   └── Span 2: hello.handle /whoami (5ms - 30ms)
│       │
│       └── Span 3: auth.handle /me (10ms - 25ms)
```

| 概念 | 含义 |
|------|------|
| **Trace** | 一次完整请求 |
| **Span** | 一个操作（一次 HTTP 请求、一次 DB 查询） |
| **Span ID** | 单个 Span 的唯一 ID |
| **Parent Span ID** | 父 Span，串起调用树 |

### 项目里的 Trace 实现

`gateway/index.js`：

```js
const traceId = req.headers['x-trace-id'] || crypto.randomUUID();
```

生成或透传 trace-id。

```js
console.log(`[gw] ${traceId} ${req.method} ${url.pathname} -> ${target.href}`);
```

记录 trace-id。

**下游透传**：

```js
const fwdHeaders = {
  ...req.headers,
  'x-trace-id': traceId,  // ← 关键
  // ...
};
```

`hello/index.js` 收到后：

```js
const traceId = req.headers['x-trace-id'] || '(no-trace-id)';
console.log(`[hello] ${traceId} ${req.method} ${url.pathname}`);
```

**hello 反查 auth 时也透传**：

```js
const resp = await fetch(url, {
  headers: { 'x-trace-id': traceId }  // ← 关键
});
```

### Trace 排查故障

**场景**：alice 登录慢，怎么定位？

1. 看 trace-id：`1aa4725c-...`
2. 在 gateway 日志里找：`[gw] 1aa4725c GET /api/hello/whoami`
3. 在 hello 日志里找：`[hello] 1aa4725c GET /whoami`
4. 在 auth 日志里找：`[auth] 1aa4725c GET /me`
5. 比较各 Span 耗时，找出慢点

**没有 trace-id**：要在三个服务的日志里按时间戳和用户名人工匹配——噩梦。

### 完整 Trace 系统：OpenTelemetry

OpenTelemetry 是事实标准。核心概念：

```js
import { NodeSDK, TracerProvider, SimpleSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-node';

const sdk = new NodeSDK({
  serviceName: 'hello',
  spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
});
sdk.start();
```

自动 instrumentation：Node 的 `http`、`fetch` 都会被插桩，trace-id 自动透传。

## 本项目缺什么

| 要素 | 有没有 | 备注 |
|------|--------|------|
| trace-id | ✅ | 手动实现 |
| trace-id 透传 | ✅ | 跨服务传递 |
| 时间戳 | ❌ | 控制台自带 |
| 结构化日志 | ❌ | 文本格式 |
| 指标 | ❌ | 完全没加 |
| Span 树 | ❌ | 只有 trace-id，没有 span |
| 健康检查 | ❌ | 没有 /health |
| 错误采样 | ❌ | 全采样（会爆） |

## 一个最小可观测性改造

```js
// 加时间戳 + 结构化
import { performance } from 'node:perf_hooks';

http.createServer(async (req, res) => {
  const start = performance.now();
  const traceId = req.headers['x-trace-id'] || crypto.randomUUID();
  
  res.on('finish', () => {
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      service: 'gateway',
      trace_id: traceId,
      method: req.method,
      path: req.url,
      status: res.statusCode,
      duration_ms: Math.round(performance.now() - start),
    }));
  });
  // ...
});
```

输出：

```json
{"ts":"2026-09-26T01:30:58.123Z","service":"gateway","trace_id":"789ad1c6-...","method":"POST","path":"/api/auth/register","status":201,"duration_ms":26}
```

## 下一步

- API 怎么设计才不破坏别人：[07-API契约与设计](./07-api-design.md)
- 多服务数据怎么保持一致：[08-数据一致性](./08-data-consistency.md)
