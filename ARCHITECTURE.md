# Architecture — Floorplan Intelligence Platform

Status: v0.1 (MVP)
Sprache der Dokumentation: Deutsch. Sprache von Code, Schema-Keys, CLI und Fehlermeldungen: Englisch.

---

## 1. Grundidee in einem Satz

Ein Grundriss ist ein **deterministisches, validierbares Datenmodell** (`*.floorplan.json`).
Alles andere — Sprache, Bilder, PDFs, LLMs, SVGs, PowerPoint — ist entweder **Eingang** in dieses
Modell oder **Ausgang** aus diesem Modell, niemals das Modell selbst.

```text
Input (Sprache / Bild / PDF / Scan / DXF)
  │
  ▼
Interpretation  ────────────► (LLM / Vision / Parser — austauschbar, nicht vertrauenswürdig)
  │
  ▼
Observations (*.observations.json)      Zwischenschicht mit Confidence + Quelle
  │
  ▼
Reconciliation                          deterministisch, regelbasiert
  │
  ▼
Canonical Floorplan Model (*.floorplan.json)   ◄── SOURCE OF TRUTH
  │
  ├─► Validation (ERROR / WARNING / INFO)
  ├─► Topology (Space-Connectivity-Graph)
  ├─► Operations (validierbare, umkehrbare Änderungen)
  └─► Geometry Engine ─► Renderer (SVG) ─► Theme ─► Export (PNG/PDF/PPTX/Web)
```

**Ein LLM verändert niemals Pixel und möglichst auch nicht rohes JSON — es formuliert Operationen.**

---

## 2. Schichtenmodell und Abhängigkeitsrichtung

Abhängigkeiten zeigen ausschließlich nach unten. Keine Schicht kennt eine Schicht über sich.

```text
┌──────────────────────────────────────────────────────────────────────┐
│ integrations/   claude-code · codex · chatgpt   (nur Prompts/Configs)│  keine Geschäftslogik
├──────────────────────────────────────────────────────────────────────┤
│ src/cli/        Kommandos, Argument-Parsing, JSON-Ausgabe, Exitcodes │
├──────────────────────────────────────────────────────────────────────┤
│ src/render/     SVG-Renderer   │ src/importers/  Observation-Import  │
│ src/themes/     Theme-Auflösung│ src/exporters/  Datei-Export        │
├──────────────────────────────────────────────────────────────────────┤
│ src/operations/ Operations-Registry + Apply + Inverse (Undo)         │
├──────────────────────────────────────────────────────────────────────┤
│ src/validation/ Schema-Validator + semantische Regeln + Severity     │
├──────────────────────────────────────────────────────────────────────┤
│ src/topology/   Connectivity-Graph, Opening↔Space-Ableitung          │
├──────────────────────────────────────────────────────────────────────┤
│ src/geometry/   Vektoren, Polygone, Segmente, Wandkörper, Joins      │
├──────────────────────────────────────────────────────────────────────┤
│ src/model/      Dokument, Index, IDs, Defaults, Provenance, Einheiten│
├──────────────────────────────────────────────────────────────────────┤
│ src/util/       Fehler, stabile JSON-Serialisierung, Hashing         │
└──────────────────────────────────────────────────────────────────────┘
```

Harte Regeln:

* `src/model`, `src/geometry`, `src/topology`, `src/validation`, `src/operations` kennen **kein**
  Rendering, **keine** Themes, **keine** Farben, **keine** CLI, **kein** Dateisystem
  (Ausnahme: `model/io.js` als einzige Datei mit `fs`-Zugriff für Laden/Speichern).
* `src/render` kennt **keine** Geschäftsregeln — es zeichnet nur, was das Modell sagt.
* `integrations/` enthält **null** Geometrie- oder Validierungslogik, ausschließlich Anleitungen
  und Aufrufe der CLI.

---

## 3. Die vier Dateiformate

| Datei | Rolle | Wer schreibt sie |
|---|---|---|
| `*.floorplan.json` | Source of Truth. Kanonisches Modell. | Core (via `apply`, `reconcile`, `create`) — **nicht** frei von Agenten |
| `*.ops.json` | Änderungsabsicht als Liste expliziter Operationen | Agent / Mensch |
| `*.observations.json` | Rohe Interpretationen aus Bild/PDF/Sprache inkl. Confidence | Vision-Modell / LLM / Parser |
| `themes/*.yaml` | Rein visuelle Gestaltung | Mensch / CD-Ableitung |

Ein Agent, der Geometrie ändern will, schreibt eine `*.ops.json` und ruft `floorplan apply` auf.
Direktes Editieren von `*.floorplan.json` ist erlaubt, aber der letzte Ausweg — siehe
`docs/agent-contract.md`.

---

## 4. Kanonisches Modell — Aufbau

```text
FloorplanDocument
├── schema_version : "0.1"
├── unit           : "mm"        (fix, explizit, keine Ambiguität)
├── project        : { id, name, quality, defaults, … }
├── sources[]      : Herkunftsnachweise (Datei, Seite, Beschreibung)
├── buildings[]
│   └── levels[]
│       ├── walls[]        Mittellinie + Dicke
│       ├── openings[]     door | window | passage | generic_opening (hosted an Wall)
│       ├── spaces[]       explizites Polygon + Semantik
│       ├── columns[]
│       ├── stairs[]
│       ├── shafts[]
│       ├── dimensions[]
│       └── annotations[]
├── history[]      : angewandte Operationen inkl. Inverse (Undo)
└── revision       : Integer, monoton
```

Details: `docs/object-model.md`, Schema: `schema/floorplan.schema.json`.

### Warum verschachtelt statt flach?

Container-Hierarchie ist für Menschen und Agenten lesbar und verhindert verwaiste Elemente.
Für O(1)-Zugriff baut `model/index.js` beim Laden einen Index `id → { element, level, building, collection }`.
Alle IDs sind **dokumentweit eindeutig** (Validator erzwingt das), sodass Operationen nur eine ID
brauchen und nicht wissen müssen, wo ein Element liegt.

---

## 5. Die fünf Kernentscheidungen (Kurzfassung)

Vollständige Begründungen in `docs/adr/`.

1. **Runtime: Node.js ≥ 20, reines ESM-JavaScript mit JSDoc-Typen, null Runtime-Dependencies.**
   `git clone && node bin/floorplan.js` funktioniert sofort — ohne `npm install`, ohne Build.
   Typprüfung optional über `npx tsc`. → ADR 0001
2. **Einheit: Millimeter als Ganzzahl.** Keine Gleitkomma-Meter im Modell. Flächen in mm²,
   Ausgabe in m² nur an der Oberfläche. → ADR 0002
3. **Wand = Mittellinie + Dicke.** Wandkörper werden zur Laufzeit berechnet (inkl. Ecken-Verschneidung).
   → ADR 0004
4. **Opening ist parametrisch an seiner Wand verankert:** `host_wall_id` + `offset_mm` (= **Mitte**
   der Öffnung, gemessen von `wall.start` entlang der Mittellinie) + `width_mm`.
   Türen verlieren dadurch nie den Bezug zur Wand. → ADR 0005
5. **Provenance auf Objektebene mit optionalem Property-Override**, nicht als Wrapper um jede Zahl.
   → ADR 0008

---

## 6. Determinismus

Determinismus ist eine Produktanforderung, nicht ein Nebeneffekt. Konkret:

* **Keine Zeitstempel** in Ausgaben, außer explizit über `--stamp <iso8601>` übergeben.
* **Keine Zufalls-IDs.** IDs entstehen aus typbezogenen Zählern (`wall_007`) oder werden vorgegeben.
* **Stabile JSON-Serialisierung**: feste Schlüsselreihenfolge, 2 Leerzeichen, LF, abschließender Zeilenumbruch.
* **Stabile Zahlenformatierung im SVG**: feste Nachkommastellen, `-0` wird zu `0` normalisiert,
  kein `toLocaleString`.
* **Stabile Reihenfolge** aller Iterationen (Dokumentreihenfolge, nie `Object.keys` von Maps mit
  unklarer Ordnung, nie `Set`-Iteration ohne Sortierung).
* Folge: `render` zweimal auf derselben Eingabe erzeugt **byteidentische** SVGs → Golden-Tests.

---

## 7. Validierung als Produktbestandteil

Zwei Stufen:

1. **Schema-Validierung** (`src/validation/schemaValidator.js`) — struktureller Vertrag.
   Eigene, abhängigkeitsfreie Implementierung eines definierten JSON-Schema-2020-12-Subsets
   (siehe ADR 0011); optionaler Konformitätsabgleich gegen `ajv`, falls installiert.
2. **Semantische Validierung** (`src/validation/semantic/*`) — der eigentliche Wert:
   Referenzen, Geometrie, Topologie, Provenance, Plausibilität.

Jede Regel hat eine stabile **Rule-ID** (z. B. `OPENING_OUTSIDE_WALL`) und eine **Basis-Severity**.
Die Qualitätsstufe des Dokuments (`marketing` / `scaled` / `verified`) kann die Severity anheben:

```text
                       marketing   scaled     verified
MISSING_DIMENSIONS       INFO      WARNING    ERROR
ESTIMATED_VALUE          INFO      WARNING    ERROR
AREA_MISMATCH            INFO      WARNING    ERROR
OPENING_OUTSIDE_WALL     ERROR     ERROR      ERROR
```

Die Matrix steht datengetrieben in `src/validation/severityPolicy.js`, nicht verstreut im Code.

---

## 8. Operationen statt JSON-Umschreiben

Eine Operation ist ein kleines, benanntes, schema-validiertes JSON-Objekt.
`apply` ist eine reine Funktion:

```text
apply(document, operations) -> { document', results[], inverse[] }
```

* Das Eingabedokument wird **nie** mutiert (Deep Copy).
* Jede Operation liefert eine **Inverse** zurück → `floorplan undo` ohne Event-Sourcing-Stack.
* Jede Operation ist einzeln testbar und einzeln beschreibbar (`floorplan ops list --json`),
  sodass ein Agent das verfügbare Vokabular zur Laufzeit entdecken kann.
* Schlägt eine Operation fehl, wird der **gesamte Batch** verworfen (atomar) — kein Halbzustand.

---

## 9. Rendering

`src/render/svg/` erzeugt SVG aus Modell + Theme:

```text
Model ──► GeometryBuild ──► DrawPlan (abstrakte Zeichenprimitive) ──► SVG-Serializer
                 ▲                        ▲
              Geometrie               Theme (Farben, Strichstärken, Schrift, Symbole)
```

`DrawPlan` ist bewusst eine Zwischenschicht: dieselbe Primitivliste kann später von einem
PDF- oder Canvas-Backend konsumiert werden, ohne die Geometrie erneut zu bauen.

Wandkörper werden an Öffnungen **segmentiert** (echte Wandunterbrechung, keine überzeichneten
weißen Rechtecke) und an Ecken **verschnitten** (Miter/T-Stoß). Die sichtbare Außenkontur
entsteht durch Kanten-Clipping gegen die übrigen Wandkörper — dadurch keine störenden
Innenlinien, ohne eine vollständige Boolean-Bibliothek zu benötigen.

---

## 10. Vendor-Neutralität konkret

```text
integrations/claude-code/   CLAUDE.md, .claude/commands/*.md, Skill-Definition
integrations/codex/         AGENTS.md, codex-Setupbeschreibung
integrations/chatgpt/       SKILL.md, agents/openai.yaml, references/, scripts/
```

Alle drei enthalten **denselben fachlichen Kern per Referenz**: `docs/agent-contract.md`.
Sie unterscheiden sich nur in Format und Aufrufkonvention der jeweiligen Plattform.
Ein Widerspruch zwischen Adapter und Contract ist ein Bug; `tests/integrations.test.js`
prüft, dass jeder Adapter auf den Contract verweist und keine eigenen Maß- oder Geometrieregeln
erfindet.

---

## 11. Bewusst nicht Teil von v0.1

Web-Editor · generative Bild-KI · vollständiges BIM/IFC · Datenbank · Microservices ·
Möblierungsautomatik · baurechtliche Regelwerke · 3D-Ansicht · echter DXF-Parser.

Erweiterungspunkte dafür sind vorbereitet und in `docs/extension-points.md` beschrieben.
