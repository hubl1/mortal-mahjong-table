#!/bin/zsh

set -u

ROOT=${0:A:h}
PORT=4615
URL="http://127.0.0.1:${PORT}/netplay.html"
PID_FILE="$ROOT/runtime/server.pid"
LOG_FILE="$ROOT/logs/server.log"
SERVER="$ROOT/runtime/node_modules/.bin/majiang-server"
DOCROOT="$ROOT/vendor/Majiang-master/dist"

mkdir -p "$ROOT/logs"

if [[ -f "$PID_FILE" ]]; then
  OLD_PID=$(<"$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    print "本地牌桌已经在运行：$URL"
    open "$URL"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

nohup "$SERVER" \
  --port "$PORT" \
  --docroot "$DOCROOT" \
  --callback /netplay.html \
  --status \
  >"$LOG_FILE" 2>&1 &
SERVER_PID=$!
print "$SERVER_PID" > "$PID_FILE"

cleanup() {
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
}

trap 'cleanup; exit 0' INT TERM HUP
trap cleanup EXIT

READY=0
for _ in {1..30}; do
  if curl -fsS "$URL" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.2
done

if [[ "$READY" != 1 ]]; then
  print "牌桌启动失败。日志如下："
  tail -n 30 "$LOG_FILE"
  exit 1
fi

print "牌桌已启动：$URL"
print "网页中输入名字并注册，然后点击“ルーム作成”（创建房间）。"
print "记下房间号，再双击 add-3-mortal.command 加入三个 AI。"
print "请保持本窗口开启；关闭窗口会停止本地牌桌。"
open "$URL"

wait "$SERVER_PID"
