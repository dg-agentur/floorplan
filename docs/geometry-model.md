# Geometriemodell

## Einheiten und Achsen

* **Millimeter, ganzzahlig.** Jeder Längenwert im Modell ist ein Integer. Damit sind Additionen
  und Subtraktionen exakt: ein Modell bleibt nach beliebig vielen Operationen fehlerfrei.
* **X nach rechts, Y nach oben.** Winkel mathematisch positiv (gegen den Uhrzeigersinn), 0° = +X.
* **Der Renderer spiegelt Y** (SVG zählt Y nach unten). Diese Spiegelung existiert ausschließlich
  im Renderer.
* Zwischenrechnungen dürfen Gleitkomma sein; **gespeichert wird nur über `roundMm()`**
  (kaufmännische Rundung, `-0` wird zu `0`).

## Toleranzen

Zentral in `src/model/constants.js`, nirgends sonst:

| Konstante | Wert | Bedeutung |
|---|---|---|
| `TOLERANCE_MM` | 1 | Punkte gelten als identisch, Punkt liegt auf Linie, Wände sind verbunden |
| `COLLINEARITY_TOLERANCE_MM` | 2 | Kollinearität bei Wandverschmelzung |
| `PARALLEL_TOLERANCE_DEG` | 0,5 | Parallelität |
| `AREA_TOLERANCE_RATIO` | 0,02 | zulässige Abweichung einer deklarierten Fläche |
| `SPACE_WALL_SNAP_MM` | 30 | maximaler Abstand einer Raumkante von einer Wandfläche |

---

## Wandkörper

Eine Wand ist eine Achse plus Dicke. Der Körper entsteht in drei Schritten.

### 1. Verbindungen (`computeJunctions`)

Zusammenfallende Wandenden werden zu Knoten geclustert und **einmal pro Knoten** aufgelöst.
Beide beteiligten Wände bekommen exakt dieselben Eckpunkte — die Ecke schließt dadurch bitgenau.

**L-Stoß** (genau zwei Enden treffen sich):

```text
       ▲ Wand B
       │
   ────┼────  innere Ecke = Schnitt der beiden einander zugewandten Flächen
   Wand A     äußere Ecke = Schnitt der beiden abgewandten Flächen
```

„Zugewandt“ ist definiert über das Skalarprodukt der Flächennormale mit der Richtung der
jeweils anderen Wand — eine Definition ohne Sonderfälle, die für jeden Winkel funktioniert.
Bei nahezu kollinearen Wänden entfällt die Verschneidung; ein stumpfer Stoß ist dort korrekt.

**T-Stoß** (ein Endpunkt liegt auf der Achse einer anderen Wand): Die ankommende Wand wird um
`other.thickness / 2` verlängert und endet bündig an der Außenkante der durchgehenden Wand.

**X-Stoß** (drei oder mehr Enden): Verlängerung um die größte halbe Dicke der Beteiligten.

**Freies Ende**: stumpfer Abschluss auf dem Achsenendpunkt.

### 2. Segmentierung durch Öffnungen

Die Achse wird an jeder Öffnung zerschnitten. Eine Wand mit zwei Öffnungen ergibt drei massive
Segmente:

```text
0        600      1400     2500     3500    4000
├─solid──┤ ░░░░░░ ├─solid──┤ ░░░░░░ ├─solid─┤
           Tür 1              Tür 2
```

Öffnungen sind **echte Lücken**, keine weiß übermalten Rechtecke. Das ist der Grund, warum
Exporte, spätere Boolean-Operationen und ein späterer DXF-Export korrekt werden — und warum
Türlaibungen automatisch in der Wandkontur erscheinen.

Die Reihenfolge der Öffnungen im Dokument ist ohne Einfluss: die Spans werden sortiert.

### 3. Außenkontur (`unionOutline`)

Wandkörper überlappen sich an Stößen. Statt eine vollständige Boolean-Bibliothek einzuführen,
berechnet der Renderer die Kontur der Vereinigung:

1. Jede Kante jedes Körpers wird an ihren Schnittpunkten mit allen anderen Körpern zerteilt.
2. Für jedes Teilstück werden zwei Probepunkte 0,05 mm links und rechts der Kante gesetzt.
3. Das Teilstück gehört zur Kontur **genau dann, wenn eine Seite innen und die andere außen liegt**.

Damit verschwinden Innenkanten (abstoßende Wände, verschnittene Ecken) automatisch, ohne
Sonderfallbehandlung. Der Algorithmus ist deterministisch: Eingabereihenfolge bleibt erhalten,
Schnittparameter werden numerisch sortiert.

Die Kontur wird **pro Stilgruppe** berechnet. Eine Abbruchwand behält deshalb ihren eigenen
roten, gestrichelten Umriss, während alle Bestandswände nahtlos zu einer Fläche verschmelzen.

---

## Öffnungsgeometrie

Aus Wand und Öffnung ergeben sich:

* `quad` — die Grundfläche der Öffnung innerhalb der Wand (vier Punkte)
* `startReveal` / `endReveal` — die beiden Laibungsflächen
* `center` — Mittelpunkt auf der Achse

Türsymbole werden ausschließlich daraus abgeleitet. Das Türblatt ist ein Rechteck von der
Bandseite in die Aufschlagrichtung, der Bogen ein Viertelkreis um das Band; die
Drehrichtung (SVG `sweep-flag`) folgt aus dem Kreuzprodukt in SVG-Koordinaten und stimmt
deshalb in jeder Wandorientierung.

---

## Polygone

* Positive Fläche (Shoelace) = gegen den Uhrzeigersinn = normalisierte Form.
* `containsPoint` ist Ray-Casting; `containsPointStrict` behandelt den Rand als außen.
* `checkSimple` erkennt Selbstüberschneidungen und erlaubt dabei geteilte Eckpunkte
  benachbarter Kanten.
* `labelPoint` liefert einen Punkt sicher **innerhalb** des Raumes: der Schwerpunkt, sofern er
  weit genug vom Rand entfernt ist, sonst der Rasterpunkt mit dem größten Randabstand.
  Ein L-förmiges Zimmer bekommt dadurch keine Beschriftung im Freien.
* `clipLineToPolygon` schneidet eine Gerade auf die Polygoninnenteile zu — Basis für Treppenstufen
  und Schraffuren.

### Split und Merge

`splitPolygonByLine` schneidet ein einfaches Polygon mit einer Geraden, die den Rand **genau
zweimal** kreuzt. Jeder andere Fall wird mit Begründung abgelehnt, statt ein plausibel
aussehendes, falsches Ergebnis zu liefern.

`mergePolygons` vereinigt zwei Polygone mit gemeinsamer Kante über gerichtete Kantenauslöschung:
bei zwei gegen den Uhrzeigersinn orientierten Ringen kommt eine gemeinsame Kante genau einmal in
jeder Richtung vor und fällt heraus. Die verbleibenden Kanten müssen sich zu **genau einem** Ring
zusammensetzen lassen — sonst ist das Ergebnis kein Raum, und die Operation scheitert.

---

## 2,5D

Grundrissgeometrie ist XY. Vertikale Information sind Skalare:

```text
Level.elevation_mm   OKFF über Projektnull
Level.height_mm      lichte Geschosshöhe
Wall.height_mm       Wandhöhe, Wall.base_z_mm Sockelversatz
Opening.sill_mm      Brüstung, Opening.height_mm Öffnungshöhe
Space.height_mm      lichte Raumhöhe
```

`bottom_z_mm` und `top_z_mm` werden **berechnet**, nie gespeichert — es kann also keine
widersprüchliche Redundanz entstehen. Ein späterer 3D-Preview ist reine Extrusion.

Nicht darstellbar in v0.1: gekrümmte Wände, Dachschrägen, Split-Level, schiefe Wände.
Erweiterungspfade dafür in `docs/extension-points.md`.
