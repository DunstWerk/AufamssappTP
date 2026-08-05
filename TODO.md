# Offene Punkte

## 1. REB-23.003-Exportformat noch nicht verifiziert (wichtigster Punkt)

`gaebX31.js` exportiert Mengen aktuell nach bestem Wissen als "Formel 91"
(freie Formel, `<Zahl>=`), eingebettet in die exakte Feldbreite des
ursprünglichen Platzhalter-Musters. **Das wurde noch nicht gegen eine echte,
in ORCA AVA befüllte X31-Datei verifiziert** — die mitgelieferte
Beispieldatei (`test/fixtures/Aufmass_Goettingen.X31`) enthält nur leere
Formular-Platzhalter, keine echten Messwerte.

`REB_FORMAT_VALIDATED = false` in `gaebX31.js` steuert einen Warnhinweis, der
bei jedem Export angezeigt wird.

**Sobald eine X31-Datei mit mindestens einer manuell in ORCA AVA
eingetragenen Menge vorliegt:**
1. `node tools/reb23003-diff.mjs <leere.X31> <befüllte.X31>` ausführen.
2. Anhand der Zeichen-für-Zeichen-Diff-Ausgabe das tatsächliche Spaltenformat
   ermitteln (Spaltenbreite, Padding, Dezimaltrennzeichen, Position des
   Formel-Codes).
3. `encodeFormel91()` und `parseFormel91()` in `gaebX31.js` entsprechend
   anpassen.
4. `REB_FORMAT_VALIDATED = true` setzen, Warnhinweis in `app.js`
   (`handleExport`) entfernen.
5. Eine Regressions-Fixture (leer + befüllt) unter `test/fixtures/` ablegen
   und einen Test ergänzen, der `encodeFormel91`/`parseFormel91` dagegen prüft.

## 2. Positionen ohne X31-Eintrag (gelöst — Struktur-Einfügung)

Geklärt: die mitgelieferte Beispiel-X31 deckt nur 17 von 105 LV-Positionen ab,
weil ORCA in der X31 grundsätzlich nur Positionen exportiert, für die bereits
eine Mengenermittlung begonnen wurde — kein Datenfehler. Auf Nutzerwunsch
werden geprüfte/gemessene Positionen OHNE vorhandenen X31-Eintrag beim Export
jetzt als neue `<Item>`-Knoten (und nötigenfalls fehlende Vorfahren-Kategorien)
in die X31 eingefügt, statt ausgeschlossen zu werden (siehe `gaebX31.js`,
`planInsertion`/`patchX31`, Pfad B).

**Zusätzliches Risiko dieses Insert-Pfads** (oben auf Punkt 1 aufbauend):
- Der REB-23.003-Row-Wert für neu eingefügte Zeilen wird komplett neu erzeugt
  (keine Vorlage-Zeile für diese Position vorhanden), inklusive eines frei
  erfundenen, fortlaufenden Referenzcodes (`nextRefCode`, Format `NNNNA0`).
  Empirisch zeigte sich, dass dieser Referenzteil in den vorhandenen Zeilen
  NICHT mit der LV-Item-/Index-Nummer übereinstimmt (vermutlich eine
  fortlaufende Zeilennummer des Mengenermittlungsblatts) — die fortlaufende
  Nummerierung ist ein Rateversuch, keine gesicherte Ableitung.
- Neu eingefügte `<BoQCtgy>`-Knoten übernehmen ID/RNoPart/Label 1:1 aus dem LV
  (verifiziert: Kategorie-IDs sind zwischen LV und X31 identisch), das ist der
  sicherste Teil dieser Erweiterung.
- Jede neu eingefügte Position wird defensiv abgesichert: kann die Einfüge-
  stelle nicht eindeutig bestimmt werden (siehe `findDirectItemlistSpan` in
  `gaebX31.js`), wird NICHT geraten — die Position landet in `skipped` und
  fehlt sichtbar im Export-Toast, statt riskant falsch eingefügt zu werden.
- **Sobald die Testdatei aus Punkt 1 vorliegt**: falls sie auch eine Position
  ohne vorherigen X31-Eintrag enthält, unbedingt zusätzlich den Insert-Pfad
  damit verifizieren (nicht nur den Patch-Pfad).

## 3. Echtes iPad/Safari nicht getestet

Es steht in dieser Entwicklungsumgebung kein WebKit zur Verfügung. Die
bekannten WebKit-Eigenheiten (Datei-Input-Doppel-Trigger, `position:sticky`
mit `height:100%`) wurden von Anfang an vermieden, aber eine echte Prüfung
auf einem iPad in Safari steht noch aus.

## 4. Klassifikation "Geliefert/Montiert" wird nicht exportiert

Bewusste Entscheidung (siehe Plan/README): es gibt kein sicheres
GAEB-Freitextfeld dafür. Nur die berechnete effektive Menge
(Menge × Faktor) wird exportiert, die Klassifizierung selbst bleibt nur
lokal in IndexedDB. Bei Bedarf später revidierbar.
