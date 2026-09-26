# 10 · 动手实验

> 8 个故意留的坑，每个都让你亲手踩。读代码 100 遍，不如动手跑 1 遍。

## 实验 0：跑通演示

**目标**：把 3 个服务跑起来，看到完整流程。

**步骤**：

```bash
bash scripts/start-all.sh
bash scripts/demo.sh
```

**期望**：8 步演示全部成功。

**思考**：
- 哪个端点不需要 token？
- 哪个端点需要 token？
- 哪个端点会反查 auth？

---

## 实验 1：故障隔离

**目标**：亲身体会"auth 挂了"对系统的影响。

**步骤**：

```bash
# 启动服务
bash scripts/start-all.sh

# 终端 2：拿 token
curl -sS -X POST http://localhost:3002/api/auth/login \
  -H "content-type: application/json" \
  -d '{"username":"alice","password":"secret123"}'
# 假设返回 token 是 xxx

# 终端 2：杀掉 auth
# 在 start-all 的终端找到 auth 的 PID，然后：
taskkill /F /PID <auth_pid>

# 终端 2：测试两个端点
curl http://localhost:3002/api/hello/protected -H "Authorization: Bearer xxx"
curl http://localhost:3002/api/hello/whoami -H "Authorization: Bearer xxx"
```

**观察**：
- `/protected` 还能跑（JWT 无状态）
- `/whoami` 直接 503（依赖 auth）

**思考**：
- 为什么 `/protected` 不依赖 auth？
- JWT 无状态的代价是什么？
- 生产系统里 `/whoami` 该怎么设计？

---

## 实验 2：慢下游

**目标**：看"慢下游"怎么拖垮上游。

**步骤**：

```bash
# 启动服务后，并发打 /stress
for i in {1..10}; do
  curl http://localhost:3002/api/hello/stress &
done
wait
```

**观察**：
- gateway 日志里 10 个请求都在等 2 秒
- 没有超时控制，请求一直挂着

**思考**：
- 如果用户同时开 100 个请求，gateway 会怎样？
- 加超时怎么改？
- 加超时后，用户拿到的错误是什么？

**改进代码**：

```js
// hello/index.js
async function handleStress(res) {
  await new Promise(r => setTimeout(r, 2000));
  return json(res, 200, { message: 'hello, that took 2s on purpose' });
}

// 在 gateway 里加超时：
const resp = await fetch(target, {
  method: req.method,
  headers: fwdHeaders,
  body,
  signal: AbortSignal.timeout(1500),  // 1.5 秒超时
});
```

---

## 实验 3：trace-id 贯穿

**目标**：用同一个 trace-id 串起整条调用链。

**步骤**：

```bash
# 启动服务后
curl -i http://localhost:3002/api/hello/whoami -H "Authorization: Bearer <token>" 2>&1 | grep x-trace-id
# 假设返回 789ad1c6-...

# 看 3 个服务的日志，找这个 trace-id
# 在 start-all 的终端里 grep：
# [gw] 789ad1c6...
# [hello] 789ad1c6...
# [auth] 789ad1c6...
```

**观察**：
- 同一个 trace-id 在 3 个服务的日志里都出现
- 这就是分布式追踪的最小模型

**思考**：
- 如果 hello 反查 auth 时没透传 trace-id，会怎样？
- 真实的分布式追踪系统（OpenTelemetry）比这个多了什么？

---

## 实验 4：JWT 解码

**目标**：看懂 JWT 里的内容。

**步骤**：

```bash
# 拿 token
TOKEN=$(curl -sS -X POST http://localhost:3002/api/auth/login \
  -H "content-type: application/json" \
  -d '{"username":"alice","password":"secret123"}' \
  | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).token))')

# 拆成 3 段
echo "$TOKEN" | tr '.' '\n'

# 解码 header 和 payload（Base64URL）
# 注意：Base64URL 用 - 和 _ 代替 + 和 /
echo "$TOKEN" | cut -d. -f1 | tr '_-' '/+' | base64 -d 2>/dev/null || \
  echo "$TOKEN" | cut -d. -f1 | python -c "import sys,base64; print(base64.urlsafe_b64decode(sys.stdin.read().strip() + '==').decode())"

echo "$TOKEN" | cut -d. -f2 | tr '_-' '/+' | base64 -d 2>/dev/null || \
  echo "$TOKEN" | cut -d. -f2 | python -c "import sys,base64; print(base64.urlsafe_b64decode(sys.stdin.read().strip() + '==').decode())"
```

**观察**：
- header：`{"alg":"HS256","typ":"JWT"}`
- payload：`{"sub":"alice","role":"user","iat":...,"exp":...}`

**思考**：
- payload 里的时间戳是什么含义？
- 为什么 token 是三段？
- 如果 token 里有敏感信息会怎样？

---

## 实验 5：伪造 token

**目标**：体验"密钥泄漏 = 任何人都能伪造身份"。

**步骤**：

```bash
# 用一个假的密钥签 token
node -e "
const { SignJWT } = require('jose');
const secret = new TextEncoder().encode('dev-only-secret-change-me');
new SignJWT({ sub: 'admin', role: 'admin' })
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt()
  .setExpirationTime('2h')
  .sign(secret)
  .then(t => console.log(t));
"
# 假设返回 forged_token

# 用伪造的 token 调 /protected
curl http://localhost:3002/api/hello/protected -H "Authorization: Bearer <forged_token>"
```

**观察**：
- 返回 200，消息是 `hello, admin`
- alice 都没注册过 admin，但 token 通过了验证

**思考**：
- 为什么能用假密钥签出"有效" token？
- 生产系统怎么避免这个问题？
- 公私钥模式（RS256）怎么解决？

---

## 实验 6：篡改 token

**目标**：体验"JWT 防篡改"。

**步骤**：

```bash
# 拿合法 token
TOKEN=$(curl -sS -X POST http://localhost:3002/api/auth/login \
  -H "content-type: application/json" \
  -d '{"username":"alice","password":"secret123"}' \
  | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).token))')

# 把 payload 里的 alice 改成 admin（手动改 Base64）
# 解码 payload
PAYLOAD=$(echo "$TOKEN" | cut -d. -f2)
echo "原 payload: $PAYLOAD"

# 用伪造的 payload 替换
FORGED_PAYLOAD=$(echo '{"sub":"admin","role":"admin","iat":1790386258,"exp":1790393458}' | python -c "import sys,base64,json; print(base64.urlsafe_b64encode(json.dumps(json.loads(sys.stdin.read()), separators=(',',':')).encode()).decode().rstrip('='))")
FORGED_TOKEN="${TOKEN%%.*}.${FORGED_PAYLOAD}.${TOKEN##*.}"

# 用篡改后的 token
curl http://localhost:3002/api/hello/protected -H "Authorization: Bearer $FORGED_TOKEN"
```

**观察**：
- 返回 401（token 无效）
- 因为签名对不上

**思考**：
- 为什么改了 payload，签名就对不上？
- 签名是怎么和 payload 绑定的？

---

## 实验 7：改 API 契约

**目标**：体验"破坏契约"的后果。

**步骤**：

```bash
# 模拟：auth 服务改了 /login 的响应格式
# 在 auth/index.js 里找到 /login 返回，把 { token } 改成 { access_token }
# 重启 auth

# 用旧格式调用（脚本里假设是 { token }）
bash scripts/demo.sh
```

**观察**：
- demo 脚本崩了，因为 `JSON.parse(d).token` 是 undefined
- 这就是契约破坏

**思考**：
- 怎么避免契约破坏？
- 怎么验证兼容性？

---

## 实验 8：服务间调用降级

**目标**：给 `/whoami` 加降级逻辑。

**步骤**：

修改 `hello/index.js` 的 `handleWhoami`：

```js
async function handleWhoami(req, res, traceId) {
  const token = extractBearerToken(req.headers['authorization']);
  if (!token) return json(res, 401, { error: 'missing token' });

  let payload;
  try {
    payload = await verifyToken(token);
  } catch {
    return json(res, 401, { error: 'invalid or expired token' });
  }

  try {
    const resp = await fetch(
      `${AUTH_URL}/me?username=${encodeURIComponent(payload.sub)}`,
      {
        headers: { 'x-trace-id': traceId },
        signal: AbortSignal.timeout(3000),  // ← 加超时
      }
    );
    if (!resp.ok) {
      return json(res, 502, { error: 'auth service returned error', status: resp.status });
    }
    const profile = await resp.json();
    return json(res, 200, {
      message: `whoami: ${profile.username} (fetched from auth service)`,
      profile,
      source: 'auth',  // ← 标记数据来源
    });
  } catch (err) {
    // ← 加降级：返回默认 profile
    console.error('[hello] auth service unreachable:', err.message);
    return json(res, 200, {
      message: `whoami: ${payload.sub} (degraded, auth unavailable)`,
      profile: {
        username: payload.sub,
        displayName: payload.sub,  // 默认显示用户名
        isDegraded: true,          // 标记降级
      },
      source: 'degraded',          // ← 标记降级
    });
  }
}
```

**步骤**：

```bash
# 1. 正常调用
curl http://localhost:3002/api/hello/whoami -H "Authorization: Bearer <token>"
# 返回 source: 'auth'

# 2. 杀掉 auth，再调用
curl http://localhost:3002/api/hello/whoami -H "Authorization: Bearer <token>"
# 返回 source: 'degraded'，而不是 503
```

**观察**：
- 之前：auth 挂 → 503
- 之后：auth 挂 → 200 + 降级数据 + 标记 isDegraded

**思考**：
- 降级返回什么数据合适？
- 客户端怎么知道数据是降级的？
- 降级是不是总是好选择？（比 503 好还是坏？）

---

## 实验完成后的思考题

1. **如果让你加一个 /logout 端点，怎么设计？**
   - JWT 怎么"注销"？（提示：JWT 无法真正撤销）

2. **如果让你加一个 /search 端点，搜索用户列表，怎么设计？**
   - 是走 auth 还是单独服务？
   - 怎么分页？怎么排序？

3. **如果 auth 服务要做多副本部署，用户表怎么办？**
   - 内存 Map 行不行？
   - 换数据库后，并发注册怎么处理？

4. **如果让你加限流，怎么实现？**
   - 限流在 gateway 还是服务里？
   - 限流算法选哪种？

5. **如果团队有 5 个服务，trace-id 怎么扩展？**
   - 现在只有 1 个 trace-id
   - 真实的分布式追踪还要 span 树

6. **JWT 怎么轮换密钥？**
   - 怎么让旧 token 慢慢失效？
   - 怎么让新 token 用新密钥？

---

## 下一步学习

- 加熔断器：把"挂了直接报错"变成"挂了优雅降级"
- 加 OpenTelemetry：把 trace-id 升级为完整 span 树
- 加数据库：把内存用户表换成 SQLite/Postgres
- 加消息队列：把"同步调用"变成"异步事件"
- 加 Docker：把 3 个服务容器化

## 配套文档回顾

| 实验 | 对应文档 |
|------|----------|
| 0 | [00-快速上手](./00-quickstart.md) |
| 1 | [05-故障隔离与弹性](./05-resilience.md) |
| 2 | [05-故障隔离与弹性](./05-resilience.md) |
| 3 | [06-可观测性](./06-observability.md) |
| 4 | [03-JWT深入](./03-jwt.md) |
| 5 | [03-JWT深入](./03-jwt.md) |
| 6 | [03-JWT深入](./03-jwt.md) |
| 7 | [07-API契约与设计](./07-api-design.md) |
| 8 | [05-故障隔离与弹性](./05-resilience.md) |
