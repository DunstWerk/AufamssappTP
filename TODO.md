# Offene Punkte

## 1. REB-23.003-Exportformat BESTÄTIGT FALSCH — von ORCA zurückgewiesen (wichtigster Punkt)

`gaebX31.js` exportiert Mengen aktuell nach bestem Wissen als "Formel 91"
(freie Formel, `<Zahl>=`), eingebettet in die exakte Feldbreite des
ursprünglichen Platzhalter-Musters. **Das ist inzwischen nachweislich falsch**:
der Nutzer hat eine exportierte X31 real in ORCA AVA importiert, und ORCA hat
den erzeugten Rechenansatz mit rotem Kreuz als ungültig markiert.

Konkreter Befund aus ORCAs Rechenansatz-Grid (Spalten Faktor / Rechenansatz /
Ergebnis / Seite / Zeile / Inde):
- **Unsere Zeile (falsch)**: Faktor `0,001`, Rechenansatz `A0 =;;;;` (unsinnig),
  Ergebnis `0,000`, Zeile `T`.
- **Eine echte, von Hand in ORCA eingetragene Zeile (richtig, Position
  05.02.001)**: Faktor `1,000`, Rechenansatz `17=`, Ergebnis `17,000`, Zeile `A`.

Das zeigt: das `Row`-Attribut kodiert intern MEHRERE getrennte ORCA-Felder
(Faktor, Rechenansatz, Ergebnis, Seite, Zeile, Inde, ggf. mehr) in einer
gepackten Struktur, die deutlich komplexer ist als die bisher angenommene
"Zahl = Referenzcode"-Form. Unser einfaches Ersetzen des führenden
Zahlenblocks verschiebt/zerstört mehrere dieser Felder gleichzeitig.

**Bereits behobener Teilbug, unabhängig vom Zeilenformat**: wenn mehrere neu
eingefügte Positionen dieselbe, in der X31 fehlende Vorfahren-Kategorie
teilen, wurde diese Kategorie doppelt angelegt (zwei `<BoQCtgy>` mit
identischer ID) — das war beim ORCA-Import zwar (laut Nutzer) noch les- und
zuordenbar, ist aber ungültige GAEB-Struktur. Gefixt in `groupInsertPositions`
(gaebX31.js): Positionen mit identischer fehlender Kette werden jetzt korrekt
zu einer Gruppe zusammengefasst, die die Kategorie nur einmal anlegt.
Regressionstest: `test/scenarios/05c-export-insert-shared-category.mjs`.

**Noch offen — der eigentliche Zeilenformat-Fehler.** Der vom Nutzer als
"von ORCA" bezeichnete zweite Vergleichsfile enthielt (geprüft) tatsächlich
NICHT die 05.02.001/`17=`-Beispielzeile, sondern war byte-identisch mit dem
ursprünglichen leeren Beispiel — vermutlich ein Missverständnis, welche Datei
gemeint war. Für eine echte Byte-Diff-Analyse fehlt weiterhin die tatsächliche
Export-Datei mit der befüllten Zeile.

**Präzise benötigt, um das endlich richtig zu lösen** (bitte genau so, nicht
nur einen Screenshot):
1. In ORCA AVA die ORIGINAL-X31 (unverändert, leeres Formular) öffnen.
2. Für EINE Position von Hand einen Rechenansatz eintragen (z.B. `17=`, wie im
   Screenshot gezeigt) und NUR das speichern/exportieren — keine anderen
   Änderungen.
3. Diese exportierte X31-Datei hier hochladen (die Datei selbst, nicht nur
   ein Screenshot des ORCA-Grids).
4. Mit `node tools/reb23003-diff.mjs <Original-X31> <von-Hand-befuellte-X31>`
   Zeichen-für-Zeichen vergleichen, das tatsächliche Format ermitteln,
   `encodeFormel91()`/`parseFormel91()` entsprechend neu schreiben (die
   gepackte Mehrfeld-Struktur berücksichtigen, nicht nur einen einzelnen
   Zahlenblock), `REB_FORMAT_VALIDATED = true` setzen, Warn-Dialog in
   `app.js` entfernen, Regressions-Fixture ergänzen.

**Bis dahin**: die App zeigt vor jedem X31-Export einen Bestätigungsdialog
("Export-Format noch nicht bestätigt", siehe `index.html`/`app.js`
`confirmExportWarning`), der ausdrücklich auf die bestätigte ORCA-Ablehnung
hinweist und Abbrechen anbietet. Die Excel-Sicherung bleibt der verlässliche
Weg für die manuelle Eingabe in ORCA.

## 2. Positionen ohne X31-Eintrag (gelöst — Struktur-Einfügung)

Geklärt: die mitgelieferte Beispiel-X31 deckt nur 17 von 105 LV-Positionen ab,
weil ORCA in der X31 grundsätzlich nur Positionen exportiert, für die bereits
eine Mengenermittlung begonnen wurde — kein Datenfehler. Auf Nutzerwunsch
werden geprüfte/gemessene Positionen OHNE vorhandenen X31-Eintrag beim Export
jetzt als neue `<Item>`-Knoten (und nötigenfalls fehlende Vorfahren-Kategorien)
in die X31 eingefügt, statt ausgeschlossen zu werden (siehe `gaebX31.js`,
`planInsertion`/`patchX31`, Pfad B).

**Zusätzliches Risiko dieses Insert-Pfads** (siehe Punkt 1 — der Row-Wert ist
für neu eingefügte Zeilen genauso betroffen wie für gepatchte, plus zusätzlich
ein frei erfundener, fortlaufender Referenzcode ohne gesicherte Ableitung):
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

## 3. Echtes iPad/Safari — ein Bug bereits gefunden und behoben

Es steht in dieser Entwicklungsumgebung kein WebKit zur Verfügung, echte
iPad-Tests laufen ausschließlich beim Nutzer. Dabei bereits gefunden:

**Datei-Auswahl-Dialog zeigte GAEB-Dateien ausgegraut/nicht auswählbar an.**
Trotz `accept`-Attribut mit sowohl Dateiendungen (`.x83`/`.x85`/`.x86`/`.x31`)
als auch MIME-Types (`application/xml`, `text/xml`) hat iOS die Dateien
ausgegraut — vermutlich weil iOS diesen unüblichen Endungen keine passende
UTI (Uniform Type Identifier) zuordnet und sie dadurch trotz MIME-Hinweis
als nicht konform herausfiltert. Behoben, indem zusätzlich `*/*` (bzw. `.xml`)
in den `accept`-Attributen ergänzt wurde (`index.html`) — damit filtert iOS
gar nicht mehr nach Dateityp, jede Datei ist auswählbar. Kein Sicherheits-
problem, da `gaebLvParser.js`/`gaebX31.js` ungültige/falsche Dateien ohnehin
mit einer klaren Fehlermeldung abweisen (siehe Bug-Regel 5 im Architektur-
Abschnitt: jeder Import-Handler ist in try/catch, Fehler werden als Toast
angezeigt statt die Datei stillschweigend zu ignorieren).

Noch zu prüfen: die übrigen bekannten WebKit-Eigenheiten (Datei-Input-
Doppel-Trigger, `position:sticky` mit `height:100%`) wurden von Anfang an
vermieden, aber eine vollständige Durchsicht auf einem echten iPad steht
weiterhin aus.

## 4. Klassifikation "Geliefert/Montiert" wird nicht exportiert

Bewusste Entscheidung (siehe Plan/README): es gibt kein sicheres
GAEB-Freitextfeld dafür. Nur die berechnete effektive Menge
(Menge × Faktor) wird exportiert, die Klassifizierung selbst bleibt nur
lokal in IndexedDB. Bei Bedarf später revidierbar.
