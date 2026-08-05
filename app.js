import { parseLv } from './gaebLvParser.js';
import { parseX31, diffIdSets, patchX31, REB_FORMAT_VALIDATED } from './gaebX31.js';
import { FAKTOR, round2 } from './gaebCommon.js';
import * as db from './db.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let lvParseResult = null; // { lvPhase, bkdnLevels, flatRenderList, itemsById }
let x31ParseResult = null; // { x31Phase, itemsById }
let positionsById = new Map(); // id -> position record (persisted shape)
let lvOriginalBytes = null;
let x31OriginalBytes = null;
let x31OriginalText = null;

let appliedFilters = { geprueft: 'alle', klassifikation: 'alle', nurUnklar: false, nurNichtInX31: false };
let pendingFilters = { ...appliedFilters };

const rowElements = new Map(); // id -> DOM row element (für gezielte Updates)
let saveTimers = new Map(); // id -> debounce timer

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
init().catch((err) => {
  console.error(err);
  showToast('Fehler beim Start der App: ' + err.message, true);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service Worker Registrierung fehlgeschlagen', err));
  });
}

async function init() {
  const meta = await db.loadMeta();
  if (meta) {
    try {
      await loadStoredProject();
      showListScreen();
      return;
    } catch (err) {
      console.error('Gespeichertes Projekt konnte nicht geladen werden, zeige Import-Screen.', err);
      showToast('Gespeichertes Projekt konnte nicht geladen werden: ' + err.message, true);
    }
  }
  showImportScreen();
  wireImportScreen();
}

async function loadStoredProject() {
  const lvFile = await db.loadOriginalFile('lv');
  const x31File = await db.loadOriginalFile('x31');
  if (!lvFile || !x31File) throw new Error('Originaldateien fehlen im Speicher.');
  lvOriginalBytes = lvFile.bytes;
  x31OriginalBytes = x31File.bytes;
  const lvText = decodeBytes(lvFile.bytes, lvFile.encoding);
  x31OriginalText = decodeBytes(x31File.bytes, x31File.encoding);
  lvParseResult = parseLv(lvText);
  x31ParseResult = parseX31(x31OriginalText);
  positionsById = await db.loadAllPositions();
  document.getElementById('project-title').textContent = lvFile.filename;
  wireListScreen();
  renderBanner();
}

// ---------------------------------------------------------------------------
// Import-Screen
// ---------------------------------------------------------------------------
function showImportScreen() {
  document.getElementById('screen-import').hidden = false;
  document.getElementById('screen-list').hidden = true;
}

function showListScreen() {
  document.getElementById('screen-import').hidden = true;
  document.getElementById('screen-list').hidden = false;
  buildList();
  updateProgress();
}

function wireImportScreen() {
  const fileLv = document.getElementById('file-lv');
  const fileX31 = document.getElementById('file-x31');
  const btnImport = document.getElementById('btn-import');

  fileLv.addEventListener('change', () => {
    document.getElementById('name-lv').textContent = fileLv.files[0]?.name || 'Keine Datei gewählt';
    btnImport.disabled = !(fileLv.files[0] && fileX31.files[0]);
  });
  fileX31.addEventListener('change', () => {
    document.getElementById('name-x31').textContent = fileX31.files[0]?.name || 'Keine Datei gewählt';
    btnImport.disabled = !(fileLv.files[0] && fileX31.files[0]);
  });

  btnImport.addEventListener('click', async () => {
    btnImport.disabled = true;
    try {
      await handleImport(fileLv.files[0], fileX31.files[0]);
      showListScreen();
    } catch (err) {
      console.error(err);
      showToast('Import fehlgeschlagen: ' + err.message, true);
    } finally {
      btnImport.disabled = false;
    }
  });
}

function sniffEncoding(bytes) {
  const head = new TextDecoder('ascii').decode(bytes.slice(0, 200));
  const m = head.match(/encoding="([^"]+)"/i);
  return m ? m[1] : 'UTF-8';
}

function decodeBytes(bytes, encoding) {
  return new TextDecoder(encoding || 'UTF-8').decode(bytes);
}

async function handleImport(lvFile, x31File) {
  if (!lvFile || !x31File) throw new Error('Bitte beide Dateien auswählen.');
  const lvBuf = await lvFile.arrayBuffer();
  const x31Buf = await x31File.arrayBuffer();
  const lvEncoding = sniffEncoding(new Uint8Array(lvBuf));
  const x31Encoding = sniffEncoding(new Uint8Array(x31Buf));
  const lvText = decodeBytes(lvBuf, lvEncoding);
  const x31Text = decodeBytes(x31Buf, x31Encoding);

  const newLv = parseLv(lvText);
  const newX31 = parseX31(x31Text);
  const { idsOnlyInLv, idsOnlyInX31 } = diffIdSets(newLv.itemsById, newX31.itemsById);

  const existingPositions = await db.loadAllPositions();
  const isReimport = existingPositions.size > 0;
  const newLvIds = new Set(newLv.itemsById.keys());

  // Positionen, die es vorher gab, aber im neuen LV nicht mehr existieren:
  // als orphaned markieren, NICHT löschen (Erfassungen bleiben erhalten).
  let orphanedCount = 0;
  let addedCount = 0;
  for (const [id, rec] of existingPositions) {
    if (!newLvIds.has(id) && !rec.orphaned) {
      rec.orphaned = true;
      await db.savePosition(rec);
      orphanedCount++;
    }
  }

  for (const [id, lvItem] of newLv.itemsById) {
    if (existingPositions.has(id)) continue; // bestehende Erfassung unangetastet lassen
    const x31Entry = newX31.itemsById.get(id) || null;
    const record = {
      id,
      geprueft: false,
      menge: lvItem.qty ?? 0,
      mengeTouchedByUser: false,
      klassifikation: 'montiert',
      bemerkung: '',
      orphaned: false,
      origSnapshot: {
        qtySoll: lvItem.qty ?? null,
        x31ExistingQty: x31Entry ? x31Entry.existingQty : null,
        x31RawRow: x31Entry ? x31Entry.rawRow : null,
        multiRowWarning: x31Entry ? x31Entry.multiRowWarning : false,
        isRecognizedFormat: x31Entry ? x31Entry.isRecognizedFormat : false,
      },
    };
    await db.savePosition(record);
    addedCount++;
  }

  await db.saveOriginalFile('lv', lvFile.name, lvBuf, lvEncoding);
  await db.saveOriginalFile('x31', x31File.name, x31Buf, x31Encoding);
  await db.saveMeta({
    lvPhase: newLv.lvPhase,
    lvFilename: lvFile.name,
    x31Filename: x31File.name,
    lastImportAt: Date.now(),
    importDiagnostics: { idsOnlyInLv, idsOnlyInX31 },
  });

  lvOriginalBytes = lvBuf;
  x31OriginalBytes = x31Buf;
  x31OriginalText = x31Text;
  lvParseResult = newLv;
  x31ParseResult = newX31;
  positionsById = await db.loadAllPositions();
  document.getElementById('project-title').textContent = lvFile.name;
  wireListScreen();
  renderBanner();

  if (isReimport && (orphanedCount > 0 || addedCount > 0)) {
    showReimportDialog(addedCount, orphanedCount);
  }
}

function showReimportDialog(addedCount, orphanedCount) {
  const dlg = document.getElementById('reimport-dialog');
  document.getElementById('reimport-summary').textContent =
    `${addedCount} neue Position(en) hinzugekommen, ${orphanedCount} Position(en) sind im neuen LV nicht mehr vorhanden ` +
    `(bisherige Erfassungen bleiben lokal gespeichert, werden aber nicht mehr angezeigt oder exportiert).`;
  dlg.showModal();
}

// ---------------------------------------------------------------------------
// Listen-Screen: Aufbau + Rendering
// ---------------------------------------------------------------------------
let listScreenWired = false;
function wireListScreen() {
  if (listScreenWired) return;
  listScreenWired = true;

  document.getElementById('search-input').addEventListener('input', () => applyVisibility());

  document.getElementById('btn-filter').addEventListener('click', () => {
    const panel = document.getElementById('filter-panel');
    panel.hidden = !panel.hidden;
  });

  document.querySelectorAll('.segmented[data-filter]').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      const filterKey = seg.dataset.filter;
      pendingFilters[filterKey] = btn.dataset.value;
      seg.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('seg-active', b === btn));
    });
  });

  document.getElementById('filter-unklar').addEventListener('change', (e) => {
    pendingFilters.nurUnklar = e.target.checked;
  });
  document.getElementById('filter-nicht-in-x31').addEventListener('change', (e) => {
    pendingFilters.nurNichtInX31 = e.target.checked;
  });

  document.getElementById('btn-filter-apply').addEventListener('click', () => {
    appliedFilters = { ...pendingFilters };
    updateFilterBadge();
    applyVisibility();
    document.getElementById('filter-panel').hidden = true;
  });

  document.getElementById('btn-filter-reset').addEventListener('click', () => {
    appliedFilters = { geprueft: 'alle', klassifikation: 'alle', nurUnklar: false, nurNichtInX31: false };
    pendingFilters = { ...appliedFilters };
    document.querySelectorAll('.segmented[data-filter]').forEach((seg) => {
      seg.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('seg-active', b.dataset.value === 'alle'));
    });
    document.getElementById('filter-unklar').checked = false;
    document.getElementById('filter-nicht-in-x31').checked = false;
    updateFilterBadge();
    applyVisibility();
  });

  document.getElementById('btn-export').addEventListener('click', handleExport);
  document.getElementById('btn-reimport').addEventListener('click', () => {
    showImportScreen();
    wireImportScreen();
  });
  document.getElementById('reimport-ack').addEventListener('click', () => {
    document.getElementById('reimport-dialog').close();
  });

  const container = document.getElementById('list-container');
  container.addEventListener('click', onListClick);
  container.addEventListener('input', onListInput);
  container.addEventListener('change', onListChange);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function buildList() {
  const container = document.getElementById('list-container');
  container.innerHTML = '';
  rowElements.clear();

  const frag = document.createDocumentFragment();
  for (const entry of lvParseResult.flatRenderList) {
    let el;
    if (entry.type === 'category') {
      el = buildCategoryRow(entry);
    } else if (entry.type === 'remark') {
      el = buildInfoRow(entry, '');
    } else if (entry.type === 'perfDescr') {
      el = buildInfoRow(entry, entry.label);
    } else if (entry.type === 'item') {
      el = buildItemRow(entry);
      rowElements.set(entry.id, el);
    }
    if (el) frag.appendChild(el);
  }
  container.appendChild(frag);
  applyVisibility();
}

function buildCategoryRow(entry) {
  const div = document.createElement('div');
  div.className = `row row-category level-${entry.level}`;
  div.textContent = entry.label;
  return div;
}

function buildInfoRow(entry, label) {
  const div = document.createElement('div');
  div.className = `row row-info level-${entry.level}`;
  const text = label ? `${label}: ${entry.langtext}` : entry.langtext;
  div.textContent = text;
  return div;
}

const ROW_TEMPLATE = document.createElement('template');

function buildItemRow(entry) {
  const rec = positionsById.get(entry.id) || defaultRecord(entry);
  const x31Missing = !rec.origSnapshot || rec.origSnapshot.x31RawRow == null;
  const unklar = rec.origSnapshot && rec.origSnapshot.x31RawRow != null && !rec.origSnapshot.isRecognizedFormat;
  const multiRow = rec.origSnapshot && rec.origSnapshot.multiRowWarning;

  ROW_TEMPLATE.innerHTML = `
    <div class="row row-item" data-id="${entry.id}">
      <div class="row-main">
        <label class="row-check">
          <input type="checkbox" class="chk-geprueft" />
        </label>
        <div class="row-text">
          <div class="row-postext">
            <span class="pos-number">${escapeHtml(entry.positionNumber)}</span>
            <span class="pos-kurztext">${escapeHtml(entry.kurztext)}</span>
          </div>
          <div class="row-badges">
            ${entry.isLumpSum ? '<span class="tag">Pausch.</span>' : ''}
            ${x31Missing ? '<span class="tag tag-warn">neu in X31</span>' : ''}
            ${unklar ? '<span class="tag tag-warn">Formel unklar</span>' : ''}
            ${multiRow ? '<span class="tag tag-warn">mehrzeilig</span>' : ''}
          </div>
          <button type="button" class="toggle-link toggle-details">Details</button>
          <div class="langtext" hidden>${escapeHtml(entry.langtext)}</div>
        </div>
      </div>
      <div class="row-fields">
        <div class="field">
          <span class="field-label">Soll</span>
          <span class="soll-value">${entry.qty ?? ''} ${escapeHtml(entry.qu)}</span>
        </div>
        <div class="field">
          <span class="field-label">Menge</span>
          <input type="number" step="0.001" class="inp-menge" />
        </div>
        <div class="segmented klass-toggle" data-filter="row-klass">
          <button type="button" data-value="geliefert" class="seg-btn">Geliefert ×0,8</button>
          <button type="button" data-value="montiert" class="seg-btn">Montiert ×1,0</button>
        </div>
        <div class="field">
          <span class="field-label">Abrechnung</span>
          <span class="effective-value"></span>
        </div>
        <button type="button" class="icon-btn toggle-bemerkung" title="Bemerkung">📝</button>
      </div>
      <div class="bemerkung-body" hidden>
        <textarea class="inp-bemerkung" placeholder="Bemerkung…"></textarea>
      </div>
    </div>`.trim();

  const row = ROW_TEMPLATE.content.firstChild.cloneNode(true);
  applyRecordToRow(row, rec, entry);
  return row;
}

function defaultRecord(entry) {
  return {
    id: entry.id,
    geprueft: false,
    menge: entry.qty ?? 0,
    mengeTouchedByUser: false,
    klassifikation: 'montiert',
    bemerkung: '',
    orphaned: false,
    origSnapshot: { qtySoll: entry.qty ?? null, x31ExistingQty: null, x31RawRow: null, multiRowWarning: false, isRecognizedFormat: false },
  };
}

function applyRecordToRow(row, rec) {
  row.querySelector('.chk-geprueft').checked = !!rec.geprueft;
  row.classList.toggle('is-geprueft', !!rec.geprueft);
  row.querySelector('.inp-menge').value = rec.menge ?? '';
  row.querySelectorAll('.klass-toggle .seg-btn').forEach((b) => {
    b.classList.toggle('seg-active', b.dataset.value === rec.klassifikation);
  });
  const bemerkungBox = row.querySelector('.inp-bemerkung');
  bemerkungBox.value = rec.bemerkung || '';
  const toggleBtn = row.querySelector('.toggle-bemerkung');
  toggleBtn.classList.toggle('has-content', !!(rec.bemerkung && rec.bemerkung.trim()));
  row.querySelector('.bemerkung-body').hidden = !(rec.bemerkung && rec.bemerkung.trim());
  updateEffectiveValue(row, rec);
}

function updateEffectiveValue(row, rec) {
  const eff = round2((rec.menge || 0) * FAKTOR[rec.klassifikation]);
  row.querySelector('.effective-value').textContent = eff != null ? String(eff) : '';
}

// ---------------------------------------------------------------------------
// Event-Handler (gezielte DOM-Updates statt komplettem Re-Render — vermeidet,
// dass eine bearbeitete Zeile sofort verschwindet, wenn ein aktiver Filter
// dadurch nicht mehr erfüllt ist; Filter greifen erst wieder bei "Anwenden").
// ---------------------------------------------------------------------------
function onListClick(e) {
  const detailsBtn = e.target.closest('.toggle-details');
  if (detailsBtn) {
    const row = detailsBtn.closest('.row-item');
    const box = row.querySelector('.langtext');
    box.hidden = !box.hidden;
    detailsBtn.textContent = box.hidden ? 'Details' : 'Details ausblenden';
    return;
  }
  const bemerkungBtn = e.target.closest('.toggle-bemerkung');
  if (bemerkungBtn) {
    const row = bemerkungBtn.closest('.row-item');
    const box = row.querySelector('.bemerkung-body');
    box.hidden = !box.hidden;
    return;
  }
  const klassBtn = e.target.closest('.klass-toggle .seg-btn');
  if (klassBtn) {
    const row = klassBtn.closest('.row-item');
    const id = row.dataset.id;
    const rec = getOrCreateRecord(id);
    rec.klassifikation = klassBtn.dataset.value;
    row.querySelectorAll('.klass-toggle .seg-btn').forEach((b) => b.classList.toggle('seg-active', b === klassBtn));
    updateEffectiveValue(row, rec);
    scheduleSave(id, rec);
  }
}

function onListChange(e) {
  if (e.target.classList.contains('chk-geprueft')) {
    const row = e.target.closest('.row-item');
    const id = row.dataset.id;
    const rec = getOrCreateRecord(id);
    rec.geprueft = e.target.checked;
    row.classList.toggle('is-geprueft', rec.geprueft);
    scheduleSave(id, rec);
    updateProgress();
  }
}

function onListInput(e) {
  if (e.target.classList.contains('inp-menge')) {
    const row = e.target.closest('.row-item');
    const id = row.dataset.id;
    const rec = getOrCreateRecord(id);
    const val = parseFloat(e.target.value.replace(',', '.'));
    rec.menge = Number.isFinite(val) ? val : 0;
    rec.mengeTouchedByUser = true;
    updateEffectiveValue(row, rec);
    scheduleSave(id, rec);
  } else if (e.target.classList.contains('inp-bemerkung')) {
    const row = e.target.closest('.row-item');
    const id = row.dataset.id;
    const rec = getOrCreateRecord(id);
    rec.bemerkung = e.target.value;
    row.querySelector('.toggle-bemerkung').classList.toggle('has-content', !!e.target.value.trim());
    scheduleSave(id, rec);
  }
}

function getOrCreateRecord(id) {
  let rec = positionsById.get(id);
  if (!rec) {
    const entry = lvParseResult.itemsById.get(id);
    rec = defaultRecord(entry);
    positionsById.set(id, rec);
  }
  return rec;
}

function scheduleSave(id, rec) {
  clearTimeout(saveTimers.get(id));
  saveTimers.set(
    id,
    setTimeout(async () => {
      try {
        await db.savePosition(rec);
      } catch (err) {
        console.error(err);
        showToast('Speichern fehlgeschlagen: ' + err.message, true);
      }
    }, 250)
  );
}

// ---------------------------------------------------------------------------
// Fortschritt / Filter-Badge / Sichtbarkeit
// ---------------------------------------------------------------------------
function updateProgress() {
  let total = 0;
  let done = 0;
  for (const entry of lvParseResult.flatRenderList) {
    if (entry.type !== 'item') continue;
    total++;
    const rec = positionsById.get(entry.id);
    if (rec && rec.geprueft) done++;
  }
  document.getElementById('progress-label').textContent = `${done} / ${total} geprüft`;
  const pct = total ? Math.round((done / total) * 100) : 0;
  document.getElementById('progress-fill').style.width = pct + '%';
}

function updateFilterBadge() {
  let count = 0;
  if (appliedFilters.geprueft !== 'alle') count++;
  if (appliedFilters.klassifikation !== 'alle') count++;
  if (appliedFilters.nurUnklar) count++;
  if (appliedFilters.nurNichtInX31) count++;
  const badge = document.getElementById('filter-badge');
  badge.textContent = String(count);
  badge.hidden = count === 0;
}

function matchesFilters(entry, rec) {
  if (appliedFilters.geprueft === 'ja' && !rec.geprueft) return false;
  if (appliedFilters.geprueft === 'nein' && rec.geprueft) return false;
  if (appliedFilters.klassifikation !== 'alle' && rec.klassifikation !== appliedFilters.klassifikation) return false;
  if (appliedFilters.nurUnklar) {
    const unklar = rec.origSnapshot && rec.origSnapshot.x31RawRow != null && !rec.origSnapshot.isRecognizedFormat;
    if (!unklar) return false;
  }
  if (appliedFilters.nurNichtInX31) {
    const missing = !rec.origSnapshot || rec.origSnapshot.x31RawRow == null;
    if (!missing) return false;
  }
  return true;
}

function matchesSearch(entry, rec, term) {
  if (!term) return true;
  const haystack = [entry.positionNumber, entry.kurztext, entry.langtext, rec.bemerkung]
    .filter(Boolean)
    .join(' \n ')
    .toLowerCase();
  return haystack.includes(term);
}

function applyVisibility() {
  const term = document.getElementById('search-input').value.trim().toLowerCase();
  for (const entry of lvParseResult.flatRenderList) {
    if (entry.type !== 'item') continue;
    const row = rowElements.get(entry.id);
    if (!row) continue;
    const rec = positionsById.get(entry.id) || defaultRecord(entry);
    const visible = matchesFilters(entry, rec) && matchesSearch(entry, rec, term);
    row.hidden = !visible;
  }
}

function renderBanner() {
  db.loadMeta().then((meta) => {
    const banner = document.getElementById('banner');
    if (!meta || !meta.importDiagnostics) {
      banner.hidden = true;
      return;
    }
    const { idsOnlyInLv, idsOnlyInX31 } = meta.importDiagnostics;
    const parts = [];
    if (idsOnlyInLv && idsOnlyInLv.length) {
      parts.push(`${idsOnlyInLv.length} Position(en) haben noch keinen Eintrag in der importierten X31 (normal bei ORCA — nur begonnene Mengenermittlungen werden exportiert). Werden beim Export bei Bedarf neu in die X31 eingefügt, sobald sie geprüft sind (siehe Filter "neu in X31").`);
    }
    if (idsOnlyInX31 && idsOnlyInX31.length) {
      parts.push(`${idsOnlyInX31.length} Eintrag/Einträge in der X31 haben keine passende Position im LV und werden ignoriert.`);
    }
    if (parts.length) {
      banner.textContent = parts.join(' ');
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
async function handleExport() {
  const btn = document.getElementById('btn-export');
  btn.disabled = true;
  try {
    const toExport = [];
    for (const entry of lvParseResult.flatRenderList) {
      if (entry.type !== 'item') continue;
      const rec = positionsById.get(entry.id);
      if (!rec || !rec.geprueft) continue;
      const effectiveQty = round2((rec.menge || 0) * FAKTOR[rec.klassifikation]);
      const hasAnchor = rec.origSnapshot && rec.origSnapshot.x31RawRow != null;
      toExport.push({
        id: entry.id,
        effectiveQty,
        origRawRow: hasAnchor ? rec.origSnapshot.x31RawRow : null,
        multiRowWarning: rec.origSnapshot ? rec.origSnapshot.multiRowWarning : false,
        // Nur für den Insert-Pfad gebraucht (kein X31-Eintrag vorhanden):
        rNoPart: entry.rNoPart,
        ancestorPath: entry.ancestorPath,
      });
    }

    if (toExport.length === 0) {
      showToast('Keine geprüften Positionen zum Exportieren vorhanden.', true);
      return;
    }

    const { patchedText, updatedCount, insertedCount, skipped } = patchX31(x31OriginalText, toExport, x31ParseResult);
    if (updatedCount + insertedCount === 0) {
      showToast('Export abgebrochen: keine der geprüften Positionen konnte verarbeitet werden — ' + skipped.map((s) => s.reason).join(' '), true);
      return;
    }
    downloadText(patchedText, buildExportFilename());

    const parts = [];
    if (updatedCount) parts.push(`${updatedCount} Position(en) aktualisiert`);
    if (insertedCount) parts.push(`${insertedCount} Position(en) neu in die X31 eingefügt`);
    let msg = `Export erstellt: ${parts.join(', ')}.`;
    if (skipped.length) {
      msg += ` ${skipped.length} Position(en) konnten nicht verarbeitet werden und fehlen im Export (${skipped.map((s) => s.id).join(', ')}).`;
    }
    if (!REB_FORMAT_VALIDATED) {
      msg += ' Hinweis: Exportformat der Mengenermittlung ist vorläufig — bitte Ergebnis nach Re-Import in ORCA AVA prüfen.';
    }
    showToast(msg, skipped.length > 0);
  } catch (err) {
    console.error(err);
    showToast('Export fehlgeschlagen: ' + err.message, true);
  } finally {
    btn.disabled = false;
  }
}

function buildExportFilename() {
  const meta = { x31Filename: document.getElementById('project-title').textContent };
  const base = (meta.x31Filename || 'Aufmass').replace(/\.[^.]+$/, '');
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${base}_Aufmass_${date}.X31`;
}

function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
let toastTimer = null;
function showToast(message, isError) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.toggle('toast-error', !!isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, isError ? 6000 : 4000);
}
