#!/bin/zsh

set -u

ROOT=${0:A:h}

kill_tree() {
  local PID=$1
  local CHILD
  for CHILD in $(pgrep -P "$PID" 2>/dev/null); do
    kill_tree "$CHILD"
  done
  kill "$PID" 2>/dev/null || true
}

for PID_FILE in "$ROOT/runtime/bots.pid" "$ROOT/runtime/server.pid"; do
  if [[ ! -f "$PID_FILE" ]]; then
    continue
  fi
  while read -r PID; do
    if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
      kill_tree "$PID"
    fi
  done < "$PID_FILE"
  rm -f "$PID_FILE"
done

print "本地牌桌和 Mortal 已停止。"
sleep 1
