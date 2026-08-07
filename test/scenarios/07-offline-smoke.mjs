// Offline-Smoketest: nach dem ersten (Online-)Laden soll der Service Worker
// die App-Shell gecached haben, sodass ein Reload offline weiterhin funktioniert.
import { chromium } from '../pw.mjs';
import { startServer } from '../serve.mjs';
import assert from 'node:assert/strict';

const { server, url } = await startServer();
const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error('[pageerror]', err));
  await page.goto(url);

  await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true));
  await page.waitForFunction(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    return regs.length > 0 && !!regs[0].active;
  });
  // Kurze Wartezeit, damit der "install"-Handler addAll() sicher abgeschlossen hat.
  await page.waitForTimeout(500);

  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('#screen-import:not([hidden])', { timeout: 5000 });
  const title = await page.textContent('.import-card h1');
  assert.equal(title, 'Aufmaßprüfung GAEB');

  console.log('07-offline-smoke: OK');
} finally {
  await browser.close();
  server.close();
}
