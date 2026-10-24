import type { FastifyReply, FastifyInstance, FastifyRequest } from 'fastify';
import { LIMITS, validateWineInput, validationContextFor } from '@cellar/shared';
import { makeRequireCsrf, requireAuth } from '../auth/session';
import type { AppContext } from '../context';
import { createWine } from './create';
import { changeQuantity, deleteWine, updateWine } from './edit';
import { listWines, parseListQuery } from './list';
import type { Outcome } from './transaction';
import { fetchWine } from './view';

const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));
const isCurrency = (code: string) => CURRENCIES.has(code);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

type IdRequest = FastifyRequest<{ Params: { id: string } }>;

export function registerWineRoutes(app: FastifyInstance, ctx: AppContext): void {
  const requireCsrf = makeRequireCsrf(ctx);

  /** Shared write guard: session, CSRF, and one rate limit for all changes. */
  const writeGuard = [
    requireAuth,
    requireCsrf,
    async (req: FastifyRequest, reply: FastifyReply) => {
      const rl = ctx.limits.writesPerUser.hit(req.auth!.userId);
      if (!rl.allowed) return reply.code(429).header('Retry-After', rl.retryAfterSec).send({ code: 'rate_limited' });
    },
  ];

  /** Unknown and other users' ids are both 404 (view-edit-wine FR-2). */
  const validId = async (req: IdRequest, reply: FastifyReply) => {
    if (!UUID.test(req.params.id)) return reply.code(404).send({ code: 'not_found' });
  };

  const idempotencyKey = (req: FastifyRequest, reply: FastifyReply): string | null | false => {
    const header = req.headers['idempotency-key'];
    if (typeof header !== 'string' || header.length === 0) return null;
    if (header.length > 200) {
      reply.code(400).send({ errors: [{ field: 'Idempotency-Key', code: 'too_long', message: 'Idempotency-Key must be 200 characters or fewer' }] });
      return false;
    }
    return header;
  };

  const send = (reply: FastifyReply, outcome: Outcome) => {
    if (outcome.location) reply.header('Location', outcome.location);
    return outcome.body === undefined ? reply.code(outcome.status).send() : reply.code(outcome.status).send(outcome.body);
  };

  app.post('/collection/wines', { preHandler: writeGuard }, async (req, reply) => {
    const now = ctx.now();
    const result = validateWineInput(req.body, validationContextFor(now, isCurrency));
    if (!result.ok) return reply.code(400).send({ errors: result.errors });
    const key = idempotencyKey(req, reply);
    if (key === false) return reply;
    return send(reply, await createWine(ctx.pool, req.auth!.userId, result.value, key, now.getUTCFullYear()));
  });

  app.get('/collection/wines', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = parseListQuery(req.query as Record<string, unknown>, ctx.keys.cursor);
    if (!parsed.ok) return reply.code(400).send({ errors: parsed.errors });
    return listWines(ctx.pool, req.auth!.userId, parsed.query, ctx.keys.cursor, ctx.now().getUTCFullYear());
  });

  app.get('/collection/wines/:id', { preHandler: [requireAuth, validId] }, async (req: IdRequest, reply) => {
    const wine = await fetchWine(ctx.pool, req.params.id, ctx.now().getUTCFullYear(), req.auth!.userId);
    return wine ? wine : reply.code(404).send({ code: 'not_found' });
  });

  app.put('/collection/wines/:id', { preHandler: [...writeGuard, validId] }, async (req: IdRequest, reply) => {
    const { version, ...fields } = isObject(req.body) ? req.body : {};
    if (!Number.isInteger(version) || (version as number) < 1) {
      return reply.code(400).send({ errors: [{ field: 'version', code: 'required', message: 'version is required' }] });
    }
    const now = ctx.now();
    const result = validateWineInput(fields, validationContextFor(now, isCurrency), { minQuantity: 0 });
    if (!result.ok) return reply.code(400).send({ errors: result.errors });
    const key = idempotencyKey(req, reply);
    if (key === false) return reply;
    return send(reply, await updateWine(ctx.pool, req.auth!.userId, req.params.id, result.value, version as number, key, now.getUTCFullYear()));
  });

  app.post('/collection/wines/:id/quantity', { preHandler: [...writeGuard, validId] }, async (req: IdRequest, reply) => {
    const change = isObject(req.body) ? req.body.change : undefined;
    if (!Number.isInteger(change) || change === 0 || Math.abs(change as number) > LIMITS.quantityMax) {
      return reply.code(400).send({ errors: [{ field: 'change', code: 'invalid', message: 'Change must be a non-zero whole number' }] });
    }
    const key = idempotencyKey(req, reply);
    if (key === false) return reply;
    return send(reply, await changeQuantity(ctx.pool, req.auth!.userId, req.params.id, change as number, key));
  });

  app.delete('/collection/wines/:id', { preHandler: [...writeGuard, validId] }, async (req: IdRequest, reply) => {
    return send(reply, await deleteWine(ctx.pool, req.auth!.userId, req.params.id));
  });
}
