<#
.SYNOPSIS
    Generate the WAHL NPI/ECN Stage Gate demo dataset in pure PowerShell 5.1.

.DESCRIPTION
    Zero-dependency replacement for sample_data/generate_sample_data.py.

    Writes a complete, internally consistent set of 15 tracking CSVs plus the
    batch-import demo CSV. "Internally consistent" is the whole point: the
    dashboard derives every status from lb_approvals / lb_bypasses, the matrix
    from lb_deliverables, and the KPI tiles from lb_issues, so the rows here
    are built from one intended status per project rather than sprinkled
    randomly. Otherwise the demo shows a project that is 100% complete and
    also overdue.

    All CSVs are written as UTF-8 (no BOM), CRLF line endings, with QUOTE_MINIMAL
    field quoting (a field containing a comma, quote, or newline is double-quoted,
    embedded quotes are doubled). Dates are anchored to 2026-08-06 (ISO 2026-W32).

.PARAMETER Out
    Directory that will hold the 15 tracking CSVs. It is created if missing.
    project_batch_demo.csv is written to the PARENT of this directory, matching
    the sample_data layout (sample_data\tracking\*.csv + sample_data\project_batch_demo.csv).

.EXAMPLE
    .\generate_sample_data.ps1 -Out .\sample_data\tracking

.NOTES
    PowerShell 5.1 compatible. No modules, no Python, no external tools.
    Mirrors the Python generator's data model exactly: same 26 projects, same
    statuses, same people, same families, same NPI/ECN step models.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Out
)

$ErrorActionPreference = 'Stop'

# --------------------------------------------------------------------------
# Anchor date - the whole dataset is built relative to this.
# --------------------------------------------------------------------------
$TODAY = [datetime]::new(2026, 8, 6)          # Python date(2026, 8, 6)

# --------------------------------------------------------------------------
# Schema: table name -> ordered column list (the CSV header, in that order).
# Ported verbatim from SCHEMA in generate_sample_data.py.
# --------------------------------------------------------------------------
$SCHEMA = @{
    'lb_projects'      = @('project_id','process','prod_family','class_abcde','prf_date','market_manager','country','customer_number','status','created_by','created_utc','updated_utc','notes','family','target_date','certifications')
    'lb_gates'         = @('gate_id','project_id','process','step_key','step_num','step_name','status','complexity','batch_1','batch_2','batch_3','batch_override','batch_justification','approved_by','approved_utc','evidence_cited','notes','updated_utc')
    'lb_deliverables'  = @('deliverable_id','project_id','step_key','doc_code','file_name','file_path','sha256','status','approved','suspect_template','uploaded_by','uploaded_utc','notes','kind','original_name','wvn_id','wnb_id','description','link_url')
    'lb_doc_comments'  = @('comment_id','project_id','deliverable_id','doc_code','step_key','author','comment','created_utc')
    'lb_tickets'       = @('ticket_id','project_id','step_key','doc_code','title','description','requested_by','requested_dept','requested_utc','assigned_dept','assigned_to','priority','due_date','status','fulfilled_by','fulfilled_utc','deliverable_id','sha256','close_note')
    'lb_ticket_events' = @('event_id','ticket_id','timestamp_utc','actor','actor_role','action','detail','sha256')
    'lb_sp_issues'     = @('sp_id','project_id','title','description','raised_by','raised_utc','owner_dept','owner_pic','due_date','status','action_taken','remarks','attachment_name','attachment_path','last_message_by','last_message_utc','last_message','priority','assigned_dept')
    'lb_approvals'     = @('approval_id','project_id','step_key','deliverable_id','approved_by','approved_utc','approval_type','evidence_count','comments')
    'lb_bypasses'      = @('bypass_id','project_id','step_key','authorised_by','authorised_utc','reason','mitigation','supersede_by','closed_utc','closed_note')
    'lb_issues'        = @('issue_id','project_id','step_key','raised_utc','raised_by','category','description','owner','due_date','status','resolution','closed_utc')
    'lb_ppap'          = @('ppap_id','project_id','part_number','customer','doc_code','required','submitted_utc','customer_approved','customer_approved_utc','notes')
    'lb_warehouse'     = @('wh_id','project_id','step_key','area','kind','status','cleared_by','cleared_date','reference','notes')
    'lb_mwer'          = @('mwer_id','project_id','step_key','meeting_type','meeting_date','attendees','summary','evidence_file','evidence_body','decision','conditions','logged_by','logged_utc')
    'lb_d365'          = @('d365_id','project_id','step_key','area','entered_by','entered_date','reference','notes','logged_utc')
    'lb_audit'         = @('log_id','timestamp_utc','user','action','project_id','object_type','object_id','change_from','change_to','detail','result')
}

# Deterministic write order (matches the Python dict insertion order).
$TABLE_ORDER = @(
    'lb_projects','lb_gates','lb_deliverables','lb_doc_comments','lb_tickets',
    'lb_ticket_events','lb_sp_issues','lb_approvals','lb_bypasses','lb_issues',
    'lb_ppap','lb_warehouse','lb_mwer','lb_d365','lb_audit'
)

# --------------------------------------------------------------------------
# NPI / ECN step models, required documents, gating, and change types.
# Ported verbatim.
# --------------------------------------------------------------------------
$NPI_STEPS = @{
    1 = 'Project Planning'; 2 = 'Basic Design'; 3 = 'Detail Design'
    4 = 'Prototype Validation'; 5 = 'Process Set-up'; 6 = 'Trial Production'
    7 = 'Production Ramp-Up'
}
$ECN_STEPS = @{
    1 = 'EC Request Initiation'; 2 = 'Department & 5M Evaluation'
    3 = '5M Impact Assessment & Documentation'; 4 = 'BOM / MWER & Customer Approval'
    5 = 'Project Team Formation'; 6 = 'EC Implementation Plan & Kick-off'
    7 = 'ERP System & BOM Updates'; 8 = 'Supplier EC Communication & Material Readiness'
    9 = 'Warehouse & Stock Management'; 10 = 'Trial Production Planning'
    11 = 'Trial Production Execution'; 12 = 'Mass Production Handover'
}
$NPI_REQ = @{
    1 = @('PRF','QUOTE','GANTT','IR','CLASS'); 2 = @('DFM','DWG','WI')
    3 = @('PFMEA','DWG','BOM'); 4 = @('PFMEA','DWG','BOM','CONTROL-PLAN')
    5 = @('INSP-STD','CONTROL-PLAN','SOP','WI','PPAP')
    6 = @('QA-F-GEN-0010','SOP','WI','TRIAL-RPT','PFMEA')
    7 = @('RAMP-UP','KAIZEN','LL-INFO','NPI-CLOSURE','8D-CAPA')
}
$ECN_REQ = @{
    1 = @('ECR'); 2 = @('ECR'); 3 = @('ECR','4M-CHG'); 4 = @('ECR','BOM'); 5 = @('ECR')
    6 = @('ECR','DWG','BOM'); 7 = @('BOM','DWG','SOP'); 8 = @('BOM','DWG','ECR')
    9 = @('ECR','BOM'); 10 = @('ECR','DWG','BOM','4M-CHG','QA-F-GEN-0010')
    11 = @('QA-F-GEN-0010','TRIAL-RPT','8D-CAPA','SOP','WI')
    12 = @('SOP','WI','BOM','DWG','ECR','TRIAL-RPT','NPI-CLOSURE')
}
$TYPE_NPI = @{
    'A' = @(1,5,6,7); 'B' = @(1,5,6,7); 'C' = @(1,2,3,4,5,6,7)
    'D' = @(1,3,4,5,6,7); 'E' = @(1,2,3,4,5,6,7)
}
$ECN_GATED = @(4,11,12)

# Cycle-time lookup is part of the Python model but is not consumed by the
# generator itself; kept here for fidelity to the source.
$CYCLE = @{ 'A' = $null; 'B' = 178; 'C' = 103; 'D' = 108; 'E' = 210 }

# --------------------------------------------------------------------------
# People, market managers, and per-family certification strings.
# --------------------------------------------------------------------------
$PEOPLE = @('Tran Minh Quan','Nguyen Thi Lan','Pham Van Duc','Le Hoang Nam',
            'Vo Thi Hong','Dang Quoc Bao','Bui Thanh Ha','Hoang Kim Chi')
$MM = @('A. Fischer','M. Weber','S. Klein','J. Braun','R. Hoffmann')
$CERTS = @{
    'CL-CORDLESS' = 'CB|CE-EMC|UL'; 'CL-CORDED' = 'CB|CE-EMC'
    'TRIMMER' = 'CE-EMC|ETL'; 'SHAVER' = 'CB|CE-EMC|PSE'
    'STYLER' = 'CE-EMC'; 'KIT' = 'CB|CE-EMC|KC'
}

# --------------------------------------------------------------------------
# The 26 projects: suffix, family, fg, process, type, status, prf offset
# (weeks), target offset (weeks), note. Ported verbatim from P[].
# NOTE: named $PROJECTS (not $P) because PowerShell variables are
# case-insensitive and $P would collide with the $p loop variable below.
# --------------------------------------------------------------------------
$PROJECTS = @(
    @{ sfx='9649LP';  fam='CL-CORDLESS'; fg='9649LP';  proc='NPI'; typ='E'; status='COMPLETE';     prf=-46; tgt=-4;  note='Cordless clipper seed development - transferred to MP' }
    @{ sfx='9639';    fam='CL-CORDLESS'; fg='9639';    proc='NPI'; typ='E'; status='IN_PROGRESS';  prf=-22; tgt=10;  note='Li-ion platform variant for EU launch' }
    @{ sfx='9655N';   fam='CL-CORDLESS'; fg='9655N';   proc='NPI'; typ='C'; status='LATE';         prf=-30; tgt=-3;  note='Housing change held by tooling rework' }
    @{ sfx='2983LP';  fam='CL-CORDLESS'; fg='2983LP';  proc='NPI'; typ='D'; status='IN_PROGRESS';  prf=-14; tgt=8;   note='Soft-touch surface finish update' }
    @{ sfx='6245LP';  fam='CL-CORDLESS'; fg='6245LP';  proc='NPI'; typ='E'; status='NOT_STARTED';  prf=-2;  tgt=26;  note='FY27 cordless programme - kickoff pending' }
    @{ sfx='5612';    fam='CL-CORDED';   fg='5612';    proc='NPI'; typ='E'; status='COMPLETE';     prf=-52; tgt=-8;  note='Corded workhorse clipper - closed and ramped' }
    @{ sfx='7067';    fam='CL-CORDED';   fg='7067';    proc='NPI'; typ='C'; status='IN_PROGRESS';  prf=-18; tgt=6;   note='Blade housing redesign for noise reduction' }
    @{ sfx='09155-1701'; fam='CL-CORDED'; fg='09155-1701'; proc='NPI'; typ='B'; status='LATE';     prf=-34; tgt=-6;  note='Blister card change blocked on artwork approval' }
    @{ sfx='3026452'; fam='CL-CORDED';   fg='3026452'; proc='NPI'; typ='A'; status='NOT_STARTED';  prf=-1;  tgt=20;  note='Packaging-only refresh, awaiting marketing brief' }
    @{ sfx='6275';    fam='TRIMMER';     fg='6275';    proc='NPI'; typ='C'; status='COMPLETE';     prf=-40; tgt=-2;  note='Beard trimmer housing update - complete' }
    @{ sfx='5537';    fam='TRIMMER';     fg='5537';    proc='NPI'; typ='D'; status='IN_PROGRESS';  prf=-12; tgt=9;   note='Surface colourway change for retail exclusive' }
    @{ sfx='9855';    fam='TRIMMER';     fg='9855';    proc='NPI'; typ='E'; status='LATE';         prf=-38; tgt=-5;  note='New trimmer platform - certification lead time overrun' }
    @{ sfx='9893LP';  fam='TRIMMER';     fg='9893LP';  proc='NPI'; typ='A'; status='NOT_STARTED';  prf=-3;  tgt=15;  note='Packaging harmonisation across EU SKUs' }
    @{ sfx='5619';    fam='SHAVER';      fg='5619';    proc='NPI'; typ='C'; status='IN_PROGRESS';  prf=-16; tgt=7;   note='Foil shaver head assembly change' }
    @{ sfx='7066';    fam='SHAVER';      fg='7066';    proc='NPI'; typ='E'; status='NOT_STARTED';  prf=-1;  tgt=30;  note='Rotary shaver concept - feasibility stage' }
    @{ sfx='5546S';   fam='STYLER';      fg='5546S';   proc='NPI'; typ='D'; status='COMPLETE';     prf=-36; tgt=-6;  note='Nose/ear trimmer surface update - closed' }
    @{ sfx='5560N';   fam='STYLER';      fg='5560N';   proc='NPI'; typ='B'; status='IN_PROGRESS';  prf=-10; tgt=12;  note='Blister redesign for club channel' }
    @{ sfx='2983L';   fam='KIT';         fg='2983L';   proc='NPI'; typ='E'; status='LATE';         prf=-42; tgt=-7;  note='Multi-piece kit - component supply delay' }
    @{ sfx='9865';    fam='KIT';         fg='9865';    proc='NPI'; typ='A'; status='NOT_STARTED';  prf=-2;  tgt=18;  note='Kit packaging refresh' }
    # ---- ECN ----
    @{ sfx='5612C';   fam='CL-CORDED';   fg='5612C';   proc='ECN'; typ='C'; status='COMPLETE';     prf=-28; tgt=-3;  note='Housing unit change - handed to mass production' }
    @{ sfx='9649P';   fam='CL-CORDLESS'; fg='9649P';   proc='ECN'; typ='D'; status='IN_PROGRESS';  prf=-13; tgt=7;   note='Housing surface change, trial run scheduled' }
    @{ sfx='4501';    fam='TRIMMER';     fg='4501';    proc='ECN'; typ='B'; status='LATE';         prf=-26; tgt=-4;  note='Blister change - warehouse stock not yet cleared' }
    @{ sfx='3282';    fam='TRIMMER';     fg='3282';    proc='ECN'; typ='A'; status='IN_PROGRESS';  prf=-8;  tgt=11;  note='Packaging-only ECN for retail relabel' }
    @{ sfx='7065';    fam='SHAVER';      fg='7065';    proc='ECN'; typ='C'; status='NOT_STARTED';  prf=-2;  tgt=14;  note='Foil frame change requested by QA' }
    @{ sfx='5640';    fam='STYLER';      fg='5640';    proc='ECN'; typ='D'; status='COMPLETE';     prf=-24; tgt=-5;  note='Surface change closed with customer approval' }
    @{ sfx='3193';    fam='KIT';         fg='3193';    proc='ECN'; typ='B'; status='NOT_STARTED';  prf=-1;  tgt=16;  note='Kit blister change - ECR raised only' }
)

# --------------------------------------------------------------------------
# Hard-coded LFIs (lb_issues) and SharePoint-side issues (lb_sp_issues).
# Ported verbatim from ISSUES[] and SP[].
# --------------------------------------------------------------------------
# NOTE: each row is prefixed with a unary comma. Without it PowerShell 5.1
# flattens nested arrays written as newline-separated @(...) literals into a
# single flat list, which would corrupt every row.
$ISSUES = @(
    ,@('NPI-9655N','NPI-4','LFI','Tooling rework on the housing cavity pushed T1 samples 3 weeks late','Open','Pham Van Duc',-2,'')
    ,@('NPI-9855','NPI-5','LFI','CB certification lead time underestimated at planning - 6 weeks lost','Open','Nguyen Thi Lan',-1,'')
    ,@('NPI-2983L','NPI-3','LFI','Kit component supplier changed resin grade without notice','Open','Le Hoang Nam',1,'')
    ,@('NPI-09155-1701','NPI-1','LFI','Blister artwork approval loop with marketing not in the plan','Open','Vo Thi Hong',2,'')
    ,@('ECN-4501','ECN-9','LFI','Old-version stock not quarantined before changeover','Open','Bui Thanh Ha',-3,'')
    ,@('NPI-9649LP','NPI-6','LFI','Trial yield below target on first run - fixture alignment','Closed','Tran Minh Quan',-30,'Fixture re-datumed; yield 98.4% on re-run')
    ,@('NPI-5612','NPI-5','LFI','Inspection standard missing a critical dimension','Closed','Hoang Kim Chi',-40,'INSP-STD revised to rev C and re-approved')
    ,@('NPI-6275','NPI-7','LFI','Ramp-up manning plan not aligned with IE cycle time study','Closed','Dang Quoc Bao',-25,'Line rebalanced; standard time updated')
    ,@('ECN-5612C','ECN-12','LFI','SOP not reissued to the line before handover','Closed','Nguyen Thi Lan',-18,'SOP rev D issued and operators re-briefed')
    ,@('ECN-5640','ECN-4','LFI','Customer approval evidence filed against the wrong step','Closed','Pham Van Duc',-20,'Refiled under step 4 and audit corrected')
    ,@('NPI-5546S','NPI-6','LFI','Trial request form submitted without batch quantities','Closed','Vo Thi Hong',-22,'QA-F-GEN-0010 template updated with mandatory fields')
)
# Named $SPISSUES (not $SP) - see the $P/$p collision note above.
$SPISSUES = @(
    ,@('NPI-9639','Battery pack supplier FAI outstanding','FAI report not yet received for the new cell supplier','Engineering','Pham Van Duc','Open','High',5)
    ,@('NPI-7067','Noise test rig booking clash','Acoustic chamber double-booked with the shaver programme','Quality','Hoang Kim Chi','Open','Medium',3)
    ,@('ECN-9649P','Customer drawing revision pending','Awaiting countersigned drawing before ERP update','Engineering','Le Hoang Nam','Open','Critical',1)
    ,@('NPI-5619','Foil supplier PPAP level 3 documents incomplete','PSW received, dimensional results missing','Quality','Nguyen Thi Lan','Open','High',4)
    ,@('NPI-5537','Colour master approval','Retail exclusive colourway not signed by marketing','Marketing','Vo Thi Hong','Closed','Low',-6)
    ,@('ECN-3282','Label artwork version control','Two label versions in circulation on the line','Production','Bui Thanh Ha','Closed','Medium',-4)
)

# --------------------------------------------------------------------------
# Date helpers.
# --------------------------------------------------------------------------
# ISO 8601 week string "YYYY-Www" from a date (week 1 = week containing Jan 4).
function Get-IsoWeek {
    param([datetime]$Date)
    $Date = $Date.Date
    # ISO weekday: Mon=1 .. Sun=7
    $dow = [int]$Date.DayOfWeek
    if ($dow -eq 0) { $dow = 7 }
    # Thursday of the current ISO week
    $thu = $Date.AddDays(4 - $dow)
    $year = $thu.Year
    # Monday of ISO week 1 = Monday of the week containing Jan 4
    $jan4 = [datetime]::new($year, 1, 4)
    $jan4dow = [int]$jan4.DayOfWeek
    if ($jan4dow -eq 0) { $jan4dow = 7 }
    $week1Mon = $jan4.AddDays(1 - $jan4dow)
    $week = [math]::Floor(($thu - $week1Mon).TotalDays / 7) + 1
    return ('{0:0000}-W{1:00}' -f $year, $week)
}

# ISO week relative to the anchor date (delta in weeks, may be negative).
function Get-Wk {
    param([int]$DeltaWeeks)
    return Get-IsoWeek ($TODAY.AddDays($DeltaWeeks * 7))
}

# UTC timestamp string "YYYY-MM-DDTHH:MM:00.0000000Z" for days_ago from anchor.
function Get-Utc {
    param([int]$DaysAgo, [int]$Hh = 9, [int]$Mm = 30)
    $d = $TODAY.AddDays(-$DaysAgo)
    return ('{0:0000}-{1:00}-{2:00}T{3:00}:{4:00}:00.0000000Z' -f $d.Year, $d.Month, $d.Day, $Hh, $Mm)
}

# Sequential, zero-padded ID like Python's nid(): 'PREFIX-NNNN'.
$script:IdCounters = @{}
function Get-Nid {
    param([string]$Prefix, [int]$Width = 4)
    if (-not $script:IdCounters.ContainsKey($Prefix)) { $script:IdCounters[$Prefix] = 0 }
    $script:IdCounters[$Prefix]++
    return ('{0}-{1}' -f $Prefix, $script:IdCounters[$Prefix].ToString(('D' + $Width)))
}

# --------------------------------------------------------------------------
# CSV writers.
# --------------------------------------------------------------------------
# QUOTE_MINIMAL field quoting, mirroring Python csv.QUOTE_MINIMAL plus the
# generator's CR/LF sanitisation.
function ConvertTo-CsvField {
    param([AllowEmptyString()][string]$Value)
    $Value = $Value -replace "`r", ' ' -replace "`n", ' '
    if ($Value.Contains('"') -or $Value.Contains(',')) {
        $Value = '"' + ($Value -replace '"', '""') + '"'
    }
    return $Value
}

# Write one table: header + rows, UTF-8 no BOM, CRLF. Returns row count.
function Write-CsvTable {
    param([string]$Name)
    $cols = $SCHEMA[$Name]
    $sb = New-Object System.Text.StringBuilder
    $headerCells = foreach ($c in $cols) { ConvertTo-CsvField $c }
    [void]$sb.Append(($headerCells -join ','))
    [void]$sb.Append("`r`n")
    foreach ($row in $rows[$Name]) {
        $cells = foreach ($c in $cols) {
            $v = $row[$c]
            if ($null -eq $v) { $v = '' }
            ConvertTo-CsvField ([string]$v)
        }
        [void]$sb.Append(($cells -join ','))
        [void]$sb.Append("`r`n")
    }
    $path = Join-Path $Out ($Name + '.csv')
    [System.IO.File]::WriteAllText($path, $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))
    return $rows[$Name].Count
}

# Write project_batch_demo.csv to the parent of $Out. Non-ASCII characters
# (em-dash, Vietnamese) are built from code points so this file stays safe
# for PowerShell 5.1 regardless of the .ps1 file's own encoding.
function Write-BatchDemoCsv {
    $batchDir = Split-Path -Parent $Out
    if (-not $batchDir) { $batchDir = $Out }

    # "Kit tray redesign — Ghi chú: giảm nhựa 12%"
    $note3155 = 'Kit tray redesign ' + [string][char]0x2014 + ' Ghi ch' + [string][char]0x00FA +
                ': gi' + [string][char]0x1EA3 + 'm nh' + [string][char]0x1EF1 + 'a 12%'

    $lines = @(
        'process,prod_family,class_abcde,family,prf_date,target_date,market_manager,country,customer_number,notes,certifications'
        '# ---- DEMO FILE for A2. Batch Project Registration. Rows starting with # are ignored by the importer. ----'
        '# The 8 rows below are all VALID and will register cleanly.'
        'NPI,TRIMMER,E,9891,2026-W34,,A. Fischer,VN,C-2001,New cordless trimmer platform for FY27,CB|CE-EMC'
        'NPI,TRIMMER,C,9906,2026-W35,,M. Weber,VN,C-2002,Housing change to share the 9891 blade guard,CE-EMC'
        'NPI,CL-CORDLESS,E,6275LP,2026-W33,2027-W20,S. Klein,DE,C-2003,"Li-ion cordless clipper, EU launch",CB|CE-EMC|UL'
        'NPI,CL-CORDLESS,D,2240LC,2026-W36,,J. Braun,VN,C-2004,Surface finish update for club channel,CB|CE-EMC'
        'ECN,CL-CORDED,B,79449-1001,2026-W33,,R. Hoffmann,VN,C-2005,"Blister card change: new hanger, same insert",CE-EMC'
        'ECN,STYLER,A,5608,2026-W34,,A. Fischer,VN,C-2006,Packaging-only relabel for the KC market,KC'
        ('ECN,KIT,C,3155,2026-W35,,M. Weber,VN,C-2007,"' + $note3155 + '",CB|CE-EMC')
        'ECN,KIT,D,3026590,2026-W37,,S. Klein,VN,C-2008,Surface change on the storage case,CE-EMC'
        '# ---- The 6 rows below are all INVALID, on purpose, to demonstrate row-level rejection. ----'
        '# Each one triggers a different validation rule; the 8 valid rows above still import.'
        'XXX,TRIMMER,E,,,,,,,process is not NPI or ECN,'
        'NPI,TRIMMER,E,,,,,,,,no prod_family or no family so no project ID can be formed,'
        'NPI,TRIMMER,Z,,,,,,,,change type Z is not configured,'
        'NPI,NOT-A-REAL-FAMILY,E,,,,,,,,product family does not exist,'
        'NPI,TRIMMER,E,,13/07/2026,,,,,,prf_date is not an ISO week or a date,'
        'NPI,TRIMMER,E,,,,,,,,duplicate of the 9891 row above - same project ID,'
    )

    $sb = New-Object System.Text.StringBuilder
    foreach ($line in $lines) {
        [void]$sb.Append($line)
        [void]$sb.Append("`r`n")
    }
    $path = Join-Path $batchDir 'project_batch_demo.csv'
    [System.IO.File]::WriteAllText($path, $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))

    $dataRows = @($lines | Where-Object {
        $_ -and -not $_.StartsWith('#') -and -not $_.StartsWith('process,')
    }).Count
    return $dataRows
}

# --------------------------------------------------------------------------
# Build the dataset.
# --------------------------------------------------------------------------
$rows = @{}
foreach ($name in $TABLE_ORDER) { $rows[$name] = @() }

for ($i = 0; $i -lt $PROJECTS.Count; $i++) {
    $p = $PROJECTS[$i]
    $projId   = '{0}-{1}' -f $p.proc, $p.sfx
    $owner = $PEOPLE[$i % $PEOPLE.Count]
    $created = Get-Utc -DaysAgo (-$p.prf * 7)

    $rows['lb_projects'] += [ordered]@{
        project_id      = $projId
        process         = $p.proc
        prod_family     = $p.fam
        class_abcde     = $p.typ
        prf_date        = Get-Wk $p.prf
        market_manager  = $MM[$i % $MM.Count]
        country         = 'VN'
        customer_number = ('C-{0:0000}' -f (1000 + $i * 7))
        status          = 'Active'
        created_by      = $owner
        created_utc     = $created
        updated_utc     = Get-Utc 3
        notes           = $p.note
        family          = $p.fg
        target_date     = Get-Wk $p.tgt
        certifications  = $CERTS[$p.fam]
    }

    # Step model for this project
    $isNpi = ($p.proc -eq 'NPI')
    if ($isNpi) { $steps = @($TYPE_NPI[$p.typ]) } else { $steps = @(1,2,3,4,5,6,7,8,9,10,11,12) }
    if ($isNpi) { $gated = @($steps) } else { $gated = @($steps | Where-Object { $ECN_GATED -contains $_ }) }
    if ($isNpi) { $req = $NPI_REQ; $names = $NPI_STEPS } else { $req = $ECN_REQ; $names = $ECN_STEPS }

    # How many gated steps are signed off, per intended status
    if ($p.status -eq 'COMPLETE')       { $nDone = $gated.Count }
    elseif ($p.status -eq 'NOT_STARTED'){ $nDone = 0 }
    elseif ($p.status -eq 'LATE')       { $nDone = [math]::Max(1, [math]::Floor($gated.Count / 2)) }
    else                                { $nDone = [math]::Max(1, [int][math]::Floor($gated.Count * 0.6)) }
    if ($nDone -gt 0) { $doneSteps = @($gated[0..($nDone - 1)]) } else { $doneSteps = @() }

    foreach ($s in $steps) {
        $sk     = '{0}-{1}' -f $p.proc, $s
        $signed = ($doneSteps -contains $s)
        $frontier = 0
        if ($doneSteps.Count -gt 0) { $frontier = $doneSteps[$doneSteps.Count - 1] }

        # Evidence: every step up to the frontier gets its documents filed.
        foreach ($code in $req[$s]) {
            if ($s -le $frontier -or ($s -eq ($frontier + 1) -and $p.status -ne 'NOT_STARTED')) {
                $approved = ''
                if ($s -le $frontier) { $approved = 'YES' }
                $rows['lb_deliverables'] += [ordered]@{
                    deliverable_id = Get-Nid 'DEL' 5
                    project_id     = $projId
                    step_key       = $sk
                    doc_code       = $code
                    file_name      = ('{0}_{1}_{2}.pdf' -f $code, $p.fg, (Get-Wk $p.prf))
                    file_path      = ('..\NPI_EPM_Documents_Control\{0}\{1}\{2}\{3}_{4}.pdf' -f $code, $p.fam, $p.fg, $code, $p.fg)
                    sha256         = ''
                    status         = 'Filed'
                    approved       = $approved
                    suspect_template = ''
                    uploaded_by    = $owner
                    uploaded_utc   = Get-Utc ([math]::Max(1, -$p.prf * 7 - $s * 5))
                    notes          = ''
                    kind           = 'file'
                    original_name  = ('{0} {1}.pdf' -f $code, $p.fg)
                    wvn_id         = ('WVN-{0}' -f $p.fg)
                    wnb_id         = ''
                    description    = $names[$s]
                    link_url       = ''
                }
            }
        }

        if ($signed) {
            $rows['lb_approvals'] += [ordered]@{
                approval_id    = Get-Nid 'APR' 5
                project_id     = $projId
                step_key       = $sk
                deliverable_id = ''
                approved_by    = $owner
                approved_utc   = Get-Utc ([math]::Max(1, -$p.prf * 7 - $s * 4))
                approval_type  = 'Gate clearance'
                evidence_count = [string]$req[$s].Count
                comments       = ('Step {0} {1} cleared' -f $s, $names[$s])
            }
        }

        $rows['lb_gates'] += [ordered]@{
            gate_id           = Get-Nid 'GAT' 5
            project_id        = $projId
            process           = $p.proc
            step_key          = $sk
            step_num          = [string]$s
            step_name         = $names[$s]
            status            = $(if ($signed) { 'CLEARED' } elseif ($s -le ($frontier + 1)) { 'OPEN' } else { 'PENDING' })
            complexity        = ''
            batch_1           = ''
            batch_2           = ''
            batch_3           = ''
            batch_override    = ''
            batch_justification = ''
            approved_by       = $(if ($signed) { $owner } else { '' })
            approved_utc      = $(if ($signed) { Get-Utc ([math]::Max(1, -$p.prf * 7 - $s * 4)) } else { '' })
            evidence_cited    = ($req[$s] -join ';')
            notes             = ''
            updated_utc       = Get-Utc 3
        }
    }
}

# ---- bypasses: two, so the dashed "process debt" state is visible ----
$rows['lb_bypasses'] += [ordered]@{
    bypass_id = Get-Nid 'BYP' 4; project_id = 'NPI-9655N'; step_key = 'NPI-4'
    authorised_by = 'Dang Quoc Bao'; authorised_utc = Get-Utc 35
    reason = 'Prototype validation waived - tooling rework pushed T1 samples beyond the gate date'
    mitigation = '100% dimensional check on the first MP batch; PFMEA reviewed at step 5 instead'
    supersede_by = ''; closed_utc = ''; closed_note = ''
}
$rows['lb_bypasses'] += [ordered]@{
    bypass_id = Get-Nid 'BYP' 4; project_id = 'ECN-4501'; step_key = 'ECN-11'
    authorised_by = 'Bui Thanh Ha'; authorised_utc = Get-Utc 21
    reason = 'Trial production executed at supplier site; WVN trial deferred'
    mitigation = 'Supplier trial report accepted; WVN trial to run before next PO'
    supersede_by = ''; closed_utc = ''; closed_note = ''
}

# ---- issues / LFIs ----
foreach ($it in $ISSUES) {
    $projId = $it[0]; $sk = $it[1]; $cat = $it[2]; $desc = $it[3]
    $st = $it[4];  $own = $it[5]; $dueOff = $it[6]; $res = $it[7]
    $rows['lb_issues'] += [ordered]@{
        issue_id   = Get-Nid 'LFI' 4
        project_id = $projId
        step_key   = $sk
        raised_utc = Get-Utc ([math]::Abs($dueOff) * 7 + 14)
        raised_by  = $own
        category   = $cat
        description = $desc
        owner      = $own
        due_date   = Get-Wk $dueOff
        status     = $st
        resolution = $res
        closed_utc = $(if ($st -eq 'Closed') { Get-Utc ([math]::Abs($dueOff) * 7) } else { '' })
    }
}

# ---- SharePoint-side issues ----
for ($i = 0; $i -lt $SPISSUES.Count; $i++) {
    $sp = $SPISSUES[$i]
    $rows['lb_sp_issues'] += [ordered]@{
        sp_id           = Get-Nid 'SP' 4
        project_id      = $sp[0]
        title           = $sp[1]
        description     = $sp[2]
        raised_by       = $PEOPLE[$i % $PEOPLE.Count]
        raised_utc      = Get-Utc (20 + $i * 3)
        owner_dept      = $sp[3]
        owner_pic       = $sp[4]
        due_date        = Get-Wk $sp[7]
        status          = $sp[5]
        action_taken    = $(if ($sp[5] -eq 'Open') { '' } else { 'Resolved and verified' })
        remarks         = ''
        attachment_name = ''
        attachment_path = ''
        last_message_by = $sp[4]
        last_message_utc = Get-Utc (2 + $i)
        last_message    = 'Status reviewed at the weekly NPI meeting'
        priority        = $sp[6]
        assigned_dept   = $sp[3]
    }
}

# ---- warehouse readiness (steps with warehouse_gate_required) ----
$WH_AREAS = @('Assembly','Blade','Molding (material)','Mold storage','Fixture storage')
foreach ($p in $rows['lb_projects']) {
    $projId = $p['project_id']; $proc = $p['process']
    if ($proc -eq 'NPI') { $whSteps = @('NPI-5') } else { $whSteps = @('ECN-9','ECN-11','ECN-12') }
    $cleared = @($rows['lb_approvals'] | Where-Object { $_['project_id'] -eq $projId } | ForEach-Object { $_['step_key'] })
    foreach ($sk in $whSteps) {
        if (($cleared -notcontains $sk) -and $p['notes'] -and $sk -ne $whSteps[0]) { continue }
        $ok = ($cleared -contains $sk)
        $rows['lb_warehouse'] += [ordered]@{
            wh_id        = Get-Nid 'WH' 5
            project_id   = $projId
            step_key     = $sk
            area         = $WH_AREAS[$rows['lb_warehouse'].Count % 5]
            kind         = 'Material readiness'
            status       = $(if ($ok) { 'Cleared' } else { 'Pending' })
            cleared_by   = $(if ($ok) { $p['created_by'] } else { '' })
            cleared_date = $(if ($ok) { Get-Wk -2 } else { '' })
            reference    = ('WH-{0}' -f $p['family'])
            notes        = $(if ($ok) { '' } else { 'Awaiting gate clearance' })
        }
    }
}

# ---- D365 entries for closed projects ----
foreach ($p in $rows['lb_projects']) {
    $done = @($rows['lb_approvals'] | Where-Object { $_['project_id'] -eq $p['project_id'] })
    if ($p['process'] -eq 'NPI') { $totalGated = @($TYPE_NPI[$p['class_abcde']]).Count } else { $totalGated = 3 }
    if ($done.Count -ge $totalGated) {
        foreach ($area in @('Item master','BOM','Routing')) {
            $rows['lb_d365'] += [ordered]@{
                d365_id     = Get-Nid 'D365' 4
                project_id  = $p['project_id']
                step_key    = ('{0}-{1}' -f $p['process'], $totalGated)
                area        = $area
                entered_by  = 'Finance / SRC'
                entered_date = Get-Wk -2
                reference   = ('D365-{0}-{1}' -f $p['family'], $area.Substring(0,3).ToUpper())
                notes       = 'Entered after gate closure'
                logged_utc  = Get-Utc 14
            }
        }
    }
}

# ---- audit trail ----
foreach ($p in $rows['lb_projects']) {
    $rows['lb_audit'] += [ordered]@{
        log_id      = Get-Nid 'LOG' 6
        timestamp_utc = $p['created_utc']
        user        = $p['created_by']
        action      = 'Create_Project'
        project_id  = $p['project_id']
        object_type = 'Project'
        object_id   = $p['project_id']
        change_from = ''
        change_to   = 'Active'
        detail      = ('Type {0} - target {1}' -f $p['class_abcde'], $p['target_date'])
        result      = 'OK'
    }
}
foreach ($a in $rows['lb_approvals']) {
    $rows['lb_audit'] += [ordered]@{
        log_id      = Get-Nid 'LOG' 6
        timestamp_utc = $a['approved_utc']
        user        = $a['approved_by']
        action      = 'Gate_Approve'
        project_id  = $a['project_id']
        object_type = 'Gate'
        object_id   = $a['step_key']
        change_from = 'OPEN'
        change_to   = 'CLEARED'
        detail      = $a['comments']
        result      = 'OK'
    }
}
foreach ($b in $rows['lb_bypasses']) {
    $rows['lb_audit'] += [ordered]@{
        log_id      = Get-Nid 'LOG' 6
        timestamp_utc = $b['authorised_utc']
        user        = $b['authorised_by']
        action      = 'Gate_Bypass'
        project_id  = $b['project_id']
        object_type = 'Gate'
        object_id   = $b['step_key']
        change_from = 'OPEN'
        change_to   = 'BYPASSED'
        detail      = $b['reason']
        result      = 'OK'
    }
}
# Python's list.sort() is STABLE: equal timestamps keep insertion order
# (Create_Project before Gate_Approve before Gate_Bypass). PowerShell 5.1
# Sort-Object is NOT stable, so tag each row with its build index and sort by
# timestamp then index, then strip the tag.
$auditRows = @($rows['lb_audit'])
for ($ai = 0; $ai -lt $auditRows.Count; $ai++) { $auditRows[$ai]['_sort'] = $ai }
$sortedAudit = @($auditRows | Sort-Object -Property @(
    @{ Expression = { $_['timestamp_utc'] } },
    @{ Expression = { $_['_sort'] } }
))
foreach ($r in $sortedAudit) { $r.Remove('_sort') }
$rows['lb_audit'] = $sortedAudit

# --------------------------------------------------------------------------
# Write everything out.
# --------------------------------------------------------------------------
if (-not (Test-Path -LiteralPath $Out)) {
    New-Item -ItemType Directory -Path $Out -Force | Out-Null
}
$Out = [System.IO.Path]::GetFullPath($Out)

Write-Host ('{0,-20} {1}' -f 'FILE', 'ROWS')
foreach ($name in $TABLE_ORDER) {
    $n = Write-CsvTable $name
    Write-Host ('{0,-20} {1}' -f ($name + '.csv'), $n)
}
$batchCount = Write-BatchDemoCsv
Write-Host ('{0,-20} {1}' -f 'project_batch_demo.csv', $batchCount)
Write-Host ('Tracking CSVs written to : {0}' -f $Out)
Write-Host ('project_batch_demo.csv  : {0}' -f (Split-Path -Parent $Out))
