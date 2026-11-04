#!/usr/bin/env bash
# 提测：需求分支先同步 develop，再合进 test。遇到冲突就停，解决并提交后重跑。
# 用法：scripts/req-to-test.sh [--reset] AISLG-229
#   --reset  先把 test 重置成 develop，并列出需要重新合入的需求

source "$(dirname "$0")/req-lib.sh"

reset=0
req=""
for arg in "$@"; do
  case "$arg" in
    --reset) reset=1 ;;
    -*) die "未知参数：$arg" ;;
    *) [ -z "$req" ] || die "只能指定一个需求号"; req="$arg" ;;
  esac
done
[ -n "$req" ] || die "用法：scripts/req-to-test.sh [--reset] $REQ_PREFIX-229"
check_req "$req"

branch="$(req_branch "$req")"
dir="$(worktree_of "$branch")"
[ -n "$dir" ] || die "$branch 没有 worktree"
ensure_no_merge "$dir"
ensure_clean "$dir"
warn_untracked "$dir"
[ "$(git rev-list --count --no-merges "$DEVELOP_REF..refs/heads/$branch")" != 0 ] \
  || die "$branch 相对 develop 没有新提交"

info "同步 develop 到 $branch"
merge_or_stop "$dir" "$DEVELOP_REF" "${branch}：同步 develop" \
  "解决并 git commit 后，重跑 scripts/req-to-test.sh $req"
verify "$dir"

# test 第一次使用时从 develop 建出来
if ! git show-ref --verify -q "$TEST_REF"; then
  git worktree add -b test "$TEST_DIR" "$DEVELOP_REF"
fi
test_dir="$(worktree_of test)"
if [ -z "$test_dir" ]; then
  git worktree add "$TEST_DIR" test
  test_dir="$TEST_DIR"
fi
link_ignored "$test_dir"
ensure_no_merge "$test_dir"
ensure_clean "$test_dir"

if [ "$reset" = 1 ]; then
  pending=""
  for other in $(git for-each-ref --format='%(refname:lstrip=2)' "refs/heads/$REQ_PREFIX-*"); do
    [ "$other" != "$branch" ] || continue
    base="$(git merge-base "$TEST_REF" "refs/heads/$other")"
    is_ancestor "$base" "$DEVELOP_REF" || pending="$pending $other"
  done
  info "重置 test 到 develop（原位置 $(git rev-parse --short "$TEST_REF")）"
  git -C "$test_dir" reset --hard "$DEVELOP_REF"
fi

info "合并 $branch 到 test"
merge_or_stop "$test_dir" "refs/heads/$branch" "${branch}：合入 test" \
  "这里的冲突只在 test 上解决，不回写需求分支。解决并 git commit 后，重跑 scripts/req-to-test.sh $req"
verify "$test_dir"

info "$branch 已合入 test"
echo "重启测试服务：cd $test_dir && API_PORT=9091 WEB_PORT=8425 ./dev.sh"
echo "这条命令会起 Worker，同一时刻只能有一个。先停别处的：cd $MAIN_DIR && SERVICES=worker ./dev.sh stop"
if [ "$reset" = 1 ] && [ -n "$pending" ]; then
  echo "重置前还在 test 里的需求，仍要测试的请重新提测：$pending"
fi
