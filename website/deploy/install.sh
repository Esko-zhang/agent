#!/usr/bin/env bash
#
# One-shot installer for the Durlevel site on a fresh Debian/Ubuntu server.
#
#   sudo DOMAIN=catalogue.example.com bash deploy/install.sh
#
# Re-running it is safe: it never overwrites .env, never touches the database,
# and leaves an existing admin account alone. Run it again after `git pull` to
# pick up new dependencies — or use deploy/update.sh, which also takes a backup.
#
# Settings (all optional except DOMAIN, which may also be a bare IP):
#   DOMAIN=        hostname(s) Nginx answers on, space- or comma-separated —
#                  e.g. "example.com www.example.com"; the server's IP if you
#                  have no domain yet
#   APP_DIR=       where the app lives            (default /opt/durlevel)
#   APP_USER=      system user it runs as         (default durlevel)
#   PORT=          loopback port for Node         (default 3000)
#   WITH_TLS=1     also run certbot for a Let's Encrypt certificate
#   TLS_EMAIL=     expiry notices for certbot     (required with WITH_TLS=1)
#   ADMIN_PASSWORD= first admin password          (generated and printed if unset)
#   SKIP_NGINX=1   leave Nginx alone (you already have a proxy in front)
#   SRC_DIR=       copy the code from here instead of this script's checkout
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/durlevel}"
APP_USER="${APP_USER:-durlevel}"
PORT="${PORT:-3000}"
DOMAIN="${DOMAIN:-}"
WITH_TLS="${WITH_TLS:-0}"
# "a.com, www.a.com" -> "a.com www.a.com"; the first name is the canonical one.
DOMAIN="$(echo "$DOMAIN" | tr ',' ' ' | tr -s ' ' | sed 's/^ //; s/ $//')"
PRIMARY_DOMAIN="${DOMAIN%% *}"
SKIP_NGINX="${SKIP_NGINX:-0}"
NODE_MAJOR=20

# Where the code is copied FROM; defaults to the checkout this script sits in.
SRC_DIR="${SRC_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

say()  { printf '\n\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 运行：sudo DOMAIN=... bash deploy/install.sh"
command -v apt-get >/dev/null 2>&1 || die "这个脚本只覆盖 Debian / Ubuntu。其他发行版请照 deploy/README.md 手动执行同样的步骤。"
[ -f "$SRC_DIR/server.js" ] || die "没找到 server.js —— 请在仓库的 website/ 目录里运行本脚本。"
if [ "$SKIP_NGINX" != "1" ] && [ -z "$DOMAIN" ]; then
  die "需要 DOMAIN（域名或服务器 IP）。只装应用、不碰 Nginx 请加 SKIP_NGINX=1。"
fi
if [ "$WITH_TLS" = "1" ]; then
  [ -n "${TLS_EMAIL:-}" ] || die "WITH_TLS=1 时必须给 TLS_EMAIL（证书到期提醒邮箱）。"
  case "$PRIMARY_DOMAIN" in
    ''|*[!0-9.]*) : ;;
    *) die "Let's Encrypt 不给 IP 地址签证书，WITH_TLS=1 需要一个解析到本机的域名。" ;;
  esac
fi

say "1/9 安装系统依赖"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# python3/make/g++ are only needed if better-sqlite3 has no prebuilt binary for
# this platform and falls back to compiling.
apt-get install -y -qq ca-certificates curl gnupg rsync python3 make g++ >/dev/null

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]; then
  say "2/9 安装 Node.js ${NODE_MAJOR}.x"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key" \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs >/dev/null
else
  say "2/9 Node.js $(node -v) 已满足要求，跳过"
fi

say "3/9 创建运行用户 ${APP_USER}"
if id "$APP_USER" >/dev/null 2>&1; then
  echo "    已存在，跳过"
else
  useradd --system --create-home --home-dir "/home/$APP_USER" --shell /usr/sbin/nologin "$APP_USER"
fi

say "4/9 复制代码到 ${APP_DIR}"
install -d -o "$APP_USER" -g "$APP_USER" -m 0755 "$APP_DIR"
# .env, the database and uploaded files live in the target and must survive.
rsync -a --delete \
  --exclude '.env' --exclude 'data/' --exclude 'node_modules/' \
  --exclude 'public/uploads/' --exclude '.git/' \
  "$SRC_DIR"/ "$APP_DIR"/
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$APP_DIR/data" "$APP_DIR/data/docs"
install -d -o "$APP_USER" -g "$APP_USER" -m 0755 "$APP_DIR/public/uploads"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

say "5/9 安装依赖（npm ci --omit=dev）"
sudo -u "$APP_USER" env HOME="/home/$APP_USER" npm ci --omit=dev --prefix "$APP_DIR"

say "6/9 写配置文件 ${APP_DIR}/.env"
if [ -f "$APP_DIR/.env" ]; then
  echo "    已存在，原样保留（要改配置请直接编辑它）"
else
  SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  cat > "$APP_DIR/.env" <<ENVFILE
# 由 deploy/install.sh 生成于 $(date -Is)
NODE_ENV=production
SESSION_SECRET=${SECRET}

# 只监听回环地址：外网一律走 Nginx，没法绕过代理直连 ${PORT} 端口。
HOST=127.0.0.1
PORT=${PORT}
# 前面有一层 Nginx，访问记录才能拿到访客真实 IP。
TRUST_PROXY=1
COOKIE_SECURE=1

ADMIN_USERNAME=admin
ADMIN_PASSWORD=

MAX_UPLOAD_MB=5
MAX_DOC_MB=20

SESSION_TTL_HOURS=12
LOGIN_MAX_ATTEMPTS=8
LOGIN_WINDOW_MINUTES=15

# ---- 询盘邮件通知（阿里云企业邮箱）----
# 开启前先在阿里邮箱后台给该账号打开「SMTP / 三方客户端」，
# 并在「账户安全」里生成三方客户端安全密码填到 SMTP_PASS。
# SMTP_FROM 必须和 SMTP_USER 是同一个地址。填好后跑 npm run mail-test 验证。
SMTP_HOST=
SMTP_PORT=465
SMTP_SECURE=1
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
INQUIRY_NOTIFY_TO=
ENVFILE
  # A Secure cookie is only sent back over HTTPS, so leaving it on without a
  # certificate means nobody can sign in — the login form just bounces back.
  if [ "$WITH_TLS" != "1" ] && [ "$SKIP_NGINX" != "1" ]; then
    sed -i 's/^COOKIE_SECURE=1/COOKIE_SECURE=0/' "$APP_DIR/.env"
    warn "还没有 HTTPS，暂时把 COOKIE_SECURE 设成 0，否则登录会卡在登录页。"
    warn "配好证书后改回 COOKIE_SECURE=1 并 systemctl restart durlevel。"
  elif [ "$SKIP_NGINX" = "1" ]; then
    warn "SKIP_NGINX=1：保留 COOKIE_SECURE=1，前提是你自己的代理只走 HTTPS。"
    warn "如果外面是纯 HTTP，要把 .env 里的 COOKIE_SECURE 改成 0，否则登录不上。"
  fi
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
fi

say "7/9 初始化数据库和管理员账号"
sudo -u "$APP_USER" env HOME="/home/$APP_USER" ${ADMIN_PASSWORD:+ADMIN_PASSWORD="$ADMIN_PASSWORD"} \
  node "$APP_DIR/scripts/init-db.js"

say "8/9 注册 systemd 服务"
sed -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__APP_USER__|$APP_USER|g" \
  "$APP_DIR/deploy/durlevel.service" > /etc/systemd/system/durlevel.service
systemctl daemon-reload
systemctl enable --now durlevel >/dev/null
sleep 2
systemctl is-active --quiet durlevel || {
  journalctl -u durlevel -n 30 --no-pager || true
  die "服务没起来，上面是最近 30 行日志。"
}
echo "    durlevel.service 正在运行"

if [ "$SKIP_NGINX" = "1" ]; then
  say "9/9 按要求跳过 Nginx"
else
  say "9/9 配置 Nginx"
  apt-get install -y -qq nginx >/dev/null
  sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__PORT__|$PORT|g" -e "s|__APP_DIR__|$APP_DIR|g" \
    "$APP_DIR/deploy/nginx.conf.template" > /etc/nginx/sites-available/durlevel
  ln -sf /etc/nginx/sites-available/durlevel /etc/nginx/sites-enabled/durlevel
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl reload nginx

  # If a host firewall is running, let 80/443 through — otherwise certbot's
  # validation and every visitor are blocked by it. The cloud provider's own
  # firewall / security group is a separate thing, set in their web console.
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
    ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null
    echo "    ufw 已放行 80 / 443"
  elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
    firewall-cmd --permanent --add-service=http >/dev/null
    firewall-cmd --permanent --add-service=https >/dev/null
    firewall-cmd --reload >/dev/null
    echo "    firewalld 已放行 80 / 443"
  fi
  # Nginx only needs the static assets now — uploaded images go through the
  # app so they stay behind the login. public/uploads is deliberately not
  # opened up: nothing outside the app user reads it any more.
  chmod o+x "$APP_DIR" "$APP_DIR/public"

  if [ "$WITH_TLS" = "1" ]; then
    say "申请 HTTPS 证书"
    apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
    # One certificate covering every name, and a -d flag for each.
    CERTBOT_NAMES=()
    for d in $DOMAIN; do CERTBOT_NAMES+=(-d "$d"); done
    certbot --nginx "${CERTBOT_NAMES[@]}" --non-interactive --agree-tos -m "$TLS_EMAIL" --redirect
    sed -i 's/^COOKIE_SECURE=0/COOKIE_SECURE=1/' "$APP_DIR/.env"
    # certbot writes the TLS server block but adds no HSTS, so a first visit —
    # or any visit after the browser forgets — can still be downgraded to plain
    # HTTP in front of the login form. One year, no includeSubDomains and no
    # preload: those commit every subdomain and are hard to walk back.
    if ! grep -q 'Strict-Transport-Security' /etc/nginx/sites-available/durlevel; then
      sed -i '/listen 443/a\    add_header Strict-Transport-Security "max-age=31536000" always;' \
        /etc/nginx/sites-available/durlevel
      nginx -t >/dev/null 2>&1 && systemctl reload nginx \
        || warn "HSTS 写入后 nginx -t 没通过，已跳过重载，请手动检查 /etc/nginx/sites-available/durlevel。"
    fi
    systemctl restart durlevel
  fi
fi

say "装好了"
SCHEME="http"; [ "$WITH_TLS" = "1" ] && SCHEME="https"
cat <<SUMMARY

  访问地址     ${SCHEME}://${PRIMARY_DOMAIN:-127.0.0.1:$PORT}
  代码目录     ${APP_DIR}
  配置文件     ${APP_DIR}/.env      （密码都在这里，权限 600）
  数据目录     ${APP_DIR}/data      （site.db 和产品文档，备份只需要这个和 public/uploads）

  看状态       systemctl status durlevel
  看日志       journalctl -u durlevel -f
  重启         systemctl restart durlevel
  更新代码     bash ${APP_DIR}/deploy/update.sh
  备份         bash ${APP_DIR}/deploy/backup.sh

  接下来：
   1. 用上面打印的管理员密码登录，立刻在「账号管理」里改掉；
   2. 填 .env 里的 SMTP_* 再跑 (cd ${APP_DIR} && npm run mail-test) 验证邮件；
   3. 云厂商控制台的「防火墙 / 安全组」要放行 80、443 和 SSH，不要放行 ${PORT}
      —— 那一层在网页控制台上设，服务器里的命令改不到它；
   4. 证书由 certbot 自动续期（systemctl list-timers | grep certbot 可以确认）。
SUMMARY
