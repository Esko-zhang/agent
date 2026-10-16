#!/usr/bin/env bash
#
# Backs up everything that cannot be re-downloaded: the database, the uploaded
# product images and the spec sheets. Code is in git; node_modules is not worth
# keeping.
#
#   sudo bash /opt/durlevel/deploy/backup.sh
#   # nightly at 03:17:
#   #   17 3 * * * root bash /opt/durlevel/deploy/backup.sh >> /var/log/durlevel-backup.log 2>&1
#
# KEEP_DAYS=14 by default; older archives are deleted.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/durlevel}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"

die() { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

[ -d "$APP_DIR" ] || die "找不到 $APP_DIR。"
install -d -m 0700 "$BACKUP_DIR"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# `.backup` is SQLite's own consistent-copy command: it works while the app is
# writing, which `cp` does not.
if [ -f "$APP_DIR/data/site.db" ]; then
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$APP_DIR/data/site.db" ".backup '$WORK/site.db'"
  else
    node -e '
      const Database = require(process.argv[1] + "/node_modules/better-sqlite3");
      const db = new Database(process.argv[2], { readonly: true });
      db.backup(process.argv[3]).then(() => process.exit(0),
        (e) => { console.error(e.message); process.exit(1); });
    ' "$APP_DIR" "$APP_DIR/data/site.db" "$WORK/site.db"
  fi
else
  echo "[!] 还没有数据库文件，跳过。"
fi

[ -d "$APP_DIR/data/docs" ] && cp -a "$APP_DIR/data/docs" "$WORK/docs"
[ -d "$APP_DIR/public/uploads" ] && cp -a "$APP_DIR/public/uploads" "$WORK/uploads"

ARCHIVE="$BACKUP_DIR/durlevel-$STAMP.tar.gz"
tar -czf "$ARCHIVE" -C "$WORK" .
chmod 600 "$ARCHIVE"
echo "✓ $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

find "$BACKUP_DIR" -name 'durlevel-*.tar.gz' -mtime "+$KEEP_DAYS" -print -delete

cat <<'NOTE'
  还原：停服务 → 解包到 data/ 和 public/uploads/ → 改回属主 → 起服务
    systemctl stop durlevel
    tar -xzf <备份文件> -C /tmp/restore
    cp /tmp/restore/site.db /opt/durlevel/data/site.db
    cp -a /tmp/restore/uploads/. /opt/durlevel/public/uploads/
    cp -a /tmp/restore/docs/.    /opt/durlevel/data/docs/
    chown -R durlevel:durlevel /opt/durlevel/data /opt/durlevel/public/uploads
    systemctl start durlevel
NOTE
