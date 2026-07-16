# Coboard 微信小程序

## 本地开发

```powershell
$env:DEV_LOGIN='true'
$env:SEED_DEMO='true'
pnpm --filter server dev

# 另一个终端
$env:TARO_APP_API_BASE='http://127.0.0.1:3000'
pnpm miniapp:dev
```

微信开发者工具导入 `miniapp` 目录；本地联调时在“详情 / 本地设置”中关闭合法域名校验。
服务端开启 `DEV_LOGIN` 后，“我的”页面会显示仅限开发环境的邮箱登录入口。

## Syna ID 登录

正式环境使用服务端 OIDC Authorization Code + PKCE：

1. 小程序的 `web-view` 打开 `/api/auth/miniapp/start`。
2. Syna ID 回调 Coboard 服务端；新用户仍会经过邀请码加入页。
3. 服务端生成两分钟有效、只可使用一次的兑换码，并返回小程序回调页。
4. 小程序兑换 Coboard Bearer 会话并存入本地 Storage。

Syna ID 的 access token、ID token 和 OIDC client secret 都不会进入小程序代码。

发布前需要：

- 把 `miniapp/project.config.json` 的 `appid` 换成正式小程序 AppID。
- 构建时设置 HTTPS 的 `TARO_APP_API_BASE`。
- 在微信公众平台配置 Coboard API 的 request、uploadFile 合法域名。
- 配置 `web-view` 业务域名；OIDC 跳转涉及的 Coboard 与 Syna ID 域名需要满足微信业务域名规则。
- 将服务器迁移到最新版本（包含 `miniapp_auth_codes` 表）。

```powershell
$env:TARO_APP_API_BASE='https://coboard.example.com'
pnpm miniapp:build
```
