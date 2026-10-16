# 部署手册

一台干净的 Debian / Ubuntu 服务器，一条命令装完：Node、运行用户、systemd 服务、
Nginx 反向代理、HTTPS 证书、管理员账号，全部到位。

```bash
# 1. 把代码放到服务器上（二选一）
git clone https://github.com/Esko-zhang/agent.git && cd agent/website
#   或者在本地打包上传：tar -czf site.tgz website/ && scp site.tgz root@服务器:/root/

# 2. 装
sudo DOMAIN=catalogue.你们的域名 WITH_TLS=1 TLS_EMAIL=you@yourdomain.com \
     bash deploy/install.sh
```

装完它会打印访问地址、管理员密码、以及看日志 / 重启 / 更新 / 备份的命令。

## 动手之前先确认四件事

**0. 域名实名认证。** 在阿里云等国内注册商注册的域名（.com 也算）**必须完成实名认证**，
否则会被注册局置为 `serverHold`，解析根本不生效——这和备案是两回事，境外服务器也躲不掉。
认证通过后状态还要 1–3 个工作日才恢复，所以**这一步要最先去查**
（[阿里云：解析不生效怎么办](https://help.aliyun.com/zh/dns/why-does-domain-name-resolution-not-take-effect)）。

**1. 域名和备案。** 服务器在**中国大陆**的话，未备案域名走 80 端口会被运营商拦截，
显示备案提示页（[阿里云排查文档](https://help.aliyun.com/zh/ecs/support/what-do-i-do-if-i-cannot-access-a-website-hosted-on-an-instance)）。备案一般要一到三周。

> 这个站是**发给海外客户**的私密站点。如果还没备案，**买香港 / 新加坡地域的服务器更合适**：
> 不需要备案，海外客户访问也更快。

**2. HTTPS。** `WITH_TLS=1` 会用 certbot 申请 Let's Encrypt 免费证书，前提是
域名已解析到这台服务器、80 端口对公网开放。Let's Encrypt **不给 IP 地址签证书**。

没有证书也能先跑起来（不加 `WITH_TLS`），但脚本会把 `COOKIE_SECURE` 设成 0 —— 因为
带 Secure 标记的 Cookie 在 HTTP 下浏览器根本不会回传，登录会一直卡在登录页。
证书配好后记得把它改回 1 再 `systemctl restart durlevel`。

**3. 安全组。** 放行 **80、443** 和你的 SSH 端口就够了。**不要**放行 3000 ——
应用只监听 `127.0.0.1`，外网一律经过 Nginx，这样访问记录里的 IP 才是真实访客的。

**4. 配置多大的机器。** 这站是 SQLite + 单进程 Node，给指定客户看的，
**1 核 1G 足够**，2 核 2G 很宽裕。磁盘主要被产品图片和文档占，20G 起步。

## 参数

| 变量 | 默认 | 说明 |
|---|---|---|
| `DOMAIN` | 必填 | Nginx 对外响应的域名。**可以写多个**，空格或逗号分隔（`a.com www.a.com`），证书会一次性覆盖全部；没有域名可以先填服务器公网 IP |
| `WITH_TLS` | `0` | 设 `1` 顺带申请 Let's Encrypt 证书（需要域名） |
| `TLS_EMAIL` | — | `WITH_TLS=1` 时必填，用于证书到期提醒 |
| `APP_DIR` | `/opt/durlevel` | 代码、数据库、上传文件都在这里 |
| `APP_USER` | `durlevel` | 运行服务的系统用户，不能登录 |
| `PORT` | `3000` | Node 监听的回环端口 |
| `ADMIN_PASSWORD` | 自动生成 | 初始管理员密码，不填就生成一个并打印一次 |
| `SKIP_NGINX` | `0` | 设 `1` 则不碰 Nginx（你前面已经有自己的代理） |
| `SRC_DIR` | 脚本所在的仓库 | 从别处复制代码进来 |

脚本可以重复执行：**不会覆盖 `.env`，不会动数据库，不会重置已有管理员账号**。
`git pull` 之后再跑一次就能更新依赖。

## 日常操作

```bash
systemctl status durlevel        # 状态
journalctl -u durlevel -f        # 实时日志
systemctl restart durlevel       # 改完 .env 后重启

bash /opt/durlevel/deploy/update.sh    # 更新代码（会先自动备份）
bash /opt/durlevel/deploy/backup.sh    # 手动备份
```

每晚自动备份，加一行 crontab：

```cron
17 3 * * * root bash /opt/durlevel/deploy/backup.sh >> /var/log/durlevel-backup.log 2>&1
```

备份只打包三样不可再生的东西：**数据库、产品图片、产品文档**。默认留 14 天
（`KEEP_DAYS=` 可改），放在 `/opt/durlevel/backups`。
数据库用 SQLite 自己的 `.backup` 命令拷，服务不用停。
**备份目录和服务器在同一块盘上，定期拿到别处去**（OSS、另一台机器都行）。

## 出问题时

| 现象 | 多半是 |
|---|---|
| 浏览器打不开，`curl 127.0.0.1:3000/healthz` 正常 | 安全组没放行 80/443，或 Nginx 没起来 |
| 登录页能开，输对密码却弹回登录页 | 没有 HTTPS 却开着 `COOKIE_SECURE=1` |
| 访问记录里所有人都是同一个 IP | `.env` 里 `TRUST_PROXY` 没设成 1 |
| 域名打开是备案提示页 | 大陆服务器 + 域名未备案，见上文 |
| 上传大图报错 | Nginx 的 `client_max_body_size` 要大于 `.env` 里的 `MAX_UPLOAD_MB` |
| 询盘不发邮件 | `cd /opt/durlevel && npm run mail-test`，照提示改 |

服务起不来就先看日志：`journalctl -u durlevel -n 50 --no-pager`。

## 关于 `npm audit` 的两条 moderate 提示

`npm ci` 之后会报两条 moderate，都来自 `exceljs` 依赖的 `uuid@8`
（v3/v5/v6 在调用方自己传 `buf` 时缺边界检查）。本项目只用 exceljs 读写 Excel，
从不传 `buf`，这条路径走不到；npm 给的"修复"是把 exceljs 降到 3.4.0，那是大版本回退，
弊大于利。等 exceljs 上游换掉 uuid 再跟进。
