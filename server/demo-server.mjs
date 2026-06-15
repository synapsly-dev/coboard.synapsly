// Coboard 本地演示启动器（仅用于预览，非生产部署）。
// 用文件持久化的 PGlite（嵌入式 Postgres）驱动「编译好的生产 app」，
// 走真实的 autoload 路由 + 静态托管 web/dist，监听 127.0.0.1:PORT。
// 生产请用 `docker compose up -d`（真实 Postgres）。
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { buildApp } from './dist/app.js';
import * as schema from './dist/db/schema.js';
import { maybeSeed } from './dist/db/seed.js';
import { hashPassword } from './dist/auth/password.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(here, 'drizzle');
const WEB_DIST = resolve(here, '../web/dist');
const DB_DIR = resolve(here, '../.superpowers/demo-db');
const PORT = Number(process.env.PORT || 3000);

async function applyMigrations(pglite) {
  const journal = JSON.parse(await readFile(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'));
  for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
    const raw = await readFile(join(MIGRATIONS, `${entry.tag}.sql`), 'utf8');
    for (const stmt of raw.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) {
      await pglite.exec(stmt);
    }
  }
}

const rank = (i) => String((i + 1) * 1000).padStart(8, '0');
const daysAgo = (d) => new Date(Date.now() - d * 86400000);

const freshDb = !existsSync(DB_DIR);
const pglite = new PGlite(DB_DIR);
if (freshDb) await applyMigrations(pglite);
const db = drizzle(pglite, { schema });

await maybeSeed(db); // admin@coboard.local / changeme123 + 演示成员 + 演示项目

// 补充更丰富的演示数据，让看板/贡献榜/趋势图一打开就有内容（仅首次）。
if (freshDb) {
  const userRows = await db.select().from(schema.users);
  const admin = userRows.find((u) => u.role === 'admin');
  const member = userRows.find((u) => u.email === 'member@coboard.local');
  const [proj] = await db.select().from(schema.projects).limit(1);

  const pwd = await hashPassword('changeme123');
  const [li] = await db.insert(schema.users).values({
    email: 'li@coboard.local', passwordHash: pwd, displayName: '小李', avatarColor: '#8b5cf6', role: 'member', isActive: true,
  }).returning();
  const [wang] = await db.insert(schema.users).values({
    email: 'wang@coboard.local', passwordHash: pwd, displayName: '王工', avatarColor: '#ef4444', role: 'member', isActive: true,
  }).returning();
  await db.insert(schema.projectMembers).values([
    { projectId: proj.id, userId: li.id, role: 'member' },
    { projectId: proj.id, userId: wang.id, role: 'member' },
  ]);

  // (assignee, points, daysAgoCompleted, title) — done 任务驱动贡献榜与趋势
  const done = [
    [admin, 3, 1, '设计数据库表结构'], [admin, 2, 4, '编写认证模块'], [admin, 5, 9, '搭建 CI 流程'],
    [member, 5, 2, '实现看板拖拽'], [member, 2, 3, '任务卡片样式'], [member, 3, 6, '评论 @ 提及'], [member, 1, 8, '修复登录跳转'],
    [li, 3, 1, '统计接口聚合'], [li, 2, 5, '排行榜组件'], [li, 8, 7, '趋势图表'], [li, 2, 10, '空状态文案'], [li, 1, 11, 'i18n 文案整理'],
    [wang, 2, 2, '部署脚本'], [wang, 5, 5, 'Docker 多阶段构建'], [wang, 3, 12, 'README 文档'],
  ];
  const open = [['优化看板性能', 'high'], ['移动端适配', 'medium'], ['导出贡献报表', 'low']];
  const doing = [[member, '甘特图原型', 5], [wang, '邮件通知', 3]];

  let r = 10;
  const rows = [];
  for (const [u, pts, ago, title] of done) {
    rows.push({ projectId: proj.id, title, status: 'done', assigneeId: u.id, points: pts, priority: 'medium', createdBy: admin.id, rank: rank(r++), completedAt: daysAgo(ago), completedBy: u.id });
  }
  for (const [u, title, pts] of doing) {
    rows.push({ projectId: proj.id, title, status: 'in_progress', assigneeId: u.id, points: pts, priority: 'high', createdBy: admin.id, rank: rank(r++) });
  }
  for (const [title, prio] of open) {
    rows.push({ projectId: proj.id, title, status: 'open', assigneeId: null, points: 2, priority: prio, createdBy: member.id, rank: rank(r++) });
  }
  await db.insert(schema.tasks).values(rows);
  console.log(`[demo] 已补充 ${rows.length} 条演示任务（4 名成员）`);
}

const app = await buildApp({
  db,
  sessionSecret: 'coboard-demo-secret-please-do-not-use-in-prod',
  production: false, // 关闭 Secure cookie，便于 http 端口转发预览
  webDistPath: WEB_DIST,
  routeLoader: 'autoload',
  logger: false,
});
await app.listen({ port: PORT, host: '127.0.0.1' });
console.log(`\n  Coboard 演示已启动 →  http://localhost:${PORT}`);
console.log('  登录: admin@coboard.local / changeme123 (管理员)  或  member@coboard.local / changeme123\n');
