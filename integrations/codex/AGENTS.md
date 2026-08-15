# AGENTS.md — Floorplan Intelligence Platform

Anweisungen für OpenAI Codex und andere Agenten, die diese Konvention lesen.
Kopiere diese Datei in das Wurzelverzeichnis des Projekts, in dem gearbeitet wird.

## Was hier gilt

Grundrisse sind **strukturierte Daten**, keine Bilder. Die Wahrheit steht in
`*.floorplan.json`. Ein SVG ist eine Ansicht davon und wird nie bearbeitet.

**Der vollständige fachliche Vertrag steht in `docs/agent-contract.md`.**
Diese Datei ist die Kurzfassung; bei Widersprüchen gilt der Contract.

## Setup

```bash
node bin/floorplan.js --version    # Node >= 20, kein npm install, kein Build
```

Ist die Plattform an anderer Stelle installiert, ersetze `floorplan` in allen folgenden
Beispielen durch `node <pfad>/bin/floorplan.js`.

## Arbeitsablauf

```bash
# 1. lesen — nie eine ID raten
floorplan inspect  plan.floorplan.json --section all --json
floorplan graph    plan.floorplan.json --json

# 2. Vokabular nachschlagen — nie einen Operationsnamen erfinden
floorplan ops list --json
floorplan ops describe move_opening --json

# 3. Änderung als Operationsdatei formulieren
cat > changes.ops.json <<'JSON'
{ "schema_version": "0.1",
  "description": "Tür zwischen Küche und Flur um 80 cm versetzen",
  "operations": [
    { "op": "move_opening", "target_id": "door_014", "offset_delta_mm": 800 }
  ] }
JSON

# 4. anwenden (atomar, validiert automatisch, schreibt nie in-place)
floorplan apply plan.floorplan.json changes.ops.json --output plan-v2.floorplan.json --json

# 5. prüfen und darstellen
floorplan validate plan-v2.floorplan.json --json
floorplan render   plan-v2.floorplan.json --theme technical --output plan-v2.svg --json

# zurücknehmen, falls nötig
floorplan undo plan-v2.floorplan.json --steps 1 --output plan-v1.floorplan.json
```

## Regeln

1. **Maße werden nicht erfunden.** Unbekannt heißt: nachfragen, oder `provenance: "estimated"`
   mit `confidence`, oder das optionale Feld weglassen. Nie `measured`/`provided` behaupten.
2. **Operationen statt JSON-Editieren.** Direkte Änderungen nur, wenn keine Operation den Fall
   abdeckt — dann sofort `floorplan validate` und in der Antwort erwähnen.
3. **Millimeter, ganzzahlig.** X nach rechts, Y nach oben.
4. **`offset_mm` ist die MITTE der Öffnung**, gemessen von `wall.start` entlang der Wandachse.
   Gültiger Bereich: `width/2` … `wandlänge − width/2`.
5. **Wandecken brauchen exakt identische Endpunkte.** Ein 3-mm-Versatz verhindert die
   Verschneidung und erzeugt `WALL_ENDPOINTS_NEAR_MISS`.
6. **Aufschlagrichtung einer Tür unbekannt → `swing` weglassen.** Der Renderer zeichnet dann
   das Blatt geschlossen statt einen erfundenen Bogen.
7. **Qualitätsstufen werden belegt, nicht behauptet.**
   `floorplan validate <datei> --quality verified --json` zeigt, was fehlt.
8. **Keine baurechtlichen Aussagen.** Das System prüft Geometrie und gibt Plausibilitätshinweise.
   Rettungswege, Mindestgrößen, Brandschutz und Wohnflächenberechnung sind nicht abgedeckt.

## Rekonstruktion aus Bild oder PDF

Nicht direkt in ein Floorplan schreiben. Erst `*.observations.json` (Hypothesen mit
`confidence` und Quellverweis), dann:

```bash
floorplan reconcile plan.observations.json --output plan.floorplan.json --json
```

Den Bericht auswerten und dem Nutzer nennen: verworfene Beobachtungen mit Begründung und alle
getroffenen Annahmen. Ergebnis ist Qualitätsstufe `marketing`. Details: `docs/observations.md`.

## Exit-Codes

| Code | Bedeutung | Reaktion |
|---|---|---|
| 0 | Erfolg | weiter |
| 1 | Modell oder Operation fehlerhaft | Report lesen, Ursache beheben |
| 2 | **Aufruf falsch** | Nutzung nachlesen, nicht blind wiederholen |
| 3 | Bug im Werkzeug | melden |

## Am Werkzeug selbst arbeiten

Wenn die Aufgabe die Plattform selbst betrifft und nicht einen Grundriss:

```bash
npm test                                    # vollständige Suite, ohne Dependencies
node scripts/generate-operations-schema.js  # nach Änderungen an der Operations-Registry
npm run demo                                # End-to-End-Demonstration
UPDATE_GOLDEN=1 npm test                    # Golden-SVGs bewusst neu erzeugen
```

Architektur: `ARCHITECTURE.md`. Entscheidungen mit Begründung: `docs/adr/`.
Neue Regel, neue Operation, neues Theme: die jeweilige Anleitung steht in
`docs/validation.md`, `docs/operations.md`, `docs/themes.md`.
