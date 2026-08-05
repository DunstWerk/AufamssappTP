// Spike-Skript zur Verifizierung des REB-23.003-Zeilenformats.
//
// HINTERGRUND: Die mitgelieferte X31-Beispieldatei enthält für jede Position
// nur ein leeres Formular-Platzhaltermuster
// ("<Zahlencode> = <4-stellige Itemnummer><Buchstabe><Ziffer>"),
// aber KEINEN echten, in ORCA AVA eingetragenen Messwert. gaebX31.js kodiert
// Werte deshalb bislang nur nach bestem Wissen (siehe REB_FORMAT_VALIDATED
// in gaebX31.js und TODO.md) — nicht anhand eines echten Beispiels verifiziert.
//
// SOBALD eine zweite X31-Datei mit mindestens einer manuell in ORCA AVA
// eingetragenen Menge vorliegt: dieses Skript gegen die leere und die
// befüllte Datei laufen lassen, um pro <Item ID="..."> die exakte
// Byte-Differenz der Row-Attributwerte zu sehen (Spaltenbreite, Padding,
// Dezimaltrennzeichen, Position des Formel-Codes).
//
// Aufruf:
//   node tools/reb23003-diff.mjs <blank.X31> <filled.X31>
import { readFileSync } from 'node:fs';

const [blankPath, filledPath] = process.argv.slice(2);
if (!blankPath || !filledPath) {
  console.error('Aufruf: node tools/reb23003-diff.mjs <blank.X31> <filled.X31>');
  process.exit(2);
}

const blankText = readFileSync(blankPath, 'utf-8');
const filledText = readFileSync(filledPath, 'utf-8');

function extractRows(text) {
  const rows = new Map();
  const itemRe = /<Item ID="([^"]+)"/g;
  let m;
  while ((m = itemRe.exec(text)) !== null) {
    const id = m[1];
    const start = m.index;
    const nextItem = text.indexOf('<Item ID="', start + 1);
    const nextEndBody = text.indexOf('</Itemlist>', start);
    const boundaries = [nextItem, nextEndBody].filter((x) => x !== -1);
    const end = boundaries.length ? Math.min(...boundaries) : text.length;
    const chunk = text.slice(start, end);
    const rowMatches = [...chunk.matchAll(/<QTakeoff\b[^>]*\bRow="([^"]*)"[^>]*\/?>/g)];
    if (rowMatches.length) {
      rows.set(id, rowMatches[rowMatches.length - 1][1]);
    }
  }
  return rows;
}

const blankRows = extractRows(blankText);
const filledRows = extractRows(filledText);

console.log(`Positionen in blank: ${blankRows.size}, in filled: ${filledRows.size}\n`);

let diffCount = 0;
for (const [id, filledRow] of filledRows) {
  const blankRow = blankRows.get(id);
  if (blankRow === undefined) {
    console.log(`[nur in filled] ${id}: "${filledRow}"`);
    continue;
  }
  if (blankRow === filledRow) continue;
  diffCount++;
  console.log(`--- ${id} ---`);
  console.log(`blank  (len ${blankRow.length}): "${blankRow}"`);
  console.log(`filled (len ${filledRow.length}): "${filledRow}"`);
  console.log('Zeichen-für-Zeichen-Diff:');
  const maxLen = Math.max(blankRow.length, filledRow.length);
  let diffLine = '';
  for (let i = 0; i < maxLen; i++) {
    diffLine += blankRow[i] === filledRow[i] ? '.' : '^';
  }
  console.log('        ' + diffLine);
  console.log();
}

if (diffCount === 0) {
  console.log('Keine unterschiedlichen Row-Werte gefunden — sind das wirklich zwei verschiedene Stände (leer vs. befüllt)?');
} else {
  console.log(`${diffCount} Position(en) mit abweichendem Row-Wert gefunden. Muster oben auswerten, dann`);
  console.log('encodeFormel91()/parseFormel91() in gaebX31.js entsprechend anpassen, REB_FORMAT_VALIDATED=true setzen,');
  console.log('und eine Regressions-Fixture unter test/fixtures/ ergänzen.');
}
