# ADR 0008 — Provenance und Confidence

Status: akzeptiert · Datum: 2026-08-15 · Kernregel: **Das System erfindet keine Maße.**

## Die zu entscheidende Frage

Wird Herkunft **pro Wert** oder **pro Objekt** gespeichert?

### Option A — pro Wert (Wrapper um jede Zahl)

```json
"thickness_mm": { "value": 300, "provenance": "estimated", "confidence": 0.7 }
```

Maximal präzise, aber: das Modell verdreifacht sein Volumen, jeder Konsument braucht
Unwrapping, JSON-Diffs werden unlesbar, und — entscheidend — **LLM-Agenten produzieren in
diesem Format massiv mehr Fehler**, weil sie Wrapper vergessen oder verschachteln.

### Option B — pro Objekt (ein Feld je Element)

```json
{ "id": "wall_003", "thickness_mm": 300, "provenance": "estimated", "confidence": 0.7 }
```

Schlank und lesbar, aber zu grob: eine aus einem Exposé rekonstruierte Wand hat oft eine
**gemessene** Länge und eine **geschätzte** Dicke.

## Entscheidung: Option B mit optionalem Property-Override

```json
{
  "id": "wall_003",
  "start": { "x_mm": 0, "y_mm": 0 },
  "end":   { "x_mm": 4200, "y_mm": 0 },
  "thickness_mm": 300,
  "provenance": "measured",
  "confidence": 0.95,
  "property_provenance": {
    "thickness_mm": { "provenance": "estimated", "confidence": 0.6, "verified": false }
  }
}
```

**Auflösungsreihenfolge** (`src/model/provenance.js`, `resolveProvenance(el, prop, doc)`):

```text
element.property_provenance[prop]
  └► element.provenance / element.confidence / element.verified
       └► document.project.defaults.provenance
            └► "unknown"
```

Der Normalfall kostet **ein** Feld. Präzision ist verfügbar, wo sie gebraucht wird.
Der Aufwand entsteht nur dort, wo Unsicherheit tatsächlich differenziert ist.

## Werteraum

| Wert | Bedeutung |
|---|---|
| `provided` | vom Auftraggeber/Nutzer explizit angegeben |
| `measured` | vor Ort gemessen oder aus vermessenem Bestand übernommen |
| `parsed` | aus einer maßhaltigen Quelle ausgelesen (DXF, bemaßte Zeichnung, Maßtext im Plan) |
| `derived` | rechnerisch aus anderen Werten abgeleitet (z. B. Wandlänge aus zwei Achsen) |
| `estimated` | geschätzt (Bildskalierung, Proportionsannahme, Erfahrungswert) |
| `unknown` | Herkunft unbekannt — Wert ist nicht belastbar |

`confidence` ∈ [0,1] ist **optional** und nur bei `parsed`/`estimated` sinnvoll.
`verified: true` bedeutet: ein Mensch hat diesen Wert bestätigt.

## Kopplung an Qualitätsstufen

`project.quality` steuert, wie streng unsichere Werte behandelt werden:

| Regel | marketing | scaled | verified |
|---|---|---|---|
| `PROVENANCE_ESTIMATED` (geschätzte Maße vorhanden) | INFO | WARNING | **ERROR** |
| `PROVENANCE_UNKNOWN` (Herkunft unbekannt) | INFO | **ERROR** | **ERROR** |
| `MISSING_SCALE_REFERENCE` (kein gemessener Wert im Dokument) | INFO | **ERROR** | **ERROR** |

Damit ist ein `verified`-Grundriss per Definition frei von geschätzten Maßen — und der Weg
dorthin ist mechanisch prüfbar statt behauptet.

## Regeln für Agenten (verbindlich, siehe `docs/agent-contract.md`)

1. Ein Maß, das weder vorliegt noch berechenbar ist, wird **nicht erfunden**. Zulässige
   Reaktionen: Rückfrage, `provenance: "estimated"` mit `confidence`, oder Auslassen des Feldes.
2. Eine Schätzung wird **nie** als `measured` oder `provided` deklariert.
3. Übernimmt ein Agent einen Wert aus einer Quelle, verweist er über `source_id` darauf.
4. Beim Herabstufen der Sicherheit (Wert wird angezweifelt) ist `set_provenance` die richtige
   Operation — nicht das Löschen des Werts.
