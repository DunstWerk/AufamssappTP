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
  const progressLabel = await page.textContent('#progress-label');
  assert.match(progressLabel, /0 \/ 105 geprüft/, `Erwartet 0 / 105 geprüft, war: ${progressLabel}`);

  const rowCount = await page.locator('.row-item').count();
  assert.equal(rowCount, 105, `Erwartet 105 Item-Zeilen, war: ${rowCount}`);

  const firstRowText = await page.locator('.row-item[data-id="id74"] .pos-kurztext').textContent();
  assert.equal(firstRowText, 'Netzwerk Switch, 40+8 Ports, PoE+');

  const bannerText = await page.textContent('#banner');
  assert.match(bannerText, /keinen Eintrag in der importierten X31/, 'Banner sollte auf fehlende X31-Einträge hinweisen');

  console.log('01-import: OK');
} finally {
  await browser.close();
  server.close();
}
