import { chromium } from '../pw.mjs';
import { startServer } from '../serve.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(__dirname, '../fixtures');
const root = path.resolve(__dirname, '../..');

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

  // id74 hat einen X31-Eintrag (blank-skeleton) -> exportierbar.
  // id80 hat KEINEN X31-Eintrag -> darf trotz "geprüft" NICHT exportiert werden.
  await page.locator('.row-item[data-id="id74"] .chk-geprueft').check();
  await page.locator('.row-item[data-id="id74"] .inp-menge').fill('3.5');
  await page.locator('.row-item[data-id="id74"] .klass-toggle .seg-btn[data-value="montiert"]').click();

  const id80Badges = await page.locator('.row-item[data-id="id80"] .row-badges').textContent();
  assert.match(id80Badges, /nicht in X31/);
  await page.locator('.row-item[data-id="id80"] .chk-geprueft').check();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btn-export'),
  ]);
  const exportedPath = path.join(os.tmpdir(), 'exported-aufmass.X31');
  await download.saveAs(exportedPath);

  const toastText = await page.textContent('#toast');
  assert.match(toastText, /1 Position\(en\) aktualisiert/);
  assert.match(toastText, /1 geprüfte Position\(en\) ohne X31-Eintrag wurden NICHT exportiert/);

  const originalPath = path.join(fixtures, 'Aufmass_Goettingen.X31');
  const out = execFileSync('python3', [
    path.join(root, 'test/verify_export_diff.py'),
    originalPath,
    exportedPath,
    'id74',
  ]).toString();
  console.log(out);
  assert.match(out, /Alle Prüfungen bestanden\./);

  console.log('05-export-and-diff: OK');
} finally {
  await browser.close();
  server.close();
}
