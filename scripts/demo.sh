#!/usr/bin/env bash
# 演示脚本：把"服务间调用"跑一遍，让你看清 token 怎么流转
# 用法：bash scripts/demo.sh
#
# 假设三个服务已经在跑。如果没跑，先执行：bash scripts/start-all.sh
set -e
cd "$(dirname "$0")/.."

GW="http://localhost:3002"

hr() { echo ""; echo "========================================"; }

hr
echo "STEP 1: 注册新用户 alice"
echo "========================================"
curl -sS -X POST "$GW/api/auth/register" \
  -H "content-type: application/json" \
  -d '{"username":"alice","password":"secret123"}'
echo ""

hr
echo "STEP 2: 登录拿 JWT"
echo "========================================"
LOGIN_RESP=$(curl -sS -X POST "$GW/api/auth/login" \
  -H "content-type: application/json" \
  -d '{"username":"alice","password":"secret123"}')
echo "$LOGIN_RESP"
TOKEN=$(echo "$LOGIN_RESP" | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).token))')
echo ""
echo "Token (前 60 字符): ${TOKEN:0:60}..."

hr
echo "STEP 3: 不带 token 调 /api/hello/protected -> 应该 401"
echo "========================================"
curl -sS -i "$GW/api/hello/protected" 2>&1 | head -10
echo ""

hr
echo "STEP 4: 带 token 调 /api/hello/protected -> 应该 200 + hello, alice"
echo "========================================"
curl -sS -i "$GW/api/hello/protected" \
  -H "Authorization: Bearer $TOKEN" 2>&1 | head -15
echo ""

hr
echo "STEP 5: /api/hello/whoami -> 演示服务间调用（hello 反查 auth）"
echo "========================================"
curl -sS -i "$GW/api/hello/whoami" \
  -H "Authorization: Bearer $TOKEN" 2>&1 | head -15
echo ""

hr
echo "STEP 6: 故意用错误 token -> 应该 401"
echo "========================================"
curl -sS -i "$GW/api/hello/protected" \
  -H "Authorization: Bearer invalid.token.here" 2>&1 | head -10
echo ""

hr
echo "STEP 7: 公开端点（不走 auth，对比用）"
echo "========================================"
curl -sS -i "$GW/api/hello/public" 2>&1 | head -10
echo ""

hr
echo "STEP 8: 看 trace-id 是否贯穿整个调用链"
echo "========================================"
echo "请求 /api/hello/whoami 并只看响应头的 x-trace-id:"
TRACE=$(curl -sS -i "$GW/api/hello/whoami" \
  -H "Authorization: Bearer $TOKEN" 2>&1 | grep -i 'x-trace-id' | awk '{print $2}' | tr -d '\r')
echo "  x-trace-id: $TRACE"
echo ""
echo "用这个 trace-id 去三个服务的日志里搜，应该能在 gateway/hello/auth 三处都找到它"
echo ""
echo "演示完成。"
