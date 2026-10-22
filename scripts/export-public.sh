#!/usr/bin/env bash
# 把仓库里「可以公开」的部分导出到一个干净的 git 仓库，用于推送到 GitHub。
#
# 为什么不直接 push 当前仓库：
#   1. `资源库/` 的 134 个 PDF（1.14 GiB）在提交历史里（初期误入），
#      单个文件超过 GitHub 的 100 MiB 上限，推送会被直接拒绝；
#   2. 这些 PDF 与 `content/` 下的切片文本是版权材料，不应分发；
#   3. `.scratch/` 里有一次性脚本，历史上曾把 API key 写进过脚本常量。
#
# 用法：
#   scripts/export-public.sh [目标目录]        # 默认 ../starmap-public
#
# 导出后由调用方决定是否 git init / push。脚本本身只做三件事：
# 白名单复制 → 密钥扫描（发现即失败）→ 打印体积。

set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$SRC/../starmap-public}"

# 白名单：只导出这些顶层路径
INCLUDE=(
  apps packages tools scripts docs skills
  .scratch/starmap-core
  package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json
  README.md GLOSSARY.md AGENTS.md .gitignore .env.example
)

# 排除：构建产物、依赖、一次性探针、任何 .env 实体
EXCLUDES=(
  node_modules dist coverage __pycache__ .vitest test-results playwright-report
  .scratch .env .env.local '*.pyc' '*.tsbuildinfo' '.agent-teams' '.DS_Store'
)

echo "源目录: $SRC"
echo "目标:   $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"

exists=()
for p in "${INCLUDE[@]}"; do [ -e "$SRC/$p" ] && exists+=("$p"); done

tar_args=()
for e in "${EXCLUDES[@]}"; do tar_args+=(--exclude="$e"); done

( cd "$SRC" && tar cf - "${tar_args[@]}" "${exists[@]}" ) | ( cd "$DEST" && tar xf - )

# `docs/spec/` 是规格与票据（白名单里但会被 .scratch 的通配排掉），
# 单独搬一份到 docs/spec/ —— 这是本项目最有价值的文档，不该因为目录名叫 scratch 就丢掉。
if [ -d "$SRC/.scratch/starmap-core" ]; then
  mkdir -p "$DEST/docs/spec"
  ( cd "$SRC/.scratch/starmap-core" && tar cf - . ) | ( cd "$DEST/docs/spec" && tar xf - )
  # 导出树里路径变了，把文档中的引用一并改写，否则读者点开是死链
  grep -rl '\docs/spec/' "$DEST" 2>/dev/null | while read -r f; do
    sed -i 's#\docs/spec/#docs/spec/#g' "$f"
  done
fi

# 密钥扫描：宁可失败，也不要推上去再删（历史里删不掉）
echo
echo "=== 密钥扫描 ==="
if grep -rIlE 'sk-[A-Za-z0-9]{24,}|gho_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----' "$DEST" 2>/dev/null; then
  echo "!! 上面这些文件里疑似有密钥，已中止。请先清理再导出。" >&2
  exit 1
fi
echo "未发现密钥"

# 断言真正的语料与产物没有被带出去
for forbidden in 资源库 content node_modules .scratch/issues; do
  if [ -e "$DEST/$forbidden" ] && [ "$forbidden" != ".scratch/issues" ]; then
    echo "!! 目标目录意外包含 $forbidden，已中止。" >&2
    exit 1
  fi
done

echo
echo "=== 体积 ==="
du -sh "$DEST" 2>/dev/null || true
echo "文件数: $(find "$DEST" -type f | wc -l)"
echo
echo "完成。下一步："
echo "  cd \"$DEST\" && git init -b main && git add -A && git commit -m 'chore: initial commit'"
echo "  gh repo create <owner>/starmap --private --source=. --push"
