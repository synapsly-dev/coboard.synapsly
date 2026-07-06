import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  createOrgNodeInputSchema,
  idParamSchema,
  moveOrgNodeInputSchema,
  orgTreeQuerySchema,
  setOrgMembersInputSchema,
  updateOrgNodeInputSchema,
  type OrgNodeResponse,
  type OrgScope,
  type OrgTreeResponse,
} from 'shared';
import type { Database } from '../db/index.js';
import {
  requireAdmin,
  requireAuth,
  requireProjectLead,
  requireProjectMember,
} from '../lib/guards.js';
import { parseBody, parseParams, parseQuery } from '../lib/validate.js';
import {
  createNode,
  deleteNode,
  listTree,
  loadOrgNodeOrThrow,
  moveNode,
  scopeOfNode,
  setMembers,
  updateNode,
} from '../services/orgService.js';

/**
 * Org-tree / 团队架构 routes (division-of-labor & positions page):
 * - GET    /org/tree?scope=all|<projectId>   the whole tree for a scope (any viewer)
 * - POST   /org/nodes                        create a node (scope-editor)
 * - PATCH  /org/nodes/:id                    edit title / kind / description (editor)
 * - POST   /org/nodes/:id/move               reparent / reorder (editor)
 * - DELETE /org/nodes/:id                    delete node + subtree, cascade (editor)
 * - PUT    /org/nodes/:id/members            replace the node's 负责人/成员 set (editor)
 *
 * Scope gating:
 * - READ  — the whole-team ('all') tree is visible to every logged-in user; a project
 *   tree requires project membership (a global admin sees any).
 * - WRITE — the whole-team tree requires a global admin; a project tree requires that
 *   project's lead (a global admin is lead-equivalent everywhere).
 * Data access + realtime fan-out live in orgService.
 */

/**
 * Enforce read access to a scope. Whole-team ('all') → any authenticated user; a
 * project scope → project member (admins included). Throws 401/403 otherwise.
 */
async function assertCanViewScope(
  db: Database,
  request: FastifyRequest,
  scope: OrgScope,
): Promise<void> {
  if (scope === 'all') {
    requireAuth(request);
    return;
  }
  await requireProjectMember(db, request, scope);
}

/**
 * Enforce write access to a scope. Whole-team ('all') → global admin; a project scope
 * → that project's lead (or a global admin). Throws 401/403 otherwise.
 */
async function assertCanEditScope(
  db: Database,
  request: FastifyRequest,
  scope: OrgScope,
): Promise<void> {
  if (scope === 'all') {
    requireAdmin(request);
    return;
  }
  await requireProjectLead(db, request, scope);
}

const orgRoutes: FastifyPluginAsync = async (fastify) => {
  const { db, bus } = fastify;

  // --- GET /org/tree -------------------------------------------------------
  fastify.get('/org/tree', async (request): Promise<OrgTreeResponse> => {
    // `.default('all')` makes the parsed value optional at the type level; coalesce.
    const scope: OrgScope = parseQuery(orgTreeQuerySchema, request.query).scope ?? 'all';
    await assertCanViewScope(db, request, scope);
    const nodes = await listTree(db, scope);
    return { scope, nodes };
  });

  // --- POST /org/nodes -----------------------------------------------------
  fastify.post('/org/nodes', async (request, reply): Promise<OrgNodeResponse> => {
    const input = parseBody(createOrgNodeInputSchema, request.body);
    await assertCanEditScope(db, request, input.scope);
    const node = await createNode(db, input, bus);
    reply.code(201);
    return { node };
  });

  // --- PATCH /org/nodes/:id ------------------------------------------------
  fastify.patch('/org/nodes/:id', async (request): Promise<OrgNodeResponse> => {
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(updateOrgNodeInputSchema, request.body);
    const existing = await loadOrgNodeOrThrow(db, id);
    await assertCanEditScope(db, request, scopeOfNode(existing));
    const node = await updateNode(db, existing, input, bus);
    return { node };
  });

  // --- POST /org/nodes/:id/move --------------------------------------------
  fastify.post('/org/nodes/:id/move', async (request): Promise<OrgNodeResponse> => {
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(moveOrgNodeInputSchema, request.body);
    const existing = await loadOrgNodeOrThrow(db, id);
    await assertCanEditScope(db, request, scopeOfNode(existing));
    const node = await moveNode(db, existing, input, bus);
    return { node };
  });

  // --- DELETE /org/nodes/:id -----------------------------------------------
  fastify.delete('/org/nodes/:id', async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);
    const existing = await loadOrgNodeOrThrow(db, id);
    await assertCanEditScope(db, request, scopeOfNode(existing));
    await deleteNode(db, existing, bus);
    return reply.code(204).send();
  });

  // --- PUT /org/nodes/:id/members ------------------------------------------
  fastify.put('/org/nodes/:id/members', async (request): Promise<OrgNodeResponse> => {
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(setOrgMembersInputSchema, request.body);
    const existing = await loadOrgNodeOrThrow(db, id);
    await assertCanEditScope(db, request, scopeOfNode(existing));
    const node = await setMembers(db, existing, input, bus);
    return { node };
  });
};

export default orgRoutes;
