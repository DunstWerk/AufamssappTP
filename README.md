# Aufmaßprüfung GAEB

Offline-fähige Web-App zur Aufmaßprüfung auf der Baustelle, auf Basis von
GAEB-Dateien aus ORCA AVA: LV (X83/X85/X86) + Aufmaß-Datei (X31) importieren,
Positionen abhaken und Mengen erfassen, aktualisierte X31 wieder exportieren.

Reines Client-JS, kein Backend, kein Build-Step, keine Frameworks/Libraries.
Läuft direkt von jedem statischen Webserver oder GitHub Pages und funktioniert
nach dem ersten Laden komplett offline (Service Worker + IndexedDB).

## Starten

```bash
node test/serve.mjs   # startet einen einfachen Static-Server auf Port 8420
```

Dann `http://127.0.0.1:8420` im Browser öffnen. Für die Produktivnutzung
reicht jeder beliebige statische Webserver (z.B. GitHub Pages) — dafür muss
das Repo öffentlich sein (kostenloses GitHub Pages funktioniert nicht bei
privaten Repos).

## Nutzung

1. LV-Datei (X83/X85/X86) und die dazugehörige Aufmaß-Datei (X31) aus ORCA AVA
   importieren.
2. Positionen durchgehen: Geprüft-Häkchen setzen, Menge erfassen (initial aus
   dem LV-Soll übernommen, frei editierbar), zwischen "Geliefert ×0,8" und
   "Montiert ×1,0" wählen, optional Bemerkung hinterlegen.
3. Alles wird automatisch (debounced) lokal in IndexedDB gespeichert — auch
   nach Reload/Offline/Neustart bleibt der Stand erhalten, ohne erneuten Import.
4. "Exportieren" erzeugt eine aktualisierte X31-Datei zum Download, die wieder
   in ORCA AVA eingelesen werden kann.
5. "Excel-Sicherung" erzeugt zusätzlich eine CSV-Datei (öffnet direkt in Excel,
   deutsches Format: Semikolon-getrennt, Komma als Dezimaltrennzeichen, UTF-8
   mit BOM) mit allen Positionen (Soll, erfasste Menge, Klassifikation,
   Abrechnungsmenge, Geprüft-Status, Bemerkung) — als Sicherheitskopie der
   Aufmaßdaten, falls sie z.B. bei Problemen mit dem X31-Reimport von Hand in
   ORCA nachgetragen werden müssen.
6. Diese Excel-Sicherung kann beim (Neu-)Import optional als dritte Datei
   mitgegeben werden ("Bisheriger Arbeitsstand"), um Geprüft/Menge/
   Klassifikation/Bemerkung wiederherzustellen — z.B. nach einem
   Gerätewechsel oder nach dem Löschen der Website-Daten (Cache-Reset), wenn
   IndexedDB leer ist. Zuordnung läuft über eine technische ID-Spalte in der
   CSV, mit Fallback auf die Positionsnummer.

**Export-Verhalten**: alle geprüften Positionen werden exportiert. Hat eine
Position bereits einen X31-Eintrag, wird ihr Wert gepatcht; hat sie noch
keinen (Badge "neu in X31" — normal, da ORCA nur begonnene Mengenermittlungen
exportiert), wird beim Export ein neuer `<Item>`-Knoten samt ggf. fehlender
Vorfahren-Kategorien in die X31 eingefügt. Der Insert-Pfad ist strukturell
unverifiziert (siehe `TODO.md` Punkt 2) — Export-Toast weist neu eingefügte
Positionen separat aus.

**Exportformat vorläufig**: das REB-23.003-Zeilenformat für Mengenwerte wurde
noch nicht gegen eine echte, in ORCA AVA befüllte X31-Datei verifiziert (die
mitgelieferte Beispieldatei enthält nur leere Platzhalter). Siehe `TODO.md`
Punkt 1 — nach Export bitte den Re-Import in ORCA AVA prüfen.

## Architektur

- `index.html` / `app.js` / `styles.css` — App-Shell, UI-Logik, Styles.
- `db.js` — IndexedDB-Wrapper (drei Stores: `originalFiles`, `positions`, `meta`).
- `gaebCommon.js` — gemeinsamer BoQ-Baum-Walker, Text-Extraktion, Positionsnummer-Builder.
- `gaebLvParser.js` — liest LV-Dateien (X83/X85/X86), reine Lesefunktion.
- `gaebX31.js` — liest X31-Dateien und patcht sie chirurgisch für den Export
  (String-Splicing auf dem Original-Rohtext, kein DOMParser→XMLSerializer-Rückweg).
- `sw.js` / `manifest.webmanifest` / `icons/` — PWA/Offline-Layer.

Details zu Datenmodell, Parsing-/Export-Algorithmen und Design-Entscheidungen
siehe den ursprünglichen Implementierungsplan (im Chat-Verlauf dieser Session).

## Tests

Alle Tests laufen gegen die echten Beispieldateien unter `test/fixtures/`
(kein synthetisches Testdatenset), per Playwright (Chromium, headless) direkt
gegen `test/serve.mjs`. Playwright ist in dieser Umgebung global installiert
(`/opt/node22/lib/node_modules/playwright`), siehe `test/pw.mjs`. In einer
anderen Umgebung ggf. `npm install playwright` lokal ausführen und den Import
in `test/pw.mjs` entsprechend anpassen.

```bash
node test/scenarios/01-import.mjs
node test/scenarios/02-check-and-measure.mjs
node test/scenarios/03-persistence-reload.mjs
node test/scenarios/04-filter-search.mjs
node test/scenarios/05-export-and-diff.mjs   # ruft zusätzlich test/verify_export_diff.py auf
node test/scenarios/06-reimport-diff.mjs
node test/scenarios/07-offline-smoke.mjs
```

`test/verify_export_diff.py` (Python 3, keine Abhängigkeiten) vergleicht eine
exportierte X31 byte- und elementweise gegen das Original und stellt sicher,
dass außerhalb der erwarteten `QTakeoff/@Row`-Werte nichts verändert wurde.

`test/screenshots.mjs` erzeugt einen visuellen Kontroll-Durchlauf im
iPad-Viewport unter `test/screenshots/` (Chromium — kein WebKit in dieser
Umgebung verfügbar, siehe `TODO.md` Punkt 3).

`tools/reb23003-diff.mjs` ist ein Spike-Skript für den offenen Punkt 1 in
`TODO.md` (REB-23.003-Format-Verifizierung, sobald eine befüllte X31-Beispieldatei vorliegt).

## Deployment

Kein eigener Server nötig — jeder statische Webserver reicht. Für GitHub
Pages: Repo öffentlich stellen (unkritisch, da alle Projekt-/Aufmaßdaten
ausschließlich clientseitig in IndexedDB liegen, nie im Code/Repo).
`CACHE_NAME` in `sw.js` bei jedem Deploy hochzählen, sonst bekommen bereits
installierte Geräte Updates nicht mit.

Auf dem Tablet: Seite in Safari öffnen, "Zum Home-Bildschirm hinzufügen" —
läuft danach wie eine installierte App, unabhängig vom Netzwerk.
