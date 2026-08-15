---
name: floorplan
description: >-
  Create, reconstruct, understand, modify, validate and render architectural floorplans through a
  deterministic, vendor-neutral core. Floorplans live in a structured JSON model, never as
  generated images. Use this skill whenever the user talks about floorplans, room layouts,
  apartments, houses, garages, renovations, room areas, doors, windows or wall changes.
license: LicenseRef-Proprietary
metadata:
  version: 0.1.0-alpha.1
  runtime: node>=20.10.0
  install_required: false
  network_required: false
---

# Floorplan Skill

## What this is

A floorplan is **data**, not a picture:

```
*.floorplan.json   the truth: geometry, semantics, provenance
*.ops.json         how you change the truth
*.observations.json  what you believe you saw in an image or PDF
*.svg              a view of the truth — never edit it
```

You never draw a floorplan and you never generate an image of one. You read the model, express
changes as operations, apply them, validate and render.

**The complete contract is `references/agent-contract.md`. Read it before modifying a
floorplan.** This file is the entry point; the contract is normative.

## Setup

**Nothing to install.** This bundle carries the whole core with it. It needs Node ≥ 20 and no
network, no `npm install` and no git clone.

```bash
node scripts/floorplan.js --version
```

`scripts/floorplan.js` finds the bundled core at `core/` and forwards every argument to it.

### Package layout

```text
floorplan/
├── SKILL.md            this file
├── MANIFEST.json       every bundled file with its SHA-256
├── LICENSE
├── agents/openai.yaml  capabilities and calling conventions
├── references/         the shared, normative documentation
├── scripts/
│   └── floorplan.js    entry point — locates core/ and forwards
└── core/               the floorplan core, ready to run
    ├── bin/ src/ schema/ themes/
    ├── fixtures/       worked examples of every file format
    └── VERSION
```

Paths mentioned in `references/*.md` are relative to `core/`. A document referred to there as
`fixtures/03-house-ground-floor/house-ground-floor.floorplan.json` lives in this bundle at
`core/fixtures/03-house-ground-floor/house-ground-floor.floorplan.json`.

Look at the fixtures whenever you are unsure about a format — they are valid, minimal,
worked examples of exactly what you are being asked to produce.

## The loop

```bash
# 1. READ — never guess an id
node scripts/floorplan.js inspect plan.floorplan.json --section all --json
node scripts/floorplan.js graph   plan.floorplan.json --json

# 2. LOOK UP — never invent an operation name
node scripts/floorplan.js ops list --json
node scripts/floorplan.js ops describe move_opening --json

# 3. WRITE changes.ops.json
# 4. APPLY — atomic, validates automatically, never writes in place
node scripts/floorplan.js apply plan.floorplan.json changes.ops.json \
     --output plan-v2.floorplan.json --json

# 5. VERIFY and SHOW
node scripts/floorplan.js validate plan-v2.floorplan.json --json
node scripts/floorplan.js render   plan-v2.floorplan.json --theme marketing \
     --output plan-v2.svg --json
```

## Non-negotiable rules

1. **Never invent a dimension.** Unknown means: ask, or record `provenance: "estimated"` with a
   `confidence`, or omit the optional field. Never declare an estimate as `measured`/`provided`.
2. **Operations, not hand-edited JSON.** Direct edits only when no operation covers the case —
   then validate immediately and say so in your answer.
3. **Millimetres, integer.** X right, Y up. `4200` is 4.20 m.
4. **`offset_mm` is the CENTRE of an opening**, measured from `wall.start`.
5. **Unknown door swing → omit `swing`.** The renderer then draws the leaf closed instead of
   inventing an arc.
6. **Quality levels are proven, not claimed.** `validate --quality verified` shows what is missing.
7. **No statements about building regulations.** Geometry is checked, plausibility is hinted at,
   legal admissibility is out of scope and must not be implied.

## Typical requests

| User says | You do |
|---|---|
| "Move the door between kitchen and hallway 80 cm" | `graph` to find the door → `move_opening` |
| "Remove that door, make it a 1.60 m opening" | `convert_opening` to `passage` |
| "Mark this wall for demolition" | `set_state` with `demolish` |
| "How big is the apartment?" | `inspect --section spaces` — report it as *geometric floor area* |
| "Which rooms can I reach from the hallway?" | `graph --from space_hall` |
| "Reconstruct this plan from the photo" | observations → `reconcile` → report what was unusable |
| "Design a house with …" | build it with `create_*` operations; every value is `provided` |
| "Make it look like our corporate design" | a theme, never a geometry change — `references/themes.md` |

## What you must tell the user

Every time it applies: which dimensions are estimated, what you assumed, which observations
could not be used and why, which warnings remain, and that a reconstruction is `marketing`
quality.

## References

| File | Content |
|---|---|
| `references/agent-contract.md` | the normative contract — read this |
| `references/operations.md` | the change vocabulary |
| `references/observations.md` | reconstructing from images and PDFs |
| `references/provenance.md` | how uncertainty is recorded |
| `references/themes.md` | corporate design without touching geometry |
| `references/setup.md` | installing and locating the core |
