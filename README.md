# Floorplan Intelligence Platform

**Ein deterministischer, herstellerneutraler Kern für Grundrisse — und ein Vertrag, mit dem
KI-Agenten zuverlässig darauf arbeiten.**

[![CI](https://github.com/dg-agentur/floorplan/actions/workflows/ci.yml/badge.svg)](https://github.com/dg-agentur/floorplan/actions/workflows/ci.yml)

Version 0.1.0-alpha.1 · Node.js ≥ 20 · **keine Abhängigkeiten, kein Build-Schritt**

> **Vorabversion.** Der MVP ist verifiziert und reproduzierbar. Vor einem stabilen `v0.1.0`
> stehen noch zwei Gates: ein vollständiger Real-World-Test mit einem echten Grundriss und ein
> erfolgreicher Test des gepackten Skills in ChatGPT Work (→ `RELEASING.md`).

---

## Was ist das?

Ein Grundriss ist hier **strukturierte Geometrie mit Semantik und Herkunftsnachweis** — kein
Bild und keine Prosa.

```text
Eingabe (Sprache · Bild · PDF · Scan · Zeichnung)
  │
  ▼  Interpretation durch ein LLM oder einen Parser — austauschbar, unscharf
Observations (*.observations.json)   Hypothesen mit Confidence und Quellverweis
  │
  ▼  Reconciliation — regelbasiert, deterministisch, ohne KI
Canonical Floorplan (*.floorplan.json)   ◄── SOURCE OF TRUTH
  │
  ├─► Validierung        ERROR / WARNING / INFO, abhängig von der Qualitätsstufe
  ├─► Topologie          Raumgraph: was ist von wo erreichbar
  ├─► Operationen        validierte, umkehrbare Änderungen
  └─► SVG-Renderer       deterministisch, themefähig, ohne Bild-KI
```

Claude Code, OpenAI Codex und ChatGPT sind **Schnittstellen**, keine Abhängigkeiten. Sie
benutzen dieselben Daten, dieselben Schemas, dieselbe CLI und denselben fachlichen Vertrag.

---

## Warum ein kanonisches Modell?

Weil ein generiertes Bild eines Grundrisses keine Fragen beantworten kann.

| Frage | Bild | Kanonisches Modell |
|---|---|---|
| Wie groß ist die Küche? | geschätzt aus Pixeln | aus dem Polygon berechnet |
| Welche Tür verbindet Küche und Flur? | Vermutung | aus der Geometrie abgeleitet |
| Verschiebe diese Tür um 80 cm | neu generieren, alles ändert sich | eine Operation, alles andere bleibt |
| Ist dieses Maß gemessen oder geraten? | nicht beantwortbar | `provenance` sagt es |
| Sind zwei Renderings vergleichbar? | nein | byteidentisch bei gleicher Eingabe |
| Welche Wand wird abgebrochen? | nicht darstellbar | `state: "demolish"` |

Und weil ein Grundriss, der plausibel aussieht, aber erfundene Maße enthält, schlimmer ist als
gar kein Grundriss: er lädt zu Entscheidungen ein, die er nicht trägt.

---

## Installation

```bash
git clone git@github.com:dg-agentur/floorplan.git
cd floorplan
node bin/floorplan.js --version        # 0.1.0-alpha.1
```

Das ist alles. Kein `npm install`, kein Build, keine Netzwerkverbindung — bewusst so
(`docs/adr/0001-language-and-runtime.md`), damit die Plattform in jeder Agenten-Sandbox
sofort läuft.

Optional als globaler Befehl:

```bash
npm link      # danach überall: floorplan …
```

Alles ausprobieren:

```bash
npm test        # vollständige Testsuite, ohne Abhängigkeiten
npm run demo    # End-to-End-Demonstration, Artefakte in ./out
```

---

## In fünf Minuten

```bash
# Einen Grundriss ansehen
floorplan inspect fixtures/03-house-ground-floor/house-ground-floor.floorplan.json --section spaces

# Prüfen
floorplan validate fixtures/03-house-ground-floor/house-ground-floor.floorplan.json

# Zeichnen
floorplan render fixtures/03-house-ground-floor/house-ground-floor.floorplan.json \
  --theme technical --output haus.svg

# Ändern: Tür versetzen, Wand abbrechen, Durchgang schaffen
floorplan apply fixtures/03-house-ground-floor/house-ground-floor.floorplan.json \
  fixtures/03-house-ground-floor/renovation.ops.json --output haus-v2.floorplan.json

# Erneut zeichnen und vergleichen
floorplan render haus-v2.floorplan.json --theme technical --output haus-v2.svg

# Alles zurücknehmen
floorplan undo haus-v2.floorplan.json --steps 4 --output haus-v1.floorplan.json
```

---

## Einen Grundriss erstellen

```bash
# Leeres Dokument
floorplan create wohnung.floorplan.json --template empty --name "Musterwohnung"

# Oder direkt ein Rechteckraum aus bekannten lichten Innenmaßen
floorplan create wohnung.floorplan.json --template room \
  --width-mm 4200 --depth-mm 3400 --wall-thickness-mm 300
```

`--template room` **verweigert** den Dienst ohne Maße. Das ist Absicht: Maße werden nicht
geraten. Weiter geht es mit Operationen:

```json
{
  "schema_version": "0.1",
  "operations": [
    { "op": "create_door", "host_wall_id": "wall_001", "offset_mm": 2100,
      "width_mm": 1010, "height_mm": 2010, "door_type": "swing",
      "hinge": "left", "swing": "left", "provenance": "provided" },
    { "op": "create_window", "host_wall_id": "wall_003", "offset_mm": 2100,
      "width_mm": 1400, "height_mm": 1400, "sill_mm": 900, "provenance": "provided" }
  ]
}
```

Das Vokabular muss man nicht auswendig kennen:

```bash
floorplan ops list --json                    # alle Operationen mit Parametern
floorplan ops describe create_door --json    # Schema und Beispiel
floorplan ops template create_door           # fertige Startdatei
```

---

## Einen Grundriss validieren

```bash
floorplan validate wohnung.floorplan.json
floorplan validate wohnung.floorplan.json --quality verified   # was fehlt noch?
floorplan rules                                                # alle Regeln und Severities
```

Der Validator prüft Referenzen, Geometrie, Topologie und Herkunft — und unterscheidet drei
Dinge sauber:

```text
geometrische Gültigkeit          wird geprüft
architektonische Plausibilität   wird als Hinweis gemeldet (immer INFO)
rechtliche Zulässigkeit          wird NICHT geprüft und nicht behauptet
```

Die Severity hängt von der Qualitätsstufe ab: Ein geschätztes Maß ist bei `marketing` eine
Information, bei `verified` ein Fehler. Details: `docs/validation.md`.

Exit-Codes: `0` gültig · `1` fachlicher Fehler · `2` Aufruffehler · `3` Bug.

---

## Änderungen anwenden

```bash
floorplan apply plan.floorplan.json changes.ops.json --dry-run          # erst ansehen
floorplan apply plan.floorplan.json changes.ops.json --output plan-v2.floorplan.json
floorplan undo  plan-v2.floorplan.json --steps 1 --output plan-v1.floorplan.json
```

* **atomar** — schlägt eine Operation fehl, wird nichts angewandt
* **umkehrbar** — jeder History-Eintrag trägt seine Inverse
* **validiert** — `apply` prüft anschließend und schreibt bei Fehlern nicht
* **deterministisch** — gleiche Eingabe, byteidentisches Ergebnis, ohne Zeitstempel
* **nie in-place** — außer mit `--in-place`

31 Operationen, darunter `move_wall` (zieht angrenzende Wände und Raumkanten korrekt mit),
`convert_opening` (Tür → Durchgang, mit erhaltener Identität), `split_space`, `merge_spaces`,
`set_state` und `set_provenance`. Vollständig: `docs/operations.md`.

---

## SVG rendern

```bash
floorplan render plan.floorplan.json --theme technical --output plan.svg
floorplan render plan.floorplan.json --theme marketing  --output expose.svg
floorplan render plan.floorplan.json --level level_og   --output og.svg
```

Der Renderer ist eine reine Funktion `(Modell, Theme) → SVG`. Keine generative Bild-KI, keine
Zufallswerte, keine Zeitstempel. Zweimal rendern erzeugt **byteidentische** Dateien.

Gezeichnet werden Außen- und Innenwände mit korrekt verschnittenen Ecken, Türen mit
Öffnungsbogen, Fenster, Durchgänge, Treppen, Stützen, Schächte, Raumnamen mit Grundflächen,
Bemaßung und Beschriftung. Öffnungen sind **echte Lücken** in der Wandgeometrie, keine
übermalten Rechtecke.

Das SVG-Koordinatensystem ist das Modell in Millimetern (Y gespiegelt) — die Datei ist damit
lesbar und diffbar, und jedes Element trägt `data-type` und `data-id` für nachgelagerte Systeme
(Exposé-Layout, Web-Viewer, PowerPoint).

---

## Themes verwenden

```bash
floorplan theme list
floorplan render plan.floorplan.json --theme marketing --output plan.svg
floorplan render plan.floorplan.json --theme ./themes/kunde-a.yaml --output plan.svg
```

| Theme | Anmutung |
|---|---|
| `technical` | Werkplan: Bemaßung, neutrale Grautöne, klare Bauzustände |
| `marketing` | Exposé: weiche Raumfarben, keine Maßketten, großzügige Typografie |
| `minimal` | reine Linienzeichnung |

**Ein Theme kann Geometrie weder erzeugen noch verändern.** Ein Test vergleicht die
Wandgeometrie zweier Themes byteweise. Ein eigenes Theme nennt nur seine Abweichungen:

```yaml
name: kunde-a
extends: marketing
page:
  font_family: "Inter, Helvetica, sans-serif"
walls:
  default: { fill: "#1b2a41" }
```

```bash
floorplan theme validate themes/kunde-a.yaml
```

Unbekannte Schlüssel sind ein Fehler — ein Tippfehler kann keine Einstellung stillschweigend
deaktivieren. Details: `docs/themes.md`.

---

## Wie ein KI-Agent damit arbeitet

**`docs/agent-contract.md` ist der verbindliche Vertrag** — plattformneutral, vollständig,
für alle Agenten identisch.

Die Schleife:

```bash
floorplan inspect  plan.floorplan.json --section all --json   # 1. lesen, nie IDs raten
floorplan ops describe move_opening --json                    # 2. Vokabular nachschlagen
# 3. changes.ops.json schreiben
floorplan apply    plan.floorplan.json changes.ops.json --output plan-v2.floorplan.json --json
floorplan render   plan-v2.floorplan.json --theme marketing --output plan-v2.svg --json
```

Die CLI ist **selbstbeschreibend**: `ops list`, `ops describe`, `rules` und `schema` liefern
das vollständige Vokabular zur Laufzeit. Ein Agent muss nichts aus einem Systemprompt
rekonstruieren, und Fehlermeldungen enthalten einen `hint`, der zur Selbstkorrektur reicht.

Die harte Regel: **Maße werden nicht erfunden.** Unbekannt heißt nachfragen, als `estimated`
mit `confidence` eintragen, oder das optionale Feld weglassen — nie eine Schätzung als
`measured` deklarieren.

### Claude Code

```bash
cp integrations/claude-code/CLAUDE.md  <projekt>/CLAUDE.md
cp -r integrations/claude-code/.claude <projekt>/.claude
```

Bringt vier Slash-Kommandos mit: `/grundriss-pruefen`, `/grundriss-aendern`,
`/grundriss-rendern`, `/grundriss-rekonstruieren`. → `integrations/claude-code/README.md`

### Codex

```bash
cp integrations/codex/AGENTS.md <projekt>/AGENTS.md
```

→ `integrations/codex/README.md`

### ChatGPT / ChatGPT Work

Das fertige, **self-contained** Skill-Paket liegt jedem Release als `skill.zip` bei — es trägt
den Core mit sich und braucht weder Git-Clone noch `npm install` noch Netz:

```bash
unzip skill.zip -d ./skill
node ./skill/floorplan/scripts/floorplan.js --version
```

Selbst bauen:

```bash
npm run build:skill    # dist/chatgpt/skill.zip, reproduzierbar
npm run verify:skill   # entpackt außerhalb des Repos und prüft es dort
```

→ `integrations/chatgpt/README.md`, `docs/adr/0017-self-contained-skill-bundle.md`

Alle drei Adapter verweisen auf denselben Contract und enthalten **null** Fachlogik.
`tests/integrations.test.js` erzwingt das: Es prüft, dass jedes erwähnte Kommando und jede
erwähnte Operation existiert und dass kein Adapter eigene Maßregeln erfindet.

---

## Aus einem Bild oder PDF rekonstruieren

Nie direkt in ein Floorplan schreiben. Der Weg führt über den Observation Layer:

```bash
# 1. Der Agent schreibt Hypothesen mit Confidence und Quellverweis
floorplan schema observations

# 2. Deterministische Zusammenführung
floorplan reconcile plan.observations.json --default-thickness-mm 120 --output plan.floorplan.json
```

Der Bericht nennt **jede** nicht verwertete Beobachtung mit Begründung:

```text
observations: 20  accepted 14  merged 2  rejected 4
quality: marketing — No reliable calibration: the document stays at "marketing".

assumptions made:
  - Default wall thickness 120 mm was applied where the observation gave none; recorded as "estimated".

unused observations:
  obs_window_no_sill    a window needs sill_mm; the sill height is never guessed
  obs_opening_floating  no wall found within 400 mm of the opening
```

Details: `docs/observations.md`.

---

## Entwicklung und Release

```bash
npm test              # vollständige Testsuite, ohne Abhängigkeiten
npm run typecheck     # optionale Typprüfung über JSDoc
npm run demo          # End-to-End-Demonstration nach ./out
npm run build:skill   # dist/chatgpt/skill.zip, reproduzierbar gebaut
npm run verify:skill  # beweist, dass das Bundle self-contained ist
npm run generate      # Operations-Schema und Skill-References neu erzeugen
npm run check         # alles davon — genau das, was CI ausführt
```

CI prüft bei jedem Push Tests (Node 20/22/24), Typecheck, Ajv-Konformität, die MVP-Demo,
Golden-Snapshots und Renderer-Determinismus, alle Fixtures, die Aktualität generierter Dateien,
das Skill-Paket und die Repository-Hygiene — darunter, dass **keine** personenbezogenen
Quelldaten getrackt werden.

Versionierung, Release-Ablauf und die Gates vor `v0.1.0`: `RELEASING.md`.
Änderungen: `CHANGELOG.md`.

## Repository

```text
├── ARCHITECTURE.md          Schichten, Prinzipien, Determinismus
├── ROADMAP.md               Scope, Risiken, Meilensteine
├── RELEASING.md             Versionsschema, Release-Ablauf, Release-Gates
├── CHANGELOG.md             Änderungen je Version
├── bin/floorplan.js         CLI-Einstiegspunkt
├── schema/                  floorplan · operations · observations · theme
├── src/
│   ├── model/               Dokument, Index, IDs, Defaults, Provenance, Maße, IO
│   ├── geometry/            Vektoren, Segmente, Polygone, Wandkörper, Konturen
│   ├── topology/            Raumgraph, Erreichbarkeit
│   ├── validation/          Schema-Validator, semantische Regeln, Severity-Policy
│   ├── operations/          Registry, Apply-Engine, 31 Operationen
│   ├── render/              Layout, Stile, SVG-Renderer, Symbole
│   ├── themes/              YAML-Parser, Defaults, Auflösung
│   ├── importers/           Observation-Reconciler
│   └── cli/                 Kommandos, Argumente, Ausgabe
├── themes/                  technical · marketing · minimal
├── fixtures/                sechs synthetische Testgrundrisse
├── tests/                   Testsuite inkl. Golden-SVGs
├── docs/                    Fachdokumentation und ADRs
└── integrations/            claude-code · codex · chatgpt
```

## Dokumentation

| Datei | Inhalt |
|---|---|
| `docs/agent-contract.md` | **verbindlich für alle KI-Agenten** |
| `docs/object-model.md` | Objektmodell im Detail |
| `docs/geometry-model.md` | Einheiten, Achsen, Wandkörper, Polygone |
| `docs/operations.md` | Änderungsvokabular, Historie, Undo |
| `docs/provenance.md` | Herkunft, Confidence, Qualitätsstufen |
| `docs/validation.md` | alle Regeln, Severity-Matrix, eigene Regeln ergänzen |
| `docs/rendering.md` | Ebenen, Symbole, Determinismus |
| `docs/themes.md` | Themes, Corporate Design |
| `docs/observations.md` | Rekonstruktion aus Bildern und PDFs |
| `docs/cli.md` | vollständige CLI-Referenz |
| `docs/versioning.md` | Schema-Versionierung und Kompatibilität |
| `docs/extension-points.md` | DXF, IFC, 3D, Wohnfläche, Baurecht — wo sie andocken |
| `docs/adr/` | 17 Architekturentscheidungen mit Begründung |

## Fixtures

| Fixture | Zeigt |
|---|---|
| `01-simple-room` | minimal gültiges Dokument, Eckverschneidung, Öffnungsverankerung |
| `02-apartment` | Innenwände mit T-Stößen, mehrere Türen, offener Durchgang, Raumgraph |
| `03-house-ground-floor` | drei Wandstärken, L-förmiger Raum, Treppe, Bemaßung |
| `04-garage` | Garagentore, Stütze, sehr breite Öffnungen |
| `05-renovation` | Bestand · Abbruch · Neubau · Planung in einem Modell |
| `06-uncertain-reconstruction` | Observation Layer, geschätzte Maße, ehrlicher Bericht |

Alle Fixtures sind **synthetische Testdaten**, keine realen Gebäude und keine normativen
Architekturbeispiele.

## Was v0.1 bewusst nicht ist

Kein Web-Editor · keine Bildgenerierung · kein vollständiges BIM · keine Datenbank ·
keine Möblierung · keine Wohnflächenberechnung nach WoFlV · **keine baurechtlichen Aussagen**.

Wo diese Themen andocken würden, steht in `docs/extension-points.md`.
