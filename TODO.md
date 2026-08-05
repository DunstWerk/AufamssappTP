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

## 2. Positionen ohne X31-Eintrag

Die mitgelieferte Beispiel-X31 deckt nur 17 von 105 LV-Positionen ab (kein
1:1-Abbild des LVs). Solche Positionen sind in der App normal bearbeitbar,
werden aber beim Export übersprungen (Badge "nicht in X31", Banner-Hinweis,
Export-Toast nennt die Anzahl). Falls ORCA AVA tatsächlich immer eine
vollständige X31 liefert und die Beispieldatei nur ein Sonderfall war, bitte
Rückmeldung geben — dann könnte diese Beschränkung ggf. entfallen bzw.
anders bewertet werden.

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
