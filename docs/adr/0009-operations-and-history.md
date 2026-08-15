# ADR 0009 — Operationsmodell, Atomarität und Historie

Status: akzeptiert · Datum: 2026-08-15

## Entscheidung

Änderungen am Modell erfolgen über **benannte, schema-validierte Operationen**, nicht durch
freies Umschreiben von JSON.

```json
{
  "schema_version": "0.1",
  "operations": [
    { "op": "move_opening", "target_id": "door_014", "offset_delta_mm": 800 },
    { "op": "set_state", "target_id": "wall_002", "state": "demolish" }
  ]
}
```

### Eigenschaften

| Eigenschaft | Umsetzung |
|---|---|
| **rein** | `apply(doc, ops)` mutiert die Eingabe nicht (strukturierte Tiefkopie) |
| **atomar** | Schlägt eine Operation fehl, wird der gesamte Batch verworfen |
| **validierbar** | Jede Operation hat ein JSON-Schema und eine `precheck`-Funktion |
| **umkehrbar** | Jede Operation liefert ihre **Inverse** zurück |
| **protokolliert** | `document.history[]` enthält Operation, Zusammenfassung und Inverse |
| **beschreibbar** | `floorplan ops list --json` liefert das vollständige Vokabular |

## Warum atomar?

Ein LLM-Agent schickt typischerweise mehrere zusammengehörige Operationen ("Tür entfernen,
Durchgang einsetzen"). Ein Teilerfolg hinterlässt ein Modell in einem Zustand, den weder
Agent noch Mensch erwartet hat. Alles-oder-nichts ist die einzige Semantik, bei der ein
Fehlschlag folgenlos bleibt und der Agent gefahrlos korrigieren kann.

## Undo ohne Event Sourcing

Vollständiges Event Sourcing (Rebuild aus Log, Snapshots, Projektionen) wäre für Dateien
überdimensioniert. Stattdessen:

* Jede Operation erzeugt bei der Anwendung ihre **Inverse** als vollständige Operation.
  `delete_wall` liefert ein `create_wall` mit dem kompletten Zustand des gelöschten Elements
  (inklusive der Öffnungen, die daran hingen).
* Die Inversen liegen in `history[].inverse`.
* `floorplan undo file --steps 2` wendet die letzten Inversen in umgekehrter Reihenfolge an
  und entfernt die entsprechenden History-Einträge.

Das ist ein linearer Undo-Stack — ausreichend, verständlich, testbar. Verzweigte Historien
(Varianten) werden bewusst über **Dateien** abgebildet: `haus-v2.floorplan.json`,
`variante-b.floorplan.json`. Dateien sind das Versionierungsmedium; Git ist der Historienspeicher.

## Determinismus der Historie

History-Einträge enthalten **keinen Zeitstempel**, außer die CLI wird mit `--stamp <iso8601>`
aufgerufen. Ohne Stempel ist `apply` bit-deterministisch — Voraussetzung für Golden-Tests
und für reproduzierbare Agentenläufe.

Jeder Eintrag trägt `ops_digest` (SHA-256 über die kanonisierte Operation) zur
Nachvollziehbarkeit.

## Operationsvokabular v0.1

```text
Wände      create_wall · delete_wall · move_wall · split_wall · set_wall_thickness
Öffnungen  create_door · create_window · create_passage · create_opening
           delete_opening · move_opening · resize_opening · convert_opening
Räume      create_space · delete_space · rename_space · set_space_category
           set_space_boundary · split_space · merge_spaces
Allgemein  set_state · set_provenance · set_attribute
Struktur   create_level · set_project_quality · add_annotation · add_dimension
```

`delete_door` aus der Aufgabenstellung ist `delete_opening` — ein Alias wäre eine zweite
Wahrheit über dieselbe Sache. Die CLI meldet bei unbekanntem Operationsnamen die nächstliegende
gültige Operation, damit ein Agent sich selbst korrigieren kann.

## Warum `set_attribute` mit Whitelist?

Ein generisches "setze irgendein Feld" wäre bequem, würde aber die Validierbarkeit aushebeln.
`set_attribute` akzeptiert daher nur eine je Elementtyp definierte Liste unkritischer Felder
(`name`, `tags`, `material`, `notes`, `height_mm`, …). Geometrieverändernde Felder
(`start`, `end`, `offset_mm`, `boundary`, …) sind ausgeschlossen und ausschließlich über ihre
spezifischen Operationen erreichbar.
