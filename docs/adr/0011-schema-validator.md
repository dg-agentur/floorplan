# ADR 0011 — Eigener JSON-Schema-Validator statt Ajv

Status: akzeptiert · Datum: 2026-08-15 · Folge aus ADR 0001

## Kontext

ADR 0001 legt null Runtime-Dependencies fest. Damit steht Ajv nicht als Laufzeitabhängigkeit
zur Verfügung. Gleichzeitig sind die Schemas ein zentraler Vertrag und müssen zuverlässig
durchgesetzt werden.

## Entscheidung

`src/validation/schemaValidator.js` implementiert ein **klar umrissenes Subset von
JSON Schema 2020-12** — genau die Konstrukte, die unsere Schemas verwenden:

```text
$schema $id $ref $defs title description examples
type (alle 7) · enum · const
properties · required · additionalProperties · patternProperties
items · prefixItems · minItems · maxItems · uniqueItems
minimum · maximum · exclusiveMinimum · exclusiveMaximum · multipleOf
minLength · maxLength · pattern
allOf · anyOf · oneOf · not · if/then/else
```

**Nicht** unterstützt (und in unseren Schemas verboten): `$dynamicRef`, `$anchor`,
`unevaluatedProperties`, `dependentSchemas`, `contains`, `propertyNames`, Remote-`$ref`
auf fremde Hosts, `format` als Validierung (nur als Annotation).

Zwei Sicherungen gegen schleichende Abweichung:

1. `tests/schema-validator.test.js` enthält eine eigene Konformitätssuite pro Schlüsselwort
   (positive und negative Fälle, inklusive Grenzfällen wie `type: "integer"` mit `2.0`).
2. `tests/schema-conformance-ajv.test.js` vergleicht die Ergebnisse **gegen Ajv**, sofern Ajv
   in der Umgebung installiert ist. Fehlt Ajv, wird der Test übersprungen (`t.skip`), nicht
   stillschweigend als bestanden gewertet.
3. `tests/schema-meta.test.js` prüft, dass unsere Schemadateien ausschließlich Schlüsselwörter
   aus der obigen Liste verwenden — ein neues Schlüsselwort im Schema fällt sofort auf, statt
   still ignoriert zu werden.

Punkt 3 ist der eigentliche Schutz: Der Validator kann nicht "zu wenig prüfen", ohne dass ein
Test rot wird.

## Fehlermeldungen

Fehler tragen einen **JSON-Pointer** auf die verletzende Stelle, das verletzte Schlüsselwort
und eine für Menschen wie Agenten lesbare Meldung:

```json
{
  "severity": "ERROR",
  "rule": "SCHEMA_VIOLATION",
  "pointer": "/buildings/0/levels/0/walls/2/thickness_mm",
  "keyword": "minimum",
  "message": "thickness_mm must be >= 1 (got 0)"
}
```

Fehler werden **nicht** nach dem ersten Treffer abgebrochen; der Validator sammelt alle.
Bei `oneOf`/`anyOf` wird der Zweig mit den wenigsten Fehlern als "gemeinter" Zweig gemeldet,
damit die Ausgabe für Türen/Fenster/Passagen verständlich bleibt statt vier Alternativfehler
zu zeigen.

## Konsequenz

Wir tragen die Wartungslast eines kleinen Validators. Im Gegenzug läuft das Werkzeug in jeder
Node-Umgebung ohne Installation — was für den Hauptanwendungsfall (Agenten-Sandbox)
entscheidend ist.
