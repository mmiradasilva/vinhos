import { Writable } from 'node:stream';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { inject } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig, type Config } from '../src/config';
import type { AppContext } from '../src/context';
import { createPool, type Pool } from '../src/db/pool';
import { createFakeProvider, type FakeIdentityProvider } from '../src/identity/fake';
import type { IdentityClaims } from '../src/identity/provider';

export const ORIGIN = 'http://localhost:5173';

export interface TestApp {
  app: FastifyInstance;
  ctx: AppContext;
  pool: Pool;
  fake: FakeIdentityProvider;
  logs: string[];
  close: () => Promise<void>;
}

let sharedPool: Pool | null = null;

export async function createTestApp(opts: { now?: () => Date; config?: Partial<Config> } = {}): Promise<TestApp> {
  sharedPool ??= createPool(inject('databaseUrl'));
  const logs: string[] = [];
  const logStream = new Writable({
    write(chunk, _enc, done) {
      logs.push(String(chunk));
      done();
    },
  });
  const config: Config = {
    ...loadConfig({ NODE_ENV: 'test', APP_ORIGIN: ORIGIN, COOKIE_SECURE: 'true', LOG_LEVEL: 'info' }),
    ...opts.config,
  };
  const fake = createFakeProvider();
  const { app, ctx } = await buildApp({ config, pool: sharedPool, identity: fake, now: opts.now, logStream });
  await app.ready();
  return { app, ctx, pool: sharedPool, fake, logs, close: () => app.close() };
}

/** Deletes everything users created; keeps seeded lookups. */
export async function resetDb(pool: Pool): Promise<void> {
  await pool.query(`
    DELETE FROM wine_grape; DELETE FROM wine; DELETE FROM idempotency_key; DELETE FROM session;
    DELETE FROM producer; DELETE FROM grape WHERE created_by IS NOT NULL OR NOT is_public;
    DELETE FROM region WHERE created_by IS NOT NULL OR NOT is_public; DELETE FROM app_user;`);
}

export function cookieValue(res: LightMyRequestResponse, name: string): string | undefined {
  return res.cookies.find((c) => c.name === name)?.value;
}

/** Runs /start and returns what the fake Google page would receive, plus the auth_request cookie. */
export async function startSignIn(t: TestApp, returnTo = '/collection') {
  const res = await t.app.inject({ method: 'GET', url: `/api/v1/auth/google/start?return_to=${encodeURIComponent(returnTo)}` });
  const url = new URL(res.headers.location as string, ORIGIN);
  return {
    res,
    authCookie: cookieValue(res, t.ctx.cookies.authRequest)!,
    state: url.searchParams.get('state')!,
    nonce: url.searchParams.get('nonce')!,
    codeChallenge: url.searchParams.get('code_challenge')!,
  };
}

export function claimsFor(email: string, extra: Partial<IdentityClaims> = {}): IdentityClaims {
  return { sub: `sub-${email}`, email, email_verified: true, name: email.split('@')[0], ...extra };
}

/** Completes the Google callback; returns the response (redirect to returnTo or /welcome). */
export async function callback(t: TestApp, claims: IdentityClaims, returnTo = '/collection') {
  const s = await startSignIn(t, returnTo);
  const code = t.fake.issueCode({ nonce: s.nonce, codeChallenge: s.codeChallenge, claims });
  return t.app.inject({
    method: 'GET',
    url: `/api/v1/auth/google/callback?code=${code}&state=${s.state}`,
    cookies: { [t.ctx.cookies.authRequest]: s.authCookie },
  });
}

export interface Session {
  cookie: string;
  csrf: string;
  userId: string;
}

/** Full sign-up (first time) or sign-in (returning), returning a usable session. */
export async function signIn(t: TestApp, email: string): Promise<Session> {
  const res = await callback(t, claimsFor(email));
  let cookie = cookieValue(res, t.ctx.cookies.session);
  if (!cookie) {
    const pending = cookieValue(res, t.ctx.cookies.pendingSignup)!;
    const info = await t.app.inject({ method: 'GET', url: '/api/v1/auth/pending-signup', cookies: { [t.ctx.cookies.pendingSignup]: pending } });
    const signup = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      headers: { 'x-csrf-token': info.json().csrf_token, origin: ORIGIN },
      cookies: { [t.ctx.cookies.pendingSignup]: pending },
      payload: { accept_terms: true },
    });
    cookie = cookieValue(signup, t.ctx.cookies.session)!;
  }
  const me = await t.app.inject({ method: 'GET', url: '/api/v1/me', cookies: { [t.ctx.cookies.session]: cookie } });
  return { cookie, csrf: me.json().csrf_token, userId: me.json().id };
}

export function as(t: TestApp, s: Session) {
  const cookies = { [t.ctx.cookies.session]: s.cookie };
  return {
    get: (url: string) => t.app.inject({ method: 'GET', url: `/api/v1${url}`, cookies }),
    post: (url: string, payload?: unknown, headers: Record<string, string> = {}) =>
      t.app.inject({
        method: 'POST',
        url: `/api/v1${url}`,
        cookies,
        headers: { 'x-csrf-token': s.csrf, origin: ORIGIN, ...headers },
        ...(payload === undefined ? {} : { payload: payload as object }),
      }),
  };
}

/** Seeded ids: colour red = 1, white = 2, bottle 750 ml = 4. */
export const RED = 1;
export const WHITE = 2;
export const BOTTLE_750 = 4;

export async function countryId(pool: Pool, iso: string): Promise<number> {
  return (await pool.query<{ id: number }>('SELECT id FROM country WHERE iso_code = $1', [iso])).rows[0].id;
}

export async function regionId(pool: Pool, name: string): Promise<string> {
  return (await pool.query<{ id: string }>('SELECT id FROM region WHERE name = $1', [name])).rows[0].id;
}

export const wine = (overrides: Record<string, unknown> = {}) => ({
  producer: { name: 'Quinta do Crasto' },
  name: 'Reserva',
  vintage: 2017,
  colour_id: RED,
  bottle_size_id: BOTTLE_750,
  quantity: 3,
  ...overrides,
});
