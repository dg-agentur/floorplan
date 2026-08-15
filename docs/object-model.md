# Objektmodell

Normativ ist `schema/floorplan.schema.json`. Dieses Dokument erklärt die Absicht dahinter.

## Hierarchie

```text
FloorplanDocument
├── schema_version  "0.1"                Pflicht
├── unit            "mm"                 Pflicht, fest
├── project         Metadaten + Qualitätsstufe + Defaults
├── sources[]       Herkunftsnachweise (Foto, PDF, Aufmaß …)
├── buildings[]
│   └── levels[]
│       ├── walls[]
│       ├── openings[]     door | window | passage | generic_opening
│       ├── spaces[]
│       ├── columns[]
│       ├── stairs[]
│       ├── shafts[]
│       ├── dimensions[]
│       └── annotations[]
├── history[]       angewandte Operationen inkl. Inverse
└── revision        Ganzzahl
```

Die Verschachtelung ist die Containerhierarchie. **IDs sind trotzdem dokumentweit eindeutig**,
sodass jede Operation nur eine ID braucht und nicht wissen muss, in welchem Geschoss ein
Element liegt.

---

## project

```json
{
  "id": "project_001",
  "name": "Musterstraße 12, Wohnung 3",
  "quality": "scaled",
  "defaults": {
    "state": "existing",
    "provenance": "measured",
    "wall_height_mm": 2550
  }
}
```

`defaults` ist der einzige Ort für dokumentweite Vorbelegungen. Aufgelöst wird immer in der
Reihenfolge **Element → defaults → fest kodierter Fallback**. Es gibt keine weiteren impliziten
Werte; `floorplan inspect` zeigt jeden aufgelösten Wert an.

`quality` ist kein Etikett, sondern der Schalter für die Severity-Matrix des Validators
(→ `docs/validation.md`, ADR 0015).

---

## Wall

```json
{
  "id": "wall_001",
  "type": "wall",
  "name": "Südfassade",
  "start": { "x_mm": 0, "y_mm": 0 },
  "end":   { "x_mm": 8400, "y_mm": 0 },
  "thickness_mm": 300,
  "height_mm": 2600,
  "classification": "exterior",
  "state": "existing",
  "provenance": "measured"
}
```

* `start`/`end` sind die **Mittellinie**, nicht eine Kante (ADR 0004).
* Der gezeichnete Wandkörper wird zur Laufzeit berechnet, inklusive Eckverschneidung.
* `classification`: `exterior` · `interior` · `partition` · `structural` · `retaining` · `virtual`.
  `virtual` ist eine Raumtrennung ohne Bauteil (z. B. die gedachte Grenze in einem offenen
  Wohn-Ess-Bereich) — sie wird gestrichelt oder gar nicht gezeichnet.
* Zwei Wände treffen sich nur dann sauber, wenn ihre Endpunkte **exakt identisch** sind.
  Der Validator meldet Beinahe-Treffer als `WALL_ENDPOINTS_NEAR_MISS`.

---

## Opening

Vier Typen, eine gemeinsame Verankerung:

```text
Opening
├── door             mit Türblatt (door_type, hinge, swing)
├── window           mit Brüstung (window_type, sill_mm)
├── passage          Wandöffnung ohne Türblatt
└── generic_opening  Öffnung unbekannter Semantik
```

```json
{
  "id": "door_014",
  "type": "door",
  "host_wall_id": "wall_008",
  "offset_mm": 1840,
  "width_mm": 1010,
  "height_mm": 2110,
  "door_type": "swing",
  "hinge": "left",
  "swing": "left",
  "connects_space_ids": ["space_kitchen", "space_hallway"]
}
```

### Die Offset-Konvention

`offset_mm` misst von `wall.start` entlang der Mittellinie bis zur **Mitte** der Öffnung.
Eine 1010 mm breite Tür bei `offset_mm: 1840` belegt 1335 … 2345 mm.

Das ist die wichtigste einzelne Konvention des Modells. Sie steht in ADR 0005, im Schema, im
Agent Contract und in der Fehlermeldung von `OPENING_OUTSIDE_WALL` — bewusst mehrfach.

### Richtungen bei Türen

Blickrichtung ist immer `wall.start → wall.end`.

| Feld | Wert | Bedeutung |
|---|---|---|
| `hinge` | `left` | Band am `start`-näheren Rand der Öffnung |
| `hinge` | `right` | Band am `end`-näheren Rand |
| `swing` | `left` | Blatt schlägt auf die +90°-Seite auf (gegen den Uhrzeigersinn) |
| `swing` | `right` | Blatt schlägt auf die −90°-Seite auf |
| `swing` | `none` | kein Aufschlag (Schiebetür) |
| `swing` fehlt | | **unbekannt** — der Renderer zeichnet das Blatt geschlossen, ohne Bogen |

„nach innen“ / „nach außen“ ist daraus ableitbar und wird von
`floorplan inspect --section openings` als `swings_into_space_id` ausgegeben. Gespeichert wird
die eindeutige geometrische Angabe, nicht die kontextabhängige Formulierung.

### connects_space_ids

Optional und **redundant**. Die Topologieschicht leitet die Raumbeziehung aus der Geometrie ab.
Ist das Feld gesetzt und widerspricht der Geometrie, meldet der Validator
`OPENING_CONNECTIVITY_MISMATCH`. Das Feld ist nützlich für Importe und Teilmodelle ohne Räume,
aber es ist nie die alleinige Wahrheit.

---

## Space

```json
{
  "id": "space_kitchen",
  "type": "space",
  "name": "Wohnküche",
  "category": "kitchen",
  "boundary": [
    { "x_mm": 150, "y_mm": 150 },
    { "x_mm": 4350, "y_mm": 150 },
    { "x_mm": 4350, "y_mm": 3550 },
    { "x_mm": 150, "y_mm": 3550 }
  ],
  "height_mm": 2550,
  "state": "existing",
  "provenance": "derived",
  "verified": true
}
```

* `boundary` ist implizit geschlossen (letzten Punkt **nicht** wiederholen), mindestens 3 Punkte,
  gegen den Uhrzeigersinn. Die Orientierung wird beim Erzeugen normalisiert.
* Der Rand folgt der **lichten Innenkante** der umschließenden Wände.
* Die Fläche wird **immer** aus dem Polygon berechnet und nie gespeichert.
* `area_override_mm2` nimmt eine extern vorgegebene Fläche auf (z. B. aus einem Exposé).
  Sie verändert **nie** die Geometrie; bei einer Abweichung über 2 % meldet der Validator
  `SPACE_AREA_MISMATCH`.
* `category` steuert Theme-Farben und spätere Fachregeln. Sie ist **keine** rechtliche
  Nutzungsklassifikation.

Die berechnete Fläche heißt konsequent **Grundfläche** (`floor_area_m2`), nicht Wohnfläche —
eine Wohnflächenberechnung braucht Informationen, die ein 2,5D-Modell nicht trägt (ADR 0003).

---

## Stair

```json
{
  "id": "stair_001",
  "type": "stair",
  "footprint": [ … ],
  "run_start": { "x_mm": 6100, "y_mm": 6000 },
  "run_end":   { "x_mm": 6100, "y_mm": 8400 },
  "step_count": 13,
  "direction": "up",
  "to_level_id": "level_og"
}
```

`footprint` ist die Grundfläche, `run_start`→`run_end` die Laufachse (Richtung des Aufstiegs).
**Stufenlinien werden nur gezeichnet, wenn `step_count` bekannt ist.** Ohne diese Angabe zeigt
der Renderer nur Umriss und Laufpfeil — er erfindet keine Steigungshöhe, damit ein Bild
vollständig aussieht.

---

## Column, Shaft, Dimension, Annotation

* **Column**: `shape: rect|circle` mit `width_mm`/`depth_mm` bzw. `diameter_mm`, `rotation_deg`.
* **Shaft**: Polygon plus `shaft_kind` (`elevator`, `duct`, `chimney`, `plumbing`, `other`).
* **Dimension**: zwei Punkte plus `offset_mm` (senkrechter Versatz der Maßlinie).
  Der **Wert** wird aus den Punkten berechnet und nie gespeichert; `label_override` ersetzt
  lediglich den angezeigten Text.
* **Annotation**: Position plus Text. Beeinflusst weder Geometrie noch Validierung.

---

## Zustände (Bestand versus Planung)

`state` ∈ `existing` · `planned` · `new` · `demolish` · `unknown`, verfügbar an Wall, Opening,
Space, Column, Stair und Shaft.

Ein Umbau braucht **kein** zweites Dokument:

```text
wall_ext_*          existing     Bestand bleibt
wall_old_partition  demolish     wird abgebrochen
wall_new_partition  new          kommt neu hinzu
door_planned        planned      geplant, noch nicht ausgeführt
```

Konvention: **Räume beschreiben in der Regel den Planungszustand**, die `state`-Angaben an den
Bauteilen beschreiben, was mit der Substanz passiert. `fixtures/05-renovation/` zeigt das
vollständig.

---

## Provenance-Felder an jedem Element

```json
"provenance": "estimated",
"confidence": 0.72,
"verified": false,
"property_provenance": {
  "thickness_mm": { "provenance": "measured", "verified": true }
}
```

Details in `docs/provenance.md` und ADR 0008.

---

## meta

Jedes Element darf ein Objekt `meta` mit beliebigem Inhalt tragen. Das ist der einzige Ort für
anwendungsspezifische Daten (z. B. eine CRM-ID des Maklers). Alles andere ist strikt validiert:
unbekannte Felder sind ein Fehler, damit ein Tippfehler wie `thikness_mm` laut scheitert statt
still verloren zu gehen (ADR 0010).
