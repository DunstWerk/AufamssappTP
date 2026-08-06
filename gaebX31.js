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

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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
 * }>, categoryIdsPresent: Set<string> }}
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
  const categoryIdsPresent = new Set();
  walkBoQBody(bodyEl, {
    onCategoryEnter(category) {
      categoryIdsPresent.add(category.id);
    },
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

  return { x31Phase, itemsById, categoryIdsPresent };
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
 * Findet zu einem öffnenden Tag (Position von "<tagName" im Text) die Position
 * des ZUGEHÖRIGEN schließenden Tags ("</tagName>"), auch wenn gleichnamige Tags
 * dazwischen verschachtelt sind (balanced-tag scan). Beschränkt auf die drei
 * bekannten, nie selbstschließenden Container-Tags BoQCtgy/BoQBody/Itemlist —
 * kein allgemeiner XML-Parser, sondern ein bewusst enges Hilfsmittel für den
 * Export-Insert-Pfad.
 */
function findMatchingClose(text, tagName, openTagStart) {
  const openNeedle = `<${tagName}`;
  if (text.slice(openTagStart, openTagStart + openNeedle.length) !== openNeedle) {
    throw new Error(`findMatchingClose: an Position ${openTagStart} beginnt kein <${tagName}>`);
  }
  const closeNeedle = `</${tagName}>`;
  const firstTagEnd = text.indexOf('>', openTagStart);
  if (firstTagEnd === -1) throw new Error(`Unvollständiges <${tagName}>-Tag im X31-Text.`);
  let depth = 1;
  let pos = firstTagEnd + 1;
  while (depth > 0) {
    const nextOpen = text.indexOf(openNeedle, pos);
    const nextClose = text.indexOf(closeNeedle, pos);
    if (nextClose === -1) {
      throw new Error(`Kein schließendes </${tagName}> gefunden (Tiefe ${depth}).`);
    }
    if (nextOpen !== -1 && nextOpen < nextClose) {
      const afterChar = text[nextOpen + openNeedle.length];
      if (afterChar === ' ' || afterChar === '>' || afterChar === '\t' || afterChar === '\n') {
        depth++;
      }
      pos = nextOpen + openNeedle.length;
      continue;
    }
    depth--;
    if (depth === 0) return nextClose;
    pos = nextClose + closeNeedle.length;
  }
}

function findCategoryOpenTag(rawText, catId) {
  const idx = rawText.indexOf(`<BoQCtgy ID="${catId}"`);
  if (idx === -1) throw new Error(`Kategorie mit ID "${catId}" nicht im X31-Text gefunden.`);
  return idx;
}

function findDirectBoQBodySpan(rawText, containerOpenTagStart, containerTagName) {
  const containerCloseIdx = findMatchingClose(rawText, containerTagName, containerOpenTagStart);
  const boqBodyOpenIdx = rawText.indexOf('<BoQBody>', containerOpenTagStart);
  if (boqBodyOpenIdx === -1 || boqBodyOpenIdx > containerCloseIdx) {
    throw new Error(`Kein direktes <BoQBody> innerhalb von <${containerTagName}> gefunden — Struktur weicht von der erwarteten Form ab, Einfügen abgebrochen.`);
  }
  const boqBodyCloseIdx = findMatchingClose(rawText, 'BoQBody', boqBodyOpenIdx);
  return { openIdx: boqBodyOpenIdx, closeIdx: boqBodyCloseIdx };
}

function findRootBoQBodySpan(rawText) {
  const boqOpenIdx = rawText.indexOf('<BoQ ');
  if (boqOpenIdx === -1) throw new Error('Kein <BoQ>-Element im X31-Text gefunden.');
  return findDirectBoQBodySpan(rawText, boqOpenIdx, 'BoQ');
}

/**
 * Sucht innerhalb eines BoQBody-Spans nach einem DIREKTEN <Itemlist>-Kind.
 * Sicherheitsnetz gegen die (laut bisherigen Beispieldateien nicht auftretende)
 * Mehrdeutigkeit, dass eine verschachtelte Unterkategorie vor der eigenen
 * Itemlist im Text steht: wird ein <BoQCtgy> VOR der gefundenen <Itemlist>
 * innerhalb desselben Spans entdeckt, wird sicherheitshalber abgebrochen statt
 * an der falschen Stelle einzufügen.
 */
function findDirectItemlistSpan(rawText, boqBodySpan) {
  const itemlistIdx = rawText.indexOf('<Itemlist>', boqBodySpan.openIdx);
  if (itemlistIdx === -1 || itemlistIdx > boqBodySpan.closeIdx) return null;
  const nestedCtgyIdx = rawText.indexOf('<BoQCtgy', boqBodySpan.openIdx);
  if (nestedCtgyIdx !== -1 && nestedCtgyIdx < itemlistIdx) {
    throw new Error('Mehrdeutige Struktur (Unterkategorie vor Itemlist) — automatisches Einfügen an dieser Stelle abgebrochen.');
  }
  const closeIdx = findMatchingClose(rawText, 'Itemlist', itemlistIdx);
  return { openIdx: itemlistIdx, closeIdx };
}

function formatQty3(value) {
  return value.toFixed(3);
}

/**
 * Klont die Feldbreiten eines vorhandenen "blank-skeleton"-Rows und ersetzt
 * Wert- und Referenzfeld. Für Positionen OHNE eigenen Vorlage-Row (Insert-Pfad),
 * siehe Modul-Kommentar zu REB_FORMAT_VALIDATED — genauso unverifiziert wie der
 * Patch-Pfad, hier zusätzlich auch der Referenzteil frei erfunden (fortlaufende
 * Nummer, siehe nextSyntheticRefCode), nicht aus der Position selbst abgeleitet,
 * da sich empirisch zeigte, dass der Referenzcode in den vorhandenen Zeilen NICHT
 * mit der LV-Item-/Index-Nummer übereinstimmt, sondern eher eine fortlaufende
 * Zeilennummer des Mengenermittlungsblatts ist.
 */
function buildSyntheticRow(effectiveQty, templateRow, refCode) {
  const valueStr = formatQty3(effectiveQty);
  if (!templateRow) return `${valueStr}=`;
  const m = templateRow.match(/^(\s*)(\d+)(\s*=\s*)(\d{4}[A-Za-z]\d)(\s*)$/);
  if (!m) return `${valueStr}=`;
  const [, leadSpace, numField, midSep, refField, trailSpace] = m;
  const fieldWidth = leadSpace.length + numField.length;
  const newNumField = valueStr.padStart(fieldWidth, ' ').slice(-Math.max(fieldWidth, valueStr.length));
  const newRefField = refCode.padStart(refField.length, '0').slice(-Math.max(refField.length, refCode.length));
  return newNumField + midSep + newRefField + trailSpace;
}

/**
 * Findet ein beliebiges vorhandenes 'blank-skeleton'-Row als Breiten-Vorlage
 * und die höchste bereits verwendete 4-stellige Referenznummer (für neue,
 * fortlaufend nummerierte Zeilen — siehe buildSyntheticRow-Kommentar).
 */
function findRowTemplateAndNextRefCode(x31ItemsById) {
  let templateRow = null;
  let maxRef = 0;
  for (const entry of x31ItemsById.values()) {
    if (!entry.rawRow) continue;
    if (!templateRow && entry.formelKind === 'blank-skeleton') templateRow = entry.rawRow;
    const m = entry.rawRow.match(/(\d{4})[A-Za-z]\d\s*$/);
    if (m) maxRef = Math.max(maxRef, parseInt(m[1], 10));
  }
  return { templateRow, nextRefCode: maxRef + 10 };
}

function buildItemFragment(pos, row) {
  return (
    `<Item ID="${escapeXml(pos.id)}" RNoPart="${escapeXml(pos.rNoPart)}">` +
    `<QtyDeterm><QDetermItem>` +
    `<CtlgAssign><CtlgID>idDIN276-08</CtlgID><CtlgCode/></CtlgAssign>` +
    `<QTakeoff Row="${escapeXml(row)}"/>` +
    `</QDetermItem></QtyDeterm></Item>`
  );
}

function buildCategoryChainFragment(missingLevels, itemFragmentXml) {
  let inner = `<Itemlist>${itemFragmentXml}</Itemlist>`;
  for (let i = missingLevels.length - 1; i >= 0; i--) {
    const lvl = missingLevels[i];
    inner =
      `<BoQCtgy ID="${escapeXml(lvl.id)}" RNoPart="${escapeXml(lvl.rNoPart)}">` +
      `<LblTx><p><span>${escapeXml(lvl.label)}</span></p></LblTx>` +
      `<BoQBody>${inner}</BoQBody></BoQCtgy>`;
  }
  return inner;
}

/**
 * Gruppiert Insert-Positionen nach ihrer tatsächlichen Einfügestelle (Anker-
 * Kategorie + fehlende Ahnenkette), gegen die UNVERÄNDERTE, in der X31
 * tatsächlich vorhandene Kategorie-Menge (nicht progressiv mutiert — siehe
 * unten, warum das wichtig ist). Positionen mit identischer fehlender Kette
 * (z.B. zwei neue Positionen unter derselben, in der X31 fehlenden
 * Unterkategorie) bekommen denselben Gruppenschlüssel und landen automatisch
 * in EINER gemeinsamen Gruppe, damit die fehlende Kategorie nur EINMAL neu
 * angelegt wird. Das war ein realer, vom Nutzer beim ORCA-Reimport gefundener
 * Bug: zwei Positionen unter derselben fehlenden Kategorie erzeugten zwei
 * separate <BoQCtgy>-Knoten mit identischer ID, weil die vorherige Version
 * die Kategorie nach der ERSTEN Position bereits als "vorhanden" markierte —
 * wodurch die ZWEITE Position (mit exakt derselben Kette) einen anderen,
 * flacheren Ankerpunkt berechnete, statt in dieselbe Gruppe zu fallen.
 *
 * Seltener, nicht vollständig gelöster Fall: zwei Positionen benötigen
 * dieselbe fehlende Kategorie auf UNTERSCHIEDLICHER Tiefe (eine braucht nur
 * [katX], eine andere [katX, katY]) — das ergibt zwei verschiedene Gruppen,
 * die beide katX neu anlegen würden. Wird unten separat erkannt: alle bis auf
 * die erste (kürzeste) betroffene Gruppe werden dann mit klarer Fehlermeldung
 * übersprungen, statt eine doppelte Kategorie zu riskieren.
 */
function groupInsertPositions(insertPositions, categoryIdsPresentOriginal) {
  const groups = new Map();

  for (const pos of insertPositions) {
    const ancestorPath = pos.ancestorPath || [];
    let matchedDepth = 0;
    for (const anc of ancestorPath) {
      if (categoryIdsPresentOriginal.has(anc.id)) matchedDepth++;
      else break;
    }
    const missingLevels = ancestorPath.slice(matchedDepth);
    const anchorId = matchedDepth === 0 ? null : ancestorPath[matchedDepth - 1].id;
    const key = anchorId + '>' + missingLevels.map((l) => l.id).join('>');
    if (!groups.has(key)) {
      groups.set(key, { anchorId, missingLevels, items: [] });
    }
    groups.get(key).items.push(pos);
  }

  const sorted = [...groups.values()].sort((a, b) => a.missingLevels.length - b.missingLevels.length);

  // Sicherheitsnetz gegen den selteneren Tiefen-Überschneidungsfall: sobald
  // eine (kürzere) Gruppe eine Kategorie-ID neu anlegt, darf keine weitere
  // Gruppe dieselbe ID ebenfalls neu anlegen wollen.
  const claimedNewCategoryIds = new Set();
  const safeGroups = [];
  for (const group of sorted) {
    const collision = group.missingLevels.find((lvl) => claimedNewCategoryIds.has(lvl.id));
    if (collision) {
      group.skipReason = `Kategorie "${collision.id}" wird bereits von einer anderen Position in diesem Export neu angelegt (mehrstufige Tiefen-Überschneidung, nicht unterstützt).`;
      safeGroups.push(group);
      continue;
    }
    for (const lvl of group.missingLevels) claimedNewCategoryIds.add(lvl.id);
    safeGroups.push(group);
  }
  return safeGroups;
}

/**
 * Ermittelt für eine Gruppe von Positionen ohne vorhandenen X31-Eintrag, WO im
 * Rohtext die neuen `<Item>`-Knoten (und ggf. fehlende Vorfahren-Kategorien)
 * eingefügt werden müssen. Wirft eine aussagekräftige Exception statt zu
 * raten, wenn die Struktur nicht eindeutig genug ist (siehe
 * findDirectItemlistSpan) — der Aufrufer lässt diese Gruppe dann bewusst aus
 * dem Export aus, statt riskant zu patchen.
 */
function planInsertion(rawText, group) {
  const containerSpan =
    group.anchorId == null
      ? findRootBoQBodySpan(rawText)
      : findDirectBoQBodySpan(rawText, findCategoryOpenTag(rawText, group.anchorId), 'BoQCtgy');

  if (group.missingLevels.length === 0) {
    const itemlistSpan = findDirectItemlistSpan(rawText, containerSpan);
    return { itemlistSpan, containerSpan, missing: [] };
  }
  return { itemlistSpan: null, containerSpan, missing: group.missingLevels };
}

/**
 * Chirurgischer Export: patcht bestehende Row-Attributwerte UND fügt bei Bedarf
 * neue `<Item>`-Knoten (ggf. mit fehlenden Vorfahren-Kategorien) ein — für
 * Positionen, die geprüft/gemessen wurden, aber noch keinen X31-Eintrag hatten
 * (siehe Kontext: ORCA exportiert nur Positionen mit bereits begonnener
 * Mengenermittlung). Alle unberührten Bytes bleiben exakt erhalten — kein
 * DOMParser/XMLSerializer-Rückweg für das Gesamtdokument, nur die jeweils neu
 * erzeugten Fragmente werden als Text gespleißt.
 *
 * @param {string} originalRawText - unveränderter Text der importierten X31
 * @param {Array<{id:string, effectiveQty:number, multiRowWarning:boolean,
 *   origRawRow:string|null, rNoPart?:string, ancestorPath?:Array}>} positions
 *   origRawRow === null bedeutet: kein vorhandener Eintrag -> Insert-Pfad,
 *   dafür müssen rNoPart und ancestorPath gesetzt sein.
 * @param {{ itemsById: Map, categoryIdsPresent: Set<string> }} x31ParseResult
 * @returns {{ patchedText:string, updatedCount:number, insertedCount:number, skipped: Array<{id:string, reason:string}> }}
 */
export function patchX31(originalRawText, positions, x31ParseResult) {
  const patches = [];
  const skipped = [];
  let updatedCount = 0;
  let insertedCount = 0;
  let nextRefCode = null;
  let templateRow = null;

  const insertPositions = [];
  for (const pos of positions) {
    if (pos.origRawRow != null) {
      try {
        const { start, end } = locateRowAttributeOffsets(originalRawText, pos.id, {
          useLastQTakeoff: pos.multiRowWarning,
        });
        patches.push({ start, end, replacement: encodeFormel91(pos.effectiveQty, pos.origRawRow) });
        updatedCount++;
      } catch (err) {
        skipped.push({ id: pos.id, reason: err.message });
      }
    } else {
      insertPositions.push(pos);
    }
  }

  if (insertPositions.length) {
    const groups = groupInsertPositions(insertPositions, x31ParseResult.categoryIdsPresent);
    for (const group of groups) {
      if (group.skipReason) {
        for (const pos of group.items) skipped.push({ id: pos.id, reason: group.skipReason });
        continue;
      }
      try {
        const plan = planInsertion(originalRawText, group);
        const itemsXml = group.items
          .map((pos) => {
            if (nextRefCode === null) {
              const found = findRowTemplateAndNextRefCode(x31ParseResult.itemsById);
              templateRow = found.templateRow;
              nextRefCode = found.nextRefCode;
            }
            const refCode = String(nextRefCode).padStart(4, '0') + 'A0';
            const row = buildSyntheticRow(pos.effectiveQty, templateRow, refCode);
            nextRefCode += 10;
            return buildItemFragment(pos, row);
          })
          .join('');

        if (plan.missing.length === 0 && plan.itemlistSpan) {
          patches.push({ start: plan.itemlistSpan.closeIdx, end: plan.itemlistSpan.closeIdx, replacement: itemsXml });
        } else if (plan.missing.length === 0) {
          const wrapped = `<Itemlist>${itemsXml}</Itemlist>`;
          patches.push({ start: plan.containerSpan.closeIdx, end: plan.containerSpan.closeIdx, replacement: wrapped });
        } else {
          const fragment = buildCategoryChainFragment(plan.missing, itemsXml);
          patches.push({ start: plan.containerSpan.closeIdx, end: plan.containerSpan.closeIdx, replacement: fragment });
        }
        insertedCount += group.items.length;
      } catch (err) {
        for (const pos of group.items) skipped.push({ id: pos.id, reason: err.message });
      }
    }
  }

  // Von hinten nach vorne anwenden, damit vorher berechnete Offsets gültig bleiben.
  patches.sort((a, b) => b.start - a.start);
  let text = originalRawText;
  for (const { start, end, replacement } of patches) {
    text = text.slice(0, start) + replacement + text.slice(end);
  }

  // Sicherheitscheck: gepatchter/erweiterter Text muss weiterhin gültiges XML sein.
  const verifyDoc = new DOMParser().parseFromString(text, 'application/xml');
  if (verifyDoc.getElementsByTagName('parsererror').length) {
    throw new Error('Export abgebrochen: gepatchte X31-Datei ist kein gültiges XML mehr (interner Fehler beim Patchen/Einfügen).');
  }

  return { patchedText: text, updatedCount, insertedCount, skipped };
}
