import { expect, test, type Page } from '@playwright/test';
import { addWineViaApi, completeDevSignIn, expectNoA11yViolations, expectNoHorizontalScroll, signUp } from './helpers';

let email: string;
test.beforeEach(async ({ page }) => {
  email = await signUp(page, undefined, '/collection/new');
});

const producer = (page: Page) => page.getByRole('combobox', { name: /^Producer/ });
const wineName = (page: Page) => page.getByLabel(/^Wine name/);
const vintage = (page: Page) => page.getByLabel(/^Vintage/);
const quantity = (page: Page) => page.getByLabel(/^Quantity/);
const moreDetails = (page: Page) => page.getByRole('button', { name: /More details/ });

async function fillRequired(page: Page, p = 'Quinta do Crasto', n = 'Reserva', v = '2017') {
  await producer(page).fill(p);
  await producer(page).press('Escape');
  await wineName(page).fill(n);
  await vintage(page).fill(v);
  await page.getByLabel(/^Colour/).selectOption({ label: 'Red' });
}

test.describe('Add a wine (UI)', () => {
  test('AC-20: defaults are quantity 1, 750 ml and EUR, in English', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Add wine' })).toBeVisible();
    await expect(quantity(page)).toHaveValue('1');
    await expect(page.getByLabel(/^Bottle size/).locator('option:checked')).toHaveText('750 ml · Standard');
    await moreDetails(page).click();
    await expect(page.getByLabel(/^Currency/).locator('option:checked')).toHaveText('EUR · Euro');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('AC-13: number fields open a numeric keyboard on phones', async ({ page }) => {
    await expect(vintage(page)).toHaveAttribute('inputmode', 'numeric');
    await expect(quantity(page)).toHaveAttribute('inputmode', 'numeric');
    await moreDetails(page).click();
    await expect(page.getByLabel(/^Price per bottle/)).toHaveAttribute('inputmode', 'decimal');
    await expect(page.getByLabel(/^Drink from/)).toHaveAttribute('inputmode', 'numeric');
  });

  test('AC-11: keyboard only — errors are announced, linked and focused; then the wine saves', async ({ page }) => {
    await producer(page).focus();
    await page.keyboard.press('Enter'); // submit the empty form from the keyboard
    const summary = page.getByRole('alert').filter({ hasText: 'to save the wine' });
    await expect(summary).toBeVisible();
    await expect(producer(page)).toBeFocused();
    await expect(producer(page)).toHaveAttribute('aria-invalid', 'true');
    const describedBy = await producer(page).getAttribute('aria-describedby');
    await expect(page.locator(`#${describedBy}`)).toHaveText('Producer is required');

    await page.keyboard.type('Quinta do Vallado');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    await expect(wineName(page)).toBeFocused();
    await page.keyboard.type('Touriga Nacional');
    await page.keyboard.press('Tab');
    await expect(vintage(page)).toBeFocused();
    await page.keyboard.type('2019');
    await page.keyboard.press('Tab'); // NV checkbox
    await page.keyboard.press('Tab'); // colour
    await expect(page.getByLabel(/^Colour/)).toBeFocused();
    await page.keyboard.press('ArrowDown'); // first colour: Red
    await expect(page.getByLabel(/^Colour/).locator('option:checked')).toHaveText('Red');
    await quantity(page).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/collection');
    await expect(page.getByRole('status')).toHaveText('Quinta do Vallado Touriga Nacional 2019 added');
  });

  test('AC-26: "More details" opens when a field inside it has an error', async ({ page }) => {
    await fillRequired(page);
    await moreDetails(page).click();
    await page.getByLabel(/^Purchase date/).fill('2099-01-01');
    await moreDetails(page).click();
    await expect(moreDetails(page)).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: 'Save wine' }).click();
    await expect(moreDetails(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText("Purchase date can't be in the future").first()).toBeVisible();
    await expect(page.getByLabel(/^Purchase date/)).toBeFocused();
  });

  test('AC-12: no horizontal scrolling at 360 px, with every field open', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await moreDetails(page).click();
    await page.getByRole('button', { name: 'Save wine' }).click();
    await expectNoHorizontalScroll(page);
    await expect(page.getByRole('button', { name: 'Save wine' })).toBeInViewport();
  });

  test('AC-22: saving lands on the collection with the confirmation and the new wine on top', async ({ page }) => {
    await fillRequired(page);
    await quantity(page).fill('3');
    await page.getByRole('button', { name: 'Save wine' }).click();
    await expect(page).toHaveURL('/collection');
    await expect(page.getByRole('status')).toHaveText('Quinta do Crasto Reserva 2017 added');
    const first = page.getByRole('listitem').filter({ hasText: 'Quinta do Crasto Reserva' }).first();
    await expect(first).toHaveClass(/highlight/);
    await expect(page.getByText('1 wine · 3 bottles')).toBeVisible();
  });

  test('AC-5 (UI): a duplicate shows how many bottles you already have', async ({ page }) => {
    await addWineViaApi(page, { quantity: 3 });
    await fillRequired(page, 'QUINTA DO CRASTO', 'reserva');
    await page.getByRole('button', { name: 'Save wine' }).click();
    await expect(page.getByRole('alert')).toHaveText('You already have this wine (3 bottles). View wine');
    await expect(page.getByRole('alert').getByRole('link', { name: 'View wine' })).toBeVisible();
    await expect(page).toHaveURL('/collection/new');
  });

  test('AC-15: after the session expires, the draft survives signing in again', async ({ page, context }) => {
    await fillRequired(page, 'Niepoort', 'Redoma');
    await moreDetails(page).click();
    await page.getByLabel(/^Notes/).fill('Kept across sign-in');
    await context.clearCookies({ name: 'session' });
    await page.getByRole('button', { name: 'Save wine' }).click();
    await completeDevSignIn(page, email);
    await expect(page).toHaveURL('/collection/new');
    await expect(producer(page)).toHaveValue('Niepoort');
    await expect(wineName(page)).toHaveValue('Redoma');
    await expect(vintage(page)).toHaveValue('2017');
    await page.getByRole('button', { name: 'Save wine' }).click();
    await expect(page.getByRole('status')).toHaveText('Niepoort Redoma 2017 added');
  });

  test('US-3: leaving with unsaved changes asks first', async ({ page }) => {
    await wineName(page).fill('Half typed');
    page.once('dialog', (d) => d.dismiss());
    await page.getByRole('link', { name: 'Cancel' }).click();
    await expect(page).toHaveURL('/collection/new');
    await expect(wineName(page)).toHaveValue('Half typed');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('link', { name: 'Cancel' }).click();
    await expect(page).toHaveURL('/collection');
  });

  test('the form with errors meets WCAG 2.1 AA', async ({ page }) => {
    await moreDetails(page).click();
    await page.getByRole('button', { name: 'Save wine' }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
