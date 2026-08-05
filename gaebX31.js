// GAEB X31 (Aufmaß/Mengenermittlung, DA31): Lesefunktion (DOMParser) und
// Export-Patch (gezieltes String-Splicing des original importierten Rohtexts).
//
// WICHTIG: Der exakte Byte-Aufbau einer von ORCA AVA BEFÜLLTEN REB-23.003-Zeile
// ist noch nicht empirisch verifiziert (siehe TODO.md) — die mitgelieferte
// Beispieldatei enthält nur leere Formular-Platzhalter. Bis eine Testdatei mit
// echt eingetragener Menge vorliegt, gilt REB_FORMAT_VALIDATED = false und der
// Export zeigt einen entsprechenden Warnhinweis.
export const REB_FORMAT_VALIDATED = false;

import {
  parseGaebXml,
  detectGaebPhase,
  walkBoQBody,
  firstDirectChild,
} from './gaebCommon.js';

/**
 * Erkennt den Inhalt eines <QTakeoff Row="..."> Attributwerts.
 * Erkennt sicher NUR zwei Muster:
 *  - 'blank-skeleton': das von ORCA generierte leere Platzhalter-Muster
 *    "<Zahlencode> = <4-stellige Itemnummer><Buchstabe><Ziffer>" (im
 *    mitgelieferten Beispiel für jede Position vorhanden, ohne echten Wert).
 *  - 'empty': komplett leerer/whitespace-only String.
 * Alles andere gilt als 'unknown' (z.B. eine echte REB-Formel mit Ergebnis) —
 * wird NIE geraten, sondern der Nutzer bekommt einen Hinweis, dass die Zeile
 * nicht automatisch interpretiert werden konnte.
 */
export function parseFormel91(rawRow) {
  if (rawRow == null) return { kind: 'missing', recognized: false, value: null };
  if (rawRow.trim() === '') return { kind: 'empty', recognized: true, value: null };
  const blankSkeleton = rawRow.match(/^(\s*)(\d+)(\s*=\s*)(\d{4}[A-Za-z]\d)(\s*)$/);
  if (blankSkeleton) return { kind: 'blank-skeleton', recognized: true, value: null };
  const bareConstant = rawRow.trim().match(/^(-?\d+(?:[.,]\d+)?)\s*=\s*$/);
  if (bareConstant) {
    return { kind: 'constant', recognized: true, value: parseFloat(bareConstant[1].replace(',', '.')) };
  }
  return { kind: 'unknown', recognized: false, value: null };
}

function findBoQEl(doc) {
  const boqEls = doc.getElementsByTagName('BoQ');
  if (!boqEls.length) throw new Error('Kein <BoQ>-Element in der X31-Datei gefunden.');
  return boqEls[0];
}

/**
 * @returns {{ x31Phase:string, itemsById: Map<string, {
 *   rawRow: string|null, existingQty: number|null, formelKind: string,
 *   isRecognizedFormat: boolean, multiRowWarning: boolean, hasQDetermItem: boolean
 * }> }}
 */
export function parseX31(text) {
  const doc = parseGaebXml(text);
  const x31Phase = detectGaebPhase(doc);
  if (x31Phase && x31Phase !== '31') {
    console.warn(`Unerwartete GAEB-Phase "${x31Phase}" für eine X31-Datei (erwartet 31). Import wird trotzdem versucht.`);
  }
  const boqEl = findBoQEl(doc);
  const bodyEl = firstDirectChild(boqEl, 'BoQBody');
  if (!bodyEl) throw new Error('Kein <BoQBody> in der X31-Datei gefunden.');

  const itemsById = new Map();
  walkBoQBody(bodyEl, {
    onItem(itemEl) {
      const id = itemEl.getAttribute('ID');
      const qDetermItems = itemEl.getElementsByTagName('QDetermItem');
      const multiRowWarning = qDetermItems.length > 1;
      const target = qDetermItems.length ? qDetermItems[qDetermItems.length - 1] : null;
      let rawRow = null;
      let formel = { kind: 'missing', recognized: false, value: null };
      if (target) {
        const qtakeoff = firstDirectChild(target, 'QTakeoff');
        if (qtakeoff) {
          rawRow = qtakeoff.getAttribute('Row');
          formel = parseFormel91(rawRow);
        }
      }
      itemsById.set(id, {
        rawRow,
        existingQty: formel.value,
        formelKind: formel.kind,
        isRecognizedFormat: formel.recognized,
        multiRowWarning,
        hasQDetermItem: !!target,
      });
    },
  });

  return { x31Phase, itemsById };
}

/**
 * Vergleicht die ID-Mengen von LV und X31 und liefert Diagnose-Listen statt
 * still zu ignorieren, falls sie (entgegen der Erwartung) nicht identisch sind.
 */
export function diffIdSets(lvItemsById, x31ItemsById) {
  const lvIds = new Set(lvItemsById.keys());
  const x31Ids = new Set(x31ItemsById.keys());
  const idsOnlyInLv = [...lvIds].filter((id) => !x31Ids.has(id));
  const idsOnlyInX31 = [...x31Ids].filter((id) => !lvIds.has(id));
  return { idsOnlyInLv, idsOnlyInX31 };
}

function formatQty(value) {
  return value.toFixed(3);
}

function padToLength(str, len) {
  if (str.length >= len) return str.slice(0, len);
  return str + ' '.repeat(len - str.length);
}

/**
 * Bestmögliche Kodierung eines Zahlenwerts in eine REB-23.003-"Formel
 * 91"-Zeile, unter Beibehaltung der exakten Feldbreite der ursprünglichen
 * Zeile. Siehe Modul-Kommentar: NICHT gegen ein echtes ORCA-Beispiel mit
 * eingetragener Menge validiert (REB_FORMAT_VALIDATED = false).
 *
 * Strategie: das führende Zahlenfeld der Original-Zeile (Formelcode/Leerwert)
 * wird durch den neuen Wert ersetzt, rechtsbündig in derselben Feldbreite;
 * das Trennzeichen "=" und der nachfolgende Referenzteil (Item-Nummer/Index)
 * bleiben exakt erhalten, da sie vermutlich für die Wiedererkennung durch
 * ORCA relevant sind und ihre genaue Bedeutung nicht gesichert ist.
 */
export function encodeFormel91(value, originalRawRow) {
  const valueStr = formatQty(value);
  if (originalRawRow == null) {
    // Keine Vorlage vorhanden — Notfall-Fallback ohne Breitenreferenz.
    return `${valueStr}=`;
  }
  const m = originalRawRow.match(/^(\s*)(\d+)(\s*=.*)$/);
  if (!m) {
    return padToLength(`${valueStr}=`, originalRawRow.length);
  }
  const [, leadSpace, numField, rest] = m;
  const fieldWidth = leadSpace.length + numField.length;
  const newNumField = valueStr.padStart(fieldWidth, ' ').slice(-Math.max(fieldWidth, valueStr.length));
  return newNumField + rest;
}

/**
 * Lokalisiert im rohen X31-Text das <Item ID="id..."> Element und darin das
 * Row-Attribut der (bei multiRowWarning: letzten) <QTakeoff>. Gibt die
 * Zeichen-Offsets des Attributwerts (exklusive Anführungszeichen) zurück.
 * Wirft, falls die ID nicht gefunden werden kann (nie stillschweigend patchen).
 */
export function locateRowAttributeOffsets(rawText, itemId, { useLastQTakeoff }) {
  const itemOpenRe = new RegExp(`<Item ID="${escapeRegExp(itemId)}"`);
  const itemMatch = itemOpenRe.exec(rawText);
  if (!itemMatch) {
    throw new Error(`Position mit ID "${itemId}" wurde im Original-X31-Text nicht gefunden.`);
  }
  const itemStart = itemMatch.index;
  const nextBoundaryRe = /<Item ID="|<\/Itemlist>/g;
  nextBoundaryRe.lastIndex = itemStart + itemMatch[0].length;
  const boundaryMatch = nextBoundaryRe.exec(rawText);
  const itemEnd = boundaryMatch ? boundaryMatch.index : rawText.length;
  const itemChunk = rawText.slice(itemStart, itemEnd);

  const qtakeoffRe = /<QTakeoff\b[^>]*\bRow="([^"]*)"[^>]*\/?>/g;
  let match;
  let lastMatch = null;
  while ((match = qtakeoffRe.exec(itemChunk)) !== null) {
    lastMatch = match;
    if (!useLastQTakeoff) break;
  }
  if (!lastMatch) {
    throw new Error(`Kein <QTakeoff Row="..."> innerhalb der Position "${itemId}" gefunden.`);
  }
  const rowValueStart = itemStart + lastMatch.index + lastMatch[0].indexOf('Row="') + 'Row="'.length;
  const rowValueEnd = rowValueStart + lastMatch[1].length;
  return { start: rowValueStart, end: rowValueEnd, currentValue: lastMatch[1] };
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Chirurgischer Export: patcht NUR die Row-Attributwerte der tatsächlich
 * geänderten Positionen im original importierten X31-Rohtext. Alle anderen
 * Bytes bleiben unverändert — kein DOMParser/XMLSerializer-Rückweg.
 *
 * @param {string} originalRawText - unveränderter Text der importierten X31
 * @param {Array<{id:string, effectiveQty:number, origRawRow:string|null, multiRowWarning:boolean}>} touchedPositions
 * @returns {{ patchedText:string, changedCount:number }}
 */
export function patchX31(originalRawText, touchedPositions) {
  const patches = touchedPositions.map((pos) => {
    const { start, end } = locateRowAttributeOffsets(originalRawText, pos.id, {
      useLastQTakeoff: pos.multiRowWarning,
    });
    const replacement = encodeFormel91(pos.effectiveQty, pos.origRawRow);
    return { start, end, replacement };
  });

  // Von hinten nach vorne anwenden, damit vorher berechnete Offsets gültig bleiben.
  patches.sort((a, b) => b.start - a.start);
  let text = originalRawText;
  for (const { start, end, replacement } of patches) {
    text = text.slice(0, start) + replacement + text.slice(end);
  }

  // Sicherheitscheck: gepatchter Text muss weiterhin gültiges XML sein.
  const verifyDoc = new DOMParser().parseFromString(text, 'application/xml');
  if (verifyDoc.getElementsByTagName('parsererror').length) {
    throw new Error('Export abgebrochen: gepatchte X31-Datei ist kein gültiges XML mehr (interner Fehler beim Patchen).');
  }

  return { patchedText: text, changedCount: patches.length };
}
