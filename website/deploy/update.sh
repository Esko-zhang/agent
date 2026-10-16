#!/usr/bin/env bash
#
# Updates a running install: backs up, fetches the new code, reinstalls
# dependencies, restarts.
#
#   sudo bash /opt/durlevel/deploy/update.sh         # fetch from GitHub
#   sudo SRC=~/agent/website bash .../update.sh      # from a checkout on disk
#
# Where the code comes from, in order: SRC if given; a git checkout at APP_DIR
# if the install was made from one; otherwise a shallow clone of BRANCH, so a
# plain `update.sh` works on an install that has no .git of its own.
#
# The database migrates itself on boot, so there is no migration step here.
# .env, data/ and public/uploads/ are never touched.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/durlevel}"
APP_USER="${APP_USER:-durlevel}"
SRC="${SRC:-}"
REPO="${REPO:-https://github.com/Esko-zhang/agent.git}"
BRANCH="${BRANCH:-claude/adoring-shannon-88sms1}"
TMPDIR_CLONE=""

say() { printf '\n\033[1;32m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 运行。"
[ -d "$APP_DIR" ] || die "找不到 $APP_DIR，先跑 deploy/install.sh。"

cleanup() { [ -n "$TMPDIR_CLONE" ] && rm -rf "$TMPDIR_CLONE"; }
trap cleanup EXIT

say "1/5 先备份"
bash "$APP_DIR/deploy/backup.sh"

if [ -z "$SRC" ] && [ -d "$APP_DIR/.git" ]; then
  say "2/5 git pull"
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only
else
  if [ -z "$SRC" ]; then
    command -v git >/dev/null 2>&1 || die "需要 git：apt-get install -y git"
    say "2/5 从 GitHub 拉取最新代码（分支 $BRANCH）"
    TMPDIR_CLONE="$(mktemp -d)"
    git clone --depth 1 -b "$BRANCH" "$REPO" "$TMPDIR_CLONE/repo" >/dev/null 2>&1 \
      || die "拉取失败：检查服务器能否访问 $REPO"
    SRC="$TMPDIR_CLONE/repo/website"
  else
    say "2/5 从 $SRC 同步代码"
  fi
  [ -f "$SRC/server.js" ] || die "$SRC 里没有 server.js。"
  # .env, the database and uploaded files stay as they are.
  rsync -a --delete \
    --exclude '.env' --exclude 'data/' --exclude 'node_modules/' \
    --exclude 'public/uploads/' --exclude '.git/' --exclude 'backups/' \
    "$SRC"/ "$APP_DIR"/
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
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
