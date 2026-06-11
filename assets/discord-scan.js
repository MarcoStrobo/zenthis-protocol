const { chromium } = require('playwright-core');
const path = require('path');

const PROFILE = path.resolve('C:/Users/Suko/.openclaw/workspace/.pw-profile');

(async () => {
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    args: ['--window-size=1400,900', '--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });

  const page = await context.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  // Go to Discord
  await page.goto('https://discord.com/channels/@me', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(5000);

  // List all visible channels/servers
  const elements = await page.evaluate(() => {
    const items = document.querySelectorAll('[data-list-item-id]');
    return Array.from(items).slice(0, 30).map(el => ({
      id: el.getAttribute('data-list-item-id'),
      text: el.textContent?.substring(0, 80),
    }));
  });
  console.log('Server/channel items:', JSON.stringify(elements, null, 2));

  await page.waitForTimeout(2000);
  await context.close();
})().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
