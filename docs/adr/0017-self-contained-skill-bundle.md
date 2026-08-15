# ADR 0017 — Self-contained Skill-Bundle

Status: akzeptiert · Datum: 2026-08-15 · Folge aus ADR 0001 und ADR 0014

## Kontext

Der ChatGPT-Skill soll in einer fremden Ausführungsumgebung laufen. Bis hierher verwies das
Skill-Paket auf einen Core, der separat bereitgestellt werden musste — per Git-Clone, per
`FLOORPLAN_HOME` oder global installiert (`references/setup.md`, Optionen A–C).

Das ist für ein Repository richtig und für ein **ausgeliefertes Skill falsch**: In einer
Skill-Sandbox gibt es typischerweise kein Netz, kein Git und kein npm. Ein Skill, dessen erster
Schritt „klone dieses Repository“ lautet, funktioniert dort nicht — und ein Agent, der daran
scheitert, fängt an, sich Ersatzlösungen auszudenken. Genau dieses Verhalten soll die Plattform
verhindern.

## Optionen

1. **Verweis auf einen extern bereitgestellten Core** (Status quo). Kleinstes Artefakt,
   funktioniert aber nur, wenn jemand vorher etwas installiert hat.
2. **Skill mit gebündeltem Core.** Das Artefakt trägt den Core; keine Installation, kein Netz.
3. **Reimplementierung der wichtigsten Funktionen im Skill.** Ausgeschlossen — das wäre eine
   zweite Wahrheit über Geometrie und widerspricht dem Kernprinzip.

## Entscheidung

**Option 2.** `dist/chatgpt/skill.zip` enthält den vollständigen Core und ist ohne
Installationsschritt lauffähig.

```text
floorplan/                     ein einziges Wurzelverzeichnis, wie im Agent-Skills-Format
├── SKILL.md                   YAML-Frontmatter: name, description, license, metadata
├── MANIFEST.json              jede Datei mit SHA-256
├── LICENSE
├── agents/openai.yaml         Fähigkeiten und Aufrufkonventionen, keine Fachlogik
├── references/                die geteilte, normative Dokumentation
├── scripts/floorplan.js       Einstiegspunkt: findet core/ und reicht durch
└── core/                      der Floorplan-Core, direkt lauffähig
    ├── bin/ src/ schema/ themes/
    ├── fixtures/              Beispiele aller Dateiformate
    └── VERSION
```

Möglich ist das nur, weil der Core **null Abhängigkeiten** hat (ADR 0001). Bündeln heißt hier
Dateien kopieren — kein Bundler, kein Transpiler, kein `node_modules`. Die Entscheidung von
ADR 0001 zahlt sich an dieser Stelle unmittelbar aus.

## Warum eine Allowlist statt eines Verzeichnis-Kopierens

`scripts/build-skill.js` wählt jede Datei einzeln aus. Ein rekursives Kopieren wäre kürzer,
würde aber irgendwann `Beispiele/` (personenbezogene Grundrisse), `node_modules` oder lokale
Arbeitsdateien mitnehmen — und niemand würde es bemerken. Zusätzlich prüft der Build jede
gesammelte Datei gegen eine Sperrliste, und `scripts/verify-skill.js` prüft das Ergebnis noch
einmal am fertigen Archiv. Zwei unabhängige Schranken vor demselben Fehler.

## Warum ein eigener ZIP-Writer

Ein Release-Artefakt soll reproduzierbar sein: derselbe Stand muss dasselbe Archiv ergeben.
`zip(1)` stempelt die aktuelle Uhrzeit in jeden Eintrag und wäre außerdem eine
Werkzeugabhängigkeit. `scripts/lib/zip.js` schreibt stattdessen ein ZIP mit festem Zeitstempel,
sortierten Einträgen, fester Kompressionsstufe und festen Dateirechten — dieselbe
Determinismus-Disziplin wie beim Renderer (ARCHITECTURE.md, Abschnitt 6).

Weil die Deflate-Ausgabe theoretisch zwischen zlib-Versionen abweichen kann, liegt zusätzlich
`MANIFEST.json` im Archiv: Sie pinnt den **Inhalt** über SHA-256 je Datei, unabhängig davon,
wie er komprimiert wurde. `npm run build:skill` baut zweimal und vergleicht byteweise.

## Verifikation statt Vertrauen

`scripts/verify-skill.js` entpackt das Archiv **außerhalb** des Repositories und führt es dort
mit abgeräumter Umgebung aus: ohne `FLOORPLAN_HOME`, ohne nutzbaren `PATH`, ohne
`node_modules`, ohne Netz. Geprüft wird der volle Ablauf — `create`, `apply`, `undo`,
`validate`, `render`, `reconcile`, `graph` — plus:

* Das gebündelte Rendering ist **byteidentisch** zu dem des Repository-Cores. Ein Bundle, das
  still abdriftet, wäre schlimmer als gar keines.
* Fehlt der Core, endet der Wrapper mit Exitcode 2 und `CORE_NOT_FOUND` samt Behebungshinweis —
  er weicht nicht auf eine Teilimplementierung aus.

## Konsequenzen

* Das Artefakt wächst auf rund 190 KiB. Für ein Skill-Paket ist das unerheblich.
* Der Core existiert im Release zweimal: im Repository und im Bundle. Der Test
  „jede Quelldatei ist byteweise identisch“ stellt sicher, dass daraus keine zwei Wahrheiten
  werden.
* `references/setup.md` beschreibt weiterhin die Varianten mit externem Core — sie bleiben für
  Entwicklung und Fehlersuche nützlich. Für das ausgelieferte Bundle sind sie nicht mehr nötig.
