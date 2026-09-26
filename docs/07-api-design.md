# 07 · API 契约与设计

> 怎么设计 API 才不破坏别人。微服务的"边界"就是 API。

## API 契约是什么

**API 契约**：服务对外的"承诺"——请求格式、响应格式、错误码、语义。

**契约破坏**：改了 API 导致依赖方挂掉。

**例子**：

```js
// 旧契约
GET /users/123 -> { username: "alice", email: "a@x.com" }

// 新契约（破坏性）
GET /users/123 -> { name: "alice", mail: "a@x.com" }  // 字段改名
```

所有调用方拿到 `username` 的代码全部崩溃。

## 兼容性变更 vs 破坏性变更

### 兼容（向后兼容）

| 变更类型 | 例子 |
|----------|------|
| 加可选字段 | 响应加 `vip: true`，老客户端忽略即可 |
| 加新端点 | 新增 `/users/123/preferences` |
| 加可选请求参数 | `?include_email=true` |
| 加新错误码 | 新增 429 Too Many Requests |

### 破坏（不兼容）

| 变更类型 | 例子 |
|----------|------|
| 改字段名 | `username` -> `name` |
| 改字段类型 | `age: 25` -> `age: "25"` |
| 删字段 | 移除 `email` |
| 改语义 | `200` 含义变了 |
| 删端点 | 移除 `/login` |
| 改状态码 | 401 改 403 |

## 版本化策略

### 1. URL 路径版本

```
/api/v1/users
/api/v2/users
```

**优点**：人眼可读，明确
**缺点**：路由变复杂

### 2. Header 版本

```
Accept: application/vnd.myapi.v2+json
```

**优点**：URL 干净
**缺点**：调试麻烦，缓存键复杂

### 3. 媒体类型版本

```
Accept: application/json;version=2
```

**优点**：和语义绑定
**缺点**：不直观

### 4. 字段标记版本（不推荐）

```json
{ "v": 2, "username": "alice" }
```

**缺点**：每个响应都要带，老版本字段难清理

**经验法则**：
- 公开 API：**URL 路径版本**（清晰、可缓存、可文档化）
- 内部 API：可以不用版本（内部团队配合）

## 项目里的契约问题

`auth/index.js` 的 `/login`：

```js
return json(res, 200, { token });
```

**契约**：`{ token: string }`

如果将来加 `expiresIn`：

```js
return json(res, 200, { token, expiresIn: '2h' });
```

**兼容**：老客户端忽略 `expiresIn` 继续工作。

如果改成 `{ access_token, refresh_token }`：

```js
return json(res, 200, { access_token, refresh_token });
```

**破坏**：老客户端读 `token` 字段直接挂。

## 契约测试

**问题**：改了接口，怎么知道老客户端会不会挂？

### 方案 A：版本化 + 人工审查

加个 Code Review checklist：

- [ ] 加字段（兼容）/ 改字段（破坏）？
- [ ] 删字段？
- [ ] 改状态码？
- [ ] 改错误消息？

### 方案 B：契约测试（Consumer-Driven Contract）

**工具**：Pact

```
Consumer (客户端) -> Pact Broker <- Provider (服务端)
```

1. Consumer 写测试：`expect /login returns { token }`
2. Consumer 跑测试，生成 pact 文件
3. Pact 上传到 Broker
4. Provider 部署前，从 Broker 拉所有 pact，跑一遍
5. 失败 = 破坏契约，部署阻止

### 方案 C：Schema 注册中心

**工具**：Confluent Schema Registry、Apollo、Protobuf Registry

```
服务部署 -> 提交 Schema -> 注册中心验证兼容性 -> 允许部署
```

适合 gRPC（proto 文件天然带类型信息）。

## 项目里的契约保护

本项目**没有任何契约保护**——这是教学用。

改进建议：

```js
// 加一个简单的响应 schema 校验
const loginResponseSchema = {
  token: { type: 'string', required: true },
};

function validateResponse(data, schema) {
  for (const [key, rule] of Object.entries(schema)) {
    if (rule.required && !data[key]) throw new Error(`missing ${key}`);
    if (rule.type && typeof data[key] !== rule.type) throw new Error(`bad type ${key}`);
  }
}
```

## RESTful 设计规范

### URL 设计

| 反例 | 正例 | 理由 |
|------|------|------|
| `/getUser?id=1` | `/users/1` | URL 表示资源，不是动作 |
| `/getUsers` | `/users` | 复数 |
| `/users/1/delete` | `DELETE /users/1` | 用方法表示动作 |
| `/users/1/isActive` | `/users/1?active=true` | 用查询参数过滤 |
| `/users/1/orders` | `/users/1/orders` | 嵌套资源 |

### HTTP 方法语义

| 方法 | 幂等 | 安全 | 用途 |
|------|------|------|------|
| GET | ✅ | ✅ | 查询 |
| HEAD | ✅ | ✅ | 只看响应头 |
| PUT | ✅ | ❌ | 整体替换 |
| PATCH | ❌ | ❌ | 部分更新 |
| POST | ❌ | ❌ | 创建 / 复杂查询 |
| DELETE | ✅ | ❌ | 删除 |

**幂等**：同样请求发 N 次结果一样。
**安全**：不修改服务器状态。

### 状态码语义

```
200 OK           成功（GET/PUT/PATCH/DELETE）
201 Created      创建成功（POST），带 Location 头
202 Accepted     已接受，异步处理中
204 No Content   成功，无响应体
304 Not Modified 资源未变（用 ETag）
400 Bad Request  请求格式错
401 Unauthorized 未认证 / 认证失败
403 Forbidden    已认证，但无权限
404 Not Found    资源不存在
409 Conflict     资源冲突（重复注册）
422 Unprocessable 语义错误（比如密码太短）
429 Too Many     限流
500 Internal     服务端错误
502 Bad Gateway  上游错误
503 Unavailable  服务暂不可用
```

### 项目里的状态码使用

| 端点 | 状态码 | 评价 |
|------|--------|------|
| POST /register 成功 | 201 | ✅ |
| POST /register 重复 | 409 | ✅ |
| POST /login 成功 | 200 | ✅ |
| POST /login 失败 | 401 | ✅ |
| GET /me 不存在 | 404 | ✅ |
| GET /protected 无 token | 401 | ✅ |
| GET /whoami auth 挂了 | 503 | ✅ |

**评价**：项目状态码用得挺规范，符合 REST 语义。

## 错误响应格式

### 反例：消息不统一

```json
// 有的返回
{ "error": "not found" }

// 有的返回
{ "message": "user not found" }

// 有的返回
{ "detail": "xxx" }
```

**问题**：客户端要写多套解析逻辑。

### 正例：统一格式

```json
{
  "error": {
    "code": "USER_NOT_FOUND",
    "message": "用户不存在",
    "details": { "username": "alice" }
  }
}
```

**或者 RFC 7807 Problem Details**：

```json
{
  "type": "https://api.example.com/errors/user-not-found",
  "title": "User Not Found",
  "status": 404,
  "detail": "用户 'alice' 不存在",
  "instance": "/api/users/alice"
}
```

### 项目里的错误格式

```js
// auth/index.js
return json(res, 400, { error: 'username and password required' });
return json(res, 401, { error: 'invalid credentials' });
return json(res, 409, { error: 'username already taken' });
return json(res, 404, { error: 'user not found' });
```

**统一格式**：`{ error: string }`，但**没有错误码**。

改进建议：

```js
return json(res, 409, {
  error: {
    code: 'USER_ALREADY_EXISTS',
    message: '用户名已被占用',
  }
});
```

## 文档化

### 方案 A：Markdown

手写 README，简单但易过期。

### 方案 B：OpenAPI / Swagger

```yaml
openapi: 3.0.0
info:
  title: Auth API
paths:
  /login:
    post:
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [username, password]
              properties:
                username: { type: string }
                password: { type: string }
      responses:
        '200':
          description: Login success
          content:
            application/json:
              schema:
                type: object
                properties:
                  token: { type: string }
```

**优点**：标准、可生成客户端代码、可在线文档
**工具**：Swagger Editor、Stoplight、Redocly

### 方案 C：AsyncAPI（异步 API）

用于事件驱动 API。

## 下一步

- 多个服务怎么保持数据一致：[08-数据一致性](./08-data-consistency.md)
- 什么时候不该拆微服务：[09-共享服务蔓延](./09-sharing-trap.md)
