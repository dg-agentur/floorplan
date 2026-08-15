---
description: Validiert einen Grundriss und erklärt das Ergebnis verständlich
argument-hint: <datei.floorplan.json> [--quality verified]
allowed-tools: Bash(floorplan:*), Bash(node:*), Read
---

Prüfe den Grundriss `$1` und erkläre das Ergebnis.

Ablauf:

1. `floorplan validate $ARGUMENTS --json`
2. `floorplan inspect $1 --section all --json`
3. `floorplan graph $1 --json`

Berichte anschließend:

- **Ergebnis**: gültig oder nicht, auf welcher Qualitätsstufe geprüft
- **Fehler** (ERROR): jeweils was falsch ist und wie es zu beheben wäre
- **Warnungen** (WARNING): was sie bedeuten und ob sie einer höheren Qualitätsstufe im Weg stehen
- **Räume**: Namen, Grundflächen, Summe — ausdrücklich als *geometrische Grundfläche*,
  nicht als Wohnfläche
- **Erschließung**: was vom Freien aus erreichbar ist, ob der Grundriss in unverbundene
  Gruppen zerfällt
- **Maßsicherheit**: wie viele Werte belastbar (`provided`/`measured`/`parsed`) und wie viele
  geschätzt sind — aus `--section provenance`

Wurde ohne `--quality` aufgerufen, führe zusätzlich `floorplan validate $1 --quality verified --json`
aus und nenne, was für die Stufe `verified` noch fehlt.

Der fachliche Vertrag steht in `docs/agent-contract.md`. Triff keine Aussagen über
baurechtliche Zulässigkeit — das prüft dieses System nicht.
