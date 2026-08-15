# ADR 0006 — Raummodell (Space)

Status: akzeptiert · Datum: 2026-08-15

## Optionen

1. **Explizites Polygon** je Raum als gespeicherte Wahrheit.
2. **Ableitung** der Räume aus dem Wandgraphen (planare Facettensuche).
3. Hybrid: Polygon gespeichert, Ableitung als Prüf- und Reparaturwerkzeug.

## Entscheidung

**Option 3.** Gespeichert wird ein explizites, geschlossenes Polygon (`boundary`).
Die Ableitung aus Wänden ist ein **Validierungs- und Hilfswerkzeug**, nicht die Quelle.

## Begründung

Reine Ableitung (Option 2) ist elegant, aber fragil: sie setzt einen fehlerfreien, geschlossenen
Wandgraphen voraus. Genau das ist bei Rekonstruktionen aus Bildern, bei Bestandsaufnahmen und
bei Zwischenzuständen einer Umplanung nicht gegeben. Ein Werkzeug, das bei unvollständiger
Eingabe keine Räume mehr kennt, ist im Immobilienkontext unbrauchbar.

Rein explizite Polygone (Option 1) wiederum laufen bei Wandänderungen aus dem Ruder. Deshalb:

* `move_wall` zieht Raumkanten, die auf der bewegten Wandkante lagen, aktiv mit und meldet das
  im Operationsergebnis (`affected_ids`) — nachvollziehbar, nicht still.
* Der Validator prüft `SPACE_BOUNDARY_OFF_WALL`: liegt jede Polygonkante auf einer Wandkante?
* Räume dürfen sich nicht überlappen (`SPACE_OVERLAP`).

## Konventionen

* `boundary` ist eine Liste von Punkten, **implizit geschlossen** (letzter Punkt ≠ erster Punkt),
  mindestens 3 Punkte, **gegen den Uhrzeigersinn** (positive Fläche). Der Loader normalisiert
  die Orientierung; der Validator meldet Selbstüberschneidungen.
* Die Randlinie folgt der **lichten Innenkante** der umschließenden Wände. Die berechnete
  Fläche ist damit die geometrische Grundfläche des Raumes.
* `area_override_mm2` erlaubt eine extern vorgegebene Fläche (z. B. aus einem Exposé oder
  einer Wohnflächenberechnung). Weicht sie mehr als `AREA_TOLERANCE_RATIO` (2 %) von der
  Polygonfläche ab, meldet der Validator `SPACE_AREA_MISMATCH`. Der Override wird **nie**
  stillschweigend zur Anpassung der Geometrie benutzt.

## Kategorien

`category` ist ein offenes, aber validiertes Enum (`living`, `bedroom`, `kitchen`, `bath`, `wc`,
`hall`, `corridor`, `office`, `storage`, `technical`, `garage`, `stairwell`, `balcony`,
`terrace`, `outdoor`, `other`). Es steuert Themedarstellung (Füllfarben) und spätere
Fachregeln — es ist bewusst **keine** rechtliche Nutzungsklassifikation.
`name` bleibt frei ("Wohnküche", "Kinderzimmer 2").
