import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context';
import { randomToken, safeEqual, sha256Hex } from '../crypto';

export const SESSION_DAYS = 30;
const SESSION_MAX_AGE_SEC = SESSION_DAYS * 24 * 60 * 60;

export function cookieOptions(ctx: AppContext, maxAgeSec?: number) {
  return { httpOnly: true, secure: ctx.config.cookieSecure, sameSite: 'lax' as const, path: '/', ...(maxAgeSec ? { maxAge: maxAgeSec } : {}) };
}

/** sign-in FR-6, FR-7: always a fresh random token; only its hash is stored. */
export async function startSession(ctx: AppContext, reply: FastifyReply, userId: string): Promise<void> {
  const token = randomToken(32);
  await ctx.pool.query(
    `INSERT INTO session (token_hash, user_id, csrf_token, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(days => $4))`,
    [sha256Hex(token), userId, randomToken(32), SESSION_DAYS],
  );
  reply.setCookie(ctx.cookies.session, token, cookieOptions(ctx, SESSION_MAX_AGE_SEC));
}

/** Loads the session for every request; extends it (BR-4, FR-8) and refreshes the cookie at most once a day. */
export function registerSessionHook(app: FastifyInstance, ctx: AppContext): void {
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (req, reply) => {
    const token = req.cookies[ctx.cookies.session];
    if (!token) return;
    const { rows } = await ctx.pool.query(
      `SELECT s.id, s.user_id, s.csrf_token, u.email, u.display_name,
              s.last_seen_at < now() - interval '1 minute' AS stale,
              s.cookie_refreshed_at < now() - interval '1 day' AS refresh_cookie
         FROM session s JOIN app_user u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [sha256Hex(token)],
    );
    const s = rows[0];
    if (!s) return;
    req.auth = { sessionId: s.id, userId: s.user_id, email: s.email, displayName: s.display_name, csrfToken: s.csrf_token };
    if (s.stale || s.refresh_cookie) {
      await ctx.pool.query(
        `UPDATE session SET last_seen_at = now(), expires_at = now() + make_interval(days => $3),
                cookie_refreshed_at = CASE WHEN $2 THEN now() ELSE cookie_refreshed_at END
          WHERE id = $1`,
        [s.id, s.refresh_cookie, SESSION_DAYS],
      );
      if (s.refresh_cookie) reply.setCookie(ctx.cookies.session, token, cookieOptions(ctx, SESSION_MAX_AGE_SEC));
    }
  });
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!req.auth) return reply.code(401).send({ code: 'unauthenticated' });
}

/** Rejects cross-site requests: a foreign Origin, or a missing/wrong CSRF token. */
export function checkOrigin(ctx: AppContext, req: FastifyRequest): boolean {
  const origin = req.headers.origin;
  return origin === undefined || origin === ctx.config.appOrigin;
}

export function makeRequireCsrf(ctx: AppContext) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers['x-csrf-token'];
    if (!checkOrigin(ctx, req) || typeof header !== 'string' || !req.auth || !safeEqual(header, req.auth.csrfToken)) {
      return reply.code(403).send({ code: 'csrf' });
    }
  };
}

export async function deleteExpiredSessions(ctx: AppContext): Promise<void> {
  await ctx.pool.query('DELETE FROM session WHERE expires_at <= now()');
  await ctx.pool.query("DELETE FROM idempotency_key WHERE created_at < now() - interval '1 day'");
}
