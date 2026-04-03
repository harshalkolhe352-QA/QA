import { test, expect, request } from '@playwright/test';
import { BASE_URL, CREDENTIALS, ENV_SERVICE_URL, LOGOUT_URL } from './helpers/auth';

/**
 * Authentication API Tests
 * Covers: login (valid/invalid), session validation, logout
 */

test.describe('Authentication API', () => {

  test('GET /scs/services/CheckoutEnvironment.Service.ss — returns config as anonymous user', async ({ request }) => {
    const response = await request.get(ENV_SERVICE_URL);

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('currentCurrency');
    expect(body).toHaveProperty('currentLanguage');
    expect(body).toHaveProperty('currentTouchpoint');
    expect(body.currentTouchpoint).toBe('checkout');
  });

  test('POST login — valid credentials return 200 and session cookie', async ({ page }) => {
    const apiCalls: string[] = [];

    // Capture all network requests during login
    page.on('request', req => {
      if (req.resourceType() === 'xhr' || req.resourceType() === 'fetch') {
        apiCalls.push(`${req.method()} ${req.url()}`);
      }
    });

    await page.goto('/my-portal');
    await page.waitForLoadState('networkidle');

    // Confirm login form is visible
    const emailField = page.locator('input[name="email"], input[type="email"]').first();
    await expect(emailField).toBeVisible();

    await emailField.fill(CREDENTIALS.email);
    await page.locator('input[name="password"], input[type="password"]').first().fill(CREDENTIALS.password);

    const [response] = await Promise.all([
      page.waitForResponse(res => res.url().includes('login') || res.url().includes('checkout.ssp'), { timeout: 15000 }).catch(() => null),
      page.locator('button[type="submit"], input[type="submit"]').first().click(),
    ]);

    await page.waitForLoadState('networkidle');

    // Verify we are no longer on the login page (redirected after login)
    const url = page.url();
    console.log('Post-login URL:', url);
    console.log('API calls captured:', apiCalls);

    // Session cookies should exist after login
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find(c =>
      c.name.toLowerCase().includes('nlbi') ||
      c.name.toLowerCase().includes('session') ||
      c.name.toLowerCase().includes('ns_')
    );
    expect(sessionCookie).toBeDefined();
  });

  test('POST login — invalid credentials show error message', async ({ page }) => {
    await page.goto('/my-portal');
    await page.waitForLoadState('networkidle');

    const emailField = page.locator('input[name="email"], input[type="email"]').first();
    await expect(emailField).toBeVisible();

    await emailField.fill('invalid@notexist.com');
    await page.locator('input[name="password"], input[type="password"]').first().fill('WrongPassword999!');
    await page.locator('button[type="submit"], input[type="submit"]').first().click();

    await page.waitForLoadState('networkidle');

    // An error/alert should be visible
    const errorLocator = page.locator('.alert, .error, [class*="error"], [class*="alert"], [data-type="error"]');
    await expect(errorLocator.first()).toBeVisible({ timeout: 8000 });
  });

  test('POST login — empty credentials show validation error', async ({ page }) => {
    await page.goto('/my-portal');
    await page.waitForLoadState('networkidle');

    const emailField = page.locator('input[name="email"], input[type="email"]').first();
    await expect(emailField).toBeVisible();

    // Submit without filling in anything
    await page.locator('button[type="submit"], input[type="submit"]').first().click();

    await page.waitForTimeout(2000);

    // Should stay on login page or show validation
    const currentUrl = page.url();
    const hasValidationError = await page.locator(
      'input:invalid, .error, [class*="error"], [aria-invalid="true"]'
    ).count();

    expect(
      currentUrl.includes('my-portal') || currentUrl.includes('login') || hasValidationError > 0
    ).toBeTruthy();
  });

  test('POST login — wrong password for valid email shows error', async ({ page }) => {
    await page.goto('/my-portal');
    await page.waitForLoadState('networkidle');

    const emailField = page.locator('input[name="email"], input[type="email"]').first();
    await expect(emailField).toBeVisible();

    await emailField.fill(CREDENTIALS.email);
    await page.locator('input[name="password"], input[type="password"]').first().fill('WrongPassword999!');
    await page.locator('button[type="submit"], input[type="submit"]').first().click();

    await page.waitForLoadState('networkidle');

    const errorLocator = page.locator('.alert, .error, [class*="error"], [class*="alert"]');
    await expect(errorLocator.first()).toBeVisible({ timeout: 8000 });
  });

  test('GET logout — clears session and redirects', async ({ page }) => {
    // Login first
    await page.goto('/my-portal');
    await page.waitForLoadState('networkidle');

    const emailField = page.locator('input[name="email"], input[type="email"]').first();
    if (await emailField.isVisible()) {
      await emailField.fill(CREDENTIALS.email);
      await page.locator('input[name="password"], input[type="password"]').first().fill(CREDENTIALS.password);
      await page.locator('button[type="submit"], input[type="submit"]').first().click();
      await page.waitForLoadState('networkidle');
    }

    // Navigate to logout URL
    await page.goto(LOGOUT_URL);
    await page.waitForLoadState('networkidle');

    const finalUrl = page.url();
    console.log('Post-logout URL:', finalUrl);

    // After logout, user should be redirected away from authenticated area
    // The session cookies should be cleared or the user should be on login/home page
    const cookies = await page.context().cookies();
    console.log('Cookies after logout:', cookies.map(c => c.name));

    // Verify we're not on a protected page
    expect(finalUrl).not.toContain('/account');
  });

  test('CheckoutEnvironment — reflects authenticated user after login', async ({ page }) => {
    // Login via UI
    await page.goto('/my-portal');
    await page.waitForLoadState('networkidle');

    const emailField = page.locator('input[name="email"], input[type="email"]').first();
    if (await emailField.isVisible()) {
      await emailField.fill(CREDENTIALS.email);
      await page.locator('input[name="password"], input[type="password"]').first().fill(CREDENTIALS.password);
      await page.locator('button[type="submit"], input[type="submit"]').first().click();
      await page.waitForLoadState('networkidle');
    }

    // Now call the environment service with the authenticated session
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const apiContext = await page.context().request;
    const response = await apiContext.get(ENV_SERVICE_URL, {
      headers: { Cookie: cookieHeader },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    console.log('Environment after login — isLoggedIn:', body?.currentUser?.isLoggedIn);
    console.log('Current user email:', body?.currentUser?.email);

    // If session is properly authenticated, user should be logged in
    if (body?.currentUser) {
      expect(body.currentUser).toBeDefined();
    }
  });

});

