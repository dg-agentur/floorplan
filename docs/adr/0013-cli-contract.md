# ADR 0013 — CLI als universelle, agentenfreundliche Schnittstelle

Status: akzeptiert · Datum: 2026-08-15

## Entscheidung

Die CLI ist die **primäre öffentliche Schnittstelle**. Die JS-API ist zweitrangig; jede
Fähigkeit des Cores muss über die CLI erreichbar sein, weil das die einzige Schnittstelle ist,
die alle Agentenplattformen gleichermaßen bedienen können.

## Vertrag

### Exitcodes

| Code | Bedeutung |
|---|---|
| `0` | Erfolg. Bei `validate`: keine ERRORs (WARNINGs erlaubt) |
| `1` | Fachliches Negativergebnis: Validierungsfehler, fehlgeschlagene Operation |
| `2` | Benutzungsfehler: unbekannter Befehl, fehlende Datei, kaputtes JSON |
| `3` | Interner Fehler (Bug) — mit Stacktrace bei `--debug` |

Die Trennung von 1 und 2 ist für Agenten wesentlich: "Der Plan hat einen Fehler" erfordert
eine andere Reaktion als "Ich habe das Werkzeug falsch aufgerufen".

### Ausgabe

* `--json` schaltet auf **maschinenlesbare Ausgabe**: ausschließlich ein JSON-Objekt auf
  `stdout`, nichts anderes. Diagnostik geht auf `stderr`.
* Ohne `--json` erscheint kompakter, für Menschen lesbarer Text auf `stdout`.
* Jede JSON-Ausgabe hat dieselbe Hülle:

```json
{ "ok": true, "command": "validate", "data": { }, "diagnostics": [ ] }
```

* Fehler sind ebenfalls JSON (`"ok": false` mit `error.code`, `error.message`, `error.hint`),
  niemals ein nackter Stacktrace.

### Befehle

```text
floorplan create      <out>                  neues Dokument (leer oder aus Vorlage)
floorplan inspect     <file>                 Struktur, Flächen, Graph, Öffnungen
floorplan validate    <file>                 Schema + Semantik
floorplan apply       <file> <ops>           Operationen anwenden
floorplan undo        <file>                 letzte Operationen zurücknehmen
floorplan render      <file>                 SVG erzeugen
floorplan graph       <file>                 Connectivity-Graph
floorplan reconcile   <observations>         Observations → Floorplan
floorplan ops         list|describe|template Operationsvokabular entdecken
floorplan theme       list|show|validate     Themes
floorplan schema      <name>                 Schema ausgeben
```

### Prinzipien

1. **Nie in-place überschreiben ohne Absicht.** Schreibende Befehle verlangen `--output`
   oder das explizite Flag `--in-place`.
2. **`--dry-run` bei allen schreibenden Befehlen.**
3. **Selbstbeschreibend.** `floorplan ops list --json` und `floorplan ops describe <op> --json`
   geben Schema und Beispiele aus, damit ein Agent das Vokabular zur Laufzeit lernt, statt es
   aus dem Systemprompt zu raten.
4. **`--stamp`** ist der einzige Weg, einen Zeitstempel in eine Ausgabe zu bekommen.
   Ohne ihn sind alle Ausgaben deterministisch.
5. **Keine interaktiven Rückfragen.** Nichts liest von `stdin`, außer explizit über `-`
   angefordert. Ein Agent darf nie in einem Prompt hängen bleiben.
6. **`validate` läuft implizit** nach `apply` und vor `render`. Ein Renderversuch auf einem
   fehlerhaften Modell bricht mit Exitcode 1 ab, es sei denn `--force` ist gesetzt.
   Kaputte Bilder sind schlimmer als keine Bilder.
