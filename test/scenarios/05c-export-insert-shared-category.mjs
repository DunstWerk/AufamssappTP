// Regressionstest für einen realen, vom Nutzer beim ORCA-Reimport gefundenen
// Bug: wenn ZWEI neu einzufügende Positionen dieselbe, in der X31 fehlende
// Vorfahren-Kategorie teilen (hier: id79 UND id80 fehlen beide unter der
// ebenfalls fehlenden Bereich-Kategorie id77 "Pult"), wurde diese Kategorie
// bisher ZWEIMAL angelegt (doppelte <BoQCtgy ID="id77">) — ungültige Struktur.
// Erwartet: nur EIN <BoQCtgy ID="id77">, das beide neuen Items enthält.
import { chromium } from '../pw.mjs';
import { startServer } from '../serve.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

  // id79 und id80 sitzen beide unter der Bereich-Kategorie "id77" (Pult),
  // die selbst nicht in der importierten X31 vorkommt.
  for (const id of ['id79', 'id80']) {
    await page.locator(`.row-item[data-id="${id}"] .chk-geprueft`).check();
  }
  await page.locator('.row-item[data-id="id79"] .inp-menge').fill('1');
  await page.locator('.row-item[data-id="id80"] .inp-menge').fill('2');

  await page.click('#btn-export');
  await page.waitForSelector('#export-warning-dialog[open]');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#export-warning-proceed'),
  ]);
  const exportedPath = path.join(os.tmpdir(), 'exported-shared-category.X31');
  await download.saveAs(exportedPath);

  const toastText = await page.textContent('#toast');
  assert.match(toastText, /2 Position\(en\) neu in die X31 eingefügt/, toastText);

  const exportedText = readFileSync(exportedPath, 'utf-8');
  const id77Count = (exportedText.match(/<BoQCtgy ID="id77"/g) || []).length;
  assert.equal(id77Count, 1, `Kategorie id77 sollte genau einmal angelegt werden, war: ${id77Count}`);
  assert.match(exportedText, /<Item ID="id79"/);
  assert.match(exportedText, /<Item ID="id80"/);

  const originalPath = path.join(fixtures, 'Aufmass_Goettingen.X31');
  const out = execFileSync('python3', [
    path.join(root, 'test/verify_export_diff.py'),
    originalPath,
    exportedPath,
    '',
    '--inserted',
    'id79,id80',
  ]).toString();
  console.log(out);
  assert.match(out, /Alle Prüfungen bestanden\./);

  console.log('05c-export-insert-shared-category: OK');
} finally {
  await browser.close();
  server.close();
}
