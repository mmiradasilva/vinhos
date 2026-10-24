import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface Config {
  isProduction: boolean;
  port: number;
  /** 0.0.0.0 in production so the platform's proxy can reach the server; 127.0.0.1 locally. */
  host: string;
  /** Built web app to serve (production), or null when Vite serves it (development). */
  webDistDir: string | null;
  databaseUrl: string;
  appOrigin: string;
  sessionSecret: Buffer;
  /** Secure cookies with the __Host- prefix. Off only for plain-http local development. */
  cookieSecure: boolean;
  termsVersion: string;
  google: GoogleConfig | null;
  logLevel: string | false;
}

const ROOT_ENV = fileURLToPath(new URL('../../../.env', import.meta.url));
const WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

export function loadEnv(): void {
  if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const isProduction = env.NODE_ENV === 'production';
  const required = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`${name} must be set in production`);
    return value;
  };

  let sessionSecret: Buffer;
  if (env.SESSION_SECRET) {
    sessionSecret = Buffer.from(env.SESSION_SECRET, 'base64');
    if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 bytes (base64)');
  } else if (isProduction) {
    throw new Error('SESSION_SECRET must be set in production');
  } else {
    sessionSecret = createHash('sha256').update('cellar-dev-only-secret').digest();
  }

  // On Render, RENDER_EXTERNAL_URL is the service's public https address.
  const appOrigin = env.APP_ORIGIN || env.RENDER_EXTERNAL_URL || (isProduction ? required('APP_ORIGIN') : 'http://localhost:5173');

  const google = env.GOOGLE_CLIENT_ID
    ? {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: isProduction ? required('GOOGLE_CLIENT_SECRET') : (env.GOOGLE_CLIENT_SECRET ?? ''),
        redirectUri: env.GOOGLE_REDIRECT_URI || `${appOrigin}/api/v1/auth/google/callback`,
      }
    : null;
  if (isProduction && !google) throw new Error('GOOGLE_CLIENT_ID must be set in production');

  return {
    isProduction,
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? (isProduction ? '0.0.0.0' : '127.0.0.1'),
    webDistDir: isProduction && existsSync(`${WEB_DIST}/index.html`) ? WEB_DIST : null,
    databaseUrl: isProduction ? required('DATABASE_URL') : (env.DATABASE_URL ?? 'postgres://cellar:cellar@localhost:5433/cellar'),
    appOrigin,
    sessionSecret,
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProduction,
    termsVersion: env.TERMS_VERSION ?? '2026-10-01',
    google,
    logLevel: env.LOG_LEVEL === 'silent' ? false : (env.LOG_LEVEL ?? 'info'),
  };
}
