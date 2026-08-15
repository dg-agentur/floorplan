# Releases

Regeln und Ablauf. Entscheidungsgrundlage: `docs/adr/0016-software-versioning-and-release.md`.

## Versionsschema

**SemVer 2.0.0 für die Software, unabhängig von den Datenformaten.**

```text
package.json  "version": "0.1.0-alpha.1"    ← Software
schema_version: "0.1"                        ← Datenformate (ADR 0010)
```

| Erhöhung | Anlass |
|---|---|
| MAJOR | brechende Änderung an CLI-Vertrag, JS-API oder Ausgabeformat |
| MINOR | neue Fähigkeit, neue Operation, neue Regel, neues Theme |
| PATCH | Fehlerbehebung ohne neue Fähigkeit |
| `-alpha.N` · `-beta.N` · `-rc.N` | Vorabrelease |

Solange MAJOR `0` ist, darf **MINOR brechen**, PATCH nicht.

`package.json` ist die einzige Quelle der Version. CLI, Skill-Frontmatter, `core/VERSION`,
`MANIFEST.json` und der Git-Tag leiten sich daraus ab; Tests halten sie zusammen.

---

## Release-Gates vor v0.1.0

`v0.1.0-alpha.1` ist veröffentlicht. Für ein stabiles **v0.1.0** müssen zusätzlich zu einem
grünen CI-Lauf beide Gates abgehakt sein. Ein grüner CI-Lauf ist notwendig, aber nicht
hinreichend.

### Gate 1 — Real-World-Test mit einem echten Grundriss

Vollständiger Durchlauf von der realen Quelle bis zum gerenderten Ergebnis mit einem der
privaten Referenzpläne.

- [ ] Quelle gewählt und Maßstab bzw. Referenzmaß aus dem Plan bestimmt
- [ ] `*.observations.json` erstellt, jede Beobachtung mit `confidence` und Quellverweis
- [ ] `floorplan reconcile` durchgeführt, Bericht ausgewertet
- [ ] Verworfene Beobachtungen und Annahmen sind erklärbar und plausibel
- [ ] Ergebnis validiert; Qualitätsstufe entspricht der tatsächlichen Datenlage
- [ ] Räume und Flächen mit den Raumstempeln des Originals verglichen, Abweichungen bewertet
- [ ] In beiden Themes gerendert und mit dem Original visuell verglichen
- [ ] Befunde als Issues oder ADR festgehalten

**Harte Bedingung:** Es gelangen **keine** personenbezogenen oder projektspezifischen
Quelldaten in das Repository — weder PDFs oder Bilder noch daraus abgeleitete Modelle mit
echten Adressen, Namen, Flurstücksnummern oder Bauherrendaten. `.gitignore` sperrt
`Beispiele/` und `*.private.*`; der Skill-Build prüft zusätzlich jede Datei gegen eine
Sperrliste. Was aus dem Test ins Repository darf, ist ausschließlich **anonymisiertes**
Material oder eine Beschreibung des Befundes.

Ergebnis: _offen_ · Datum: — · Durchgeführt von: —

### Gate 2 — Der gepackte Skill in ChatGPT Work

- [ ] `dist/chatgpt/skill.zip` aus einem sauberen Stand gebaut (`npm run build:skill`)
- [ ] In ChatGPT Work hochgeladen und installiert
- [ ] Der Skill wird bei einer einschlägigen Frage von selbst herangezogen
- [ ] `--version`, `ops list` und `rules` laufen in der Sandbox
- [ ] Ein vollständiger Ablauf gelingt: lesen → ändern → validieren → rendern
- [ ] Das erzeugte SVG ist brauchbar und wird korrekt zurückgegeben
- [ ] Kein Netzzugriff, kein `npm install`, kein Git-Clone nötig
- [ ] Der Agent hält die Regel „keine erfundenen Maße" ein

Ergebnis: _offen_ · Datum: — · Durchgeführt von: —

---

## Ablauf

### 1. Vorbereiten

```bash
npm run generate     # Operations-Schema und Skill-References neu erzeugen
npm run check        # Tests, Typecheck, Demo, Skill-Build, Skill-Verifikation
git status           # muss sauber sein
```

`npm run check` ist genau das, was CI ausführt. Ist es lokal grün und der Arbeitsbaum sauber,
ist auch CI grün.

### 2. Version setzen

```bash
npm version 0.1.0-alpha.2 --no-git-tag-version
```

Danach `CHANGELOG.md` ergänzen: `[Unreleased]` in einen datierten Abschnitt überführen und die
Vergleichslinks am Dateiende nachziehen.

### 3. Committen und taggen

```bash
git add -A
git commit -m "release: v0.1.0-alpha.2"
git tag -a v0.1.0-alpha.2 -m "v0.1.0-alpha.2"
git push origin main --follow-tags
```

Der Tag **muss** `v<version aus package.json>` lauten. Der Release-Workflow bricht sonst ab.

### 4. Veröffentlichen

Der Workflow `release.yml` startet beim Tag, führt alle Prüfungen erneut aus, baut
`skill.zip` und legt das GitHub-Release mit dem Artefakt an. Vorabversionen
(`-alpha`, `-beta`, `-rc`) werden automatisch als Prerelease markiert.

Manuell, falls nötig:

```bash
npm run build:skill
gh release create v0.1.0-alpha.2 dist/chatgpt/skill.zip dist/chatgpt/skill.zip.sha256 \
  --title "v0.1.0-alpha.2" --notes-file <(sed -n '/## \[0.1.0-alpha.2\]/,/^## \[/p' CHANGELOG.md) \
  --prerelease
```

---

## Release-Artefakte

| Artefakt | Inhalt |
|---|---|
| `skill.zip` | self-contained ChatGPT-Skill inklusive Core; ohne Installation lauffähig |
| `skill.zip.sha256` | Prüfsumme des Archivs |

Der Quellcode kommt von GitHub automatisch als `.tar.gz` und `.zip` dazu.

**Kein npm-Paket.** Das Projekt ist proprietär (`private: true`, `LICENSE`).

### Ein Release-Artefakt prüfen

```bash
sha256sum -c skill.zip.sha256
unzip -q skill.zip -d /tmp/skill-check
node /tmp/skill-check/floorplan/scripts/floorplan.js --version
node /tmp/skill-check/floorplan/scripts/floorplan.js validate \
  /tmp/skill-check/floorplan/core/fixtures/03-house-ground-floor/house-ground-floor.floorplan.json
```

`MANIFEST.json` im Archiv enthält zu jeder Datei die SHA-256 — der Inhalt ist damit auch dann
überprüfbar, wenn sich die Kompression zwischen zlib-Versionen unterscheidet.

---

## Was ein Release nicht darf

- personenbezogene oder projektspezifische Quelldaten enthalten
- ein Artefakt veröffentlichen, das nicht aus dem getaggten Stand gebaut wurde
- eine Qualitätsstufe, eine Fähigkeit oder eine Prüfung behaupten, die es nicht gibt —
  bekannte Einschränkungen gehören in den Changelog, nicht ins Schweigen
