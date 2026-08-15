# ADR 0016 — Softwareversionierung und Release-Prozess

Status: akzeptiert · Datum: 2026-08-15 · Ergänzt ADR 0010 (Schema-Versionierung)

## Kontext

ADR 0010 versioniert die **Datenformate**. Davon unabhängig braucht die **Software** eine
Version: für Releases, für den Skill, für Fehlermeldungen und dafür, dass ein Nutzer sagen
kann, welche Fassung ein Ergebnis erzeugt hat.

Beide Versionen zu vermischen wäre falsch. Das Schema `0.1` kann über Dutzende von
Softwarereleases stabil bleiben; umgekehrt kann ein Renderer-Bugfix ein Release rechtfertigen,
ohne dass sich am Format etwas ändert.

## Entscheidung

**SemVer 2.0.0 für die Software, unabhängig von den Schema-Versionen.**

```text
package.json  "version": "0.1.0-alpha.1"      ← die Software
*.floorplan.json  "schema_version": "0.1"     ← das Format (ADR 0010)
```

| Erhöhung | Anlass |
|---|---|
| MAJOR | brechende Änderung an CLI-Vertrag, JS-API oder Ausgabeformat |
| MINOR | neue Fähigkeit, neue Operation, neue Regel, neues Theme |
| PATCH | Fehlerbehebung ohne neue Fähigkeit |
| Prerelease `-alpha.N` / `-beta.N` / `-rc.N` | vor einem stabilen Release |

Solange MAJOR `0` ist, gilt die SemVer-Regel für 0.x: **MINOR darf brechen**, PATCH nicht.
Das ist ausdrücklich der Zustand von v0.1.x.

## Eine einzige Quelle für die Version

`package.json` ist die Quelle. Alles andere liest sie:

* die CLI über `packageVersion()` in `src/model/io.js`
* das Skill-Bundle über `MANIFEST.json`, `core/VERSION` und die Frontmatter
* der Release über den Git-Tag `v<version>`

Eine hart kodierte Version im Code driftet beim ersten Release ab, und die Abweichung fällt
niemandem auf, bis jemand ein Artefakt gegen seinen Tag hält. Genau das ist beim Sprung auf
`0.1.0-alpha.1` passiert und war der Anlass für diese Regel; `tests/cli.test.js` und
`tests/skill-package.test.js` halten die Quellen seitdem zusammen.

## Was ein Release ist

Ein Release ist ein Git-Tag `v<version>` plus ein GitHub-Release mit dem Skill-Bundle als
Artefakt. Kein npm-Paket: das Projekt ist proprietär (`private: true`).

Der Ablauf ist in `RELEASING.md` beschrieben und wird von CI erzwungen — ein Tag, dessen
Version nicht zu `package.json` passt, bricht den Release-Workflow ab.

## Release-Gates vor v0.1.0

`v0.1.0-alpha.1` ist ein Vorabrelease des verifizierten MVP. Bis zum stabilen `v0.1.0` gelten
zwei zusätzliche, ausdrücklich benannte Bedingungen:

1. **Real-World-Test** mit einem echten Grundriss aus dem privaten Referenzmaterial —
   vollständig, von der Quelle bis zum gerenderten Ergebnis. Dabei dürfen **keine**
   personenbezogenen oder projektspezifischen Quelldaten in das Repository gelangen.
2. **Erfolgreicher Test des gepackten Skills in ChatGPT Work** — Installation, Erkennung,
   Ausführung, sinnvolles Ergebnis.

Beide Gates sind Erfahrungsnachweise, keine automatisierbaren Prüfungen. Sie stehen deshalb
als Checkliste in `RELEASING.md` und werden dort mit Datum und Ergebnis abgehakt. Ein grüner
CI-Lauf ist notwendig, aber nicht hinreichend.

## Konsequenzen

* Der Abstand zwischen „CI grün“ und „veröffentlichungsreif“ ist explizit benannt, statt
  stillschweigend angenommen zu werden.
* Prereleases sind normale Releases mit `prerelease: true` — sie dürfen unvollständig sein,
  solange das im Changelog steht.
* `CHANGELOG.md` folgt Keep-a-Changelog und ist Teil des Releases, nicht ein Nachtrag.
