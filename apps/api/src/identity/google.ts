import * as oidc from 'openid-client';
import type { GoogleConfig } from '../config';
import type { IdentityProvider } from './provider';

/** Google OpenID Connect via openid-client: verifies signature, iss, aud, exp, nonce and PKCE. */
export async function createGoogleProvider(cfg: GoogleConfig): Promise<IdentityProvider> {
  const config = await oidc.discovery(new URL('https://accounts.google.com'), cfg.clientId, cfg.clientSecret);
  return {
    kind: 'google',
    authorizationUrl: ({ state, nonce, codeChallenge }) =>
      oidc.buildAuthorizationUrl(config, {
        redirect_uri: cfg.redirectUri,
        scope: 'openid email profile',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
        nonce,
      }).href,
    async exchange({ callbackParams, state, nonce, codeVerifier }) {
      const callbackUrl = new URL(cfg.redirectUri);
      callbackUrl.search = callbackParams.toString();
      const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
        pkceCodeVerifier: codeVerifier,
        expectedState: state,
        expectedNonce: nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims) throw new Error('No ID token');
      return {
        sub: claims.sub,
        email: typeof claims.email === 'string' ? claims.email : '',
        email_verified: claims.email_verified === true,
        name: typeof claims.name === 'string' ? claims.name : undefined,
      };
    },
  };
}
