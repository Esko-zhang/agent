#!/usr/bin/env bash
# =============================================================================
# 填写 / 修改发信邮箱（SMTP）设置。
#
#   sudo bash /opt/durlevel/deploy/set-smtp.sh
#
# 为什么要有这个脚本，而不是直接用 nano 改 .env：
#   - 在 nano 里粘贴，很容易和下一行的注释连在一起，结果 SMTP_FROM 变成
#     「邮箱地址 + 一段注释」。dotenv 会把注释去掉，systemd 不会，于是
#     `npm run mail-test` 显示成功、真实邮件却发不出去；
#   - 同一个键写两遍时，后面那行会覆盖前面那行，而两行可能隔着几十行；
#   - Ctrl+O 里的 O 是字母，按成数字 0 就没保存。
# 这个脚本把旧的 SMTP 行全部清掉再写一份干净的，并且给值加引号，
# 让 dotenv 和 systemd 读出来完全一致。密码是隐藏输入，不会留在命令历史里。
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/durlevel}"
ENV_FILE="$APP_DIR/.env"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m%s\033[0m\n' "$1"; }
die()  { printf '\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

[ -f "$ENV_FILE" ] || die "找不到 $ENV_FILE。先确认站点装在 $APP_DIR，或用 APP_DIR=/你的路径 再跑一次。"
[ "$(id -u)" = "0" ] || die "需要 root：请用 sudo bash $0"

bold "发信邮箱设置  ($ENV_FILE)"
echo

# ---- 发信账号 --------------------------------------------------------------
current_user="$(grep -m1 '^SMTP_USER=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"'"'" || true)"
printf '发信邮箱（完整地址，必须是员工账号，不能是管理员/postmaster）'
[ -n "$current_user" ] && printf '\n  直接回车沿用：%s' "$current_user"
printf '\n> '
read -r smtp_user
smtp_user="${smtp_user:-$current_user}"
[ -n "$smtp_user" ] || die "发信邮箱不能为空。"
case "$smtp_user" in
  *@*.*) : ;;
  *) die "「$smtp_user」不像一个完整邮箱地址，要写成 name@example.com。" ;;
esac

# ---- 密码 ------------------------------------------------------------------
echo
echo "密码（输入时不显示，直接粘贴后回车）"
echo "  · 后台开了「三方客户端安全密码」 → 填生成的那个专用密码"
echo "  · 后台没开                      → 填网页版登录密码"
printf '> '
read -rs smtp_pass
echo
[ -n "$smtp_pass" ] || die "密码不能为空。"
case "$smtp_pass" in
  *[[:space:]]*) warn "注意：密码里含有空格，常见于复制时多选了字符。如果认证一直失败，先检查这一点。" ;;
esac

# ---- 服务器 ----------------------------------------------------------------
echo
echo "发信服务器：1) smtp.qiye.aliyun.com（默认）   2) smtp.mxhichina.com（部分租户只认这个）"
printf '> [1] '
read -r host_choice
case "${host_choice:-1}" in
  2) smtp_host="smtp.mxhichina.com" ;;
  *) smtp_host="smtp.qiye.aliyun.com" ;;
esac

# ---- 写入 ------------------------------------------------------------------
backup="$ENV_FILE.bak.$(date +%Y%m%d-%H%M%S)"
cp -p "$ENV_FILE" "$backup"

# 删掉每一行跟 SMTP 有关的旧设置：有值的、空的、被注释掉的、重复的，一律清掉。
sed -i -E '/^[[:space:]]*#?[[:space:]]*(SMTP_[A-Za-z0-9_]+|INQUIRY_NOTIFY_TO)[[:space:]]*=/d' "$ENV_FILE"
# 顺带收掉清理后可能留下的连续空行。
sed -i -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$ENV_FILE"

# 值一律加引号：这样 dotenv 和 systemd 读出来是同一个东西。
{
  printf '\n# ---- 发信邮箱（由 deploy/set-smtp.sh 写入 %s）----\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  printf 'SMTP_HOST="%s"\n' "$smtp_host"
  printf 'SMTP_PORT="465"\n'
  printf 'SMTP_SECURE="1"\n'
  printf 'SMTP_USER="%s"\n' "$smtp_user"
  printf 'SMTP_PASS="%s"\n' "$smtp_pass"
  printf 'SMTP_FROM="%s"\n' "$smtp_user"
} >> "$ENV_FILE"

# .env 的属主和权限保持原样（里面是密码，必须 600）。
owner="$(stat -c '%U:%G' "$backup")"
chown "$owner" "$ENV_FILE"
chmod 600 "$ENV_FILE"

echo
bold "已写入（备份在 $backup）"
grep -nE '^SMTP_' "$ENV_FILE" | sed -E 's/(SMTP_PASS=).*/\1"********"/' | sed 's/^/  /'

# ---- 立刻验证 --------------------------------------------------------------
echo
bold "开始验证（只连接登录，不发信）"
cd "$APP_DIR"
if npm run --silent mail-test -- --check; then
  echo
  bold "下一步"
  echo "  1. 让改动对网站生效：  sudo systemctl restart durlevel"
  echo "  2. 发一封真的测试信：  cd $APP_DIR && sudo npm run mail-test -- 你的QQ或163邮箱"
else
  echo
  warn "登录没通过。上面已经列出要查的几项；改完再跑一次这个脚本即可。"
  warn "恢复上一版配置：  sudo cp $backup $ENV_FILE"
fi
