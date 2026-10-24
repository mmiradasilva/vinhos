/** add-wine FR-13: a form is kept in the browser across a sign-in redirect, keyed by its page path. */
const PREFIX = 'cellar.draft:';

export function saveDraft(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // storage unavailable: the draft is lost, nothing else breaks
  }
}

/** Reads without removing, so it is safe to call during render. */
export function peekDraft<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  try {
    sessionStorage.removeItem(PREFIX + key);
  } catch {
    // storage unavailable
  }
}

/** The page path of a saved draft, if any. */
export function savedDraftPath(): string | null {
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(PREFIX)) return key.slice(PREFIX.length);
    }
  } catch {
    // storage unavailable
  }
  return null;
}
