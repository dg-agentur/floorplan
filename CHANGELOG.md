# Changelog

Alle nennenswerten Änderungen an diesem Projekt. Format nach
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung nach
[Semantic Versioning](https://semver.org/lang/de/) (→ `docs/adr/0016-software-versioning-and-release.md`).

Die Version der **Software** ist unabhängig von der Version der **Datenformate**
(`schema_version`, → `docs/adr/0010-versioning.md`). Ein Eintrag nennt beides, wenn sich beides
ändert.

## [Unreleased]

Nichts.

## [0.1.0-alpha.1] — 2026-08-15

Erstes Vorabrelease des verifizierten MVP. Datenformate: Floorplan `0.1`, Operations `0.1`,
Observations `0.1`.

> **Vorabrelease.** Die beiden Gates für ein stabiles `v0.1.0` sind noch offen: ein
> vollständiger Real-World-Test mit einem echten Grundriss und ein erfolgreicher Test des
> gepackten Skills in ChatGPT Work. Siehe `RELEASING.md`.

### Hinzugefügt

**Kanonisches Modell**
- `*.floorplan.json` mit JSON Schema: Project · Building · Level · Wall · Opening
  (Door/Window/Passage/GenericOpening) · Space · Column · Stair · Shaft · Dimension · Annotation
- Ganzzahlige Millimeter, 2,5D-Geometrie, dokumentweit eindeutige und stabile IDs
- Bauzustände `existing` · `planned` · `new` · `demolish` · `unknown` in **einem** Modell
- Provenance je Objekt mit optionalem Override je Property, plus `confidence` und `verified`
- Qualitätsstufen `marketing` · `scaled` · `verified`, die die Validierung steuern

**Validierung**
- Abhängigkeitsfreier JSON-Schema-Validator für ein definiertes Draft-2020-12-Subset
- 37 semantische Regeln zu Referenzen, Geometrie, Topologie, Provenance und Plausibilität
- Severity je Qualitätsstufe aus einer einzigen Policy-Tabelle
- Saubere Trennung von geometrischer Gültigkeit, architektonischer Plausibilität und
  rechtlicher Zulässigkeit — letztere wird ausdrücklich **nicht** geprüft

**Operationen**
- 31 Operationen; `apply` ist rein, atomar, umkehrbar, protokolliert und deterministisch
- Undo über gespeicherte Inverse, ohne Event-Sourcing-Stack
- `move_wall` zieht angrenzende Wände und Raumkanten korrekt mit und berichtet, was es anfasste

**Geometrie und Topologie**
- Wandkörper aus Mittellinie und Dicke, mit L-, T- und X-Stoß-Verschneidung
- Öffnungen als echte Lücken in der Wandgeometrie, nicht als übermalte Rechtecke
- Außenkontur über Kanten-Clipping statt einer Boolean-Bibliothek
- Raumgraph aus der Geometrie abgeleitet, inklusive Erreichbarkeit und Wegsuche

**Rendering**
- Deterministischer SVG-Renderer ohne Bild-KI; zweimal rendern ergibt byteidentische Dateien
- Themes `technical`, `marketing`, `minimal` mit Vererbung und strikter Validierung
- Ein Theme kann Geometrie weder erzeugen noch verändern (durch Test abgesichert)

**Schnittstellen**
- CLI mit 12 Befehlsgruppen, durchgängig `--json`, definierten Exitcodes und
  Selbstbeschreibung (`ops list`, `ops describe`, `rules`, `schema`)
- Öffentliche JS-API in `src/index.js`
- Observation Layer mit regelbasiertem, deterministischem Reconciler und einem Bericht, der
  **jede** nicht verwertete Beobachtung mit Begründung nennt

**Agent-Integrationen**
- Vendor-neutraler Agent Contract als einzige fachliche Quelle
- Adapter für Claude Code (inklusive vier Slash-Kommandos), Codex und ChatGPT
- Self-contained ChatGPT-Skill-Bundle: `dist/chatgpt/skill.zip`, reproduzierbar gebaut, ohne
  Git-Clone und ohne `npm install` lauffähig

**Qualitätssicherung**
- 331 Tests, davon Golden-Snapshots für SVG und ein optionaler Konformitätsabgleich des
  eigenen Schema-Validators gegen Ajv
- Sechs synthetische Fixtures, ausführbare MVP-Demonstration (`npm run demo`)
- 30 Dokumentationsdateien, darunter 17 Architecture Decision Records

### Bekannte Einschränkungen

- **Maßketten** werden nicht unterstützt; nur einzelne Maßlinien. Der Abgleich mit echten
  bemaßten Bauzeichnungen hat das als sichtbarste Lücke zum Werkplan ergeben
  (→ `docs/extension-points.md`).
- Kein DXF, kein IFC, keine 3D-Ansicht, keine Möblierung, keine Wohnflächenberechnung
- Kein `design`-Solver: Varianten entstehen dadurch, dass ein Agent Operationen schreibt
- Gekrümmte Wände, Dachschrägen und Split-Level sind nicht darstellbar

[Unreleased]: https://github.com/dg-agentur/floorplan/compare/v0.1.0-alpha.1...HEAD
[0.1.0-alpha.1]: https://github.com/dg-agentur/floorplan/releases/tag/v0.1.0-alpha.1
