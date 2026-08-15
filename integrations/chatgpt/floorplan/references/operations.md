# Operationen

Änderungen am Modell erfolgen über benannte, schema-validierte Operationen — nicht durch freies
Umschreiben von JSON. Warum: ADR 0009.

Die **normative** Referenz ist die CLI selbst:

```bash
floorplan ops list --json
floorplan ops describe move_opening --json
floorplan ops template create_door
```

`schema/operations.schema.json` wird aus der Registry generiert; ein Test schlägt fehl, falls
Datei und Code auseinanderlaufen.

---

## Dateiformat

```json
{
  "schema_version": "0.1",
  "description": "Optional: was hier fachlich passiert",
  "operations": [
    { "op": "move_opening", "target_id": "door_014", "offset_delta_mm": 800 },
    { "op": "set_state", "target_id": "wall_002", "state": "demolish" }
  ]
}
```

Akzeptiert werden ebenso ein blankes Array oder eine einzelne Operation.

---

## Garantien

| Eigenschaft | Bedeutung |
|---|---|
| **rein** | Das Eingabedokument wird nicht verändert; `apply` liefert ein neues Dokument |
| **atomar** | Schlägt eine Operation fehl, wird der gesamte Stapel verworfen |
| **umkehrbar** | Jeder History-Eintrag enthält die Operationen, die ihn rückgängig machen |
| **deterministisch** | gleiche Eingabe → byteidentisches Ergebnis, ohne Zeitstempel |
| **validiert** | Parameter gegen Schema, fachliche Vorbedingungen gegen das Modell |
| **protokolliert** | `history[]` mit Zusammenfassung, betroffenen IDs und Digest |

---

## Vokabular

### Wände

| Operation | Wirkung |
|---|---|
| `create_wall` | neue Wand aus Mittellinie und Dicke |
| `delete_wall` | Wand **inklusive** der von ihr gehosteten Öffnungen |
| `move_wall` | verschieben, Nachbarn und Raumkanten ziehen mit |
| `set_wall_thickness` | Dicke ändern, Mittellinie bleibt |
| `split_wall` | an einer Stelle teilen, Öffnungen werden zugeordnet |

### Öffnungen

| Operation | Wirkung |
|---|---|
| `create_door` · `create_window` · `create_passage` · `create_opening` | neue Öffnung |
| `delete_opening` | entfernen (jeder Typ) |
| `move_opening` | entlang der Wand verschieben (`offset_delta_mm` oder `offset_mm`) |
| `resize_opening` | Breite/Höhe ändern, symmetrisch um die Mitte |
| `convert_opening` | Typ wechseln, ID und Position bleiben |

### Räume

| Operation | Wirkung |
|---|---|
| `create_space` · `delete_space` | Raum anlegen/entfernen |
| `rename_space` | nur `name`, niemals `id` |
| `set_space_category` · `set_space_boundary` | Kategorie bzw. Polygon setzen |
| `split_space` | mit einer Geraden teilen |
| `merge_spaces` | zwei angrenzende Räume vereinigen |

### Übergreifend

| Operation | Wirkung |
|---|---|
| `set_state` | Bauzustand für ein oder mehrere Elemente |
| `set_provenance` | Herkunft und Sicherheit eines Werts festhalten |
| `set_attribute` | unkritisches Attribut setzen (Whitelist je Typ) |

### Struktur

| Operation | Wirkung |
|---|---|
| `set_element` · `restore_element` · `delete_element` | Low-Level, primär als Inverse |
| `create_level` · `delete_level` | Geschosse |
| `set_project_quality` | Qualitätsstufe — nur mit Nachweis |
| `add_annotation` · `add_dimension` | Beschriftung und Bemaßung |

---

## Bemerkenswerte Details

### `move_wall` zieht mit

Die folgenreichste Operation. Sie verschiebt nicht nur eine Achse:

* **Angrenzende Wände**: Endpunkte, die auf der alten Achse lagen, werden auf die neue Achse
  projiziert. Die Nachbarwand bleibt gerade und wird nur länger oder kürzer. Ist sie parallel
  (keine Projektion möglich), wird ihr Endpunkt mitverschoben.
* **Raumkanten**: Polygonpunkte, die auf einer Fläche der bewegten Wand lagen, verschieben sich
  um den **senkrechten** Anteil der Bewegung. Eine Raumecke, die auf zwei Wandflächen liegt,
  bleibt dadurch korrekt auf der anderen Wand liegen.
* Alles Mitbewegte steht in `affected_ids` und in der Zusammenfassung — nichts passiert still.

```json
{ "op": "move_wall", "target_id": "wall_005", "mode": "offset_normal", "offset_mm": 500 }
{ "op": "move_wall", "target_id": "wall_005", "mode": "translate",
  "delta_mm": { "dx_mm": 0, "dy_mm": -250 } }
```

`offset_mm` positiv = nach links bezogen auf `start → end`. Mit `keep_connections: false` wird
ausschließlich die Wand selbst bewegt.

### `convert_opening` statt löschen und neu anlegen

Für „entferne die Tür und mach einen 1,60 m breiten Durchgang daraus“ ist
`convert_opening` richtig: Die Öffnung behält ihre ID, ihre Position und ihren Platz in der
Historie. Attribute des alten Typs werden entfernt, Pflichtattribute des neuen Typs müssen
mitgegeben werden.

### `set_attribute` hat eine Whitelist

Geometriebestimmende Felder (`start`, `end`, `thickness_mm`, `offset_mm`, `width_mm`,
`boundary`, `host_wall_id`, …) sind **nicht** über `set_attribute` erreichbar. Sie haben eigene
Operationen mit eigenen Prüfungen. `floorplan ops describe set_attribute --json` listet auf,
was je Elementtyp erlaubt ist.

### `set_project_quality` verlangt einen Nachweis

Eine Stufe zu **erhöhen** funktioniert nur, wenn das Dokument auf der Zielstufe fehlerfrei
validiert. Herabstufen ist immer erlaubt. Damit kann eine Qualitätsaussage nicht behauptet,
sondern nur belegt werden.

### `create_window` verlangt `sill_mm`

Die Brüstungshöhe ist ein reales Maß und wird nicht geraten. Wer sie nicht kennt, benutzt
`create_opening` — das Ergebnis ist ein `generic_opening`, also eine ehrliche Aussage über
Nichtwissen.

---

## Historie und Undo

```json
{
  "index": 0,
  "operation": { "op": "move_opening", "target_id": "door_014", "offset_delta_mm": 800 },
  "summary": "Moved door \"door_014\" from 4200 mm to 5000 mm along wall \"wall_spine\".",
  "affected_ids": ["door_014"],
  "inverse": [{ "op": "move_opening", "target_id": "door_014", "offset_delta_mm": -800 }],
  "digest": "3f2a1c4b9d8e7f60"
}
```

```bash
floorplan undo house-v2.floorplan.json --steps 2 --output house-v1.floorplan.json
```

Die Inversen werden in umgekehrter Reihenfolge angewandt und die betroffenen History-Einträge
entfernt. Wo eine natürliche Inverse exakt ist (`move_opening` mit negiertem Delta), wird sie
verwendet, weil sie lesbar ist; sonst kommen vollständige Element-Schnappschüsse zum Einsatz,
die immer exakt sind.

**Verzweigte Historien gibt es bewusst nicht.** Varianten sind Dateien:
`haus-v2.floorplan.json`, `variante-b.floorplan.json`. Git ist der Historienspeicher.

`floorplan inspect <file> --section history` zeigt den Stapel.

---

## Fehlerbehandlung

```json
{
  "ok": false,
  "command": "apply",
  "error": {
    "code": "OPENING_OUTSIDE_WALL",
    "message": "move_opening: offset 9800 mm with width 810 mm spans 9395..10205 mm, outside wall \"wall_spine\" (0..9000 mm).",
    "hint": "offset_mm addresses the centre of the opening, so the valid range here is 405..8595 mm.",
    "op_index": 0
  }
}
```

Jeder Fehler nennt Code, Ursache, den zulässigen Bereich und den Index der Operation im Stapel.
Der Hinweis ist bewusst so formuliert, dass ein Agent sich damit selbst korrigieren kann, ohne
den Quellcode zu lesen.
