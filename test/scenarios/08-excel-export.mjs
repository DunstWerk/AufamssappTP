// Testet die zusätzliche Excel-Sicherung (CSV): Positionen mit Daten erfassen,
// exportieren, Datei-Inhalt gegen erwartete Werte prüfen (BOM, Semikolon-CSV,
// deutsches Zahlenformat, Positionsnummer als Text-Formel kodiert, Abrechnung
// nur bei geprüften Positionen befüllt).
import { chromium } from '../pw.mjs';
import { startServer } from '../serve.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  await row74.locator('.inp-menge').fill('2.5');
  await row74.locator('.klass-toggle .seg-btn[data-value="geliefert"]').click();
  await row74.locator('.toggle-bemerkung').click();
  await row74.locator('.inp-bemerkung').fill('Test; mit "Sonderzeichen"');

  // id75 bleibt UNGEPRÜFT -> Abrechnung muss in der CSV leer bleiben.
  const row75 = page.locator('.row-item[data-id="id75"]');
  await row75.locator('.inp-menge').fill('3');

  // id94 hat eine zweistufige Kategorie-Kette (Titel "02" + Bereich "03") ->
  // guter Regressionstest für die gemeldete Ziffern-Vertauschung ("30.001"
  // statt "03.001"), da hier ZWEI zweistellige Segmente vorkommen.
  const row94 = page.locator('.row-item[data-id="id94"]');
  await row94.locator('.chk-geprueft').check();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btn-export-excel'),
  ]);
  const csvPath = path.join(os.tmpdir(), 'excel-export.csv');
  await download.saveAs(csvPath);

  const toastText = await page.textContent('#toast');
  assert.match(toastText, /Excel-Sicherung erstellt: 105 Position\(en\)\./, toastText);

  const buf = readFileSync(csvPath);
  assert.equal(buf[0], 0xef);
  assert.equal(buf[1], 0xbb);
  assert.equal(buf[2], 0xbf);
  const text = buf.toString('utf-8').replace(/^﻿/, '');
  const lines = text.split('\r\n');
  assert.equal(lines[0], 'Positionsnummer;Kategorie;Kurztext;Einheit;Soll-Menge;Geprüft;Erfasste Menge;Klassifikation;Abrechnungsmenge;Bemerkung');
  assert.equal(lines.length, 1 + 105 + (lines[lines.length - 1] === '' ? 1 : 0));

  // Positionsnummer muss als Excel-Text-Formel ="01.0001" kodiert sein
  // (CSV-escaped: das gesamte Feld landet in Anführungszeichen, die inneren
  // Anführungszeichen sind verdoppelt) — schützt vor Excels Zahlen-/
  // Tausendertrennzeichen-Fehlinterpretation, die zuvor "02.03.0001" zu
  // "20.30.001" verstümmelt hat.
  const field74 = '"=""01.0001"""';
  const id74Line = lines.find((l) => l.startsWith(field74 + ';'));
  assert.ok(id74Line, `Zeile für id74 nicht mit erwartetem Positionsnummer-Feld gefunden (${field74})`);
  assert.match(id74Line, /Netzwerktechnik/);
  assert.match(id74Line, /Netzwerk Switch, 40\+8 Ports, PoE\+/);
  assert.match(id74Line, /;Ja;2,5;Geliefert \(×0,8\);2;/);
  assert.match(id74Line, /"Test; mit ""Sonderzeichen"""/);

  const field94 = '"=""02.03.0001"""';
  const id94Line = lines.find((l) => l.startsWith(field94 + ';'));
  assert.ok(id94Line, `Zeile für id94 nicht mit erwartetem Positionsnummer-Feld gefunden (${field94})`);

  // id75: nicht geprüft -> Abrechnungsmenge muss leer sein, obwohl eine
  // Menge eingetragen wurde.
  const field75 = '"=""01.0002"""';
  const id75Line = lines.find((l) => l.startsWith(field75 + ';'));
  assert.ok(id75Line, 'Zeile für id75 nicht gefunden');
  assert.match(id75Line, /;Nein;3;Montiert \(×1,0\);;/, `Abrechnung sollte bei ungeprüfter Position leer sein: ${id75Line}`);

  console.log('08-excel-export: OK');
} finally {
  await browser.close();
  server.close();
}
