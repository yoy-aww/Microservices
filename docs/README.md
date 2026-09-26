# 微服务学习文档

这套文档是 `Microservices` 项目的学习伴侣。代码是死的，文档是活的——把"为什么这样写"讲清楚。

## 阅读路径

按你的水平挑一条路：

### 路径 A：第一次接触微服务

1. [00-快速上手](./00-quickstart.md) — 5 分钟跑起来
2. [01-项目导览](./01-tour.md) — 看懂代码在干什么
3. [02-HTTP与REST基础](./02-http-basics.md) — 把"请求长什么样"看透
4. [03-JWT深入](./03-jwt.md) — token 是怎么工作的
5. [04-服务间通信](./04-service-comms.md) — 服务怎么互相调用

### 路径 B：已懂 HTTP/REST，专门学微服务

1. [04-服务间通信](./04-service-comms.md) — 同步调用 vs 异步消息
2. [05-故障隔离与弹性](./05-resilience.md) — 熔断、降级、超时
3. [06-可观测性](./06-observability.md) — 日志、Trace、指标
4. [07-API契约与设计](./07-api-design.md) — 怎么改不破坏别人
5. [08-数据一致性](./08-data-consistency.md) — 最终一致 vs 强一致
6. [09-共享服务蔓延](./09-sharing-trap.md) — 什么时候不该拆

### 路径 C：想动手实验

1. [10-动手实验](./10-experiments.md) — 8 个故意留的坑，每个都让你亲手踩

## 文档索引

| # | 文档 | 主题 | 对应代码 |
|---|------|------|----------|
| 00 | [快速上手](./00-quickstart.md) | 5 分钟跑通 | — |
| 01 | [项目导览](./01-tour.md) | 三个服务怎么协作 | 全部 |
| 02 | [HTTP与REST基础](./02-http-basics.md) | 请求/响应/状态码/方法 | 全部 |
| 03 | [JWT深入](./03-jwt.md) | 签发、验证、密钥 | `shared/jwt.js`, `auth/` |
| 04 | [服务间通信](./04-service-comms.md) | 同步 vs 异步、REST vs gRPC | `hello/index.js` |
| 05 | [故障隔离与弹性](./05-resilience.md) | 熔断、降级、超时、重试 | `hello/index.js` `/whoami` |
| 06 | [可观测性](./06-observability.md) | 日志、Trace、指标 | `gateway/index.js` |
| 07 | [API契约与设计](./07-api-design.md) | 兼容性、版本、Schema | 全部 |
| 08 | [数据一致性](./08-data-consistency.md) | 最终一致、Saga、事件 | `auth/` 用户表 |
| 09 | [共享服务蔓延](./09-sharing-trap.md) | 什么时候不该拆 | 全部 |
| 10 | [动手实验](./10-experiments.md) | 8 个故意留的坑 | 全部 |

## 学习节奏建议

- **每个文档配一个实验**：先读，再跑一遍代码，最后思考"如果换一种写法会怎样"
- **不要追求一次全懂**：微服务的难点不是单个概念，是它们组合后的副作用
- **遇到代码看不懂**：回去读 [01-项目导览](./01-tour.md)，那是"地图"

## 配套资源

- [Martin Fowler - Microservices](https://martinfowler.com/articles/microservices.html) — 概念源头
- [Michael Nygard - Release It!](https://www.manning.com/books/release-it-second-edition) — 弹性设计经典
- [OpenTelemetry 文档](https://opentelemetry.io/) — 可观测性事实标准
