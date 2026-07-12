import type { FastifyPluginAsync } from 'fastify';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import projectsRoutes from './routes/projects.js';
import tracksRoutes from './routes/tracks.js';
import tasksRoutes from './routes/tasks.js';
import labelsRoutes from './routes/labels.js';
import commentsRoutes from './routes/comments.js';
import ideasRoutes from './routes/ideas.js';
import taskFilesRoutes from './routes/task-files.js';
import ideaFilesRoutes from './routes/idea-files.js';
import commentFilesRoutes from './routes/comment-files.js';
import taskTextsRoutes from './routes/task-texts.js';
import statsRoutes from './routes/stats.js';
import streamRoutes from './routes/stream.js';
import settingsRoutes from './routes/settings.js';
import announcementsRoutes from './routes/announcements.js';
import orgRoutes from './routes/org.js';
import workbenchRoutes from './routes/workbench.js';
import assetsRoutes from './routes/assets.js';
import exportRoutes from './routes/export.js';

/**
 * Explicit route registration. In production `@fastify/autoload` scans the
 * `routes/` directory; in tests (Vitest), autoload's native dynamic import
 * bypasses the Vite transform, so the app builder registers routes through this
 * static map instead. Kept OUTSIDE `routes/` so autoload does not treat it as the
 * directory's index plugin. Keep this list in sync with the route files.
 */
export const registerRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(authRoutes);
  await fastify.register(usersRoutes);
  await fastify.register(projectsRoutes);
  await fastify.register(tracksRoutes);
  await fastify.register(tasksRoutes);
  await fastify.register(labelsRoutes);
  await fastify.register(commentsRoutes);
  await fastify.register(ideasRoutes);
  await fastify.register(taskFilesRoutes);
  await fastify.register(ideaFilesRoutes);
  await fastify.register(commentFilesRoutes);
  await fastify.register(taskTextsRoutes);
  await fastify.register(statsRoutes);
  await fastify.register(streamRoutes);
  await fastify.register(settingsRoutes);
  await fastify.register(announcementsRoutes);
  await fastify.register(orgRoutes);
  await fastify.register(workbenchRoutes);
  await fastify.register(assetsRoutes);
  await fastify.register(exportRoutes);
};
