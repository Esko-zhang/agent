#!/usr/bin/env bash
#
# Read-only check before an upgrade. Changes nothing, writes nothing, touches
# no service — it only looks and tells you what would go wrong.
#
#   sudo bash /opt/durlevel/deploy/preflight.sh
#
# Written because this release added two ways for an upgrade to look fine and
# not be: the app now refuses to start without SESSION_SECRET, and the Nginx
# block that serves /uploads/ off disk has to go or product images stay public
# no matter what the application does.
set -uo pipefail

APP_DIR="${APP_DIR:-/opt/durlevel}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/durlevel}"

ok=0; warn=0; bad=0
pass() { printf '  \033[1;32m✓\033[0m %s\n' "$*"; ok=$((ok+1)); }
note() { printf '  \033[1;33m!\033[0m %s\n' "$*"; warn=$((warn+1)); }
stop() { printf '  \033[1;31m✗\033[0m %s\n' "$*"; bad=$((bad+1)); }
section() { printf '\n\033[1m%s\033[0m\n' "$*"; }

[ -d "$APP_DIR" ] || { echo "找不到 $APP_DIR"; exit 1; }
ENV_FILE="$APP_DIR/.env"

section "1. 配置文件"
if [ -r "$ENV_FILE" ]; then
  pass ".env 存在（权限 $(stat -c '%a' "$ENV_FILE")）"
  # Length only — the value itself never gets printed.
  SECRET_LEN=$(grep -m1 '^SESSION_SECRET=' "$ENV_FILE" | sed 's/^SESSION_SECRET=//' | tr -d '"'"'"'' | tr -d '\r' | wc -c)
  SECRET_LEN=$((SECRET_LEN > 0 ? SECRET_LEN - 1 : 0))
  if [ "$SECRET_LEN" -ge 32 ]; then
    pass "SESSION_SECRET 已设置（$SECRET_LEN 位）"
  else
    stop "SESSION_SECRET 缺失或太短（$SECRET_LEN 位，需要 ≥32）—— 新版本会拒绝启动"
    echo "      生成一个：node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    echo "      写进 $ENV_FILE 的 SESSION_SECRET= 后面"
  fi
  grep -q '^NODE_ENV=production' "$ENV_FILE" && pass "NODE_ENV=production" \
    || note "没有 NODE_ENV=production（不再致命，但静态资源缓存会关掉）"
  TP=$(grep -m1 '^TRUST_PROXY=' "$ENV_FILE" | cut -d= -f2 | tr -d '\r')
  [ "${TP:-0}" = "1" ] && pass "TRUST_PROXY=1（Nginx 在前面，IP 记录正确）" \
    || note "TRUST_PROXY=${TP:-未设置}：站在 Nginx 后面应为 1，否则访问记录全是 127.0.0.1，登录限速也会误伤"
  CS=$(grep -m1 '^COOKIE_SECURE=' "$ENV_FILE" | cut -d= -f2 | tr -d '\r')
  [ "${CS:-1}" = "1" ] && pass "COOKIE_SECURE=1" \
    || note "COOKIE_SECURE=0 —— 只在还没配 HTTPS 时才对"
  # Duplicate keys and inline comments: dotenv and systemd read these
  # differently, which is how an SMTP_FROM once ended up merged with a comment.
  DUP=$(grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" | sort | uniq -d | tr -d '=' | tr '\n' ' ')
  [ -z "$DUP" ] && pass "没有重复的配置项" || note "这些配置项写了不止一次（systemd 取最后一条）：$DUP"
else
  stop "读不到 $ENV_FILE"
fi

section "2. 数据库"
DB="$APP_DIR/data/site.db"
if [ -f "$DB" ]; then
  pass "site.db 存在（$(du -h "$DB" | cut -f1)）"
  # sqlite3 if it is there, otherwise the copy of better-sqlite3 the app
  # already ships — read-only either way.
  DUPSQL="SELECT category||' / '||lower(trim(name_en))||'（'||COUNT(*)||' 个）'
          FROM products GROUP BY category, lower(trim(name_en)) HAVING COUNT(*)>1"
  if command -v sqlite3 >/dev/null 2>&1; then
    N=$(sqlite3 "$DB" "SELECT COUNT(*) FROM products;" 2>/dev/null || echo '?')
    DUPP=$(sqlite3 "$DB" "$DUPSQL;" 2>/dev/null)
  elif [ -d "$APP_DIR/node_modules/better-sqlite3" ]; then
    READ_OUT=$(node -e '
      const Database = require(process.argv[1] + "/node_modules/better-sqlite3");
      const db = new Database(process.argv[2], { readonly: true });
      console.log(db.prepare("SELECT COUNT(*) AS n FROM products").get().n);
      for (const r of db.prepare(process.argv[3]).all()) console.log(Object.values(r)[0]);
    ' "$APP_DIR" "$DB" "$DUPSQL" 2>/dev/null)
    N=$(printf '%s' "$READ_OUT" | head -1)
    DUPP=$(printf '%s' "$READ_OUT" | tail -n +2)
  else
    N='?'; DUPP=''
    note "既没有 sqlite3 也没有 node_modules，跳过重复产品检查（升级本身不受影响）"
  fi
  [ "$N" = '?' ] || echo "      产品 $N 个"
  if [ "$N" != '?' ]; then
    if [ -z "$DUPP" ]; then
      pass "没有「同分类同英文名」的重复产品 —— 升级后会建立唯一索引"
    else
      note "有重复产品，升级后唯一索引会跳过建立（服务照常起，但批量导入对这些只会更新其中一个）："
      echo "$DUPP" | sed 's/^/        · /'
      echo "        处理：在「产品管理」里改名或合并，然后重启服务即可补建索引。"
    fi
  fi
else
  stop "找不到 $DB"
fi

section "3. Nginx —— 本次必须手工处理的一步"
if [ -r "$NGINX_SITE" ]; then
  if grep -qE '^\s*location\s+/uploads/' "$NGINX_SITE"; then
    stop "还有 location /uploads/ 这一段 —— 它绕过应用直接出图，不删掉产品图对匿名仍然公开"
    echo "      sudo nano $NGINX_SITE   # 删掉整段 location /uploads/ { ... }"
    echo "      sudo nginx -t && sudo systemctl reload nginx"
  else
    pass "没有 location /uploads/，图片会走应用的登录校验"
  fi
  grep -q 'Strict-Transport-Security' "$NGINX_SITE" && pass "已有 HSTS" \
    || note "没有 HSTS。在 listen 443 那一行后面加：add_header Strict-Transport-Security \"max-age=31536000\" always;"
  grep -q 'listen 443' "$NGINX_SITE" && pass "有 HTTPS server 块" || note "没看到 443 监听，是否还没配证书？"
else
  note "读不到 $NGINX_SITE（自己配的代理？那就手动确认 /uploads/ 没有被直接对外）"
fi

section "4. 运行环境"
systemctl is-active --quiet durlevel 2>/dev/null && pass "durlevel 正在运行" || note "durlevel 当前没在运行"
AVAIL=$(df -Pm "$APP_DIR" | awk 'NR==2{print $4}')
[ "${AVAIL:-0}" -ge 500 ] && pass "磁盘可用 ${AVAIL}MB" || stop "磁盘只剩 ${AVAIL}MB —— 备份和 npm ci 可能失败"
command -v node >/dev/null && pass "node $(node -v)" || stop "找不到 node"

printf '\n\033[1m结果：%d 项通过，%d 项提醒，%d 项必须先处理\033[0m\n' "$ok" "$warn" "$bad"
if [ "$bad" -gt 0 ]; then
  echo "先把上面标 ✗ 的处理掉，再跑 deploy/update.sh。"
  exit 1
fi
echo "可以升级了：sudo bash $APP_DIR/deploy/update.sh"
