# Validierung

Der Validator ist kein Nebenprodukt, sondern ein Kernbestandteil des Produkts. Er beantwortet
die Frage, ob man einem Modell trauen kann.

## Zwei Stufen

1. **Schema** (`src/validation/schemaValidator.js`) — struktureller Vertrag. Pflichtfelder,
   Typen, Wertebereiche, keine unbekannten Felder. Fehler nennen einen JSON-Pointer.
2. **Semantik** (`src/validation/semantic/*`) — der eigentliche Wert: Referenzen, Geometrie,
   Topologie, Provenance, Plausibilität.

Semantische Regeln laufen nur, wenn das Schema erfüllt ist — Regeln auf einem strukturell
kaputten Dokument erzeugen Rauschen, keine Information.

## Drei Kategorien, sauber getrennt

```text
geometrische Gültigkeit      wird geprüft
architektonische Plausibilität  wird als Hinweis gemeldet (immer INFO, nie Anforderung)
rechtliche Zulässigkeit      wird NICHT geprüft und nicht behauptet
```

Version 0.1 macht **keine** baurechtlichen Aussagen: keine Fluchtwege, keine Mindestraumgrößen,
keine Brandschutzanforderungen, keine Wohnflächenberechnung nach WoFlV. Regeln der Kategorie
„Plausibilität“ (`DOOR_WIDTH_UNUSUAL`, `WALL_THICKNESS_UNUSUAL`) tragen ihre Bereiche
datengetrieben in `src/validation/semantic/plausibility.js` und den Hinweis
„Common practice only — not a requirement“.

Ein späteres Regelwerksmodul kann diese Tabelle durch belegte Werte mit Quellenangabe ersetzen,
ohne den Kern zu berühren (→ `docs/extension-points.md`).

## Severity ist eine Funktion der Qualitätsstufe

Regeln melden **Sachverhalte**, nicht Schweregrade. Die Zuordnung trifft eine einzige Tabelle:
`src/validation/severityPolicy.js`.

```bash
floorplan rules            # die vollständige Matrix
floorplan rules --json
```

Auszug:

| Regel | marketing | scaled | verified |
|---|---|---|---|
| `SCHEMA_VIOLATION` | ERROR | ERROR | ERROR |
| `DUPLICATE_ID` | ERROR | ERROR | ERROR |
| `OPENING_OUTSIDE_WALL` | ERROR | ERROR | ERROR |
| `SPACE_OVERLAP` | WARNING | ERROR | ERROR |
| `SPACE_BOUNDARY_OFF_WALL` | INFO | WARNING | ERROR |
| `SPACE_AREA_MISMATCH` | INFO | WARNING | ERROR |
| `OPENING_CONNECTIVITY_MISMATCH` | WARNING | ERROR | ERROR |
| `PROVENANCE_ESTIMATED` | INFO | WARNING | ERROR |
| `GEOMETRY_NOT_ANCHORED` | INFO | ERROR | ERROR |
| `DOOR_WIDTH_UNUSUAL` | INFO | INFO | INFO |

Ein Test erzwingt, dass die Severity über die Stufen hinweg **nie schwächer** wird.

## Die Regeln

### Referenzielle Integrität — immer fatal

`DUPLICATE_ID` · `UNKNOWN_HOST_WALL` · `HOST_WALL_OTHER_LEVEL` · `UNKNOWN_SPACE_REF` ·
`UNKNOWN_LEVEL_REF` · `UNKNOWN_SOURCE_REF` · `NON_FINITE_NUMBER` · `LEVEL_INDEX_DUPLICATE` ·
`EMPTY_LEVEL`

`NON_FINITE_NUMBER` ist nicht überflüssig, obwohl JSON weder NaN noch Infinity kennt: ein über
die JS-API zusammengebautes Dokument kann beides enthalten.

### Geometrie

| Regel | Prüft |
|---|---|
| `WALL_ZERO_LENGTH` | Wand ohne Länge |
| `OPENING_OUTSIDE_WALL` | Öffnung passt nicht in ihre Wand (Mitten-Konvention!) |
| `OPENING_WIDER_THAN_WALL` | Öffnung breiter als die Wand lang ist |
| `OPENING_OVERLAP` | zwei Öffnungen derselben Wand überlappen |
| `OPENING_NEAR_WALL_END` | weniger als 50 mm Restwand daneben |
| `WINDOW_ABOVE_WALL` | Brüstung + Höhe größer als die Wandhöhe |
| `SPACE_SELF_INTERSECTING` | Raumrand kreuzt sich selbst |
| `SPACE_DEGENERATE` | Raum ohne nutzbare Fläche |
| `SPACE_OVERLAP` | zwei Räume überlappen |
| `SPACE_BOUNDARY_OFF_WALL` | Raumkante folgt keiner Wandfläche |
| `SPACE_AREA_MISMATCH` | deklarierte Fläche weicht vom Polygon ab |
| `WALL_ENDPOINTS_NEAR_MISS` | zwei Wandenden fast, aber nicht exakt deckungsgleich |
| `WALL_FREE_END` | Wandende trifft nichts |
| `STAIR_RUN_OUTSIDE_FOOTPRINT` | Laufachse liegt nicht im Grundriss der Treppe |

`WALL_ENDPOINTS_NEAR_MISS` ist die praktisch wichtigste Warnung bei Rekonstruktionen: ein
3-mm-Versatz verhindert die Eckverschneidung und lässt den Plan ausfransen.

### Topologie

| Regel | Prüft |
|---|---|
| `OPENING_CONNECTIVITY_MISMATCH` | `connects_space_ids` widerspricht der Geometrie |
| `OPENING_WITHOUT_SPACE` | beidseits der Öffnung kein Raum gefunden |
| `SPACE_ISOLATED` | Raum ohne jede Tür oder Durchgang |
| `PLAN_DISCONNECTED` | Geschoss zerfällt in mehrere unverbundene Gruppen |
| `SPACE_WITHOUT_EXIT` | Raum erreicht über Öffnungen nicht das Freie |

`SPACE_WITHOUT_EXIT` ist eine **geometrische** Feststellung über das Geschoss, ausdrücklich
keine Aussage über Rettungswege. Der Hinweistext sagt das auch so.

### Provenance

`PROVENANCE_ESTIMATED` · `PROVENANCE_UNKNOWN` · `MISSING_SCALE_REFERENCE` ·
`GEOMETRY_NOT_ANCHORED` · `UNVERIFIED_VALUES` → `docs/provenance.md`

### Plausibilität — immer INFO

`DOOR_WIDTH_UNUSUAL` · `WALL_THICKNESS_UNUSUAL` · `SPACE_WITHOUT_CATEGORY`

## Ausgabe

```bash
floorplan validate haus.floorplan.json --json
```

```json
{
  "ok": true,
  "quality": "scaled",
  "schema_valid": true,
  "counts": { "ERROR": 0, "WARNING": 2, "INFO": 5 },
  "issues": [
    {
      "severity": "WARNING",
      "rule": "SPACE_BOUNDARY_OFF_WALL",
      "element_id": "space_hall",
      "level_id": "level_eg",
      "message": "2 of 6 boundary edges of space \"space_hall\" are further than 30 mm from any wall face.",
      "hint": "Room boundaries should follow the clear inner face of the enclosing walls …",
      "data": { "edge_indices": [3, 4] }
    }
  ]
}
```

* `ok` ist genau dann `true`, wenn `counts.ERROR === 0`.
* Die Reihenfolge ist deterministisch: Severity, dann Regel, dann Element, dann Pointer.
* Massenbefunde werden zusammengefasst (`… and 18 further value(s)`), damit ein Bericht lesbar
  bleibt. `UNVERIFIED_VALUES` ist vollständig aggregiert, weil eine Zeile pro Wert nicht
  handlungsleitend ist.

Exit-Codes: `0` gültig · `1` mindestens ein ERROR · `2` Benutzungsfehler.

## Eine Regel hinzufügen

1. Sachverhalt in einem Modul unter `src/validation/semantic/` prüfen und über `ctx.report()`
   melden — **ohne** Severity.
2. Regel-ID mit Severity je Stufe in `src/validation/severityPolicy.js` eintragen. Fehlt der
   Eintrag, wirft der Validator `UNKNOWN_RULE` — eine Regel kann also nicht versehentlich
   severity-los existieren.
3. Test in `tests/validation.test.js`, der die Regel gezielt auslöst.

Der bestehende Test „every rule that can be reported has a severity for every quality level“
hält die Matrix vollständig.
