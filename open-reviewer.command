#!/bin/zsh
set -eu

ROOT="${0:A:h}"
PORT=4616
setopt NULL_GLOB
comparison_files=("$ROOT"/comparisons/*/decisions.json(.om))
if (( ${#comparison_files} == 0 )); then
  echo "还没有可研究的对局，请先运行一次 AI 对比。"
  read -k 1 "?按任意键关闭…"
  exit 1
fi
COMPARISON="${comparison_files[1]:h}"
COMPARISON_NAME="${COMPARISON:t}"
REPORT="$COMPARISON/killer-report.json"
URL="http://127.0.0.1:${PORT}/killer-reviewer/?data=/comparisons/${COMPARISON_NAME}/killer-report.json"
PID_FILE="$ROOT/logs/reviewer.pid"
LOG_FILE="$ROOT/logs/reviewer.log"

mkdir -p "$ROOT/logs"

if [[ ! -f "$REPORT" || "$COMPARISON/decisions.json" -nt "$REPORT" ]]; then
  node "$ROOT/tools/build-killer-report.js" "$COMPARISON" "$REPORT"
fi

if [[ -f "$PID_FILE" ]] && kill -0 "$(<"$PID_FILE")" 2>/dev/null; then
  open "$URL"
  exit 0
fi

cd "$ROOT"
nohup env MORTAL_REVIEWER_PORT="$PORT" node reviewer/server.js >"$LOG_FILE" 2>&1 &
print $! > "$PID_FILE"

for _ in {1..30}; do
  if curl -fsS "$URL" >/dev/null 2>&1; then
    open "$URL"
    exit 0
  fi
  sleep 0.1
done

echo "无法启动研究页面，请查看：$LOG_FILE"
read -k 1 "?按任意键关闭…"
