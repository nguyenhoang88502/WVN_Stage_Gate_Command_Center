# SOP — WVN NPI & ECN Stage Gate Command Center

**Document:** SOP-EPM-001
**Applies to:** WVN Stage Gate Command Center v11
**Owner:** Early Product Management (EPM) — WOS Pillar 09
**Audience:** NPI/ECN project members, moderators, and the system admin

---

## 1. Purpose and scope

The Command Center tracks the NPI (7-step) and ECN (12-step + PPAP) stage-gate
workflows. Its job is to make one question answerable at any moment: **is this
project actually ready to pass this gate?**

A gate closes only when all three are true:

1. every mandatory document for that step is filed,
2. no issue is open against that step, and
3. a named person signs it.

**It never reads or writes D365.** Finance, SRC and Production enter the
finalised result in D365 afterwards; this tool records that the decision was
made and on what evidence.

### Out of scope
- It is not a document management system. It records where evidence lives and
  its SHA-256, and copies files into the evidence vault — it does not version
  or approve documents themselves.
- It is not an ERP. No costing, no inventory, no purchasing.

---

## 2. Installing and launching

The tool runs **entirely offline** on each PC. No internet, no CDN, no server
infrastructure. Since v11 the team shares **one app folder in the SharePoint
library**, synced to every PC by the OneDrive client; each user launches it from
their own synced copy.

1. The admin unzips `WVN_Stage_Gate_Command_Center_ModelOnly_v11.zip` into the
   shared library folder (with `NPI_EPM_Documents_Control` beside it for the
   vault). Every user syncs that library.
2. If Windows flagged the download, run `WVN_Unblock_Files.cmd` once.
3. Double-click **`Open_WVN_NPI_Command_Center.cmd`**. A PowerShell window opens
   (leave it running) and the browser launches at `http://localhost:8080`.
4. To stop, run **`Stop_Server.cmd`** or close the PowerShell window.

**Health check:** the pill at the top right must read `connected`. If it reads
`offline`, the PowerShell window has closed or another process holds port 8080.

### Upgrading to v11 (admin, once)

1. Ask everyone to **stop the app** on their PC.
2. Back up `system\tracking\` and the vault folder.
3. Replace the app folder with the v11 bundle, keeping `system\tracking\`.
4. Dry run: `powershell -ExecutionPolicy Bypass -File system\launcher.ps1 -Backfill`
   — read the report in `system\logs\v11_backfill_*.txt`. The line
   *active differs from last-row-wins* must be **0**.
5. Apply: the same command with `-Backfill -Apply` (it backs up `tracking\` first
   and refuses once any PC has already written v11 data).
6. Everyone restarts the app. **No PC may keep running an older version.**

Each PC's changes are kept in its own file under `system\tracking\journal\`
and merged by everyone's app — never edit or delete those folders.

---

## 3. Identity and roles

Pick your name from the dropdown in the top bar **before doing anything**.
Every claim, upload, approval and bypass is recorded against that name and
written to the audit log.

| Role | Set by | Can do |
|---|---|---|
| User | Present in the user registry | Claim tasks, file evidence, raise issues, add notes |
| Moderator | Listed in `config.json` → `moderators` | Everything a user can, plus assign tasks to others and sign gates out of sequence |
| Admin | Selecting `admin` + PIN | Everything, plus Settings: master data, personnel, document types, PIN |

**Admin is PIN-gated.** Selecting `admin` prompts for a PIN (default `1234`).
The unlock lasts for the browser tab only — closing the tab re-locks it.
Change the PIN in **Settings → Admin Security PIN**; it is stored in
`config.json` and is a workflow guard, not a security boundary.

---

## 4. Interface layout

| Area | Purpose |
|---|---|
| Left rail | Six workspaces. Collapses to icons via the ☰ button; the choice persists |
| Top bar | Current workspace, connection status, identity, manual reload, 15s auto-reload, theme, VI\|EN |
| Page body | The active workspace |
| Right drawer | Opens over the content when a project or gate is selected |

**Language:** the interface defaults to Vietnamese. `VI | EN` in the top bar
switches instantly without losing your place. Project IDs, document codes,
personnel names and file paths are data and stay unchanged in both languages.

---

## 5. Daily workflow

### 5.1 Find your work — Claimed Work

Opens on everything claimed by or assigned to you. Overdue items sort first.
Admins and moderators see all personnel and can filter by person.

The **Issue Date** column shows when an issue was raised — use it to spot
ageing problems that have quietly sat unowned.

### 5.2 Open a gate

Go to **NPI** or **ECN**, click a project. The drawer opens at that project's
first incomplete step and shows: status and certifications, ownership, target
week, gate notes, required documents, filed documents, open issues, and the
approval controls.

### 5.3 Claim the task

Click **Claim Task**. You become the Primary Owner. If someone already owns it,
clicking instead makes you Supporter — a second pair of hands, not a takeover.

Ownership matters: **only the owner sees the upload dropzones.** A task nobody
has claimed is a task nobody is accountable for.

Moderators and admins can use **Assign Task** to place someone else as owner or
supporter; the badge then records who assigned it.

### 5.4 File evidence

Each missing document renders its own dropzone. Drag files onto it, or click
the label to browse. Several files at once is fine — they upload in sequence
and the sidebar redraws once at the end.

Each dropzone also offers:
- **Target week** — when this document is due; overdue turns red
- **Note** — a short comment recorded against the document
- **Download Blank Template** — the controlled company form, where one is mapped
- **Mark as not applicable** — for documents this project genuinely does not need

Files are copied into the evidence vault under a standardised name (ending in
a short fingerprint of the file's content) and hashed. A byte-identical
re-upload is detected and skipped rather than duplicated.

**Upload panel.** Every upload — one file or a hundred — goes through the panel
at the bottom right: one file at a time, retried automatically. A line reading
*Failed (row – file is saved)* means the file is safely in the vault but its
record did not save: press **Retry failed**; only the record is re-sent.

**Revising a document.** A filed document shows its current revision (`rev 2`).
Use **New revision** to file a changed version — a change reason is required —
and **History** to see every revision, who filed it, when and why. The latest
revision is the one gates and reports use; older ones stay on record.

**Cannot copy the file?** Use *Or cite a network path / link* on the Input tab.
The gate counts it as filed, but nothing is copied and there is no hash to
verify against later — prefer uploading wherever possible.

### 5.5 Raise and resolve issues

**Raise issue…** opens a form for description, owner, due date and severity.
The owner defaults to **you** — whoever spots the problem holds it until it is
formally handed over.

An open issue against a step **blocks that gate**, regardless of documents filed.

To resolve: drop the resolution evidence onto the **Resolve this issue**
dropzone on the issue row. The issue closes, records the evidence path, and the
⚠ badge clears.

### 5.6 Record decisions — gate notes

**Gate Notes** is a threaded log against the step. Use it for the decision you
took and why. It does not change gate status; it is the reasoning future
readers will need.

### 5.7 Approve the gate

**Approve step N** is enabled only when documents are complete, no issue is
open, and prior steps are closed. The button's tooltip states what is blocking
it. You are asked for an optional comment — **Cancel aborts; nothing is signed.**

Approval is **irreversible through the interface.** There is no un-approve.

**Approval stale.** If a required document is revised *after* the gate was
signed, the gate shows **⚠ approval stale** (drawer, dashboard matrix, Gantt,
PDF, transfer report). The signature stays on record; review the new revision
with the approver and record the decision in Gate Notes.

### 5.8 Authorise a bypass (exception)

**Authorise bypass…** closes a gate without complete evidence. It requires a
business reason, a risk mitigation, and optionally an expected supersede date.
The step counts as complete for downstream steps and is permanently flagged as
bypassed on the project.

Use it when the schedule genuinely cannot wait. Every bypass is auditable and
visible on the dashboard.

---

## 6. Registering projects

**Input → Register a project.**

- **Family ID** forms the project ID (`9649LP` → `NPI-9649LP`)
- **Change / project type** sets cycle time and which steps apply. Type or pick
  — `A`, `Type E`, or the full label all resolve. Unrecognised text is rejected
  rather than silently accepted
- **Target finish** is calculated from the type's cycle time unless overridden
- **Certifications** — usually the longest lead item; record them at registration

**Batch registration:** drop a CSV of one row per project. The import reports
accepted and rejected rows with reasons.

**Batch evidence:** drop many files at once; the tool guesses document type and
step per filename for you to correct, previews the standardised names, then
files them together.

---

## 7. Monitoring — the Dashboard

| Section | Reads |
|---|---|
| Portfolio KPIs | FG transfers, on-time completion, issues resolved, LFIs, shipment delays |
| Stage Matrix | Gate completion by step and product family; click any cell to open that gate |
| NPI Stage Completion | Per-step completion with the models still missing. Collapsed by default — click the header to expand |
| Work Matrix | Admin/moderator only: who owns what, across every project |
| Project Schedule (Gantt) | Planned vs actual per stage, coloured by status |

**The bold red vertical line is today.** It appears on the on-screen Gantt and
on the exported PDF. If a project's bars sit left of it, that project is behind.

**Reading the timeline.** The axis runs in two tiers: months across the top,
ISO week numbers below. Faint vertical rules mark the weeks so a bar's end can
be read off without tracing back up to the header.

**Drilling into a project.** The chevron beside a project id opens one row per
step, each drawing its own bar rather than sharing the project's summary
strip — with the responsible department, the PIC, and that step's issue and
note counts alongside. Hover a bar for its start week, target week, and
document count; click it to open that step in the drawer. Rows stay expanded
across the auto-reload, and more than one project can be open at a time for
comparison.

A step bar whose tooltip says *no target week set* has been interpolated
between the steps either side of it — it is a placeholder, not a plan. Set the
target week on the gate to place it properly.

**Auto-reload:** tick `auto` for a 15-second refresh. It preserves scroll,
open drawer, filters and typed text, and skips entirely while you are typing,
dragging, mid-upload, or have files staged.

---

## 8. Reports

**Download PDF** produces the print package: KPIs, matrix and Gantt.

**XLSX reports** (dropdown → Download):

| Report | Contains |
|---|---|
| LFI Analytics | Late-found issues, ranked |
| Project Transfer | Transfer readiness per project |
| KPI Report | Portfolio KPIs |
| Lessons Learned | LL records |
| Trial Report | Trial quantities and results |

---

## 8b. Finding documents — the Document Vault tab

One row per document across every project: its current revision, who filed it
and when, and whether a signed gate is stale because of it. Filter by pillar,
family, document type, PIC, department, date range or status, or type part of a
file name, description or project ID. **Open**, **History** and **New revision**
work from any row.

---

## 9. Administration

**Settings** (admin only):

- **Evidence vault path** — where uploads are written
- **Product families / Change types / Document types** — master data. The
  Change / project types table scrolls horizontally on narrow windows
- **User registry** — personnel; drives every owner dropdown
- **Moderators** — who may assign work and sign out of sequence
- **Templates** — blank company forms mapped to document types
- **Admin Security PIN** — requires the current PIN to change
- **Pillars** — the stage-gate processes. NPI and ECN come built in; **Add pillar**
  creates another (for example an equipment process) with its own steps,
  document types and name for the responsible person. It gets its own tab,
  dashboard matrix and Vault search at once. A pillar with projects cannot be
  deleted. Pillar IDs become the project-ID prefix and cannot be changed later.

A change type still referenced by a project cannot be deleted.

---

## 10. Troubleshooting

| Symptom | Cause | Action |
|---|---|---|
| `offline` in the top bar | Server window closed, or port 8080 taken | Re-run `Open_WVN_NPI_Command_Center.cmd` |
| No dropzones on a step | The task is owned by someone else | Claim it, ask the owner, or have an admin reassign |
| Approve button greyed out | Missing docs, open issue, or a prior step still open | Hover it — the tooltip names the blocker |
| Uploads fail | Vault path wrong or not writable | Check Settings → evidence vault path |
| PowerShell won't start the script | `.ps1` missing its UTF-8 BOM after manual editing | Re-extract from the distributed zip |
| Page unstyled | `system/vendor/` missing from the deployment | Re-extract; do not copy files selectively |
| A colleague's change has not appeared | OneDrive has not synced it yet | Check the OneDrive icon; it arrives once both PCs have synced |
| Upload panel shows *Failed (row – file is saved)* | The record write failed | Press **Retry failed** — the file is not uploaded again |
| Storage warning about a conflict copy or "modified after the v11 upgrade" | A PC still runs an old version, or two admins saved Settings at once | Update/restart that PC; for `config-*.json`, re-apply the missing Settings change |

---

## 11. Records and audit

Everything is CSV under `system/tracking/` — the base files plus each PC's
journal under `system/tracking/journal/`:

| File | Holds |
|---|---|
| `lb_projects.csv` | Registered projects |
| `lb_gates.csv` | Gate status, ownership, target weeks |
| `lb_approvals.csv` | Signed approvals |
| `lb_deliverables.csv` | Filed documents with hashes |
| `lb_issues.csv` | Issues and resolutions |
| `lb_doc_comments.csv` | Notes |
| `lb_audit.csv` | Full audit trail: who, what, when, from → to |

These are the record. Back up `system/tracking/` and the evidence vault on the
same schedule as any other quality record.

**Never hand-edit them.** Since v11 the app merges the base files with every
PC's journal; an edited file can be silently outvoted or flagged as a conflict.

---

*Prepared for WAHL Vietnam Early Product Management. Screens shown in the
accompanying deck are from v10; v11 adds the Document Vault tab, revision
history, the upload panel and Settings → Pillars.*
