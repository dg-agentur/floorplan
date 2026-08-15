# ADR 0002 — Einheiten und Koordinatensystem

Status: akzeptiert · Datum: 2026-08-15

## Entscheidung

* **Interne und serialisierte Einheit: Millimeter, ganzzahlig.**
  Alle Längenfelder heißen `*_mm` und sind Integer. Flächen heißen `*_mm2`.
* Das Dokument trägt `"unit": "mm"` als Pflichtfeld mit festem Wert — die Einheit ist damit
  explizit und nicht aus dem Kontext zu erraten.
* **Koordinatensystem:** rechtshändig, X nach rechts, **Y nach oben**, Ursprung frei wählbar
  (üblicherweise linke untere Ecke der Außenwand-Mittellinie).
  Winkel werden mathematisch positiv (gegen den Uhrzeigersinn) gemessen, 0° = +X.
* **Der Renderer spiegelt Y** (SVG-Y zeigt nach unten). Diese Spiegelung ist ausschließlich im
  Renderer implementiert, nie im Modell.
* Z ist die Höhenachse. `elevation_mm` eines Levels ist die Höhe der Rohdecke/OKFF über
  Projektnullpunkt.

## Begründung

Ganzzahlige Millimeter eliminieren Rundungsfehler bei Addition/Subtraktion (Türen verschieben,
Wände teilen) vollständig. Ein Modell bleibt nach beliebig vielen Operationen exakt.
`0.1 + 0.2 !== 0.3` ist in einem CAD-Kernel ein echtes Problem; in Millimeter-Integern existiert
es nicht. Millimeter ist zudem die Standardeinheit im deutschsprachigen Bauwesen und in DXF/IFC
verlustfrei abbildbar.

Alle Werte liegen weit innerhalb von `Number.MAX_SAFE_INTEGER`; ein Gebäude von 1 km Kantenlänge
sind 1.000.000 mm.

## Regeln für Zwischenrechnungen

Geometrische Zwischenergebnisse (Schnittpunkte, Projektionen, Miter-Ecken) sind naturgemäß nicht
ganzzahlig. Regel:

* **Rechnen** darf mit `double`.
* **Speichern** ins Modell erfolgt nur über `roundMm()` (kaufmännische Rundung, `-0` → `0`).
* **Rendern** darf mit `double`, wird aber deterministisch auf feste Nachkommastellen formatiert.

Damit ist jede persistierte Zahl ganzzahlig, während die Darstellung glatt bleibt.

## Toleranzen

Ein einziger zentraler Toleranzwert `TOLERANCE_MM = 1` (`src/model/constants.js`) für
"Punkte gelten als identisch", "Punkt liegt auf Linie", "Wände sind verbunden".
Toleranzen dürfen nirgendwo lokal erfunden werden; abweichende Toleranzen sind benannt
(`AREA_TOLERANCE_RATIO`, `COLLINEARITY_TOLERANCE_MM`) und an derselben Stelle definiert.

## Verworfene Alternativen

* **Meter als Float:** menschenlesbarer, aber akkumulierende Rundungsfehler und ständige
  Formatierungsfragen (`2.4000000000000004`). Abgelehnt.
* **Frei wählbare Einheit pro Dokument:** verlagert Umrechnungslogik in jeden Konsumenten und
  ist eine sichere Fehlerquelle für LLM-Agenten. Abgelehnt. Import/Export rechnet an der Grenze um.
