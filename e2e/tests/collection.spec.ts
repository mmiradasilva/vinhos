import { expect, test } from '@playwright/test';
import { addWineViaApi, expectNoA11yViolations, expectNoHorizontalScroll, regionId, signUp } from './helpers';

test.beforeEach(async ({ page }) => {
  await signUp(page);
});

type Page = import('@playwright/test').Page;
const rows = (page: Page) => page.locator('.wine-list:not([aria-hidden]) > li');

/** Filter checkboxes follow the URL, which the router updates just after the click. */
async function checkFilter(page: Page, label: string) {
  const box = page.getByRole('group', { name: 'Filters' }).getByLabel(label);
  await box.click();
  await expect(box).toBeChecked();
}

test.describe('View collection (UI)', () => {
  test('AC-2: a new user sees the invitation to start a collection', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Start your collection' })).toBeVisible();
    await page.getByRole('link', { name: 'Add wine' }).click();
    await expect(page).toHaveURL('/collection/new');
  });

  test('AC-6: no matches offers "Clear search and filters"', async ({ page }) => {
    await addWineViaApi(page, {});
    await page.reload();
    await page.getByLabel('Search').fill('zzz');
    await expect(page.getByText('No wines match')).toBeVisible();
    await expect(page.getByText('0 of 1 wine · 0 bottles')).toBeVisible();
    await page.getByRole('button', { name: 'Clear search and filters' }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(page).toHaveURL('/collection');
  });

  test('AC-12 / AC-13: more wines load on scroll, and "Load more" works from the keyboard', async ({ page }) => {
    for (let i = 0; i < 55; i++) await addWineViaApi(page, { name: `Cuvée ${String(i).padStart(2, '0')}`, quantity: 1 });
    await page.reload();
    await expect(rows(page)).toHaveCount(50);
    const loadMore = page.getByRole('button', { name: 'Load more' });
    await loadMore.focus();
    await page.keyboard.press('Enter');
    await expect(rows(page)).toHaveCount(55);
    await expect(loadMore).toHaveCount(0);

    await page.reload();
    await expect(rows(page)).toHaveCount(50);
    await rows(page).last().scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 2000);
    await expect(rows(page)).toHaveCount(55);
    const ids = await rows(page).locator('a').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    expect(new Set(ids).size).toBe(55);
  });

  test('AC-14 / AC-15: search and filters live in the URL; a fresh visit starts from the defaults', async ({ page }) => {
    await addWineViaApi(page, { name: 'Douro red', region: { id: await regionId(page, 'Douro') }, colour_id: 1 });
    await addWineViaApi(page, { name: 'White', colour_id: 2 });
    await page.reload();
    await page.getByLabel('Search').fill('douro');
    await page.getByRole('button', { name: /^Filters/ }).click();
    await checkFilter(page, 'Red');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page).toHaveURL(/q=douro/);
    await expect(page).toHaveURL(/colour=red/);
    await expect(rows(page)).toHaveCount(1);

    await page.reload();
    await expect(page.getByLabel('Search')).toHaveValue('douro');
    await expect(page.getByRole('button', { name: 'Remove filter Red' })).toBeVisible();
    await expect(rows(page)).toHaveCount(1);

    await page.goto('/collection');
    await expect(page.getByLabel('Search')).toHaveValue('');
    await expect(page.getByLabel('Sort')).toHaveValue('added_desc');
    await expect(rows(page)).toHaveCount(2);
  });

  test('AC-20: at 360 px there is no horizontal scrolling and each row stays on two lines', async ({ page }) => {
    await addWineViaApi(page, {
      producer: { name: 'Sociedade Agrícola de Santar e Companhia Vinícola do Norte de Portugal' },
      name: 'Grande Reserva Edição Limitada de Homenagem aos Fundadores',
      drink_from: 2020,
      drink_until: 2040,
      bottle_size_id: 5,
    });
    await page.setViewportSize({ width: 360, height: 740 });
    await page.reload();
    await expect(rows(page)).toHaveCount(1);
    await expectNoHorizontalScroll(page);
    const lines = await rows(page).first().locator('.wine-title, .wine-details').evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight))),
    );
    expect(lines).toEqual([1, 1]);
  });

  test('rows read in full to screen readers, totals are announced, badges use text', async ({ page }) => {
    await addWineViaApi(page, { drink_from: 2020, drink_until: 2040, region: { id: await regionId(page, 'Douro') } });
    await page.reload();
    await expect(rows(page).first().getByRole('link')).toHaveAccessibleName('Quinta do Crasto Reserva 2017 · Red · Douro 3 bottles Ready');
    await expect(page.locator('.totals')).toHaveAttribute('aria-live', 'polite');
    await expect(rows(page).first().getByText('Ready')).toBeVisible();
  });

  test('the collection screen meets WCAG 2.1 AA, with the filter panel open', async ({ page }) => {
    await addWineViaApi(page, { drink_from: 2030 });
    await page.reload();
    await page.getByRole('button', { name: /^Filters/ }).click();
    await checkFilter(page, 'Red');
    await expectNoA11yViolations(page);
  });
});
