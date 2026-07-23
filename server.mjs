import { createServer } from 'node:http';
import { randomUUID, pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __root = fileURLToPath(new URL('.', import.meta.url));
const DATA_DIR = join(__root, 'data');
const STORAGE_DIR = join(__root, 'storage');
const PUBLIC_DIR = join(__root, 'public');
const DB_FILE = join(DATA_DIR, 'db.json');
const PORT = Number(process.env.PORT || 3000);
const SESSION_TTL = 12 * 60 * 60 * 1000;

const TABLES = ['users','sessions','tenders','tender_documents','technical_reports','phase3_records','phase4_records','invoices','payment_cycles','notifications','audit_logs','leads','lead_documents','lead_technical_reports','lead_phase3_records','lead_phase4_records','lead_invoices','lead_payment_cycles'];
const STAGES = ['ph1_draft','ph1_complete','ph2_active','ph2_complete','ph3_active','ph3_awarded','ph3_disqualified','ph4_active','ph4_complete','ph5_active','closed'];
const STAGE_LABELS = { ph1_draft:'Ph1 Draft', ph1_complete:'Ph1 Complete', ph2_active:'Ph2 Tech', ph2_complete:'Ph2 Complete', ph3_active:'Ph3 Awarding', ph3_awarded:'Ph3 Awarded', ph3_disqualified:'Ph3 Disqualified', ph4_active:'Ph4 Delivery', ph4_complete:'Ph4 Complete', ph5_active:'Ph5 Billing', closed:'Closed' };
const MIME = { html:'text/html', js:'application/javascript', css:'text/css', json:'application/json', pdf:'application/pdf', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', svg:'image/svg+xml', ico:'image/x-icon', doc:'application/msword', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls:'application/vnd.ms-excel', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

// ---- DB ----
let db = {};

async function loadDb() {
  try {
    db = JSON.parse(await readFile(DB_FILE, 'utf8'));
    for (const t of TABLES) if (!db[t]) db[t] = [];
  } catch {
    db = Object.fromEntries(TABLES.map(t => [t, []]));
    await saveDb();
  }
}

async function saveDb() {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DB_FILE, JSON.stringify(db, null, 2));
}

const tbl = n => db[n] || [];
const byId = (t, id) => tbl(t).find(r => r.id === id);

function ins(table, data) {
  const row = { id: randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...data };
  db[table].push(row);
  return row;
}

function upd(table, id, data) {
  const i = db[table].findIndex(r => r.id === id);
  if (i === -1) return null;
  db[table][i] = { ...db[table][i], ...data, updated_at: new Date().toISOString() };
  return db[table][i];
}

// ---- Auth ----
const hashPwd = (p, s) => pbkdf2Sync(p, s, 100000, 64, 'sha256').toString('hex');

function mkSession(userId) {
  const token = randomBytes(32).toString('hex');
  ins('sessions', { token, user_id: userId, expires_at: new Date(Date.now() + SESSION_TTL).toISOString() });
  saveDb().catch(() => {});
  return token;
}

function authUser(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return null;
  const s = tbl('sessions').find(s => s.token === token);
  if (!s || new Date(s.expires_at) < new Date()) return null;
  return byId('users', s.user_id);
}

// ---- Logging ----
function audit(action, entity_type, entity_id, user_id, meta = {}) {
  ins('audit_logs', { action, entity_type, entity_id, user_id, meta: JSON.stringify(meta) });
  saveDb().catch(() => {});
}

function notify(user_id, title, message, type = 'info', tender_id = null) {
  ins('notifications', { user_id, title, message, type, tender_id, read: false });
  saveDb().catch(() => {});
}

// ---- HTTP Helpers ----
function jres(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}
function jerr(res, msg, status = 400) { jres(res, { error: msg }, status); }

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

async function readBuf(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

// ---- Multipart Parser ----
function bufIdx(buf, needle, from = 0) {
  const end = buf.length - needle.length;
  outer: for (let i = from; i <= end; i++) {
    for (let j = 0; j < needle.length; j++) { if (buf[i+j] !== needle[j]) continue outer; }
    return i;
  }
  return -1;
}

function parseMP(buf, boundary) {
  const delim = Buffer.from(`--${boundary}`);
  const fields = {}, files = [];
  let pos = 0;
  while (pos < buf.length) {
    const di = bufIdx(buf, delim, pos);
    if (di === -1) break;
    pos = di + delim.length;
    if (pos >= buf.length || (buf[pos] === 45 && buf[pos+1] === 45)) break;
    if (buf[pos] === 13) pos += 2;
    const he = bufIdx(buf, Buffer.from('\r\n\r\n'), pos);
    if (he === -1) break;
    const hdrs = buf.slice(pos, he).toString();
    pos = he + 4;
    const nd = bufIdx(buf, delim, pos);
    const pe = nd === -1 ? buf.length : nd - 2;
    const data = buf.slice(pos, pe);
    const cd = hdrs.match(/Content-Disposition:[^\r\n]*?\bname="([^"]+)"/i);
    const fn = hdrs.match(/Content-Disposition:[^\r\n]*?\bfilename="([^"]+)"/i);
    const ct = hdrs.match(/Content-Type:\s*([^\r\n]+)/i);
    if (cd) {
      if (fn) files.push({ fieldName: cd[1], filename: fn[1], mime: ct ? ct[1].trim() : 'application/octet-stream', data });
      else fields[cd[1]] = data.toString();
    }
    pos = nd === -1 ? buf.length : nd;
  }
  return { fields, files };
}

// ---- Static ----
async function serveFile(res, path, inline = true) {
  try {
    await stat(path); // check file exists first
    const ext = extname(path).slice(1).toLowerCase();
    const ct = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct, ...(inline ? {} : { 'Content-Disposition': `attachment; filename="${path.split('/').pop()}"` }) });
    const stream = createReadStream(path);
    stream.on('error', () => { try { res.end(); } catch {} });
    stream.pipe(res);
    return true;
  } catch { return false; }
}

// ---- Request Handler ----
async function handle(req, res) {
  const m = req.method.toUpperCase();
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;

  if (m === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers':'Content-Type,Authorization' });
    return res.end();
  }

  if (p.startsWith('/storage/')) {
    const file = p.replace(/\.\./g, '').slice(9);
    return (await serveFile(res, join(STORAGE_DIR, file))) || jerr(res, 'Not found', 404);
  }

  if (!p.startsWith('/api/')) {
    const fp = (p === '/' || !extname(p)) ? join(PUBLIC_DIR, 'index.html') : join(PUBLIC_DIR, p);
    return (await serveFile(res, fp)) || jerr(res, 'Not found', 404);
  }

  // ---- Public API ----
  if (p === '/api/auth/login' && m === 'POST') {
    const { email, password } = await readJson(req);
    const u = tbl('users').find(u => u.email?.toLowerCase() === email?.toLowerCase());
    if (!u || hashPwd(password, u.salt) !== u.password_hash) return jerr(res, 'Invalid credentials', 401);
    if (u.status !== 'active') return jerr(res, 'Account disabled', 403);
    const token = mkSession(u.id);
    const { password_hash, salt, ...safe } = u;
    return jres(res, { token, user: safe });
  }

  // ---- Protected ----
  const user = authUser(req);
  if (!user) return jerr(res, 'Unauthorized', 401);

  if (p === '/api/auth/logout' && m === 'POST') {
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
    const i = db.sessions.findIndex(s => s.token === token);
    if (i !== -1) db.sessions.splice(i, 1);
    await saveDb();
    return jres(res, { ok: true });
  }

  if (p === '/api/auth/me') {
    const { password_hash, salt, ...safe } = user;
    return jres(res, safe);
  }

  if (p === '/api/catalog') {
    return jres(res, { stages: STAGES, stage_labels: STAGE_LABELS, roles: ['admin','tender','tech','acct','mgmt','lead'] });
  }

  // Notifications
  if (p === '/api/notifications' && m === 'GET') {
    const list = tbl('notifications').filter(n => n.user_id === user.id || user.role === 'admin')
      .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50);
    return jres(res, list);
  }

  const nm = p.match(/^\/api\/notifications\/([^/]+)\/read$/);
  if (nm && m === 'PATCH') {
    upd('notifications', nm[1], { read: true });
    await saveDb();
    return jres(res, { ok: true });
  }

  if (p === '/api/notifications/read-all' && m === 'PATCH') {
    for (const n of db.notifications) if (n.user_id === user.id) n.read = true;
    await saveDb();
    return jres(res, { ok: true });
  }

  // Circuit IDs Helper
  async function generateCircuitIds(count, parentId, parentType) {
    const d = new Date();
    const month = d.getMonth() + 1;
    const year = d.getFullYear();
    
    // FY is from April to March
    let fyStart, fyEnd;
    if (month >= 4) { fyStart = year; fyEnd = year + 1; }
    else { fyStart = year - 1; fyEnd = year; }
    
    const fyStr = `${fyStart.toString().slice(-2)}${fyEnd.toString().slice(-2)}`;
    const mStr = month.toString().padStart(2, '0');
    const seqKey = `${fyStr}-${mStr}`;
    
    let seqObj = tbl('circuit_sequences').find(s => s.id === seqKey);
    if (!seqObj) {
      seqObj = ins('circuit_sequences', { id: seqKey, last_val: 99 });
    }
    
    let currentVal = seqObj.last_val;
    const generated = [];
    
    for (let i = 0; i < count; i++) {
      currentVal++;
      const cid = `IPN${fyStr}-${mStr}-${currentVal}`;
      generated.push(ins('circuits', { parent_id: parentId, parent_type: parentType, circuit_id: cid }));
    }
    
    upd('circuit_sequences', seqKey, { last_val: currentVal });
    await saveDb();
    return generated;
  }

  // Audit
  if (p === '/api/audit') {
    if (!['admin','mgmt'].includes(user.role)) return jerr(res, 'Forbidden', 403);
    return jres(res, tbl('audit_logs').sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 200));
  }

  // Users
  if (p === '/api/users' && m === 'GET') {
    if (!['admin','mgmt'].includes(user.role)) return jerr(res, 'Forbidden', 403);
    return jres(res, tbl('users').map(({ password_hash, salt, ...u }) => u));
  }

  if (p === '/api/users' && m === 'POST') {
    if (user.role !== 'admin') return jerr(res, 'Forbidden', 403);
    const b = await readJson(req);
    if (!b.name || !b.email || !b.password || !b.role) return jerr(res, 'Missing fields');
    if (tbl('users').find(u => u.email === b.email)) return jerr(res, 'Email already exists');
    const salt = randomBytes(16).toString('hex');
    const nu = ins('users', { name: b.name, email: b.email, password_hash: hashPwd(b.password, salt), salt, role: b.role, department: b.department || '', status: 'active' });
    await saveDb();
    audit('user.create', 'user', nu.id, user.id, { name: b.name, role: b.role });
    const { password_hash, salt: s2, ...safe } = nu;
    return jres(res, safe, 201);
  }

  const um = p.match(/^\/api\/users\/([^/]+)$/);
  if (um && m === 'PATCH') {
    if (user.role !== 'admin') return jerr(res, 'Forbidden', 403);
    const b = await readJson(req);
    if (b.password) { const salt = randomBytes(16).toString('hex'); b.password_hash = hashPwd(b.password, salt); b.salt = salt; delete b.password; }
    const updated = upd('users', um[1], b);
    if (!updated) return jerr(res, 'Not found', 404);
    await saveDb();
    const { password_hash, salt, ...safe } = updated;
    return jres(res, safe);
  }

  // Admin Export Endpoint
  if (p === '/api/export/data' && m === 'GET') {
    if (user.role !== 'admin') return jerr(res, 'Forbidden', 403);
    const fullTenders = tbl('tenders').map(t => ({
      ...t,
      documents: tbl('tender_documents').filter(d => d.tender_id === t.id),
      technical_reports: tbl('technical_reports').filter(r => r.tender_id === t.id),
      phase3_records: tbl('phase3_records').filter(b => b.tender_id === t.id),
      phase4_records: tbl('phase4_records').filter(b => b.tender_id === t.id),
      invoices: tbl('invoices').filter(i => i.tender_id === t.id),
      payment_cycles: tbl('payment_cycles').filter(i => i.tender_id === t.id),
      circuits: tbl('circuits').filter(c => c.parent_id === t.id && c.parent_type === 'tender')
    }));
    const fullLeads = tbl('leads').map(l => ({
      ...l,
      documents: tbl('tender_documents').filter(d => d.lead_id === l.id),
      technical_reports: tbl('technical_reports').filter(r => r.lead_id === l.id),
      phase3_records: tbl('phase3_records').filter(b => b.lead_id === l.id),
      phase4_records: tbl('phase4_records').filter(b => b.lead_id === l.id),
      invoices: tbl('invoices').filter(i => i.lead_id === l.id),
      payment_cycles: tbl('payment_cycles').filter(i => i.lead_id === l.id),
      circuits: tbl('circuits').filter(c => c.parent_id === l.id && c.parent_type === 'lead')
    }));
    return jres(res, { tenders: fullTenders, leads: fullLeads });
  }

  // Tenders list
  if (p === '/api/tenders' && m === 'GET') {
    let list = tbl('tenders');
    if (user.role === 'tech') list = list.filter(t => !['ph1_draft','ph1_complete'].includes(t.stage));
    else if (user.role === 'acct') list = list.filter(t => ['ph3_active','ph3_awarded','ph4_active','ph4_complete','ph5_active','closed'].includes(t.stage));
    const docs = tbl('tender_documents'), reports = tbl('technical_reports'), ph3 = tbl('phase3_records');
    return jres(res, list.map(t => {
      const p3 = ph3.filter(r => r.tender_id === t.id);
      const last_ph3 = p3.length ? p3[p3.length - 1] : null;
      return {
        ...t,
        doc_count: docs.filter(d => d.tender_id === t.id).length,
        has_report: reports.some(r => r.tender_id === t.id),
        quoted_bid_value: last_ph3 ? last_ph3.quoted_bid_value : null
      };
    }).sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
  }

  if (p === '/api/tenders' && m === 'POST') {
    if (!['tender','admin'].includes(user.role)) return jerr(res, 'Forbidden', 403);
    const b = await readJson(req);
    if (!b.bid_number) return jerr(res, 'Bid Number required');
    const t = ins('tenders', {
      bid_number: b.bid_number,
      title: b.title || b.bid_number,
      bid_init_date: b.bid_init_date || null,
      bid_end_datetime: b.bid_end_datetime || null,
      bid_opening_datetime: b.bid_opening_datetime || null,
      ministry_state: b.ministry_state || '',
      org_name: b.org_name || '',
      dept_name: b.dept_name || '',
      grievance_contact: b.grievance_contact || '',
      contract_period: b.contract_period || '',
      est_bid_value: b.est_bid_value || null,
      payment_terms: b.payment_terms || '',
      service_type: b.service_type || '',
      bandwidth_mbps: b.bandwidth_mbps || null,
      ddos_with_ill: b.ddos_with_ill || '',
      media_type: b.media_type || '',
      static_ip_required: b.static_ip_required || '',
      router_accessories: b.router_accessories || '',
      link_delivery_address: b.link_delivery_address || '',
      total_bid_value: b.total_bid_value || null,
      stage: 'ph1_draft',
      created_by: user.id
    });
    await saveDb();
    audit('tender.create', 'tender', t.id, user.id, { bid_number: b.bid_number });
    return jres(res, t, 201);
  }

  // Single tender
  if (p.startsWith('/api/tenders/')) {
    const tm = p.match(/^\/api\/tenders\/([^/]+)(\/.*)?$/);
    if (!tm) return jerr(res, 'Not found', 404);

  const tid = tm[1], sub = tm[2] || '';
  const tender = byId('tenders', tid);

  if (!sub && m === 'GET') {
    if (!tender) return jerr(res, 'Not found', 404);
    return jres(res, {
      ...tender,
      documents: tbl('tender_documents').filter(d => d.tender_id === tid),
      technical_reports: tbl('technical_reports').filter(r => r.tender_id === tid),
      phase3_records: tbl('phase3_records').filter(b => b.tender_id === tid),
      phase4_records: tbl('phase4_records').filter(b => b.tender_id === tid),
      invoices: tbl('invoices').filter(i => i.tender_id === tid),
      payment_cycles: tbl('payment_cycles').filter(i => i.tender_id === tid).sort((a,b)=>a.cycle_number-b.cycle_number),
      circuits: tbl('circuits').filter(c => c.parent_id === tid && c.parent_type === 'tender')
    });
  }

  if (!sub && m === 'PATCH') {
    if (!tender) return jerr(res, 'Not found', 404);
    if (!['tender','admin'].includes(user.role)) return jerr(res, 'Forbidden', 403); // Only tender/admin can edit base tender (Phase 1)
    const b = await readJson(req);
    const updated = upd('tenders', tid, b);
    await saveDb();
    audit('tender.update', 'tender', tid, user.id, b);
    return jres(res, updated);
  }

  // Stage move
  if (sub === '/move' && m === 'POST') {
    if (!tender) return jerr(res, 'Not found', 404);
    const { stage, reason } = await readJson(req);
    if (!STAGES.includes(stage)) return jerr(res, 'Invalid stage');

    if (user.role === 'admin') {
      const updated = upd('tenders', tid, { stage, admin_override: true, override_by: user.id, override_reason: reason || 'Admin override' });
      await saveDb();
      audit('tender.override', 'tender', tid, user.id, { from: tender.stage, to: stage, reason });
      return jres(res, updated);
    }

    // Each key lists valid next stages from that stage.
    // The "Submit to Technical" button moves ph1_draft → ph2_active directly (skipping ph1_complete).
    // The "Mark Delivered" button moves ph4_complete → ph5_active (backend sets ph4_complete, UI then triggers ph5_active).
    const allowedTransitions = {
      'ph1_draft':          ['ph1_complete', 'ph2_active'],  // tender clicks "Submit to Tech" → skip intermediate
      'ph1_complete':       ['ph2_active'],
      'ph2_active':         ['ph2_complete'],
      'ph2_complete':       ['ph3_active'],
      'ph3_active':         ['ph3_awarded', 'ph3_disqualified'],
      'ph3_awarded':        ['ph4_active'],
      'ph4_active':         ['ph4_complete'],
      'ph4_complete':       ['ph5_active'],
      'ph5_active':         ['closed']
    };

    if (!allowedTransitions[tender.stage]?.includes(stage)) return jerr(res, 'Transition not allowed by state machine', 403);

    const roleAllowed = {
      'tender': ['ph1_complete', 'ph2_active', 'ph3_awarded', 'ph3_disqualified', 'ph4_active'],
      'tech':   ['ph2_complete', 'ph3_active', 'ph4_complete', 'ph5_active'],
      'acct':   ['closed']
    };
    
    if (!roleAllowed[user.role]?.includes(stage)) return jerr(res, 'Transition not allowed for your role', 403);

    upd('tenders', tid, { stage });
    await saveDb();
    audit('tender.move', 'tender', tid, user.id, { from: tender.stage, to: stage });

    if (stage === 'ph2_active') {
      tbl('users').filter(u => u.role === 'tech' && u.status === 'active').forEach(u => notify(u.id, 'New Technical Assignment', `Tender "${tender.bid_number}" needs feasibility/survey.`, 'task', tid));
    } else if (stage === 'ph5_active') {
      tbl('users').filter(u => u.role === 'acct' && u.status === 'active').forEach(u => notify(u.id, 'Ready for Billing', `Tender delivered. Ready for Phase 5 billing for "${tender.bid_number}".`, 'info', tid));
    }
    return jres(res, byId('tenders', tid));
  }

  // Documents
  if (sub === '/documents' && m === 'POST') {
    if (!tender) return jerr(res, 'Not found', 404);
    if (!['tender','tech','acct','admin'].includes(user.role)) return jerr(res, 'Forbidden', 403);
    const ct = req.headers['content-type'] || '';
    const bm = ct.match(/boundary=(.+)/);
    if (!bm) return jerr(res, 'Invalid multipart');
    const buf = await readBuf(req);
    const { fields, files } = parseMP(buf, bm[1]);
    if (!files.length) return jerr(res, 'No file provided');
    const file = files[0];
    const ext = extname(file.filename).toLowerCase();
    if (!['.pdf','.doc','.docx','.xls','.xlsx','.txt','.png','.jpg','.jpeg'].includes(ext)) return jerr(res, 'File type not allowed');
    await mkdir(STORAGE_DIR, { recursive: true });
    const stored = `${randomUUID()}${ext}`;
    await writeFile(join(STORAGE_DIR, stored), file.data);
    const doc = ins('tender_documents', { tender_id: tid, name: file.filename, stored, url: `/storage/${stored}`, size: file.data.length, mime: file.mime, category: fields.category || 'tender', uploaded_by: user.id });
    await saveDb();
    audit('doc.upload', 'tender', tid, user.id, { name: file.filename });
    return jres(res, doc, 201);
  }

  if (sub === '/documents' && m === 'GET') {
    if (!tender) return jerr(res, 'Not found', 404);
    return jres(res, tbl('tender_documents').filter(d => d.tender_id === tid));
  }

  // Technical report (Phase 2)
  if (sub === '/technical-report' && m === 'POST') {
    if (!tender) return jerr(res, 'Not found', 404);
    if (!['tech','admin'].includes(user.role)) return jerr(res, 'Forbidden', 403);
    
    // We expect JSON body here, not multipart directly (documents handled via /documents usually or we can do multipart here)
    // To support multipart (since the old one did):
    const ct = req.headers['content-type'] || '';
    const bm = ct.match(/boundary=(.+)/);
    let rData = {};
    if (bm) {
      const buf = await readBuf(req);
      const { fields, files } = parseMP(buf, bm[1]);
      Object.assign(rData, fields);
      
      for(let f of files) {
          const ext = extname(f.filename).toLowerCase();
          await mkdir(STORAGE_DIR, { recursive: true });
          const stored = `rpt_${randomUUID()}${ext}`;
          await writeFile(join(STORAGE_DIR, stored), f.data);
          
          if(f.fieldName === 'feasibility_doc') {
              rData.feasibility_doc_url = `/storage/${stored}`;
          } else if(f.fieldName === 'site_survey_doc') {
              rData.site_survey_doc_url = `/storage/${stored}`;
          }
      }
    } else { Object.assign(rData, await readJson(req)); }
    
    const report = ins('technical_reports', { tender_id: tid, submitted_by: user.id, ...rData });
    upd('tenders', tid, { stage: 'ph3_active' });
    await saveDb();
    audit('report.submit', 'tender', tid, user.id);
    tbl('users').filter(u => u.role === 'tender' && u.status === 'active').forEach(u => notify(u.id, 'Technical Report Ready', `Phase 2 complete for "${tender.bid_number}". Tender has automatically moved to Phase 3.`, 'success', tid));
    return jres(res, report, 201);
  }

  // Phase 3 Record
  if (sub === '/phase3' && m === 'POST') {
    if (!tender) return jerr(res, 'Not found', 404);
    if (!['tender','admin'].includes(user.role)) return jerr(res, 'Forbidden', 403);
    const b = await readJson(req);
    const rec = ins('phase3_records', { tender_id: tid, created_by: user.id, ...b });
    const newStage = b.qualification_result === 'Awarded' ? 'ph4_active' : 'ph3_disqualified';
    
    if (b.qualification_result === 'Awarded') {
      await generateCircuitIds(1, tid, 'tender');
    }
    
    upd('tenders', tid, { stage: newStage });
    await saveDb();
    audit('phase3.create', 'tender', tid, user.id, { result: b.qualification_result });
    if (newStage === 'ph4_active') tbl('users').filter(u => u.role === 'tech' && u.status === 'active').forEach(u => notify(u.id, 'Tender Awarded', `Tender awarded for "${tender.bid_number}". Pending Delivery (Phase 4).`, 'info', tid));
    return jres(res, rec, 201);
  }

  // Phase 4 Record
  if (sub === '/phase4' && m === 'POST') {
    if (!tender) return jerr(res, 'Not found', 404);
    if (!['tech','admin'].includes(user.role)) return jerr(res, 'Forbidden', 403);
    const ct = req.headers['content-type'] || '';
    const bm = ct.match(/boundary=(.+)/);
    let rData = {};
    if (bm) {
      const buf = await readBuf(req);
      const { fields, files } = parseMP(buf, bm[1]);
      Object.assign(rData, fields);
      
      for(let f of files) {
          const ext = extname(f.filename).toLowerCase();
          await mkdir(STORAGE_DIR, { recursive: true });
          const stored = `ph4_${randomUUID()}${ext}`;
          await writeFile(join(STORAGE_DIR, stored), f.data);
          
          if(f.fieldName === 'acceptance_form') {
              rData.acceptance_form_url = `/storage/${stored}`;
          } else if(f.fieldName === 'completion_cert') {
              rData.completion_cert_url = `/storage/${stored}`;
          }
      }
    } else { Object.assign(rData, await readJson(req)); }
    

    
    const rec = ins('phase4_records', { tender_id: tid, created_by: user.id, ...rData });
    upd('tenders', tid, { stage: 'ph5_active' });
    await saveDb();
    audit('phase4.create', 'tender', tid, user.id, {});
    tbl('users').filter(u => u.role === 'acct' && u.status === 'active').forEach(u => notify(u.id, 'Delivery Complete', `Phase 4 complete for "${tender.bid_number}". Tender has automatically moved to Phase 5. Ready for billing.`, 'info', tid));
    return jres(res, rec, 201);
  }

  // Phase 5 Invoice Header
  if (sub === '/invoice' && m === 'POST') {
    if (!tender) return jerr(res, 'Not found', 404);
    if (!['acct','admin'].includes(user.role)) return jerr(res, 'Forbidden', 403);
    
    const ct = req.headers['content-type'] || '';
    const bm = ct.match(/boundary=(.+)/);
    let b = {};
    if (bm) {
      const buf = await readBuf(req);
      const { fields, files } = parseMP(buf, bm[1]);
      Object.assign(b, fields);
      if (files.length) {
        const file = files[0];
        const ext = extname(file.filename).toLowerCase();
        await mkdir(STORAGE_DIR, { recursive: true });
        const stored = `inv_${randomUUID()}${ext}`;
        await writeFile(join(STORAGE_DIR, stored), file.data);
        b.invoice_upload_url = `/storage/${stored}`;
      }
    } else { Object.assign(b, await readJson(req)); }
    
    // Auto calculate invoice value if not sent
    if (!b.invoice_value && b.base_price) {
        b.invoice_value = parseFloat(b.base_price) + (parseFloat(b.base_price) * (parseFloat(b.gst_pct||0)/100));
    }
    
    const inv = ins('invoices', { tender_id: tid, created_by: user.id, ...b });
    // Keep stage in ph5_active until closed
    await saveDb();
    audit('invoice.create', 'invoice', inv.id, user.id, { number: b.invoice_number });
    return jres(res, inv, 201);
  }
  
  const ivm = sub.match(/^\/invoice\/([^/]+)$/);
  if (ivm && m === 'PATCH') {
    if (!['acct','admin'].includes(user.role)) return jerr(res, 'Forbidden', 403);
    const b = await readJson(req);
    const inv = upd('invoices', ivm[1], b);
    if (!inv) return jerr(res, 'Not found', 404);
    await saveDb();
    audit('invoice.update', 'invoice', ivm[1], user.id, b);
    return jres(res, inv);
  }

  // Phase 5 Payment Cycles
  if (sub === '/payment-cycles' && m === 'POST') {
    if (!tender) return jerr(res, 'Not found', 404);
    if (!['acct','admin'].includes(user.role)) return jerr(res, 'Forbidden', 403);
    const b = await readJson(req);
    const cycleNum = tbl('payment_cycles').filter(c => c.tender_id === tid).length + 1;
    const cyc = ins('payment_cycles', { tender_id: tid, cycle_number: cycleNum, created_by: user.id, ...b });
    await saveDb();
    audit('payment_cycle.create', 'payment_cycle', cyc.id, user.id, { cycle: cycleNum });
    return jres(res, cyc, 201);
  }

  const pcm = sub.match(/^\/payment-cycles\/([^/]+)$/);
  if (pcm && m === 'PATCH') {
    if (!['acct','admin'].includes(user.role)) return jerr(res, 'Forbidden', 403);
    const b = await readJson(req);
    const cyc = upd('payment_cycles', pcm[1], b);
    if (!cyc) return jerr(res, 'Not found', 404);
    await saveDb();
    
    // Auto-close logic
    const cycles = tbl('payment_cycles').filter(c => c.tender_id === tid);
    if (cycles.length > 0 && cycles.every(c => c.payment_status === 'Paid')) {
        upd('tenders', tid, { stage: 'closed' });
        await saveDb();
    }
    
    audit('payment_cycle.update', 'payment_cycle', pcm[1], user.id, b);
    return jres(res, cyc);
  }
    return jerr(res, 'Not found', 404);
  }

  // Leads list
  {
  if (p === '/api/leads' && m === 'GET') {
    let list = tbl('leads');
    if (user.role === 'tech') list = list.filter(t => !['ph1_draft','ph1_complete'].includes(t.stage));
    else if (user.role === 'acct') list = list.filter(t => ['ph3_active','ph3_awarded','ph4_active','ph4_complete','ph5_active','closed'].includes(t.stage));
    const docs = tbl('lead_documents'), reports = tbl('lead_technical_reports'), ph3 = tbl('lead_phase3_records');
    return jres(res, list.map(t => {
      const p3 = ph3.filter(r => r.lead_id === t.id);
      const last_ph3 = p3.length ? p3[p3.length - 1] : null;
      return {
        ...t,
        doc_count: docs.filter(d => d.lead_id === t.id).length,
        has_report: reports.some(r => r.lead_id === t.id),
        quoted_bid_value: last_ph3 ? last_ph3.quoted_bid_value : null
      };
    }).sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
  }

  if (p === '/api/leads' && m === 'POST') {
    if (!['lead','admin'].includes(user.role)) return jerr(res, 'Forbidden', 403);
    const b = await readJson(req);
    const t = ins('leads', {
      title: b.title || 'Untitled Lead',
      bid_init_date: b.bid_init_date || null,
      bid_end_datetime: b.bid_end_datetime || null,
      bid_opening_datetime: b.bid_opening_datetime || null,
      ministry_state: b.ministry_state || '',
      org_name: b.org_name || '',
      dept_name: b.dept_name || '',
      grievance_contact: b.grievance_contact || '',
      contract_period: b.contract_period || '',
      est_bid_value: b.est_bid_value || null,
      payment_terms: b.payment_terms || '',
      service_type: b.service_type || '',
      bandwidth_mbps: b.bandwidth_mbps || null,
      ddos_with_ill: b.ddos_with_ill || '',
      media_type: b.media_type || '',
      static_ip_required: b.static_ip_required || '',
      router_accessories: b.router_accessories || '',
      link_delivery_address: b.link_delivery_address || '',
      mrcp: b.mrcp || null,
      gst: b.gst !== undefined ? b.gst : 18,
      total_bid_value: b.total_bid_value || null,
      stage: 'ph1_draft',
      created_by: user.id
    });
    await saveDb();
    audit('leadItem.create', 'lead', t.id, user.id, { bid_number: b.bid_number });
    return jres(res, t, 201);
  }

  // Single lead
  if (p.startsWith('/api/leads/')) {
    const lm = p.match(/^\/api\/leads\/([^/]+)(\/.*)?$/);
    if (!lm) return jerr(res, 'Not found', 404);

    const lid = lm[1], sub = lm[2] || '';
    const leadItem = byId('leads', lid);

  if (!sub && m === 'GET') {
    if ((!leadItem)) return jerr(res, 'Not found', 404);
    return jres(res, {
      ...leadItem,
      documents: tbl('lead_documents').filter(d => d.lead_id === lid),
      technical_reports: tbl('lead_technical_reports').filter(r => r.lead_id === lid),
      phase3_records: tbl('lead_phase3_records').filter(b => b.lead_id === lid),
      phase4_records: tbl('lead_phase4_records').filter(b => b.lead_id === lid),
      invoices: tbl('lead_invoices').filter(i => i.lead_id === lid),
      payment_cycles: tbl('lead_payment_cycles').filter(i => i.lead_id === lid).sort((a,b)=>a.cycle_number-b.cycle_number),
      circuits: tbl('circuits').filter(c => c.parent_id === lid && c.parent_type === 'lead')
    });
  }

  if (!sub && m === 'PATCH') {
    if ((!leadItem)) return jerr(res, 'Not found', 404);
    if (!['lead','admin'].includes(user.role)) return jerr(res, 'Forbidden', 403); // Only tender/admin can edit base tender (Phase 1)
    const b = await readJson(req);
    const updated = upd('leads', lid, b);
    await saveDb();
    audit('leadItem.update', 'lead', lid, user.id, b);
    return jres(res, updated);
  }

  // Stage move
  if (sub === '/move' && m === 'POST') {
    if ((!leadItem)) return jerr(res, 'Not found', 404);
    const { stage, reason } = await readJson(req);
    if (!STAGES.includes(stage)) return jerr(res, 'Invalid stage');

    if (user.role === 'admin') {
      const updated = upd('leads', lid, { stage, admin_override: true, override_by: user.id, override_reason: reason || 'Admin override' });
      await saveDb();
      audit('leadItem.override', 'lead', lid, user.id, { from: leadItem.stage, to: stage, reason });
      return jres(res, updated);
    }

    // Each key lists valid next stages from that stage.
    // The "Submit to Technical" button moves ph1_draft → ph2_active directly (skipping ph1_complete).
    // The "Mark Delivered" button moves ph4_complete → ph5_active (backend sets ph4_complete, UI then triggers ph5_active).
    const allowedTransitions = {
      'ph1_draft':          ['ph1_complete', 'ph2_active'],  // tender clicks "Submit to Tech" → skip intermediate
      'ph1_complete':       ['ph2_active'],
      'ph2_active':         ['ph2_complete'],
      'ph2_complete':       ['ph3_active'],
      'ph3_active':         ['ph3_awarded', 'ph3_disqualified'],
      'ph3_awarded':        ['ph4_active'],
      'ph4_active':         ['ph4_complete'],
      'ph4_complete':       ['ph5_active'],
      'ph5_active':         ['closed']
    };

    if (!allowedTransitions[leadItem.stage]?.includes(stage)) return jerr(res, 'Transition not allowed by state machine', 403);

    const roleAllowed = {
      'lead': ['ph1_complete', 'ph2_active', 'ph3_awarded', 'ph3_disqualified', 'ph4_active'],
      'tech':   ['ph2_complete', 'ph3_active', 'ph4_complete', 'ph5_active'],
      'acct':   ['closed']
    };
    
    if (!roleAllowed[user.role]?.includes(stage)) return jerr(res, 'Transition not allowed for your role', 403);

    upd('leads', lid, { stage });
    await saveDb();
    audit('leadItem.move', 'lead', lid, user.id, { from: leadItem.stage, to: stage });

    if (stage === 'ph2_active') {
      tbl('users').filter(u => u.role === 'tech' && u.status === 'active').forEach(u => notify(u.id, 'New Technical Assignment', `Lead "${leadItem.bid_number}" needs feasibility/survey.`, 'task', lid));
    } else if (stage === 'ph5_active') {
      tbl('users').filter(u => u.role === 'acct' && u.status === 'active').forEach(u => notify(u.id, 'Ready for Billing', `Tender delivered. Ready for Phase 5 billing for "${leadItem.bid_number}".`, 'info', lid));
    }
    return jres(res, byId('leads', lid));
  }

  // Documents
  if (sub === '/documents' && m === 'POST') {
    if ((!leadItem)) return jerr(res, 'Not found', 404);
    if (!['lead','tech','acct','admin'].includes(user.role)) return jerr(res, 'Forbidden', 403);
    const ct = req.headers['content-type'] || '';
    const bm = ct.match(/boundary=(.+)/);
    if (!bm) return jerr(res, 'Invalid multipart');
    const buf = await readBuf(req);
    const { fields, files } = parseMP(buf, bm[1]);
    if (!files.length) return jerr(res, 'No file provided');
    const file = files[0];
    const ext = extname(file.filename).toLowerCase();
    if (!['.pdf','.doc','.docx','.xls','.xlsx','.txt','.png','.jpg','.jpeg'].includes(ext)) return jerr(res, 'File type not allowed');
    await mkdir(STORAGE_DIR, { recursive: true });
    const stored = `${randomUUID()}${ext}`;
    await writeFile(join(STORAGE_DIR, stored), file.data);
    const doc = ins('lead_documents', { lead_id: lid, name: file.filename, stored, url: `/storage/${stored}`, size: file.data.length, mime: file.mime, category: fields.category || 'lead', uploaded_by: user.id });
    await saveDb();
    audit('doc.upload', 'lead', lid, user.id, { name: file.filename });
    return jres(res, doc, 201);
  }

  if (sub === '/documents' && m === 'GET') {
    if ((!leadItem)) return jerr(res, 'Not found', 404);
    return jres(res, tbl('lead_documents').filter(d => d.lead_id === lid));
  }

  // Technical report (Phase 2)
  if (sub === '/technical-report' && m === 'POST') {
    if ((!leadItem)) return jerr(res, 'Not found', 404);
    if (!['tech','admin'].includes(user.role)) return jerr(res, 'Forbidden', 403);
    
    // We expect JSON body here, not multipart directly (documents handled via /documents usually or we can do multipart here)
    // To support multipart (since the old one did):
    const ct = req.headers['content-type'] || '';
    const bm = ct.match(/boundary=(.+)/);
    let rData = {};
    if (bm) {
      const buf = await readBuf(req);
      const { fields, files } = parseMP(buf, bm[1]);
      Object.assign(rData, fields);
      
      for(let f of files) {
          const ext = extname(f.filename).toLowerCase();
          await mkdir(STORAGE_DIR, { recursive: true });
          const stored = `rpt_${randomUUID()}${ext}`;
          await writeFile(join(STORAGE_DIR, stored), f.data);
          
          if(f.fieldName === 'feasibility_doc') {
              rData.feasibility_doc_url = `/storage/${stored}`;
          } else if(f.fieldName === 'site_survey_doc') {
              rData.site_survey_doc_url = `/storage/${stored}`;
          }
      }
    } else { Object.assign(rData, await readJson(req)); }
    
    const report = ins('lead_technical_reports', { lead_id: lid, submitted_by: user.id, ...rData });
    upd('leads', lid, { stage: 'ph3_active' });
    await saveDb();
    audit('report.submit', 'lead', lid, user.id);
    tbl('users').filter(u => u.role === 'lead' && u.status === 'active').forEach(u => notify(u.id, 'Technical Report Ready', `Phase 2 complete for "${leadItem.title}". Lead has automatically moved to Phase 3.`, 'success', lid));
    return jres(res, report, 201);
  }

  // Phase 3 Record
  if (sub === '/phase3' && m === 'POST') {
    if ((!leadItem)) return jerr(res, 'Not found', 404);
    if (!['lead','admin'].includes(user.role)) return jerr(res, 'Forbidden', 403);
    const b = await readJson(req);
    const rec = ins('lead_phase3_records', { lead_id: lid, created_by: user.id, ...b });
    const newStage = b.qualification_result === 'Awarded' ? 'ph4_active' : 'ph3_disqualified';
    
    if (b.qualification_result === 'Awarded') {
      await generateCircuitIds(1, lid, 'lead');
    }
    
    upd('leads', lid, { stage: newStage });
    await saveDb();
    audit('phase3.create', 'lead', lid, user.id, { result: b.qualification_result });
    if (newStage === 'ph4_active') tbl('users').filter(u => u.role === 'tech' && u.status === 'active').forEach(u => notify(u.id, 'Lead Awarded', `Lead awarded for "${leadItem.title}". Pending Delivery (Phase 4).`, 'info', lid));
    return jres(res, rec, 201);
  }

  // Phase 4 Record
  if (sub === '/phase4' && m === 'POST') {
    if ((!leadItem)) return jerr(res, 'Not found', 404);
    if (!['tech','admin'].includes(user.role)) return jerr(res, 'Forbidden', 403);
    const ct = req.headers['content-type'] || '';
    const bm = ct.match(/boundary=(.+)/);
    let rData = {};
    if (bm) {
      const buf = await readBuf(req);
      const { fields, files } = parseMP(buf, bm[1]);
      Object.assign(rData, fields);
      
      for(let f of files) {
          const ext = extname(f.filename).toLowerCase();
          await mkdir(STORAGE_DIR, { recursive: true });
          const stored = `ph4_${randomUUID()}${ext}`;
          await writeFile(join(STORAGE_DIR, stored), f.data);
          
          if(f.fieldName === 'acceptance_form') {
              rData.acceptance_form_url = `/storage/${stored}`;
          } else if(f.fieldName === 'completion_cert') {
              rData.completion_cert_url = `/storage/${stored}`;
          }
      }
    } else { Object.assign(rData, await readJson(req)); }
    

    
    const rec = ins('lead_phase4_records', { lead_id: lid, created_by: user.id, ...rData });
    upd('leads', lid, { stage: 'ph5_active' });
    await saveDb();
    audit('phase4.create', 'lead', lid, user.id, {});
    tbl('users').filter(u => u.role === 'acct' && u.status === 'active').forEach(u => notify(u.id, 'Delivery Complete', `Phase 4 complete for "${leadItem.title}". Lead has automatically moved to Phase 5. Ready for billing.`, 'info', lid));
    return jres(res, rec, 201);
  }

  // Phase 5 Invoice Header
  if (sub === '/invoice' && m === 'POST') {
    if ((!leadItem)) return jerr(res, 'Not found', 404);
    if (!['acct','admin'].includes(user.role)) return jerr(res, 'Forbidden', 403);
    
    const ct = req.headers['content-type'] || '';
    const bm = ct.match(/boundary=(.+)/);
    let b = {};
    if (bm) {
      const buf = await readBuf(req);
      const { fields, files } = parseMP(buf, bm[1]);
      Object.assign(b, fields);
      if (files.length) {
        const file = files[0];
        const ext = extname(file.filename).toLowerCase();
        await mkdir(STORAGE_DIR, { recursive: true });
        const stored = `inv_${randomUUID()}${ext}`;
        await writeFile(join(STORAGE_DIR, stored), file.data);
        b.invoice_upload_url = `/storage/${stored}`;
      }
    } else { Object.assign(b, await readJson(req)); }
    
    // Auto calculate invoice value if not sent
    if (!b.invoice_value && b.base_price) {
        b.invoice_value = parseFloat(b.base_price) + (parseFloat(b.base_price) * (parseFloat(b.gst_pct||0)/100));
    }
    
    const inv = ins('lead_invoices', { lead_id: lid, created_by: user.id, ...b });
    // Keep stage in ph5_active until closed
    await saveDb();
    audit('invoice.create', 'invoice', inv.id, user.id, { number: b.invoice_number });
    return jres(res, inv, 201);
  }
  
  const ivm = sub.match(/^\/invoice\/([^/]+)$/);
  if (ivm && m === 'PATCH') {
    if (!['acct','admin'].includes(user.role)) return jerr(res, 'Forbidden', 403);
    const b = await readJson(req);
    const inv = upd('lead_invoices', ivm[1], b);
    if (!inv) return jerr(res, 'Not found', 404);
    await saveDb();
    audit('invoice.update', 'invoice', ivm[1], user.id, b);
    return jres(res, inv);
  }

  // Phase 5 Payment Cycles
  if (sub === '/payment-cycles' && m === 'POST') {
    if ((!leadItem)) return jerr(res, 'Not found', 404);
    if (!['acct','admin'].includes(user.role)) return jerr(res, 'Forbidden', 403);
    const b = await readJson(req);
    const cycleNum = tbl('lead_payment_cycles').filter(c => c.lead_id === lid).length + 1;
    const cyc = ins('lead_payment_cycles', { lead_id: lid, cycle_number: cycleNum, created_by: user.id, ...b });
    await saveDb();
    audit('payment_cycle.create', 'payment_cycle', cyc.id, user.id, { cycle: cycleNum });
    return jres(res, cyc, 201);
  }

  const pcm = sub.match(/^\/payment-cycles\/([^/]+)$/);
  if (pcm && m === 'PATCH') {
    if (!['acct','admin'].includes(user.role)) return jerr(res, 'Forbidden', 403);
    const b = await readJson(req);
    const cyc = upd('lead_payment_cycles', pcm[1], b);
    if (!cyc) return jerr(res, 'Not found', 404);
    await saveDb();
    
    // Auto-close logic
    const cycles = tbl('lead_payment_cycles').filter(c => c.lead_id === lid);
    if (cycles.length > 0 && cycles.every(c => c.payment_status === 'Paid')) {
        upd('leads', lid, { stage: 'closed' });
        await saveDb();
    }
    
    audit('payment_cycle.update', 'payment_cycle', pcm[1], user.id, b);
    return jres(res, cyc);
  }
    return jerr(res, 'Not found', 404);
  }

  }
  
  jerr(res, 'Not found', 404);
}

// ---- Boot ----
await loadDb();
await mkdir(STORAGE_DIR, { recursive: true });
await mkdir(DATA_DIR, { recursive: true });

if (!tbl('users').length) {
  const salt = randomBytes(16).toString('hex');
  ins('users', { name: 'Admin User', email: 'admin@tenderops.com', password_hash: hashPwd('admin123', salt), salt, role: 'admin', department: 'Administration', status: 'active' });
  
  const salt2 = randomBytes(16).toString('hex');
  ins('users', { name: 'Tender Manager', email: 'tender@tenderops.com', password_hash: hashPwd('tender123', salt2), salt: salt2, role: 'tender', department: 'Tendering', status: 'active' });

  const salt3 = randomBytes(16).toString('hex');
  ins('users', { name: 'Tech Engineer', email: 'tech@tenderops.com', password_hash: hashPwd('tech123', salt3), salt: salt3, role: 'tech', department: 'Technical', status: 'active' });

  const salt4 = randomBytes(16).toString('hex');
  ins('users', { name: 'Accounts Officer', email: 'acct@tenderops.com', password_hash: hashPwd('acct123', salt4), salt: salt4, role: 'acct', department: 'Accounts', status: 'active' });

  await saveDb();
  
  const salt5 = randomBytes(16).toString('hex');
  ins('users', { name: 'Lead Executive', email: 'lead@tenderops.com', password_hash: hashPwd('lead123', salt5), salt: salt5, role: 'lead', department: 'Sales', status: 'active' });

  console.log('✓ Default users seeded: admin, tender, tech, acct, lead (@tenderops.com / role123)');
}

createServer(async (req, res) => {
  try { await handle(req, res); }
  catch (e) { console.error(e); try { jerr(res, 'Server error', 500); } catch {} }
}).listen(PORT, () => {
  console.log(`\n🚀 TenderOps → http://127.0.0.1:${PORT}\n`);
});
