#!/usr/bin/env bash
#
# Updates a running install: backs up, pulls, reinstalls dependencies, restarts.
#
#   sudo bash /opt/durlevel/deploy/update.sh            # from the repo on disk
#   sudo SRC=/root/agent/website bash .../update.sh     # from a fresh checkout
#
# The database migrates itself on boot, so there is no migration step here.
# .env, data/ and public/uploads/ are never touched.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/durlevel}"
APP_USER="${APP_USER:-durlevel}"
SRC="${SRC:-}"

say() { printf '\n\033[1;32m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 运行。"
[ -d "$APP_DIR" ] || die "找不到 $APP_DIR，先跑 deploy/install.sh。"

say "1/5 先备份"
bash "$APP_DIR/deploy/backup.sh"

if [ -n "$SRC" ]; then
  say "2/5 从 $SRC 同步代码"
  [ -f "$SRC/server.js" ] || die "$SRC 里没有 server.js。"
  rsync -a --delete \
    --exclude '.env' --exclude 'data/' --exclude 'node_modules/' \
    --exclude 'public/uploads/' --exclude '.git/' \
    "$SRC"/ "$APP_DIR"/
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
elif [ -d "$APP_DIR/.git" ]; then
  say "2/5 git pull"
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only
else
  die "$APP_DIR 不是 git 仓库，请用 SRC=/路径/到/新代码 指定来源。"
fi

say "3/5 安装依赖"
sudo -u "$APP_USER" env HOME="/home/$APP_USER" npm ci --omit=dev --prefix "$APP_DIR"

say "4/5 刷新 systemd 单元"
sed -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__APP_USER__|$APP_USER|g" \
  "$APP_DIR/deploy/durlevel.service" > /etc/systemd/system/durlevel.service
systemctl daemon-reload

say "5/5 重启"
systemctl restart durlevel
sleep 2
if systemctl is-active --quiet durlevel; then
  echo "    服务正常运行。"
else
  journalctl -u durlevel -n 30 --no-pager || true
  die "重启后服务没起来。备份在 ${APP_DIR}/backups 里，可以回滚。"
fi
