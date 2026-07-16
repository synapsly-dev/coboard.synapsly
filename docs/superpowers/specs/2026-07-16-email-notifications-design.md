# 邮件提醒功能设计

日期:2026-07-16
状态:已实现

## 目标

在关键任务节点自动发送邮件,督促成员推进工作、督促管理员及时审阅。管理员可在
管理设置中配置:接收管理员邮件的人员名单、各事件类型的开关。

## 约束

- **core.synapsly 零代码改动**(用户明确要求)。复用 core 现有的
  `POST /api/send/email` M2M 接口(scope `email:send`,OAuth2 client_credentials)。
  coboard 已是 core 的 confidential OIDC 客户端,只需在 core 管理面板给该客户端
  追加 `email:send` scope(纯运行时配置)。
- **coboard 零数据库迁移**。设置存现有 `settings` KV 表;临期提醒去重借 core 的
  `(client_id, idempotency_key)` 幂等约束,不建新表。

## 事件模型(5 类)

| 事件 key | 触发点 | 收件人 |
|---|---|---|
| `taskAssigned` 任务分配 | `assignTask`;`createTask` 带派发 | 被指派成员 |
| `taskDueSoon` 即将逾期 | 定时扫描(每小时),`dueDate` 距今 ≤ N 天(默认 1,可配)且未交付 | 全部认领人 |
| `taskSubmitted` 任务提交 | `deliverTask` | 任务创建者 + 项目 lead(排除提交者) |
| `taskRejected` 任务被驳回 | `reviewTask` 驳回分支 | 全部认领人 |
| `adminReviewNeeded` 需管理员审阅 | 任务进入需 admin 审核的状态:A 类/≥8 点直达 admin 的 `deliverTask`,或初审通过进入待复核 | 设置中勾选的管理员 |

邮件均为简洁中文 HTML+纯文本,含任务名、项目、截止日期与指向站点的链接
(`PUBLIC_URL`)。发送为 fire-and-forget:失败只记日志,绝不阻塞或回滚业务操作。

## 架构(与站内通知中心整合)

实现期间 main 同步落地了站内「通知中心」(`createNotifications` 统一扇出、
notifications 表带 `(recipient, dedupe_key)` 唯一索引、SSE 私有刷新)。邮件因此
实现为**通知中心的第二条通道**,而非独立挂钩:

```
taskService 生产者(带 emailEvent 标记)──┐
deadlineService 每小时临期扫描 ──────────┤
                                           ▼
                          createNotifications(站内落库+去重+SSE)
                                           │ 对"新插入"的行
                                           ▼
                          emailChannel(读管理员设置+名单过滤+组稿)
                                           ▼
                          mailer(token 缓存 + POST core /api/send/email)
```

- `server/src/email/mailer.ts`:client_credentials 换 token
  (`POST {issuer}/token`,Basic 认证,内存缓存至 exp 前 60s);
  `send({to, subject, html, text, idempotencyKey})` → `POST {issuer}/api/send/email`。
  凭据默认复用 `OIDC_CLIENT_ID/SECRET`,可用 `EMAIL_CLIENT_ID/SECRET/EMAIL_ISSUER`
  覆盖;未配置时降级为仅日志的 LogMailer。
- `server/src/email/emailChannel.ts`:模块单例,buildApp 时注入 mailer/log/publicUrl。
  `createNotifications` 对带 `emailEvent` 标记且**真正新插入**的通知行调用它:
  读设置(总开关+事件开关)、`adminReviewNeeded` 按名单过滤、解析收件邮箱、
  逐封发送(不 await SMTP 往返,失败仅记日志)。幂等键 `notif:{通知行id}`。
- 生产者标记(`CreateNotificationsInput.emailEvent`):
  `task_assigned`/`task_transferred`(新接手人)→ `taskAssigned`;
  `review_requested` → admin 阶段(池任务或初审已过)为 `adminReviewNeeded`,
  否则 `taskSubmitted`(收件人=项目 lead/赛道经理,admin 兜底——复用
  `listTaskReviewerIds`);`review_rejected` → `taskRejected`。
- `server/src/services/deadlineService.ts`:`deadline_due_soon` 的唯一生产者
  (此前该类型无生产者)。每小时扫描 `dueDate ≤ 今天+N` 且未完结的任务,给认领人
  建站内通知(dedupeKey `task:{id}:due_soon:{dueDate}` → 每人每截止日期一次,
  重启/重扫都不会重发)并标记 `emailEvent: 'taskDueSoon'`。站内通知不受邮件
  开关影响;邮件门控在 emailChannel。

## 设置

`settings` KV 新键 `email_notifications`(JSON):

```json
{
  "enabled": false,
  "events": { "taskAssigned": true, "taskDueSoon": true, "taskSubmitted": true,
               "taskRejected": true, "adminReviewNeeded": true },
  "dueSoonDays": 1,
  "adminRecipientIds": []
}
```

总开关默认关(部署后在 core 授 scope、UI 里手动开启)。`adminRecipientIds` 仅接受
现役 admin/super_admin 的用户 id,读取时过滤已降级/停用者。

- shared:zod schema `emailNotificationSettingsSchema` + 类型。
- server:`settingsService.ts` 加 typed getter/setter;`routes/settings.ts` 扩展
  GET/PATCH(requireAdmin)。
- web:`SettingsTab.tsx` 新增「邮件提醒」区块——总开关、5 个事件开关、提前天数、
  管理员多选(复用现有用户列表 API)。

## 测试

- 单测:notificationService 注入 fake sender,断言各迁移触发正确的收件人集合与
  开关/名单过滤逻辑;设置 API 校验。
- 不测真实 SMTP;部署后端到端发一封验证。

## 部署

1. coboard push main → hk-01 按 deploy-hk-01 流程部署(无迁移,风险低)。
2. core 侧仅运行时配置:管理面板给 coboard 客户端加 `email:send` scope。
3. 线上开启总开关,触发一次任务分配验证收信。
