import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Writable } from 'node:stream';
import { registerAuthRoutes } from './auth/routes';
import { registerSessionHook } from './auth/session';
import type { Config } from './config';
import { cookieNames, type AppContext } from './context';
import { deriveKeys } from './crypto';
import type { Pool } from './db/pool';
import type { FakeIdentityProvider } from './identity/fake';
import type { IdentityProvider } from './identity/provider';
import { registerLookupRoutes } from './lookups/routes';
import { RateLimiter } from './rateLimit';
import { registerWebApp } from './web';
import { registerWineRoutes } from './wines/routes';

/** Production Content-Security-Policy: everything from our own origin; no inline scripts or styles. */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export interface AppDeps {
  config: Config;
  pool: Pool;
  identity: IdentityProvider | FakeIdentityProvider;
  now?: () => Date;
  /** Where logs go (tests capture them to check nothing secret is logged). */
  logStream?: Writable;
  /** Requests per minute; browser tests sign many users in from one IP. */
  rateLimits?: Partial<Record<keyof AppContext['limits'], number>>;
}

export async function buildApp(deps: AppDeps): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const { config } = deps;
  const app = Fastify({
    trustProxy: true,
    logger: config.logLevel
      ? {
          level: config.logLevel,
          ...(deps.logStream ? { stream: deps.logStream } : {}),
          // Never log query strings: they carry auth codes, state and search text (sign-in §10, view-collection §10).
          serializers: { req: (req) => ({ method: req.method, url: req.url.split('?')[0] }) },
        }
      : false,
  });

  const ctx: AppContext = {
    config,
    pool: deps.pool,
    identity: deps.identity,
    keys: deriveKeys(config.sessionSecret),
    cookies: cookieNames(config.cookieSecure),
    now: deps.now ?? (() => new Date()),
    limits: {
      authPerIp: new RateLimiter(deps.rateLimits?.authPerIp ?? 60),
      authPerAccount: new RateLimiter(deps.rateLimits?.authPerAccount ?? 10),
      writesPerUser: new RateLimiter(deps.rateLimits?.writesPerUser ?? 60),
    },
  };

  await app.register(cookie);

  // Security headers on every response (sign-in §10, view-edit-wine §10).
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (config.isProduction) {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      reply.header('Content-Security-Policy', CSP);
    }
    return payload;
  });

  app.setErrorHandler((err: { statusCode?: number; code?: string }, req, reply) => {
    if (err.statusCode && err.statusCode < 500) {
      const code = err.code === 'FST_ERR_CTP_INVALID_JSON_BODY' || err.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' ? 'invalid_json' : 'bad_request';
      return reply.code(err.statusCode).send({ errors: [{ field: 'body', code, message: 'The request could not be read' }] });
    }
    req.log.error(err);
    return reply.code(500).send({ code: 'server_error' });
  });

  if (deps.identity.kind === 'fake') (deps.identity as FakeIdentityProvider).registerRoutes(app);

  await app.register(
    async (api) => {
      // For the host's health check: the server is up and the database answers.
      api.get('/health', async () => {
        await ctx.pool.query('SELECT 1');
        return { status: 'ok' };
      });
      registerSessionHook(api, ctx);
      registerAuthRoutes(api, ctx);
      registerLookupRoutes(api, ctx);
      registerWineRoutes(api, ctx);
    },
    { prefix: '/api/v1' },
  );

  if (config.webDistDir) await registerWebApp(app, config.webDistDir);

  return { app, ctx };
}
