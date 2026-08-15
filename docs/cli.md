# CLI-Referenz

Die CLI ist die primäre öffentliche Schnittstelle. Jede Fähigkeit des Kerns ist über sie
erreichbar, weil sie die einzige Schnittstelle ist, die alle Agentenplattformen gleichermaßen
bedienen können (ADR 0013).

```bash
node bin/floorplan.js <command> [options]
# oder nach `npm link` bzw. Installation:
floorplan <command> [options]
```

## Globale Konventionen

| Flag | Wirkung |
|---|---|
| `--json` | genau ein JSON-Objekt auf `stdout`, Diagnostik auf `stderr` |
| `--debug` | Stacktrace bei internen Fehlern |
| `--help` | Nutzung des jeweiligen Befehls |

**Exit-Codes**

| Code | Bedeutung |
|---|---|
| 0 | Erfolg |
| 1 | fachliches Negativergebnis (Validierungsfehler, fehlgeschlagene Operation) |
| 2 | Benutzungsfehler (unbekannter Befehl/Flag, fehlende Datei, kaputtes JSON) |
| 3 | interner Fehler |

Die Trennung von 1 und 2 ist für Agenten wesentlich: „Der Plan hat einen Fehler“ verlangt eine
andere Reaktion als „Ich habe das Werkzeug falsch aufgerufen“.

**JSON-Hülle**

```json
{ "ok": true, "command": "validate", "data": { }, "diagnostics": [ ] }
```

Im Fehlerfall:

```json
{ "ok": false, "command": "apply",
  "error": { "code": "…", "message": "…", "hint": "…", "op_index": 0 },
  "diagnostics": [ ] }
```

**Weitere Regeln**

* Schreibende Befehle überschreiben nie implizit: `--output`, `--in-place` oder `--dry-run`.
* Nichts liest von `stdin`, nichts fragt interaktiv nach.
* Ohne `--stamp <iso8601>` enthält keine Ausgabe einen Zeitstempel.

---

## create

```bash
floorplan create <out.floorplan.json> [options]
```

| Option | Bedeutung |
|---|---|
| `--template empty\|room` | leeres Dokument oder ein Rechteckraum |
| `--name <text>` · `--project-id <id>` · `--level-name <text>` | Metadaten |
| `--quality marketing\|scaled\|verified` | Startstufe (Default `marketing`) |
| `--width-mm` · `--depth-mm` | **lichte Innenmaße**, Pflicht bei `--template room` |
| `--wall-thickness-mm` · `--wall-height-mm` | Bauteilmaße |
| `--force` | vorhandene Datei überschreiben |

```bash
floorplan create wohnung.floorplan.json --template room \
  --width-mm 4200 --depth-mm 3400 --wall-thickness-mm 300 --name "Musterwohnung"
```

Ohne `--width-mm`/`--depth-mm` scheitert `--template room` bewusst: Maße werden nicht geraten.

---

## inspect

```bash
floorplan inspect <file> [--section <s>] [--level <id>] [--json]
```

`--section`: `summary` (Default) · `levels` · `walls` · `openings` · `spaces` · `graph` ·
`provenance` · `history` · `all`

```bash
floorplan inspect haus.floorplan.json --section spaces
floorplan inspect haus.floorplan.json --section provenance --json
floorplan inspect haus.floorplan.json --section all --json      # alles auf einmal
```

`--section openings` liefert zu jeder Tür zusätzlich die **abgeleiteten** Rauminformationen:
`derived_space_ids`, `swings_into_space_id`, `leads_outside`.

---

## validate

```bash
floorplan validate <file> [--quality <q>] [--min-severity <s>] [--quiet] [--json]
```

| Option | Bedeutung |
|---|---|
| `--quality marketing\|scaled\|verified` | gegen eine andere Stufe prüfen, ohne das Dokument zu ändern |
| `--min-severity ERROR\|WARNING\|INFO` | Ausgabe filtern |
| `--no-schema` | nur semantische Regeln |
| `--quiet` | nur eine Zeile Ergebnis |

```bash
floorplan validate haus.floorplan.json
floorplan validate haus.floorplan.json --quality verified --json   # was fehlt noch?
```

---

## apply

```bash
floorplan apply <file> <ops.json> [--output <f> | --in-place | --dry-run] [--force] [--stamp <iso>]
```

Wendet einen Operationsstapel **atomar** an, validiert anschließend und schreibt nur, wenn keine
Fehler auftreten (`--force` überschreibt diese Sperre).

```bash
floorplan apply haus.floorplan.json aenderungen.ops.json --output haus-v2.floorplan.json
floorplan apply haus.floorplan.json aenderungen.ops.json --dry-run --json
```

---

## undo

```bash
floorplan undo <file> [--steps <n>] [--output <f> | --in-place | --dry-run]
```

Nimmt die letzten `n` History-Einträge über ihre gespeicherten Inversen zurück.

---

## render

```bash
floorplan render <file> [--theme <t>] [--output <f>] [--level <id>] [--title <t>] [--force]
```

Ohne `--output` geht das SVG auf `stdout`. Validiert vorher; `--force` rendert trotzdem,
`--skip-validation` überspringt die Prüfung ganz.

```bash
floorplan render haus.floorplan.json --theme marketing --output haus.svg
floorplan render haus.floorplan.json --theme ./themes/kunde-a.yaml --output haus.svg
floorplan render haus.floorplan.json --level level_og --output og.svg
```

---

## graph

```bash
floorplan graph <file> [--level <id>] [--from <space>] [--to <space>] [--include-windows]
```

```bash
floorplan graph wohnung.floorplan.json                                   # alle Verbindungen
floorplan graph wohnung.floorplan.json --from space_hall                 # was ist erreichbar?
floorplan graph wohnung.floorplan.json --from space_kitchen --to space_bath   # Weg
```

Fenster gelten als Verbindung, aber nicht als begehbar; `--include-windows` bezieht sie in
Wegsuche und Erreichbarkeit ein.

---

## reconcile

```bash
floorplan reconcile <observations.json> [--output <f>] [options]
```

| Option | Default | Bedeutung |
|---|---|---|
| `--min-confidence <0..1>` | 0.5 | Schwelle für die Übernahme |
| `--snap-mm <n>` | 10 | Raster für das Einrasten von Koordinaten |
| `--max-host-distance-mm <n>` | 400 | maximaler Abstand einer Öffnung zu ihrer Wand |
| `--default-thickness-mm <n>` | — | **explizite** Annahme für Wände ohne Dicke |
| `--project-name` · `--project-id` | — | Metadaten |

Gibt einen Bericht aus, der **jede nicht verwertete Beobachtung mit Begründung** nennt.

---

## ops — die Entdeckungsschnittstelle für Agenten

```bash
floorplan ops list [--category <c>] [--json]
floorplan ops describe <op> [--json]
floorplan ops template <op> [<op> …]
```

`ops list --json` liefert das vollständige Änderungsvokabular mit Pflicht- und Optionalparametern,
`ops describe` zusätzlich das JSON-Schema und ein lauffähiges Beispiel. Ein Agent muss deshalb
weder Operationsnamen noch Parameter aus einem Systemprompt raten.

---

## theme

```bash
floorplan theme list
floorplan theme show <name>
floorplan theme validate <name|pfad>
floorplan theme schema
```

---

## schema

```bash
floorplan schema                 # verfügbare Schemas
floorplan schema floorplan       # das Datenmodell selbst
floorplan schema operations
floorplan schema observations
floorplan schema theme
```

---

## rules

```bash
floorplan rules [--json]
```

Alle Validierungsregeln mit ihrer Severity je Qualitätsstufe und einer Kurzbeschreibung.

---

## Typischer Agentenablauf

```bash
floorplan inspect  plan.floorplan.json --section all --json
floorplan ops describe move_opening --json
# … aenderungen.ops.json schreiben …
floorplan apply    plan.floorplan.json aenderungen.ops.json --output plan-v2.floorplan.json --json
floorplan validate plan-v2.floorplan.json --json
floorplan render   plan-v2.floorplan.json --theme marketing --output plan-v2.svg --json
```
