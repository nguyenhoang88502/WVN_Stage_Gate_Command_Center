# WAHL Vietnam — NPI & ECN Stage Gate

A local, no-install web app tracking the 7-step NPI process and the 12-step ECN process (with a PPAP
sub-section), driven entirely by `system\config.json` and written to by everyone who uses it on the
same network share. A companion app, the [Ticketing Center](../WVN_Ticketing_Center/README.md), shares
its tracking folder and handles inter-departmental document requests.

No Node.js, Python, internet connection, admin rights, or Excel automation is required. PowerShell's
`.NET HttpListener` serves the app on `http://localhost:8080` and answers a small JSON API.

---

## 1. Architecture

```text
<parent folder>/
├─ NPI_EPM_Documents_Control/         ← the document vault — evidence lives HERE, outside the app
│  └─ [DocType]/[Family]/[file]
└─ NPI_EPM_Stage_Gate/
   ├─ Open_WVN_NPI_Command_Center.cmd   ← the only file a stakeholder ever double-clicks
   └─ system/                            ← hidden application core
      ├─ launcher.ps1                    HttpListener backend + API
      ├─ index.html / styles.css / app.js  the frontend
      ├─ config.json                     families, change types, doc catalogue, NPI/ECN step models
      ├─ vendor/tabler/                  vendored Tabler UI (offline — no CDN)
      ├─ templates/                      blank company forms, offered for download in the UI
      ├─ tracking/                       lb_*.csv — the data this tool owns
      ├─ logs/                           launcher.log (+ crash-proof fallback logs)
      └─ Setup_SharePoint_Shortcut.ps1   optional: Desktop shortcut to the doc library
```

The legacy Excel bootstrap chain — `Run_OneTime_Migration.cmd`, `Find_Source_Workbooks.ps1`,
`Migrate-LegacyExcel.ps1`, `XlsxReader.ps1` — is **deprecated as of v3.1 and is no longer packaged**.
It still exists in the repository as historical tooling. See §2b.

The vault sits **beside** the app folder, not inside it (v2.1). Replacing or re-zipping the tool
therefore never touches a single filed document. Its location is resolved on every launch from
`deployment_defaults.evidence_vault_path`; if that path's parent no longer exists — a folder moved
between machines — the launcher falls back to the default sibling location and says so in the log.
Evidence filed under any earlier layout is migrated into the vault automatically on first launch, and
the stored paths in `lb_deliverables.csv` are rewritten to match. The vault has moved twice, so all
three locations are swept: `system\evidence\` (v2.0), `..\evidence\NPI_EPM_Documents_Control` (v2.1–v2.4)
and the current `..\NPI_EPM_Documents_Control` (v2.5). Files keep their existing sub-path — moving a
file is safe, rewriting a folder hierarchy underneath recorded paths is not.

> Upgrading in place from v2.4 or earlier: leave `evidence_vault_path` and `evidence_vault_root` blank
> in `config.json`. They are per-machine runtime state, and a populated `evidence_vault_path` that still
> matches the current install is honoured as-is — which would silently pin the vault to its old location.

`config.json` is **authored data**, not something scraped from a workbook. It holds the prod-family
(category) list — a project's own Family (its specific model code, e.g. 9649LP) is typed at
registration, not drawn from a config list — the change-type model (A–E), the document-type catalogue,
the full NPI (7-step) and ECN (12-step) models including which steps are signed milestones
(`gate_clearance_required`) and which need warehouse clearance (`warehouse_gate_required`), and the
trial-quantity presets. Everything in `system\tracking\*.csv` is written only through the app —
registrations, gate approvals, bypasses, issues, warehouse clearances, MWER records, PPAP tracking and
the audit log.

### What it deliberately does not do

- **It never reads or writes D365.** NPI/ECN work happens before D365 entry; you log that entry
  afterwards so the trail is complete.
- **It does not scan source workbooks or a SharePoint share.** Evidence existence is what gets filed
  through this tool — nothing is inferred from filenames elsewhere.
- It does not judge document *content* — it tracks whether a document was filed and who signed for it.

---

## 2. How to launch

1. Double-click `Open_WVN_NPI_Command_Center.cmd`. It unblocks the folder (in case it was downloaded
   as a zip) and starts `system\launcher.ps1` minimized.
2. The launcher opens your default browser to `http://localhost:8080/` once it is actually listening.
3. **First launch only**, if `config.json`'s `system_info.deployment_path` is empty, a native folder
   dialog asks where the tool lives — cancel it to accept the current folder. On every later launch the
   launcher re-derives its own location automatically and self-heals `deployment_path` if the folder was
   moved (e.g. copied to a different machine); you're never asked again.
4. Leave the minimized PowerShell window running — closing it stops the server. Multiple people on the
   same network can point their browser at the host machine's `http://<hostname>:8080/` at once.

If port 8080 is taken, the launcher tries 8081 and 8082 automatically and opens the browser to whichever
one it bound.

---

## 2a. Signing in, and vaults (v12)

The browser opens on `login.html`. Until someone signs in, every page redirects there and every
`/api/*` route except `/api/auth/*` and `/api/shutdown` answers `401`.

- **Accounts** are the roster in `config.json` → `user_registry` (Settings → *Users and passwords*).
  A person can sign in once the admin has issued them a password.
- **Passwords** are stored only as salted PBKDF2-HMAC-SHA256 hashes (100 000 rounds), one file per user
  in `system\auth\u_<name>_<tag>.json` — one file each so two people changing their password on two PCs
  never collide in the OneDrive sync. The folder is not in the app bundle and is git-ignored.
- **First start after upgrading:** the `admin` account is created with the old `admin_pin` as its
  password and must replace it at first sign-in; `admin_pin` is then removed from `config.json`. With no
  PIN to fall back on, a temporary admin password is written to `system\auth\ADMIN_FIRST_LOGIN.txt`.
- **Temporary passwords.** *Issue password* / *Reset password* / *Add user* each produce one, shown to
  the admin once. It only works for choosing a real password (≥ 8 characters).
- **Sessions** live in the launcher's memory (an `HttpOnly`, `SameSite=Strict` cookie). Each PC runs its
  own launcher, so a session belongs to that PC and ends when the launcher stops or after 12 idle hours.
  Five wrong passwords lock an account for 5 minutes on that PC.
- **The acting user is the session's user.** The server overwrites the `user` of every request body
  (and `audit.user` on `/api/action`) with it, so a request cannot claim to be someone else. `admin`
  rights are still "the user named `admin`", as before.
- **Optional: admin can view passwords** (Settings, off by default). A hash cannot be read back, so this
  keeps a second copy of each password encrypted to an RSA key whose private half is itself encrypted
  with the admin password. Viewing asks for the admin password again and is audited. Switching it off
  deletes the copies.

After signing in you choose a **vault**. The common vault (the evidence vault of §4, default) opens the
NPI/ECN app. A **personal vault** (`vault.html`) is a user's own register — own project fields, own
processes / steps / deadlines, own document types and folder levels, an Excel template to fill them in —
kept in `..\Personal_Vaults\<owner>\<vault>\` and visible to its owner and the admin only. It shares
nothing with `system\tracking`.

The admin also sets the **folder levels of the common vault** (Settings → *Common vault folder
structure*; default `[Model]\[DocType]\[PartID]`, tokens `[Model] [Process] [ProjectID] [Step]
[DocType] [PartID]`). A change applies to new uploads; existing files are not moved.

---

## 2b. The one-time import (`Run_OneTime_Migration.cmd`) — DEPRECATED (v3.1)

> **Do not run this.** The one-time import has already been done. `system\tracking\*.csv` is now the
> system of record, and re-importing would overwrite current records with stale workbook data. The
> script is excluded from packaged builds and now demands you type `RUNANYWAY` before it will do
> anything. It is kept in the repository only as historical tooling.
>
> **To add projects in bulk, use _Batch Project Registration_ on the Input tab** (§2c). It validates
> every row, reports per-row rejection reasons, and never overwrites an existing project.

The description below is retained for historical reference.

It:

1. finds the legacy trackers (Item master, Colorant/Packing status, ECN Log, Weekly NPI Meeting,
   FORM THEO DÕI NPI, Localization Drawing, DanhSachPhatTrienMauMoi, Work Tracking, NPI plan) in the
   thesis source folders and in any OneDrive root, and **copies** them to `system\tmp_staging\`;
2. reads the copies and writes `system\tracking\lb_projects.csv`, `lb_issues.csv`, `lb_d365.csv`
   and `lb_deliverables.csv`;
3. puts a shortcut to the SharePoint document library on your Desktop;
4. deletes the staging folder.

It refuses to run while the server is up, because writing the tracking CSVs underneath a live server
would race it. Copies are used rather than the originals so colleagues can keep the workbooks open in
Excel throughout.

**No Python and no Excel are involved.** `system\XlsxReader.ps1` opens each `.xlsx` as the zip of XML
it actually is and reads the cells directly — so the import works on a locked-down laptop with nothing
installed. Expect about 30 seconds for the full set; `NPI plan.xlsx` alone is 36 MB. Legacy `.xls`
(the pre-2007 binary format) cannot be read this way and is reported rather than silently skipped —
re-save such a file as `.xlsx` and run again.

Afterwards, read `system\logs\migration_report.txt` **before trusting the numbers.** It lists every
sheet parsed, every row skipped and why. Re-running is safe and idempotent: rows are merged on a
content key, never clobbered, and a second run adds nothing.

---

## 3. How writes stay safe with multiple users (v11)

**Deployment (v11):** one app folder inside a SharePoint document library, synced by the OneDrive
client to every user's PC. Each user runs the app from their own local replica. An exclusive file lock
therefore only protects against other processes on the *same* PC — two PCs rewriting the same CSV
between syncs would silently lose one side's rows. So since v11 **no file under `system\tracking\`
ever has two writers:**

| Path | Written by | Holds |
|---|---|---|
| `tracking\<store>.csv` | nobody while running (only `launcher.ps1 -Backfill -Apply`) | the base snapshot — everything written before v11 |
| `tracking\journal\<PC>_<user>\<store>.csv` | only that PC + Windows user's instance | an append-only log of row *versions* |
| `tracking\journal\BASE_SEALED.txt` | the first v11 launch | when the base snapshot was sealed |

Every read merges the base with every journal — and with any OneDrive conflict copy
(`lb_x-PCNAME.csv`), so even a conflict loses nothing. Versions are applied per record in time order;
each version sets only the fields that changed, so two people editing different fields of one record
both keep their change, and on the same field the later edit wins. Record IDs carry a per-PC tag
(`DEL-0082-3FA`) so two PCs never mint the same one; a record created by an upsert (a gate row, a claim)
gets an ID derived from its natural key, so two PCs creating "the same" row offline merge instead of
duplicating. Paths to vault files are stored vault-relative and resolved on each PC, and stored file
names end in the first 8 hex of their SHA-256 so two PCs can never collide on a name.

Nothing is written to `config.json` at startup any more (the deployment path and vault location are
worked out per PC at runtime). Each PC writes its own log, `system\logs\launcher_<PC>_<user>.log`.
Anything unusual — a conflict copy, a base file written after the seal (i.e. a PC still running an
older version), a `config-*.json` conflict copy from two admins saving at once — is logged and returned
by `/api/data` as a storage warning.

**Every PC must run v11.** An older version writes the base files directly and does not read the
journals: its users would see stale data and could overwrite base rows. The app flags this (see above)
but cannot prevent it — restart every PC's app after the upgrade.

Writes are still short, locked and retried (`config.file_system_resilience`; the journal path uses 8
retries with jitter because OneDrive briefly holds files while uploading them). If a write still fails
the request returns an error instead of crashing the listener.

**Do not keep `system\tracking\*.csv` open for editing in Excel while the app is running** — Excel's
write lock will make that one file's saves fail until you close it. Opening a file read-only to look at
it is fine.

---

## 4. Filing evidence

Input → **B. File evidence**: drop **as many files as you like at once**. Each gets a row in a confirm
table with its document type and step already guessed from the filename, and a preview of the name it
will be saved under. Check the rows, fix what the guess got wrong, tick *Skip* on anything that should
not go in, then **File all**. Nothing is uploaded until you click it.

The guess scores each catalogue entry against the filename — an exact form code (`QA-F-GEN-0010`) or
doctype id is near-certain, matching words from the document's name are weaker. A row whose guess is
weak is labelled **guess uncertain** rather than quietly pretending to be sure. The step comes from the
first workflow step that actually demands that document, unless the filename says otherwise (`step 4`,
`s4`).

Since v2.5 an uncertain guess is left **blank** instead of pre-filled, and **File all** refuses to run
while any row it would file still has no document type or step — it names the offending files. A wrong
guess presented as a decision is worse than no guess: it gets clicked through. Choosing a step first also
re-sorts the document list so that step's required documents come first (★) and its applicable ones next
(◦); everything else stays selectable, because filing an unexpected document against a step is legitimate
and must not be made impossible. Your project selection is never reset by a redraw.

Files land under:

```
..\NPI_EPM_Documents_Control\[Document type]\[Family]\[filename]
```

A byte-identical file already filed there is skipped (no duplicate written); a same-name file with
different content is filed alongside with a timestamp suffix rather than overwritten. The 25 MB per-file
limit is an MVP guard, not a hard architectural ceiling.

### Citing a document instead of copying it

Some documents cannot be copied — a controlled master on the DESIGN share, a SharePoint page. The
**Or cite a network path / link** box records a UNC path or URL as a deliverable: the gate counts it
as filed, nothing is copied, and the row is marked `Cited` with no SHA-256. That trade-off is the
point — you get the visibility without duplicating a controlled master, but you lose the ability to
prove later that the file has not changed since.

### Blank form templates

The same panel has a **Download blank template** picker serving the 15 company masters staged in
`system\templates\` — Production Trial Request, ECR, Deviation Request, 4M Change Evaluation, 8D/CAPA,
Control Plan, Supplier PPAP PSW, First Trial Report, Meeting Minute, NCR, IQC and OQC inspection forms,
calibration records and the Unplanned Material Request. `GET /api/templates/<name>` serves them by plain
file name only — any path component is stripped before the filesystem is touched, so the endpoint cannot
be walked out of that folder. Drop a new master into `system\templates\` and it appears in the picker
on the next page load; nothing else needs configuring.

---

## 4b. Standardised file names

The **server** renames every uploaded file, so the convention survives someone dragging in
`final FINAL v3 (2).xlsx`:

| Document | Pattern | Example |
|---|---|---|
| `DWG` | `PD[WVN]_01 [Description]_[WNB].[ext]` | `PD1010523_01 Motor with PCBA_3025015.pdf` |
| everything else | `[DocType]_[Model]_[WVN]_[WNB]_[Description].[ext]` | `PFMEA_CL-CORDLESS_1010523_3025015_Process_FMEA_Report.xlsx` |

Drawings keep their spaces because that is how Design actually files them; everything else uses
underscores. Characters Windows rejects become `_`, runs of separators collapse, and the extension is
forced to lowercase. Empty segments disappear rather than leaving `PFMEA___name.xlsx` behind — a file
with no WVN or WNB code still gets a sane name. If you give no description, the original filename stem
is used, minus the form code it was matched on (so `QA-F-GEN-0010-02 Production Trial request.xlsx`
becomes `QA-F-GEN-0010_..._Production_Trial_request.xlsx`, not `..._QA_F_GEN_0010_02_...`).

The original filename is kept in `lb_deliverables.original_name`, so the rename is never a one-way door.

## 4c. Notes, paths and the transfer package

- **Copy path** next to every filed document puts its full path — or the cited UNC/URL — on the
  clipboard, ready to paste into Explorer or an email.
- **Notes (n)** opens the per-document comment thread (`lb_doc_comments`): read what colleagues flagged,
  add your own. Every note carries an author and a UTC timestamp and is written to the audit log.
- **Download transfer package** on the NPI and ECN tabs zips every document filed against that project,
  grouped into a folder per step, with a `_MANIFEST.txt` listing document type, filer, approval state
  and SHA-256 for each. Cited links appear in the manifest as `[link] …` since there is no file to
  include. It works on an incomplete project deliberately — handing over what exists today is the
  point — and the manifest says in as many words that it is a snapshot, not a certificate of
  completeness. A deliverable whose file has gone missing from disk is listed as
  `*** FILE NOT FOUND` rather than silently omitted.

## 5. Registering a project, and the A–E change types

Registration asks for two things that decide everything downstream:

- **Family ID** — free text (`9649LP`, `5612`). It *becomes* the project ID: `NPI-9649LP`, `ECN-5612`.
  Illegal filename characters are stripped, and a second project on the same model gets `-2`, `-3` …
  appended. The uniqueness check happens inside the same file lock as the insert, so two people
  registering the same model at the same moment cannot collide.
- **Change / project type** — mandatory, one of five:

| Type | Change | Cycle time | NPI steps it runs |
|---|---|---|---|
| A | Packaging-only (box, card, printing) | **TBD** — not yet baselined | 1, 5, 6, 7 |
| B | Blister card change only | 178 d | 1, 5, 6, 7 |
| C | Housing unit change only | 103 d | all 7 |
| D | Housing surface change only | 108 d | 1, 3, 4, 5, 6, 7 |
| E | New product development (seed develop) | 210 d | all 7 |

The type sets the **target finish date** (request date + cycle time) and prunes the workflow to the
steps that genuinely apply — a packaging-only change never sees mould making. Steps that do not apply
are named explicitly at the top of the tab rather than silently disappearing. Type A produces no target
date at all, because its cycle time has never been measured; that is stated in the UI rather than
guessed at. All twelve ECN steps apply to every type.

> The 178-day figure for Type B is longer than Type C (103) and D (108) despite being a simpler change.
> It is carried through from the existing Class ABCDE tracker and is flagged as suspect in
> `config.json`; it should be re-measured from raw project data before anyone commits a date on it.

**Typing a model code fills in the rest (v2.5).** Entering a known Family code (e.g. `9649`) fills the
prod family and change type automatically — if you have not already set them yourself. Once you type into
either box it is yours and no auto-fill overwrites it.

**Target finish date can be overridden (v2.5).** Leave the override blank and the date is calculated —
that is the normal case, and a blank box is how you can still tell a calculated date from a decided one.
Fill it in when this project's schedule genuinely differs. The calculation is done **server-side**, so
the stored date is authoritative no matter what the browser sends: change type's `cycle_time_days` first,
then the prod family's `typical_lead_time_days`, then empty. Empty stays a legitimate answer — Type A
has no baselined cycle time and gets no invented date. Once stored, a target date is never recalculated
on redraw.

**The pickers accept typed text (v2.5).** Family, prod family and document type are comboboxes: pick a
suggestion or type your own. A new family code or a document code that is not in the catalogue yet passes
through exactly as typed — the gate simply will not recognise it, which is correct, not an error. Steps
are the one exception: they are a closed set, so a typed step must resolve to a real step of that project
or it is rejected with a message rather than filed against the wrong gate.

## 5b. Managing prod families and document types

Use the **Settings** tab — nobody needs to hand-edit `config.json`. Adding or deleting a family or
document type there writes straight back to `config.json` and takes effect for every connected user
immediately. Deleting a family or document type does not touch projects or deliverables already
recorded against it; it only removes it from future dropdowns. Document types carry a `stage_required`
label; it is documentation, not enforcement — what actually gates a step is that step's
`required_evidence_doctypes` list.

Change types are shown in Settings but are deliberately **not** editable from the UI: changing a cycle
time silently re-dates every project using it, which is a config-file decision, not a click.

---

## 5c. The executive dashboard

The **Dashboard** tab is a grid: one row per project, one column per step, for NPI and ECN separately.
Each cell names the documents behind its colour, so nobody has to take "green" on trust:

| Badge | Means |
|---|---|
| `Done: PRF, GANTT` | a named person signed the gate; these documents are accepted |
| `Filed: DWG` | the document is in, but nobody has signed for it |
| `Missing: PFMEA, BOM` | the step requires it and nothing has been filed |
| `not started` | nothing has happened here yet |
| `bypassed` | the gate was passed on an authorised bypass, not on evidence |
| `n/a for type A` | the project's change type does not run this step |

The **PIC** column is built by cross-referencing deliverables and approvals, so it reads
`Hoang (PRF, QUOTE, GANTT) · Design Nam (DWG)` — who did what, not just who is nominally responsible.

Clicking any cell opens the **inspection drawer**: every document filed at that step with its full
path and SHA-256, the per-document comment threads, what is still missing, the who-did-what breakdown,
any open issues and tickets against the step, and an **Executive note** box. A note is written to the
audit log against that project and step. It deliberately does **not** change the gate status — it
records a decision and its reasoning, which is a different thing from making one.

## 5d. The issue tracker

The **Issue tracker** tab keeps an issue log whose attachments live in a SharePoint (or any synced
network) folder. On first use it asks for that folder with the native Windows dialog and remembers it.

Two things to be clear about:

- **This tool does not talk to SharePoint's API.** It reads and writes a folder on disk — which is
  what the synced SharePoint/OneDrive client gives you. If the folder is not synced, nothing you file
  here reaches anyone else.
- **The folder dialog opens on the machine running the launcher**, not in your browser. If you are
  connected from another PC, someone at the host machine has to answer it. That is a consequence of
  the dialog being a native Windows control, not a web one.

Each issue carries an owner department and PIC, a due date (shown in red once passed), an action/
remarks trail and a timestamped last-message line. Updating an issue records who said what and when.

## 6. How gate status is decided

| Evidence level | Meaning |
|---|---|
| `MISSING` | Nothing has been filed against this document type at this step |
| `FILED`   | Filed here — **nobody has signed for it yet** |
| `APPROVED`| Filed here and signed |

Documents listed as **if applicable** rather than **required** are tracked but never block a gate —
these are documents no source SOP actually mandates on every project (see §12).

**NPI** — every one of the 7 steps is a strict gate: it can be approved only when every required
document is at least `FILED`, no issue is open against the step, warehouse clearance is complete where
required (step 5), **and every earlier applicable gate is closed**. Gates run in order (v2.1) — you
cannot sign step 4 while step 2 is still open.

**Bypass** — the only way past a gate you cannot legitimately close. From v2.1 a bypass marks the step
complete *for the purposes of the steps after it*, so the project is not deadlocked; the justification,
the mitigation and the person who authorised it stay on the card in red, stay in `lb_bypasses.csv`, and
stay in the audit log. It clears the road, it does not erase the debt.

**ECN** — only the steps flagged `gate_clearance_required: true` in `config.json` (steps 4, 11 and 12)
are signed milestones; the rest are tracked with a simple status. Step 4 carries the MWER approval
record (the morning-meeting or Zoom-call summary email *is* the evidence at Wahl); step 11 carries the
trial-quantity configurator. **Warehouse readiness is a mandatory gate before step 11, Trial Production
Execution** — the ECN procedure is the document that actually mandates clearing old stock.

---

## 7. Trial quantities

`config.trial_quantity_presets` defines three tiers (Simple / Medium / Very Complex); picking one fills
the three batch sizes in. Overriding them requires a written justification, which is recorded in the
audit log alongside who changed it and when.

---

## 8. Warehouse readiness

Five areas are tracked: Assembly, Blade, Molding (material), Mold storage, Fixture storage. Until all
five are cleared for a given project/step, the step cannot be approved. Which steps need it is driven by
`warehouse_gate_required` in `config.json`: **NPI step 5**, and **ECN steps 9, 11 and 12**.

---

## 9. API (for reference / scripting)

Since v12 every route below needs a signed-in session (cookie `wvn_sid`); the `user` in a request body
is replaced by the session's user.

| Method & path | Purpose |
|---|---|
| `GET /api/auth/status` | Open. `{ authenticated, user, role, must_change, app }` |
| `POST /api/auth/login` | Open. `{ username, password }` → sets the session cookie |
| `POST /api/auth/logout` | Ends the session |
| `POST /api/auth/change-password` | `{ current, new }` — own password; the only call a temporary-password session may make |
| `GET /api/auth/users` | Admin. Roster with password status (never the password) |
| `POST /api/auth/reset-password` | Admin. `{ username }` → `{ temp_password }`, shown once |
| `POST /api/auth/recovery` | Admin. `{ enable, admin_password }` — "admin can view passwords" on/off |
| `POST /api/auth/reveal` | Admin, only while that is on. `{ username, admin_password }` → the password; audited |
| `POST /api/config/folder-structure` | Admin. `{ levels: [...] }` — folder levels of the common vault |
| `GET /api/vaults` | The common vault plus the personal vaults the caller may open |
| `POST /api/vaults` | `{ name, config }` — create a personal vault |
| `GET /api/vaults/<id>` | One personal vault: setup + projects |
| `POST /api/vaults/<id>/config` | Replace its setup (fields, processes, doctypes, folder) |
| `POST /api/vaults/<id>/projects` | Register a project; deadlines are computed from the step durations |
| `POST /api/vaults/<id>/project-update` · `project-delete` | Edit values / step status / deadlines; remove from the register |
| `POST /api/vaults/<id>/upload` · `unfile` · `GET …/file?path=` | File a document into a step's slot, take it off the list, open it |
| `POST /api/vaults/<id>/archive` · `open` | Hide/restore the vault; open its folder in Explorer |
| `GET /api/data` | Full snapshot: `{ config, tracking, paths, session, folder_levels }` — everything the frontend needs on load |
| `GET /api/config` | `config.json` only |
| `POST /api/config/family` | `{ op: 'add'\|'delete', family, family_id, user }` |
| `POST /api/config/doctype` | `{ op: 'add'\|'delete', doctype, doctype_id, user }` |
| `GET /api/templates` | Lists the blank forms staged in `system\templates\` |
| `GET /api/templates/<name>` | Streams one blank form as a download (file name only, no paths) |
| `POST /api/projects` | Register a project — server derives `project_id` as `NPI-<FamilyID>` / `ECN-<FamilyID>` |
| `POST /api/action` | `{ store, row, upsertKeys?, audit? }` — generic insert/upsert into any `lb_*` store |
| `POST /api/upload` | `{ docType, family, wvnId, wnbId, description, fileName, contentBase64 }` — files evidence under its standardised name |
| `POST /api/filename/preview` | Same fields minus the content — returns the name a file *would* get |
| `GET /api/package/<project_id>` | Zips every document filed against a project, plus a manifest |
| `POST /api/sharepoint/folder` | Opens the native folder dialog **on the host machine** and stores the choice |
| `GET /api/sharepoint/files` | Lists what is in that folder, and whether it is reachable at all |
| `POST /api/sharepoint/upload` | Saves an issue attachment into it (same-name files are not overwritten) |

---

## 10. Troubleshooting

| Symptom | Cause | Action |
|---|---|---|
| CMD window flashes and closes | Folder was downloaded and Windows is blocking it | `Get-ChildItem -Path "<folder>" -Recurse \| Unblock-File` |
| Browser can't reach `localhost:8080` | Launcher didn't start, or a firewall prompt is waiting | Check `system\logs\launcher.log`; allow PowerShell through the firewall if prompted |
| "Could not reach the local server" in the page | The PowerShell window was closed | Relaunch the CMD file |
| Approve button stays disabled | Missing evidence, an open issue, warehouse not cleared, or an earlier gate still open | Hover it — the tooltip says which |
| A step you expected is not listed | The project's change type excludes it | The banner at the top of the tab names every excluded step and why |
| Evidence filed before v2.1 seems to have vanished | It was migrated out of `system\evidence\` | Look in `..\NPI_EPM_Documents_Control\`; the move is logged in `launcher.log` |
| A save intermittently fails under heavy simultaneous use | File lock exhausted all 3 retries | Retry the click — the record was never partially written |
| Copy path says "Copy failed" | Browser blocked clipboard access outside a secure context | The path is in the button's tooltip — hover and copy it by hand |
| A batch row guessed the wrong document type | The filename carried no form code | Override it in the row; the guess is a starting point, never a decision |
| Transfer package smaller than expected | Some deliverables are cited links, not copied files | Check `_MANIFEST.txt` — links are listed but cannot be zipped |
| Clicked *Choose folder…* and nothing happened | The dialog opened on the host machine, not yours | Ask whoever is at that machine to answer it |
| SharePoint folder shows "not reachable" | The share is offline, or the path was set on another machine | Click *Change folder…* and pick it again |
| Dashboard cell says `n/a for type A` | That step does not apply to the project's change type | Working as intended — see §5 |

---

## 11. Honest limits

### Known gaps (v12 sign-in and vaults)

- **The sign-in guards the app, not the folder.** The app folder is synced to every PC, so anyone with
  access to it can still read or edit `config.json`, the tracking CSVs and the vault files directly, or
  run a modified launcher. What the hashing does guarantee is that the passwords themselves cannot be
  read from the files.
- **Sessions and lockouts are per PC**, because each PC runs its own launcher. Signing out on one PC does
  not sign you out on another, and the five-tries lock counts tries on one PC only.
- **Removing a user** takes effect on other PCs when the changed `config.json` has synced to them.
- **Identity is enforced for `user` and `audit.user` only.** A row written through `/api/action` still
  carries whatever `uploaded_by` / `approved_by` / `claimed_by` the browser put in it — task assignment
  legitimately names other people — so those columns remain as trustworthy as before v12.
- **Changing the common vault folder structure does not move existing files**, and there is no bulk
  re-file. Old and new layouts coexist; every stored path stays valid.
- **Personal vaults have no revision history, approvals or audit store** — only a per-PC activity log
  (`_vault\activity_<PC>.log`). Two PCs editing the same personal vault inside one sync window can
  produce a OneDrive conflict copy of `projects.json`; the common vault's journal storage is not used.
- **The pre-v12 Playwright specs** (`tests\*.spec.js`) still drive the removed header name picker and
  have not been ported; the suites under `tests\storage`, `tests\v11`, `tests\v11_1` and `tests\v12` have.

### Known gaps (v11)

- **Sync latency.** Another user's change appears after OneDrive syncs it (usually seconds, longer on a
  slow or offline laptop) plus the 15 s auto-reload. Nothing is lost while a PC is offline; it just
  arrives late.
- **Clock-based ordering.** Concurrent edits of the *same field* resolve by the writing PC's clock
  (bumped past the version it was edited on top of). PCs on the company domain keep time within
  seconds; a PC with a wildly wrong clock can win or lose a same-field race it should not.
- **Same family, two PCs, same moment.** Two users registering the same process + family while offline
  from each other produce one merged project, not `-2` — both meant the same product.
- **Scale.** Every read still merges the full stores (parsed files are cached, so a 15 s poll only
  re-parses what changed). Partitioning `lb_deliverables` and a startup index are deferred; the
  `/api/document-history`, `/api/deliverables/batch` and `/api/vault/search` contracts are what they
  will sit behind.
- **Revision order** is the order rows were written (which is what "last row wins" always used), not
  the uploader's clock.
- **Stale approvals** flag signed gates only; a bypassed gate is not re-flagged when a document is
  revised later.
- **Pillars:** the stage-completion cards serve one pillar (the one flagged `stage_completion`), and
  PPAP is a single-project checklist per pillar. Change types restrict steps per pillar through
  `steps_by_process`; without it a pillar runs all its steps for every type.
- **Pre-v11 data** keeps absolute vault paths; they are re-rooted on each PC by folder name. Five cells
  in the existing tracking data (three Vietnamese upload file names, two audit notes) still carry
  mojibake from the pre-v11 request-decoding bug — they are left as recorded history.
- **"Categorize" never renames or moves a file (v11.1).** A stray file adopted from the "Uncategorized
  files" card is registered exactly where it sits; it does not get the standard naming convention
  applied. Use New revision afterwards if it should be re-filed properly.
- **A document's "required" status is still doc_code-level, not part-level (v11.1).** Filing one part
  of a multi-part document satisfies the requirement; there is no way to declare "this document needs
  exactly these 5 parts" and be warned if one is missing.
- **Naming rules cannot express a condition** (v11.1) — e.g. "use the drawing shape only when a WVN
  code is present, otherwise fall back to the generic one," which the old hard-coded DWG shape did. A
  DWG filed with no WVN code now just gets an empty WVN segment rather than the generic shape.

- Evidence presence is exactly what has been filed through this tool — there is no scan of any shared
  drive, so a document that exists elsewhere but was never uploaded here shows as `MISSING`.
- Gate status here is not an official stage-gate sign-off and does not replace the QA-SOP-NPI route.
- Multi-user *writes* are safe (locked, retried, never partially applied); the UI itself does not push
  live updates between open browser tabs — reload to see another user's changes.
- A **cited link** proves a document was pointed at, not that it still says what it said. There is no
  hash and no copy; if someone edits or deletes the target, this tool will not notice.
- The batch filename guesser is a typing-saver, not a classifier. It is wrong often enough that the
  confirm table exists, and it never files anything without a human clicking **File all**.
- The issue tracker is a folder on disk, not a SharePoint integration. Nothing syncs unless the
  SharePoint/OneDrive client is already syncing that folder.
- The dashboard reflects what has been filed *through this tool*. A step can be genuinely complete in
  reality and still show red here.

---

## 12. Where the workflow model comes from

The step models were re-derived on 2026-08-03 directly from `QA-SOP-NPI-0001-05`, `QA-SOP-NPI-0002-03`
and the Aug-2025 RACI matrix. The full write-up, with per-claim citations, is at
`04_Analysis\Current_State\Workflow_Rationalization\NPI_ECN_Workflow_Rationalized.md`. What it changed
here:

| Finding | Change made |
|---|---|
| ECN step 6 — the SOP says the implementation plan is *created* and kicked off, never *approved* | Gate removed; step 6 is now tracked, not signed |
| `DESIGN-CHK` is named in no SOP or RACI row — it appears only in the 9649 case study | Demoted to *if applicable* at NPI step 1 |
| PPAP is customer-driven ("on advice from Ningbo"), 8D-CAPA applies only when a trial fails | Both demoted to *if applicable* at NPI step 6 |
| The 7-step NPI model comes from the EPM pillar decks, not from the NPI SOP | Recorded in `npi_workflow.source_note` |
| ECN step 3 is not a distinct SOP row — the 5M evaluation sits inside row 2 | Kept (the team works it that way) but flagged in `source_note` |
| Warehouse clearance is mandated by the **ECN** procedure, not the NPI SOP | NPI step 5's gate kept as WVN practice, flagged as such |
| The Simple/Medium/Very Complex trial presets sit *below* both SOP baselines | Both SOP baselines recorded in `trial_quantity_presets.sop_baselines` |
| The AA/A/B/C ladder is an external Tarkett benchmark, not a Wahl scheme | Relabelled; A–E is the live scheme |

Steps carrying a `source_note` display it on the card, so anyone approving a gate can see how solid the
requirement behind it actually is.

Two of its recommendations were **not** applied, because they conflict with an explicit instruction:
keeping `RACI`/`NDA` as step-1 evidence (both were ordered removed from the catalogue), and re-measuring
the Type B cycle time (fixed at 178 days by spec — flagged instead).

---

**All readiness indications are advisory until confirmed by the responsible engineering and quality
teams.**

---

## 13. Version history

Versions v3.6 – v10 are recorded in `git log` (commit subjects start `vX:`) and were not re-listed here.

### v12.0.0 (2026-10-13)

**Sign-in, hashed passwords, personal vaults, admin-set folder structure.**

- **Login page and sessions** — `login.html`; identity comes from a server-side session instead of the
  header name picker, and the server stamps it on every request (§2a). The plain-text `admin_pin` and
  its two endpoints are gone; the admin signs in with a password like everyone else.
- **Users and passwords** in Settings replaces *User Registry* and *Admin Security PIN*: password
  status per user, issue / reset to a one-time temporary password, optional "admin can view".
- **Vault chooser at sign-in**, with the common vault as the default, and **personal vaults**
  (`vault.html` / `vault.js`): own fields, processes, steps and deadlines, document types, folder levels
  and an `.xlsx` template written and read in the browser with no library.
- **Common vault folder structure** is a Settings card instead of a constant in `Save-Evidence`; the
  uncategorized-file guess reads the configured levels.
- Found while testing it: `HttpListenerRequest.QueryString` decodes with the request's content encoding,
  which a GET does not have, so a Vietnamese value in a query string arrived as mojibake and matched
  nothing. Every route now decodes the raw query as UTF-8 (`Get-QueryValue`) — which also fixes Vault
  search and document history for Vietnamese search words and part names.
- Tests: `tests\v12\api_auth_vaults.js` (server) and `tests\v12\e2e_login_vaults.js` (through the pages);
  the v11 suites sign in through `tests\lib\session.js`.

### v11.0.0 (2026-09-18)

**Sync-safe storage, revision history, bulk upload, Document Vault, pillars.**

- **Storage for a OneDrive-synced deployment** — per-PC append-only journals merged on read (see §3).
  Found while testing it: PowerShell's `[Array]::Sort(keys, items, comparer)` sorts a *converted copy*
  of `items` and throws it away, so the obvious merge implementation applied versions in file order.
- **Revision history (R1)** — every file, path or link filed against a document is a revision;
  `revision_no`, `is_active` and `superseded_utc` are derived on every read (exactly one active
  revision per document by construction); `change_reason` is recorded. Drawer rows show the active
  revision with **History** and **New revision** (reason required). A signed gate whose required
  document was revised after the signature shows **approval stale** in the drawer, matrices, Gantt
  tooltips, the PDF package and a new *Stale Approvals* column in the transfer XLSX — the approval
  itself is never edited. `GET /api/document-history`. One-time `launcher.ps1 -Backfill [-Apply]`
  writes the derived values into the base CSV (dry run by default, backs up first). The transfer ZIP
  now contains only evidence rows (claim markers used to be listed as FILE NOT FOUND) with superseded
  revisions in `<step>\_superseded`.
- **Bulk upload (R2)** — one upload queue for every evidence upload: files one at a time with retry,
  rows in chunks of 20 through `POST /api/deliverables/batch` (idempotent against the active
  revision), row-only retry when a file saved but its row did not, a per-file status panel.
  `GET /api/vault/orphans` lists vault files no row points at. 105 files: ~6 s, zero orphans.
- **Document Vault tab (R3)** — one row per document across every project and pillar, active revision
  inline; filters for pillar, family, doc type, PIC, department, date range, status, stale-only and
  free text; server-side paging via `GET /api/vault/search`; History and New revision from any row.
- **Pillars (R4)** — `config.json` `pillars[]`: NPI and ECN are the first two entries and reference
  their existing `npi_workflow` / `ecn_workflow` definitions. A new pillar needs only config (its own
  steps, document types, responsible-person label, gate mode, feature flags) or the new **Settings →
  Pillars** editor; it gets a tab, registration, dashboard matrix, Gantt rows, revision history and
  Vault search. Project IDs are `<process_id>-<family>`; registration validates the process.
- **Fixed on the way:** request bodies were decoded as cp1252 when no charset was sent (which the app
  never sent), storing every non-ASCII character as mojibake and re-mangling `config.json` on each
  Settings save — 11 config strings repaired; `Package-App.ps1` read `config.json` as ANSI; the
  dashboard slicers and the drawer's project search only knew NPI projects.
- Tests: `tests\storage\test_storage.ps1` (two simulated PCs, 32 checks), `tests\v11\e2e_r1r2.js`
  (16), `tests\v11\e2e_r3r4.js` (32); the existing Playwright suite (51) passes unchanged.

### v11.1.0 (2026-09-19)

**Parts, a no-code naming standard, folder drop, uncategorized-file detection, an accurate Vault status.**

- **A document can have more than one active file at once (`part_id`)** — appended to
  `lb_deliverables`. `Set-DerivedRevisions` and `Get-VaultIndex` group by
  `project + step + doc_code + part_id`, not just `doc_code`, so filing a drawing per BOM part under
  one document type no longer supersedes every part but the last one — the exact failure this fixed.
  Dropping **more than one file at once files ALL of them as independently active by default** — each
  gets a part derived from its own file name ("Bracket.pdf" → part "Bracket") rather than needing a
  prompt; a single file dropped alone is unaffected (blank part, same as before v11.1). A wrong guess
  is fixed afterwards with one click on the part badge (**renamePart** — renames the WHOLE history of
  that part, not just the active revision, so a superseded file never reappears "active" under its old
  label). "+ Add part" and the Input tab's batch table still ask per file, for when the default guess
  needs a real answer instead. History, New revision and the Vault are all part-scoped.
- **File naming standard, editable with no code** — `config.json` `naming.rules[]`: an ordered list of
  rules (first whose document-code list matches wins; a blank list is the default), each an ordered
  list of *segments* — a field (document code, model, WVN/WNB, description, project ID, part, date,
  time) or literal text — built with a checkbox list of known document codes (not free typing) and
  previewed live in **Settings → File naming standard**. Shipped seeded with the exact pre-v11.1
  hard-coded shapes (default + DWG), so upgrading changes no file name until an admin edits it.
  Saving a rule offers to **rename every already-filed document it now covers** to match
  (`GET`/`POST /api/config/naming/apply`) — resolved fresh against the current rule list, so editing
  the one default rule never touches a document a more specific rule still owns. Any single upload can
  opt out of the naming standard entirely with **keep the original file name** (the Input tab's batch
  form, and orphan categorizing) — still content-addressed, so dedup is unaffected.
- **Folder drop** — dropping a folder (Input tab, or a drawer dropzone) expands to every file inside it
  via `webkitGetAsEntry`; if the folder's own name matches a registered project (by project_id or
  family, ignoring case/punctuation), that project is pre-selected. The Input tab's project field is
  now a searchable combobox as well as a picker.
- **Uncategorized vault files, surfaced and auto-detected** — `GET /api/vault/orphans` (built in R2,
  never wired to the UI) now also reports each file's Windows owner, creation time, SHA-256 and — when
  the file already sits in the app's own folder pattern (`[Family]\[DocType]\[Part]\file`) — a guessed
  project/document/part (`Get-OrphanGuess`), excludes anything recorded in the new append-only
  `lb_vault_ignored` store. The Input tab's "Uncategorized files" card shows the guess plainly and a
  one-click **Confirm** (also renames it to the current naming standard) next to **Adjust** (opens the
  full picker, pre-filled) and **Not a deliverable**. `POST /api/vault/orphans/adopt` does the actual
  registering, with **standardize the name** (rename) as an explicit, opt-out checkbox — unchecked
  keeps the file's original name and location exactly as found.
- **Document Vault status fixed** — it read either `Active` or `Removed` regardless of whether anyone
  had actually signed off; now `Filed` / `Approved` (the step's gate is signed or bypassed) / `Removed`,
  the same promotion rule the dashboard already used. Vault rows also show the part badge.
- **Evidence vault location gets a real folder browser** — `GET /api/browse-folders`, fenced to the
  app's own site (its parent folder) — the same boundary `POST /api/config/vault` now actually
  enforces server-side (it used to accept any text at all, silently allowing a vault outside the
  synced folder that only that one PC could see).
- **A real bug, not a missing feature:** `redrawAfterWrite()` — called after nearly every write in the
  app — rebuilt the current view unconditionally, discarding anything typed but not yet submitted in
  an unrelated field on the same page. Now goes through the same capture/restore the 15 s auto-reload
  already used.
- Tests: `tests\v11_1\e2e_parts_naming_vault.js` (31 checks); `tests\storage\test_storage.ps1` (32),
  `tests\v11\e2e_r1r2.js` (16) and `tests\v11\e2e_r3r4.js` (32) pass unchanged.

### v3.5.0 (2026-08-06)

**The model-centric pivot.** Projects are tracked strictly by Model ID / Family ID now — FG
tracking is retired. Registration no longer asks for an FG number, it no longer forms part of
the project ID, and it is gone from the batch CSV template, search and every display surface.
The `fg_id` column stays in `lb_projects.csv` untouched for backward compatibility with rows
already on disk; evidence filing already collapsed a blank FG level in its folder path, so
nothing downstream needed to change. Legacy filename-based family detection (`sample_fg_ids`)
is untouched — that is historical-document classification, not project tracking.

The Dashboard's Family / Year / Week filters now reach the Stage Matrix itself, not just the
stage-completion cards below it — the primary workspace can finally be filtered.

### v3.4.0 (2026-08-06)

The NPI and ECN stage matrices are now the primary Dashboard workspace rather than a collapsed
panel — each row carries the PIC, a progress bar and the target week, and every cell shows an
issue badge with a count. Stages, deliverables and issues can be claimed directly from the
inspection drawer, and a **Claimed Work** tab lists what the active user owns, overdue first.
Model-specific custom documents can be made required for one project and step without editing
`config.json`. **Download Management Report** exports a Gantt schedule, portfolio-level KPIs and
a stage-matrix summary, replacing the raw CSV dump. Settings is fully mutable — product families,
document types, issue headers and change types can all be edited from the UI, and blank form
templates can be uploaded. The Input tab's warehouse-readiness and D365 summary cards, and the
SharePoint folder integration, have been retired; the issue tracker now defaults to open issues
and includes a search box.
