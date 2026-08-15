---
description: Erzeugt SVG-Darstellungen eines Grundrisses, optional in mehreren Themes
argument-hint: <datei.floorplan.json> [theme|alle]
allowed-tools: Bash(floorplan:*), Bash(node:*), Read
---

Rendere den Grundriss `$1`.

1. Verfügbare Themes ermitteln: `floorplan theme list --json`
2. Ist `$2` gesetzt und kein `alle`, nur dieses Theme rendern. Sonst `technical` und `marketing`.
3. `floorplan render $1 --theme <theme> --output <basisname>-<theme>.svg --json`

Verweigert der Befehl die Ausgabe, ist das Modell fehlerhaft. Dann **nicht** blind `--force`
setzen, sondern erst `floorplan validate $1 --json` ausführen, die Fehler benennen und eine
Behebung vorschlagen. `--force` nur auf ausdrücklichen Wunsch, und mit dem Hinweis, dass die
Zeichnung falsch sein kann.

Berichte:

- die erzeugten Dateien mit Pixelmaß und Maßstab (aus der `--json`-Ausgabe)
- was die Themes unterscheidet — und dass die **Geometrie identisch** ist, nur die Darstellung
  sich ändert
- ob geschätzte Flächen im Plan als solche markiert sind (Präfix `ca.`)

Für ein Corporate-Design-Theme siehe `docs/themes.md`; ein eigenes Theme wird mit
`floorplan theme validate <datei>` abgenommen. Der fachliche Vertrag steht in
`docs/agent-contract.md`.
