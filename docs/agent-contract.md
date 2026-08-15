# Agent Contract

> **Hinweis zur Sprache:** Dieses Dokument ist bewusst auf Englisch geschrieben. Es ist die
> maschinenlesbare Schnittstelle zu einer CLI mit englischen Kommandos, englischen Schema-Keys
> und englischen Fehlermeldungen; ein Sprachwechsel mitten im Vertrag ist eine reale Fehlerquelle
> für LLM-Agenten. Alle übrigen Dokumente in `docs/` sind auf Deutsch.

---

**This file is the single source of truth for every AI agent working with this repository.**
`integrations/claude-code/`, `integrations/codex/` and `integrations/chatgpt/` are thin adapters
that reference this contract. They must never state a different rule. If an adapter and this
document disagree, this document wins and the adapter is a bug.

---

## 0. The one thing to understand first

A floorplan is **data**, not a picture and not prose.

```
*.floorplan.json   ← the truth. Geometry, semantics, provenance.
*.ops.json         ← how you change the truth.
*.svg              ← a view of the truth. Never edit it.
```

You do not draw floorplans. You do not describe floorplans in prose and hope. You **read the
model, express changes as operations, apply them, validate, and render**. The tool guarantees
determinism and geometric correctness; you supply intent.

---

## 1. Which files are what

| File | Role | May you write it? |
|---|---|---|
| `*.floorplan.json` | Source of truth | Only through `floorplan apply`. Direct edits: last resort, see §7 |
| `*.ops.json` | Your change request | **Yes — this is your primary output** |
| `*.observations.json` | Interpretation of an image/PDF/scan | Yes, when you are reading a source document |
| `themes/*.yaml` | Visual style only | Yes, when explicitly asked for a design change |
| `*.svg` | Rendered output | **Never.** Regenerate it instead |
| `schema/*.json` | The contracts | No |
| `src/**` | Implementation | Only when asked to change the software itself |

---

## 2. The loop

Every task follows the same four steps. Do not skip any of them.

```
1. READ      floorplan inspect <file> --json
2. CHANGE    write <changes>.ops.json
3. APPLY     floorplan apply <file> <changes>.ops.json --output <new-file>
4. VERIFY    floorplan validate <new-file> --json    (apply already ran it; check the report)
   RENDER    floorplan render <new-file> --theme <theme> --output <file>.svg
```

### Step 1 — read before you touch

```bash
floorplan inspect house.floorplan.json --section all --json
floorplan graph  house.floorplan.json --json          # who connects to whom
```

Never guess an id. `inspect` gives you every id, every dimension and every provenance.

### Step 2 — express the change as operations

```json
{
  "schema_version": "0.1",
  "description": "Move the kitchen door 80 cm towards the window.",
  "operations": [
    { "op": "move_opening", "target_id": "door_014", "offset_delta_mm": 800 }
  ]
}
```

You do not need to memorise the vocabulary. Ask the tool:

```bash
floorplan ops list --json                 # all operations with required parameters
floorplan ops describe move_opening --json # full schema plus a working example
floorplan ops template create_door         # a ready-to-edit starting point
```

### Step 3 — apply

```bash
floorplan apply house.floorplan.json changes.ops.json --output house-v2.floorplan.json
```

* Applying is **atomic**: if one operation fails, none are applied.
* Applying is **reversible**: `floorplan undo house-v2.floorplan.json --steps 1`.
* Applying **never overwrites in place** unless you pass `--in-place`.
* Use `--dry-run` to preview.

### Step 4 — validate and render

`apply` validates automatically and refuses to write a file that contains errors. Read the
report it prints. Then render:

```bash
floorplan render house-v2.floorplan.json --theme marketing --output house-v2.svg
```

---

## 3. Dimensions: the hard rule

**Never invent a dimension.** This is not a style preference; it is the reason the system exists.

If you do not know a measurement, you have exactly four legitimate options:

1. **Ask the user.** Preferred whenever a human is in the loop.
2. **Derive it** from values that are present, and mark the result `provenance: "derived"`.
3. **Estimate it explicitly**: set the value with `provenance: "estimated"` and a `confidence`,
   and say so in your answer.
4. **Leave the field out.** Optional fields may be omitted. An absent value is honest; a
   plausible-looking wrong value is not.

Forbidden, without exception:

* declaring an estimate as `measured` or `provided`
* filling a sill height, a wall thickness or a room dimension with a "typical" value silently
* rounding a measurement into a nicer number without saying so
* raising `project.quality` because the plan *looks* finished

The provenance values, in order of decreasing trust:

```
provided   the user or client stated it
measured   surveyed on site, or taken from a survey
parsed     read from a dimensioned source (DXF, a dimension string in a drawing)
derived    computed from other values in the model
estimated  inferred (image scaling, proportion, experience)
unknown    origin unknown — not usable for anything
```

`floorplan inspect <file> --section provenance --json` tells you where every number came from.

---

## 4. Uncertainty is information, not a problem

When you reconstruct a plan from an image, a PDF or a description, you will be uncertain.
Record the uncertainty instead of hiding it:

* Write `*.observations.json` first — hypotheses with `confidence` and a `source_ref`.
* Run `floorplan reconcile <observations> --output <floorplan>`.
* Read the reconciliation report: it lists **every observation that could not be used, with a
  reason**. Relay the important ones to the user.
* The resulting document will be quality level `marketing`. That is correct. Do not "upgrade" it.

If the source does not say whether an opening is a door or an open passage, use
`candidate_type: "opening"` → it becomes a `generic_opening`. "I could not tell" is a valid,
representable answer. Guessing "door" is not.

---

## 5. Quality levels are earned, not declared

| Level | Means |
|---|---|
| `marketing` | proportions and topology are usable; dimensions are not dependable |
| `scaled` | at least one dependable reference dimension exists and everything is consistent with it |
| `verified` | all relevant values come from `provided`/`measured`/`parsed` and were checked |

To find out what is missing for a higher level:

```bash
floorplan validate house.floorplan.json --quality verified --json
```

`set_project_quality` refuses to raise the level unless the document actually validates at it.
So do not argue about the level — improve the data.

---

## 6. Validation output: what to do with it

```bash
floorplan validate house.floorplan.json --json
```

| Severity | What it means for you |
|---|---|
| `ERROR` | The model is wrong. Fix it before doing anything else. Rendering is refused. |
| `WARNING` | Probably wrong, or blocking a higher quality level. Tell the user, propose a fix. |
| `INFO` | Context. Mention it only if it matters for the task. |

Exit codes: `0` fine · `1` the model or the operation failed · `2` you called the tool wrong ·
`3` bug in the tool. Code `2` means **you** made a mistake — reread the usage, do not retry blindly.

`floorplan rules --json` lists every rule and its severity per quality level.

---

## 7. Editing the JSON directly

Allowed only when **no operation can express the change**, and only then. If you do it:

1. Change the smallest possible part of the file.
2. Keep the id. Ids are immutable; renaming means `name`, never `id`.
3. Run `floorplan validate` immediately.
4. Say in your answer that you bypassed the operation layer and why.

If you find yourself needing this repeatedly, the missing operation is a feature request —
report it rather than working around it every time.

Never hand-edit: `history` (it is the undo stack), `revision`, `schema_version`.

---

## 8. Conventions you have to know

**Units.** Everything is integer millimetres. `4200` is 4.20 m. There are no floats and no
metres in the model. `x_mm`, `y_mm`, `width_mm`, `thickness_mm`, …

**Coordinates.** X to the right, Y **up**. The renderer flips Y for SVG; the model never does.

**Walls.** A wall is a centerline (`start`, `end`) plus a `thickness_mm`. The drawn body is
computed. To make a corner, give both walls the **exact same endpoint coordinates** — a 3 mm gap
means no mitre and a `WALL_ENDPOINTS_NEAR_MISS` warning.

**Openings.** `offset_mm` is the distance from `wall.start` to the **CENTRE** of the opening.
An opening of 1000 mm at `offset_mm: 1840` occupies 1340…2340 mm.
Valid range: `width/2` … `wall_length − width/2`.

**Door direction.** Looking from `wall.start` towards `wall.end`:
`hinge: "left"` = hinge at the edge nearer `start`. `swing: "left"` = the leaf opens to the
+90° side (counter-clockwise from the wall direction). If you do not know the swing side,
**omit `swing`** — the renderer then draws the leaf closed instead of inventing an arc.
`floorplan inspect --section openings` reports `swings_into_space_id` for each door.

**Rooms.** A `space` is an explicit polygon following the clear inner faces of its walls,
counter-clockwise, without repeating the first point. Areas are always computed from the
polygon — an `area_override_mm2` is only cross-checked, never used to move geometry.

**Renovation.** Existing stock and planning live in **one** document. `state` per element:
`existing` · `planned` · `new` · `demolish` · `unknown`. Spaces normally describe the planned
layout; the `state` on walls and openings records what happens to the fabric.

**Ids.** `^[a-z][a-z0-9_]{0,63}$`, conventionally `wall_001`, `door_014`, `space_kitchen`.
Immutable. Never reused, not even after deletion.

---

## 9. Worked examples

### "Move the door between kitchen and hallway 80 cm to the right"

```bash
floorplan graph plan.floorplan.json --json     # find the door connecting the two rooms
```

```json
{ "schema_version": "0.1",
  "operations": [{ "op": "move_opening", "target_id": "door_014", "offset_delta_mm": 800 }] }
```

"Right" is ambiguous — `offset_delta_mm` is positive towards `wall.end`. Check the wall
direction with `inspect --section walls`, and say in your answer which direction you used.

### "Remove the door between living room and kitchen, make it a 1.60 m open passage"

```json
{ "schema_version": "0.1",
  "operations": [
    { "op": "convert_opening", "target_id": "door_003", "to_type": "passage",
      "width_mm": 1600, "height_mm": 2100, "state": "new" }
  ] }
```

Prefer `convert_opening` over delete+create: the opening keeps its identity and its history.

### "Mark the wall between bathroom and hallway for demolition"

```json
{ "schema_version": "0.1",
  "operations": [{ "op": "set_state", "target_id": "wall_008", "state": "demolish" }] }
```

Then tell the user that the room polygons still describe the old layout, and offer to update
them (`set_space_boundary` or `merge_spaces`).

### "Design a single storey house of about 145 m² with three bedrooms …"

There is no automatic solver in v0.1. You are the designer:

1. `floorplan create house.floorplan.json --template empty --name "…"`
2. Build the layout with `create_wall`, `create_space`, `create_door`, `create_window`.
3. All values you choose come from **you or the user**, so they are `provided` — not `measured`.
4. Validate, render, present, iterate.
5. State clearly that the dimensions are a design proposal, not measurements of anything.

### "Reconstruct this floorplan from the attached image"

1. Write `plan.observations.json` — every wall, opening and room you can see, each with a
   `confidence` and a `source_ref`.
2. Provide a calibration only if you can actually justify the scale. If you cannot, leave it out.
3. `floorplan reconcile plan.observations.json --default-thickness-mm <n> --output plan.floorplan.json`
   Only pass `--default-thickness-mm` if the user agreed to that assumption.
4. Report the rejected observations and the assumptions from the report.
5. The result is `marketing` quality. Say so.

---

## 10. What you must tell the user

Be explicit about these, every time they apply:

* which dimensions are estimated rather than known
* what you assumed (and that it *was* an assumption)
* which observations could not be used, and why
* which validation warnings remain
* that the quality level is `marketing` when it is

And never state or imply that the system checked anything about building regulations,
fire safety, escape routes, minimum room sizes or living-area calculation (WoFlV/DIN 277).
It does not. The validator distinguishes exactly three things and says so:

```
geometric validity        checked
architectural plausibility  hinted at (INFO only, common practice, no requirement)
legal admissibility        NOT checked, not represented, not implied
```

---

## 11. Quick reference

```bash
floorplan inspect  <file> --section all --json     # read everything
floorplan graph    <file> --from <space> --to <space> --json
floorplan validate <file> --quality verified --json
floorplan ops list --json                          # discover the vocabulary
floorplan ops describe <op> --json
floorplan apply    <file> <ops> --output <new> --json
floorplan undo     <file> --steps 1 --output <new>
floorplan render   <file> --theme technical --output <svg>
floorplan reconcile <observations> --output <floorplan>
floorplan rules --json                             # all validation rules
floorplan schema floorplan                         # the data contract itself
```

Everything accepts `--json`. Everything is deterministic. Nothing carries a timestamp unless
you pass `--stamp`.
