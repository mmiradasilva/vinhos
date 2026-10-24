export interface IdentityClaims {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
}

/** The OpenID Connect provider behind "Sign in with Google" (real Google, or the fake one in development and tests). */
export interface IdentityProvider {
  readonly kind: 'google' | 'fake';
  authorizationUrl(p: { state: string; nonce: string; codeChallenge: string }): string;
  /** Exchanges the callback's code. Must verify the ID token, including nonce and PKCE (sign-in FR-1, FR-2). */
  exchange(p: { callbackParams: URLSearchParams; state: string; nonce: string; codeVerifier: string }): Promise<IdentityClaims>;
}
