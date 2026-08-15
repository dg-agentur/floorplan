# ADR 0005 — Verankerung von Öffnungen (Doors, Windows, Passages)

Status: akzeptiert · Datum: 2026-08-15

## Entscheidung

Eine Öffnung ist **parametrisch an ihrer Wand verankert**:

```json
{
  "id": "door_014",
  "type": "door",
  "host_wall_id": "wall_008",
  "offset_mm": 1840,
  "width_mm": 1010
}
```

* `offset_mm` ist der Abstand von `wall.start` entlang der **Wandmittellinie** bis zur
  **Mitte der Öffnung**.
* Die Öffnung erstreckt sich von `offset_mm - width_mm/2` bis `offset_mm + width_mm/2`.
* Öffnungen besitzen **keine** eigenen Weltkoordinaten. Absolute Punkte werden bei Bedarf aus
  Wand + Offset berechnet (`geometry/openingGeometry.js`).

## Warum Mitte und nicht Kante?

* `move_opening` mit `offset_delta_mm` verschiebt die Öffnung um genau diesen Betrag —
  intuitiv für Menschen und Agenten ("die Tür 80 cm nach rechts").
* `resize_opening` verändert die Breite **symmetrisch** um denselben Mittelpunkt und bewegt
  die Tür damit nicht ungewollt.
* "Die Tür sitzt bei 1,84 m" ist die Formulierung, die ein Sprachmodell aus natürlicher
  Sprache am zuverlässigsten produziert.

Die Kanten-Konvention wäre CAD-näher, erzeugt aber bei jeder Breitenänderung eine
Positionsverschiebung — eine typische stille Fehlerquelle.

## Warum keine absoluten Koordinaten?

Weil sonst jede Wandänderung die Türen an Ort und Stelle stehen ließe und das Modell still
inkonsistent würde. Mit parametrischer Verankerung folgt eine Tür ihrer Wand automatisch bei
`move_wall`, `split_wall` und Wandverlängerungen. Das ist der Kern von "Semantik statt Linien".

## Öffnungstypen

```text
Opening (abstrakt, gemeinsame Felder)
├── door             hat Türblatt: door_type, hinge, swing
├── window           hat Brüstung: window_type, sill_mm
├── passage          Wandöffnung ohne Türblatt (Durchgang)
└── generic_opening  Öffnung unbekannter Semantik (z. B. aus Rekonstruktion)
```

Die Unterscheidung ist semantisch, nicht geometrisch: alle vier unterbrechen die Wand identisch;
sie unterscheiden sich in Zusatzattributen, Symbolik und Validierungsregeln.
`generic_opening` existiert genau deshalb, damit eine Rekonstruktion **nicht raten muss**, ob
eine erkannte Lücke eine Tür oder ein Durchgang ist.

## Schwenkrichtung von Türen

Statt der mehrdeutigen Begriffe "inward/outward" verwendet das Schema zwei geometrisch
eindeutige Felder, jeweils bezogen auf die Blickrichtung `wall.start → wall.end`:

| Feld | Werte | Bedeutung |
|---|---|---|
| `hinge` | `left` \| `right` | `left` = Bandseite am `start`-näheren Rand der Öffnung |
| `swing` | `left` \| `right` \| `none` | auf welche Wandseite das Blatt aufschlägt; `left` = +90° (CCW) zur Wandrichtung |

`inward` / `outward` ist daraus **ableitbar**, sobald bekannt ist, welcher Raum als "innen" gilt:
`floorplan inspect --section openings` gibt zu jeder Tür aus, in welchen Space das Blatt schlägt
(`swings_into_space_id`). Damit bleibt die gespeicherte Information eindeutig und die
menschliche Formulierung trotzdem verfügbar.

## Raumbezug

`connects_space_ids` ist **optional und redundant**: Die Topologieschicht leitet aus der
Geometrie ab, welche Räume beidseits der Öffnung liegen. Ist das Feld gesetzt und widerspricht
der Geometrie, meldet der Validator `OPENING_CONNECTIVITY_MISMATCH` (WARNING/ERROR je
Qualitätsstufe). Damit ist das Feld nützlich (Importe, Teilmodelle ohne Räume) und trotzdem
nicht die alleinige Wahrheit.
