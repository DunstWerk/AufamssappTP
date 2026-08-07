# GAEB X31 – Referenz für Implementierung (Lesen & Schreiben)

Diese Datei fasst zusammen, wie das Dateiformat **GAEB X31** (Mengenermittlung, GAEB DA XML 3.2 / 3.3, REB 23.003 Ausgabe 2009) aufgebaut ist. Ziel: Eine eigene Software soll X31-Dateien schreiben und lesen können, die sich mit **ORCA AVA** austauschen lassen.

> Quellen: GAEB-Fachdokumentation GAEB DA XML 3.2 (2013-10) / 3.3 (2021-05), BVBS-Prüfkriterien Mengenermittlung, Wikipedia-Artikel „X31", gaeb-online.de. Für die verbindliche, vollständige Spezifikation (inkl. XSD-Schema) siehe: https://www.gaeb.de/de/service/downloads/gaeb-datenaustausch/

---

## 1. Was ist X31?

- X31 ist eine **Datenaustauschphase** innerhalb von GAEB DA XML (verfügbar seit Version 3.2, Stand 2013-10; weiterhin in 3.3).
- Sie überträgt **Aufmaß-/Mengenermittlungsdaten**, die nach der Verfahrensbeschreibung **REB 23.003** (Ausgabe 1979 oder 2009) berechnet wurden.
- Im Unterschied zum alten Binärformat **DA11** (nur 9-stellige Ordnungszahl) erlaubt X31 **bis zu 14-stellige Ordnungszahlen** und bis zu 5 Gliederungsebenen.
- X31 ist eine **normale, unkomprimierte XML-Textdatei** (kein ZIP-Container), UTF-8 kodiert.
- Dateiendung: `.x31` (bzw. `.X31`)

---

## 2. Grundgerüst der Datei

```xml
<?xml version="1.0" encoding="UTF-8"?>
<GAEB xmlns="http://www.gaeb.de/GAEB_DA_XML/DA31/3.3" xmlns:BVBS="BVBS" xmlns:MWM="MWM">
  <GAEBInfo>
    <Version>3.3</Version>
    <VersDate>2021-05</VersDate>
    <Date>2022-10-31</Date>
    <Time>14:59:33</Time>
    <ProgSystem>MeineSoftware 1.0</ProgSystem>
    <ProgName>MeineSoftware</ProgName>
  </GAEBInfo>
  <QtyDeterm>
    <PrjInfo>
      <RefPrjName>Projektname</RefPrjName>
    </PrjInfo>
    <QtyDetermInfo>
      <MethodDescription>REB23003-2009</MethodDescription>
      <ProjDescr>Projektname</ProjDescr>
      <Creator>...</Creator>
      <Profiler>...</Profiler>
    </QtyDetermInfo>
    <DP>31</DP>
    <BoQ ID="ID...">
      <RefBoQName>LV-Name</RefBoQName>
      <BoQBkdn>...</BoQBkdn>   <!-- OZ-Schema, mehrfach -->
      <BoQBody>...</BoQBody>   <!-- Positionen mit Aufmaßzeilen -->
    </BoQ>
  </QtyDeterm>
</GAEB>
```

### Wichtige Regeln

| Element | Bedeutung |
|---|---|
| `xmlns` | Muss exakt `http://www.gaeb.de/GAEB_DA_XML/DA31/3.2` bzw. `.../DA31/3.3` sein, je nach Version. Der Datenphasen-Code (`DA31`) muss zum `<DP>`-Wert `31` passen. |
| `<GAEBInfo>/<Version>` | `3.2` oder `3.3` – muss zum Namespace passen |
| `<GAEBInfo>/<VersDate>` | z. B. `2013-10` (für 3.2) oder `2021-05` (für 3.3) |
| `<DP>` | Datenphase, hier immer `31` |
| Zusätzliche Namespaces | Herstellerspezifische Erweiterungen (z. B. `BVBS:Explanation`, `MWM:OZ`) sind erlaubt und werden über eigene XML-Namespaces eingebunden. ORCA nutzt evtl. eigene Präfixe. |

---

## 3. Ordnungszahl-Schema (`BoQBkdn`)

Bevor Positionen aufgelistet werden, definiert der Kopf des LV (`<BoQ>`), wie die Ordnungszahl (OZ) strukturiert ist. Jede `<BoQBkdn>` beschreibt eine Ebene:

```xml
<BoQBkdn>
  <Type>BoQLevel</Type>   <!-- Gliederungsebene -->
  <Length>3</Length>       <!-- Stellenanzahl dieser Ebene -->
  <Num>Yes</Num>           <!-- numerisch? -->
</BoQBkdn>
<BoQBkdn>
  <Type>BoQLevel</Type>
  <Length>3</Length>
  <Num>Yes</Num>
</BoQBkdn>
<BoQBkdn>
  <Type>Item</Type>        <!-- Positionsstufe -->
  <Length>5</Length>
  <Num>Yes</Num>
</BoQBkdn>
<BoQBkdn>
  <Type>Index</Type>       <!-- optionale Indexstufe (z. B. Nachtrag a, b, ...) -->
  <Length>1</Length>
  <Num>No</Num>
  <Alignment>left</Alignment>
</BoQBkdn>
```

- **Maximal 5** `BoQLevel`-Ebenen (Gliederungsstufen), **genau 1** `Item`-Ebene (Position) und **optional 1** `Index`-Ebene.
- Gesamtlänge aller Stufen zusammen: **max. 14 Stellen**.
- Beispiel oben ergibt Schema `111.222.PPPPP I` → OZ `001.001.00010`.
- Wichtig: **Das Schema muss zur tatsächlichen Struktur in `BoQCtgy`/`Item` unten passen** (`RNoPart`-Längen müssen mit `Length` übereinstimmen, ggf. mit führenden Nullen).

---

## 4. Struktur des Leistungsverzeichnisses (`BoQBody`)

```xml
<BoQBody>
  <BoQCtgy ID="ID0ADF0508" RNoPart="001">        <!-- 1. Gliederungsebene -->
    <BoQBody>
      <BoQCtgy ID="ID0ADF05C8" RNoPart="001">    <!-- 2. Gliederungsebene -->
        <BoQBody>
          <Itemlist>
            <Item ID="ID0ADEFA28" RNoPart="00010">  <!-- Position (5-stellig) -->
              <QtyDeterm>
                <QDetermItem>
                  <QTakeoff Row=" ... " />
                </QDetermItem>
                <!-- ggf. weitere QDetermItem -->
              </QtyDeterm>
              <MWM:OZ>001.001.00010</MWM:OZ>   <!-- herstellerspezifisch, informativ -->
            </Item>
          </Itemlist>
        </BoQBody>
      </BoQCtgy>
    </BoQBody>
  </BoQCtgy>
</BoQBody>
```

- `BoQCtgy` = Gliederungsgruppe (Kategorie), kann sich beliebig tief verschachteln (bis zur definierten Anzahl Ebenen aus `BoQBkdn`).
- `Item` = die eigentliche LV-Position, referenziert per `RNoPart` (Ordnungszahl-Teil dieser Stufe).
- `ID`-Attribute sind eindeutige, frei wählbare IDs (GUID-ähnlich, z. B. `ID` + Hex-String). Sie dienen der internen Referenzierung, nicht der fachlichen OZ.
- Jede Position kann **mehrere** `<QDetermItem>` enthalten – jedes repräsentiert **eine Aufmaßzeile**.

---

## 5. Die Aufmaßzeile: `QTakeoff` und REB 23.003

Das Kernstück ist `<QTakeoff Row="..."/>`. Der Inhalt des `Row`-Attributs ist eine **Textzeile im REB-23.003-Format**, exakt wie sie auch im alten DA11-Format vorkam – nur jetzt als XML-Attribut statt als Datensatz mit Datenart-Präfix `11`.

### 5.1 Aufbau einer klassischen REB-Zeile (Auszug, 80 Zeichen breit)

```
1101010010 *Aufmaß mit Herrn Müller-Lüdenscheid          0001B0
1101010010 40 % BE                              910,4=   0001C0
1101020010 Achse 1 B  05  12330  18550  4650  5120        0001D0
1101020020 91(4,55 + 4,65 + 4,48 + ... ) / 12=            0001F0
1101020050 04  3250  1250                                 0004H0
```

In X31 fällt der Positionsteil (`1101010010`) weg (steckt schon im `Item`/`BoQCtgy`), übrig bleibt der Rest als `Row`-Wert:

```xml
<QTakeoff Row=" *Aufmaß mit Herrn Müller-Lüdenscheid 0001B0 "/>
<QTakeoff Row=" 40 % BE 910,4= 0001C0 "/>
<QTakeoff Row=" Achse 1 B 05 12330 18550 4650 5120 0001D0 "/>
```

### 5.2 Bestandteile einer Aufmaßzeile

| Bestandteil | Beschreibung | Beispiel |
|---|---|---|
| **Kommentarzeile** | Beginnt mit `*` – reiner Text, keine Berechnung | `*Aufmaß mit Herrn Müller-Lüdenscheid` |
| **Bildverweis** | `*#Bild <Dateiname>` oder `*#PDF <Dateiname>` – referenziert eine angehängte Datei | `*#Bild Bonner Wasserwerk.jpg` |
| **Bezeichner/Erläuterung** | Freitext vor den Zahlenwerten (z. B. „Achse 1 B", „Graben A") – wird oft zusätzlich im Namespace-Element `BVBS:Explanation` gespiegelt | `Achse 1 B` |
| **Formelnummer** | 2-stellige Kennziffer, die die REB-Rechenformel bestimmt (siehe 5.3) | `05`, `04`, `91`, `22`, `23`, `00` |
| **Zahlenwerte** | Eingabewerte der Formel, i. d. R. in **Millimetern**, ohne Dezimalpunkt/-komma in der Kompaktschreibweise (z. B. `12330` = 12,330 m), können aber auch mit Komma geschrieben sein je nach Ausgabe/Kontext | `12330 18550 4650 5120` |
| **Ergebniskennzeichen** | `=` markiert Ende einer Formel/Rechnung mit Ergebnis; `+`/`-` markieren Vorzeichen bei Summenformel `00` | `910,4=` |
| **Blattadresse** | 6-stelliger Code am Ende jeder Zeile: 4-stellige Blattnummer + Buchstabe (Zeilenblock) + Ziffer (Zeilennummer im Block), z. B. `0001B0` | `0001B0`, `0004H0` |

### 5.3 Wichtige Formelnummern (REB 23.003)

| Nr. | Bedeutung |
|---|---|
| `00` | Freie Summenformel (Werte mit `+`/`-`, aufsummiert) |
| `01` | Dreieck: Grundseite × Höhe |
| `02` | Dreieck: 2 Seiten + Winkel/3. Seite |
| `03` | Dreieck: 3 Seiten |
| `04` | Rechteck/Quader (Länge × Breite [× Höhe]) |
| `05` | Trapez |
| `22` | Massenermittlung aus Querprofilen (Flächenermittlung Station) |
| `23` | Massenberechnung zwischen zwei Stationen (Prismenformel) |
| `91` | Hilfswert / Mittelwertberechnung (z. B. Mittelwert mehrerer Einzelwerte) |
| `99` | Sonderfall / letzte Zeile eines Blocks |

> Für eine vollständige Liste aller Formelnummern (es gibt deutlich mehr, u. a. für Kreissegmente, Prismen, Pyramidenstumpf etc.) muss die REB-23.003-Verfahrensbeschreibung (Ausgabe 2009) herangezogen werden. Diese ist **nicht** Teil der GAEB-Fachdokumentation, sondern eine eigenständige Publikation des BMDV/BVBS. Siehe Kapitel 8 unten für Bezugsquellen.

### 5.4 Blattadresse im Detail

Format: `BBBBZZ` (6 Zeichen)
- `BBBB` = 4-stellige Blattnummer (z. B. `0001`, `0002`, …)
- `Z` (5. Zeichen) = Buchstabe A–Z, markiert einen Zeilenblock innerhalb des Blattes
- `Z` (6. Zeichen) = Ziffer 0–9, laufende Nummer innerhalb des Blocks

Beispiel: `0004H0` = Blatt 4, Block H, Zeile 0.

Diese Adresse dient dem **Wiederfinden** der Aufmaßzeile in einem gedruckten/digitalen Aufmaßblatt und muss beim Roundtrip (Export → Bearbeitung → Re-Import) konsistent bleiben, wenn Änderungen einzelnen Zeilen zugeordnet werden sollen.

---

## 6. Vollständiges Beispiel (reales Muster, gekürzt)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<GAEB xmlns="http://www.gaeb.de/GAEB_DA_XML/DA31/3.3" xmlns:BVBS="BVBS" xmlns:MWM="MWM">
 <GAEBInfo>
  <Version>3.3</Version>
  <VersDate>2021-05</VersDate>
  <Date>2022-10-31</Date>
  <Time>14:59:33</Time>
  <ProgSystem>MWM-Libero 12.8.0</ProgSystem>
  <ProgName>MwmMfc 99</ProgName>
 </GAEBInfo>
 <QtyDeterm>
  <PrjInfo>
   <RefPrjName>Bonner Wasserwerk (MWM-Muster)</RefPrjName>
  </PrjInfo>
  <QtyDetermInfo>
   <MethodDescription>REB23003-2009</MethodDescription>
   <ProjDescr>Bonner Wasserwerk (MWM-Muster)</ProjDescr>
   <Creator>
    <Name1>k.A.</Name1><Street>k.A.</Street><PCode>k.A.</PCode><City>k.A.</City>
   </Creator>
   <Profiler>
    <Name1>k.A.</Name1><Street>k.A.</Street><PCode>k.A.</PCode><City>k.A.</City>
   </Profiler>
  </QtyDetermInfo>
  <DP>31</DP>
  <BoQ ID="ID0AD82908">
   <RefBoQName>Bonner Wasserwerk</RefBoQName>
   <BoQBkdn><Type>BoQLevel</Type><Length>3</Length><Num>Yes</Num></BoQBkdn>
   <BoQBkdn><Type>BoQLevel</Type><Length>3</Length><Num>Yes</Num></BoQBkdn>
   <BoQBkdn><Type>Item</Type><Length>5</Length><Num>Yes</Num></BoQBkdn>
   <BoQBkdn><Type>Index</Type><Length>1</Length><Num>No</Num><Alignment>left</Alignment></BoQBkdn>
   <BoQBody>
    <BoQCtgy ID="ID0ADF0508" RNoPart="001">
     <BoQBody>
      <BoQCtgy ID="ID0ADF05C8" RNoPart="001">
       <BoQBody>
        <Itemlist>
         <Item ID="ID0ADEFA28" RNoPart="00010">
          <QtyDeterm>
           <QDetermItem><QTakeoff Row=" *Aufmaß mit Herrn Müller-Lüdenscheid 0001B0 "/></QDetermItem>
           <QDetermItem><QTakeoff Row=" *erstellt mit MWM-Libero 0001B3 "/></QDetermItem>
           <QDetermItem><QTakeoff Row=" *#Bild Bonner Wasserwerk.jpg 0001B7 "/></QDetermItem>
           <QDetermItem>
            <QTakeoff Row=" 40 % BE 910,4= 0001C0 "/>
            <BVBS:Explanation>40 % BE</BVBS:Explanation>
           </QDetermItem>
          </QtyDeterm>
          <MWM:OZ>001.001.00010</MWM:OZ>
         </Item>
        </Itemlist>
       </BoQBody>
       <MWM:OZ>001.001</MWM:OZ>
      </BoQCtgy>
      <BoQCtgy ID="ID0AD94A98" RNoPart="002">
       <BoQBody>
        <Itemlist>
         <Item ID="ID0AD94198" RNoPart="00010">
          <QtyDeterm>
           <QDetermItem>
            <QTakeoff Row=" Achse 1 B 05 12330 18550 4650 5120 0001D0 "/>
            <BVBS:Explanation>Achse 1 B</BVBS:Explanation>
           </QDetermItem>
           <QDetermItem>
            <QTakeoff Row=" Achse 2 B 20 00005 6450 7340 4550 4760 0001E0 "/>
            <BVBS:Explanation>Achse 2 B</BVBS:Explanation>
           </QDetermItem>
          </QtyDeterm>
          <MWM:OZ>001.002.00010</MWM:OZ>
         </Item>
        </Itemlist>
       </BoQBody>
      </BoQCtgy>
     </BoQBody>
    </BoQCtgy>
   </BoQBody>
  </BoQ>
 </QtyDeterm>
</GAEB>
```

Dieses Beispiel stammt aus dem Wikipedia-Artikel „X31" und wurde mit MWM-Libero erzeugt (Namespace-Präfix `MWM:` für die Klartext-OZ, `BVBS:` für Erläuterungen). ORCA AVA verwendet ggf. eigene Erweiterungs-Namespaces oder verzichtet ganz darauf – das muss anhand einer echten, aus ORCA exportierten Datei geprüft werden.

---

## 7. Praktische Hinweise fürs Schreiben & Lesen (Python)

### 7.1 Grundstrategie

1. **XML-Grundgerüst** (`GAEBInfo`, `QtyDeterm`, `QtyDetermInfo`, `DP=31`) unverändert nach Vorlage erzeugen.
2. **BoQBkdn**-Header exakt zum OZ-Schema des Ziel-LV passend erzeugen (Stellenlängen!).
3. **BoQCtgy/Item**-Baum entsprechend der OZ-Hierarchie rekursiv aufbauen.
4. Für jede Aufmaßzeile ein `<QDetermItem><QTakeoff Row="..."/></QDetermItem>` erzeugen.
5. **Row-Wert** exakt nach REB-Zeilenschema formatieren (Formelnummer + Werte + Blattadresse).
6. Datei mit `lxml.etree` oder `xml.etree.ElementTree` schreiben, `xml_declaration=True`, `encoding="UTF-8"`.

### 7.2 Validierung

- Offizielle XSD-Schemata für X31 (Paket „Mengenermittlung") herunterladen von: https://www.gaeb.de/de/service/downloads/gaeb-datenaustausch/
- Mit `lxml.etree.XMLSchema` gegen die generierte Datei validieren.
- Zusätzlich: BVBS-Prüfkriterien-Dokument nutzen als Testfall-Checkliste (Formeln 04, 91, Hilfswerte, Kommentare etc.).

### 7.3 Kritischer Punkt: REB-Rechenlogik ≠ XML-Struktur

Die XML-Hülle ist der einfache Teil. Der schwierige Teil ist die **korrekte Kodierung der REB-23.003-Formeln** in der `Row`-Zeichenkette (Formelnummer, Werte-Reihenfolge, Dezimalstellen, Vorzeichen, Blattadresse). Ohne die REB-23.003-Verfahrensbeschreibung (Ausgabe 2009) als Referenz lässt sich das nicht zuverlässig nachbilden – insbesondere für komplexere Formeln (Querprofile `22`/`23`, Hilfswerte `91`, Kreisformeln etc.).

### 7.4 Empfehlung: Referenzdatei aus ORCA

Bevor du eigenen Code schreibst, lass Claude Code eine **echte, aus ORCA AVA exportierte X31-Beispieldatei** analysieren (kleines LV, 1–2 Positionen, einfache Formel wie `04`). Das zeigt dir:

- ob ORCA eigene Namespaces/Erweiterungen nutzt,
- exakte Attributreihenfolge und Whitespace-Konventionen,
- ob ORCA beim Import zusätzliche Pflichtfelder erwartet, die über das Minimum der Fachdokumentation hinausgehen.

---

## 8. Quellen & weiterführende Dokumente

| Dokument | Inhalt | Link |
|---|---|---|
| GAEB-Fachdokumentation 3.2 (2013-10) | Offizielle Spezifikation, Kapitel 7 „Mengenermittlung" | gaeb.de/wp-content/uploads/2019/04/Fachdokumentation_3.2_2013-10.pdf |
| GAEB-Fachdokumentation 3.3 | Aktualisierte Version | gaeb.de/wp-content/uploads/2019/10/Fachdokumentation_GAEB-DA-XML_3.3.pdf |
| XSD-Schemata „Mengenermittlung" | Formale Validierung | gaeb.de/de/service/downloads/gaeb-datenaustausch/ |
| BVBS-Prüfkriterien Mengenermittlung 3.2 | Testfälle, Pflichtwerte, Zertifizierungsablauf | bvbs.de/wp-content/uploads/2020/05/Pruefkriterien-GAEB-DA-XML-3.2-Mengenermittlung-V-10-10-2014.pdf |
| Wikipedia „X31" | Anschauliches Beispiel DA11 vs. X31 | de.wikipedia.org/wiki/X31 |
| gaeb-online.de Blog „Was ist eine X31-Datei?" | Visuelles Beispiel, Formelübersicht | blog.gaeb-online.de/was-ist-eine-x31-datei/ |
| „Das freie REB-Buch" (BVBS) | Hintergrund zu REB, DA11, X31 | bvbs.de/wp-content/uploads/2018/07/Das-Freie-REB-Buch.pdf |
| REB 23.003 (Ausgabe 2009) | Verfahrensbeschreibung der Rechenformeln selbst | über BMDV/REB-Vertrieb, nicht Teil von GAEB |

---

## 9. Zusammenfassung für Claude Code

- X31 = reine XML-Datei, Wurzel `<GAEB>` mit Namespace `.../DA31/3.2` oder `.../DA31/3.3`.
- Struktur: `GAEBInfo` (Metadaten) → `QtyDeterm` (Projektinfo + `DP=31` + `BoQ`).
- `BoQ` enthält `BoQBkdn` (OZ-Schema-Definition) + `BoQBody` (verschachtelte `BoQCtgy` bis zur `Item`-Ebene).
- Jedes `Item` (= LV-Position) enthält `QtyDeterm` mit beliebig vielen `QDetermItem` → je eine Aufmaßzeile als `QTakeoff Row="..."`.
- Der `Row`-Inhalt folgt dem REB-23.003-Zeilenformat: `[Text]* | [Bezeichner] [Formelnummer] [Werte...] [=/+/-] [Blattadresse]`.
- Herstellerspezifische Zusatzinfos (Klartext-OZ, Erläuterungen) werden über eigene XML-Namespaces (`MWM:`, `BVBS:`) angehängt – optional, nicht normativ.
- Kritischster Punkt beim Selbstschreiben: korrekte REB-Formellogik, nicht die XML-Syntax.

---

## 10. Umsetzung in dieser App (Stand nach Einarbeitung dieser Referenz)

- `gaebX31.js`/`encodeFormel91`: schreibt jetzt eine einfache, formellose Wertzeile
  (`" <Wert>= <Blattadresse> "`, Komma als Dezimaltrennzeichen, ganze Zahlen
  ohne Dezimalteil — siehe Abschnitt 5.2 "Ergebniskennzeichen"/"40 % BE 910,4=").
  Die Blattadresse (Abschnitt 5.4) wird aus der Originalzeile übernommen
  (Patch-Pfad) bzw. fortlaufend neu vergeben (Insert-Pfad), NICHT mehr die
  ursprüngliche Feldbreite der ORCA-Platzhalterzeile nachgebaut — laut den
  echten Beispielzeilen in Abschnitt 6 sind Zeilen unterschiedlich lang, es
  gibt keine feste Breite.
- `gaebX31.js`/`parseFormel91`: unterscheidet ORCAs "unbearbeitet"-Platzhalter
  (langer, kommalos er Zahlencode ≥ 6 Ziffern vor dem "=", z.B. "800911") von
  einem echten, formellosen Ergebniswert (kurze Zahl und/oder mit Komma, z.B.
  "17=" oder "2,5="), damit die App ihre eigenen geschriebenen Werte bei einem
  erneuten Einlesen korrekt erkennt.
- **Weiterhin nicht gegen eine echte, von ORCA AVA erzeugte befüllte X31
  verifiziert** (siehe TODO.md Punkt 1) — diese Referenzdatei beschreibt den
  allgemeinen REB-23.003/GAEB-Standard anhand eines MWM-Libero-Beispiels,
  nicht zwingend ORCAs exaktes eigenes Schreibverhalten (siehe Abschnitt 7.4).
