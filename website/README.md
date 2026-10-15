# Durlevel 外贸独立站

按需求 Excel（`首页` / `产品列表页` / `联系我们`）实现的**登录制**产品展示站：
公司产品目录 + 业务员联系方式，配套中文管理后台。

设计方案见 [`docs/规划方案.md`](docs/规划方案.md)。

## 功能一览

**前台（英文，面向海外客户）**
- `/` 登录页 —— 即首页，Logo + 登录账号 + 登录密码，**无自助注册入口**
- `/products` 产品列表 —— 品牌 Logo、搜索框、三个分类锚点导航，三个区块各有独立表头：
  | 区块 | 字段 |
  |---|---|
  | OEM成品 | No. / 产品图片 / 产品英文名字 / 剂型 / 规格 / 产品标签 / 备注 |
  | 提取物 | No. / 产品图片 / 产品英文名字 / 含量 / 比例 / 备注 |
  | 食品添加剂 | No. / 产品图片 / 产品英文名字 / 剂型 / CAS号 / 备注 |
- `/contact` 联系我们 —— 业务员名片（照片 / 姓名 / 电话 / WhatsApp / 邮箱），WhatsApp 自动生成 `wa.me` 链接

**后台（中文，`/admin`，仅管理员可进）**
- 产品管理：增删改、图片上传、排序、上下架；表单按所选分类自动切换字段
- 业务员管理：增删改、照片上传、排序、显示/隐藏
- 账号管理：创建账号、改密、设角色（管理员/用户）、停用、删除
- 网站设置：Logo、品牌名、各页文案、三个区块标题、页脚

## 技术栈

Node.js 20+ · Express 5 · EJS · SQLite（better-sqlite3）· bcrypt
**无前端构建步骤** —— `npm ci && npm start` 即可运行。

## 本地运行

```bash
cd website
npm ci
cp .env.example .env          # 修改 SESSION_SECRET
npm run init-db               # 建库 + 创建初始管理员
npm start                     # http://localhost:3000
```

`npm run init-db` 若未设置 `ADMIN_PASSWORD`，会随机生成一个强密码并**只打印一次**，请立即保存。

## 部署到服务器

```bash
# 1. 安装 Node.js 20+，拉取代码
npm ci --omit=dev

# 2. 配置环境变量
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # 生成 SESSION_SECRET
vi .env        # 填入 SESSION_SECRET，设 NODE_ENV=production、TRUST_PROXY=1

# 3. 初始化
npm run init-db

# 4. 常驻运行
pm2 start server.js --name durlevel   # 或用 systemd
```

Nginx 反向代理（配好 HTTPS 证书后）：

```nginx
server {
  server_name www.example.com;
  client_max_body_size 10m;          # 需大于 MAX_UPLOAD_MB
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

> 走代理时务必设 `TRUST_PROXY=1`，否则登录限流会把所有访客当成同一个 IP。

## 环境变量

见 [`.env.example`](.env.example)。关键项：

| 变量 | 说明 |
|---|---|
| `SESSION_SECRET` | **必改**，签名会话 Cookie；生产环境少于 32 位会直接拒绝启动 |
| `NODE_ENV` | 生产环境设为 `production` |
| `TRUST_PROXY` | 在 Nginx/Caddy 后面设为 `1` |
| `COOKIE_SECURE` | 仅经 HTTPS 发送会话 Cookie（`production` 下默认开启） |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 仅 `npm run init-db` 首次建号时使用 |
| `MAX_UPLOAD_MB` | 单张图片上限，默认 5 |
| `SESSION_TTL_HOURS` | 登录有效期，默认 12 小时 |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_MINUTES` | 登录失败限流，默认 15 分钟内 8 次 |

## 日常运维

```bash
npm run reset-password <账号> <新密码>    # 管理员忘记密码时在服务器上重置
```

**备份**只需这两项（均不入 Git）：

```
data/site.db        # 产品、业务员、账号、设置
public/uploads/     # 产品图、业务员照片、Logo
```

## 安全设计

- 密码 bcrypt（cost 12）哈希存储
- 会话 Cookie `HttpOnly` + `SameSite=Lax` + HMAC-SHA256 签名；生产环境 `Secure`
- 全站写操作校验 CSRF Token；上传接口在解析 multipart 后补验，二者绑定在同一个中间件里，无法漏配
- 登录失败按 IP + 账号限流
- 无注册路由；账号停用后，已签发的会话下次请求立即失效
- 上传限 JPG/PNG/WebP/GIF + 体积上限 + 随机重命名
- CSP 禁止内联脚本与样式；`X-Frame-Options: DENY`、`nosniff`
- 管理员不能停用/降级/删除自己，且系统始终保留至少一个启用的管理员

## 目录结构

```
website/
├── server.js                入口：中间件装配、安全响应头、错误处理
├── src/
│   ├── config.js            环境变量 + 三个分类及其字段的唯一定义
│   ├── db/                  SQLite 连接与建表
│   ├── lib/                 session / csrf / auth / users / products / staff / upload / settings
│   └── routes/              auth.js、site.js、admin/*
├── views/                   EJS 模板（前台英文 / 后台中文）
├── public/                  css、js、favicon、uploads/
├── scripts/                 init-db.js、reset-password.js
└── docs/规划方案.md
```

> 新增产品字段或分类时只改 `src/config.js` 的 `CATEGORIES` / `FIELD_LABELS`（字段需同步加到 `src/db/schema.sql` 与 `products.js` 的 SQL），前台表头与后台表单会自动跟随。

## 尚未实现（Excel 未要求）

产品详情页与在线询盘表单、产品批量导入导出、多语言切换、操作审计日志、图片自动压缩转码。
