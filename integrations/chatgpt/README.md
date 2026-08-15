# ChatGPT / ChatGPT Work — Skill-Paket

## Aufbau

```text
integrations/chatgpt/floorplan/
├── SKILL.md              Einstiegspunkt mit Frontmatter (name, version, description)
├── agents/
│   └── openai.yaml       Fähigkeiten und Aufrufkonventionen — keine Fachlogik
├── references/
│   ├── agent-contract.md ← normativ, geteilt mit Claude Code und Codex
│   ├── operations.md
│   ├── observations.md
│   ├── provenance.md
│   ├── themes.md
│   └── setup.md
└── scripts/
    └── floorplan.js      Wrapper: findet den Core und reicht alle Argumente durch
```

## Verwenden

1. Den Core bereitstellen (Node ≥ 20, kein `npm install`, kein Build) — drei Wege in
   `floorplan/references/setup.md`. Für ein verpacktes Skill ist das Mitliefern unter
   `floorplan/core/` am robustesten.
2. Das Verzeichnis `floorplan/` als Skill hochladen bzw. registrieren.
3. Prüfen:

```bash
node integrations/chatgpt/floorplan/scripts/floorplan.js --version
node integrations/chatgpt/floorplan/scripts/floorplan.js ops list
```

## Warum ein Wrapper

`floorplan/scripts/floorplan.js` enthält **keine** Grundrisslogik. Er sucht den Core an definierten
Orten, reicht `process.argv` unverändert weiter und gibt den Exit-Code zurück. Findet er
nichts, nennt er jeden geprüften Pfad und die zwei Befehle, die es beheben — statt still auf
eine Teilimplementierung auszuweichen. Eine zweite Implementierung der Geometrie wäre eine
zweite Wahrheit, und genau das verhindert diese Architektur.

## Warum die References Kopien sind

Ein Skill-Paket muss in sich geschlossen sein; Symlinks überstehen den Transport nicht. Die
Dateien unter `references/` sind deshalb **erzeugte Kopien**:

```bash
node scripts/sync-chatgpt-skill.js
```

`tests/integrations.test.js` schlägt fehl, sobald eine Kopie von ihrem Original abweicht —
derselbe Mechanismus, der `schema/operations.schema.json` mit der Operations-Registry
synchron hält. Das Skill kann dadurch keine andere Regel tragen als Claude Code oder Codex.

## Grenzen

Die Plattform ist eine lokale CLI. Ein ChatGPT-Kontext ohne Codeausführung kann sie nicht
aufrufen. Dort bleibt nutzbar:

* das Datenmodell erklären und `*.floorplan.json` sowie `*.ops.json` **schreiben**, die der
  Nutzer anschließend selbst durch die CLI schickt
* `*.observations.json` aus einem hochgeladenen Bild erzeugen
* eine bestehende `*.floorplan.json` lesen und beantworten

Was ohne Ausführung **nicht** geht: validieren, rendern, Operationen anwenden. Diese Grenze ist
dem Nutzer zu nennen, statt sie durch geschätzte Antworten zu überspielen.
