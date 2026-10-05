#!/usr/bin/env bash
# 本地开发一键脚本：API(8080) + Worker + 前端(8424)。
# 用法：
#   ./dev.sh          重启语义：在运行则先停后启，未运行则直接启动（缺省）
#   ./dev.sh stop     只停止
#   ./dev.sh status   查看运行状态
# 数据库连接来自 backend/.env（远端 PostgreSQL），本脚本不管理数据库；
# 日志在 dev-logs/（*.log / *.pid 已被 .gitignore 覆盖）。

set -u
cd "$(dirname "$0")"

LOG_DIR="dev-logs"
mkdir -p "$LOG_DIR"
SCRIPT_PID=$$

start_cmd_for() {
  case "$1" in
    api)    echo 'backend|npm run api' ;;
    worker) echo 'backend|npm run worker' ;;
    web)    echo 'frontend|npm run dev' ;;
  esac
}

pattern_for() {
  case "$1" in
    api)    echo 'api/src/index[.]ts' ;;
    worker) echo 'worker/src/index[.]ts' ;;
    web)    echo 'rsbuild dev' ;;
  esac
}

port_for() {
  case "$1" in
    api) echo 8080 ;;
    web) echo 8424 ;;
    *)   echo '' ;;
  esac
}

pids_for() {
  pgrep -f "$1" 2>/dev/null | grep -vx "$SCRIPT_PID" | tr '\n' ' ' || true
}

stop_one() {
  local name="$1" pattern pids port
  pattern="$(pattern_for "$name")"
  pids="$(pids_for "$pattern")"
  port="$(port_for "$name")"
  if [ -n "$port" ]; then
    # 端口兜底：cmdline 不匹配但占着端口的残留监听一并停掉
    pids="$pids $(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  fi
  pids="$(echo $pids | tr ' ' '\n' | sort -u | grep -v '^$' | tr '\n' ' ')"
  if [ -z "${pids// /}" ]; then
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
  echo "  x ${name}：已停止（pid ${pids}）"
}

start_one() {
  local name="$1" spec dir cmd log
  spec="$(start_cmd_for "$name")"
  dir="${spec%%|*}"
  cmd="${spec#*|}"
  log="$LOG_DIR/$name.log"
  nohup bash -c "cd '$dir' && exec $cmd" > "$log" 2>&1 &
  echo $! > "$LOG_DIR/$name.pid"
  echo "  > ${name}：启动中（pid ${!}，日志 ${log}）"
}

wait_http() {
  local name="$1" url="$2" pidfile="$LOG_DIR/$1.pid" i pid
  for i in $(seq 1 30); do
    if curl -sf --noproxy '*' -o /dev/null "$url" 2>/dev/null; then
      echo "  ok ${name} 就绪（${url}）"
      return 0
    fi
    pid="$(cat "$pidfile" 2>/dev/null || echo '')"
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
      echo "  !! $name 进程已退出，最近日志："
      tail -5 "$LOG_DIR/$name.log" | sed 's/^/     /'
      return 1
    fi
    sleep 1
  done
  echo "  !! ${name} 30 秒未就绪（${url}），最近日志："
  tail -5 "$LOG_DIR/$name.log" | sed 's/^/     /'
  return 1
}

wait_alive() {
  local name="$1" pidfile="$LOG_DIR/$1.pid" pid
  sleep 2
  pid="$(cat "$pidfile" 2>/dev/null || echo '')"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "  ok ${name} 进程存活（pid ${pid}，日志 $LOG_DIR/$name.log）"
  else
    echo "  !! $name 启动即退出，最近日志："
    tail -5 "$LOG_DIR/$name.log" | sed 's/^/     /'
    return 1
  fi
}

db_preflight() {
  local db_url
  db_url="$(grep -E '^DATABASE_URL=' backend/.env 2>/dev/null | head -1 | cut -d= -f2-)"
  if [ -z "$db_url" ]; then
    echo "  ! backend/.env 无 DATABASE_URL，跳过数据库预检"
    return 0
  fi
  (cd backend && DATABASE_URL="$db_url" node -e '
    const pg = require("pg");
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
    c.connect()
      .then(() => c.end())
      .then(() => console.log("  ok 数据库可达"))
      .catch(() => console.log("  !! 数据库不可达，服务会启动但请求会报错"));
  ' 2>/dev/null)
}

case "${1:-start}" in
  stop)
    echo "== 停止本地服务 =="
    for s in web worker api; do stop_one "$s"; done
    ;;
  status)
    echo "== 本地服务状态 =="
    for s in api worker web; do
      pattern="$(pattern_for "$s")"
      pids="$(pids_for "$pattern")"
      if [ -n "${pids// /}" ]; then
        echo "  on ${s} 运行中（pid ${pids}）"
      else
        echo "  off $s 未运行"
      fi
    done
    ;;
  start)
    echo "== 停止已在运行的实例（如有）=="
    for s in web worker api; do stop_one "$s"; done
    echo "== 数据库预检 =="
    db_preflight
    echo "== 启动 =="
    start_one api
    start_one worker
    start_one web
    echo "== 就绪检查 =="
    ok=0
    # 探活用 localhost：api 只监听 IPv4、rsbuild dev 只监听 IPv6 的 ::1，
    # localhost 让 curl 自行尝试全部解析地址；--noproxy 避免本机代理拦截
    wait_http api http://localhost:8080/health || ok=1
    wait_alive worker || ok=1
    wait_http web http://localhost:8424/ || ok=1
    if [ "$ok" = 0 ]; then
      echo "== 全部就绪：打开 http://localhost:8424 =="
    else
      echo "== 有服务未就绪，详见 dev-logs/*.log =="
      exit 1
    fi
    ;;
  *)
    echo "用法：./dev.sh [start|stop|status]（缺省 start = 重启语义）"
    exit 1
    ;;
esac
