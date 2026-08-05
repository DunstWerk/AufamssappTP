// Testet den Insert-Pfad (Pfad B) des Exports über die echte UI: Positionen, die
// geprüft/gemessen werden, aber noch keinen X31-Eintrag haben, sollen beim Export
// als neue Knoten in die X31 eingefügt werden (Nutzeranforderung, siehe TODO.md
// Risikohinweis zum unverifizierten REB-Format).
//
// Fall a: id75 — Kategorie id72 existiert schon in der X31 (id74 ist drin),
//         id75 fehlt nur als <Item> -> Insert in bestehende <Itemlist>.
// Fall b: id80 — Kategorie id77 ("Pult") fehlt komplett in der X31, ihr
//         Elternkategorie id76 existiert aber -> neue Kategorie + Itemlist + Item.
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

  for (const id of ['id75', 'id80']) {
    const badges = await page.locator(`.row-item[data-id="${id}"] .row-badges`).textContent();
    assert.match(badges, /neu in X31/, `Position ${id} sollte als "neu in X31" markiert sein`);
    await page.locator(`.row-item[data-id="${id}"] .chk-geprueft`).check();
  }
  await page.locator('.row-item[data-id="id75"] .inp-menge').fill('3');
  await page.locator('.row-item[data-id="id80"] .inp-menge').fill('4');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btn-export'),
  ]);
  const exportedPath = path.join(os.tmpdir(), 'exported-aufmass-insert.X31');
  await download.saveAs(exportedPath);

  const toastText = await page.textContent('#toast');
  assert.match(toastText, /2 Position\(en\) neu in die X31 eingefügt/, toastText);

  const originalPath = path.join(fixtures, 'Aufmass_Goettingen.X31');
  const out = execFileSync('python3', [
    path.join(root, 'test/verify_export_diff.py'),
    originalPath,
    exportedPath,
    '',
    '--inserted',
    'id75,id80',
  ]).toString();
  console.log(out);
  assert.match(out, /Alle Prüfungen bestanden\./);

  console.log('05b-export-insert: OK');
} finally {
  await browser.close();
  server.close();
}
