# ADR 0007 — Identifikatoren

Status: akzeptiert · Datum: 2026-08-15

## Entscheidung

* IDs sind **dokumentweit eindeutig**, über alle Elementtypen hinweg.
* Format: `^[a-z][a-z0-9_]{0,63}$`.
* Konvention: `<typ>_<diskriminator>` — `wall_001`, `door_014`, `space_kitchen`, `level_eg`.
* IDs sind **stabil und unveränderlich**. Es gibt keine Operation, die eine ID ändert.
  Umbenennen betrifft ausschließlich `name`.
* Automatisch erzeugte IDs entstehen aus einem **deterministischen Zähler** pro Typ:
  die kleinste freie dreistellige Nummer (`wall_001`, `wall_002`, …).
  Keine UUIDs, keine Zeitstempel, kein Zufall.
* Operationen dürfen eine gewünschte ID vorgeben (`id`-Parameter). Ist sie belegt, schlägt die
  Operation fehl — sie überschreibt niemals.

## Begründung

**Determinismus:** Zwei identische Operationsfolgen auf demselben Ausgangsdokument müssen
byteidentische Ergebnisse liefern. UUIDs oder Zeitstempel machen Golden-Tests unmöglich und
Diffs unlesbar.

**Agententauglichkeit:** `space_kitchen` ist für ein LLM referenzierbar, ohne im Dokument
suchen zu müssen. Eine UUID erzeugt in jedem Prompt Kopierfehler.

**Löschen gibt IDs nicht frei** — gelöschte Nummern werden nicht neu vergeben, solange sie in
`history` referenziert sind. Der ID-Generator berücksichtigt daher auch die Historie, damit ein
`undo` keine Kollision erzeugt.

## Konsequenzen

* Ein Merge zweier unabhängig entstandener Dokumente kann ID-Kollisionen erzeugen. Für v0.1
  ist das kein Anwendungsfall; ein späterer `merge`-Befehl müsste umbenennen und eine
  Mapping-Tabelle führen. Notiert in `docs/extension-points.md`.
* Sprechende IDs (`space_kitchen`) können nach einer Umnutzung irreführend wirken
  (Küche wird Büro). Das ist bewusst in Kauf genommen: die ID ist ein technischer Anker,
  `name` und `category` tragen die Bedeutung.
