#!/usr/bin/env bash
# req-*.sh 共用函数。流程说明见 docs/dev-test-workflow.md。
# 兼容 macOS 自带的 bash 3.2：不用关联数组和 mapfile；紧贴中文的变量要写成 ${var}，否则全角字符会被吃进变量名。

set -euo pipefail

REQ_PREFIX="AISLG"
# 根目录下有 test/ 目录，裸写 test 在 git 里有歧义，一律用完整引用名
TEST_REF="refs/heads/test"
DEVELOP_REF="refs/heads/develop"

# 被 gitignore 但运行或协作要用的文件，软链到新 worktree，只维护主目录这一份
LINKED_PATHS="backend/.env frontend/.env.local backend/config/chat-banned-words.txt CLAUDE.local.md wechat-minigame node_modules backend/node_modules frontend/node_modules mcp/node_modules"

MAIN_DIR="$(git worktree list --porcelain | sed -n '1s/^worktree //p')"
[ -n "$MAIN_DIR" ] || { echo "错误：请在 slg 仓库内运行" >&2; exit 1; }
PARENT_DIR="$(dirname "$MAIN_DIR")"
TEST_DIR="$PARENT_DIR/test"

die() { echo "错误：$*" >&2; exit 1; }
info() { echo "== $*"; }

check_req() {
  echo "$1" | grep -Eq "^$REQ_PREFIX-[0-9]+$" || die "需求号格式应为 $REQ_PREFIX-数字，收到：$1"
}

# 短标题：汉字、字母、数字、-、_，1 到 20 字
check_title() {
  perl -CA -e 'exit($ARGV[0] =~ /\A[\p{Han}A-Za-z0-9_-]{1,20}\z/ ? 0 : 1)' -- "$1" \
    || die "短标题只能用汉字、字母、数字、-、_，不超过 20 字，收到：$1"
}

# 需求号对应的分支，不存在时输出空。AISLG-2-* 不会匹配 AISLG-29-*
req_branches() {
  git for-each-ref --format='%(refname:lstrip=2)' "refs/heads/$1-*"
}

req_branch() {
  local found count
  found="$(req_branches "$1")"
  [ -n "$found" ] || die "找不到 $1 的分支，先运行 scripts/req-start.sh"
  count="$(echo "$found" | wc -l | tr -d ' ')"
  [ "$count" = 1 ] || die "$1 对应多个分支：$found"
  echo "$found"
}

# 分支所在的 worktree 路径，没有检出时输出空
worktree_of() {
  git worktree list --porcelain | awk -v want="branch refs/heads/$1" '
    /^worktree / { dir = substr($0, 10) }
    $0 == want { print dir; exit }'
}

# 只看已跟踪文件：测试目录里的临时脚本等未跟踪文件不挡合并
ensure_clean() {
  [ -z "$(git -C "$1" status --porcelain --untracked-files=no)" ] \
    || die "$1 有未提交的改动，先提交或还原：
$(git -C "$1" status --short --untracked-files=no)"
}

ensure_no_merge() {
  if git -C "$1" rev-parse -q --verify MERGE_HEAD >/dev/null; then
    die "$1 还有未完成的合并，解决冲突并 git commit 后再重跑"
  fi
}

warn_untracked() {
  local files
  files="$(git -C "$1" ls-files --others --exclude-standard)"
  [ -z "$files" ] || { echo "注意：$1 有未跟踪文件，不会进入合并："; echo "$files" | sed 's/^/  /'; }
}

is_ancestor() { git merge-base --is-ancestor "$1" "$2"; }

link_ignored() {
  local dir="$1" path
  for path in $LINKED_PATHS; do
    [ -e "$MAIN_DIR/$path" ] || continue
    [ -e "$dir/$path" ] || [ -L "$dir/$path" ] && continue
    mkdir -p "$(dirname "$dir/$path")"
    ln -s "$MAIN_DIR/$path" "$dir/$path"
  done
}

# merge_or_stop 目录 来源引用 合并提交信息 冲突时的下一步说明
merge_or_stop() {
  local dir="$1" ref="$2" message="$3" next="$4"
  git -C "$dir" merge --no-ff -m "$message" "$ref" && return 0
  git -C "$dir" rev-parse -q --verify MERGE_HEAD >/dev/null || die "合并失败，见上方 git 输出"
  echo >&2
  echo "合并冲突，已停在 ${dir}：" >&2
  git -C "$dir" diff --name-only --diff-filter=U | sed 's/^/  /' >&2
  echo "协议号和生成文档的解法见 docs/dev-test-workflow.md 的“固定冲突文件”。" >&2
  echo "$next" >&2
  exit 2
}

# 合并后的快速校验，十秒左右：类型、协议文档、变更清单连续性、MCP 清单副本
verify() {
  local dir="$1" file
  info "校验 $dir"
  (cd "$dir/backend" && npm run -s typecheck && npm run -s check:api-doc \
    && npx tsx --test --test-reporter=dot test/protocol-changelog.test.ts) \
    || die "$dir 后端校验失败"
  (cd "$dir/frontend" && npm run -s typecheck) || die "$dir 前端类型检查失败"
  for file in agent-api.json agent-api.md; do
    cmp -s "$dir/docs/$file" "$dir/mcp/manifest/$file" \
      || die "mcp/manifest/$file 与 docs 不一致，在 mcp/ 下运行 npm run sync:manifest 后提交"
  done
}
