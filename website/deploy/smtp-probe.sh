#!/usr/bin/env bash
# =============================================================================
# 直接和发信服务器对话，不经过本站任何代码。
#
#   sudo bash /opt/durlevel/deploy/smtp-probe.sh
#
# 为什么需要它：mail-test 走的是 Node + nodemailer，排查到后面分不清
# 「我们这边写错了」还是「服务器就是不认这个账号」。这个脚本只用 openssl，
# 把握手、服务器支持哪些登录方式、以及登录那一刻的原始应答全部打出来。
# 如果这里也失败，那就跟本站无关，可以直接拿这段记录去找邮箱服务商。
#
# 密码是隐藏输入，且在输出里会被打码。
# =============================================================================
set -uo pipefail

APP_DIR="${APP_DIR:-/opt/durlevel}"
ENV_FILE="$APP_DIR/.env"
bold() { printf '\033[1m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m%s\033[0m\n' "$1"; }

command -v openssl >/dev/null || { echo "需要 openssl：sudo apt-get install -y openssl"; exit 1; }

# 从 .env 读默认值（读不到就问）
getenv() { grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"; }
host="$(getenv SMTP_HOST)"; port="$(getenv SMTP_PORT)"; user="$(getenv SMTP_USER)"
[ -n "$host" ] || host=smtp.qiye.aliyun.com
[ -n "$port" ] || port=465

printf '发信服务器 [%s]: ' "$host"; read -r x; host="${x:-$host}"
printf '端口 [%s]: ' "$port";      read -r x; port="${x:-$port}"
printf '发信账号 [%s]: ' "$user";  read -r x; user="${x:-$user}"
printf '密码（不显示）: ';          read -rs pass; echo
[ -n "$user" ] && [ -n "$pass" ] || { echo "账号和密码都不能为空"; exit 1; }

echo
bold "1) 这台服务器能不能解析并连上 $host:$port"
if ! getent hosts "$host" >/dev/null 2>&1; then
  warn "   域名解析不了 —— SMTP_HOST 可能填错了"; exit 1
fi
echo "   解析到: $(getent hosts "$host" | awk '{print $1}' | tr '\n' ' ')"
if command -v nc >/dev/null && nc -z -w 5 "$host" "$port" 2>/dev/null; then
  echo "   端口可达 ✓"
else
  warn "   端口连不上（或没装 nc）。如果确实连不上，检查安全组是否放行 $port 出站。"
fi

u64="$(printf '%s' "$user" | base64 -w0)"
p64="$(printf '%s' "$pass" | base64 -w0)"

echo
bold "2) 完整对话（密码已打码）"
transcript="$(
  { printf 'EHLO durlevel-probe\r\n'; sleep 2
    printf 'AUTH LOGIN\r\n';          sleep 2
    printf '%s\r\n' "$u64";           sleep 2
    printf '%s\r\n' "$p64";           sleep 3
    printf 'QUIT\r\n';                sleep 1
  } | timeout 30 openssl s_client -connect "$host:$port" -quiet -crlf 2>&1
)"
# openssl s_client 不会自己退出，上面的 timeout 是兜底，否则脚本会一直挂着。
[ -n "$transcript" ] || warn "（30 秒内没有任何应答——多半是端口连不上）"
# 把 base64 的账号/密码从回显里抹掉，只留服务器说的话
printf '%s\n' "$transcript" \
  | sed -e "s|$p64|********（密码）|g" -e "s|$u64|********（账号base64）|g" \
  | sed 's/^/   /'

echo
bold "3) 结论"
if printf '%s' "$transcript" | grep -q '^235'; then
  echo "   ✓ 登录成功 —— 账号密码没问题。"
  echo "     如果网站那边还失败，问题就在 .env 或服务没重启，来找我。"
elif printf '%s' "$transcript" | grep -qE '^5(26|35|35-)'; then
  warn "   ✗ 服务器明确拒绝了这组账号密码。"
  echo "     这一步没有经过本站任何代码，所以和网站无关。把上面第 2 段"
  echo "     原样发给邮箱服务商的客服，问这三件事："
  echo "       a) 这个账号允许三方客户端 / SMTP 发信吗？"
  echo "       b) 该用登录密码还是客户端专用密码？"
  echo "       c) 有没有 IP 白名单、或者需要先在后台单独授权这台服务器？"
elif printf '%s' "$transcript" | grep -q 'AUTH'; then
  warn "   ? 没看到 235，也没看到明确拒绝。看第 2 段里 EHLO 之后那几行："
  echo "     服务器声明支持哪些 AUTH 方式？如果压根没有 AUTH，说明这个端口/地址"
  echo "     不接受认证发信，要换地址或端口。"
else
  warn "   ? 连上了但没拿到预期应答，把第 2 段发我。"
fi
