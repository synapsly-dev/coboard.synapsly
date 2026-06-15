# Coboard · 团队协作工具（自部署）

Coboard 是一款**自部署**的轻量团队协作 Web 应用，面向 16–50 人的小团队：

- **任务看板**：待认领 → 进行中 → 已完成 三列，支持拖拽
- **派发 / 认领**：负责人指派任务，成员自己领活
- **评论 / 讨论**：任务内讨论与动态时间线
- **贡献统计**：完成数 / 点数排行榜与个人趋势图
- **真实时**：看板、评论、统计通过 SSE 即时联动

技术栈：单个应用容器（Node 22 + Fastify，内置打包后的 React 前端）+ 一个 Postgres 数据库。**备份只需备份这一个数据库**，零件越少越省心。

---

## 一、三步部署

> 前置条件：一台装好 [Docker](https://docs.docker.com/get-docker/) 与 Docker Compose 的服务器（Linux / macOS 均可）。

```bash
# 1) 获取代码并进入目录
git clone <你的仓库地址> coboard && cd coboard

# 2) 准备环境变量（务必修改 SESSION_SECRET）
cp .env.example .env
#   用编辑器打开 .env，把 SESSION_SECRET 改成随机长字符串：
#   openssl rand -hex 32

# 3) 启动
docker compose up -d
```

启动后打开浏览器访问 `http://<服务器IP>:3000`：

- 首次访问会进入 **初始化 (setup)** 页面，创建第一个**管理员**账号。
- 之后由管理员在后台创建成员账号（邮箱 + 初始密码，成员可自行改密）。
- v1 暂无开放注册 / 邀请链接。

> **可选：体验演示数据**。在 `.env` 中设置 `SEED_DEMO=true` 后首次启动（空库时）会写入一个演示项目与样例任务。演示账号：`admin@coboard.local` / `changeme123`（生产环境请勿开启）。

### 环境变量说明（`.env`）

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | Postgres 连接串。compose 默认指向内部 `db` 服务。 |
| `SESSION_SECRET` | 会话 Cookie 签名密钥，**生产必须修改**为随机长字符串。 |
| `PORT` | 对外端口（默认 3000）。 |
| `NODE_ENV` | `production` / `development`。 |
| `PUBLIC_URL` | 对外访问地址（反代场景填写完整域名）。 |
| `SEED_DEMO` | 设为 `true` 时空库首启写入演示数据。 |

---

## 二、备份与恢复

所有数据都在名为 `coboard-db` 的数据卷里的 Postgres 中，备份/恢复即操作这一个库。

### 备份（导出为单个 SQL 文件）

```bash
# 导出整库到 backup.sql
docker compose exec -T db pg_dump -U coboard -d coboard > backup-$(date +%Y%m%d).sql
```

建议把生成的 `backup-*.sql` 放到异地 / 对象存储，并用 cron 定期执行。

### 恢复（从备份导入）

```bash
# 1) 确保数据库为空（如需全新恢复，可先重建库）
docker compose exec -T db psql -U coboard -d coboard -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# 2) 导入备份
docker compose exec -T db psql -U coboard -d coboard < backup-20260615.sql

# 3) 重启应用（会自动补齐缺失的迁移）
docker compose restart app
```

> 也可直接备份整个数据卷：`docker run --rm -v coboard_coboard-db:/data -v "$PWD":/backup alpine tar czf /backup/db-volume.tgz -C /data .`（卷名前缀取决于 compose 项目名，可用 `docker volume ls` 查看）。

---

## 三、升级

Coboard 在容器启动时会**自动执行数据库迁移**，因此升级只需拉新镜像并重建：

```bash
# 拉取/重建最新代码
git pull            # 若用源码构建

# 重新构建并平滑重启（迁移在启动时自动应用）
docker compose up -d --build
```

> 升级前建议先执行一次备份（见上）。迁移是向前兼容的，但生产环境养成「先备份再升级」的习惯最稳妥。

---

## 四、可选：用 Caddy 反向代理上 HTTPS

生产环境建议在前面挂一个反向代理来自动签发 HTTPS 证书。以 [Caddy](https://caddyserver.com/) 为例：

`Caddyfile`：

```
coboard.example.com {
    reverse_proxy app:3000
}
```

在 `docker-compose.yml` 中追加 Caddy 服务（与 app 同网络）：

```yaml
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    depends_on:
      - app
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config

volumes:
  caddy-data:
  caddy-config:
```

同时把 `app` 的 `ports` 映射去掉（只让 Caddy 对外），并在 `.env` 中将 `PUBLIC_URL` 设为 `https://coboard.example.com`。Caddy 会自动申请并续期 Let's Encrypt 证书。

> 反代下应用通过 `trustProxy` 识别真实来源；会话 Cookie 在 `NODE_ENV=production` 时自动带 `Secure`，因此**务必走 HTTPS**，否则浏览器会拒绝写入 Cookie 导致无法登录。

---

## 五、常见问题（FAQ）

**Q: 打开页面提示无法登录 / 登录后立刻掉线？**
A: 多半是 Cookie 被浏览器拒绝。生产环境（`NODE_ENV=production`）的会话 Cookie 带 `Secure`，必须通过 HTTPS 访问。本机调试可临时将 `NODE_ENV=development`。

**Q: `SESSION_SECRET` 忘了改会怎样？**
A: 使用默认密钥存在安全风险（会话可被伪造）。请用 `openssl rand -hex 32` 生成并填入 `.env`，然后 `docker compose up -d` 重启。修改密钥会使已登录会话失效，需要重新登录。

**Q: 端口 3000 被占用 / 想换端口？**
A: 修改 `.env` 的 `PORT`（例如 `PORT=8080`），重启即可。映射形如 `8080:3000`。

**Q: 怎么重置忘记的管理员密码？**
A: v1 未提供 UI 重置入口。可进入数据库手动更新 `users.password_hash`（argon2id 哈希），或在仅有该管理员时清库后重新走 setup。后续版本将提供更友好的方式。

**Q: 数据存在哪里？删除容器会丢吗？**
A: 数据存于命名卷 `coboard-db`，`docker compose down` 不会删卷；只有 `docker compose down -v` 才会删除数据卷。日常升级用 `up -d --build` 不影响数据。

**Q: 支持多实例 / 横向扩展吗？**
A: v1 为单实例单进程（实时用进程内事件总线），足以支撑数十人团队。多实例扩展（Redis pub/sub）在 v2 路线图中。

**Q: 数据库迁移失败怎么办？**
A: 查看 `docker compose logs app` 的 `[migrate]` 输出。常见原因是数据卷里残留了不一致的结构；可先备份数据，再排查或回滚到上一个镜像版本。

---

## 开发者：本地运行

> 团队部署无需关心此节；仅供二次开发参考。

```bash
corepack enable                 # 启用 pnpm
pnpm install                    # 安装依赖
pnpm db:generate                # 生成 SQL 迁移（离线，无需数据库）

# 需要一个本地 Postgres，并在 .env 配好 DATABASE_URL
pnpm db:migrate                 # 应用迁移
pnpm dev                        # 同时启动 server 与 web 开发服务器

pnpm typecheck                  # 全量类型检查
pnpm test                       # 运行测试
pnpm build                      # 构建 shared -> server -> web
```
