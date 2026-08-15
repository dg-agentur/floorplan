# Integrationen

Adapter für die Agentenplattformen. Sie unterscheiden sich **ausschließlich** in Format und
Aufrufkonvention der jeweiligen Plattform.

```text
                    docs/agent-contract.md
                   (die einzige fachliche Quelle)
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
claude-code/            codex/               chatgpt/
CLAUDE.md               AGENTS.md            floorplan/SKILL.md
.claude/commands/*.md                        agents/openai.yaml
.claude/skills/                              references/ · scripts/
```

## Die Regel

Ein Adapter enthält **null** Geometrie-, Validierungs- oder Maßlogik. Er sagt einem Agenten,
wie er die CLI aufruft und wo der fachliche Vertrag steht — mehr nicht.

Widerspricht ein Adapter dem Agent Contract, gewinnt der Contract und der Adapter ist ein Bug.
`tests/integrations.test.js` prüft maschinell:

* jeder Adapter verweist auf `docs/agent-contract.md`
* jedes erwähnte CLI-Kommando existiert wirklich
* jede erwähnte Operation existiert in der Registry
* jede referenzierte Datei existiert
* kein Adapter erfindet eigene Regeln zu Maßen oder Qualitätsstufen

Das ist der Mechanismus, der Vendor-Neutralität aufrechterhält: Nicht die Absicht, sondern ein
roter Test verhindert, dass die Plattformen auseinanderlaufen.

## Voraussetzung für alle drei

Node.js ≥ 20. Kein `npm install`, kein Build:

```bash
git clone git@github.com:dg-agentur/floorplan.git floorplan-platform
node floorplan-platform/bin/floorplan.js --version
```

Optional als globaler Befehl:

```bash
cd floorplan-platform && npm link     # danach: floorplan --version
```

## Neue Plattform anbinden

1. `docs/agent-contract.md` lesen — er ist vollständig, plattformneutral und ausreichend.
2. Ein Adapterverzeichnis anlegen, das die Plattformkonvention erfüllt (Systemprompt,
   Werkzeugbeschreibung, Skill-Manifest …).
3. Darin auf den Contract verweisen, statt ihn zu kopieren.
4. Den Adapter in `tests/integrations.test.js` eintragen.
