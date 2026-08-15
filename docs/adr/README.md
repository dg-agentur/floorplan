# Architecture Decision Records

Jede Entscheidung mit Kontext, verworfenen Alternativen und Konsequenzen. Wer verstehen will,
**warum** etwas so ist, liest hier — nicht im Code.

| # | Entscheidung | Kurzfassung |
|---|---|---|
| [0001](0001-language-and-runtime.md) | Sprache und Laufzeit | Node ≥ 20, ESM-JavaScript mit JSDoc, **null Abhängigkeiten, kein Build** |
| [0002](0002-units-and-coordinates.md) | Einheiten und Koordinaten | Millimeter als Ganzzahl, X rechts, Y oben |
| [0003](0003-25d-model.md) | 2,5D statt 2D oder 3D | XY-Geometrie plus vertikale Skalare, per Extrusion nach 3D hebbar |
| [0004](0004-wall-model.md) | Wandmodell | Mittellinie + Dicke, Körper zur Laufzeit verschnitten |
| [0005](0005-opening-hosting.md) | Verankerung von Öffnungen | `host_wall_id` + `offset_mm` = **Mitte** der Öffnung |
| [0006](0006-space-model.md) | Raummodell | explizites Polygon als Wahrheit, Ableitung als Prüfwerkzeug |
| [0007](0007-identifiers.md) | Identifikatoren | stabil, sprechend, deterministisch erzeugt, nie wiederverwendet |
| [0008](0008-provenance.md) | Provenance | pro Objekt mit optionalem Property-Override |
| [0009](0009-operations-and-history.md) | Operationen und Historie | rein, atomar, umkehrbar — Undo ohne Event Sourcing |
| [0010](0010-versioning.md) | Versionierung | MAJOR.MINOR, additive Erweiterung, `additionalProperties: false` |
| [0011](0011-schema-validator.md) | Eigener Schema-Validator | definiertes Draft-2020-12-Subset, gegen Ajv abgeglichen |
| [0012](0012-themes.md) | Theme-System | rein visuell, `_px` versus `_mm`, eigener YAML-Subset-Parser |
| [0013](0013-cli-contract.md) | CLI-Vertrag | Exit-Codes, JSON-Hülle, Selbstbeschreibung, kein Interaktivmodus |
| [0014](0014-observation-layer.md) | Observation Layer | Hypothesen getrennt von Tatsachen, Vision-Modelle austauschbar |
| [0015](0015-quality-levels.md) | Qualitätsstufen | `marketing`/`scaled`/`verified` steuern die Severity-Matrix |
| [0016](0016-software-versioning-and-release.md) | Softwareversionierung und Release | SemVer, unabhängig vom Schema; eine Quelle für die Version; Release-Gates |
| [0017](0017-self-contained-skill-bundle.md) | Self-contained Skill-Bundle | das Skill trägt den Core; kein Clone, kein Install, kein Netz |

## Die fünf, die alles andere bestimmen

**0001 — null Abhängigkeiten.** Der Hauptanwendungsfall ist ein Agent in einer fremden,
oft netzwerkbeschränkten Sandbox. Ein fehlschlagender Installationsschritt ist dort der
häufigste Grund, warum ein Agent anfängt, Workarounds zu erfinden. Aus dieser Entscheidung
folgen der eigene Schema-Validator (0011) und der eigene YAML-Parser (0012) — beide mit
enger, dokumentierter und getesteter Reichweite.

**0002 — Millimeter als Ganzzahl.** Eliminiert Rundungsfehler vollständig. Ein Modell bleibt
nach beliebig vielen Operationen exakt. Voraussetzung für Determinismus und für Golden-Tests.

**0005 — `offset_mm` ist die Mitte.** Die wichtigste einzelne Konvention. Sie macht
„die Tür 80 cm nach rechts“ zu einer Ein-Zeilen-Operation und verhindert, dass eine
Breitenänderung die Tür still verschiebt.

**0008 — Provenance pro Objekt.** Der Kompromiss, der „keine erfundenen Maße“ praktisch
durchsetzbar macht, ohne das Modell unlesbar zu machen oder Agenten zu überfordern.

**0009 — Operationen statt JSON-Editieren.** Macht Änderungen validierbar, umkehrbar,
protokollierbar und testbar — und gibt einem LLM ein Vokabular statt einer Textdatei.

## Format

```markdown
# ADR NNNN — Titel

Status: akzeptiert | ersetzt durch NNNN · Datum

## Kontext        Was ist das Problem, welche Randbedingungen gelten?
## Optionen       Was kam in Frage?
## Entscheidung   Was gilt?
## Begründung     Warum diese und nicht die andere?
## Konsequenzen   Was wird dadurch leichter, was schwerer?
```

Eine Entscheidung wird nicht überschrieben. Ändert sie sich, entsteht ein neuer ADR, und der
alte bekommt den Status „ersetzt durch“. Die Historie der Begründungen ist Teil des Werts.
