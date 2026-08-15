# Versionierung

## Formate und ihre Versionen

| Format | Feld | Aktuell | Entwickelt sich |
|---|---|---|---|
| Floorplan | `schema_version` | `0.1` | langsam |
| Operations | `schema_version` | `0.1` | schneller (neue Operationen) |
| Observations | `schema_version` | `0.1` | mittel |
| Theme | — | — | über `schema/theme.schema.json`, additiv |

Die Formate sind **unabhängig** versioniert, weil sie sich unterschiedlich schnell entwickeln.

## Regeln

* Schema `MAJOR.MINOR` als String. Kein Patch-Level: ein Datenformat hat keine Bugfix-Ebene,
  die hat die Implementierung (`package.json`).
* **MINOR erhöhen** = additiv und rückwärtskompatibel: neue optionale Felder, neue Werte in
  offenen Enums, neue Collections. Ein Leser von `0.2` liest `0.1` ohne Migration.
* **MAJOR erhöhen** = brechend. Erfordert eine Migration in `src/model/migrations/`.

## Verhalten des Loaders

| Fall | Verhalten |
|---|---|
| gleiche Version | normal laden |
| höhere MINOR | laden, **Warnung** `SCHEMA_VERSION_NEWER` — unbekannte Felder können beim Speichern verloren gehen |
| niedrigere MINOR | laden, keine Warnung |
| andere MAJOR | **Fehler** `INCOMPATIBLE_SCHEMA_VERSION` mit Verweis auf die Migration |
| kein `schema_version` | **Fehler** `MISSING_SCHEMA_VERSION` |

## Warum unbekannte Felder abgelehnt werden

`additionalProperties: false` auf allen Kernobjekten. Der Grund ist nicht Strenge um ihrer
selbst willen: Ohne diese Regel schreiben LLM-Agenten stillschweigend Felder mit Tippfehlern
(`thikness_mm`), die niemand bemerkt und die beim nächsten Speichern verschwinden. Strikte
Validierung verwandelt einen stillen Datenverlust in eine laute Fehlermeldung.

Kontrolliertes Ventil: jedes Element darf ein Objekt `meta` mit beliebigem Inhalt tragen. Es
beeinflusst nachweislich nie die Geometrie.

## Migrationen

Mit der ersten Migration entsteht ein Verzeichnis `src/model/migrations/` (Registry
`from → to → transform`) und der Befehl `floorplan migrate <datei>`.

In v0.1 gibt es beides nicht. Ein leeres Verzeichnis und ein wirkungsloser Befehl wären nur
eine Behauptung von Funktionalität.

## Kompatibilitätsmatrix

| Dokument | Diese Implementierung (0.1) |
|---|---|
| `0.1` | voll unterstützt |
| `0.2`+ | mit Warnung lesbar, sofern strukturell gültig |
| `1.x` | abgelehnt, Migration erforderlich |

## Das Operationsvokabular erweitern

Eine neue Operation ist eine MINOR-Änderung des Operations-Schemas:

1. Definition in `src/operations/ops/*.js` ergänzen (Schema, Beschreibung, Beispiel, `apply`,
   Inverse).
2. `node scripts/generate-operations-schema.js` ausführen — `schema/operations.schema.json`
   wird aus der Registry erzeugt.
3. Test in `tests/operations.test.js`, insbesondere den Undo-Rundlauf.

`tests/operations.test.js` schlägt fehl, wenn die eingecheckte Schemadatei nicht mehr zur
Registry passt. Code und veröffentlichter Vertrag können daher nicht auseinanderlaufen.

Alte Dokumente bleiben gültig: Operationen sind kein Bestandteil des Floorplan-Formats,
sondern beschreiben Änderungen daran. Ein History-Eintrag mit einer inzwischen entfernten
Operation ist allerdings nicht mehr rückgängig zu machen — Operationen sollten deshalb
deprecated und nicht gelöscht werden.
