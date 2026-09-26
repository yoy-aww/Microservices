# 00 · 快速上手

> 5 分钟把 3 个服务跑起来，看到 token 在链路里流转。

## 前置要求

- **Node.js v24+**：用 `node --version` 验证。Windows 用户参考项目根的 README。
- **Git Bash** 或 PowerShell：用来跑 bash 脚本。
- **至少两个终端窗口**：一个跑服务，一个跑演示。

## 安装依赖

```bash
cd C:\yoyac-work\Microservices
npm install
```

只装了一个包：`jose`（JWT 库）。

## 启动服务

打开第一个终端：

```bash
bash scripts/start-all.sh
```

应该看到三行日志：

```
[auth] listening on http://0.0.0.0:3000
[hello] listening on http://0.0.0.0:3001
[gateway] listening on http://0.0.0.0:3002
```

## 跑演示

打开第二个终端：

```bash
bash scripts/demo.sh
```

会看到 8 步演示：

1. 注册 alice
2. 登录拿 JWT
3. 不带 token 调受保护端点 → 401
4. 带 token 调 → 200 + `hello, alice`
5. `/whoami` 演示服务间调用
6. 错误 token → 401
7. 公开端点对比
8. trace-id 贯穿链路

## 第一次手动验证

不用脚本，手动跑一遍：

```bash
# 注册
curl -X POST http://localhost:3002/api/auth/register \
  -H "content-type: application/json" \
  -d '{"username":"bob","password":"pass123"}'

# 登录拿 token
curl -X POST http://localhost:3002/api/auth/login \
  -H "content-type: application/json" \
  -d '{"username":"bob","password":"pass123"}'
# 把返回的 token 复制出来

# 用 token 调受保护端点
curl http://localhost:3002/api/hello/protected \
  -H "Authorization: Bearer <你的token>"
```

如果都通了，继续读 [01-项目导览](./01-tour.md)。

## 看服务的日志

回到第一个终端，你应该看到 gateway 在记录：

```
[gw] <trace-id> POST /api/auth/register -> http://localhost:3000/register
[gw] <trace-id> <- 201 in 26ms
[gw] <trace-id> POST /api/auth/login -> http://localhost:3000/login
[gw] <trace-id> <- 200 in 6ms
```

这就是**链路追踪**的最小模型——同一个 trace-id 串起整条调用。详细看 [06-可观测性](./06-observability.md)。

## 停止服务

在第一个终端按 `Ctrl+C`，所有服务都会停。

验证端口释放：

```bash
netstat -ano | grep -E ':(3000|3001|3002) [0-9]+ .*LISTEN'
```

应该没有输出。

## 下一步

- 想看懂代码：[01-项目导览](./01-tour.md)
- 想动手实验：[10-动手实验](./10-experiments.md)
