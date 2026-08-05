// Parser für ein GAEB-LV (X83/X85/X86) — reine Lesefunktion.
// Baut eine flache, in Dokumentreihenfolge sortierte Renderliste (Kategorien,
// Items, Remarks, Ausführungsbeschreibungen) plus eine ID->Item-Map.

import {
  parseGaebXml,
  detectGaebPhase,
  readBkdnLevels,
  walkBoQBody,
  buildPositionNumber,
  extractPlainText,
  descend,
  firstDirectChild,
  directChildren,
} from './gaebCommon.js';

const SUPPORTED_PHASES = ['83', '85', '86'];

function findBoQEl(doc) {
  const boqEls = doc.getElementsByTagName('BoQ');
  if (!boqEls.length) throw new Error('Kein <BoQ>-Element in der LV-Datei gefunden.');
  return boqEls[0];
}

function findBoQBody(boqEl) {
  // Direktes BoQBody-Kind von <BoQ> (nicht die verschachtelten BoQBody unter BoQCtgy).
  const body = firstDirectChild(boqEl, 'BoQBody');
  if (!body) throw new Error('Kein <BoQBody> in der LV-Datei gefunden.');
  return body;
}

function extractItemTexts(itemEl) {
  const kurztextEl = descend(itemEl, ['Description', 'CompleteText', 'OutlineText', 'OutlTxt', 'TextOutlTxt']);
  const langtextEl = descend(itemEl, ['Description', 'CompleteText', 'DetailTxt', 'Text']);
  return {
    kurztext: extractPlainText(kurztextEl),
    langtext: extractPlainText(langtextEl),
  };
}

/**
 * @param {string} text - Roher XML-Text der LV-Datei
 * @returns {{lvPhase:string, bkdnLevels:Array, flatRenderList:Array, itemsById:Map}}
 */
export function parseLv(text) {
  const doc = parseGaebXml(text);
  const lvPhase = detectGaebPhase(doc);
  if (lvPhase && !SUPPORTED_PHASES.includes(lvPhase)) {
    console.warn(`Unerwartete GAEB-Phase "${lvPhase}" für eine LV-Datei (erwartet: ${SUPPORTED_PHASES.join('/')}). Import wird trotzdem versucht.`);
  }

  const boqEl = findBoQEl(doc);
  const bkdnLevels = readBkdnLevels(boqEl);
  const bodyEl = findBoQBody(boqEl);

  const flatRenderList = [];
  const itemsById = new Map();
  let sortIndex = 0;

  walkBoQBody(bodyEl, {
    onCategoryEnter(category, depth) {
      flatRenderList.push({
        type: 'category',
        id: category.id,
        level: depth,
        label: category.label,
        sortIndex: sortIndex++,
      });
    },
    onItem(itemEl, ancestorStack) {
      const id = itemEl.getAttribute('ID');
      const rNoPart = itemEl.getAttribute('RNoPart') || '';
      const indexAttr = itemEl.getAttribute('Index') || '';
      const positionNumber = buildPositionNumber(
        ancestorStack.map((a) => a.rNoPart),
        rNoPart,
        bkdnLevels,
        indexAttr
      );
      const { kurztext, langtext } = extractItemTexts(itemEl);
      const qtyText = firstDirectChild(itemEl, 'Qty')?.textContent.trim();
      const quText = firstDirectChild(itemEl, 'QU')?.textContent.trim();
      const upText = firstDirectChild(itemEl, 'UP')?.textContent.trim();
      const lumpSumText = firstDirectChild(itemEl, 'LumpSumItem')?.textContent.trim();

      const entry = {
        type: 'item',
        id,
        rNoPart,
        indexSuffix: indexAttr,
        level: ancestorStack.length,
        positionNumber,
        ancestorPath: ancestorStack.map((a) => ({ id: a.id, rNoPart: a.rNoPart, label: a.label })),
        kurztext,
        langtext,
        qty: qtyText !== undefined && qtyText !== '' ? parseFloat(qtyText) : null,
        qu: quText || '',
        up: upText !== undefined && upText !== '' ? parseFloat(upText) : null,
        isLumpSum: (lumpSumText || '').toLowerCase() === 'yes',
        sortIndex: sortIndex++,
      };
      flatRenderList.push(entry);
      itemsById.set(id, entry);
    },
    onRemark(remarkEl, ancestorStack) {
      const id = remarkEl.getAttribute('ID');
      const text = extractPlainText(descend(remarkEl, ['Description', 'CompleteText', 'DetailTxt', 'Text']));
      flatRenderList.push({
        type: 'remark',
        id,
        level: ancestorStack.length,
        langtext: text,
        sortIndex: sortIndex++,
      });
    },
    onPerfDescr(perfEl, ancestorStack) {
      const id = perfEl.getAttribute('ID');
      const label = firstDirectChild(perfEl, 'PerfLbl')?.textContent.trim() || '';
      const text = extractPlainText(descend(perfEl, ['Description', 'CompleteText', 'DetailTxt', 'Text']));
      flatRenderList.push({
        type: 'perfDescr',
        id,
        level: ancestorStack.length,
        label,
        langtext: text,
        sortIndex: sortIndex++,
      });
    },
  });

  if (itemsById.size === 0) {
    throw new Error('In der LV-Datei wurden keine Positionen (<Item>) gefunden.');
  }

  return { lvPhase, bkdnLevels, flatRenderList, itemsById };
}
