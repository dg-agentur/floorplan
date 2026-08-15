# ADR 0004 — Wandmodell: Mittellinie + Dicke

Status: akzeptiert · Datum: 2026-08-15

## Optionen

1. **Mittellinie + Dicke** (Referenzlinie mittig), Wandkörper zur Laufzeit berechnet.
2. **Explizites Wandpolygon** (4+ Punkte) als gespeicherte Wahrheit.
3. **Raumpolygone als Wahrheit**, Wände nur abgeleitet.

## Entscheidung

**Option 1: `start`, `end`, `thickness_mm`. Der Wandkörper ist ein abgeleitetes Artefakt.**

## Begründung

* Offsets von Öffnungen (`offset_mm` entlang der Wand) brauchen eine eindeutige, stabile
  1D-Parametrisierung. Nur eine Achse liefert die.
* `move_wall` als Parallelverschiebung ist eine Ein-Zeilen-Operation auf der Achse, aber eine
  fehleranfällige Mehrpunktoperation auf einem Polygon.
* Wandverbindungen (L-, T-, X-Stoß) sind über Achsen-Topologie erkennbar; über Polygone müsste
  man sie aus Überlappungen raten.
* Das Modell bleibt klein und für Menschen wie Agenten lesbar: eine Wand sind fünf Zahlen.
* Entspricht der Referenzlinien-Logik etablierter CAD-Systeme und ist verlustfrei nach DXF/IFC
  abbildbar.

Option 3 wurde verworfen, weil Bestandsaufnahmen (Rekonstruktion aus Bildern) primär Wände und
nicht Räume liefern und weil Wandstärken sonst nur implizit existieren.

## Wandausrichtung

v0.1 kennt ausschließlich **mittige** Ausrichtung (`thickness/2` je Seite). Ein Feld `alignment`
(`center` | `left` | `right`) ist bewusst **noch nicht** eingeführt, um v1 nicht zu überladen;
es kann additiv ergänzt werden, weil der Default `center` das heutige Verhalten exakt beschreibt.

## Wandkörper und Verbindungen (Laufzeit)

`src/geometry/wallGeometry.js` erzeugt:

1. **Segmentierung**: Die Wandachse wird an allen Öffnungen zerschnitten. Eine Wand mit zwei
   Öffnungen ergibt drei massive Segmente. Öffnungen sind damit echte Lücken, keine
   Übermalungen — entscheidend für korrekte Exporte und spätere Boolean-Operationen.
2. **Verbindungen** an jedem Achsenendpunkt:
   * **L-Stoß** (zwei Achsenenden fallen zusammen): Verschneidung (Miter) der jeweiligen
     Wandkanten; bei nahezu paralleler Lage Fallback auf stumpfen Abschluss.
   * **T-Stoß** (Endpunkt liegt auf fremder Achse): Verlängerung um `other.thickness/2`,
     sodass die Wand bündig an der Außenkante der durchgehenden Wand endet.
   * **X-/Mehrfachstoß**: Verlängerung um die maximale halbe Dicke der beteiligten Wände.
3. **Kontur**: Die sichtbare Außenkontur entsteht durch Clipping aller Körperkanten gegen die
   übrigen Körper (Kantenstücke im Inneren eines anderen Wandkörpers werden verworfen).
   Damit entfällt eine vollständige Boolean-Union-Bibliothek, und die Darstellung bleibt
   deterministisch.

## Konsequenzen

* Gekrümmte Wände sind nicht darstellbar (Erweiterungspunkt: `arc`-Feld mit Bogenhöhe).
* Wände mit unterschiedlicher Dicke an beiden Enden sind nicht darstellbar (bewusst).
* Space-Polygone sind **nicht** automatisch an Wandkanten gebunden; die Kopplung stellt der
  Validator her (`SPACE_BOUNDARY_OFF_WALL` als WARNING) und `move_wall` zieht kollineare
  Raumkanten aktiv mit.
