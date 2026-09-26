#!/usr/bin/env bash
# 启动 3 个微服务（auth :3000 / hello :3001 / gateway :3002）
# 用法：bash scripts/start-all.sh
# 停止：Ctrl+C
set -e
cd "$(dirname "$0")/.."

# 强制用 Node v24（避免 v26 npm 崩）
export PATH="C:/Users/aww/AppData/Roaming/fnm/node-versions/v24.18.0/installation:$PATH"

echo "========================================"
echo "  Starting 3 microservices"
echo "  auth    :3000"
echo "  hello   :3001"
echo "  gateway :3002"
echo "========================================"
echo ""

node auth/index.js &
PID_AUTH=$!

sleep 0.5
node hello/index.js &
PID_HELLO=$!

sleep 0.5
node gateway/index.js &
PID_GW=$!

echo "PIDs: auth=$PID_AUTH  hello=$PID_HELLO  gateway=$PID_GW"
echo ""
echo "Press Ctrl+C to stop all."
echo ""

# Ctrl+C 时杀所有子进程
trap 'echo; echo "Shutting down..."; kill $PID_AUTH $PID_HELLO $PID_GW 2>/dev/null; wait' INT TERM

wait
