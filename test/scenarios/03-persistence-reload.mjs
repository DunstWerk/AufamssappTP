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
  await row.locator('.chk-geprueft').check();
  await row.locator('.inp-menge').fill('4.25');
  await row.locator('.toggle-bemerkung').click();
  await row.locator('.inp-bemerkung').fill('Testbemerkung 123');

  // Debounce (250ms) abwarten, dann direkt in IndexedDB nachsehen.
  await page.waitForTimeout(500);
  const dbRecord = await page.evaluate(async () => {
    const req = indexedDB.open('gaeb-aufmass');
    const db = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const tx = db.transaction('positions', 'readonly');
    return new Promise((res, rej) => {
      const r = tx.objectStore('positions').get('id74');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  });
  assert.equal(dbRecord.geprueft, true);
  assert.equal(dbRecord.menge, 4.25);
  assert.equal(dbRecord.bemerkung, 'Testbemerkung 123');

  await page.reload();
  await page.waitForSelector('#screen-list:not([hidden])');
  const row2 = page.locator('.row-item[data-id="id74"]');
  assert.equal(await row2.locator('.chk-geprueft').isChecked(), true);
  assert.equal(await row2.locator('.inp-menge').inputValue(), '4.25');
  assert.equal(await row2.locator('.toggle-bemerkung').getAttribute('class'), 'icon-btn toggle-bemerkung has-content');

  console.log('03-persistence-reload: OK');
} finally {
  await browser.close();
  server.close();
}
