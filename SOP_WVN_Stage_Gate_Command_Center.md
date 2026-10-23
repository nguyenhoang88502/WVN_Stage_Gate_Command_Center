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
2. **First time on each PC:** open the synced folder and double-click
   **`Open_WVN_NPI_Command_Center.cmd`**. A window flashes for a moment and
   closes; the browser opens at `http://localhost:8080`, and a shortcut
   **WVN Stage Gate Command Center** (factory icon with a green tick) appears on
   the desktop, pointing at this PC's copy of the folder.
3. **Every day after:** start the app from that desktop shortcut. No terminal
   window opens — the server runs in the background.
4. To stop, run **`Stop_Server.cmd`** in the folder; a message confirms it.
   Signing out of Windows or restarting the PC also stops it.

If the shortcut stops working (the folder was moved) or was deleted, run
`Open_WVN_NPI_Command_Center.cmd` once again — it puts it right.

**Health check:** the pill at the top right must read `connected`. If it reads
`offline`, the server has been stopped, or another process holds port 8080 —
start it again from the shortcut. If nothing at all happens, a message box
usually explains why; otherwise look in `system\logs\start_*.log`.

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

### Upgrading to v12 (admin, once)

1. Ask everyone to **stop the app**, then replace the app folder with the v12
   bundle, keeping `system\tracking\` and `system\config.json`.
2. Start the app and sign in as **`admin`**. The first password is the **old
   admin PIN**; you are asked to replace it with a real password straight away
   (the PIN is then deleted from `config.json`).
3. Open **Settings → Users and passwords** and press **Issue password** for each
   person. Each one gets a temporary password, shown to you once — hand it over
   in person. Nobody else can sign in until you have done this.

---

## 3. Signing in, identity and roles

The app opens on a **sign-in page**. Type your user name and password; the
vault list follows, with the common vault (`NPI_EPM_Documents_Control`)
preselected — press **Open vault**.

- **First sign-in / after a reset:** you sign in with the temporary password the
  admin gave you and must choose your own (at least 8 characters) before
  anything else opens.
- **Your name comes from the sign-in.** Every claim, upload, approval and bypass
  is recorded against it and written to the audit log. There is no name picker
  any more, so nobody can act under someone else's name.
- **Top-right menu (your name):** *Change my password*, *Switch vault*, *Sign out*.
- **Forgot your password?** Ask the admin for a reset. Five wrong tries lock the
  account for 5 minutes.
- You are signed out when the app is stopped on your PC, or after 12 idle hours.

| Role | Set by | Can do |
|---|---|---|
| User | Present in **Settings → Users and passwords** | Claim tasks, file evidence, raise issues, add notes, keep personal vaults |
| Moderator | Listed in `config.json` → `moderators` | Everything a user can, plus assign tasks to others and sign gates out of sequence |
| Admin | Signing in as `admin` | Everything, plus Settings: master data, users and passwords, folder structure, every vault |

**How passwords are kept.** Only a salted hash of each password is stored (one
small file per user under `system\auth\`). Nobody — including the admin — can
read a password back from it. The admin can optionally switch on **Let the
admin view passwords** in Settings; an encrypted copy is then kept that only the
admin password unlocks, and every view is written to the audit log. Leave it off
unless you really need it.

**What the sign-in does not do.** The app folder is synced to every PC, so
anyone with access to that folder can still open its files directly. The
sign-in controls what happens through the app; it does not lock the folder.

---

## 4. Interface layout

| Area | Purpose |
|---|---|
| Left rail | The vault you are in (click it to switch vault), then the workspaces. Collapses to icons via the ☰ button; the choice persists |
| Top bar | Current workspace, connection status, your name (menu: change password, switch vault, sign out), manual reload, 15s auto-reload, VI\|EN, theme |
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

**More than one file for the same document type (v11.1).** Some documents need
a different file per BOM part — a drawing per part, for instance. **Dropping
more than one file at once files all of them, each as its own active
document** — every file gets a part guessed from its own name ("Bracket.pdf"
→ part "Bracket"), so five drawings for five parts come out as five
documents, not one revision chain with four of them silently gone. A single
file dropped alone is unaffected (blank part, as always).

If the guessed part is wrong — the file is really the whole document, not
one BOM part of it — click the **part badge** on the filed row afterwards
and rename it (renames the whole history of that part, not just the current
file, so nothing gets orphaned). Two files that really are meant to replace
each other should share the same part on purpose; the app warns before that
happens in the Input tab's batch table (which asks for a part per row
directly, alongside the document type and step — the natural place for
filing a whole BOM's worth of documents at once, and it has an
**Uncategorized files** card underneath it — see §5.4b).

**Dropping a folder.** Dropping a whole folder (from the Input tab, or a
drawer dropzone) files every file inside it, including subfolders. If the
folder itself is named after a project — `9944`, `NPI-9944`, `NPI_9944` all
match — that project is picked automatically on the Input tab.

**Keep the original file name.** Every batch upload on the Input tab has a
"keep the original file name" checkbox — tick it and the standardised naming
convention is skipped for that batch; the file is filed under its own name
(still deduplicated by content, same as always).

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

### 5.4b Uncategorized files (v11.1)

Anyone with access to the vault folder in Explorer can paste a file straight
into it, bypassing the app entirely — no project, no step, no document type,
no record of who did it or when. The Input tab has a permanent
**Uncategorized files in the vault** card that lists every one of these, with
the Windows account that owns the file and when it was created — the most
this tool can say about a file it never saw arrive.

If the file already sits where the app itself would have filed one
(`[Family]\[Document type]\[Part]\`), the card says so — **"Looks like:
NPI-9944 / DWG (Bracket)"** — and offers:
- **Confirm** — one click. Files it under the guessed project/document/part
  and renames it to match the current naming standard.
- **Adjust** — opens the same picker pre-filled, for changing anything
  before filing (including un-ticking **standardize the file name**, which
  keeps the file exactly where and as it is instead of renaming it).

A file that is not in a recognised folder gets a plain **Categorize** button
instead, opening the same picker blank. Either way there is also:
- **Not a deliverable** — dismiss it with a reason (a stray screenshot, a
  leftover draft). It will not be listed again.

**Choices are saved together (v12.2).** Confirm, Categorize and Not a
deliverable do not save at once and the list does not reload after each file —
the row stays where it is, greyed, with what will happen ("will be filed as
NPI-9944 / DWG") and an **Undo** button. A bar above the table counts the
changes not saved yet. They are saved, one after another, when you press
**Save changes**, when you move to another tab, sign out, switch vault or stop
the server. **Discard** drops them all. If you refresh the page they are kept;
if you close the tab with some pending the browser asks first. A file that
cannot be saved (for example because someone else already filed it) stays
marked in red with the reason.

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

- **Evidence vault path** — a folder name and a path relative to the app's
  install folder. **Browse…** (v11.1) opens a real folder picker — fenced to
  the same site the app runs from (a SharePoint/OneDrive folder synced to
  every PC); trying to save a location outside it is now rejected outright,
  not just discouraged, because a vault outside that tree would exist on
  this one PC only.
- **Product families / Change types / Document types** — master data. The
  Change / project types table scrolls horizontally on narrow windows
- **Users and passwords** (v12) — the roster (drives every owner dropdown) with
  each person's role, department and password status. **Add user** and **Issue /
  Reset password** both produce a temporary password shown once; removing a
  user deletes their password. The admin's own password is changed from the
  top-right menu, not reset here
- **Common vault folder structure** (v12) — the folder levels every upload is
  filed under, top level first (default: Model → DocType → PartID). Add, remove
  and reorder levels from the tokens `[Model] [Process] [ProjectID] [Step]
  [DocType] [PartID]`; the example tree updates as you go. Applies to new
  uploads only — files already in the vault are not moved
- **All vaults** (v12) — the common vault and every personal vault, with owner
  and folder; open or archive any of them
- **Project data in the vault** (v12.2) — what the vault itself holds: the
  register, step progress, documents, approvals and issues are stored in the
  vault folder (`_vault`), not in the app folder, and also written to
  **`Project_Information.xlsx`** in the vault folder — a read-only Excel copy
  anyone can open (**Open in Excel**; it is refreshed by itself a few seconds
  after anything changes, or press **Update now**). The same card shows each
  PC's journal and the settings last saved in the vault. **Replacing or
  deleting the app folder:** install the new version, sign in as admin, set
  Settings → Evidence vault location to the existing vault folder (Browse…) and
  restart; every project, step and document appears at once. Then use
  **Restore settings from the vault** (a banner offers it) to bring back the
  processes, document types and folder structure. User passwords are not kept
  in the vault — issue them again under Users and passwords
- **File version names** (v12.3) — a filed document is stored as
  `<standard name>_v1`, `_v2` … (for example `PRF_3026452_3026452_PRF_v2.doc`): the number goes up each
  time a different file is filed under the same name, and filing the identical file again just points to
  the existing one. Older versions of the app added a code like `_82a06cd1` instead. In **Project data in
  the vault → File names** the admin sees how many files still have such a code and can rename them to
  versions in one click (oldest first; the records follow the files; nothing is deleted)
- **Stop server** (v12.2) — the power button in the header stops the app's
  server on this PC after asking; it first saves any unsaved Input-tab choices.
  Start it again with the desktop icon
- **Moderators** — who may assign work and sign out of sequence
- **Templates** — blank company forms mapped to document types
- **Pillars** — the stage-gate processes. NPI and ECN come built in; **Add pillar**
  creates another (for example an equipment process) with its own steps,
  document types and name for the responsible person. It gets its own tab,
  dashboard matrix and Vault search at once. A pillar with projects cannot be
  deleted. Pillar IDs become the project-ID prefix and cannot be changed later.
- **File naming standard** (v11.1) — how an uploaded file is renamed before it
  is saved, edited without touching any code. Each rule is built from pieces
  in order: a **field** (document code, model, WVN/WNB code, description,
  project ID, part, date, time) or fixed **text**. Add, remove and reorder
  pieces with the buttons; the example line updates as you go. Which document
  codes a rule applies to is a checkbox list, not free typing (an "other /
  custom codes" box stays underneath for anything not in the shared
  catalogue); a rule can apply to specific codes only (e.g. drawings, which
  by default keep the old `PD<wvn>_01 <description>_<wnb>` shape), or to
  everything else via the one rule left unchecked. **Saving a rule offers to
  rename every already-filed document it now covers** to match — only the
  file name changes, never the content, revision history or folder; decline
  and it only applies to future uploads. Any single upload (the Input tab's
  batch form, or categorizing an uncategorized file) can skip the naming
  standard entirely with **keep the original file name**.

A change type still referenced by a project cannot be deleted.

---

## 9b. Personal vaults (v12)

A personal vault is your own small register, separate from NPI/ECN: your own
project fields, your own processes, steps and deadlines, your own document
types and folders. Only you and the admin can open it. It lives beside the
common vault, in `Personal_Vaults\<your name>\<vault name>`, so it syncs to
your other PCs the same way.

1. **Create:** on the vault list (after sign-in, or **Switch vault**), choose
   **New personal vault**, name it, and start from *Blank*, an example, or a
   filled Excel template.
2. **Vault setup** — five tabs:
   - *Project fields* — the boxes on your register form (Text, Number, Date,
     List, Yes/No; required or not; shown in the list or not).
   - *Processes and steps* — each step has a duration in days and the document
     types it expects. Deadlines are counted from a project's start date.
   - *Document types* — a short code and a name.
   - *Folder structure* — levels built from `[Project ID] [Process] [Step]
     [DocType]` and any `[field]` of yours; a preview shows the result.
   - *Excel template* — **Download template** gives a workbook with one sheet
     each for Fields, Processes, Steps, DocTypes and FolderStructure, filled
     with the current setup. Fill it in Excel and **import** it: you see a
     summary and any problems first, and nothing changes until you confirm.
   Changes are kept until you press **Save setup**.
3. **Projects** — **Register project** builds the form from your fields; pick a
   process and a start date and adjust any deadline. Click a project to set
   each step's status and deadline and to add files to each document slot.
4. **Steps and deadlines** — one bar per step for every project; red = late.

Removing a file from a project's list, deleting a project or archiving a vault
never deletes a file from disk.

---

## 10. Troubleshooting

| Symptom | Cause | Action |
|---|---|---|
| Sent back to the sign-in page | The app was restarted on this PC, or 12 idle hours passed | Sign in again |
| "No password has been issued for this account yet" | The admin has not issued your first password | Ask the admin: Settings → Users and passwords → Issue password |
| "This account is locked" | Five wrong passwords | Wait 5 minutes, or ask the admin for a reset |
| Admin password forgotten | — | Stop the app, delete `system\auth\u_admin_*.json`, start it: a new temporary admin password is written to `system\auth\ADMIN_FIRST_LOGIN.txt` |
| `offline` in the top bar | Server stopped, or port 8080 taken | Start it again from the desktop shortcut |
| No desktop shortcut, or it does nothing | First run never done on this PC, shortcut deleted, or the folder moved | Run `Open_WVN_NPI_Command_Center.cmd` once |
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
| `lb_deliverables.csv` | Filed documents with hashes and, since v11.1, a part / category |
| `lb_issues.csv` | Issues and resolutions |
| `lb_doc_comments.csv` | Notes |
| `lb_audit.csv` | Full audit trail: who, what, when, from → to |
| `lb_vault_ignored.csv` | v11.1 — vault files marked "not a deliverable", with who and why |

These are the record. Back up `system/tracking/` and the evidence vault on the
same schedule as any other quality record.

**Never hand-edit them.** Since v11 the app merges the base files with every
PC's journal; an edited file can be silently outvoted or flagged as a conflict.

---

*Prepared for WAHL Vietnam Early Product Management. Screens shown in the
accompanying deck are from v10; v11 adds the Document Vault tab, revision
history, the upload panel and Settings → Pillars; v11.1 adds BOM parts,
Settings → File naming standard (with retroactive rename), folder drop,
uncategorized-file auto-detection and a vault folder browser.*
