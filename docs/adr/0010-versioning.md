# ADR 0010 — Schema-Versionierung und Kompatibilität

Status: akzeptiert · Datum: 2026-08-15

## Entscheidung

* Jede Datei trägt `schema_version` als Pflichtfeld: `"0.1"`.
* Versionsschema: `MAJOR.MINOR` als String (nicht SemVer-Patch — ein Datenformat hat keine
  Bugfix-Ebene, das hat die Implementierung).
* **MINOR-Erhöhung = additiv und rückwärtskompatibel.** Neue optionale Felder, neue Enum-Werte
  in explizit als offen markierten Enums, neue Elementtypen in neuen Collections.
  Ein Leser von `0.2` liest `0.1` ohne Migration.
* **MAJOR-Erhöhung = brechend.** Erfordert eine Migration in `src/model/migrations/`.
* Der Loader lehnt unbekannte MAJOR-Versionen mit klarer Meldung ab und akzeptiert höhere
  MINOR-Versionen mit einer WARNING (`SCHEMA_VERSION_NEWER`), sofern die Struktur validiert.

## Unbekannte Felder

`additionalProperties: false` auf allen Kernobjekten — mit einer bewussten Ausnahme:
jedes Element darf ein Objekt `meta` mit beliebigem Inhalt tragen.

Begründung: Ohne strikte Objekte schreiben LLM-Agenten stillschweigend Felder mit Tippfehlern
(`thikness_mm`), die niemand bemerkt. Strikte Validierung verwandelt einen stillen Datenverlust
in eine laute Fehlermeldung — genau das ist der Zweck des Schemas. `meta` bleibt als
kontrollierter Ort für anwendungsspezifische Zusatzdaten (z. B. Makler-CRM-IDs), der
nachweislich niemals Geometrie beeinflusst.

## Migration

Sobald die erste Migration nötig wird, entsteht ein Verzeichnis `src/model/migrations/` mit
einer Registry `from -> to -> transform` und der Befehl `floorplan migrate <file>`.

In v0.1 existiert beides **nicht**. Ein leeres Verzeichnis und ein Befehl ohne Wirkung wären
nur eine Behauptung von Funktionalität.

## Versionierung der übrigen Formate

`*.ops.json` und `*.observations.json` tragen ebenfalls `schema_version` und folgen denselben
Regeln. Sie sind **unabhängig** vom Floorplan-Schema versioniert, weil sie sich anders
entwickeln (neue Operationen sind häufiger als neue Modellfelder).

Die Kompatibilitätsmatrix steht in `docs/versioning.md`.
