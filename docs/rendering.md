# Rendering

## Prioritätenfolge

```text
geometrische Korrektheit  >  Reproduzierbarkeit  >  Design
```

Der Renderer benutzt **keine** generative Bild-KI. Er ist eine reine Funktion
`(Modell, Theme) → SVG`.

## Das Ausgabeformat

Das SVG-Koordinatensystem **ist** das Modellkoordinatensystem in Millimetern, mit gespiegelter
Y-Achse:

```xml
<svg width="1400" height="1207.5" viewBox="-880 -9880 13760 11880"
     data-floorplan-schema="0.1" data-level-id="level_eg"
     data-project-id="fixture_03" data-quality="scaled" data-unit="mm">
```

Folgen:

* Die Zahlen in der Datei sind lesbare Millimeter — ein SVG ist damit inspizierbar und diffbar.
* Skalierung passiert allein über `width`/`height` und `viewBox`.
* **Strichstärken und Schriftgrößen gibt das Theme in px an** und der Renderer teilt sie durch
  `px_per_mm`. Optische Gewichte bleiben dadurch bei jedem Maßstab gleich.
* Dasselbe gilt für Strichmuster: `dash: "7 4"` heißt 7 px Strich, 4 px Lücke — umgerechnet
  in Nutzereinheiten.

## Ebenen

Feste Reihenfolge, jede in einer eigenen Gruppe:

```text
1 spaces        Raumflächen (unter allem)
2 shafts        Schächte
3 walls         Wandflächen, dann Wandkonturen
4 columns       Stützen
5 openings      Türblatt und Bogen, Fensterrahmen, Durchgangslaibungen
6 stairs        Umriss, Stufen, Laufpfeil
7 dimensions    Maßlinien
8 labels        Raumnamen und Flächen
9 annotations   freie Beschriftung
```

Jedes Element trägt `data-type` und `data-id`. Nachgelagerte Systeme — PowerPoint-Export,
Web-Viewer, interaktive Exposés — können damit einzelne Bauteile adressieren, ohne den
Grundriss neu zu berechnen.

## Wände

Wandflächen werden **nach Stilgruppe** gebündelt: alle gleich aussehenden Wände bilden eine
Fläche, deren Außenkontur über `unionOutline` berechnet wird. Innenkanten zwischen abstoßenden
Wänden verschwinden dadurch, verschnittene Ecken schließen nahtlos.

Eine Abbruchwand hat einen anderen Stil und damit eine eigene Gruppe — sie behält ihren eigenen
roten, gestrichelten Umriss, und die Grenze zum Bestand bleibt sichtbar. Das ist gewollt.

Öffnungen sind echte Lücken in der Wandgeometrie (→ `docs/geometry-model.md`), keine
übermalten Rechtecke. Türlaibungen entstehen dadurch automatisch als Teil der Wandkontur.

## Symbole

### Tür

* **Blatt**: Rechteck von der Bandseite in die Aufschlagrichtung, Länge = Öffnungsbreite,
  Dicke = `openings.door.leaf_thickness_mm` (Symbolgeometrie, kein Bauteilmaß).
* **Bogen**: Viertelkreis um das Band, von der Blattspitze zur gegenüberliegenden Laibung.
  Die Drehrichtung folgt aus dem Kreuzprodukt in SVG-Koordinaten und stimmt in jeder
  Wandorientierung.
* **Doppeltür** (`door_type: "double"`): zwei Blätter à halber Breite, außen angeschlagen.
* **Schiebetür** (`sliding`, `pocket`): Blatt parallel zur Wand, seitlich versetzt, kein Bogen.
* **Garagentor / Falttür / Drehtür**: geschlossenes Blatt in der Wandmitte, kein Bogen.

**Fehlt `swing`, wird kein Bogen gezeichnet.** Das Blatt erscheint geschlossen. Eine
Aufschlagrichtung zu erfinden, nur damit ein Bild vollständig aussieht, wäre genau der Fehler,
den dieses System vermeidet. `hinge` hat dagegen den Standardwert `left` — er verschiebt das
Symbol, erfindet aber keine Information über das Gebäude.

### Fenster

Linien parallel zur Wand innerhalb der Öffnung, plus die beiden Laibungen:

* `double_line` — vier Linien (beide Wandkanten plus zwei Rahmenlinien), Standard
* `frame` — Rechteck über die Wandtiefe
* `single_line` — eine Linie auf der Achse

### Durchgang

`none` · `reveal` (Laibungslinien) · `threshold` (zusätzlich eine Schwellenlinie) ·
`dashed`. Der Marketing-Stil nutzt `none`, weil die Wandlücke dort für sich spricht.

### Treppe

Umriss, Laufpfeil und Stufenlinien. **Stufenlinien nur, wenn `step_count` im Modell steht** —
sonst würde die Darstellung eine Steigungshöhe behaupten, die niemand kennt.

## Beschriftung

Raumbeschriftungen sitzen auf `label_anchor` oder, wenn nicht gesetzt, auf dem berechneten
`labelPoint`: dem Schwerpunkt, sofern er weit genug im Raum liegt, sonst dem Rasterpunkt mit
dem größten Randabstand. Ein L-förmiger Raum bekommt dadurch keine Beschriftung im Freien.

Zeilen (Name, Fläche, optional ID) werden vertikal zentriert. Räume unter
`labels.min_label_area_m2` bleiben unbeschriftet.

Ist die Herkunft der Fläche nicht belastbar und `uncertainty.mark_estimated` aktiv, erscheint
das Präfix — standardmäßig `ca. `.

## Determinismus

Garantiert und getestet:

* keine Zeitstempel, keine Zufalls-IDs
* feste Zahlenformatierung, `-0` normalisiert, kein `toLocaleString`
* feste Iterationsreihenfolge (Dokumentreihenfolge, sortierte Zwischenergebnisse)
* Ebenen- und Attributreihenfolge fest

Zweimal rendern ergibt **byteidentische** Dateien. `tests/render.test.js` prüft das für jede
Fixture in jedem Theme und hält Golden-Snapshots in `tests/golden/`.

Eine Golden-Datei bewusst neu erzeugen:

```bash
npm run test:update-golden
git diff tests/golden/     # und die Änderung tatsächlich ansehen
```

## Rendern eines ungültigen Modells

`floorplan render` validiert vorher und **verweigert** die Ausgabe bei Fehlern. Ein kaputtes
Bild ist schlimmer als kein Bild, weil es Vertrauen erzeugt, das es nicht verdient.

```bash
floorplan render plan.floorplan.json --force            # trotzdem rendern, mit Warnung
floorplan render plan.floorplan.json --skip-validation  # Validierung ganz überspringen
```

## Weitere Formate

SVG ist die Quelle. PNG, PDF und PowerPoint entstehen durch Konvertierung außerhalb dieses
Repositories — der Core wird bewusst kein Präsentationssystem (→ `docs/extension-points.md`).

```bash
floorplan render plan.floorplan.json --theme marketing --output plan.svg
rsvg-convert -w 2000 plan.svg -o plan.png     # oder inkscape, resvg, …
```

Für den Einsatz in Exposés und Folien relevant:

* `viewBox` und `width`/`height` sind gesetzt, das SVG skaliert verlustfrei.
* `page.margin_mm` steuert den Außenabstand, `page.target_width_px` die Ausgabegröße.
* Der Hintergrund ist ein explizites Rechteck — kein transparenter Rand beim Einbetten.
* Die Meta-Ausgabe von `floorplan render --json` liefert Viewport, Maßstab und Elementzahlen
  für ein Layoutsystem.
