# Arbeiten an dieser Plattform

Dies ist der Kern der Floorplan Intelligence Platform. Diese Datei richtet sich an einen Agenten,
der **die Software selbst** verändert.

Sollst du dagegen einen **Grundriss** bearbeiten, gilt `docs/agent-contract.md` — und für die
Nutzung in einem anderen Projekt `integrations/claude-code/CLAUDE.md`.

## Vor der ersten Änderung lesen

1. `ARCHITECTURE.md` — Schichten und Abhängigkeitsrichtung
2. `docs/adr/README.md` — warum die Dinge so sind
3. `ROADMAP.md` — Scope, Risiken, was bewusst fehlt

## Befehle

```bash
npm test                                    # vollständige Suite, ohne Abhängigkeiten
node --test tests/geometry.test.js          # eine einzelne Datei
npm run demo                                # End-to-End-Demonstration nach ./out
npx tsc --project tsconfig.json             # Typprüfung (optional, checkJs über JSDoc)
node scripts/generate-operations-schema.js  # nach Änderungen an der Operations-Registry
node scripts/sync-chatgpt-skill.js          # nach Änderungen an docs/, die das Skill spiegelt
npm run test:update-golden                  # Golden-SVGs bewusst neu erzeugen
npm install --no-save ajv && npm test       # zusätzlich gegen Ajv konformitätsprüfen
```

## Regeln für Änderungen am Code

**Abhängigkeiten.** Keine Runtime-Dependencies. Das ist ADR 0001 und nicht verhandelbar, ohne
den ADR zu ersetzen. Auch `devDependencies` bleiben leer — Tests laufen mit `node --test`.

**Schichten.** `src/model` → `src/geometry` → `src/topology` → `src/validation` →
`src/operations` → `src/render` → `src/cli`. Abhängigkeiten zeigen nur nach unten. Nur
`src/model/io.js` fasst das Dateisystem an. `src/render` enthält keine Fachregeln,
`src/model`/`geometry`/`validation` kennen keine Farben.

**Determinismus.** Keine Zeitstempel, keine Zufalls-IDs, keine locale-abhängige Formatierung,
keine unsortierte Iteration über Mengen. Wenn eine Änderung ein Golden-SVG verändert, muss die
Änderung *am SVG* erklärbar sein — sonst ist etwas nichtdeterministisch geworden.

**Toleranzen.** Nur aus `src/model/constants.js`. Eine lokal erfundene Toleranz ist ein Bug.

**Ganzzahlige Millimeter.** Zwischenrechnungen dürfen Gleitkomma sein; alles, was ins Modell
geschrieben wird, läuft über `roundMm()`.

**Keine stillen Fehler.** Kein leeres `catch`, kein stillschweigendes Auffüllen fehlender Werte,
kein Weglassen von etwas, das der Nutzer geliefert hat. Wenn etwas nicht geht: Fehler mit `code`
und `hint` werfen.

**Keine erfundenen Maße — auch nicht im Code.** Weder Renderer noch Reconciler noch eine
Operation dürfen ein fehlendes Bauteilmaß durch einen „üblichen Wert“ ersetzen. Der Renderer
zeichnet lieber weniger (Türblatt ohne Bogen, Treppe ohne Stufen) als etwas Erfundenes.

## Etwas hinzufügen

| Vorhaben | Vorgehen |
|---|---|
| Validierungsregel | `src/validation/semantic/*` melden **ohne** Severity → Eintrag in `severityPolicy.js` → Test, der sie auslöst (`docs/validation.md`) |
| Operation | Definition in `src/operations/ops/*` inkl. Inverse → `node scripts/generate-operations-schema.js` → Undo-Rundlauf-Test (`docs/operations.md`) |
| Modellfeld | Schema erweitern (additiv, MINOR) → `types.js` → ggf. `KEY_PRIORITY` in `src/util/json.js` → Fixture, die es benutzt |
| Theme-Option | `schema/theme.schema.json` + `src/themes/defaults.js` + Renderer-Nutzung. `_mm` nur mit sehr guter Begründung (`docs/themes.md`) |
| Architekturentscheidung | neuer ADR unter `docs/adr/`, alter bekommt „ersetzt durch“ |

## Tests

Neuer Code ohne Test wird nicht fertig. Die Suite deckt ab: Schema-Validator (inkl. optionalem
Ajv-Abgleich), Modell, Geometrie, Topologie, Validierung (jede Regel), Operationen (jede
Operation im Undo-Rundlauf), Rendering (Determinismus + Golden), Themes, Reconciler, CLI
(als Kindprozess, echte Exit-Codes), Fixtures und Integrationen.

Besonders wichtig, weil dort die Architekturversprechen hängen:

* `tests/schema-conformance-ajv.test.js` — der eigene Validator gegen die Referenz
* `tests/render.test.js` — Determinismus und „Theme ändert keine Geometrie“
* `tests/operations.test.js` — Undo stellt jede Operation exakt wieder her
* `tests/integrations.test.js` — die Adapter driften nicht auseinander

## Fixtures ändern

Fixtures sind Testdaten, keine normativen Architekturbeispiele. Wer eine ändert, muss die
Golden-SVGs bewusst neu erzeugen und den Diff ansehen. `fixtures/06-*/reconstruction.floorplan.json`
ist eine **generierte** Datei — sie wird über `floorplan reconcile` neu erzeugt, nicht von Hand
bearbeitet; ein Test erzwingt das.
