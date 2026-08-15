# Claude Code — Integration

## Einrichten

```bash
# 1. Plattform bereitstellen (kein npm install nötig)
git clone git@github.com:dg-agentur/floorplan.git ~/tools/floorplan-platform

# 2. In das Projekt kopieren, in dem gearbeitet wird
cp integrations/claude-code/CLAUDE.md           <projekt>/CLAUDE.md
cp -r integrations/claude-code/.claude          <projekt>/.claude

# 3. Optional: als globalen Befehl verfügbar machen
cd ~/tools/floorplan-platform && npm link
```

Existiert im Zielprojekt bereits ein `CLAUDE.md`, wird der Inhalt angehängt statt ersetzt.

## Was mitkommt

| Datei | Zweck |
|---|---|
| `CLAUDE.md` | Projektanweisung: wie Claude Code mit Grundrissen arbeitet |
| `.claude/commands/grundriss-pruefen.md` | `/grundriss-pruefen <datei>` — validieren und erklären |
| `.claude/commands/grundriss-aendern.md` | `/grundriss-aendern <datei> <wunsch>` — Änderung als Operationen |
| `.claude/commands/grundriss-rendern.md` | `/grundriss-rendern <datei> [theme]` — SVG erzeugen |
| `.claude/commands/grundriss-rekonstruieren.md` | `/grundriss-rekonstruieren <bild>` — aus einer Vorlage rekonstruieren |

Die Kommandos sind bewusst dünn: Sie strukturieren den Ablauf und verweisen auf den Vertrag.
Die fachlichen Regeln stehen in `docs/agent-contract.md`.

## Prüfen

```bash
floorplan --version
floorplan ops list
```

Danach in Claude Code:

```text
/grundriss-pruefen fixtures/03-house-ground-floor/house-ground-floor.floorplan.json
```
