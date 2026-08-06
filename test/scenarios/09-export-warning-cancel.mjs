// Nach dem bestätigten ORCA-Reimport-Fehler zeigt die App vor jedem X31-Export
// eine Warnung (solange REB_FORMAT_VALIDATED=false). Testet, dass "Abbrechen"
// den Export tatsächlich verhindert (kein Download, Dialog schließt sich).
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

  await page.locator('.row-item[data-id="id74"] .chk-geprueft').check();

  let downloadFired = false;
  page.on('download', () => {
    downloadFired = true;
  });

  await page.click('#btn-export');
  await page.waitForSelector('#export-warning-dialog[open]');
  await page.click('#export-warning-cancel');
  await page.waitForFunction(() => !document.getElementById('export-warning-dialog').open);
  await page.waitForTimeout(300);

  assert.equal(downloadFired, false, 'Bei "Abbrechen" darf kein Download ausgelöst werden');

  console.log('09-export-warning-cancel: OK');
} finally {
  await browser.close();
  server.close();
}
