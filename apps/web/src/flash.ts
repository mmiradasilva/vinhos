/** One-time messages for a page reached with history.back(), which can't carry router state. */
const messages = new Map<string, string>();

export const flash = {
  set(key: string, message: string): void {
    messages.set(key, message);
  },
  /** Reads without removing, so it is safe during render; call clear() in an effect. */
  peek(key: string): string | undefined {
    return messages.get(key);
  },
  clear(key: string): void {
    messages.delete(key);
  },
};
