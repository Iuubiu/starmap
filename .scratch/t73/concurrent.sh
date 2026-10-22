#!/usr/bin/env bash
# t73：并发双泳道实验 —— 两个 Playwright 进程同时跑同一份 graph.spec.ts，
# 共用 3001（真实库）与 5173（vite dev）。用来回答「共享资源竞争是否会导致红」。
set -u
ROOT=/d/DeepSeek/starmap
WEB="$ROOT/apps/web"
OUT="$ROOT/.scratch/t73"
mkdir -p "$OUT/load"

run_lane() {
  local lane="$1"
  local i
  for i in 1 2; do
    echo "===== LANE-$lane RUN $i =====" >> "$OUT/load-$lane.log"
    ( cd "$WEB" && PLAYWRIGHT_OUTPUT_DIR="$OUT/load/pw$lane-$i" \
        npx playwright test e2e/graph.spec.ts --workers=1 --reporter=line \
        >> "$OUT/load-$lane.log" 2>&1 )
    echo "EXIT=$?" >> "$OUT/load-$lane.log"
  done
  echo "LANE-$lane DONE" >> "$OUT/load-$lane.log"
}

: > "$OUT/load-a.log"
: > "$OUT/load-b.log"
run_lane A &
run_lane B &
wait
echo ALLDONE
