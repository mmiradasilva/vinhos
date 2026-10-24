/**
 * Who runs Cellar. FILL THIS IN before the public launch (see DEPLOY.md).
 * While any value is empty, the Terms and Privacy pages show a "draft" warning.
 */
export const OPERATOR = {
  /** Your name or your company's legal name. */
  name: '',
  /** Where people send privacy requests (access, correction, deletion). */
  contactEmail: '',
  /** Country whose law governs the terms, e.g. "Portugal". */
  country: '',
  /** Data-protection authority users can complain to, e.g. "the CNPD (cnpd.pt)". */
  supervisoryAuthority: '',
};

/** Must match TERMS_VERSION on the server (render.yaml), which is recorded on each user at sign-up. */
export const LEGAL_VERSION = '2026-10-24';

export const operatorComplete = Object.values(OPERATOR).every((v) => v.trim() !== '');
