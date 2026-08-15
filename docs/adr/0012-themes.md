# ADR 0012 — Theme-System und Trennung von Geometrie und Gestaltung

Status: akzeptiert · Datum: 2026-08-15

## Entscheidung

* Ein **Theme enthält ausschließlich visuelle Parameter**. Es darf Geometrie weder erzeugen
  noch verändern. Ein Theme-Wechsel verändert nie eine Koordinate.
* Themes liegen als YAML in `themes/` und werden gegen `schema/theme.schema.json` validiert.
  Unbekannte Schlüssel sind ein **Fehler** (Tippfehlerschutz), keine stille Ignoranz.
* Es gibt ein vollständiges `DEFAULT_THEME` im Code (`src/themes/defaults.js`). Theme-Dateien
  überschreiben nur Teilbäume (Deep Merge) und dürfen über `extends: <name>` erben.
* Der Renderer greift **niemals** direkt auf eine Farbe zu, sondern ausschließlich auf das
  aufgelöste Theme-Objekt. Es gibt keine Hardcodes in `src/render/`.

## Was ein Theme steuern darf

```text
page            Hintergrund, Ränder, Maßstabsanpassung, Rasterausrichtung
walls           Füllung/Kontur je classification (exterior/interior/…) und je state
                (existing/new/demolish/planned) inkl. Strichmuster
openings        Darstellung von Tür, Fenster, Durchgang: Symbolstil, Bogen an/aus,
                Strichstärken, Schwellenlinien
spaces          Füllfarben je category, Deckkraft, Umrandung
labels          Schriftfamilie, -größen, Groß-/Kleinschreibung, Zeilenabstand,
                Anzeige von Name / Fläche / Maßen, Zahlenformat, Einheitensuffix
dimensions      Strichstärke, Pfeilform, Textgröße, Abstand
uncertainty     wie geschätzte/unbekannte Werte markiert werden (z. B. Klammern, Tilde)
stairs          Stufenstrich, Laufrichtungspfeil
```

## Was ein Theme nicht darf

Wandstärken verändern, Öffnungen verschieben, Räume ein- oder ausblenden, die aus dem Modell
berechnete Fläche anders berechnen. `walls.stroke_width_px` ist eine **Linienstärke**, nicht
die Bauteildicke — die kommt aus `thickness_mm`. Diese Unterscheidung ist im Schema durch
die Suffixe `_px` (Darstellung) und `_mm` (Bauteil) erzwungen und wird von
`tests/themes.test.js` geprüft.

## YAML-Subset

Aus ADR 0001 (keine Dependencies) folgt ein eigener YAML-Parser. Unterstützt wird ein
bewusst kleines, für Konfiguration ausreichendes Subset:

```text
Verschachtelte Maps über Einrückung (2 Leerzeichen)
Listen mit "- "
Skalare: String (bloß/„"“/'), Zahl, true/false, null/~
Kommentare mit #
Blockskalare: | und > mit den Chomping-Indikatoren - und +
Anker/Aliase/Tags (&, *, !!): NICHT unterstützt — erzeugen einen klaren Parserfehler
Flow-Collections ([...], {...}), mehrere Dokumente: NICHT unterstützt
```

**Nachtrag (v0.1.0-alpha.1): Blockskalare wurden ergänzt.** Anlass war die Frontmatter des
ChatGPT-Skills, deren `description` mehrzeilig ist (`description: >-`). Ohne Unterstützung
hätte der eigene Parser die eigene Skill-Datei nicht lesen können — und genau das prüft
`tests/skill-package.test.js`. Gefaltet wird nach der einfachen Regel: aufeinanderfolgende
Zeilen mit Leerzeichen verbinden, Leerzeile wird Zeilenumbruch. Die YAML-Regel für
stärker eingerückte Zeilen ist bewusst nicht implementiert; sie ist für Konfiguration
irrelevant und schwer vorhersagbar.

Nicht unterstützte Konstrukte führen zu einer präzisen Fehlermeldung mit Zeilennummer,
nie zu stillschweigend falschem Ergebnis. Themes dürfen alternativ als `.json` vorliegen —
derselbe Loader, dieselbe Validierung.

## Corporate Design (DESIGN.md → Theme)

Der Weg von Corporate-Design-Material zu einem Theme ist bewusst **zweistufig**:
Ein Agent liest `DESIGN.md` oder Markenmaterial und erzeugt daraus eine Theme-Datei; der Core
validiert diese Datei. Der Core selbst enthält **keine** Interpretationslogik für
Markendokumente — das ist eine Agentenaufgabe mit unscharfem Input, und sie gehört per
Architekturprinzip außerhalb des deterministischen Kerns.
`integrations/*/` enthält dafür eine Anleitung; `floorplan theme validate <datei>` ist die
Abnahmeprüfung.
