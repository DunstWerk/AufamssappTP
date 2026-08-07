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

  const row74 = page.locator('.row-item[data-id="id74"]');
  await row74.locator('.chk-geprueft').check();

  // Pending-Filter setzen (Geprüft=Ja), aber noch nicht anwenden -> Liste unverändert.
  await page.click('#btn-filter');
  await page.click('.segmented[data-filter="geprueft"] .seg-btn[data-value="ja"]');
  const visibleBeforeApply = await page.locator('.row-item:not([hidden])').count();
  assert.equal(visibleBeforeApply, 105, 'Vor "Anwenden" dürfen sich sichtbare Zeilen nicht ändern');

  await page.click('#btn-filter-apply');
  const visibleAfterApply = await page.locator('.row-item:not([hidden])').count();
  assert.equal(visibleAfterApply, 1, `Nach Anwenden sollte nur 1 geprüfte Zeile sichtbar sein, war: ${visibleAfterApply}`);
  await assertVisible(row74, true);

  // Regressionstest Bug 6: Zeile ändert sich (nicht mehr "geprüft"), darf aber
  // nicht sofort verschwinden, solange der Filter nicht erneut angewendet wird.
  await row74.locator('.chk-geprueft').uncheck();
  await assertVisible(row74, true);

  await page.click('#btn-filter');
  await page.click('#btn-filter-apply');
  await assertVisible(row74, false);

  // Zurücksetzen wirkt sofort.
  await page.click('#btn-filter');
  await page.click('#btn-filter-reset');
  const visibleAfterReset = await page.locator('.row-item:not([hidden])').count();
  assert.equal(visibleAfterReset, 105);

  // Live-Suche inkl. Bemerkung.
  await row74.locator('.toggle-bemerkung').click();
  await row74.locator('.inp-bemerkung').fill('Sonderzustand XYZ');
  await page.fill('#search-input', 'Sonderzustand XYZ');
  const visibleDuringSearch = await page.locator('.row-item:not([hidden])').count();
  assert.equal(visibleDuringSearch, 1, 'Suche sollte auch Bemerkungen durchsuchen');

  console.log('04-filter-search: OK');
} finally {
  await browser.close();
  server.close();
}

async function assertVisible(locator, expected) {
  const hidden = await locator.getAttribute('hidden');
  const isVisible = hidden === null;
  assert.equal(isVisible, expected, `Sichtbarkeit erwartet=${expected}, war hidden=${hidden}`);
}
