---
description: Rekonstruiert einen Grundriss aus einem Bild, PDF oder Scan über den Observation Layer
argument-hint: <bild-oder-pdf> [zieldatei.floorplan.json]
allowed-tools: Bash(floorplan:*), Bash(node:*), Read, Write
---

Rekonstruiere einen Grundriss aus `$1`.

**Schreibe das Ergebnis niemals direkt als `*.floorplan.json`.** Der Weg führt über den
Observation Layer, damit Vermutung und Tatsache unterscheidbar bleiben — siehe
`docs/observations.md`.

1. **Format ansehen.** `floorplan schema observations` — oder
   `fixtures/06-uncertain-reconstruction/expose-plan.observations.json` als Vorlage lesen.

2. **Beobachten.** Betrachte die Vorlage und schreibe `<name>.observations.json`. Für jede
   erkennbare Wand, Öffnung, jeden Raum, jede Maßangabe und Beschriftung eine Beobachtung mit:
   - `confidence` — deine tatsächliche Sicherheit, nicht 0.9 aus Gewohnheit
   - `source_ref.bbox_px` — wo im Bild du es gesehen hast
   - `notes` — woran du es erkannt hast
   Bei Unklarheit zwischen Tür und Durchgang: `candidate_type: "opening"`. „Ich konnte es nicht
   erkennen“ ist eine darstellbare, richtige Antwort.

3. **Kalibrieren — nur wenn begründbar.** Steht ein Maß im Plan, ist das die beste Referenz
   (`provenance: "parsed"`). Ohne belastbare Referenz die `calibration` **weglassen**.
   Erfinde keinen Maßstab.

4. **Zusammenführen.**
   ```bash
   floorplan reconcile <name>.observations.json --output ${2:-<name>.floorplan.json} --json
   ```
   `--default-thickness-mm` nur setzen, wenn der Nutzer dieser Annahme zugestimmt hat.

5. **Bericht auswerten.** Nenne dem Nutzer:
   - wie viele Beobachtungen übernommen, verschmolzen und verworfen wurden
   - **jede verworfene Beobachtung mit Begründung**
   - jede Annahme aus `assumptions`

6. **Validieren und rendern**, Ergebnis zeigen.

Die verbindlichen Regeln zu Maßen, Unsicherheit und Qualitätsstufen stehen in
`docs/agent-contract.md`; der Ablauf im Detail in `docs/observations.md`.

Sage ausdrücklich: Das Ergebnis hat Qualitätsstufe `marketing`. Die Maße sind interpretiert,
nicht gemessen, und nicht für Bestellungen oder Verträge geeignet. Nennt der Nutzer anschließend
echte Maße, trage sie mit `set_provenance` als `provided` ein — dann kann die Qualitätsstufe
steigen.
