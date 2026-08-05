// Testet die zusätzliche Excel-Sicherung (CSV): Positionen mit Daten erfassen,
// exportieren, Datei-Inhalt gegen erwartete Werte prüfen (BOM, Semikolon-CSV,
// deutsches Zahlenformat, alle Positionen enthalten).
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

  const row = page.locator('.row-item[data-id="id74"]');
  await row.locator('.chk-geprueft').check();
  await row.locator('.inp-menge').fill('2.5');
  await row.locator('.klass-toggle .seg-btn[data-value="geliefert"]').click();
  await row.locator('.toggle-bemerkung').click();
  await row.locator('.inp-bemerkung').fill('Test; mit "Sonderzeichen"');

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

  const id74Line = lines.find((l) => l.startsWith('01.0001;'));
  assert.ok(id74Line, 'Zeile für id74 (01.0001) nicht gefunden');
  assert.match(id74Line, /Netzwerktechnik/);
  assert.match(id74Line, /Netzwerk Switch, 40\+8 Ports, PoE\+/);
  assert.match(id74Line, /;Ja;2,5;Geliefert \(×0,8\);2;/);
  assert.match(id74Line, /"Test; mit ""Sonderzeichen"""/);

  console.log('08-excel-export: OK');
} finally {
  await browser.close();
  server.close();
}
