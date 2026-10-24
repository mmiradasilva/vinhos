import type { FastifyInstance, FastifyReply } from 'fastify';
import { DEFAULT_RETURN_TO, isSafeReturnTo } from '@cellar/shared';
import type { AppContext } from '../context';
import { pkceChallenge, randomToken, safeEqual, seal, unseal } from '../crypto';
import { checkOrigin, cookieOptions, makeRequireCsrf, requireAuth, startSession } from './session';

const TEMP_COOKIE_MAX_AGE_SEC = 60 * 60;
const TEMP_STATE_TTL_MS = 10 * 60 * 1000;

interface AuthRequest {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  attempt: number;
  exp: number;
}

interface PendingSignup {
  sub: string;
  email: string;
  name: string | null;
  returnTo: string;
  csrf: string;
  exp: number;
}

const RATE_LIMITED_PAGE = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Too many attempts</title>
<p>Too many sign-in attempts. Wait a minute and try again.</p><p><a href="/signin">Back to sign in</a></p></html>`;

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const requireCsrf = makeRequireCsrf(ctx);
  const tempCookie = cookieOptions(ctx, TEMP_COOKIE_MAX_AGE_SEC);
  const clear = (reply: FastifyReply, name: string) => reply.clearCookie(name, cookieOptions(ctx));
  const fail = (reply: FastifyReply, error: string) => reply.redirect(`/signin?error=${error}`);

  const readPending = (raw: string | undefined) => {
    const p = unseal<PendingSignup>(raw, ctx.keys.cookie);
    return p && p.exp > Date.now() ? p : null;
  };

  app.get('/auth/google/start', async (req, reply) => {
    if (!ctx.limits.authPerIp.hit(req.ip).allowed) return reply.code(429).type('text/html').send(RATE_LIMITED_PAGE);
    const q = req.query as Record<string, string | undefined>;
    const request: AuthRequest = {
      state: randomToken(24),
      nonce: randomToken(24),
      verifier: randomToken(48),
      returnTo: isSafeReturnTo(q.return_to) ? q.return_to : DEFAULT_RETURN_TO,
      attempt: q.attempt === '2' ? 2 : 1,
      exp: Date.now() + TEMP_STATE_TTL_MS,
    };
    reply.setCookie(ctx.cookies.authRequest, seal(request, ctx.keys.cookie), tempCookie);
    return reply.redirect(
      ctx.identity.authorizationUrl({ state: request.state, nonce: request.nonce, codeChallenge: pkceChallenge(request.verifier) }),
    );
  });

  app.get('/auth/google/callback', async (req, reply) => {
    if (!ctx.limits.authPerIp.hit(req.ip).allowed) return fail(reply, 'rate_limited');
    const raw = req.cookies[ctx.cookies.authRequest];
    clear(reply, ctx.cookies.authRequest);
    if (!raw) return fail(reply, 'cookies');
    const request = unseal<AuthRequest>(raw, ctx.keys.cookie);
    if (!request) return fail(reply, 'failed');
    if (request.exp < Date.now()) {
      if (request.attempt < 2) {
        return reply.redirect(`/api/v1/auth/google/start?return_to=${encodeURIComponent(request.returnTo)}&attempt=2`);
      }
      return fail(reply, 'failed');
    }

    const params = new URLSearchParams(req.url.split('?')[1] ?? '');
    if (params.get('error')) return fail(reply, params.get('error') === 'access_denied' ? 'cancelled' : 'failed');
    const state = params.get('state');
    if (!state || !safeEqual(state, request.state)) return fail(reply, 'failed');

    let claims;
    try {
      claims = await ctx.identity.exchange({ callbackParams: params, state: request.state, nonce: request.nonce, codeVerifier: request.verifier });
    } catch (err) {
      req.log.warn({ reason: (err as Error).message }, 'sign-in exchange failed');
      return fail(reply, 'failed');
    }
    if (!claims.email_verified || !claims.email) return fail(reply, 'unverified');
    if (!ctx.limits.authPerAccount.hit(claims.sub).allowed) return fail(reply, 'rate_limited');

    const existing = await ctx.pool.query<{ id: string }>(
      `UPDATE app_user SET email = $2, display_name = $3, last_sign_in_at = now() WHERE google_sub = $1 RETURNING id`,
      [claims.sub, claims.email, claims.name ?? null],
    );
    if (existing.rows[0]) {
      await startSession(ctx, reply, existing.rows[0].id);
      req.log.info({ userId: existing.rows[0].id }, 'signed in');
      return reply.redirect(request.returnTo);
    }

    // sign-in FR-4: nothing is stored until the terms are accepted.
    const pending: PendingSignup = {
      sub: claims.sub,
      email: claims.email,
      name: claims.name ?? null,
      returnTo: request.returnTo,
      csrf: randomToken(32),
      exp: Date.now() + TEMP_STATE_TTL_MS,
    };
    reply.setCookie(ctx.cookies.pendingSignup, seal(pending, ctx.keys.cookie), tempCookie);
    return reply.redirect('/welcome');
  });

  app.get('/auth/pending-signup', async (req, reply) => {
    const pending = readPending(req.cookies[ctx.cookies.pendingSignup]);
    if (!pending) return reply.code(404).send({ code: 'no_pending_signup' });
    return { email: pending.email, display_name: pending.name, terms_version: ctx.config.termsVersion, csrf_token: pending.csrf };
  });

  // "Cancel" on the terms screen: discard the pending sign-up.
  app.delete('/auth/pending-signup', async (req, reply) => {
    if (!checkOrigin(ctx, req)) return reply.code(403).send({ code: 'csrf' });
    clear(reply, ctx.cookies.pendingSignup);
    return reply.code(204).send();
  });

  app.post('/auth/signup', async (req, reply) => {
    if (!checkOrigin(ctx, req)) return reply.code(403).send({ code: 'csrf' });
    const pending = readPending(req.cookies[ctx.cookies.pendingSignup]);
    if (!pending) {
      clear(reply, ctx.cookies.pendingSignup);
      return reply.code(410).send({ code: 'signup_expired' });
    }
    const header = req.headers['x-csrf-token'];
    if (typeof header !== 'string' || !safeEqual(header, pending.csrf)) return reply.code(403).send({ code: 'csrf' });
    const body = req.body as { accept_terms?: unknown } | undefined;
    if (body?.accept_terms !== true) {
      return reply.code(400).send({ errors: [{ field: 'accept_terms', code: 'required', message: 'Agree to the terms to continue' }] });
    }
    // BR-6/BR-7: acceptance and version are set by the server. A double submit signs in the same user.
    const { rows } = await ctx.pool.query<{ id: string }>(
      `INSERT INTO app_user (google_sub, email, display_name, terms_accepted_at, terms_version)
       VALUES ($1, $2, $3, now(), $4)
       ON CONFLICT (google_sub) DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name, last_sign_in_at = now()
       RETURNING id`,
      [pending.sub, pending.email, pending.name, ctx.config.termsVersion],
    );
    await startSession(ctx, reply, rows[0].id);
    clear(reply, ctx.cookies.pendingSignup);
    req.log.info({ userId: rows[0].id }, 'account created');
    return reply.code(201).send({ return_to: pending.returnTo });
  });

  app.post('/auth/logout', { preHandler: [requireAuth, requireCsrf] }, async (req, reply) => {
    await ctx.pool.query('DELETE FROM session WHERE id = $1', [req.auth!.sessionId]);
    clear(reply, ctx.cookies.session);
    return reply.code(204).send();
  });

  app.get('/me', { preHandler: requireAuth }, async (req) => {
    const a = req.auth!;
    return { id: a.userId, email: a.email, display_name: a.displayName, csrf_token: a.csrfToken };
  });
}
