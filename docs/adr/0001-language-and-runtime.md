# ADR 0001 — Programmiersprache und Laufzeitumgebung

Status: akzeptiert · Datum: 2026-08-15 · Betrifft: gesamtes Projekt

## Kontext

Der Core muss von LLM-Agenten (Claude Code, Codex, ChatGPT Skills) in fremden, teils
netzwerkbeschränkten Sandboxes zuverlässig ausgeführt werden. Kandidaten: TypeScript/Node.js
oder Python. Der Auftrag verbietet unnötigen Polyglot-Aufbau.

## Bewertung

| Kriterium | Node.js/TS | Python |
|---|---|---|
| JSON Schema | Ajv (Referenzimplementierung, sehr gut) | jsonschema (gut) |
| SVG-Erzeugung | String-basiert, trivial, ohne Lib | svgwrite/lxml, ebenfalls einfach |
| Geometrie | keine starke Standard-Lib | **shapely (GEOS) — deutlich stärker** |
| CLI | sehr gut (`npx`, keine venv-Problematik) | gut (argparse), aber venv/pip-Fragmentierung |
| Tests | `node --test` eingebaut ab Node 18 | pytest (externe Dependency) |
| DXF/IFC-Zukunft | schwach (kaum reife Libs) | **ezdxf, ifcopenshell — klarer Vorteil** |
| Verfügbarkeit in Agenten-Sandboxes | **sehr hoch** (Claude Code ist selbst Node) | hoch, aber Versions-/venv-Risiko |
| Installation ohne Netz | **möglich (0 Dependencies)** | nur ohne shapely/numpy möglich |

Der Ausschlag gebende Punkt ist nicht Bibliotheksreichtum, sondern **Ausführbarkeit ohne
Installationsschritt**. Ein Agent, der `npm install` oder `pip install` in einer Offline-Sandbox
ausführen muss, scheitert oder halluziniert Workarounds. Die für v0.1 benötigte Geometrie
(Polygonfläche, Punkt-in-Polygon, Segmentschnitt, Offset-Rechtecke, Kanten-Clipping) ist
überschaubar und lässt sich präzise und testbar selbst implementieren; shapely wäre Komfort,
kein Enabler.

## Entscheidung

**Node.js ≥ 20, reines ES-Modul-JavaScript mit JSDoc-Typannotationen, null Runtime-Dependencies,
kein Build-Schritt.**

* Typprüfung erfolgt statisch über `npx tsc --noEmit` mit `checkJs` (`tsconfig.json`) und ist
  optional — sie ist Entwicklungswerkzeug, keine Laufzeitvoraussetzung.
* Tests laufen mit dem eingebauten `node --test`.
* JSON-Schema-Validierung erfolgt über eine eigene Subset-Implementierung (→ ADR 0011).
* YAML-Themes werden von einem eigenen Subset-Parser gelesen (→ ADR 0012).

## Warum nicht TypeScript mit Build?

TypeScript-Quellen erfordern `npm install` + `tsc` vor der ersten Ausführung. Das bricht die
Kernanforderung "Agent kann das Repo klonen und sofort benutzen" und führt zu einem Zustand,
in dem `dist/` und `src/` auseinanderlaufen können. JSDoc + `checkJs` liefert praktisch dieselbe
Typsicherheit im Editor und im CI, ohne diese Kosten. Die Typen leben in
`src/model/types.js` als JSDoc-`@typedef`s und sind aus dem Schema ableitbar.

## Konsequenzen

* Positiv: `node bin/floorplan.js validate x.floorplan.json` funktioniert unmittelbar nach `git clone`.
* Positiv: Der Quellcode, den ein Agent liest, ist exakt der Code, der läuft.
* Negativ: Wir pflegen einen eigenen (bewusst kleinen) JSON-Schema- und YAML-Parser.
  Mitigation: enger, dokumentierter Feature-Umfang + eigene Testsuite + optionaler
  Konformitätsabgleich gegen `ajv`, falls es in der Umgebung vorhanden ist.
* Negativ: Für DXF/IFC wird später ein separates Modul nötig. Das ist akzeptabel, weil diese
  Formate ohnehin über einen Importer/Exporter-Prozess laufen, der auch als Sidecar
  (eigener Prozess, eigene Sprache) angebunden werden kann, ohne den Core zu berühren
  (→ `docs/extension-points.md`).
