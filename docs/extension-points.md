# Erweiterungspunkte

Was v0.1 bewusst nicht kann, und wo es andocken würde. Nichts davon ist vorab implementiert —
aber jede dieser Erweiterungen ist ohne Bruch am Kern möglich.

## Abgleich mit echten Bauzeichnungen

Das Modell wurde gegen reale bemaßte Grundrisse geprüft (Reihenhaus-Grundrisse EG/OG sowie ein
Bauantrag im Maßstab 1:100 mit KG/EG/1.OG/2.OG/DG). Die Prüfung diente ausdrücklich der
Modellvalidierung; die Pläne enthalten personenbezogene Daten und sind **keine** Fixtures.

**Vom Modell bereits abgedeckt** — bestätigt durch die realen Pläne:

| Beobachtung im echten Plan | Abdeckung |
|---|---|
| Legende „Baubestand“ (schwarz) versus „Neue Wände im Zuge des Ausbaus“ (schraffiert) | `state` + `walls.by_state` mit Schraffur — genau dieser Anwendungsfall |
| Wandstärken 36,5 / 24 / 11,5 cm in einer Zeichnung | `thickness_mm` je Wand, `classification` |
| Raumstempel „WOHNEN 33,80 qm“ | Raumname + berechnete Fläche, Plan-Fläche als `area_override_mm2` mit Abweichungsprüfung |
| Türmaße als „1,01/2,11“ (Breite/Höhe in m) | `width_mm` / `height_mm` |
| Treppenstempel „15 STG 18,3/26“ | `step_count` + `rise_mm` / `run_mm` |
| „ÜBERD. FREISITZ“, „Terrasse“, „ÜBERD. BALKON“ | `space.category` = `terrace` / `balcony` / `outdoor` |
| Mehrere Geschosse eines Gebäudes | `buildings[].levels[]` |
| Gewölbekeller schraffiert dargestellt | Theme-Schraffur |

**Nachgezogen aufgrund des Abgleichs:** `stair.rise_mm` und `stair.run_mm`. ADR 0003 hatte
beide Felder bereits als Teil des 2,5D-Modells benannt, das Schema kannte sie nicht — eine
Inkonsistenz, die erst am realen Treppenstempel auffiel.

**Noch nicht abgedeckt** — konkrete, aus realen Plänen abgeleitete Lücken:

1. **Maßketten.** Jeder reale bemaßte Plan trägt drei bis vier ineinandergeschachtelte Ketten
   je Seite (`24 | 3,21 | 11,5 | 3,69,5 | 24` über der Gesamtkette `7,50`). v0.1 kennt nur
   die **einzelne** Maßlinie (`dimension`). Eine Kette wäre modellierbar als Element
   `dimension_chain` mit einer Basislinie und einer geordneten Punktfolge, aus der die
   Einzelmaße abgeleitet werden — additiv, ohne Bruch. Das ist die sichtbarste Lücke zwischen
   der aktuellen Ausgabe und einem Werkplan und damit der erste Kandidat nach v0.1.
2. **Automatische Maßketten** aus Wandachsen und Raumkanten — der eigentliche Nutzen, sobald
   Punkt 1 existiert.
3. **Einbauten mit eigener Semantik**: Dusche, WC, Rundkamin, Einschubtreppe, Geländer mit
   Höhenangabe. Heute nur als `annotation` darstellbar; sauber wären eigene Collections
   (siehe Tabelle unten).
4. **Schriftfeld / Plankopf** (Bauherr, Planverfasser, Maßstab, Datum, Planinhalt). Die Daten
   passen in `project` und `meta`; der **Plankopf selbst** ist Blattlayout und gehört
   ausdrücklich nicht in den Core — er ist Aufgabe des konsumierenden Layoutsystems.
5. **Blattkomposition**: Ein realer Bauantragsplan zeigt mehrere Geschosse, Schnitte und einen
   Lageplan auf einem Blatt. Der Renderer erzeugt bewusst **ein SVG je Geschoss**; das
   Zusammenstellen eines Blatts ist Präsentation, nicht Geometrie.

## Datenmodell

| Vorhaben | Ansatzpunkt | Bricht das Schema? |
|---|---|---|
| Möblierung | neue Collection `furniture[]` im Level, Katalogreferenz in `meta` | nein, additiv (MINOR) |
| Sanitär-/Küchenobjekte | dito, eigene Collections mit eigenem `$def` | nein |
| Balkon/Terrasse als Bauteil | bereits als `space.category` vorhanden; als eigenes Bauteil neue Collection | nein |
| Dachöffnung | `opening.type: "roof_opening"` — Enum-Erweiterung | MINOR, Leser von 0.1 sehen einen unbekannten Typ |
| Gekrümmte Wände | optionales `arc: { bulge_mm }` an Wall | nein, Default = gerade |
| Wandausrichtung | optionales `alignment: center\|left\|right` | nein, Default `center` = heutiges Verhalten |
| Dachschrägen / Split-Level | optionales `profile` an Wall/Space | nein |
| Mehrere Gebäude auf einem Grundstück | bereits möglich: `buildings[]` ist ein Array | — |

Die additiven Fälle sind der Regelfall, weil `additionalProperties: false` nur **unbekannte**
Felder ablehnt und neue Felder mit der MINOR-Version eingeführt werden (ADR 0010).

## Import und Export

### DXF-Export

Naheliegendster nächster Schritt. R12 ASCII genügt den meisten Empfängern und ist ohne
Bibliothek schreibbar: Wandkörper als `LWPOLYLINE` je Layer, Öffnungen als Blöcke, Räume als
`LWPOLYLINE` plus `TEXT`. Ansatzpunkt: `src/exporters/dxf/`.
Millimeter-Ganzzahlen übertragen sich verlustfrei. (Das Verzeichnis existiert noch nicht.)

### DXF-Import

Deutlich schwieriger, weil DXF Linien liefert und keine Wände. Der richtige Weg führt über den
**Observation Layer**: ein DXF-Reader erzeugt `*.observations.json` (Liniensegmente als
`candidate_type: "wall"`), und der bestehende Reconciler macht daraus ein Modell. Damit ist der
Weg identisch zur Bildrekonstruktion — inklusive Bericht über nicht Verwertbares.

### IFC / BIM

Gehört nicht in den Kern. Ein Sidecar-Prozess (auch in einer anderen Sprache, etwa Python mit
`ifcopenshell`) kann `*.floorplan.json` lesen und schreiben, ohne dass der Kern davon erfährt.
Die 2,5D-Struktur ist auf `IfcWallStandardCase` + `IfcOpeningElement` + `IfcSpace` abbildbar.

### PNG / PDF / PowerPoint

SVG bleibt die Quelle; die Konvertierung liegt außerhalb. Der Kern liefert dafür bereits alles:
`viewBox`, Zielbreite, Maßstab und Elementzahlen über `floorplan render --json`, plus
`data-id`-Attribute für interaktive Nachbearbeitung.

## Fachliche Module

### Wohnflächenberechnung (WoFlV / DIN 277)

Ausdrücklich **nicht** in v0.1, weil das Modell die nötige Information nicht trägt: Anrechnung
unter Dachschrägen setzt vertikale Profile voraus. Der Weg: erst `profile` am Space (siehe oben),
dann ein eigenes, noch anzulegendes Modul unter `src/analysis/` mit **explizit benannter**
Norm und Version.

Bis dahin heißt die berechnete Größe konsequent `floor_area_m2` — geometrische Grundfläche.
Diese Benennung ist Absicht und sollte nicht aufgeweicht werden.

### Baurechtliche Regelwerke

Der Validator trennt heute schon geometrische Gültigkeit, architektonische Plausibilität und
rechtliche Zulässigkeit — letztere ist leer. Ein Regelwerksmodul würde:

* eine eigene Regelquelle mit **Fundstelle** je Regel mitbringen (Bundesland, Fassung, Paragraf),
* eigene Regel-IDs in der Severity-Matrix registrieren,
* Geltungsbereich (Ort, Gebäudeklasse, Nutzung) explizit im Dokument voraussetzen,
* und ausschließlich Aussagen treffen, die es belegen kann.

`src/validation/semantic/plausibility.js` zeigt die Form: Bereiche datengetrieben, Hinweistext
klar als Konvention gekennzeichnet.

### 3D-Vorschau

Reine Extrusion aus 2,5D: Wandkörper × Höhe, Öffnungen als Aussparungen, Räume als Böden.
Die Geometrieschicht liefert die Grundflächen bereits segmentiert und mit vertikalen Extents.

## Planung und Automatik

### Variantenplanung / Constraint-Solver

Der `design`-Modus ist in v0.1 der Agent, der Operationen schreibt — kein Solver. Ein echter
Solver würde als eigenes Modul über der Operations-Schicht sitzen: Anforderungen (Raumprogramm,
Flächen, Adjazenzen) → Kandidatenlayouts → Bewertung → Operationsstapel. Er würde den Kern
nur benutzen, nie verändern.

Wichtig: Auch ein Solver darf keine Maße erfinden. Von ihm erzeugte Werte sind `provided`
(vom Anforderungsprofil abgeleitet) oder `derived` — niemals `measured`.

### Raumableitung aus Wänden

Planare Facettensuche im Wandgraphen. Als **Reparaturwerkzeug** wertvoll („leite die Räume aus
den Wänden ab und vergleiche mit den vorhandenen“), nicht als Ersatz für das explizite Polygon
(ADR 0006). Ansatzpunkt: ein neues Modul neben `src/topology/connectivity.js`.

### Automatische Bemaßung

Aus Wandachsen und Raumkanten Maßketten erzeugen. Rein additive Operation
(`add_dimension` existiert bereits), gut testbar, hoher Nutzen für technische Pläne.

## Betrieb

### Mehrbenutzerbetrieb, Merge zweier Dokumente

Heute nicht vorgesehen. IDs sind dokumentweit eindeutig, aber nicht global — ein Merge müsste
umbenennen und eine Mapping-Tabelle führen. Solange Dateien plus Git das Versionierungsmedium
sind, ist das kein Problem, das gelöst werden muss.

### Datenbank

Bewusst nicht. Dateien reichen, sind diffbar, versionierbar und für Agenten direkt lesbar.
Eine Datenbank würde erst nötig, wenn viele Nutzer gleichzeitig an einem Modell arbeiten —
das ist ein anderes Produkt.

### Web-Editor

Ausdrücklich kein Ziel. Der SVG-Output mit `data-id`-Attributen und die JSON-API der CLI
genügen, um einen Viewer oder Editor **außerhalb** dieses Repositories zu bauen.
