# ADR 0014 — Observation Layer

Status: akzeptiert · Datum: 2026-08-15

## Problem

Ein Vision-Modell, das ein Foto eines Grundrisses liest, produziert Vermutungen. Schreibt es
diese direkt in das kanonische Modell, ist die Unterscheidung zwischen "gemessen" und "geraten"
unwiederbringlich verloren, und ein Modellwechsel (anderes Vision-Modell) ist nicht
nachvollziehbar.

## Entscheidung

Zwischen Interpretation und kanonischem Modell steht eine eigene, versionierte Datei:

```text
source.pdf ──[Vision/LLM/Parser]──► plan.observations.json ──[reconcile]──► plan.floorplan.json
```

Eine Observation ist eine **Beobachtung mit Quelle und Confidence**, keine Tatsache:

```json
{
  "id": "obs_081",
  "candidate_type": "wall",
  "confidence": 0.91,
  "geometry": { "kind": "segment", "start": {"x_mm": 0, "y_mm": 0}, "end": {"x_mm": 8400, "y_mm": 0} },
  "attributes": { "thickness_mm": 300 },
  "source_ref": { "source_id": "src_1", "page": 1, "bbox_px": [12, 40, 480, 52] },
  "notes": "durchgehende Doppellinie, Maßtext 8,40 daneben"
}
```

### Wesentliche Eigenschaften

* Observations sind **in Modellkoordinaten (mm)**, nicht in Pixeln. Die Umrechnung leistet ein
  `calibration`-Objekt (`scale_mm_per_px` mit eigener Provenance), das explizit Teil der Datei
  ist. Fehlt die Kalibrierung, ist das Ergebnis bestenfalls `marketing`-Qualität — und der
  Reconciler sagt das, statt eine Skalierung zu erfinden.
* Observations dürfen sich **widersprechen und überlappen**. Das ist ihr Zweck.
* Observations sind **unveränderlich**. Korrekturen entstehen durch neue Observations oder
  durch Operationen auf dem rekonstruierten Modell — nie durch Umschreiben der Beobachtung.

### Reconciliation ist deterministisch

`src/importers/observations/reconcile.js` ist regelbasiert und enthält **keine KI**:

1. Filtern nach `min_confidence` (Parameter, Default 0.5).
2. Wand-Kandidaten normalisieren: Achsen an ein Raster snappen (Parameter `snap_mm`),
   nahezu kollineare und überlappende Segmente verschmelzen, Endpunkte zusammenziehen.
3. Öffnungen dem nächstgelegenen Wandsegment zuordnen (maximale Distanz als Parameter);
   ohne eindeutigen Host bleibt die Observation **unverarbeitet** und wird berichtet.
4. Raumpolygone übernehmen oder — falls nur Wände vorliegen — leer lassen.
5. Provenance setzen: `parsed`, wenn ein Maßtext die Quelle war; sonst `estimated` mit der
   Confidence der Observation. Niemals `measured`.
6. Ein **Reconciliation-Report** listet jede nicht verwertete Observation mit Begründung.
   Stille Verluste sind ausgeschlossen.

Damit ist jedes Vision-Modell austauschbar: Es muss nur `*.observations.json` erzeugen.
Die Qualität der Rekonstruktion ist unabhängig vom Anbieter reproduzierbar messbar.

## Was v0.1 nicht tut

Der Core enthält **keinen** Bild-, PDF- oder Rasterparser. Das Erzeugen von Observations ist
Aufgabe eines Agenten oder eines separaten Importers. Der Core definiert das Format, validiert
es und rechnet es deterministisch in ein Modell um. Das ist genau die Trennlinie, die
Vendor-Neutralität herstellt.
