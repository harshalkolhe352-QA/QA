import { APIRequestContext, Page, request } from '@playwright/test';

export const BASE_URL = 'https://qa-dev-l3.mem360.org';

export const CREDENTIALS = {
  email: 'john.ray@testmail.com',
  password: 'Reset@123',
};

export const LOGIN_URL = `${BASE_URL}/scs/checkout.ssp?is=login&login=T`;
export const LOGOUT_URL = `${BASE_URL}/scs/logOut.ssp?logoff=T`;
export const ENV_SERVICE_URL = `${BASE_URL}/scs/services/CheckoutEnvironment.Service.ss?lang=en_US&cur=USD&X-SC-Touchpoint=checkout`;

// Exact login form selectors (SuiteCommerce SPA DOM)
export const SELECTORS = {
  loginEmail: '#login-email',
  loginPassword: '#login-password',
  loginSubmit: '.login-register-login-submit',
};

/**
 * Logs in via the UI and returns the page with an authenticated session.
 * After login, the SPA redirects to /scs/my_account.ssp.
 */
export async function loginViaUI(page: Page): Promise<void> {
  await page.goto('/my-portal');

  // SuiteCommerce SPA uses hash routing — wait for #login-register route to activate
  await page.waitForURL('**#login-register**', { timeout: 15000 });
  await page.waitForSelector(SELECTORS.loginEmail, { state: 'visible', timeout: 15000 });

  // Backbone.js needs time to bind event listeners to the rendered form
  await page.waitForTimeout(3000);

  await page.fill(SELECTORS.loginEmail, CREDENTIALS.email);
  await page.fill(SELECTORS.loginPassword, CREDENTIALS.password);

  // Login causes a full navigation to /scs/my_account.ssp
  await Promise.all([
    page.waitForURL('**/scs/my_account.ssp**', { timeout: 15000 }),
    page.click(SELECTORS.loginSubmit),
  ]);
}

/**
 * Creates an authenticated API request context by logging in via the UI
 * and capturing the session cookies.
 */
export async function createAuthenticatedContext(page: Page): Promise<{
  cookies: string;
  context: APIRequestContext;
}> {
  await loginViaUI(page);

  const cookies = await page.context().cookies();
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  const context = await request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: {
      Cookie: cookieHeader,
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
    },
    ignoreHTTPSErrors: true,
  });

  return { cookies: cookieHeader, context };
}
