# Setup

The skill package contains the instructions; the **core** is a separate, dependency-free
Node.js program. This file explains how the two find each other.

## Requirements

* Node.js ≥ 20.10
* nothing else — no `npm install`, no build step, no network access

That is a deliberate architectural decision (`docs/adr/0001-language-and-runtime.md` in the
core repository): an installation step that fails inside a sandbox is the most common reason
for an agent to start inventing workarounds.

## The released bundle needs no setup at all

If you got this skill as `skill.zip` from a release, the core is **already inside it** at
`core/` and there is nothing to do:

```bash
node scripts/floorplan.js --version
```

That is the normal case (`docs/adr/0017-self-contained-skill-bundle.md`). The options below
matter only when you assemble the skill yourself, for development or debugging.

## Option A — bundle the core inside the skill

```bash
cd <skill>/floorplan
git clone git@github.com:dg-agentur/floorplan.git core
node scripts/floorplan.js --version
```

The wrapper finds `./core/bin/floorplan.js` automatically. This is what
`npm run build:skill` produces, without the clone.

## Option B — point at an existing checkout

```bash
export FLOORPLAN_HOME=/path/to/floorplan-platform
node scripts/floorplan.js --version
```

## Option C — global command

```bash
cd /path/to/floorplan-platform && npm link
floorplan --version
```

The wrapper falls back to a globally available `floorplan` if it finds no checkout.

## Verifying

```bash
node scripts/floorplan.js --version        # 0.1.0
node scripts/floorplan.js ops list         # the change vocabulary
node scripts/floorplan.js rules            # the validation rules
```

Everything works? Then run the built-in end-to-end demonstration in the core repository:

```bash
cd $FLOORPLAN_HOME && npm run demo
```

It loads a synthetic house, validates it, renders it deterministically, applies a batch of
operations, revalidates, renders again in two themes and undoes everything — the exact loop
this skill uses.

## If the core cannot be found

The wrapper prints every path it searched and the two commands that fix it. It never falls
back to guessing or to a partial reimplementation: a second implementation of the geometry
would be a second source of truth, which is precisely what this architecture avoids.

## Directory layout of the skill

```text
floorplan/
├── SKILL.md              entry point and short rules
├── agents/
│   └── openai.yaml       how to call the platform (no domain logic)
├── references/           the shared contract and the reference documents
│   ├── agent-contract.md    ← normative
│   ├── operations.md
│   ├── observations.md
│   ├── provenance.md
│   ├── themes.md
│   └── setup.md          ← this file
└── scripts/
    └── floorplan.js      locator, forwards every argument to the core
```

The files under `references/` are **generated copies** of the core documentation
(`node scripts/sync-chatgpt-skill.js`). A test in the core repository fails if a copy drifts
from its original, so the skill can never carry a different rule than Claude Code or Codex.
