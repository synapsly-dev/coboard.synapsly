import type { FastifyPluginAsync } from 'fastify';
import {
  addProjectMemberInputSchema,
  createProjectInputSchema,
  idParamSchema,
  projectMemberParamsSchema,
  updateProjectInputSchema,
  type ProjectDirectoryResponse,
  type ProjectMembersResponse,
  type ProjectsListResponse,
} from 'shared';
import { isAdminRole } from 'shared';
import {
  listManagedTrackIds,
  requireAuth,
  requireProjectLead,
  requireProjectMember,
} from '../lib/guards.js';
import { forbidden, validationError } from '../lib/errors.js';
import { parseBody, parseParams } from '../lib/validate.js';
import {
  addProjectMember,
  createProject,
  joinProject,
  leaveProject,
  listProjectDirectory,
  listProjectMembers,
  listVisibleProjects,
  removeProjectMember,
  updateProject,
} from '../services/projectService.js';

/**
 * Project & membership routes (§6.3, §7). Handlers stay thin: run the auth/project
 * guards, validate the body/params against the shared zod contracts, then delegate
 * to projectService. Visibility (non-members cannot see a project) and lead/admin
 * mutation rules live in the guards + service.
 *
 *   GET    /projects                       — projects I can see (admin: all)
 *   GET    /projects/directory             — any user; all non-archived projects
 *   POST   /projects                       — admin, or 赛道经理 within their tracks
 *   PATCH  /projects/:id                   — lead/admin; trackId moves need admin
 *                                            or a 赛道经理 covering both endpoints
 *   POST   /projects/:id/join              — any user; self-join as member
 *   POST   /projects/:id/leave             — any user; self-leave
 *   GET    /projects/:id/members           — project members (member-visible)
 *   POST   /projects/:id/members           — lead/admin; add a user with a role
 *   DELETE /projects/:id/members/:userId   — lead/admin; remove a member
 */
const projectsRoutes: FastifyPluginAsync = async (fastify) => {
  const { db } = fastify;

  // List the projects the current user can see.
  fastify.get('/projects', async (request): Promise<ProjectsListResponse> => {
    const user = requireAuth(request);
    const projects = await listVisibleProjects(db, user);
    return { projects };
  });

  // Browsable directory of all non-archived projects (any logged-in user).
  // Registered ahead of the `/projects/:id`-style routes; Fastify matches this
  // static path before the parametric ones, and there is no `GET /projects/:id`.
  fastify.get('/projects/directory', async (request): Promise<ProjectDirectoryResponse> => {
    const user = requireAuth(request);
    const projects = await listProjectDirectory(db, user.id);
    return { projects };
  });

  // Create a project. Admin: unrestricted (trackId optional). 赛道运营经理
  // (2026-07-11 spec): allowed, but the project MUST be created inside one of
  // their managed tracks. Everyone else: 403. Creator auto-becomes lead.
  fastify.post('/projects', async (request, reply) => {
    const user = requireAuth(request);
    const input = parseBody(createProjectInputSchema, request.body);

    if (!isAdminRole(user.role)) {
      const managed = await listManagedTrackIds(db, user.id);
      if (managed.length === 0) {
        throw forbidden('需要管理员或赛道运营经理权限');
      }
      if (!input.trackId) {
        throw validationError('赛道运营经理创建项目必须选择所属赛道');
      }
      if (!managed.includes(input.trackId)) {
        throw forbidden('只能在自己管理的赛道内创建项目');
      }
    }

    const project = await createProject(db, user, input);
    return reply.code(201).send({ project });
  });

  // Update a project; lead or global admin only. Changing the owning 赛道
  // (trackId) is tighter (2026-07-11 spec): non-admins must be a 赛道运营经理 of
  // EVERY non-null endpoint (source and target) of the move — so a plain project
  // lead can no longer re-home a project, and a manager can only shuffle projects
  // among (or in/out of) the tracks they manage.
  fastify.patch('/projects/:id', async (request) => {
    const { id } = parseParams(idParamSchema, request.params);
    const membership = await requireProjectLead(db, request, id);
    const input = parseBody(updateProjectInputSchema, request.body);

    if (input.trackId !== undefined && !isAdminRole(membership.user.role)) {
      const managed = await listManagedTrackIds(db, membership.user.id);
      const endpoints = [membership.project.trackId, input.trackId].filter(
        (t): t is string => t !== null,
      );
      if (endpoints.some((t) => !managed.includes(t))) {
        throw forbidden('只能在自己管理的赛道内调整项目归属');
      }
    }

    const project = await updateProject(db, id, input);
    return { project };
  });

  // Self-join a project as a member (any logged-in user); idempotent.
  fastify.post('/projects/:id/join', async (request) => {
    const user = requireAuth(request);
    const { id } = parseParams(idParamSchema, request.params);
    await joinProject(db, user.id, id);
    return { ok: true };
  });

  // Self-leave a project (any logged-in user); 409 if sole remaining lead.
  fastify.post('/projects/:id/leave', async (request) => {
    const user = requireAuth(request);
    const { id } = parseParams(idParamSchema, request.params);
    await leaveProject(db, user.id, id);
    return { ok: true };
  });

  // List a project's members; any member (or admin) may view.
  fastify.get('/projects/:id/members', async (request): Promise<ProjectMembersResponse> => {
    const { id } = parseParams(idParamSchema, request.params);
    await requireProjectMember(db, request, id);
    const members = await listProjectMembers(db, id);
    return { members };
  });

  // Add a member; lead or global admin only.
  fastify.post('/projects/:id/members', async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);
    const membership = await requireProjectLead(db, request, id);
    const input = parseBody(addProjectMemberInputSchema, request.body);
    const member = await addProjectMember(db, id, input, fastify.bus, membership.user.id);
    return reply.code(201).send({ member });
  });

  // Remove a member; lead or global admin only.
  fastify.delete('/projects/:id/members/:userId', async (request, reply) => {
    const { id, userId } = parseParams(projectMemberParamsSchema, request.params);
    const membership = await requireProjectLead(db, request, id);
    await removeProjectMember(db, id, userId, fastify.bus, membership.user.id);
    return reply.code(204).send();
  });
};

export default projectsRoutes;
