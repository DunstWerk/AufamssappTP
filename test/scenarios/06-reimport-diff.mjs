// Testet den Re-Import-Diff-Flow: eine Position wird aus dem LV entfernt
// (muss als "orphaned" erhalten bleiben, nicht gelöscht werden), eine neue
// Position kommt hinzu (muss einen frischen Default-Datensatz bekommen).
// Die mutierte LV-Datei wird aus der echten Fixture programmatisch erzeugt
// (String-Chirurgie auf echten Daten), nicht komplett synthetisch erfunden.
import { chromium } from '../pw.mjs';
import { startServer } from '../serve.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(__dirname, '../fixtures');

function buildModifiedLv(originalText) {
  // Entfernt die Position id74 komplett.
  const start = originalText.indexOf('<Item ID="id74"');
  assert.ok(start >= 0, 'id74 nicht in der Original-LV gefunden');
  const end = originalText.indexOf('<Item ID="id75"', start);
  assert.ok(end > start, 'id75 (Nachbar-Item) nicht gefunden');
  let text = originalText.slice(0, start) + originalText.slice(end);

  // Dupliziert id75 als neue Position "id9999" (RNoPart angepasst) direkt
  // dahinter, um eine "neu hinzugekommene" Position zu simulieren.
  const id75Start = text.indexOf('<Item ID="id75"');
  const id75End = text.indexOf('</Item>', id75Start) + '</Item>'.length;
  const id75Block = text.slice(id75Start, id75End);
  const newBlock = id75Block.replace('<Item ID="id75" RNoPart="2"', '<Item ID="id9999" RNoPart="99"');
  text = text.slice(0, id75End) + newBlock + text.slice(id75End);
  return text;
}

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
  await page.locator('.row-item[data-id="id74"] .inp-menge').fill('7');
  await page.waitForTimeout(400);

  const originalLvText = readFileSync(path.join(fixtures, 'LV_Goettingen.X86'), 'utf-8');
  const modifiedLvText = buildModifiedLv(originalLvText);
  const originalX31Buffer = readFileSync(path.join(fixtures, 'Aufmass_Goettingen.X31'));

  await page.click('#btn-reimport');
  await page.waitForSelector('#screen-import:not([hidden])');
  await page.setInputFiles('#file-lv', {
    name: 'LV_modified.X86',
    mimeType: 'application/xml',
    buffer: Buffer.from(modifiedLvText, 'utf-8'),
  });
  await page.setInputFiles('#file-x31', {
    name: 'Aufmass_Goettingen.X31',
    mimeType: 'application/xml',
    buffer: originalX31Buffer,
  });
  await page.click('#btn-import');
  await page.waitForSelector('#screen-list:not([hidden])');

  await page.waitForSelector('dialog#reimport-dialog[open]');
  const summary = await page.textContent('#reimport-summary');
  assert.match(summary, /1 neue Position\(en\) hinzugekommen/, summary);
  assert.match(summary, /1 Position\(en\) sind im neuen LV nicht mehr vorhanden/, summary);
  await page.click('#reimport-ack');

  const id74Visible = await page.locator('.row-item[data-id="id74"]').count();
  assert.equal(id74Visible, 0, 'id74 sollte nach Entfernung aus dem LV nicht mehr gerendert werden');

  const id9999Row = page.locator('.row-item[data-id="id9999"]');
  await assertExists(id9999Row);
  assert.equal(await id9999Row.locator('.chk-geprueft').isChecked(), false);

  const orphanRecord = await page.evaluate(async () => {
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
  assert.equal(orphanRecord.orphaned, true);
  assert.equal(orphanRecord.geprueft, true);
  assert.equal(orphanRecord.menge, 7);

  console.log('06-reimport-diff: OK');
} finally {
  await browser.close();
  server.close();
}

async function assertExists(locator) {
  const count = await locator.count();
  assert.equal(count, 1, 'Erwartetes Element nicht gefunden');
}
