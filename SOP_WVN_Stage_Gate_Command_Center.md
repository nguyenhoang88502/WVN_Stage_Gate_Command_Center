# SOP — WVN NPI & ECN Stage Gate Command Center

**Document:** SOP-EPM-001
**Applies to:** WVN Stage Gate Command Center v9.2.1
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

The tool runs **entirely offline** on a local machine. No internet, no CDN, no
server infrastructure.

1. Unzip `WVN_Stage_Gate_Command_Center_ModelOnly_v9.2.1.zip` to a local folder.
   Avoid OneDrive-synced folders — file locking causes intermittent write errors.
2. If Windows flagged the download, run `WVN_Unblock_Files.cmd` once.
3. Double-click **`Open_WVN_NPI_Command_Center.cmd`**. A PowerShell window opens
   (leave it running) and the browser launches at `http://localhost:8080`.
4. To stop, run **`Stop_Server.cmd`** or close the PowerShell window.

**Health check:** the pill at the top right must read `connected`. If it reads
`offline`, the PowerShell window has closed or another process holds port 8080.

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

Files are copied into the evidence vault under a standardised name and hashed.
A byte-identical re-upload is detected and skipped rather than duplicated.

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

## 9. Administration

**Settings** (admin only):

- **Evidence vault path** — where uploads are written
- **Product families / Change types / Document types** — master data. The
  Change / project types table scrolls horizontally on narrow windows
- **User registry** — personnel; drives every owner dropdown
- **Moderators** — who may assign work and sign out of sequence
- **Templates** — blank company forms mapped to document types
- **Admin Security PIN** — requires the current PIN to change

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

---

## 11. Records and audit

Everything is CSV under `system/tracking/`:

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

**Do not hand-edit them while the server is running** — the tool writes whole
files and your changes will be lost.

---

*Prepared for WAHL Vietnam Early Product Management. Screens shown in the
accompanying deck are from v9.2.1.*
