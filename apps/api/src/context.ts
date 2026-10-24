import type { Config } from './config';
import type { Keys } from './crypto';
import type { Pool } from './db/pool';
import type { IdentityProvider } from './identity/provider';
import type { RateLimiter } from './rateLimit';

export interface CookieNames {
  session: string;
  authRequest: string;
  pendingSignup: string;
}

export function cookieNames(secure: boolean): CookieNames {
  const p = secure ? '__Host-' : '';
  return { session: `${p}session`, authRequest: `${p}auth_request`, pendingSignup: `${p}pending_signup` };
}

/** Everything route modules need, built once per app. */
export interface AppContext {
  config: Config;
  pool: Pool;
  identity: IdentityProvider;
  keys: Keys;
  cookies: CookieNames;
  now: () => Date;
  limits: {
    authPerIp: RateLimiter;
    authPerAccount: RateLimiter;
    /** Add, edit, quantity change and delete share one limit (view-edit-wine BR-8). */
    writesPerUser: RateLimiter;
  };
}

export interface AuthInfo {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string | null;
  csrfToken: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthInfo | null;
  }
}
