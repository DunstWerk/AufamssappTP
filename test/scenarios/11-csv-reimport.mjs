// Testet den neuen CSV-Import: eine zuvor exportierte Excel-Sicherung soll
// beim (Neu-)Import den Arbeitsstand (Geprüft, Menge, Klassifikation,
// Bemerkung) wiederherstellen — z.B. nach Gerätewechsel oder gelöschten
// Website-Daten, wenn IndexedDB leer ist.
import { chromium } from '../pw.mjs';
import { startServer } from '../serve.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
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

  const row74 = page.locator('.row-item[data-id="id74"]');
  await row74.locator('.chk-geprueft').check();
  await row74.locator('.inp-menge').fill('4.5');
  await row74.locator('.klass-toggle .seg-btn[data-value="geliefert"]').click();
  await row74.locator('.toggle-bemerkung').click();
  await row74.locator('.inp-bemerkung').fill('Wiederhergestellte Bemerkung');

  const row75 = page.locator('.row-item[data-id="id75"]');
  await row75.locator('.inp-menge').fill('9');
  // id75 bleibt bewusst ungeprüft.

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btn-export-excel'),
  ]);
  const csvPath = path.join(os.tmpdir(), 'csv-reimport-test.csv');
  await download.saveAs(csvPath);

  // Simuliert ein neues Gerät / gelöschte Website-Daten: IndexedDB leeren und neu laden.
  await page.evaluate(() => indexedDB.deleteDatabase('gaeb-aufmass'));
  await page.reload();
  await page.waitForSelector('#screen-import:not([hidden])');

  await page.setInputFiles('#file-lv', path.join(fixtures, 'LV_Goettingen.X86'));
  await page.setInputFiles('#file-x31', path.join(fixtures, 'Aufmass_Goettingen.X31'));
  await page.setInputFiles('#file-csv', csvPath);
  await page.click('#btn-import');
  await page.waitForSelector('#screen-list:not([hidden])');

  const toastText = await page.textContent('#toast');
  assert.match(toastText, /Arbeitsstand aus Excel-Sicherung übernommen: 105 von 105 Position\(en\)\./, toastText);

  const restoredRow74 = page.locator('.row-item[data-id="id74"]');
  assert.equal(await restoredRow74.locator('.chk-geprueft').isChecked(), true);
  assert.equal(await restoredRow74.locator('.inp-menge').inputValue(), '4.5');
  assert.match(
    await restoredRow74.locator('.klass-toggle .seg-btn.seg-active').textContent(),
    /Geliefert/
  );
  assert.equal(
    await restoredRow74.locator('.toggle-bemerkung').getAttribute('class'),
    'icon-btn toggle-bemerkung has-content'
  );
  await restoredRow74.locator('.toggle-bemerkung').click();
  assert.equal(await restoredRow74.locator('.inp-bemerkung').inputValue(), 'Wiederhergestellte Bemerkung');

  const restoredRow75 = page.locator('.row-item[data-id="id75"]');
  assert.equal(await restoredRow75.locator('.chk-geprueft').isChecked(), false);
  assert.equal(await restoredRow75.locator('.inp-menge').inputValue(), '9');

  // Persistenz: nach Reload (ohne erneuten Import) bleibt der wiederhergestellte Stand erhalten.
  await page.reload();
  await page.waitForSelector('#screen-list:not([hidden])');
  assert.equal(await page.locator('.row-item[data-id="id74"] .chk-geprueft').isChecked(), true);

  console.log('11-csv-reimport: OK');
} finally {
  await browser.close();
  server.close();
}
