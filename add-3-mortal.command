#!/bin/zsh

set -u

ROOT=${0:A:h}
PORT=4615
SERVER_URL="http://127.0.0.1:${PORT}/server"
TABLE_URL="http://127.0.0.1:${PORT}/netplay.html"
BRIDGE="$ROOT/runtime/node_modules/.bin/mjai-bridge"
WRAPPER="$ROOT/runtime/node_modules/.bin/mortal-wrapper"
BOT_DIR="$ROOT/vendor/Akagi-MjaiBot-Mortal-main"
PID_FILE="$ROOT/runtime/bots.pid"
BOT_PIDS=()

kill_tree() {
  local PID=$1
  local CHILD
  for CHILD in $(pgrep -P "$PID" 2>/dev/null); do
    kill_tree "$CHILD"
  done
  kill "$PID" 2>/dev/null || true
}

cleanup() {
  local PID
  for PID in "${BOT_PIDS[@]}"; do
    if kill -0 "$PID" 2>/dev/null; then
      kill_tree "$PID"
    fi
  done
  rm -f "$PID_FILE"
}

trap 'cleanup; exit 0' INT TERM HUP
trap cleanup EXIT

if ! curl -fsS "$TABLE_URL" >/dev/null 2>&1; then
  print "牌桌尚未启动。请先双击 start-table.command。"
  print "按回车键关闭窗口。"
  read
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  while read -r PID; do
    if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
      print "已有 Mortal 正在运行。如需重新加入，请先运行 stop-table.command。"
      print "按回车键关闭窗口。"
      read
      exit 1
    fi
  done < "$PID_FILE"
fi

ROOM=${1:-}
if [[ -z "$ROOM" ]]; then
  print -n "请输入网页中显示的房间号："
  read -r ROOM
fi

if [[ -z "$ROOM" || "$ROOM" == *[[:space:]/]* ]]; then
  print "房间号无效。"
  print "按回车键关闭窗口。"
  read
  exit 1
fi

: > "$PID_FILE"
export PATH="$ROOT/runtime/bin:$PATH"

for N in 1 2 3; do
  LOG_FILE="$ROOT/logs/mortal-${N}.log"
  nohup "$BRIDGE" \
    --room "$ROOM" \
    --name "Mortal-${N}" \
    "$SERVER_URL" \
    "$WRAPPER" \
    -- --akagi "$BOT_DIR" \
    >"$LOG_FILE" 2>&1 &
  BOT_PIDS+=("$!")
  print "$!" >> "$PID_FILE"
done

sleep 3
FAILED=0
while read -r PID; do
  if ! kill -0 "$PID" 2>/dev/null; then
    FAILED=1
  fi
done < "$PID_FILE"

if [[ "$FAILED" == 1 ]]; then
  print "至少一个 AI 未能加入，请查看 logs/mortal-*.log。"
  print "按回车键关闭窗口。"
  read
  exit 1
fi

print "三个 Mortal 已加入房间 $ROOM。"
print "回到网页，选择规则后点击开始即可。"
print "请保持本窗口开启；关闭窗口会让 AI 离开牌桌。"
print "结束时可双击 stop-table.command，或在本窗口按 Control-C。"
open "$TABLE_URL"

wait
