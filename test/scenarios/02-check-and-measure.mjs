import { chromium } from '../pw.mjs';
import { startServer } from '../serve.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(__dirname, '../fixtures');

const { server, url } = await startServer();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on('pageerror', (err) => console.error('[pageerror]', err));
  await page.goto(url);
  await page.setInputFiles('#file-lv', path.join(fixtures, 'LV_Goettingen.X86'));
  await page.setInputFiles('#file-x31', path.join(fixtures, 'Aufmass_Goettingen.X31'));
  await page.click('#btn-import');
  await page.waitForSelector('#screen-list:not([hidden])');

  const row = page.locator('.row-item[data-id="id74"]');
  const otherRowHtmlBefore = await page.locator('.row-item[data-id="id75"]').innerHTML();

  await row.locator('.chk-geprueft').check();
  await row.locator('.inp-menge').fill('2.5');
  await row.locator('.klass-toggle .seg-btn[data-value="geliefert"]').click();

  const effective = await row.locator('.effective-value').textContent();
  assert.equal(effective, '2', `Erwartet 2.5*0.8=2, war: ${effective}`);

  const progressLabel = await page.textContent('#progress-label');
  assert.match(progressLabel, /1 \/ 105 geprüft/, `Erwartet 1/105 geprüft, war: ${progressLabel}`);

  // Regressionstest Bug 6: andere Zeile darf durch gezieltes Update nicht verändert worden sein.
  const otherRowHtmlAfter = await page.locator('.row-item[data-id="id75"]').innerHTML();
  assert.equal(otherRowHtmlBefore, otherRowHtmlAfter, 'Andere Zeile wurde unerwartet verändert (kein gezieltes Update?)');

  console.log('02-check-and-measure: OK');
} finally {
  await browser.close();
  server.close();
}
