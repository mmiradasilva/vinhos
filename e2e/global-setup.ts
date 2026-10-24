import { startStack } from './stack';

/** Playwright uses the returned function as global teardown. */
export default async function globalSetup() {
  return startStack();
}
