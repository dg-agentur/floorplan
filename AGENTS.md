# AGENTS.md — Arbeiten an dieser Plattform

Dies ist der Kern der Floorplan Intelligence Platform. Diese Datei richtet sich an einen Agenten,
der **die Software selbst** verändert.

Soll dagegen ein **Grundriss** bearbeitet werden, gilt `docs/agent-contract.md` — und für die
Nutzung in einem anderen Projekt `integrations/codex/AGENTS.md`.

Der Inhalt ist identisch mit `CLAUDE.md`; beide Konventionen zeigen auf dieselben Regeln.
Lies `CLAUDE.md` in diesem Verzeichnis.

## Das Wichtigste in Kürze

```bash
npm test                                    # vollständige Suite, keine Abhängigkeiten nötig
npm run demo                                # End-to-End-Demonstration
node scripts/generate-operations-schema.js  # nach Änderungen an der Operations-Registry
```

* **Keine Runtime-Dependencies** (ADR 0001) und kein Build-Schritt.
* **Abhängigkeitsrichtung** nur nach unten: model → geometry → topology → validation →
  operations → render → cli.
* **Determinismus** ist eine Produktanforderung: keine Zeitstempel, keine Zufalls-IDs,
  keine locale-abhängige Formatierung, keine unsortierte Iteration.
* **Ganzzahlige Millimeter**; alles, was ins Modell geht, läuft über `roundMm()`.
* **Toleranzen** ausschließlich aus `src/model/constants.js`.
* **Keine stillen Fehler**, keine erfundenen Maße — auch nicht im Code.
* Neuer Code ohne Test ist nicht fertig.

Architektur: `ARCHITECTURE.md` · Entscheidungen: `docs/adr/README.md` · Scope und Risiken:
`ROADMAP.md`
