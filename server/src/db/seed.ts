import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import type { Database } from './index.js';
import { createDb, resolveDatabaseUrl } from './index.js';
import {
  projectMembers,
  projects,
  tasks,
  users,
  type NewTaskRow,
} from './schema.js';

/**
 * Optional demo seed (§9). Behind the SEED_DEMO env flag, populates a demo admin,
 * a demo project, and a handful of sample tasks — but only when the DB is empty,
 * so it never clobbers real data. Safe to run on every boot.
 */

const AVATAR_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

/** Build a midpoint-style rank string for ordering. */
function rankFor(index: number): string {
  // Simple, monotonically increasing keys with gaps for later inserts.
  return String((index + 1) * 1000).padStart(8, '0');
}

export async function maybeSeed(db: Database): Promise<void> {
  const existing = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users);
  if ((existing[0]?.count ?? 0) > 0) {
    // eslint-disable-next-line no-console
    console.log('[seed] 已存在用户，跳过演示数据');
    return;
  }

  // eslint-disable-next-line no-console
  console.log('[seed] 写入演示数据...');

  // Passwordless: identity is Synapsly ID. With DEV_LOGIN=true these demo
  // accounts can be entered by email via the local fake-login.
  const [admin] = await db
    .insert(users)
    .values({
      email: 'admin@coboard.local',
      passwordHash: null,
      displayName: '演示管理员',
      avatarColor: AVATAR_COLORS[0]!,
      role: 'admin',
      isActive: true,
    })
    .returning();
  if (!admin) throw new Error('seed: 创建管理员失败');

  const [member] = await db
    .insert(users)
    .values({
      email: 'member@coboard.local',
      passwordHash: null,
      displayName: '演示成员',
      avatarColor: AVATAR_COLORS[1]!,
      role: 'member',
      isActive: true,
    })
    .returning();
  if (!member) throw new Error('seed: 创建成员失败');

  const [project] = await db
    .insert(projects)
    .values({
      name: '演示项目',
      key: 'DEMO',
      description: '用于体验 Coboard 的示例项目',
      createdBy: admin.id,
    })
    .returning();
  if (!project) throw new Error('seed: 创建项目失败');

  await db.insert(projectMembers).values([
    { projectId: project.id, userId: admin.id, role: 'lead' },
    { projectId: project.id, userId: member.id, role: 'member' },
  ]);

  const sampleTasks: NewTaskRow[] = [
    {
      projectId: project.id,
      title: '搭建项目脚手架',
      description: '初始化仓库与基础配置',
      status: 'done',
      assigneeId: admin.id,
      points: 3,
      priority: 'high',
      createdBy: admin.id,
      rank: rankFor(0),
      completedAt: new Date(),
      completedBy: admin.id,
    },
    {
      projectId: project.id,
      title: '实现看板拖拽',
      description: '支持跨列与列内排序',
      status: 'in_progress',
      assigneeId: member.id,
      points: 5,
      priority: 'medium',
      createdBy: admin.id,
      rank: rankFor(1),
    },
    {
      projectId: project.id,
      title: '撰写部署文档',
      description: '中文三步部署说明',
      status: 'open',
      assigneeId: null,
      points: 2,
      priority: 'low',
      createdBy: member.id,
      rank: rankFor(2),
    },
  ];
  await db.insert(tasks).values(sampleTasks);

  // eslint-disable-next-line no-console
  console.log('[seed] 演示数据已写入 (admin@coboard.local — 用 DEV_LOGIN 假登录进入)');
}

// Standalone runner: `pnpm --filter server seed`.
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const { db, close } = createDb(resolveDatabaseUrl());
  maybeSeed(db)
    .then(async () => {
      await close();
      process.exit(0);
    })
    .catch(async (err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[seed] 失败:', err);
      await close();
      process.exit(1);
    });
}
