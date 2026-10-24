import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ORIGIN, as, callback, claimsFor, cookieValue, createTestApp, resetDb, signIn, startSignIn, type TestApp } from './helpers';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
  await resetDb(t.pool);
});
afterEach(() => t.close());

const users = async () => (await t.pool.query('SELECT * FROM app_user')).rows;

async function pendingSignup(email: string) {
  const res = await callback(t, claimsFor(email));
  expect(res.headers.location).toBe('/welcome');
  const pending = cookieValue(res, t.ctx.cookies.pendingSignup)!;
  const info = await t.app.inject({ method: 'GET', url: '/api/v1/auth/pending-signup', cookies: { [t.ctx.cookies.pendingSignup]: pending } });
  return { pending, csrf: info.json().csrf_token as string, info };
}

const signup = (pending: string, csrf: string, payload: unknown) =>
  t.app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    headers: { 'x-csrf-token': csrf, origin: ORIGIN },
    cookies: { [t.ctx.cookies.pendingSignup]: pending },
    payload: payload as object,
  });

describe('Sign in with Google — acceptance criteria', () => {
  it('AC-1: first sign-in with the box ticked creates a user with the terms recorded', async () => {
    const { pending, csrf, info } = await pendingSignup('ana@example.com');
    expect(info.json()).toMatchObject({ email: 'ana@example.com', terms_version: '2026-10-01' });
    const res = await signup(pending, csrf, { accept_terms: true });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ return_to: '/collection' });
    expect(cookieValue(res, '__Host-session')).toBeTruthy();
    const [u] = await users();
    expect(u.terms_accepted_at).toBeInstanceOf(Date);
    expect(u.terms_version).toBe('2026-10-01');
  });

  it('AC-2 / AC-4: without accepting the terms no user is created', async () => {
    const { pending, csrf } = await pendingSignup('ana@example.com');
    for (const payload of [{}, { accept_terms: false }, { accept_terms: 'yes' }]) {
      const res = await signup(pending, csrf, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().errors[0]).toMatchObject({ field: 'accept_terms', message: 'Agree to the terms to continue' });
    }
    expect(await users()).toHaveLength(0);
  });

  it('AC-3: leaving the terms screen stores nothing', async () => {
    await pendingSignup('ana@example.com');
    expect(await users()).toHaveLength(0);
    expect((await t.pool.query('SELECT 1 FROM session')).rowCount).toBe(0);
  });

  it('AC-5: a returning user whose email changed keeps the same account and skips the terms', async () => {
    const first = await signIn(t, 'ana@example.com');
    const res = await callback(t, claimsFor('ana@example.com', { email: 'ana.new@example.com' }));
    expect(res.headers.location).toBe('/collection');
    const [u] = await users();
    expect(u.id).toBe(first.userId);
    expect(u.email).toBe('ana.new@example.com');
  });

  it('AC-6: the user returns to the page they asked for', async () => {
    await signIn(t, 'ana@example.com');
    const res = await callback(t, claimsFor('ana@example.com'), '/collection/new');
    expect(res.headers.location).toBe('/collection/new');
  });

  it('AC-7: return_to outside the app falls back to the collection list', async () => {
    await signIn(t, 'ana@example.com');
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example']) {
      const res = await callback(t, claimsFor('ana@example.com'), bad);
      expect(res.headers.location).toBe('/collection');
    }
  });

  it('AC-8: a state or nonce that does not match fails and creates no session', async () => {
    const s = await startSignIn(t);
    const wrongState = await t.app.inject({
      url: `/api/v1/auth/google/callback?code=${t.fake.issueCode({ nonce: s.nonce, codeChallenge: s.codeChallenge, claims: claimsFor('a@x.io') })}&state=forged`,
      cookies: { [t.ctx.cookies.authRequest]: s.authCookie },
    });
    expect(wrongState.headers.location).toBe('/signin?error=failed');
    const s2 = await startSignIn(t);
    const wrongNonce = await t.app.inject({
      url: `/api/v1/auth/google/callback?code=${t.fake.issueCode({ nonce: 'other', codeChallenge: s2.codeChallenge, claims: claimsFor('a@x.io') })}&state=${s2.state}`,
      cookies: { [t.ctx.cookies.authRequest]: s2.authCookie },
    });
    expect(wrongNonce.headers.location).toBe('/signin?error=failed');
    expect((await t.pool.query('SELECT 1 FROM session')).rowCount).toBe(0);
  });

  it('AC-9: an active user stays signed in past 30 days because the session and cookie roll forward', async () => {
    const s = await signIn(t, 'ana@example.com');
    await t.pool.query(`UPDATE session SET created_at = now() - interval '31 days', last_seen_at = now() - interval '1 day',
                          expires_at = now() + interval '29 days', cookie_refreshed_at = now() - interval '2 days'`);
    const res = await as(t, s).get('/me');
    expect(res.statusCode).toBe(200);
    const refreshed = res.cookies.find((c) => c.name === '__Host-session');
    expect(refreshed?.maxAge).toBe(30 * 24 * 60 * 60);
    const { rows } = await t.pool.query(`SELECT expires_at > now() + interval '29 days 23 hours' AS extended FROM session`);
    expect(rows[0].extended).toBe(true);
  });

  it('AC-10: after 30 days without activity the session no longer works', async () => {
    const s = await signIn(t, 'ana@example.com');
    await t.pool.query(`UPDATE session SET expires_at = now() - interval '1 day'`);
    expect((await as(t, s).get('/me')).statusCode).toBe(401);
  });

  it('AC-11 / AC-12: two devices have independent sessions; signing out one leaves the other', async () => {
    const phone = await signIn(t, 'ana@example.com');
    const laptop = await signIn(t, 'ana@example.com');
    expect(phone.cookie).not.toBe(laptop.cookie);
    expect((await as(t, phone).post('/auth/logout')).statusCode).toBe(204);
    expect((await as(t, phone).get('/me')).statusCode).toBe(401);
    expect((await as(t, laptop).get('/me')).statusCode).toBe(200);
  });

  it('AC-13: sign-out without a CSRF token is rejected', async () => {
    const s = await signIn(t, 'ana@example.com');
    const res = await t.app.inject({ method: 'POST', url: '/api/v1/auth/logout', cookies: { [t.ctx.cookies.session]: s.cookie } });
    expect(res.statusCode).toBe(403);
    expect((await as(t, s).get('/me')).statusCode).toBe(200);
  });

  it('AC-14: an unverified Google email stores nothing', async () => {
    const res = await callback(t, claimsFor('ana@example.com', { email_verified: false }));
    expect(res.headers.location).toBe('/signin?error=unverified');
    expect(cookieValue(res, t.ctx.cookies.pendingSignup)).toBeUndefined();
    expect(await users()).toHaveLength(0);
  });

  it('AC-15: blocked cookies are reported', async () => {
    const res = await t.app.inject({ url: '/api/v1/auth/google/callback?code=x&state=y' });
    expect(res.headers.location).toBe('/signin?error=cookies');
  });

  it('AC-16: more than 60 sign-in attempts per minute from one IP are refused', async () => {
    for (let i = 0; i < 60; i++) expect((await t.app.inject({ url: '/api/v1/auth/google/start' })).statusCode).toBe(302);
    expect((await t.app.inject({ url: '/api/v1/auth/google/start' })).statusCode).toBe(429);
  });

  it('AC-17: no codes, tokens or cookie values reach the logs', async () => {
    const s = await startSignIn(t);
    const code = t.fake.issueCode({ nonce: s.nonce, codeChallenge: s.codeChallenge, claims: claimsFor('ana@example.com') });
    await t.app.inject({ url: `/api/v1/auth/google/callback?code=${code}&state=${s.state}`, cookies: { [t.ctx.cookies.authRequest]: s.authCookie } });
    const all = t.logs.join('\n');
    for (const secret of [code, s.state, s.nonce, s.authCookie]) expect(all).not.toContain(secret);
  });

  it('cancelling on Google returns to sign-in with a message', async () => {
    const s = await startSignIn(t);
    const res = await t.app.inject({
      url: `/api/v1/auth/google/callback?error=access_denied&state=${s.state}`,
      cookies: { [t.ctx.cookies.authRequest]: s.authCookie },
    });
    expect(res.headers.location).toBe('/signin?error=cancelled');
  });

  it('a double tap on "Create account" creates one user', async () => {
    const { pending, csrf } = await pendingSignup('ana@example.com');
    const [a, b] = await Promise.all([signup(pending, csrf, { accept_terms: true }), signup(pending, csrf, { accept_terms: true })]);
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect(await users()).toHaveLength(1);
  });

  it('an expired sign-up returns 410', async () => {
    const { csrf } = await pendingSignup('ana@example.com');
    const res = await signup('garbage', csrf, { accept_terms: true });
    expect(res.statusCode).toBe(410);
  });
});
