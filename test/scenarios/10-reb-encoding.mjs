// Regressionstest für die REB-23.003-Kodierung nach der vom Nutzer
// bereitgestellten Dokumentation: Komma als Dezimaltrennzeichen, ganze Zahlen
// ohne Dezimalteil, Blattadresse aus der Originalzeile übernommen, und
// (Selbstkonsistenz) unsere eigenen geschriebenen Werte werden bei einem
// erneuten Einlesen korrekt als echter Wert erkannt statt als das
// "unbearbeitet"-Platzhaltermuster.
import { chromium } from '../pw.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const commonSrc = readFileSync(path.join(root, 'gaebCommon.js'), 'utf-8');
const x31Src = readFileSync(path.join(root, 'gaebX31.js'), 'utf-8');

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (err) => console.error('[pageerror]', err));
await page.goto('about:blank');

const result = await page.evaluate(
  async ({ commonSrc, x31Src }) => {
    const commonUrl = URL.createObjectURL(new Blob([commonSrc], { type: 'text/javascript' }));
    const x31Url = URL.createObjectURL(
      new Blob([x31Src.replace("from './gaebCommon.js'", `from '${commonUrl}'`)], { type: 'text/javascript' })
    );
    const { encodeFormel91, parseFormel91 } = await import(x31Url);

    const originalBlank = '                          800911 =                                   0010A0     ';

    return {
      wholeNumber: encodeFormel91(17, originalBlank),
      fractional: encodeFormel91(2.5, originalBlank),
      noTemplate: encodeFormel91(5, null),
      blankStillRecognizedAsBlank: parseFormel91(originalBlank),
      ownWholeNumberReadBack: parseFormel91(encodeFormel91(17, originalBlank)),
      ownFractionalReadBack: parseFormel91(encodeFormel91(2.5, originalBlank)),
      docExampleFractional: parseFormel91(' 910,4= 0001C0 '),
      unknownFormulaStaysUnknown: parseFormel91(' Achse 1 B 05 12330 18550 4650 5120 0001D0 '),
    };
  },
  { commonSrc, x31Src }
);

console.log(JSON.stringify(result, null, 2));

assert.equal(result.wholeNumber, ' 17= 0010A0 ');
assert.equal(result.fractional, ' 2,5= 0010A0 ');
assert.equal(result.noTemplate, ' 5= ');

assert.equal(result.blankStillRecognizedAsBlank.kind, 'blank-skeleton');
assert.equal(result.blankStillRecognizedAsBlank.value, null);

assert.equal(result.ownWholeNumberReadBack.kind, 'constant');
assert.equal(result.ownWholeNumberReadBack.value, 17);
assert.equal(result.ownFractionalReadBack.kind, 'constant');
assert.equal(result.ownFractionalReadBack.value, 2.5);

assert.equal(result.docExampleFractional.kind, 'constant');
assert.equal(result.docExampleFractional.value, 910.4);

assert.equal(result.unknownFormulaStaysUnknown.kind, 'unknown');
assert.equal(result.unknownFormulaStaysUnknown.recognized, false);

console.log('10-reb-encoding: OK');
await browser.close();
