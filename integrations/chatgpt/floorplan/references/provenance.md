# Provenance — das System erfindet keine Maße

Dies ist die Kernregel des Produkts. Ein Grundriss, der plausibel aussieht, aber erfundene Maße
enthält, ist schlimmer als gar kein Grundriss: er lädt zu Entscheidungen ein, die er nicht trägt.

## Die Werte

| Wert | Bedeutung | Belastbar |
|---|---|---|
| `provided` | vom Nutzer oder Auftraggeber angegeben | ja |
| `measured` | vor Ort gemessen oder aus vermessenem Bestand | ja |
| `parsed` | aus einer maßhaltigen Quelle gelesen (DXF, Maßtext im Plan) | ja |
| `derived` | rechnerisch aus anderen Werten abgeleitet | nur mit `verified: true` |
| `estimated` | geschätzt (Bildskalierung, Proportion, Erfahrung) | nein |
| `unknown` | Herkunft unbekannt | nein |

`derived` ist bewusst nur mit ausdrücklicher Bestätigung belastbar: ein abgeleiteter Wert erbt
seine Verlässlichkeit von seinen Eingaben, und die kennt das Modell nicht automatisch.

## Wo die Information steht

Entscheidung (ADR 0008): **pro Objekt**, mit optionalem **Override pro Property**.

```json
{
  "id": "wall_003",
  "start": { "x_mm": 0, "y_mm": 0 },
  "end":   { "x_mm": 4200, "y_mm": 0 },
  "thickness_mm": 300,

  "provenance": "measured",
  "confidence": 0.95,
  "verified": true,

  "property_provenance": {
    "thickness_mm": {
      "provenance": "estimated",
      "confidence": 0.6,
      "note": "Wandstärke nicht aufgemessen, aus Bauart geschätzt"
    }
  }
}
```

Der Normalfall kostet **ein** Feld. Präzision ist verfügbar, wo sie gebraucht wird — genau hier
etwa, wo Länge gemessen und Dicke geschätzt ist.

### Auflösungsreihenfolge

```text
element.property_provenance[prop]
  └► element.provenance / confidence / verified
       └► project.defaults.provenance
            └► "unknown"
```

`floorplan inspect <file> --section provenance --json` gibt für jeden dimensionsrelevanten Wert
die aufgelöste Herkunft aus, inklusive der Herkunft der Auflösung selbst (`origin`).

### Warum nicht pro Wert?

Ein Wrapper um jede Zahl (`{"value": 300, "provenance": "…"}`) wäre maximal präzise. Er wurde
verworfen, weil er das Modell verdreifacht, jeden Konsumenten zum Auspacken zwingt, Diffs
unlesbar macht — und weil LLM-Agenten in diesem Format nachweislich deutlich mehr Fehler
produzieren. Die Präzision, die man dadurch verliert, holt der Property-Override zurück.

## Welche Werte überhaupt zählen

Nicht jedes Feld braucht Herkunft. `src/model/provenance.js` definiert je Elementtyp die
**dimensionsrelevanten** Properties:

```text
wall     start · end · thickness_mm · height_mm
door     offset_mm · width_mm · height_mm
window   offset_mm · width_mm · height_mm · sill_mm
space    boundary · area_override_mm2 · height_mm
…
```

Woher ein Raumname stammt, interessiert niemanden. Woher seine Fläche stammt, sehr wohl.

## Kopplung an die Qualitätsstufen

| Regel | marketing | scaled | verified |
|---|---|---|---|
| `PROVENANCE_ESTIMATED` | INFO | WARNING | **ERROR** |
| `PROVENANCE_UNKNOWN` | INFO | **ERROR** | **ERROR** |
| `MISSING_SCALE_REFERENCE` (nirgends ein belastbarer Wert) | INFO | **ERROR** | **ERROR** |
| `GEOMETRY_NOT_ANCHORED` (nur Beschriftungen belastbar) | INFO | **ERROR** | **ERROR** |
| `UNVERIFIED_VALUES` | INFO | INFO | WARNING |

Ein `verified`-Grundriss ist damit per Definition frei von geschätzten Maßen — und der Weg
dorthin ist maschinell prüfbar statt behauptet:

```bash
floorplan validate haus.floorplan.json --quality verified --json
```

Der Unterschied zwischen `MISSING_SCALE_REFERENCE` und `GEOMETRY_NOT_ANCHORED` ist wichtig:
Die erste Regel greift, wenn es **nirgends** einen belastbaren Wert gibt. Die zweite greift,
wenn zwar ein Maßtext belastbar ist, aber **kein einziges Bauteil** — die Geometrie steht dann
auf nichts. Genau dieser Fall tritt bei einer reinen Bildrekonstruktion auf.

## Regeln für Agenten

1. Ein Maß, das weder vorliegt noch berechenbar ist, wird **nicht erfunden**. Zulässig sind:
   Rückfrage, explizite Schätzung mit `provenance: "estimated"` und `confidence`, oder das
   Weglassen des optionalen Feldes.
2. Eine Schätzung wird **nie** als `measured` oder `provided` deklariert. Der Reconciler setzt
   diese Regel technisch durch: Ein Interpreter, der `measured` behauptet, wird automatisch auf
   `parsed` heruntergestuft und der Vorgang im Report vermerkt.
3. Wird ein Wert aus einer Quelle übernommen, verweist `source_id` darauf.
4. Beim Anzweifeln eines Werts ist `set_provenance` die richtige Operation — nicht das Löschen.

```json
{ "op": "set_provenance", "target_id": "wall_003", "property": "thickness_mm",
  "provenance": "estimated", "confidence": 0.6,
  "note": "aus dem Foto abgeleitet, nicht gemessen" }
```

## Darstellung

Das Theme entscheidet, wie Unsicherheit im Plan sichtbar wird:

```yaml
uncertainty:
  mark_estimated: true
  estimated_prefix: "ca. "
  unknown_placeholder: "?"
  estimated_color: "#8a6d3b"
```

Eine geschätzte Raumfläche erscheint dann als `ca. 13,11 m²`. Ein Marketing-Grundriss darf
schöner aussehen als ein technischer — er darf nicht sicherer aussehen, als er ist.
