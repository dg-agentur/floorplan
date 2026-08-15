# Scope, Risiken und Meilensteine

## 1. MVP-Scope (v0.1)

**Enthalten:**

* Kanonisches Modell `*.floorplan.json` + JSON Schema (Floorplan, Operations, Observations, Theme)
* Laden/Speichern mit stabiler Serialisierung, Dokument-Index, Defaults, Provenance-Auflösung
* Geometrie: Vektoren, Segmente, Polygone, Wandkörper mit Ecken-Verschneidung und
  Öffnungs-Segmentierung
* Topologie: Opening↔Space-Ableitung, Connectivity-Graph, Erreichbarkeitsanalyse
* Validierung: Schema + 25 semantische Regeln, Severity abhängig von der Qualitätsstufe
* Operationen: 24 Operationen mit Vorprüfung, Atomarität, Inverse und Historie
* SVG-Renderer: deterministisch, themefähig, mit Tür-/Fenster-/Durchgangs-/Treppensymbolik
* Themes: `technical`, `marketing`, `minimal` (+ Schema, Vererbung, Validierung)
* CLI: 11 Befehlsgruppen, durchgängig `--json`
* Observation-Reconciler (regelbasiert, deterministisch)
* 6 synthetische Fixtures + Testsuite inkl. Golden-SVGs
* Integrationen für Claude Code, Codex, ChatGPT-Skill
* Dokumentation inkl. vendor-neutralem Agent Contract

**Nicht enthalten (bewusst):** Web-Editor · Bild-/PDF-Parser · DXF/IFC · 3D · Möblierung ·
Bildgenerierung · Datenbank · baurechtliche Regelwerke · automatische Grundrissgenerierung
aus Anforderungen (der `design`-Modus ist in v0.1 der Agent, der Operationen schreibt —
kein Solver).

## 2. Risiken und Gegenmaßnahmen

| # | Risiko | Auswirkung | Gegenmaßnahme |
|---|---|---|---|
| R1 | Eigener JSON-Schema-Validator weicht vom Standard ab | falsche Dateien werden akzeptiert | Meta-Test verbietet ungenutzte Schlüsselwörter im Schema; Konformitätstest gegen Ajv, falls vorhanden (ADR 0011) |
| R2 | Wand-Ecken/T-Stöße rendern fehlerhaft | unbrauchbare Grundrisse | eigene Geometrie-Unit-Tests je Stoßart; Golden-SVGs; Fixtures mit L-, T- und X-Stößen |
| R3 | Space-Polygone laufen bei Wandänderungen aus dem Ruder | stille Inkonsistenz | `move_wall` zieht kollineare Raumkanten mit + Validierungsregel `SPACE_BOUNDARY_OFF_WALL` + Ausgabe der mitveränderten Elemente |
| R4 | LLM schreibt trotz Contract direkt im JSON herum | Modell wird ungültig | strikte Schemas (`additionalProperties: false`), `validate` als Pflichtschritt, deutliche Regeln im Agent Contract, Operationen als bequemster Weg |
| R5 | Erfundene Maße | fachlich falsche Aussagen, Haftungsrisiko | Provenance-Pflicht, Qualitätsstufen mit harter Validierung, `set_project_quality` als Nachweis statt Behauptung (ADR 0008/0015) |
| R6 | Nichtdeterministisches Rendering | Golden-Tests unbrauchbar, Diffs unlesbar | keine Zeitstempel/Zufalls-IDs, feste Zahlenformatierung, sortierte Iteration, Determinismustest (zweimal rendern, Byte-Vergleich) |
| R7 | Adapter für Claude/Codex/ChatGPT driften auseinander | widersprüchliches Verhalten je Plattform | ein Agent Contract als Quelle, Adapter referenzieren ihn, Test prüft Referenz und verbietet plattformeigene Fachregeln |
| R8 | Schema wird auf die Fixtures zugeschnitten | reale Daten passen später nicht | Fixtures decken bewusst gegensätzliche Fälle ab (Bestand/Umbau/unsicher); `meta`-Feld als Ventil; additive Versionierung (ADR 0010) |
| R9 | Öffnungs-Offset-Konvention missverstanden | Türen an falscher Stelle | Konvention an genau einer Stelle definiert (ADR 0005), im Schema dokumentiert, im Agent Contract wiederholt, Test mit asymmetrischer Breitenänderung |
| R10 | Reconciler erzeugt aus schlechten Observations gute Optik | Scheingenauigkeit | Report über nicht verwertete Observations, erzwungene `estimated`-Provenance, Qualitätsstufe bleibt `marketing` ohne Kalibrierung |

## 3. Meilensteine

| M | Inhalt | Abschlusskriterium |
|---|---|---|
| **M1** | Projektgerüst, Schemas, Modell-IO, Index, Schema-Validator, Fixture 01, CLI-Skelett (`validate`, `inspect`, `schema`) | `floorplan validate fixtures/01-simple-room/simple-room.floorplan.json` läuft grün |
| **M2** | Geometrie + Topologie + semantische Regeln + Graph | `floorplan graph` liefert korrekten Raumgraph für Fixture 02 |
| **M3** | Operations-Engine, alle Operationen, Inverse, Historie, `apply`/`undo` | Tür verschieben → validieren → rückgängig ergibt Ausgangsdatei byteidentisch |
| **M4** | Themes + SVG-Renderer | technical/marketing erzeugen sichtbar verschiedene, byteidentisch reproduzierbare SVGs |
| **M5** | Fixtures 02–06, vollständige Testsuite, Golden-SVGs, MVP-Demo-Skript | `npm test` grün, `npm run demo` erfüllt alle 10 Punkte der MVP-Definition |
| **M6** | Observation-Schema + Reconciler + Fixture 06 | Rekonstruktion aus Observations erzeugt validierbares `marketing`-Modell mit Report |
| **M7** | Integrationen Claude Code / Codex / ChatGPT | jeder Adapter referenziert den Agent Contract, Test prüft Konsistenz |
| **M8** | Dokumentation (Objektmodell, Geometrie, Operationen, Provenance, Rendering, CLI, Agent Contract), README | ein fremder Entwickler/Agent kann ohne Gesprächskontext arbeiten |

## 4. Ausblick nach v0.1

Priorisiert nach Nutzen pro Aufwand. Punkt 1 stammt aus dem Abgleich mit realen bemaßten
Bauzeichnungen (siehe `docs/extension-points.md`, Abschnitt „Abgleich mit echten
Bauzeichnungen“) und ist die sichtbarste Lücke zwischen der heutigen Ausgabe und einem Werkplan.

1. **Maßketten** (`dimension_chain`) und darauf aufbauend **automatische Bemaßung**
2. **PNG/PDF-Export** über einen headless Konverter (SVG bleibt die Quelle)
3. **Wohnflächenberechnung** (WoFlV/DIN 277) als eigenes, explizit benanntes Modul
4. **DXF-Export** (R12 ASCII genügt für die meisten Empfänger)
5. **Raum-Ableitung aus Wänden** (planare Facettensuche) als Reparaturwerkzeug
6. **Einbauten** (Sanitär, Küche, Kamin) als eigene Collections mit Katalogreferenz
7. **Constraint-basierte Variantenplanung** (der eigentliche `design`-Solver)
8. **DXF-Import**, **IFC** als Sidecar-Prozess
9. **Baurechtsmodule** als explizite, datengetriebene Regelpakete mit Quellenangabe

## 5. Umgang mit realen Beispielplänen

Unter `Beispiele/` liegen reale bemaßte Grundrisse als Referenzmaterial. Sie enthalten
**personenbezogene Daten** (Bauherr, Planverfasser, Adressen, Flurstücksnummern) und sind
deshalb:

* **kein** Bestandteil der Fixtures und keine Testdaten,
* nicht Teil des veröffentlichten Pakets (`package.json` → `files`),
* vor einem Commit in ein geteiltes Repository zu prüfen — im Zweifel gehören sie in
  `.gitignore` oder in einen separaten, nicht veröffentlichten Ordner.

Ihr Wert liegt im Abgleich: Sie zeigen, was ein echter Werkplan enthält, und haben bereits eine
Schema-Inkonsistenz (fehlende `stair.rise_mm`/`run_mm`) und die Maßketten-Lücke aufgedeckt.
