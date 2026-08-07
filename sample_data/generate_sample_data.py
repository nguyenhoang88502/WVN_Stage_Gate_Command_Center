#!/usr/bin/env python3
"""Generate the WAHL NPI/ECN Stage Gate demo dataset.

Writes a complete, internally consistent set of tracking CSVs plus a
batch-import demo CSV. "Internally consistent" is the whole point: the
dashboard derives every status from lb_approvals / lb_bypasses, the matrix
from lb_deliverables, and the KPI tiles from lb_issues, so the rows here are
built from one intended status per project rather than sprinkled randomly.
Otherwise the demo shows a project that is 100% complete and also overdue.
"""
import csv, io, os, sys
from datetime import date, timedelta

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

TODAY = date(2026, 8, 6)


def iso_week(d):
    y, w, _ = d.isocalendar()
    return "%04d-W%02d" % (y, w)


NOW_WEEK = iso_week(TODAY)


def wk(delta_weeks):
    return iso_week(TODAY + timedelta(weeks=delta_weeks))


def utc(days_ago, hh=9, mm=30):
    d = TODAY - timedelta(days=days_ago)
    return "%sT%02d:%02d:00.0000000Z" % (d.isoformat(), hh, mm)


SCHEMA = {
 'lb_projects': ['project_id','process','prod_family','class_abcde','prf_date','market_manager','country','customer_number','status','created_by','created_utc','updated_utc','notes','family','target_date','certifications'],
 'lb_gates': ['gate_id','project_id','process','step_key','step_num','step_name','status','complexity','batch_1','batch_2','batch_3','batch_override','batch_justification','approved_by','approved_utc','evidence_cited','notes','updated_utc'],
 'lb_deliverables': ['deliverable_id','project_id','step_key','doc_code','file_name','file_path','sha256','status','approved','suspect_template','uploaded_by','uploaded_utc','notes','kind','original_name','wvn_id','wnb_id','description','link_url'],
 'lb_doc_comments': ['comment_id','project_id','deliverable_id','doc_code','step_key','author','comment','created_utc'],
 'lb_tickets': ['ticket_id','project_id','step_key','doc_code','title','description','requested_by','requested_dept','requested_utc','assigned_dept','assigned_to','priority','due_date','status','fulfilled_by','fulfilled_utc','deliverable_id','sha256','close_note'],
 'lb_ticket_events': ['event_id','ticket_id','timestamp_utc','actor','actor_role','action','detail','sha256'],
 'lb_sp_issues': ['sp_id','project_id','title','description','raised_by','raised_utc','owner_dept','owner_pic','due_date','status','action_taken','remarks','attachment_name','attachment_path','last_message_by','last_message_utc','last_message','priority','assigned_dept'],
 'lb_approvals': ['approval_id','project_id','step_key','deliverable_id','approved_by','approved_utc','approval_type','evidence_count','comments'],
 'lb_bypasses': ['bypass_id','project_id','step_key','authorised_by','authorised_utc','reason','mitigation','supersede_by','closed_utc','closed_note'],
 'lb_issues': ['issue_id','project_id','step_key','raised_utc','raised_by','category','description','owner','due_date','status','resolution','closed_utc'],
 'lb_ppap': ['ppap_id','project_id','part_number','customer','doc_code','required','submitted_utc','customer_approved','customer_approved_utc','notes'],
 'lb_warehouse': ['wh_id','project_id','step_key','area','kind','status','cleared_by','cleared_date','reference','notes'],
 'lb_mwer': ['mwer_id','project_id','step_key','meeting_type','meeting_date','attendees','summary','evidence_file','evidence_body','decision','conditions','logged_by','logged_utc'],
 'lb_d365': ['d365_id','project_id','step_key','area','entered_by','entered_date','reference','notes','logged_utc'],
 'lb_audit': ['log_id','timestamp_utc','user','action','project_id','object_type','object_id','change_from','change_to','detail','result'],
}

NPI_STEPS = {1:'Project Planning',2:'Basic Design',3:'Detail Design',4:'Prototype Validation',
             5:'Process Set-up',6:'Trial Production',7:'Production Ramp-Up'}
ECN_STEPS = {1:'EC Request Initiation',2:'Department & 5M Evaluation',3:'5M Impact Assessment & Documentation',
             4:'BOM / MWER & Customer Approval',5:'Project Team Formation',6:'EC Implementation Plan & Kick-off',
             7:'ERP System & BOM Updates',8:'Supplier EC Communication & Material Readiness',
             9:'Warehouse & Stock Management',10:'Trial Production Planning',11:'Trial Production Execution',
             12:'Mass Production Handover'}
NPI_REQ = {1:['PRF','QUOTE','GANTT','IR','CLASS'],2:['DFM','DWG','WI'],3:['PFMEA','DWG','BOM'],
           4:['PFMEA','DWG','BOM','CONTROL-PLAN'],5:['INSP-STD','CONTROL-PLAN','SOP','WI','PPAP'],
           6:['QA-F-GEN-0010','SOP','WI','TRIAL-RPT','PFMEA'],7:['RAMP-UP','KAIZEN','LL-INFO','NPI-CLOSURE','8D-CAPA']}
ECN_REQ = {1:['ECR'],2:['ECR'],3:['ECR','4M-CHG'],4:['ECR','BOM'],5:['ECR'],6:['ECR','DWG','BOM'],
           7:['BOM','DWG','SOP'],8:['BOM','DWG','ECR'],9:['ECR','BOM'],
           10:['ECR','DWG','BOM','4M-CHG','QA-F-GEN-0010'],11:['QA-F-GEN-0010','TRIAL-RPT','8D-CAPA','SOP','WI'],
           12:['SOP','WI','BOM','DWG','ECR','TRIAL-RPT','NPI-CLOSURE']}
TYPE_NPI = {'A':[1,5,6,7],'B':[1,5,6,7],'C':[1,2,3,4,5,6,7],'D':[1,3,4,5,6,7],'E':[1,2,3,4,5,6,7]}
ECN_GATED = [4,11,12]
CYCLE = {'A':None,'B':178,'C':103,'D':108,'E':210}

PEOPLE = ['Tran Minh Quan','Nguyen Thi Lan','Pham Van Duc','Le Hoang Nam','Vo Thi Hong',
          'Dang Quoc Bao','Bui Thanh Ha','Hoang Kim Chi']
MM = ['A. Fischer','M. Weber','S. Klein','J. Braun','R. Hoffmann']

# project_id-suffix, family, fg, process, type, status, prf_offset_weeks, target_offset_weeks, note
P = [
 ('9649LP','CL-CORDLESS','9649LP','NPI','E','COMPLETE',-46,-4,'Cordless clipper seed development - transferred to MP'),
 ('9639','CL-CORDLESS','9639','NPI','E','IN_PROGRESS',-22,10,'Li-ion platform variant for EU launch'),
 ('9655N','CL-CORDLESS','9655N','NPI','C','LATE',-30,-3,'Housing change held by tooling rework'),
 ('2983LP','CL-CORDLESS','2983LP','NPI','D','IN_PROGRESS',-14,8,'Soft-touch surface finish update'),
 ('6245LP','CL-CORDLESS','6245LP','NPI','E','NOT_STARTED',-2,26,'FY27 cordless programme - kickoff pending'),
 ('5612','CL-CORDED','5612','NPI','E','COMPLETE',-52,-8,'Corded workhorse clipper - closed and ramped'),
 ('7067','CL-CORDED','7067','NPI','C','IN_PROGRESS',-18,6,'Blade housing redesign for noise reduction'),
 ('09155-1701','CL-CORDED','09155-1701','NPI','B','LATE',-34,-6,'Blister card change blocked on artwork approval'),
 ('3026452','CL-CORDED','3026452','NPI','A','NOT_STARTED',-1,20,'Packaging-only refresh, awaiting marketing brief'),
 ('6275','TRIMMER','6275','NPI','C','COMPLETE',-40,-2,'Beard trimmer housing update - complete'),
 ('5537','TRIMMER','5537','NPI','D','IN_PROGRESS',-12,9,'Surface colourway change for retail exclusive'),
 ('9855','TRIMMER','9855','NPI','E','LATE',-38,-5,'New trimmer platform - certification lead time overrun'),
 ('9893LP','TRIMMER','9893LP','NPI','A','NOT_STARTED',-3,15,'Packaging harmonisation across EU SKUs'),
 ('5619','SHAVER','5619','NPI','C','IN_PROGRESS',-16,7,'Foil shaver head assembly change'),
 ('7066','SHAVER','7066','NPI','E','NOT_STARTED',-1,30,'Rotary shaver concept - feasibility stage'),
 ('5546S','STYLER','5546S','NPI','D','COMPLETE',-36,-6,'Nose/ear trimmer surface update - closed'),
 ('5560N','STYLER','5560N','NPI','B','IN_PROGRESS',-10,12,'Blister redesign for club channel'),
 ('2983L','KIT','2983L','NPI','E','LATE',-42,-7,'Multi-piece kit - component supply delay'),
 ('9865','KIT','9865','NPI','A','NOT_STARTED',-2,18,'Kit packaging refresh'),
 # ---- ECN ----
 ('5612C','CL-CORDED','5612C','ECN','C','COMPLETE',-28,-3,'Housing unit change - handed to mass production'),
 ('9649P','CL-CORDLESS','9649P','ECN','D','IN_PROGRESS',-13,7,'Housing surface change, trial run scheduled'),
 ('4501','TRIMMER','4501','ECN','B','LATE',-26,-4,'Blister change - warehouse stock not yet cleared'),
 ('3282','TRIMMER','3282','ECN','A','IN_PROGRESS',-8,11,'Packaging-only ECN for retail relabel'),
 ('7065','SHAVER','7065','ECN','C','NOT_STARTED',-2,14,'Foil frame change requested by QA'),
 ('5640','STYLER','5640','ECN','D','COMPLETE',-24,-5,'Surface change closed with customer approval'),
 ('3193','KIT','3193','ECN','B','NOT_STARTED',-1,16,'Kit blister change - ECR raised only'),
]

rows = {k: [] for k in SCHEMA}
ctr = {}
def nid(pfx, n=4):
    ctr[pfx] = ctr.get(pfx, 0) + 1
    return '%s-%0*d' % (pfx, n, ctr[pfx])

CERTS = {'CL-CORDLESS':'CB|CE-EMC|UL','CL-CORDED':'CB|CE-EMC','TRIMMER':'CE-EMC|ETL',
         'SHAVER':'CB|CE-EMC|PSE','STYLER':'CE-EMC','KIT':'CB|CE-EMC|KC'}

for i, (sfx, fam, fg, proc, typ, status, prf_off, tgt_off, note) in enumerate(P):
    pid = '%s-%s' % (proc, sfx)
    owner = PEOPLE[i % len(PEOPLE)]
    created = utc(-prf_off * 7)
    rows['lb_projects'].append(dict(
        project_id=pid, process=proc, prod_family=fam, class_abcde=typ,
        prf_date=wk(prf_off), market_manager=MM[i % len(MM)], country='VN',
        customer_number='C-%04d' % (1000 + i * 7), status='Active',
        created_by=owner, created_utc=created, updated_utc=utc(3),
        notes=note, family=fg, target_date=wk(tgt_off), certifications=CERTS[fam]))

    steps = TYPE_NPI[typ] if proc == 'NPI' else list(range(1, 13))
    gated = steps if proc == 'NPI' else [s for s in steps if s in ECN_GATED]
    req = NPI_REQ if proc == 'NPI' else ECN_REQ
    names = NPI_STEPS if proc == 'NPI' else ECN_STEPS

    # how many gated steps are signed off, per intended status
    if status == 'COMPLETE':
        n_done = len(gated)
    elif status == 'NOT_STARTED':
        n_done = 0
    elif status == 'LATE':
        n_done = max(1, len(gated) // 2)
    else:                                   # IN_PROGRESS
        n_done = max(1, int(len(gated) * 0.6))
    done_steps = gated[:n_done]

    for s in steps:
        sk = '%s-%d' % (proc, s)
        signed = s in done_steps
        # evidence: every step up to the frontier gets its documents filed
        frontier = done_steps[-1] if done_steps else 0
        for code in req[s]:
            if s <= frontier or (s == frontier + 1 and status not in ('NOT_STARTED',)):
                approved = 'YES' if s <= frontier else ''
                rows['lb_deliverables'].append(dict(
                    deliverable_id=nid('DEL', 5), project_id=pid, step_key=sk, doc_code=code,
                    file_name='%s_%s_%s.pdf' % (code, fg, wk(prf_off)),
                    file_path='..\\NPI_EPM_Documents_Control\\%s\\%s\\%s\\%s_%s.pdf' % (code, fam, fg, code, fg),
                    sha256='', status='Filed', approved=approved, suspect_template='',
                    uploaded_by=owner, uploaded_utc=utc(max(1, -prf_off * 7 - s * 5)),
                    notes='', kind='file', original_name='%s %s.pdf' % (code, fg),
                    wvn_id='WVN-%s' % fg, wnb_id='', description=names[s], link_url=''))
        if signed:
            rows['lb_approvals'].append(dict(
                approval_id=nid('APR', 5), project_id=pid, step_key=sk, deliverable_id='',
                approved_by=owner, approved_utc=utc(max(1, -prf_off * 7 - s * 4)),
                approval_type='Gate clearance', evidence_count=str(len(req[s])),
                comments='Step %d %s cleared' % (s, names[s])))
        rows['lb_gates'].append(dict(
            gate_id=nid('GAT', 5), project_id=pid, process=proc, step_key=sk, step_num=str(s),
            step_name=names[s], status='CLEARED' if signed else ('OPEN' if s <= frontier + 1 else 'PENDING'),
            complexity='', batch_1='', batch_2='', batch_3='', batch_override='',
            batch_justification='',
            approved_by=owner if signed else '', approved_utc=utc(max(1, -prf_off * 7 - s * 4)) if signed else '',
            evidence_cited=';'.join(req[s]), notes='', updated_utc=utc(3)))

# ---- bypasses: two, so the dashed "process debt" state is visible ----
rows['lb_bypasses'].append(dict(
    bypass_id=nid('BYP', 4), project_id='NPI-9655N', step_key='NPI-4',
    authorised_by='Dang Quoc Bao', authorised_utc=utc(35),
    reason='Prototype validation waived - tooling rework pushed T1 samples beyond the gate date',
    mitigation='100% dimensional check on the first MP batch; PFMEA reviewed at step 5 instead',
    supersede_by='', closed_utc='', closed_note=''))
rows['lb_bypasses'].append(dict(
    bypass_id=nid('BYP', 4), project_id='ECN-4501', step_key='ECN-11',
    authorised_by='Bui Thanh Ha', authorised_utc=utc(21),
    reason='Trial production executed at supplier site; WVN trial deferred',
    mitigation='Supplier trial report accepted; WVN trial to run before next PO',
    supersede_by='', closed_utc='', closed_note=''))

# ---- issues / LFIs ----
ISSUES = [
 ('NPI-9655N','NPI-4','LFI','Tooling rework on the housing cavity pushed T1 samples 3 weeks late','Open','Pham Van Duc',-2,''),
 ('NPI-9855','NPI-5','LFI','CB certification lead time underestimated at planning - 6 weeks lost','Open','Nguyen Thi Lan',-1,''),
 ('NPI-2983L','NPI-3','LFI','Kit component supplier changed resin grade without notice','Open','Le Hoang Nam',1,''),
 ('NPI-09155-1701','NPI-1','LFI','Blister artwork approval loop with marketing not in the plan','Open','Vo Thi Hong',2,''),
 ('ECN-4501','ECN-9','LFI','Old-version stock not quarantined before changeover','Open','Bui Thanh Ha',-3,''),
 ('NPI-9649LP','NPI-6','LFI','Trial yield below target on first run - fixture alignment','Closed','Tran Minh Quan',-30,'Fixture re-datumed; yield 98.4% on re-run'),
 ('NPI-5612','NPI-5','LFI','Inspection standard missing a critical dimension','Closed','Hoang Kim Chi',-40,'INSP-STD revised to rev C and re-approved'),
 ('NPI-6275','NPI-7','LFI','Ramp-up manning plan not aligned with IE cycle time study','Closed','Dang Quoc Bao',-25,'Line rebalanced; standard time updated'),
 ('ECN-5612C','ECN-12','LFI','SOP not reissued to the line before handover','Closed','Nguyen Thi Lan',-18,'SOP rev D issued and operators re-briefed'),
 ('ECN-5640','ECN-4','LFI','Customer approval evidence filed against the wrong step','Closed','Pham Van Duc',-20,'Refiled under step 4 and audit corrected'),
 ('NPI-5546S','NPI-6','LFI','Trial request form submitted without batch quantities','Closed','Vo Thi Hong',-22,'QA-F-GEN-0010 template updated with mandatory fields'),
]
for pid, sk, cat, desc, st, own, due_off, res in ISSUES:
    rows['lb_issues'].append(dict(
        issue_id=nid('LFI', 4), project_id=pid, step_key=sk,
        raised_utc=utc(abs(due_off) * 7 + 14), raised_by=own, category=cat, description=desc,
        owner=own, due_date=wk(due_off), status=st, resolution=res,
        closed_utc=utc(abs(due_off) * 7) if st == 'Closed' else ''))

# ---- SharePoint-side issues ----
SP = [
 ('NPI-9639','Battery pack supplier FAI outstanding','FAI report not yet received for the new cell supplier','Engineering','Pham Van Duc','Open','High',5),
 ('NPI-7067','Noise test rig booking clash','Acoustic chamber double-booked with the shaver programme','Quality','Hoang Kim Chi','Open','Medium',3),
 ('ECN-9649P','Customer drawing revision pending','Awaiting countersigned drawing before ERP update','Engineering','Le Hoang Nam','Open','Critical',1),
 ('NPI-5619','Foil supplier PPAP level 3 documents incomplete','PSW received, dimensional results missing','Quality','Nguyen Thi Lan','Open','High',4),
 ('NPI-5537','Colour master approval','Retail exclusive colourway not signed by marketing','Marketing','Vo Thi Hong','Closed','Low',-6),
 ('ECN-3282','Label artwork version control','Two label versions in circulation on the line','Production','Bui Thanh Ha','Closed','Medium',-4),
]
for i, (pid, title, desc, dept, pic, st, pri, due_off) in enumerate(SP):
    rows['lb_sp_issues'].append(dict(
        sp_id=nid('SP', 4), project_id=pid, title=title, description=desc,
        raised_by=PEOPLE[i % len(PEOPLE)], raised_utc=utc(20 + i * 3), owner_dept=dept, owner_pic=pic,
        due_date=wk(due_off), status=st, action_taken='' if st == 'Open' else 'Resolved and verified',
        remarks='', attachment_name='', attachment_path='', last_message_by=pic,
        last_message_utc=utc(2 + i), last_message='Status reviewed at the weekly NPI meeting',
        priority=pri, assigned_dept=dept))

# ---- warehouse readiness (steps with warehouse_gate_required) ----
WH_AREAS = ['Assembly','Blade','Molding (material)','Mold storage','Fixture storage']
for p in rows['lb_projects']:
    pid, proc = p['project_id'], p['process']
    wh_steps = ['NPI-5'] if proc == 'NPI' else ['ECN-9','ECN-11','ECN-12']
    cleared = [a['step_key'] for a in rows['lb_approvals'] if a['project_id'] == pid]
    for sk in wh_steps:
        if sk not in cleared and p['notes'] and sk != wh_steps[0]:
            continue
        ok = sk in cleared
        rows['lb_warehouse'].append(dict(
            wh_id=nid('WH', 5), project_id=pid, step_key=sk, area=WH_AREAS[len(rows['lb_warehouse']) % 5],
            kind='Material readiness', status='Cleared' if ok else 'Pending',
            cleared_by=p['created_by'] if ok else '', cleared_date=wk(-2) if ok else '',
            reference='WH-%s' % p['family'], notes='' if ok else 'Awaiting gate clearance'))

# ---- D365 entries for closed projects ----
for p in rows['lb_projects']:
    done = [a for a in rows['lb_approvals'] if a['project_id'] == p['project_id']]
    total_gated = len(TYPE_NPI[p['class_abcde']]) if p['process'] == 'NPI' else 3
    if len(done) >= total_gated:
        for area in ('Item master','BOM','Routing'):
            rows['lb_d365'].append(dict(
                d365_id=nid('D365', 4), project_id=p['project_id'], step_key='%s-%s' % (p['process'], total_gated),
                area=area, entered_by='Finance / SRC', entered_date=wk(-2),
                reference='D365-%s-%s' % (p['family'], area[:3].upper()),
                notes='Entered after gate closure', logged_utc=utc(14)))

# ---- audit trail ----
for p in rows['lb_projects']:
    rows['lb_audit'].append(dict(
        log_id=nid('LOG', 6), timestamp_utc=p['created_utc'], user=p['created_by'],
        action='Create_Project', project_id=p['project_id'], object_type='Project',
        object_id=p['project_id'], change_from='', change_to='Active',
        detail='Type %s - target %s' % (p['class_abcde'], p['target_date']), result='OK'))
for a in rows['lb_approvals']:
    rows['lb_audit'].append(dict(
        log_id=nid('LOG', 6), timestamp_utc=a['approved_utc'], user=a['approved_by'],
        action='Gate_Approve', project_id=a['project_id'], object_type='Gate',
        object_id=a['step_key'], change_from='OPEN', change_to='CLEARED',
        detail=a['comments'], result='OK'))
for b in rows['lb_bypasses']:
    rows['lb_audit'].append(dict(
        log_id=nid('LOG', 6), timestamp_utc=b['authorised_utc'], user=b['authorised_by'],
        action='Gate_Bypass', project_id=b['project_id'], object_type='Gate',
        object_id=b['step_key'], change_from='OPEN', change_to='BYPASSED',
        detail=b['reason'], result='OK'))
rows['lb_audit'].sort(key=lambda r: r['timestamp_utc'])


def write(name):
    cols = SCHEMA[name]
    path = os.path.join(OUT, name + '.csv')
    with io.open(path, 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols, lineterminator='\r\n',
                           quoting=csv.QUOTE_MINIMAL, extrasaction='ignore')
        w.writeheader()
        for r in rows[name]:
            w.writerow({c: str(r.get(c, '')).replace('\r', ' ').replace('\n', ' ') for c in cols})
    return len(rows[name])


print('%-20s %s' % ('FILE', 'ROWS'))
for name in SCHEMA:
    print('%-20s %d' % (name + '.csv', write(name)))
