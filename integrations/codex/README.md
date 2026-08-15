# Codex — Integration

## Einrichten

```bash
git clone git@github.com:dg-agentur/floorplan.git floorplan-platform
cp integrations/codex/AGENTS.md <projekt>/AGENTS.md
```

Codex liest `AGENTS.md` aus dem Repository-Wurzelverzeichnis. Existiert dort bereits eine
Datei, wird der Inhalt als eigener Abschnitt angehängt.

Ist die Plattform nicht Teil des Zielprojekts, ersetze in `AGENTS.md` jedes `floorplan` durch
`node <pfad>/bin/floorplan.js` — oder mache den Befehl global verfügbar:

```bash
cd floorplan-platform && npm link
```

## Umgebung

Node.js ≥ 20. Kein `npm install`, kein Build, keine Netzwerkverbindung nötig. Das ist Absicht
(`docs/adr/0001-language-and-runtime.md`): In einer abgeschotteten Sandbox scheitert ein
Installationsschritt, und ein Agent beginnt dann, Workarounds zu erfinden.

Prüfen:

```bash
node bin/floorplan.js --version
node bin/floorplan.js ops list
```

## Was Codex an die Hand bekommt

Die CLI ist **selbstbeschreibend**. Codex muss nichts aus dem Systemprompt rekonstruieren:

```bash
floorplan ops list --json         # das vollständige Änderungsvokabular
floorplan ops describe <op> --json # Schema und Beispiel je Operation
floorplan rules --json            # alle Validierungsregeln mit Severity je Qualitätsstufe
floorplan schema floorplan        # das Datenmodell selbst
```

Fehlermeldungen enthalten einen `hint`, der zur Selbstkorrektur reicht — etwa den gültigen
Wertebereich einer Position statt nur der Feststellung, dass sie falsch ist.

## Abgrenzung

`AGENTS.md` enthält **keine** Geometrie- oder Validierungslogik. Es verweist auf
`docs/agent-contract.md` — die einzige fachliche Quelle für alle Plattformen.
`tests/integrations.test.js` prüft, dass jedes hier erwähnte Kommando und jede erwähnte
Operation tatsächlich existiert.
