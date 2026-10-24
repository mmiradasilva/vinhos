import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

let counter = 0;
export const uniqueEmail = (label = 'user') => `${label}-${Date.now()}-${counter++}@example.com`;

/** Completes the development sign-in page (the stand-in for Google). */
export async function completeDevSignIn(page: Page, email: string, opts: { verified?: boolean } = {}) {
  await expect(page.getByText('Development sign-in.')).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(email);
  if (opts.verified === false) await page.getByLabel('Email verified').uncheck();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/** First sign-in for a new user: Google (dev page) -> "Before you start" -> account created. */
export async function signUp(page: Page, email = uniqueEmail(), returnTo = '/collection') {
  await page.goto(`/signin?return_to=${encodeURIComponent(returnTo)}`);
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  await completeDevSignIn(page, email);
  await expect(page).toHaveURL(/\/welcome$/);
  await page.getByLabel('I agree to the Terms of use and Privacy notice').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL((url) => url.pathname + url.search === returnTo);
  return email;
}

/** Adds wines through the API with the page's session (fast setup for list tests). */
export async function addWineViaApi(page: Page, body: Record<string, unknown>) {
  const me = await (await page.request.get('/api/v1/me')).json();
  const res = await page.request.post('/api/v1/collection/wines', {
    headers: { 'X-CSRF-Token': me.csrf_token },
    data: {
      producer: { name: 'Quinta do Crasto' },
      name: 'Reserva',
      vintage: 2017,
      colour_id: 1,
      bottle_size_id: 4,
      quantity: 3,
      ...body,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return res.json();
}

/** Id of a seeded region, e.g. Douro. */
export async function regionId(page: Page, name: string): Promise<string> {
  const res = await page.request.get(`/api/v1/regions?q=${encodeURIComponent(name)}`);
  return (await res.json()).items.find((r: { name: string }) => r.name === name).id;
}

/** WCAG 2.1 A and AA checks with axe-core. */
export async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
  expect(summary).toEqual([]);
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}
