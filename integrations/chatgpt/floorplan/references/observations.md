# Observation Layer — aus Bildern, PDFs und Scans

## Warum eine Zwischenschicht

Ein Vision-Modell, das ein Foto eines Grundrisses liest, produziert **Vermutungen**. Schreibt es
diese direkt in das kanonische Modell, ist die Unterscheidung zwischen „gemessen“ und „geraten“
unwiederbringlich verloren — und ein Modellwechsel ist nicht mehr nachvollziehbar.

```text
source.pdf ──[Vision / LLM / Parser]──► plan.observations.json ──[reconcile]──► plan.floorplan.json
              austauschbar, unscharf        Hypothesen + Confidence     deterministisch, regelbasiert
```

Der Core enthält **keinen** Bild-, PDF- oder Rasterparser. Er definiert das Format, validiert es
und rechnet es deterministisch in ein Modell um. Genau diese Trennlinie stellt die
Vendor-Neutralität her: Jedes Vision-Modell, das `*.observations.json` erzeugt, ist verwendbar,
und die Qualität der Rekonstruktion wird anbieterunabhängig vergleichbar.

## Format

```json
{
  "schema_version": "0.1",
  "unit": "mm",
  "source": {
    "id": "src_expose",
    "kind": "image",
    "uri": "expose-plan.png",
    "width_px": 1240,
    "height_px": 880
  },
  "calibration": {
    "scale_mm_per_px": 8.06,
    "provenance": "estimated",
    "confidence": 0.55,
    "reference": "Maßstabsleiste geschätzt, unscharf gedruckt"
  },
  "interpreter": { "name": "…", "version": "…" },
  "observations": [
    {
      "id": "obs_081",
      "candidate_type": "wall",
      "confidence": 0.91,
      "geometry": {
        "kind": "segment",
        "start": { "x_mm": 0, "y_mm": 0 },
        "end":   { "x_mm": 8400, "y_mm": 0 }
      },
      "attributes": { "thickness_mm": 300, "classification": "exterior" },
      "source_ref": { "source_id": "src_expose", "page": 1, "bbox_px": [12, 40, 480, 52] },
      "provenance_hint": "estimated",
      "notes": "durchgehende Doppellinie, Maßtext 8,40 daneben"
    }
  ]
}
```

### Eigenschaften

* **Koordinaten in Millimetern**, nicht in Pixeln. Die Umrechnung leistet `calibration`, das
  explizit Teil der Datei ist und eine eigene Provenance trägt. Fehlt die Kalibrierung, ist das
  Ergebnis bestenfalls `marketing` — und der Reconciler sagt das, statt eine Skalierung zu erfinden.
* Beobachtungen dürfen sich **widersprechen und überlappen**. Das ist ihr Zweck.
* Beobachtungen sind **unveränderlich**. Korrekturen entstehen durch neue Beobachtungen mit
  `supersedes: ["obs_081"]` oder durch Operationen auf dem rekonstruierten Modell.
* `candidate_type: "opening"` ist die ehrliche Antwort, wenn Tür und Durchgang nicht
  unterscheidbar sind. Sie wird zu einem `generic_opening`.

## Reconciliation

```bash
floorplan reconcile plan.observations.json \
  --default-thickness-mm 120 \
  --min-confidence 0.5 \
  --snap-mm 10 \
  --output plan.floorplan.json
```

Regelbasiert und deterministisch, **ohne KI**:

1. **Filtern** nach `min_confidence`; abgelöste Beobachtungen (`supersedes`) entfallen.
2. **Wände normalisieren**: Koordinaten auf ein Raster einrasten, kollineare und überlappende
   Segmente verschmelzen, fast zusammenfallende Enden zusammenziehen, Enden auf fremde Achsen
   projizieren (T-Stöße). Ohne diesen Schritt franst jede Rekonstruktion an den Ecken aus.
3. **Öffnungen zuordnen**: nächstgelegenes Wandsegment innerhalb `--max-host-distance-mm`,
   Offset aus der Projektion. Ohne eindeutigen Host bleibt die Beobachtung unverarbeitet.
4. **Räume** aus Polygon-Beobachtungen, **Maßketten** aus `dimension`, **Beschriftungen** aus `label`.
5. **Provenance setzen**: `parsed`, wenn ein Maßtext die Quelle war, sonst `estimated` mit der
   Confidence der Beobachtung. **Niemals `measured`.**
6. **Bericht erzeugen**.

### Was der Reconciler nicht tut

| Situation | Verhalten |
|---|---|
| Wand ohne `thickness_mm` | **abgelehnt**, außer `--default-thickness-mm` ist gesetzt — dann als `estimated` vermerkt |
| Fenster ohne `sill_mm` | **abgelehnt**. Eine Brüstungshöhe ist aus einer Draufsicht nicht ableitbar |
| Tür ohne `hinge`/`swing` | Felder bleiben **leer**. Der Renderer zeichnet das Blatt geschlossen |
| Öffnung ohne Wand in der Nähe | **abgelehnt**, mit Angabe der geprüften Distanz |
| `provenance_hint: "measured"` | auf `parsed` heruntergestuft und im Bericht vermerkt |
| unbekannter `candidate_type` | **gemeldet**, nicht stillschweigend verworfen |

## Der Bericht

```text
source: image expose-plan.png
observations: 20  accepted 14  merged 2  rejected 4
elements: 6 wall(s), 4 opening(s), 3 space(s)
quality: marketing — No reliable calibration: the document stays at "marketing".

assumptions made:
  - Default wall thickness 120 mm was applied where the observation gave none; recorded as "estimated".
  - Door "door_002" was classified as a swing door; the observation did not say.

unused observations:
observation           reason
--------------------  --------------------------------------------------------
obs_opening_floating  no wall found within 400 mm of the opening
obs_stair             candidate_type "stair" is not reconciled by this version
obs_wall_ghost        confidence 0.28 is below the threshold of 0.5
obs_window_no_sill    a window needs sill_mm; the sill height is never guessed
```

**Jede** Beobachtung erscheint im Bericht — ein Test erzwingt das. Stille Verluste sind
ausgeschlossen. Die Annahmen und die nicht verwerteten Beobachtungen gehören in die Antwort an
den Nutzer.

## Anleitung für Agenten

1. Quelle betrachten und **jede** erkennbare Wand, Öffnung und jeden Raum als Beobachtung
   notieren — mit `confidence` und `source_ref` (Bildausschnitt).
2. Eine `calibration` nur angeben, wenn der Maßstab tatsächlich begründbar ist. Steht ein Maß
   im Plan, ist das die beste Referenz — dann `provenance: "parsed"`.
3. Bei Unklarheit `candidate_type: "opening"` statt `"door"`. Unsicherheit gehört in die
   `confidence`, nicht in eine Entscheidung.
4. `floorplan reconcile` ausführen und den Bericht lesen.
5. Ergebnis validieren, rendern, dem Nutzer zeigen — **mit** der Angabe, dass es sich um eine
   Rekonstruktion auf `marketing`-Niveau handelt.
6. Verbesserungen laufen anschließend über Operationen auf dem Modell, nicht über eine
   Neuinterpretation des Bildes. Nennt der Nutzer ein echtes Maß, wird es mit
   `set_provenance` als `provided` eingetragen — und die Qualitätsstufe kann steigen.

`fixtures/06-uncertain-reconstruction/` enthält einen vollständigen Durchlauf: die
Beobachtungsdatei, das erzeugte Modell und die zugehörigen Testfälle.
