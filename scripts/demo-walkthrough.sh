#!/usr/bin/env bash
# 一键演示：依次跑 4 个出厂剧本 + approve 路径。
# 把 demo 当作"现场录像"：每一节都能直接被截图当 talk material。
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

HARNESS="pnpm --silent harness"

# ANSI 颜色（终端不支持时 NO_COLOR=1 关闭）
if [[ "${NO_COLOR:-}" == "" && -t 1 ]]; then
  BOLD=$'\033[1m'
  DIM=$'\033[2m'
  CYAN=$'\033[36m'
  YELLOW=$'\033[33m'
  RESET=$'\033[0m'
else
  BOLD=""; DIM=""; CYAN=""; YELLOW=""; RESET=""
fi

section() {
  local title="$1"
  echo
  echo "${CYAN}══════════════════════════════════════════════════════════${RESET}"
  echo "${BOLD}  $title${RESET}"
  echo "${CYAN}══════════════════════════════════════════════════════════${RESET}"
}

step() {
  local title="$1"
  echo
  echo "${YELLOW}── $title ──${RESET}"
}

# ---------------------------------------------------------------------------

section "HARNESS ENGINEERING DEMO · 4 个出厂剧本"
echo "${DIM}本脚本会清空当前 runs/ 并重新 seed 数据库，然后依次演示${RESET}"
echo "${DIM}happy path / PII 拦截 / 缺时间过滤 / 写操作审批 四个场景。${RESET}"

bash "$DIR/scripts/reset.sh"

# ---------- 剧本 A ----------
section "剧本 A · happy path（自动放行）"
step "输入"
echo '  上个月销售前 5 的产品'
step "harness ask 输出"
$HARNESS ask "上个月销售前 5 的产品" || true

# ---------- 剧本 B ----------
section "剧本 B · Policy 拦截 PII 字段"
step "输入"
echo '  导出所有客户的邮箱和手机号'
step "harness ask 输出"
$HARNESS ask "导出所有客户的邮箱和手机号" || true

# ---------- 剧本 C ----------
section "剧本 C · Policy 拦截缺 WHERE 时间过滤"
step "输入"
echo '  orders 表里有多少行'
step "harness ask 输出"
$HARNESS ask "orders 表里有多少行" || true

# ---------- 剧本 D · 第一阶段（pending-approval）----------
section "剧本 D · 写操作 → Approval Gate"
step "输入"
echo '  把已经发货 90 天还没确认收货的订单标记为已完成'
step "harness ask 输出（落到 pending-approval）"
$HARNESS ask "把已经发货 90 天还没确认收货的订单标记为已完成" || true

# 抓最近的 pending run id
PENDING_ID="$(
  for d in $(ls -t runs/); do
    if [[ -f "runs/$d/status" ]] && [[ "$(cat runs/$d/status)" == "pending-approval" ]]; then
      echo "$d"
      break
    fi
  done
)"

if [[ -z "${PENDING_ID:-}" ]]; then
  echo "${YELLOW}!! 没找到 pending-approval 的 run，跳过 approve 步骤${RESET}"
else
  step "查看 pending 报告（截取前 30 行）"
  $HARNESS show "$PENDING_ID" | head -30
  echo "${DIM}  ... (完整 report.md 见 runs/$PENDING_ID/report.md)${RESET}"

  step "harness approve $PENDING_ID"
  $HARNESS approve "$PENDING_ID"

  step "approve 之后 audit_log 的内容"
  sqlite3 data/demo.sqlite \
    "SELECT id, run_id, target_table, after_json, at FROM audit_log;" \
    2>/dev/null || echo "(sqlite3 不可用，跳过)"
fi

# ---------- 总结 ----------
section "harness runs · 全部运行汇总"
$HARNESS runs

section "完成"
echo "${DIM}查看任意运行的报告：${RESET}"
echo "  pnpm harness show <run-id>"
echo
echo "${DIM}查看任意运行的事件流：${RESET}"
echo "  cat runs/<run-id>/trace.jsonl | jq -c '{stage, kind}'"
