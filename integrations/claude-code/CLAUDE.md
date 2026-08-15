# Grundrisse in diesem Projekt

Dieses Projekt benutzt die **Floorplan Intelligence Platform**. Grundrisse sind hier
strukturierte Daten (`*.floorplan.json`), keine Bilder und keine Prosa.

**Der vollständige fachliche Vertrag steht in `docs/agent-contract.md` der Plattform.
Lies ihn, bevor du einen Grundriss veränderst.** Diese Datei ist nur die Kurzfassung für
Claude Code; bei Widersprüchen gilt der Contract.

## Die vier Schritte

```bash
floorplan inspect  <datei> --section all --json     # 1. lesen
# 2. Änderung als <name>.ops.json schreiben
floorplan apply    <datei> <name>.ops.json --output <neu> --json   # 3. anwenden
floorplan render   <neu> --theme technical --output <neu>.svg      # 4. prüfen und zeigen
```

`apply` validiert automatisch und schreibt nichts, wenn Fehler auftreten.

## Vokabular nachschlagen statt raten

```bash
floorplan ops list --json                    # alle Operationen
floorplan ops describe move_opening --json   # Schema + Beispiel
floorplan rules --json                       # alle Validierungsregeln
floorplan schema floorplan                   # das Datenmodell
```

Erfinde niemals einen Operationsnamen oder einen Parameter. Frag das Werkzeug.

## Harte Regeln

1. **Keine erfundenen Maße.** Kennst du ein Maß nicht: nachfragen, oder als
   `provenance: "estimated"` mit `confidence` eintragen, oder das optionale Feld weglassen.
   Eine Schätzung wird nie als `measured` oder `provided` deklariert.
2. **Keine direkten JSON-Änderungen**, solange eine Operation existiert. Falls doch nötig:
   sofort validieren und in der Antwort sagen, dass du die Operationsschicht umgangen hast.
3. **SVG-Dateien nie bearbeiten.** Sie werden neu erzeugt.
4. **Millimeter, ganzzahlig.** `4200` sind 4,20 m.
5. **`offset_mm` einer Öffnung ist ihre MITTE**, gemessen von `wall.start`.
6. **Qualitätsstufen werden nachgewiesen, nicht behauptet.** `floorplan validate --quality verified`
   zeigt, was noch fehlt.
7. **Keine baurechtlichen Aussagen.** Das System prüft geometrische Gültigkeit, gibt Hinweise zur
   Plausibilität — und trifft ausdrücklich keine Aussage zu Rettungswegen, Mindestgrößen,
   Brandschutz oder Wohnflächenberechnung.

## Was du dem Nutzer sagen musst

* welche Maße geschätzt statt bekannt sind
* welche Annahmen du getroffen hast
* welche Validierungswarnungen offen bleiben
* dass ein rekonstruierter Plan `marketing`-Qualität hat

## Exit-Codes

`0` in Ordnung · `1` Modell oder Operation fehlerhaft · `2` **du** hast das Werkzeug falsch
aufgerufen · `3` Bug im Werkzeug. Bei `2` die Nutzung nachlesen, nicht blind wiederholen.
