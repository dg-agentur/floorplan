# ADR 0015 — Qualitätsstufen als Validierungsmodus

Status: akzeptiert · Datum: 2026-08-15

## Entscheidung

`project.quality` ∈ { `marketing`, `scaled`, `verified` } ist **kein Etikett**, sondern der
Schalter, der die Severity-Matrix des Validators auswählt.

| Stufe | Zusicherung | typische Herkunft |
|---|---|---|
| `marketing` | Proportionen und Topologie sind brauchbar. Maße sind **nicht** belastbar. | Exposé-Skizze, Bildrekonstruktion ohne Referenzmaß |
| `scaled` | Es existiert mindestens ein belastbares Referenzmaß; alle Maße sind konsistent dazu skaliert. | vermaßte Zeichnung, kalibrierte Rekonstruktion |
| `verified` | Alle maßgeblichen Werte stammen aus `provided`/`measured`/`parsed` und sind geprüft. | Aufmaß, DXF aus Vermessung, geprüfte Planung |

## Umsetzung

`src/validation/severityPolicy.js` enthält eine Tabelle `RULE_ID → { marketing, scaled, verified }`.
Regeln melden ihr Ergebnis **ohne** Severity; die Severity vergibt die Policy. Damit ist die
Stufenlogik an genau einer Stelle sichtbar und testbar, statt in 30 Regeln verstreut.

Auszug:

| Regel | marketing | scaled | verified |
|---|---|---|---|
| `SCHEMA_VIOLATION` | ERROR | ERROR | ERROR |
| `DUPLICATE_ID` | ERROR | ERROR | ERROR |
| `OPENING_OUTSIDE_WALL` | ERROR | ERROR | ERROR |
| `OPENING_WIDER_THAN_WALL` | ERROR | ERROR | ERROR |
| `SPACE_SELF_INTERSECTING` | ERROR | ERROR | ERROR |
| `SPACE_OVERLAP` | WARNING | ERROR | ERROR |
| `SPACE_BOUNDARY_OFF_WALL` | INFO | WARNING | ERROR |
| `SPACE_AREA_MISMATCH` | INFO | WARNING | ERROR |
| `PROVENANCE_ESTIMATED` | INFO | WARNING | ERROR |
| `PROVENANCE_UNKNOWN` | INFO | ERROR | ERROR |
| `MISSING_SCALE_REFERENCE` | INFO | ERROR | ERROR |
| `WALL_NOT_CONNECTED` | INFO | WARNING | WARNING |
| `SPACE_UNREACHABLE` | INFO | WARNING | WARNING |
| `OPENING_CONNECTIVITY_MISMATCH` | WARNING | ERROR | ERROR |

## Konsequenz für den Arbeitsablauf

Eine Qualitätsstufe wird **nicht** dadurch erreicht, dass jemand sie einträgt. Sie wird dadurch
erreicht, dass die Validierung auf dieser Stufe fehlerfrei ist. `floorplan validate --quality verified`
prüft gegen eine strengere Stufe, ohne das Dokument zu ändern — der direkte Weg für die Frage
"Was fehlt mir noch, damit dieser Plan als geprüft gelten kann?".

Die Operation `set_project_quality` schlägt fehl, wenn das Dokument die Zielstufe nicht erfüllt.
Damit kann ein Agent eine Qualitätsaussage nicht behaupten, sondern nur nachweisen.
