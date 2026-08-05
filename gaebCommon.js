// Gemeinsame Helfer für GAEB DA XML (LV-Phasen X83/X85/X86 und Aufmaß X31).
// Reine Lesehilfen — kein Schreiben/Serialisieren hier (siehe gaebX31.js für den
// chirurgischen Text-Patch-Export).

export const FAKTOR = Object.freeze({ geliefert: 0.8, montiert: 1.0 });

export function round2(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Parst GAEB-XML-Text und wirft bei einem Parserfehler eine aussagekräftige
 * Exception (vom Aufrufer als Toast anzuzeigen — nie stillschweigend scheitern).
 */
export function parseGaebXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) {
    throw new Error('GAEB-Datei konnte nicht als XML gelesen werden: ' + err.textContent.slice(0, 300));
  }
  if (!doc.documentElement || doc.documentElement.localName !== 'GAEB') {
    throw new Error('Datei ist kein gültiges GAEB-DA-XML-Dokument (Root-Element ist nicht <GAEB>).');
  }
  return doc;
}

/**
 * Erkennt die GAEB-Austauschphase (z.B. '83','85','86','31') primär über den
 * XML-Namespace (.../DA<NN>/<version>), sekundär über ein beliebiges <DP>-Element
 * irgendwo im Dokument (die Position von <DP> unterscheidet sich je Phase:
 * bei LV-Dateien unter <Award>, bei X31 direkt unter <QtyDeterm>).
 */
export function detectGaebPhase(doc) {
  const ns = doc.documentElement.namespaceURI || '';
  const m = ns.match(/\/DA(\d{2})\//i);
  if (m) return m[1];
  const dpEls = doc.getElementsByTagName('DP');
  if (dpEls.length) return dpEls[0].textContent.trim();
  return null;
}

function localName(el) {
  return el.localName || el.tagName;
}

/** Direkte Kind-Elemente mit gegebenem lokalen Tag-Namen (namespace-robust). */
export function directChildren(el, name) {
  if (!el) return [];
  return Array.from(el.children).filter((c) => localName(c) === name);
}

/** Erstes direktes Kind-Element mit gegebenem lokalen Tag-Namen, oder null. */
export function firstDirectChild(el, name) {
  if (!el) return null;
  for (const c of el.children) {
    if (localName(c) === name) return c;
  }
  return null;
}

/**
 * Steigt eine Kette von Tag-Namen ab (jeweils erstes direktes Kind) und gibt das
 * letzte gefundene Element zurück, oder null falls der Pfad nicht existiert.
 */
export function descend(el, path) {
  let cur = el;
  for (const name of path) {
    cur = firstDirectChild(cur, name);
    if (!cur) return null;
  }
  return cur;
}

/**
 * Reduziert GAEB-Rich-Text (<p>/<span>/<ul>/<li>) zu Klartext mit Zeilenumbrüchen.
 * Bewusste Vereinfachung: keine HTML-Rekonstruktion (kein Fett/Kursiv), da für die
 * Aufmaßprüfung auf dem Tablet nicht nötig und ein Sanitizer für aus der Fremddatei
 * stammendes Markup so unnötig wird.
 */
export function extractPlainText(containerEl) {
  if (!containerEl) return '';
  const lines = [];
  const walk = (el, listPrefix) => {
    for (const child of el.children) {
      const name = localName(child);
      if (name === 'p') {
        const text = collectInlineText(child);
        lines.push((listPrefix || '') + text);
      } else if (name === 'ul' || name === 'ol') {
        for (const li of directChildren(child, 'li')) {
          walk(li, '- ');
        }
      } else if (name === 'li') {
        walk(child, listPrefix);
      } else {
        walk(child, listPrefix);
      }
    }
  };
  walk(containerEl, '');
  // Aufeinanderfolgende Leerzeilen (leere <p/> im Original) auf eine reduzieren.
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function collectInlineText(el) {
  let out = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      out += collectInlineText(node);
    }
  }
  return out;
}

/**
 * Liest die BoQBkdn-Ebenendefinitionen (Titel/Bereich/Item/Index o.ä.) aus einem
 * <BoQ>-Element. Reihenfolge im Dokument = Reihenfolge der Ebenen.
 */
export function readBkdnLevels(boqEl) {
  const nodes = boqEl.getElementsByTagName('BoQBkdn');
  const levels = [];
  for (const node of nodes) {
    const type = descend(node, ['Type'])?.textContent.trim() || '';
    const label = descend(node, ['LblBoQBkdn'])?.textContent.trim() || '';
    const lengthText = descend(node, ['Length'])?.textContent.trim();
    const numText = descend(node, ['Num'])?.textContent.trim();
    levels.push({
      type, // 'BoQLevel' | 'Item' | 'Index' | ...
      label,
      length: lengthText ? parseInt(lengthText, 10) : 0,
      numeric: numText ? numText.toLowerCase() === 'yes' : true,
    });
  }
  return levels;
}

function padPart(value, level) {
  const v = (value || '').trim();
  if (!level || level.numeric === false) return v;
  const len = level.length || v.length;
  return v.padStart(len, '0');
}

/**
 * Baut eine menschenlesbare Positionsnummer aus der Kategorie-Ahnenkette und der
 * Item-eigenen RNoPart. Reines Anzeige-/Komfortfeature — die tatsächliche
 * Zuordnung/Speicherung läuft immer über die stabile GAEB-ID, falls diese
 * Ableitung bei einem abweichenden Dokument nicht exakt aufgeht.
 */
export function buildPositionNumber(ancestorRNoParts, itemRNoPart, bkdnLevels, itemIndexSuffix) {
  try {
    const boqLevels = bkdnLevels.filter((l) => l.type === 'BoQLevel');
    const itemLevel = bkdnLevels.find((l) => l.type === 'Item');
    const usedLevels = boqLevels.slice(0, ancestorRNoParts.length);
    const parts = ancestorRNoParts.map((r, i) => padPart(r, usedLevels[i]));
    parts.push(padPart(itemRNoPart, itemLevel));
    let num = parts.join('.');
    if (itemIndexSuffix) num += itemIndexSuffix;
    return num;
  } catch (e) {
    console.warn('Positionsnummer konnte nicht gebildet werden, Fallback auf rohe RNoPart-Kette', e);
    return [...ancestorRNoParts, itemRNoPart].filter(Boolean).join('.');
  }
}

/**
 * Generischer Tiefendurchlauf über ein <BoQBody>-Element. Macht keine Annahme
 * über Verschachtelungstiefe oder Positionsanzahl — funktioniert unabhängig von
 * der Länge/Struktur des jeweiligen LVs.
 *
 * handlers:
 *   onCategoryEnter(category, stackDepth)
 *   onCategoryExit(category, stackDepth)
 *   onItem(itemEl, ancestorStack)      // <Item>
 *   onRemark(remarkEl, ancestorStack)  // <Remark>
 *   onPerfDescr(perfEl, ancestorStack) // <PerfDescr>
 */
export function walkBoQBody(bodyEl, handlers, ancestorStack = []) {
  if (!bodyEl) return;
  for (const child of Array.from(bodyEl.children)) {
    const name = localName(child);
    if (name === 'BoQCtgy') {
      const category = {
        id: child.getAttribute('ID'),
        rNoPart: child.getAttribute('RNoPart') || '',
        label: extractPlainText(descend(child, ['LblTx'])),
        el: child,
      };
      handlers.onCategoryEnter && handlers.onCategoryEnter(category, ancestorStack.length);
      const nestedBody = firstDirectChild(child, 'BoQBody');
      const nextStack = ancestorStack.concat([category.rNoPart]);
      if (nestedBody) walkBoQBody(nestedBody, handlers, nextStack);
      handlers.onCategoryExit && handlers.onCategoryExit(category, ancestorStack.length);
    } else if (name === 'Itemlist') {
      for (const row of Array.from(child.children)) {
        const rowName = localName(row);
        if (rowName === 'Item') {
          handlers.onItem && handlers.onItem(row, ancestorStack);
        } else if (rowName === 'Remark') {
          handlers.onRemark && handlers.onRemark(row, ancestorStack);
        } else if (rowName === 'PerfDescr') {
          handlers.onPerfDescr && handlers.onPerfDescr(row, ancestorStack);
        }
        // Unbekannte Zeilentypen werden bewusst ignoriert statt zu scheitern —
        // die App braucht nur Item/Remark/PerfDescr, alles andere ist optional.
      }
    }
    // Sonstige Kindelemente von BoQBody (sollten laut Schema nicht vorkommen)
    // werden ignoriert statt einen Fehler zu werfen.
  }
}
