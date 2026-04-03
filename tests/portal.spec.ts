import { test, expect } from '@playwright/test';
import { BASE_URL, CREDENTIALS, ENV_SERVICE_URL, SELECTORS } from './helpers/auth';

/**
 * Portal Feature API Tests
 * Covers: environment config, navigation, authenticated portal sections, security
 */

async function login(page: any) {
  await page.goto('/my-portal');
  await page.waitForURL('**#login-register**', { timeout: 15000 });
  await page.waitForSelector(SELECTORS.loginEmail, { state: 'visible', timeout: 15000 });
  // Wait for Backbone.js to bind form event listeners
  await page.waitForTimeout(3000);
  await page.fill(SELECTORS.loginEmail, CREDENTIALS.email);
  await page.fill(SELECTORS.loginPassword, CREDENTIALS.password);
  // Login redirects to /scs/my_account.ssp
  await Promise.all([
    page.waitForURL('**/scs/my_account.ssp**', { timeout: 15000 }),
    page.click(SELECTORS.loginSubmit),
  ]);
}

test.describe('CheckoutEnvironment Service', () => {

  test('GET — returns 200 with valid JSON', async ({ request }) => {
    const response = await request.get(ENV_SERVICE_URL);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/json|javascript/);
    const body = await response.json();
    expect(typeof body).toBe('object');
  });

  test('GET — top-level structure has CONFIGURATION, SESSION, ENVIRONMENT', async ({ request }) => {
    const response = await request.get(ENV_SERVICE_URL);
    const body = await response.json();
    expect(body).toHaveProperty('CONFIGURATION');
    expect(body).toHaveProperty('SESSION');
    expect(body).toHaveProperty('ENVIRONMENT');
  });

  test('GET — ENVIRONMENT.currentCurrency.code is USD', async ({ request }) => {
    const response = await request.get(ENV_SERVICE_URL);
    const body = await response.json();
    expect(body.ENVIRONMENT.currentCurrency.code).toBe('USD');
  });

  test('GET — ENVIRONMENT.currentLanguage.locale is English', async ({ request }) => {
    const response = await request.get(ENV_SERVICE_URL);
    const body = await response.json();
    expect(body.ENVIRONMENT.currentLanguage.locale).toMatch(/en/i);
  });

  test('GET — SESSION.touchpoints contains checkout and login', async ({ request }) => {
    const response = await request.get(ENV_SERVICE_URL);
    const body = await response.json();
    expect(body.SESSION.touchpoints).toHaveProperty('checkout');
    expect(body.SESSION.touchpoints).toHaveProperty('login');
  });

  test('GET — ENVIRONMENT.siteSettings is present', async ({ request }) => {
    const response = await request.get(ENV_SERVICE_URL);
    const body = await response.json();
    expect(body.ENVIRONMENT).toHaveProperty('siteSettings');
  });

  test('GET — ENVIRONMENT.currentCurrency has required fields', async ({ request }) => {
    const response = await request.get(ENV_SERVICE_URL);
    const body = await response.json();
    const currency = body.ENVIRONMENT.currentCurrency;
    expect(currency).toHaveProperty('code');
    expect(currency).toHaveProperty('symbol');
    expect(currency).toHaveProperty('name');
  });

  test('GET — ENVIRONMENT.currentLanguage has required fields', async ({ request }) => {
    const response = await request.get(ENV_SERVICE_URL);
    const body = await response.json();
    const lang = body.ENVIRONMENT.currentLanguage;
    expect(lang).toHaveProperty('locale');
    expect(lang).toHaveProperty('name');
  });

  test('GET — response time is under 5 seconds', async ({ request }) => {
    const start = Date.now();
    const response = await request.get(ENV_SERVICE_URL);
    const elapsed = Date.now() - start;
    expect(response.status()).toBe(200);
    expect(elapsed).toBeLessThan(5000);
  });

});

test.describe('Portal UI & Navigation', () => {

  test('GET /my-portal — page loads with status 200', async ({ page }) => {
    const response = await page.goto('/my-portal');
    expect(response?.status()).toBe(200);
    await page.waitForLoadState('domcontentloaded');
    const title = await page.title();
    console.log('Page title:', title);
    expect(title).toBeTruthy();
  });

  test('GET /my-portal — login form is present for unauthenticated user', async ({ page }) => {
    await page.goto('/my-portal');
    await page.waitForSelector(SELECTORS.loginEmail, { state: 'visible', timeout: 15000 });
    await expect(page.locator(SELECTORS.loginEmail)).toBeVisible();
    await expect(page.locator(SELECTORS.loginPassword)).toBeVisible();
    await expect(page.locator(SELECTORS.loginSubmit)).toBeVisible();
  });

  test('POST login — redirects to /scs/my_account.ssp on success', async ({ page }) => {
    await login(page);
    expect(page.url()).toContain('my_account');
  });

  test('Network — no 5xx API errors during portal load', async ({ page }) => {
    const failedRequests: string[] = [];

    page.on('response', res => {
      if (
        (res.request().resourceType() === 'xhr' || res.request().resourceType() === 'fetch') &&
        res.status() >= 500
      ) {
        failedRequests.push(`${res.status()} ${res.url()}`);
      }
    });

    await page.goto('/my-portal');
    await page.waitForLoadState('networkidle');

    if (failedRequests.length > 0) {
      console.warn('Failed API requests:', failedRequests);
    }
    expect(failedRequests).toHaveLength(0);
  });

  test('Network — CheckoutEnvironment is called during portal load', async ({ page }) => {
    const apiCalls: Array<{ method: string; url: string; status: number }> = [];

    page.on('response', res => {
      if (res.request().resourceType() === 'xhr' || res.request().resourceType() === 'fetch') {
        apiCalls.push({
          method: res.request().method(),
          url: res.url(),
          status: res.status(),
        });
      }
    });

    await login(page);

    console.log('\n=== API calls during login flow ===');
    apiCalls.forEach(c => console.log(`${c.method} ${c.status} ${c.url}`));

    const envCall = apiCalls.find(c => c.url.includes('CheckoutEnvironment'));
    expect(envCall).toBeDefined();
  });

});

test.describe('Authenticated Portal Endpoints', () => {

  test('Authenticated — chrole cookie is set after login', async ({ page }) => {
    await login(page);

    const cookies = await page.context().cookies();
    console.log('Session cookies:', cookies.map(c => `${c.name}=${c.value.substring(0, 10)}...`));

    const chroleCookie = cookies.find(c => c.name === 'chrole');
    expect(chroleCookie).toBeDefined();
    expect(Number(chroleCookie?.value)).toBeGreaterThan(0);
  });

  test('Authenticated — /my-portal does not show login form after login', async ({ page }) => {
    await login(page);

    await page.goto('/my-portal');
    await page.waitForLoadState('networkidle');

    const isLoginFormVisible = await page.locator(SELECTORS.loginEmail).isVisible().catch(() => false);
    console.log('Login form visible after re-visit:', isLoginFormVisible);
    expect(isLoginFormVisible).toBe(false);
  });

  test('Authenticated — environment service with session cookies returns 200', async ({ page }) => {
    await login(page);

    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const response = await page.context().request.get(ENV_SERVICE_URL, {
      headers: { Cookie: cookieHeader },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('SESSION');
    expect(body).toHaveProperty('ENVIRONMENT');
    console.log('SESSION priceLevel:', body?.SESSION?.priceLevel);
  });

  test('Authenticated — LiveOrder API returns cart data', async ({ page }) => {
    await login(page);

    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const response = await page.context().request.get(
      `${BASE_URL}/scs/services/LiveOrder.Service.ss?internalid=cart`,
      { headers: { Cookie: cookieHeader } }
    );

    expect(response.status()).toBe(200);
    const body = await response.json();
    console.log('Cart lines count:', body?.lines?.length);
    expect(body).toHaveProperty('lines');
  });

  test('Authenticated — ProductList API returns list data', async ({ page }) => {
    await login(page);

    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const response = await page.context().request.get(
      `${BASE_URL}/scs/services/ProductList.Service.ss`,
      { headers: { Cookie: cookieHeader } }
    );

    expect(response.status()).toBe(200);
    const body = await response.json();
    console.log('Product lists count:', Array.isArray(body) ? body.length : 'N/A');
    expect(Array.isArray(body)).toBe(true);
  });

  test('Authenticated — all intercepted JSON API calls return 2xx status', async ({ page }) => {
    const apiResponses: Array<{ url: string; status: number }> = [];

    page.on('response', res => {
      const ct = res.headers()['content-type'] ?? '';
      if (
        (res.request().resourceType() === 'xhr' || res.request().resourceType() === 'fetch') &&
        (ct.includes('json') || ct.includes('javascript'))
      ) {
        apiResponses.push({ url: res.url(), status: res.status() });
      }
    });

    await login(page);
    await page.goto('/my-portal');
    await page.waitForLoadState('networkidle');

    console.log('\n=== Authenticated API responses ===');
    apiResponses.forEach(r => console.log(`${r.status} ${r.url}`));

    const failed = apiResponses.filter(r => r.status >= 400);
    if (failed.length > 0) console.warn('Failed API calls:', failed);
    expect(failed).toHaveLength(0);
  });

});

test.describe('Security Checks', () => {

  test('Unauthenticated — CheckoutEnvironment returns 200 (public config endpoint)', async ({ request }) => {
    const response = await request.get(ENV_SERVICE_URL);
    expect(response.status()).toBe(200);
  });

  test('Unauthenticated — logout URL redirects gracefully without 5xx', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/scs/logOut.ssp?logoff=T`);
    await page.waitForLoadState('networkidle');
    expect(response?.status()).not.toBe(500);
  });

  test('Headers — X-Frame-Options is SAMEORIGIN', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/my-portal`);
    const headers = response.headers();
    console.log('X-Frame-Options:', headers['x-frame-options']);
    expect(headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  test('Headers — Content-Security-Policy header is present', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/my-portal`);
    const headers = response.headers();
    const csp = headers['content-security-policy'];
    console.log('CSP present:', !!csp);
    expect(csp).toBeTruthy();
  });

});
