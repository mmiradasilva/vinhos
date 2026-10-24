import type { FastifyInstance } from 'fastify';
import { pkceChallenge, randomToken, safeEqual } from '../crypto';
import type { IdentityClaims, IdentityProvider } from './provider';

interface IssuedCode {
  claims: IdentityClaims;
  nonce: string;
  codeChallenge: string;
  expiresAt: number;
}

export interface FakeIdentityProvider extends IdentityProvider {
  /** Issues a one-time code, as if the user had consented at Google. Used by tests and the dev page. */
  issueCode(p: { nonce: string; codeChallenge: string; claims: IdentityClaims }): string;
  /** Dev-only consent page that stands in for Google. */
  registerRoutes(app: FastifyInstance): void;
}

const AUTHORIZE_PATH = '/api/v1/auth/fake/authorize';
const CALLBACK_PATH = '/api/v1/auth/google/callback';

/** Development and test stand-in for Google. Never enabled in production (see server.ts). */
export function createFakeProvider(): FakeIdentityProvider {
  const codes = new Map<string, IssuedCode>();

  const issueCode: FakeIdentityProvider['issueCode'] = ({ nonce, codeChallenge, claims }) => {
    const code = randomToken(16);
    codes.set(code, { claims, nonce, codeChallenge, expiresAt: Date.now() + 60_000 });
    return code;
  };

  return {
    kind: 'fake',
    issueCode,
    authorizationUrl: ({ state, nonce, codeChallenge }) => {
      const q = new URLSearchParams({ state, nonce, code_challenge: codeChallenge });
      return `${AUTHORIZE_PATH}?${q}`;
    },
    async exchange({ callbackParams, nonce, codeVerifier }) {
      const code = callbackParams.get('code') ?? '';
      const issued = codes.get(code);
      codes.delete(code);
      if (!issued || issued.expiresAt < Date.now()) throw new Error('Unknown or expired code');
      if (!safeEqual(issued.nonce, nonce)) throw new Error('Nonce mismatch');
      if (!safeEqual(issued.codeChallenge, pkceChallenge(codeVerifier))) throw new Error('PKCE mismatch');
      return issued.claims;
    },
    registerRoutes(app) {
      app.register(async (scope) => {
        scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
          done(null, Object.fromEntries(new URLSearchParams(body as string)));
        });

        scope.get(AUTHORIZE_PATH, async (req, reply) => {
          const q = req.query as Record<string, string | undefined>;
          reply.type('text/html').send(consentPage(q.state ?? '', q.nonce ?? '', q.code_challenge ?? ''));
        });

        scope.post(AUTHORIZE_PATH, async (req, reply) => {
          const f = req.body as Record<string, string | undefined>;
          const state = encodeURIComponent(f.state ?? '');
          if (f.action === 'cancel') return reply.redirect(`${CALLBACK_PATH}?error=access_denied&state=${state}`);
          const email = (f.email ?? '').trim() || 'dev@example.com';
          const code = issueCode({
            nonce: f.nonce ?? '',
            codeChallenge: f.code_challenge ?? '',
            claims: { sub: `fake-${email.toLowerCase()}`, email, email_verified: f.email_verified === 'on', name: f.name?.trim() || undefined },
          });
          return reply.redirect(`${CALLBACK_PATH}?code=${encodeURIComponent(code)}&state=${state}`);
        });
      });
    },
  };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function consentPage(state: string, nonce: string, codeChallenge: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Development sign-in</title>
<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:2rem auto;padding:0 1rem}label{display:block;margin:.75rem 0 .25rem}
input[type=email],input[type=text]{width:100%;padding:.6rem;font-size:1rem;box-sizing:border-box}.banner{background:#fff4ce;padding:.75rem;border-radius:.5rem}
button{padding:.7rem 1.2rem;font-size:1rem;margin:1rem .5rem 0 0}</style></head><body>
<p class="banner"><strong>Development sign-in.</strong> This page stands in for Google. It is never available in production.</p>
<form method="post">
<input type="hidden" name="state" value="${escapeHtml(state)}"><input type="hidden" name="nonce" value="${escapeHtml(nonce)}">
<input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}">
<label for="email">Email</label><input id="email" name="email" type="email" value="dev@example.com" required>
<label for="name">Name</label><input id="name" name="name" type="text" value="Dev User">
<label><input name="email_verified" type="checkbox" checked> Email verified</label>
<button type="submit" name="action" value="signin">Sign in</button><button type="submit" name="action" value="cancel" formnovalidate>Cancel</button>
</form></body></html>`;
}
