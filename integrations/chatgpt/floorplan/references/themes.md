# Themes und Corporate Design

Ein Theme enthält **ausschließlich** visuelle Parameter. Es kann Geometrie weder erzeugen noch
verändern. Ein Theme-Wechsel verändert nie eine Koordinate — `tests/render.test.js` prüft das,
indem es die Wandgeometrie zweier Themes byteweise vergleicht.

## Mitgelieferte Themes

| Theme | Zweck |
|---|---|
| `technical` | Werkplan-Anmutung: Bemaßung sichtbar, neutrale Grautöne, klare Bauzustände |
| `marketing` | Exposé und Präsentation: weiche Raumfarben, keine Maßketten, großzügige Typografie |
| `minimal` | reine Linienzeichnung: keine Flächen, keine Flächenangaben, nur Umriss und Namen |

```bash
floorplan theme list
floorplan theme show marketing
floorplan theme validate mein-theme.yaml
floorplan render plan.floorplan.json --theme marketing --output plan.svg
floorplan render plan.floorplan.json --theme ./themes/kunde-a.yaml --output plan.svg
```

## Aufbau

```yaml
name: kunde-a
extends: marketing        # optional, erbt alle Werte
description: Corporate Design Kunde A

page:
  background: "#ffffff"
  margin_mm: 900
  scale_mode: fit         # fit | fixed
  target_width_px: 1600
  font_family: "Inter, Helvetica, sans-serif"

walls:
  default:
    fill: "#2b2b2b"
    stroke: none
    stroke_width_px: 0
  by_classification:
    exterior: { fill: "#2b2b2b" }
    partition: { fill: "#6b6b6b" }
  by_state:
    demolish:
      fill: none
      stroke: "#b03a2e"
      dash: "7 4"

openings:
  door:
    show_arc: true
    leaf_thickness_mm: 45
  window:
    style: frame
  passage:
    style: none
  by_state:
    demolish:
      leaf_stroke: "#b03a2e"
      arc_stroke: "#b03a2e"
      dash: "6 4"

spaces:
  show_fill: true
  by_category:
    kitchen: { fill: "#f7f0e4" }
    bath: { fill: "#e8eef1" }

labels:
  show_name: true
  show_area: true
  name_transform: uppercase
  area_decimals: 1
  decimal_separator: ","
  area_suffix: " m²"

dimensions:
  show: false

uncertainty:
  mark_estimated: true
  estimated_prefix: "ca. "
```

Vollständiger Wertebereich: `schema/theme.schema.json`, Vorbelegungen: `src/themes/defaults.js`.
Ein Theme muss **nur seine Abweichungen** nennen; alles andere wird geerbt.

## Die Regel `_px` versus `_mm`

| Suffix | Bedeutung | Im Theme erlaubt |
|---|---|---|
| `_px` | Darstellungsgewicht (Strichstärke, Schriftgröße) | ja |
| `_mm` | Bauteilmaß | **nein** |

`walls.default.stroke_width_px` ist die **Linienstärke** der Kontur — nicht die Wanddicke. Die
kommt aus `thickness_mm` im Modell und ist für ein Theme unerreichbar.

Ausnahmen, jeweils begründet und im Test dokumentiert:
`page.margin_mm` (Seitenrand), `openings.door.leaf_thickness_mm` und `sliding_offset_mm`
(Symbolgeometrie: wie dick das *gezeichnete* Türblatt ist), sowie `px_per_mm`, `min_px_per_mm`,
`max_px_per_mm` (Maßstabsfaktoren, keine Längen).

`tests/themes.test.js` schlägt fehl, sobald ein neues `_mm`-Feld ins Theme-Schema gerät.

## Strikte Validierung

Unbekannte Schlüssel sind ein **Fehler**:

```text
error [INVALID_THEME]: Theme "typo.yaml" is invalid:
  unknown property "defualt" in walls (at /walls/defualt)
hint: Unknown keys are rejected on purpose so that a typo cannot silently disable a setting.
```

Ein stillschweigend ignorierter Tippfehler wäre schlimmer: das Theme sähe „fast richtig“ aus,
und niemand wüsste warum.

## YAML-Umfang

Der Parser ist bewusst klein (ADR 0012, Folge der Dependency-Freiheit). Unterstützt:
verschachtelte Maps über Einrückung (2 Leerzeichen), Sequenzen, Skalare (String, Zahl,
`true`/`false`, `null`/`~`), Kommentare und Blockskalare (`|`, `>`, mit `-`/`+`).

Nicht unterstützt: Anker (`&`), Aliase (`*`), Tags (`!!`), Flow-Collections (`[…]`, `{…}`),
mehrere Dokumente. Jedes davon erzeugt eine **präzise Fehlermeldung mit Zeilennummer**, nie
ein still falsches Ergebnis.

Alternativ funktioniert dieselbe Struktur als `.json`-Datei.

## Corporate Design ableiten

Der Weg von Markenmaterial zu einem Theme ist absichtlich zweistufig:

```text
DESIGN.md / Brandmanual / Styleguide
        │
        ▼   ein Agent liest und interpretiert (unscharf, außerhalb des Kerns)
themes/kunde-a.yaml
        │
        ▼   floorplan theme validate  (deterministisch, im Kern)
verwendbares Theme
```

Der Core enthält **keine** Interpretationslogik für Markendokumente. Das ist eine Agentenaufgabe
mit unscharfem Input und gehört per Architekturprinzip außerhalb des deterministischen Kerns.

Anleitung für den Agenten:

1. Farben, Schriften und Linienanmutung aus dem Material entnehmen.
2. `extends: marketing` (oder `technical`) setzen und nur die Abweichungen schreiben.
3. `floorplan theme validate themes/kunde-a.yaml` — Tippfehler und falsche Werte fallen hier auf.
4. Denselben Grundriss mit altem und neuem Theme rendern und **beide** zeigen.
5. Explizit sagen, dass sich ausschließlich die Darstellung geändert hat.

## Ein eigenes Theme anlegen

```bash
mkdir -p themes
cp $(node -e "console.log(process.env.PWD)")/themes/marketing.yaml themes/kunde-a.yaml
# name: anpassen, extends: marketing setzen, nur Abweichungen behalten
floorplan theme validate themes/kunde-a.yaml
floorplan render plan.floorplan.json --theme kunde-a --output plan.svg
```

Themes im Arbeitsverzeichnis (`./themes/`) haben Vorrang vor den mitgelieferten. Ein Projekt
kann `technical` dadurch überschreiben, ohne das Paket zu verändern.
