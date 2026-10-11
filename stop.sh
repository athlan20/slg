#!/usr/bin/env bash
# 本地开发一键停止：与 dev.sh 管的三件套（API 8080 / Worker / 前端 8424）对应，
# 并兜底清掉 e2e（playwright webServer）拉起的另一组实例——前端固定 5175、API 仍占 8080、
# Worker 无端口靠 cmdline 匹配。判定口径 = cmdline 匹配 ∪ 占用已知端口。
# 用法：
#   ./stop.sh          停止所有本地开发服务（缺省）
#   ./stop.sh status   只查看运行状态，不停止
# 数据库连接来自 backend/.env（远端 PostgreSQL），本脚本不管理数据库；
# dev-logs/*.pid 由 dev.sh 维护，停止后不清理，下次 dev.sh 启动会覆盖。

set -u
cd "$(dirname "$0")"

SCRIPT_PID=$$

pattern_for() {
  case "$1" in
    api)    echo 'api/src/index[.]ts' ;;
    worker) echo 'worker/src/index[.]ts' ;;
    web)    echo 'rsbuild dev' ;;
  esac
}

ports_for() {
  case "$1" in
    api) echo '8080' ;;
    web) echo '8424 5175' ;;
    *)   echo '' ;;
  esac
}

pids_for() {
  pgrep -f "$1" 2>/dev/null | grep -vx "$SCRIPT_PID" | tr '\n' ' ' || true
}

collect_pids() {
  local name="$1" pattern pids port
  pattern="$(pattern_for "$name")"
  pids="$(pids_for "$pattern")"
  for port in $(ports_for "$name"); do
    # 端口兜底：cmdline 不匹配但占着端口的残留监听一并算上
    pids="$pids $(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  done
  echo $pids | tr ' ' '\n' | sort -u | grep -v '^$' || true
}

stop_one() {
  local name="$1" pids alive
  pids="$(collect_pids "$name")"
  if [ -z "$pids" ]; then
    echo "  - ${name}：未在运行"
    return 0
  fi
  kill $pids 2>/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    alive=0
    for pid in $pids; do
      kill -0 "$pid" 2>/dev/null && alive=1
    done
    [ "$alive" = 0 ] && break
    sleep 0.5
  done
  for pid in $pids; do
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
  done
  echo "  x ${name}：已停止（pid $(echo $pids | tr '\n' ' ')）"
}

show_status() {
  local name pids
  for name in api worker web; do
    pids="$(collect_pids "$name")"
    if [ -n "$pids" ]; then
      echo "  on ${name} 运行中（pid $(echo $pids | tr '\n' ' ')）"
    else
      echo "  off ${name} 未运行"
    fi
  done
}

case "${1:-stop}" in
  status)
    echo "== 本地服务状态（cmdline + 端口 8080/8424/5175）=="
    show_status
    ;;
  stop)
    echo "== 停止本地服务（dev.sh 三件套 + e2e 残留）=="
    for s in web worker api; do stop_one "$s"; done
    echo "== 停止后状态 =="
    show_status
    ;;
  *)
    echo "用法：./stop.sh [stop|status]（缺省 stop = 一键停止所有）"
    exit 1
    ;;
esac
