---
description: Setzt einen Änderungswunsch als validierte Operationsdatei um
argument-hint: <datei.floorplan.json> <änderungswunsch in Worten>
allowed-tools: Bash(floorplan:*), Bash(node:*), Read, Write, Edit
---

Setze diesen Änderungswunsch am Grundriss `$1` um: **$2**

Ablauf — halte ihn ein, überspringe nichts:

1. **Lesen.** `floorplan inspect $1 --section all --json` und `floorplan graph $1 --json`.
   Ermittle die betroffenen IDs. Rate niemals eine ID.
2. **Vokabular klären.** `floorplan ops list --json`, bei Bedarf
   `floorplan ops describe <operation> --json`.
3. **Operationsdatei schreiben.** `<name>.ops.json` mit `schema_version`, einer `description`
   in einem Satz und den Operationen. Bevorzuge die spezifische Operation:
   - Tür versetzen → `move_opening` (nicht löschen und neu anlegen)
   - Tür zu Durchgang → `convert_opening` (die Öffnung behält ihre Identität)
   - Wand entfernen → `delete_wall` (nimmt die Öffnungen mit)
   - Bestandswand abbrechen → `set_state` mit `demolish`
4. **Trocken testen.** `floorplan apply $1 <name>.ops.json --dry-run --json`.
   Bei einem Fehler: Meldung und `hint` lesen, korrigieren, erneut versuchen.
5. **Anwenden.** `floorplan apply $1 <name>.ops.json --output <name-v2>.floorplan.json --json`
   Schreibe in eine **neue** Datei, überschreibe das Original nicht.
6. **Rendern.** Vorher und nachher, gleiches Theme, damit der Unterschied sichtbar wird.

Berichte anschließend:

- was jede Operation konkret bewirkt hat (die `summary` aus dem Ergebnis)
- welche weiteren Elemente mitverändert wurden (`affected_ids`) — besonders bei `move_wall`
- welche Validierungsmeldungen neu sind
- alle Annahmen, die du getroffen hast, ausdrücklich als Annahmen

Bei mehrdeutigen Richtungsangaben („nach rechts“): `offset_delta_mm` ist positiv in Richtung
`wall.end`. Prüfe die Wandrichtung und schreibe in die Antwort, welche Richtung du verwendet hast.

Fehlt für die Änderung ein Maß, das du nicht kennst: **frag nach**. Erfinde es nicht.
Der fachliche Vertrag steht in `docs/agent-contract.md`.
