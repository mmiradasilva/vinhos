import { expect, test } from '@playwright/test';
import { completeDevSignIn, expectNoA11yViolations, signUp, uniqueEmail } from './helpers';

test.describe('Sign in with Google (UI)', () => {
  test('AC-1 / AC-6: a deep link survives first sign-in and the terms screen', async ({ page }) => {
    await page.goto('/collection/new');
    await expect(page).toHaveURL('/signin?return_to=%2Fcollection%2Fnew');
    await page.getByRole('button', { name: 'Sign in with Google' }).click();
    await completeDevSignIn(page, uniqueEmail());
    await expect(page.getByRole('heading', { name: 'Before you start' })).toBeVisible();
    const box = page.getByLabel('I agree to the Terms of use and Privacy notice');
    await expect(box).not.toBeChecked();
    await box.check();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL('/collection/new');
    await expect(page.getByRole('heading', { name: 'Add wine' })).toBeVisible();
  });

  test('AC-2: "Create account" without the checkbox explains why and stays', async ({ page }) => {
    await page.goto('/signin');
    await page.getByRole('button', { name: 'Sign in with Google' }).click();
    await completeDevSignIn(page, uniqueEmail());
    await page.getByRole('button', { name: 'Create account' }).click();
    const box = page.getByLabel('I agree to the Terms of use and Privacy notice');
    await expect(page.getByRole('alert')).toHaveText('Agree to the terms to continue');
    await expect(box).toHaveAttribute('aria-invalid', 'true');
    await expect(box).toHaveAttribute('aria-describedby', 'accept-terms-error');
    await expect(box).toBeFocused();
    await expect(page).toHaveURL(/\/welcome$/);
  });

  test('"Cancel" on the terms screen discards the sign-up', async ({ page }) => {
    await page.goto('/signin');
    await page.getByRole('button', { name: 'Sign in with Google' }).click();
    await completeDevSignIn(page, uniqueEmail());
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page).toHaveURL('/signin');
    await page.goto('/welcome');
    await expect(page).toHaveURL('/signin?error=timeout');
  });

  test('cancelling on the Google page shows a message', async ({ page }) => {
    await page.goto('/signin');
    await page.getByRole('button', { name: 'Sign in with Google' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('alert')).toHaveText('Sign-in was cancelled.');
  });

  test('AC-14: an unverified email is refused with a message', async ({ page }) => {
    await page.goto('/signin');
    await page.getByRole('button', { name: 'Sign in with Google' }).click();
    await completeDevSignIn(page, uniqueEmail(), { verified: false });
    await expect(page.getByRole('alert')).toHaveText("Your Google email isn't verified.");
  });

  test('view-collection AC-17: a filtered deep link survives sign-in', async ({ page }) => {
    await page.goto('/collection?colour=red');
    await expect(page).toHaveURL('/signin?return_to=%2Fcollection%3Fcolour%3Dred');
    await page.getByRole('button', { name: 'Sign in with Google' }).click();
    await completeDevSignIn(page, uniqueEmail());
    await page.getByLabel('I agree to the Terms of use and Privacy notice').check();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL('/collection?colour=red');
  });

  test('a returning user goes straight back without the terms screen; sign-out ends the session', async ({ page }) => {
    const email = await signUp(page);
    await page.locator('.user-menu summary').click();
    await expect(page.getByText(email)).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.goto('/collection');
    await expect(page).toHaveURL(/\/signin/);
    await page.getByRole('button', { name: 'Sign in with Google' }).click();
    await completeDevSignIn(page, email);
    await expect(page).toHaveURL('/collection');
  });

  test('sign-in and terms screens meet WCAG 2.1 AA', async ({ page }) => {
    await page.goto('/signin');
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Sign in with Google' }).click();
    await completeDevSignIn(page, uniqueEmail());
    await page.getByRole('button', { name: 'Create account' }).click();
    await expectNoA11yViolations(page);
  });
});
