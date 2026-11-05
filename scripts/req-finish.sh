#!/usr/bin/env bash
# 测试通过后：需求分支合进 develop，再删 worktree 和分支。只做本地合并，不推送。
# 用法：scripts/req-finish.sh [--force] [--keep] AISLG-229
#   --force  不要求已合入 test，只用于纯文档、脚本类改动
#   --keep   只合并，保留 worktree 和分支

source "$(dirname "$0")/req-lib.sh"

force=0
keep=0
req=""
for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    --keep) keep=1 ;;
    -*) die "未知参数：$arg" ;;
    *) [ -z "$req" ] || die "只能指定一个需求号"; req="$arg" ;;
  esac
done
[ -n "$req" ] || die "用法：scripts/req-finish.sh [--force] [--keep] $REQ_PREFIX-229"
check_req "$req"

branch="$(req_branch "$req")"
branch_ref="refs/heads/$branch"
dir="$(worktree_of "$branch")"
develop_dir="$(worktree_of develop)"
[ -n "$dir" ] || die "$branch 没有 worktree"
[ -n "$develop_dir" ] || die "develop 没有检出，先在主目录 git switch develop"
ensure_no_merge "$dir"
ensure_clean "$dir"
ensure_clean "$develop_dir"
warn_untracked "$dir"

require_tested() {
  [ "$force" = 1 ] && return 0
  git show-ref --verify -q "$TEST_REF" && is_ancestor "$branch_ref" "$TEST_REF" \
    || die "$branch 的最新提交不在 test 里，先运行 scripts/req-to-test.sh ${req}（纯文档、脚本类改动可加 --force）"
}

# 这里的顺序决定回归范围：先查已测试再同步，干净同步不用重测；
# 手工解决的冲突提交不在 test 里，重跑时会被要求重新提测
require_tested
if ! is_ancestor "$DEVELOP_REF" "$branch_ref"; then
  info "develop 有新提交，同步到 $branch"
  merge_or_stop "$dir" "$DEVELOP_REF" "${branch}：同步 develop" \
    "解决并 git commit 后，先重跑 scripts/req-to-test.sh $req 回归，再运行 req-finish.sh"
fi
verify "$dir"

info "合并 $branch 到 develop"
merge_or_stop "$develop_dir" "$branch_ref" "${branch}：合入 develop" "解决并 git commit 后，重跑本脚本"

if [ "$keep" = 1 ]; then
  info "已合入 develop，按 --keep 保留 $dir 和分支 $branch"
  exit 0
fi

"$dir/dev.sh" stop >/dev/null
# 脚本可能在需求目录里运行，删目录前先离开，否则后面的 git 命令找不到当前目录
cd "$develop_dir"
git worktree remove "$dir" \
  || die "已合入 develop，但 $dir 没删掉：查看上方提示，确认未跟踪文件不要后手动清理"
git branch -d "$branch"
info "$branch 已合入 develop，worktree 和分支已删除（未推送）"
