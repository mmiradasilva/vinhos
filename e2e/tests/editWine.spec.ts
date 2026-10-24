import { expect, test, type Page } from '@playwright/test';
import { addWineViaApi, completeDevSignIn, expectNoA11yViolations, regionId, signUp } from './helpers';

test.beforeEach(async ({ page }) => {
  await signUp(page);
});

const quantityText = (page: Page) => page.locator('.quantity');
const status = (page: Page) => page.getByRole('status');

async function changeViaApi(page: Page, id: string, change: number) {
  const me = await (await page.request.get('/api/v1/me')).json();
  const res = await page.request.post(`/api/v1/collection/wines/${id}/quantity`, { headers: { 'X-CSRF-Token': me.csrf_token }, data: { change } });
  expect(res.status()).toBe(200);
}

test.describe('View / edit wine (UI)', () => {
  test('AC-1 / AC-24: shows every recorded field, the price per bottle and no total', async ({ page }) => {
    const w = await addWineViaApi(page, {
      region: { id: await regionId(page, 'Douro') },
      grapes: [{ grape: { name: 'Touriga Nacional' }, percentage: 60 }],
      purchase_price: 24.5,
      notes: 'Gift from Ana',
    });
    await page.goto(`/collection/wines/${w.id}`);
    await expect(page.getByRole('heading', { name: 'Quinta do Crasto Reserva' })).toBeVisible();
    const details = page.locator('dl.details');
    await expect(details).toContainText('Douro, Portugal');
    await expect(details).toContainText('Touriga Nacional 60%');
    await expect(details).toContainText('€24.50 per bottle');
    await expect(details).toContainText('Gift from Ana');
    await expect(details).not.toContainText('Stored at');
    await expect(page.getByText(/total/i)).toHaveCount(0);
  });

  test('AC-2: another user\'s wine looks exactly like a missing one', async ({ page, browser }) => {
    const w = await addWineViaApi(page, {});
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await signUp(otherPage);
    await otherPage.goto(`/collection/wines/${w.id}`);
    await expect(otherPage.getByRole('heading', { name: "This wine isn't in your collection" })).toBeVisible();
    await otherPage.goto('/collection/wines/00000000-0000-4000-8000-000000000000');
    await expect(otherPage.getByRole('heading', { name: "This wine isn't in your collection" })).toBeVisible();
    await other.close();
  });

  test('AC-3 / AC-22 / AC-23: "Opened one" is announced, Undo restores it, and Undo goes away after 5 s', async ({ page }) => {
    const w = await addWineViaApi(page, {});
    await page.goto(`/collection/wines/${w.id}`);
    await page.getByRole('button', { name: 'Opened one bottle' }).click();
    await expect(quantityText(page)).toHaveText('2 bottles');
    await expect(status(page)).toContainText('1 bottle opened');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(quantityText(page)).toHaveText('3 bottles');

    await page.getByRole('button', { name: 'Opened one bottle' }).click();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0, { timeout: 7000 });
    await page.reload();
    await expect(quantityText(page)).toHaveText('2 bottles');
  });

  test('AC-5: opening the last bottle hides the wine from the collection', async ({ page }) => {
    const w = await addWineViaApi(page, { quantity: 1 });
    await page.goto('/collection');
    await page.getByRole('link', { name: /Quinta do Crasto Reserva 2017/ }).click();
    await page.getByRole('button', { name: 'Opened one bottle' }).click();
    await expect(quantityText(page)).toHaveText('No bottles left');
    await expect(page.getByRole('button', { name: 'Opened one bottle' })).toHaveCount(0);
    await page.getByRole('link', { name: '← Back to collection' }).click();
    await expect(page.getByRole('heading', { name: 'Start your collection' })).toBeVisible();
    await page.goto(`/collection/wines/${w.id}`);
    await expect(quantityText(page)).toHaveText('No bottles left');
  });

  test('AC-7: "Add bottles" works from the keyboard', async ({ page }) => {
    const w = await addWineViaApi(page, { quantity: 2 });
    await page.goto(`/collection/wines/${w.id}`);
    await page.getByRole('button', { name: 'Add bottles' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Bottles to add')).toBeFocused();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('6');
    await page.keyboard.press('Enter');
    await expect(quantityText(page)).toHaveText('8 bottles');
    await expect(status(page)).toContainText('6 bottles added');
  });

  test('AC-9: the duplicate notice links to the wine, where bottles can be added', async ({ page }) => {
    await addWineViaApi(page, { quantity: 2 });
    await page.goto('/collection/new');
    await page.getByRole('combobox', { name: /^Producer/ }).fill('Quinta do Crasto');
    await page.getByRole('combobox', { name: /^Producer/ }).press('Escape');
    await page.getByLabel(/^Wine name/).fill('Reserva');
    await page.getByLabel(/^Vintage/).fill('2017');
    await page.getByLabel(/^Colour/).selectOption({ label: 'Red' });
    await page.getByRole('button', { name: 'Save wine' }).click();
    await expect(page.getByRole('alert')).toContainText('You already have this wine (2 bottles).');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('link', { name: 'View wine' }).click();
    await expect(quantityText(page)).toHaveText('2 bottles');
    await page.getByRole('button', { name: 'Add bottles' }).click();
    await page.getByLabel('Bottles to add').fill('6');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(quantityText(page)).toHaveText('8 bottles');
  });

  test('AC-10: editing saves, returns to the wine, and "Back" still reaches the collection', async ({ page }) => {
    await addWineViaApi(page, { notes: 'Old note' });
    await page.goto('/collection');
    await page.getByRole('link', { name: /Quinta do Crasto Reserva 2017/ }).click();
    await page.getByRole('link', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { name: 'Edit wine' })).toBeVisible();
    await expect(page.getByRole('button', { name: /More details/ })).toHaveAttribute('aria-expanded', 'true');
    await page.getByLabel(/^Vintage/).fill('2018');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(status(page)).toContainText('Changes saved');
    await expect(page.getByText('2018 · Red')).toBeVisible();
    await page.getByRole('link', { name: '← Back to collection' }).click();
    await expect(page).toHaveURL('/collection');
    await expect(page.getByRole('link', { name: /Quinta do Crasto Reserva 2018/ })).toBeVisible();
  });

  test('AC-13: a change on another device is not overwritten', async ({ page }) => {
    const w = await addWineViaApi(page, {});
    await page.goto(`/collection/wines/${w.id}/edit`);
    await page.getByLabel(/^Wine name/).fill('Reserva Especial');
    await changeViaApi(page, w.id, -1); // "Opened one" on another device
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('alert')).toHaveText('This wine was changed on another device. Review the latest version and save again.');
    await expect(page.getByLabel(/^Wine name/)).toHaveValue('Reserva');
    await expect(page.getByLabel(/^Quantity/)).toHaveValue('2');
    await page.getByLabel(/^Wine name/).fill('Reserva Especial');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('heading', { name: 'Quinta do Crasto Reserva Especial' })).toBeVisible();
  });

  test('AC-15: cancelling or pressing Escape keeps the wine and returns focus to "Delete wine"', async ({ page }) => {
    const w = await addWineViaApi(page, {});
    await page.goto(`/collection/wines/${w.id}`);
    const deleteButton = page.getByRole('button', { name: 'Delete wine' });
    await deleteButton.click();
    const dialog = page.getByRole('dialog', { name: 'Delete Quinta do Crasto Reserva 2017?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(deleteButton).toBeFocused();
    await deleteButton.click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(deleteButton).toBeFocused();
    await page.reload();
    await expect(quantityText(page)).toHaveText('3 bottles');
  });

  test('AC-16: confirming deletes and returns to the collection with a message', async ({ page }) => {
    const w = await addWineViaApi(page, {});
    await page.goto(`/collection/wines/${w.id}`);
    await page.getByRole('button', { name: 'Delete wine' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page).toHaveURL('/collection');
    await expect(status(page)).toHaveText('Quinta do Crasto Reserva 2017 deleted');
    await page.goto(`/collection/wines/${w.id}`);
    await expect(page.getByRole('heading', { name: "This wine isn't in your collection" })).toBeVisible();
  });

  test('AC-17: "Back" restores the search, the loaded pages and the scroll position', async ({ page }) => {
    for (let i = 0; i < 55; i++) await addWineViaApi(page, { name: `Cuvée ${String(i).padStart(2, '0')}`, quantity: 1 });
    await page.goto('/collection?q=cuvee');
    await page.getByRole('button', { name: 'Load more' }).click();
    const rows = page.locator('.wine-list:not([aria-hidden]) > li');
    await expect(rows).toHaveCount(55);
    const target = rows.nth(52).getByRole('link');
    await target.scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    expect(scrollBefore).toBeGreaterThan(500);
    await target.click();
    await page.getByRole('button', { name: 'Opened one bottle' }).click();
    await expect(quantityText(page)).toHaveText('No bottles left');
    await page.getByRole('link', { name: '← Back to collection' }).click();
    await expect(page).toHaveURL('/collection?q=cuvee');
    await expect(page.getByLabel('Search')).toHaveValue('cuvee');
    await expect(rows).toHaveCount(54);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBefore - 120);
    await expect(page.getByText('54 of 54 wines · 54 bottles')).toBeVisible();
  });

  test('AC-18: a link to a wine survives signing in', async ({ page, browser }) => {
    const w = await addWineViaApi(page, {});
    const email = await page.evaluate(() => fetch('/api/v1/me').then((r) => r.json()).then((m) => m.email));
    const fresh = await browser.newContext();
    const p2 = await fresh.newPage();
    await p2.goto(`/collection/wines/${w.id}`);
    await expect(p2).toHaveURL(new RegExp(`/signin\\?return_to=%2Fcollection%2Fwines%2F${w.id}`));
    await p2.getByRole('button', { name: 'Sign in with Google' }).click();
    await completeDevSignIn(p2, email);
    await expect(p2).toHaveURL(`/collection/wines/${w.id}`);
    await expect(p2.locator('.quantity')).toHaveText('3 bottles');
    await fresh.close();
  });

  test('AC-21: the detail page, the delete dialog and the edit form meet WCAG 2.1 AA', async ({ page }) => {
    const w = await addWineViaApi(page, { purchase_price: 12, drink_from: 2020, drink_until: 2030 });
    await page.goto(`/collection/wines/${w.id}`);
    await expect(quantityText(page)).toHaveText('3 bottles');
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Delete wine' }).click();
    await expectNoA11yViolations(page);
    await page.keyboard.press('Escape');
    await page.goto(`/collection/wines/${w.id}/edit`);
    await expect(page.getByRole('heading', { name: 'Edit wine' })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test('an edit can set the quantity to 0', async ({ page }) => {
    const w = await addWineViaApi(page, {});
    await page.goto(`/collection/wines/${w.id}/edit`);
    await page.getByLabel(/^Quantity/).fill('0');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(quantityText(page)).toHaveText('No bottles left');
  });
});
