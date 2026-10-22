#!/usr/bin/env bash
cd /c/Users/Yhwhy/.dsh 2>/dev/null || true
cd /d/DeepSeek/starmap || exit 1
for i in $(seq 1 30); do
  out=$(node .scratch/asar_x/validate.mjs 2>&1)
  if echo "$out" | grep -q 'RELATIONSHIPS:'; then
    echo "$out" | head -25
    exit 0
  fi
  full=$(echo "$out" | grep -o "Cannot find package '[^']*'" | head -1 | sed "s/Cannot find package '//; s/'$//")
  if [ -z "$full" ]; then echo "$out" | head -25; echo "NO-MISSING-PKG"; exit 2; fi
  short=${full##*/}
  echo "round $i missing: $full -> extract $short"
  node .scratch/asar_get.mjs "$short" >/dev/null 2>&1 || { echo "extract failed for $short"; exit 3; }
  node .scratch/mklink.mjs >/dev/null
done
echo "rounds exceeded"
exit 4;
