# Sample data package — for demonstrating the tool

Everything here is **fabricated demo data**. No real WAHL project, customer, price or person
appears in it. The names are invented, and the FG numbers are drawn from the sample lists already
in `config.json`. Nothing here should be presented as an actual project status.

Two separate things live in this folder:

| What | Use it for |
|---|---|
| `tracking/` — 15 ready-made CSVs | Making the app look populated for a walkthrough |
| `project_batch_demo.csv` | Demonstrating **A2. Batch Project Registration** live |

---

## 1. Load the populated demo (`tracking/`)

The tool reads everything from `system\tracking\*.csv`. To run a demo, replace that folder's
contents with this one.

> **The tool must be stopped first.** The launcher holds file locks while it runs, and swapping the
> CSVs underneath a live server will either fail or be silently overwritten.

1. Stop the tool — click **🛑 Stop Server**, or close the black launcher window.
2. **Back up the real data if there is any**, e.g. copy `system\tracking` to `system\tracking_real`.
3. Copy every `.csv` from `sample_data\tracking\` into `system\tracking\`, overwriting.
4. Start the tool again with `Open_WVN_NPI_Command_Center.cmd`.

To go back afterwards, copy your backup over `system\tracking\` the same way.

### What the demo dataset contains

26 projects — 19 NPI and 7 ECN — across all six product families and all five change types,
deliberately spread so every visual state on the dashboard is represented:

| Status | Count | Why it looks that way |
|---|---:|---|
| Complete | 6 | every gated step has an approval in `lb_approvals` |
| In progress | 8 | roughly 60% of gated steps approved, target week still ahead |
| Late | 5 | partly approved **and** `target_date` is before the current work week |
| Not started | 7 | no approvals at all |

Supporting records, all consistent with those statuses:

- **377 deliverables** — evidence documents, so the stage matrix and the per-step doctype
  breakdown (`PRF 3/5`, `QUOTE 5/7`) have something to count
- **67 approvals** — what actually drives every status above
- **2 bypasses** (`NPI-9655N` step 4, `ECN-4501` step 11) — these render with the dashed outline
  that marks unresolved process debt, which is worth pointing out in a demo
- **11 LFIs** in `lb_issues` (6 open, 5 closed) and **6 SharePoint issues** — these feed the
  "LFIs identified" and "Issues resolved" KPI tiles
- **30 warehouse readiness rows**, **18 D365 entries**, **95 audit-log rows**

The data is generated so it is *internally consistent*: statuses are derived from the approvals,
not written independently. A project is never shown as 100% complete and overdue at the same time.

Dates are anchored to **2026-W32**. If you demo much later than that, more projects will drift into
"late" — regenerate or edit `target_date` in `lb_projects.csv` if that matters for your audience.

---

## 2. Demonstrate batch registration (`project_batch_demo.csv`)

This file is designed to be imported **live, in front of an audience**, on top of the populated
demo above. It contains 14 data rows:

- **8 valid rows** that register cleanly (4 NPI, 4 ECN)
- **6 invalid rows**, each breaking a *different* validation rule
- plus comment rows starting with `#`, which the importer ignores

Steps:

1. Go to the **Input** tab → **A2. Batch Project Registration**.
2. Optionally click **Download CSV Template** first, to show where the format comes from.
3. Drag `project_batch_demo.csv` onto the drop zone (or click to browse).
4. Click **Import Batch CSV**.

Expected result — worth reading out, because it is the point of the feature:

```
8 projects registered
8 accepted · 6 rejected · 14 rows read
```

and a table naming each rejected row with its reason:

| CSV row | Rejected because |
|---|---|
| 14 | `process must be NPI or ECN (got 'XXX')` |
| 15 | `family_id (or fg_id) is required - it forms the project ID` |
| 16 | `class_abcde 'Z' is not a configured change type (A/B/C/D/E)` |
| 17 | `family 'NOT-A-REAL-FAMILY' is not a configured product family` |
| 18 | `prf_date '13/07/2026' must be an ISO week (2026-W32) or a date (2026-08-06)` |
| 19 | `duplicate of row 4 in this file - both produce project ID NPI-9891` |

Row numbers count from 1 including the header, so they line up with what Excel shows.

The two things to emphasise: **the 8 good rows are still imported** — one bad row does not
sink the file — and **nothing existing is ever overwritten**. Running the same import a second
time gives `0 accepted · 14 rejected`, every row refused with "project … already exists". That is
the safe outcome, and it is worth demonstrating.

The eight project IDs created are `NPI-9891`, `NPI-9906`, `NPI-6275LP`, `NPI-2240LC`,
`ECN-79449-1001`, `ECN-5608`, `ECN-3155`, `ECN-3026590`. Both imports are written to
`lb_audit.csv` as `Import_Projects_Batch`, plus one `Create_Project_Batch` row per project.

The file also quietly exercises quoted commas (`"Li-ion cordless clipper, EU launch"`) and UTF-8
Vietnamese (`Ghi chú: giảm nhựa 12%`), so those survive the round trip visibly.

---

## Suggested 5-minute walkthrough

1. **Dashboard** — Portfolio KPIs across the top, then *Family transfer progress*: one bar per
   family, every bar the same width, segmented Complete / In progress / Late / Not started with the
   count breakdown beside it. Click a bar to jump into that family.
2. **Gate completion by step** — a tile per gated step showing `done/total`, with the per-document
   breakdown underneath. Click a tile to land on the first project actually stuck at that step.
3. **NPI tab** — pick a project from the family tree; walk one step card, showing required evidence,
   what is filed, and what is missing.
4. **ECN tab** — show that the matrix collapses to the 3 gated steps, with the earlier steps'
   evidence folded into them.
5. **A bypass** — open `NPI-9655N` step 4. Point out the dashed outline: the gate is cleared for
   progression but stays visible as process debt.
6. **Input → A2** — run the batch import above.
7. **Theme toggle** — light is the default; dark is one click away and the print/PDF output stays
   light regardless.
8. **Dashboard → Save as PDF** — browser print-to-PDF of the executive block.

---

## Regenerating

`tracking/` was produced by a generator script rather than written by hand, so the cross-references
stay consistent. If the data model changes, regenerate rather than patching CSVs by hand — the
statuses on the dashboard are derived, and hand-edits drift out of agreement quickly.
