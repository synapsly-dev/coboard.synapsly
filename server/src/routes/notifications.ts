import type { FastifyPluginAsync } from 'fastify';
import {
  entitySubscriptionParamsSchema,
  idParamSchema,
  notificationsQuerySchema,
  setEntitySubscriptionInputSchema,
  setNotificationPreferenceInputSchema,
  type EntitySubscriptionsResponse,
  type NotificationCountsResponse,
  type NotificationPreferencesResponse,
  type NotificationsQuery,
  type NotificationsResponse,
} from 'shared';
import { requireAuth } from '../lib/guards.js';
import { parseBody, parseParams, parseQuery } from '../lib/validate.js';
import {
  archiveNotification,
  getNotificationCounts,
  listEntitySubscriptions,
  listNotificationPreferences,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  removeEntitySubscription,
  setEntitySubscription,
  setNotificationPreference,
} from '../services/notificationService.js';

/** Private notification centre endpoints; every operation is recipient-scoped. */
const notificationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/notifications', async (request): Promise<NotificationsResponse> => {
    const user = requireAuth(request);
    const query = parseQuery(notificationsQuerySchema, request.query) as NotificationsQuery;
    return listNotifications(fastify.db, user.id, query);
  });

  fastify.get('/notifications/counts', async (request): Promise<NotificationCountsResponse> => {
    const user = requireAuth(request);
    return { counts: await getNotificationCounts(fastify.db, user.id) };
  });

  fastify.get(
    '/notifications/preferences',
    async (request): Promise<NotificationPreferencesResponse> => {
      const user = requireAuth(request);
      return { preferences: await listNotificationPreferences(fastify.db, user.id) };
    },
  );

  fastify.put('/notifications/preferences', async (request, reply) => {
    const user = requireAuth(request);
    const input = parseBody(setNotificationPreferenceInputSchema, request.body);
    await setNotificationPreference(fastify.db, user.id, input);
    return reply.code(204).send();
  });

  fastify.get(
    '/notifications/subscriptions',
    async (request): Promise<EntitySubscriptionsResponse> => {
      const user = requireAuth(request);
      return { subscriptions: await listEntitySubscriptions(fastify.db, user.id) };
    },
  );

  fastify.put('/notifications/subscriptions', async (request, reply) => {
    const user = requireAuth(request);
    const input = parseBody(setEntitySubscriptionInputSchema, request.body);
    await setEntitySubscription(fastify.db, user.id, input);
    return reply.code(204).send();
  });

  fastify.delete('/notifications/subscriptions/:entityType/:entityId', async (request, reply) => {
    const user = requireAuth(request);
    const { entityType, entityId } = parseParams(entitySubscriptionParamsSchema, request.params);
    await removeEntitySubscription(fastify.db, user.id, entityType, entityId);
    return reply.code(204).send();
  });

  fastify.post('/notifications/read-all', async (request, reply) => {
    const user = requireAuth(request);
    await markAllNotificationsRead(fastify.db, fastify.bus, user.id);
    return reply.code(204).send();
  });

  fastify.post('/notifications/:id/read', async (request, reply) => {
    const user = requireAuth(request);
    const { id } = parseParams(idParamSchema, request.params);
    await markNotificationRead(fastify.db, fastify.bus, user.id, id);
    return reply.code(204).send();
  });

  fastify.delete('/notifications/:id', async (request, reply) => {
    const user = requireAuth(request);
    const { id } = parseParams(idParamSchema, request.params);
    await archiveNotification(fastify.db, fastify.bus, user.id, id);
    return reply.code(204).send();
  });
};

export default notificationRoutes;
