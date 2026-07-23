// ============================================================
// TENDEROPS — ISP Tender Management System (Vanilla JS SPA)
// ============================================================

// ---- State ----
const S = {
  user: null, token: localStorage.getItem('_tok'),
  page: 'dashboard', tenderId: null, tab: 'tender_info',
  adminTab: 'users', tenders: [], tender: null,
  users: [], audit: [], notifications: [], unread: 0,
  modal: null, notifOpen: false
};

const STAGES = ['ph1_draft','ph1_complete','ph2_active','ph2_complete','ph3_active','ph3_awarded','ph3_disqualified','ph4_active','ph4_complete','ph5_active','closed'];

const alertStyle = document.createElement('style');
alertStyle.textContent = `
  @keyframes blinkRed {
    0% { background-color: transparent; }
    50% { background-color: rgba(255, 0, 0, 0.15); }
    100% { background-color: transparent; }
  }
  .alert-blinking {
    animation: blinkRed 1.5s infinite !important;
  }
  .alert-silence-btn {
    border: none; background: none; cursor: pointer; margin-left: 8px; font-size: 14px; vertical-align: middle; padding: 2px;
  }
  .alert-silence-btn:hover { transform: scale(1.1); }
`;
document.head.appendChild(alertStyle);

function checkAlert(item) {
  if (!item || item.stage === 'closed') return false;
  if (localStorage.getItem('silenced_' + (S.user?.id || '') + '_' + item.id)) return false;
  
  const now = new Date();
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  const pastOneDay = -1 * 24 * 60 * 60 * 1000;
  const role = S.user?.role;
  
  const dates = [];
  
  // Tender/Lead/Sales and Admins care about pre-bid and bid dates
  if (['tender', 'lead', 'admin', 'mgmt'].includes(role)) {
    if (item.pre_bid_datetime) dates.push(new Date(item.pre_bid_datetime));
    if (item.bid_init_date) dates.push(new Date(item.bid_init_date));
    if (item.bid_end_datetime) dates.push(new Date(item.bid_end_datetime));
  }
  
  // Tech/Delivery and Admins care about delivery dates (Phase 4)
  if (['tech', 'admin', 'mgmt'].includes(role)) {
    const p3recs = item.phase3_records || [];
    if (p3recs.length > 0) {
       const lastP3 = p3recs[p3recs.length - 1];
       if (lastP3.delivery_date) dates.push(new Date(lastP3.delivery_date));
    }
  }
  
  for (const d of dates) {
    if (isNaN(d.getTime())) continue;
    const diff = d.getTime() - now.getTime();
    if (diff >= pastOneDay && diff <= threeDays) return true;
  }
  return false;
}

// ---- Utils ----
const $  = id => document.getElementById(id);
const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const mount = (id, html) => { const e = $(id); if (e) e.innerHTML = html; };

function toast(msg, type = 'info') {
  let c = $('tc'); if (!c) { c = document.createElement('div'); c.id='tc'; c.className='toast-container'; document.body.appendChild(c); }
  const t = document.createElement('div'); t.className=`toast toast-${type}`; t.textContent = msg; c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function fmt(val, type) {
  if (val === null || val === undefined || val === '') return '<span style="color:var(--text3)">-</span>';
  if (type === 'date') { try { return new Date(val).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); } catch { return val; } }
  if (type === 'currency') return '₹' + parseFloat(val).toLocaleString('en-IN');
  if (type === 'size') { const s=parseInt(val)||0; return s>1048576?(s/1048576).toFixed(1)+' MB':(s/1024).toFixed(0)+' KB'; }
  return esc(val);
}

function timeAgo(d) {
  if (!d) return ''; const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff/60000); if (m<1) return 'just now'; if (m<60) return `${m}m ago`;
  const h = Math.floor(m/60); if (h<24) return `${h}h ago`; return `${Math.floor(h/24)}d ago`;
}

function fileIcon(mime) {
  if (!mime) return '📎'; mime = String(mime).toLowerCase();
  if (mime.includes('pdf')) return '📄';
  if (mime.includes('word')||mime.includes('doc')) return '📝';
  if (mime.includes('excel')||mime.includes('sheet')||mime.includes('xls')) return '📊';
  if (mime.includes('image')) return '🖼️'; return '📎';
}

function stageBadge(stage) {
  const m = {
    ph1_draft:['b-gray','○ Ph1 Draft'], ph1_complete:['b-blue','● Ph1 Complete'],
    ph2_active:['b-purple','⚙ Ph2 Active'], ph2_complete:['b-cyan','✓ Ph2 Complete'],
    ph3_active:['b-amber','⚖ Ph3 Awarding'], ph3_awarded:['b-green','✓ Ph3 Awarded'], ph3_disqualified:['b-red','⨯ Ph3 Disqualified'],
    ph4_active:['b-blue','🚚 Ph4 Delivery'], ph4_complete:['b-cyan','✓ Ph4 Complete'],
    ph5_active:['b-amber','₹ Ph5 Billing'], closed:['b-green','● Closed']
  }[stage] || ['b-gray', stage];
  return `<span class="badge ${m[0]}">${m[1]}</span>`;
}

function prioBadge(p) {
  const m = {high:['b-red','High'],medium:['b-amber','Medium'],low:['b-green','Low']}[p||'medium']||['b-gray','-'];
  return `<span class="badge ${m[0]}">${m[1]}</span>`;
}

function roleLabel(r) {
  return {admin:'Administrator',tender:'Tender Manager',tech:'Technical Team',acct:'Accounts',mgmt:'Management'}[r]||r;
}

// ---- API ----
// Supabase Client Wrapper
const SUPABASE_URL = 'https://temqpguspbgkapfdvlzq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_xRkLpc7cvht6D3UugO4TIQ_DKYZm1_d';
const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function getPrefix(path) {
  if (path.startsWith('/leads')) return 'lead';
  return 'tender'; // default for tenders
}

async function audit(action, type, id, details = {}) {
  await sbClient.from('audit_logs').insert({ action, entity_type: type, entity_id: id, user_id: S.user.id, details });
}

async function notify(userId, title, message, type = 'info', linkId = null) {
  await sbClient.from('notifications').insert({ user_id: userId, title, message, type, link_id: linkId });
}

async function notifyRole(roleName, title, message, type = 'info', linkId = null) {
  const { data: users } = await sbClient.from('users').select('*').eq('role', roleName).eq('status', 'active');
  if (users) {
    for (const u of users) {
      await notify(u.id, title, message, type, linkId);
    }
  }
}

async function uploadFile(file) {
  if (!file) return null;
  const ext = file.name.split('.').pop();
  const uuid = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substring(2);
  const filename = `${uuid}.${ext}`;
  const { data, error } = await sbClient.storage.from('documents').upload(filename, file);
  if (error) throw error;
  const { data: { publicUrl } } = sbClient.storage.from('documents').getPublicUrl(filename);
  return { name: file.name, stored: filename, url: publicUrl, size: file.size, mime: file.type };
}

async function api(method, path, body) {
  if (path === '/auth/login' && method === 'POST') {
    const { data, error } = await sbClient.auth.signInWithPassword({ email: body.email, password: body.password });
    if (error) throw error;
    const { data: profile } = await sbClient.from('users').select('*').eq('id', data.user.id).single();
    return { token: data.session.access_token, user: profile };
  }
  
  if (path === '/auth/logout' && method === 'POST') {
    await sbClient.auth.signOut();
    return {};
  }
  
  if (path === '/auth/me' && method === 'GET') {
    const { data: { session } } = await sbClient.auth.getSession();
    if (!session) throw new Error('Unauth');
    const { data: profile } = await sbClient.from('users').select('*').eq('id', session.user.id).single();
    return profile;
  }
  
  if (path === '/users' && method === 'GET') {
    const { data } = await sbClient.from('users').select('*'); return data;
  }
  
  if (path === '/tenders' || path === '/leads') {
    const table = path === '/tenders' ? 'tenders' : 'leads';
    const p3Table = path === '/tenders' ? 'phase3_records' : 'lead_phase3_records';
    if (method === 'GET') {
      const { data } = await sbClient.from(table).select(`*, ${p3Table}(quoted_bid_value)`);
      const eType = path === '/tenders' ? 'tender' : 'lead';
      const { data: cir } = await sbClient.from('circuits').select('*').eq('parent_type', eType);
      if (data) {
        data.forEach(d => {
          if (cir) d.circuits = cir.filter(c => c.parent_id === d.id);
          const p3 = d[p3Table];
          d.quoted_bid_value = (p3 && p3.length > 0) ? p3[p3.length - 1].quoted_bid_value : null;
        });
      }
      return data;
    }
    if (method === 'POST') {
      const { data } = await sbClient.from(table).insert({...body, created_by: S.user.id}).select();
      await audit('create', table.slice(0, -1), data[0].id);
      return data[0];
    }
  }
  
  if (path === '/audit' && method === 'GET') {
    const { data } = await sbClient.from('audit_logs').select('*, users (name)').order('created_at', { ascending: false }).limit(50);
    return data.map(d => ({ ...d, user_name: d.users?.name || 'Unknown' }));
  }
  
  if (path === '/notifications' && method === 'GET') {
    const { data } = await sbClient.from('notifications').select('*').eq('user_id', S.user.id).order('created_at', { ascending: false });
    return data;
  }
  
  if (path === '/notifications/read-all' && method === 'PATCH') {
    await sbClient.from('notifications').update({ read: true }).eq('user_id', S.user.id);
    return { success: true };
  }
  
  // Specific entity endpoints
  const match = path.match(/^\/(tenders|leads)\/([^\/]+)(?:\/(.*))?$/);
  if (match) {
    const isLead = match[1] === 'leads';
    const table = isLead ? 'leads' : 'tenders';
    const prefix = isLead ? 'lead_' : '';
    const eType = isLead ? 'lead' : 'tender';
    const id = match[2];
    const sub = match[3];
    
    if (!sub && method === 'GET') {
      const { data: main } = await sbClient.from(table).select('*').eq('id', id).single();
      const pId = isLead ? 'lead_id' : 'tender_id';
      
      const pDocs = sbClient.from(prefix + (isLead ? 'documents' : 'tender_documents')).select('*').eq(pId, id);
      const pTech = sbClient.from(prefix + 'technical_reports').select('*').eq(pId, id);
      const pPh3 = sbClient.from(prefix + 'phase3_records').select('*').eq(pId, id);
      const pPh4 = sbClient.from(prefix + 'phase4_records').select('*').eq(pId, id);
      const pInv = sbClient.from(prefix + 'invoices').select('*').eq(pId, id);
      const pCyc = sbClient.from(prefix + 'payment_cycles').select('*').eq(pId, id);
      const pCir = sbClient.from('circuits').select('*').eq('parent_id', id);
      
      const [docs, tech, ph3, ph4, inv, cyc, cir] = await Promise.all([pDocs, pTech, pPh3, pPh4, pInv, pCyc, pCir]);
      
      return {
        ...main,
        documents: docs.data || [],
        technical_reports: tech.data || [],
        phase3_records: ph3.data || [],
        phase4_records: ph4.data || [],
        invoices: inv.data || [],
        payment_cycles: cyc.data || [],
        circuits: cir.data || []
      };
    }
    
    if (!sub && method === 'PATCH') {
      const { data } = await sbClient.from(table).update(body).eq('id', id).select();
      await audit('update', eType, id, Object.keys(body));
      return data[0];
    }
    
    if (sub === 'move' && method === 'POST') {
      await sbClient.from(table).update({ stage: body.stage }).eq('id', id);
      await audit('move', eType, id, { to: body.stage });
      const eName = isLead ? S.leadItem?.title : S.tender?.bid_number;
      await notifyRole('mgmt', 'Stage Updated', `${eType === 'lead' ? 'Lead' : 'Tender'} "${eName}" moved to ${body.stage}.`, 'info', id);
      if (body.stage === 'ph2_active') {
        await notifyRole('tech', 'New Technical Assignment', `${isLead ? 'Lead' : 'Tender'} "${eName}" needs feasibility/survey.`, 'task', id);
      }
      return { success: true };
    }
    
    if (sub === 'phase2' && method === 'POST') {
      await sbClient.from(prefix + 'technical_reports').insert({ ...body, [isLead ? 'lead_id' : 'tender_id']: id, created_by: S.user.id });
      await sbClient.from(table).update({ stage: 'ph3_active' }).eq('id', id);
      await audit('report.submit', eType, id);
      const eName = isLead ? S.leadItem?.title : S.tender?.bid_number;
      await notifyRole('tender', 'Technical Report Ready', `Phase 2 complete for "${eName}". ${isLead ? 'Lead' : 'Tender'} has automatically moved to Phase 3.`, 'success', id);
      return { success: true };
    }
    
    if (sub === 'phase3' && method === 'POST') {
      await sbClient.from(prefix + 'phase3_records').insert({ ...body, [isLead ? 'lead_id' : 'tender_id']: id, created_by: S.user.id });
      // Circuit Generation for Awarded Phase 3 (Exactly 1 circuit)
      const newStage = body.qualification_result === 'Awarded' ? 'ph4_active' : (body.qualification_result === 'Qualified' ? 'ph3_active' : 'ph3_disqualified');
      await sbClient.from(table).update({ stage: newStage }).eq('id', id);
      
      if (body.qualification_result === 'Awarded') {
        const d = new Date();
        const yy = String(d.getFullYear()).slice(2);
        const yyNext = String(d.getFullYear() + 1).slice(2);
        const yyyy = yy + yyNext; // e.g. 2627
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const seqKey = `${yyyy}-${mm}`;
        
        const { data: existingCircuits } = await sbClient.from('circuits')
          .select('circuit_id')
          .like('circuit_id', `IPN${seqKey}-%`);
          
        let nextVal = 100;
        if (existingCircuits && existingCircuits.length > 0) {
          const maxVal = Math.max(...existingCircuits.map(c => parseInt(c.circuit_id.split('-').pop()) || 99));
          nextVal = maxVal + 1;
        }
        
        await sbClient.from('circuits').insert([{
          parent_id: id, parent_type: isLead ? 'lead' : 'tender', circuit_id: `IPN${seqKey}-${nextVal}`
        }]);
      }

      await audit('phase3.create', isLead ? 'lead' : 'tender', id, { result: body.qualification_result });
      if (newStage === 'ph4_active') {
        const eName = isLead ? S.leadItem?.title : S.tender?.bid_number;
        await notifyRole('tech', `${isLead ? 'Lead' : 'Tender'} Awarded`, `${isLead ? 'Lead' : 'Tender'} awarded for "${eName}". Pending Delivery (Phase 4).`, 'info', id);
      }
      return { success: true };
    }
    
    if (sub === 'payment-cycles' && method === 'POST') {
      await sbClient.from(prefix + 'payment_cycles').insert({ ...body, [isLead ? 'lead_id' : 'tender_id']: id, created_by: S.user.id });
      return { success: true };
    }
    
    if (sub.startsWith('payment-cycles/') && method === 'PATCH') {
      const cid = sub.split('/')[1];
      await sbClient.from(prefix + 'payment_cycles').update(body).eq('id', cid);
      return { success: true };
    }
  }
  
  throw new Error('Not implemented: ' + method + ' ' + path);
}

async function up(path, fd) {
  const match = path.match(/^\/(tenders|leads)\/([^\/]+)\/(.*)$/);
  if (!match) throw new Error('Invalid path');
  
  const isLead = match[1] === 'leads';
  const table = isLead ? 'leads' : 'tenders';
  const prefix = isLead ? 'lead_' : '';
  const eType = isLead ? 'lead' : 'tender';
  const pId = isLead ? 'lead_id' : 'tender_id';
  const id = match[2];
  const sub = match[3];
  
  if (sub === 'documents') {
    const fileData = await uploadFile(fd.get('file'));
    await sbClient.from(prefix + (isLead ? 'documents' : 'tender_documents')).insert({
      [pId]: id, name: fileData.name, stored: fileData.stored, url: fileData.url, size: fileData.size, mime: fileData.mime, uploaded_by: S.user.id
    });
    await audit('doc.upload', eType, id, { name: fileData.name });
    return { success: true };
  }
  
  if (sub === 'phase2') {
    const fDoc = await uploadFile(fd.get('feasibility_doc'));
    const sDoc = await uploadFile(fd.get('site_survey_doc'));
    await sbClient.from(prefix + 'technical_reports').insert({
      [pId]: id, submitted_by: S.user.id,
      feasibility_status: fd.get('feasibility_status'),
      survey_notes: fd.get('survey_notes'),
      service_provider: fd.get('service_provider'),
      survey_date: fd.get('survey_date') || null,
      survey_conducted_by: fd.get('survey_conducted_by'),
      type_of_premises: fd.get('type_of_premises'),
      building_structure: fd.get('building_structure'),
      nearest_pop_dist: fd.get('nearest_pop_dist') ? parseFloat(fd.get('nearest_pop_dist')) : null,
      accessibility: fd.get('accessibility'),
      power_availability: fd.get('power_availability'),
      rack_space: fd.get('rack_space'),
      environment_conditions: fd.get('environment_conditions'),
      feasibility_doc_url: fDoc?.url || null,
      site_survey_doc_url: sDoc?.url || null
    });
    await sbClient.from(table).update({ stage: 'ph3_active' }).eq('id', id);
    await audit('report.submit', eType, id);
    return { success: true };
  }
  
  if (sub === 'phase4') {
    const aDoc = await uploadFile(fd.get('acceptance_form'));
    const cDoc = await uploadFile(fd.get('completion_cert'));
    await sbClient.from(prefix + 'phase4_records').insert({
      [pId]: id, created_by: S.user.id,
      delivery_date: fd.get('delivery_date'),
      delivery_notes: fd.get('delivery_notes'),
      ipv4_addresses: fd.get('ipv4_addresses') ? JSON.parse(fd.get('ipv4_addresses')) : null,
      ipv6_addresses: fd.get('ipv6_addresses') ? JSON.parse(fd.get('ipv6_addresses')) : null,
      router_names: fd.get('router_names') ? JSON.parse(fd.get('router_names')) : null,
      acceptance_form_url: aDoc?.url || null,
      completion_cert_url: cDoc?.url || null
    });
    await sbClient.from(table).update({ stage: 'ph5_active' }).eq('id', id);
    const eName = isLead ? S.leadItem?.title : S.tender?.bid_number;
    await notifyRole('acct', 'Delivery Complete', `Phase 4 complete for "${eName}". ${isLead ? 'Lead' : 'Tender'} has automatically moved to Phase 5. Ready for billing.`, 'info', id);
    await audit('phase4.submit', eType, id);
    return { success: true };
  }
  
  if (sub === 'phase5') {
    const invDoc = await uploadFile(fd.get('invoice_upload'));
    await sbClient.from(prefix + 'invoices').insert({
      [pId]: id, created_by: S.user.id,
      invoice_number: fd.get('invoice_number'),
      notif_to_tender_date: fd.get('notif_to_tender_date') || fd.get('notif_to_lead_date'), // handle both
      award_date: fd.get('award_date'),
      total_price: parseFloat(fd.get('total_price')),
      billing_price: parseFloat(fd.get('billing_price')),
      base_price: parseFloat(fd.get('base_price')),
      gst_pct: parseFloat(fd.get('gst_pct')),
      duration_from: fd.get('duration_from'),
      duration_to: fd.get('duration_to'),
      payment_cycle: fd.get('payment_cycle'),
      invoice_upload_url: invDoc?.url || null
    });
    await sbClient.from(table).update({ stage: 'ph5_active' }).eq('id', id);
    await audit('phase5.submit', eType, id);
    return { success: true };
  }
  
  throw new Error('Upload path not implemented: ' + path);
}

window.api = api;
window.up = up;


// ---- Auth ----
async function init() {
  if (!S.token) return showLogin();
  try {
    S.user = await api('GET', '/auth/me');
    if (!S.user) return showLogin();
    await loadAll();
    setInterval(loadNotifs, 30000);
    render();
  } catch { localStorage.removeItem('_tok'); showLogin(); }
}

async function loadAll() {
  const p = [loadTenders(), loadLeads(), loadNotifs()];
  if (['admin', 'mgmt'].includes(S.user?.role)) p.push(loadAudit());
  await Promise.all(p);
}

async function loadTenders() {
  try { S.tenders = await api('GET', '/tenders') || []; } catch {}
}

async function loadLeads() {
  try { S.leads = await api('GET', '/leads') || []; } catch {}
}

async function loadTender(id) {
  try { S.tender = await api('GET', `/tenders/${id}`); } catch { S.tender = null; }
}

async function loadLead(id) {
  try { S.leadItem = await api('GET', `/leads/${id}`); } catch { S.leadItem = null; }
}

async function loadUsers() {
  try { S.users = await api('GET', '/users') || []; } catch {}
}

async function loadAudit() {
  try { S.audit = await api('GET', '/audit') || []; } catch {}
}

async function loadNotifs() {
  try {
    S.notifications = await api('GET', '/notifications') || [];
    S.unread = S.notifications.filter(n => !n.read).length;
    const b = $('nb'); if (b) { b.textContent = S.unread; b.style.display = S.unread ? 'flex' : 'none'; }
  } catch {}
}

async function doLogin(email, password) {
  const data = await api('POST', '/auth/login', { email, password });
  S.token = data.token; S.user = data.user;
  localStorage.setItem('_tok', data.token);
  S.page = 'dashboard';
  S.dtab = null;
  await loadAll();
  render();
}

function logout() {
  api('POST', '/auth/logout').catch(()=>{});
  localStorage.removeItem('_tok');
  S.user = null; S.token = null;
  S.page = 'dashboard';
  S.dtab = null;
  S.tab = 'lead_info';
  S.tenderId = null;
  S.leadId = null;
  S.tenderItem = null;
  S.leadItem = null;
  S.tenders = [];
  S.leads = [];
  S.notifications = [];
  S.unread = 0;
  showLogin();
}

// ---- Render ----
function showLogin() {
  document.body.innerHTML = `
    <div id="tc" class="toast-container"></div>
    <div class="si-wrapper">
      <div class="si-topbar-thin">
        <div class="si-topbar-inner si-flex-between">
          <span>Zivio - The future workforce partner</span>
          <span>Billing entity: Airconnect Infosystems Pvt. Ltd.</span>
        </div>
      </div>
      <div class="si-topbar-broad">
        <div class="si-topbar-inner si-flex-between">
          <div class="si-brand-left">
            <img src="/assets/Zivio.png" alt="Zivio Left" style="height: 80px; object-fit: contain;" />
          </div>
          <div class="si-brand-right">
            <img src="/assets/ziviol2.png" alt="Zivio Right" style="height: 80px; object-fit: contain;" />
          </div>
        </div>
      </div>
      <div class="si-main-area">
        <div class="si-left-panel">
          <div class="si-left-content-inner">
            <div class="si-fade-block" id="heroTextBlock">
            </div>
            
            <div class="si-pill-tags" id="heroPillTags">
            </div>

            <div class="si-graphic-container">
              <div class="si-float-card card-ai" id="card-ai">
                <div class="fc-header">
                  <span>AI Insights</span>
                  <span class="fc-badge">AI</span>
                </div>
                <div class="fc-body">Revenue is trending up</div>
                <div class="fc-stat">+18%</div>
                <svg class="fc-chart" viewBox="0 0 100 30" preserveAspectRatio="none">
                  <path d="M0 30 Q 20 20, 40 25 T 80 10 T 100 5 L 100 30 Z" fill="rgba(86,81,246,0.1)"/>
                  <path d="M0 30 Q 20 20, 40 25 T 80 10 T 100 5" fill="none" stroke="#5651f6" stroke-width="2"/>
                </svg>
              </div>
              <div class="si-float-card card-leave" id="card-leave">
                <div class="fc-header">Leave Requests</div>
                <div class="fc-body-sm">12 Pending Approvals</div>
                <div class="fc-avatars">
                  <div class="fc-avatar" style="background: #f87171">A</div>
                  <div class="fc-avatar" style="background: #60a5fa">B</div>
                  <div class="fc-avatar" style="background: #34d399">C</div>
                  <span class="fc-view-all">View all</span>
                </div>
              </div>
              <div class="si-float-card card-payroll" id="card-payroll">
                <div class="fc-icon-circle">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>
                </div>
                <div>
                  <div class="fc-title">Payroll Run</div>
                  <div class="fc-subtitle">June 2026</div>
                </div>
                <div class="fc-badge-green">Completed</div>
              </div>
            </div>
            
            <div class="si-trusted-footer">
              <div class="si-trusted-item">
                <span class="si-shield-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5651f6" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                </span>
                <div>
                  <div class="si-trusted-title">Enterprise-grade security</div>
                  <div class="si-trusted-sub">SOC 2 Type II • GDPR Compliant</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="si-right-panel">
          <div class="si-form-container">
            <div class="si-card-header">
              <h2>Welcome back</h2>
              <p>Sign in to your Zivio workspace</p>
            </div>
            <form id="lf">
              <div class="si-form-group">
                <label>Work Email</label>
                <div class="si-input-wrapper">
                  <span class="si-input-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><path d="M22 6l-10 7L2 6"/></svg>
                  </span>
                  <input class="si-input" type="email" id="le" placeholder="you@company.com" autocomplete="email" required>
                </div>
              </div>
              <div class="si-form-group">
                <label>Password</label>
                <div class="si-input-wrapper">
                  <span class="si-input-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  </span>
                  <input class="si-input" type="password" id="lp" placeholder="••••••••" autocomplete="current-password" required>
                  <button type="button" class="si-pw-toggle" id="lshow">Show</button>
                </div>
              </div>
              <div id="lerr" style="display:none; color: #ef4444; font-size: 13px; margin-bottom: 16px;"></div>
              <div class="si-form-options">
                <label class="si-checkbox-label">
                  <input type="checkbox" id="lrem"> Remember me
                </label>
                <a href="#" class="si-forgot-link">Forgot password?</a>
              </div>
              <button class="si-btn-primary" type="submit" id="lbtn">Sign in &rarr;</button>
              
              <div class="si-ai-banner">
                <span class="si-ai-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5651f6" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                </span>
                <div id="aiTipBlock" style="flex: 1;">
                </div>
                <span class="si-ai-arrow">&rarr;</span>
              </div>
            </form>
          </div>
        </div>
      </div>
      <div class="si-topbar-thin">
        <div class="si-topbar-inner si-flex-between">
          <span>Zivio - The future workforce partner</span>
          <span>Billing entity: Airconnect Infosystems Pvt. Ltd.</span>
        </div>
      </div>
    </div>
  `;

  const features = [
    { id: "ai", tagTitle: "AI Insights", tagIcon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>', title1: "AI-Powered CRM.", title2: "Revenue-First Future.", desc: "Zivio CRM brings together automation, intelligence, and human connection to build high-performing teams." },
    { id: "leave", tagTitle: "Smart Automation", tagIcon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>', title1: "Streamline Tasks.", title2: "Zero Friction.", desc: "Automate approvals, leave tracking, and daily HR routines to free up your team's valuable time." },
    { id: "payroll", tagTitle: "People Analytics", tagIcon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>', title1: "Data Insights.", title2: "Clear Decisions.", desc: "Turn raw workforce data into actionable insights for engagement, retention, and strategic growth." }
  ];
  const aiTips = [
    { title: "AI is working for you", desc: "Ziva helps you save time, reduce manual work, and make smarter people decisions." },
    { title: "Automated Compliance", desc: "We stay on top of the latest regulations so your HR policies are always up to date." },
    { title: "Smart Onboarding", desc: "Provide new hires with an AI-guided journey for a seamless and engaging first day." }
  ];
  let activeFeatIdx = 0;
  let activeTipIdx = 0;

  const heroText = document.getElementById('heroTextBlock');
  const heroTags = document.getElementById('heroPillTags');
  const tipBlock = document.getElementById('aiTipBlock');
  const cards = [document.getElementById('card-ai'), document.getElementById('card-leave'), document.getElementById('card-payroll')];

  function renderFeature() {
    const f = features[activeFeatIdx];
    heroText.innerHTML = `<h1 class="si-hero-title">${f.title1}<br><span class="si-text-primary">${f.title2}</span></h1><p class="si-hero-desc">${f.desc}</p>`;
    heroText.style.animation = 'none';
    void heroText.offsetWidth;
    heroText.style.animation = 'fade-in 0.5s ease-out forwards';

    heroTags.innerHTML = features.map((feat, i) => `<span class="si-tag ${i === activeFeatIdx ? 'si-tag-active' : ''}">${feat.tagIcon}${feat.tagTitle}</span>`).join('');
    
    cards.forEach((c, i) => {
      if (i === activeFeatIdx) {
        c.classList.remove('card-inactive'); c.classList.add('card-active');
      } else {
        c.classList.remove('card-active'); c.classList.add('card-inactive');
      }
    });
  }

  function renderTip() {
    const t = aiTips[activeTipIdx];
    tipBlock.innerHTML = `<strong>${t.title}</strong><p>${t.desc}</p>`;
    tipBlock.style.animation = 'none';
    void tipBlock.offsetWidth;
    tipBlock.style.animation = 'fade-in 0.5s ease-out forwards';
  }

  renderFeature();
  renderTip();

  if (window.featTimer) clearInterval(window.featTimer);
  if (window.tipTimer) clearInterval(window.tipTimer);
  
  window.featTimer = setInterval(() => { activeFeatIdx = (activeFeatIdx + 1) % features.length; renderFeature(); }, 4500);
  window.tipTimer = setInterval(() => { activeTipIdx = (activeTipIdx + 1) % aiTips.length; renderTip(); }, 5500);

  document.getElementById('lshow').onclick = () => {
    const pw = document.getElementById('lp');
    const isPwd = pw.type === 'password';
    pw.type = isPwd ? 'text' : 'password';
    document.getElementById('lshow').textContent = isPwd ? 'Hide' : 'Show';
  };

  document.getElementById('lf').onsubmit = async e => {
    e.preventDefault();
    const btn = document.getElementById('lbtn'); btn.disabled=true; btn.innerHTML='<span class="si-spinner"></span>';
    const err = document.getElementById('lerr'); err.style.display='none';
    try { 
      await doLogin(document.getElementById('le').value, document.getElementById('lp').value); 
      clearInterval(window.featTimer);
      clearInterval(window.tipTimer);
    }
    catch(ex) { err.textContent = ex.message; err.style.display='block'; }
    finally { btn.disabled=false; btn.innerHTML='Sign in &rarr;'; }
  };
}

function render() {
  document.body.innerHTML = `
    <div id="tc" class="toast-container"></div>
    <div class="sidebar-overlay" id="sidebarOverlay"></div>
    <div class="layout">
      ${Sidebar()}
      <div class="main-area">${Header()}<div class="content" id="content">${renderPage()}</div></div>
    </div>
    ${S.notifOpen ? NotifPanel() : ''}`;
  attachAll();
}


function Sidebar() {
  const role = S.user?.role;
  const items = [
    {p:'dashboard',l:'Dashboard',i:'⊞',all:true},
    {p:'admin',l:'Admin Panel',i:'◈',roles:['admin']},
  ].filter(x => x.all || x.roles?.includes(role));
  return `
    <aside class="sidebar">
      <div class="sidebar-brand" style="gap: 8px;">
        <img src="/assets/ziviol2.png" alt="ZivioCRM" style="width: 32px; height: 32px; object-fit: contain; border-radius: 6px;" />
        <div><div class="brand-name">ZivioCRM</div><div class="brand-tag">ISP Tender Management</div></div>
      </div>
      <nav class="sidebar-nav">
        ${items.map(x=>`
          <button class="nav-item ${S.page===x.p&&!S.tenderId?'active':''}" data-nav="${x.p}">
            <span class="nav-icon">${x.i}</span><span class="nav-label">${x.l}</span>
            ${x.p==='dashboard'&&S.unread?`<span class="nav-badge">${S.unread}</span>`:''}
          </button>`).join('')}
      </nav>
      <div class="sidebar-footer">
        <div class="avatar">${(S.user?.name||'U')[0].toUpperCase()}</div>
        <div style="flex:1;min-width:0"><div class="user-name">${esc(S.user?.name||'')}</div><div class="user-role">${roleLabel(role)}</div></div>
        <button class="logout-btn" id="logoutBtn" title="Logout">⏻</button>
      </div>
    </aside>`;
}

function Header() {
  const t = {dashboard:'Dashboard',tenders:'Phase 1 & 3: Tenders',leads:'Phase 1 & 3: Leads',technical:'Phase 2 & 4: Technical',billing:'Phase 5: Billing & Accounts',admin:'Administration'}[S.page]||'ZivioCRM';
  return `
    <header class="topbar">
      <button class="icon-btn mobile-only" id="menuBtn" title="Menu" style="margin-right: 12px; font-size: 18px;">☰</button>
      <div class="topbar-title">${t}</div>
      <div class="page-actions">
        <button class="icon-btn" id="nb-btn" title="Notifications">🔔
          <span class="notif-badge" id="nb" style="display:${S.unread?'flex':'none'}">${S.unread}</span>
        </button>
      </div>
    </header>`;
}

// ---- Pipeline ----
function Pipeline(stage) {
  const STEPS = [
    {l:'Ph1: Tender',stages:['ph1_draft','ph1_complete']},
    {l:'Ph2: Technical',stages:['ph2_active','ph2_complete']},
    {l:'Ph3: Award',stages:['ph3_active','ph3_awarded','ph3_disqualified']},
    {l:'Ph4: Delivery',stages:['ph4_active','ph4_complete']},
    {l:'Ph5: Billing',stages:['ph5_active','closed']}
  ];
  const ci = STAGES.indexOf(stage);
  let html = '<div class="pipeline">';
  STEPS.forEach((step, si) => {
    const active = step.stages.includes(stage);
    let done = ci > STAGES.indexOf(step.stages[step.stages.length-1]);
    if (stage === 'ph3_disqualified' && si > 2) done = false; // dead end
    const cls = active ? (stage === 'ph3_disqualified' ? 'active-error' : 'active') : done ? 'done' : '';
    const label = (stage === 'ph3_disqualified' && si === 2) ? 'Disqualified' : step.l;
    html += `<div class="pip-step"><div class="pip-node">
      <div class="pip-dot ${cls}">${done?'✓':(stage==='ph3_disqualified'&&si===2)?'⨯':si+1}</div>
      <div class="pip-lbl ${cls}">${label}</div>
    </div></div>`;
    if (si < STEPS.length-1) html += `<div class="pip-line ${done?'done':''}"></div>`;
  });
  return html + '</div>';
}

// ---- Pages ----
function renderPage() {
  switch(S.page) {
    case 'dashboard': return PageDashboard();
    case 'leads':     return S.leadId ? LeadDetail() : PageLeads();
    case 'tenders':   return S.tenderId ? PageDetail() : PageTenders();
    case 'technical': return S.tenderId ? PageDetail() : PageTechnical();
    case 'billing':   return S.tenderId ? PageDetail() : PageBilling();
    case 'admin':     return PageAdmin();
    default: return PageDashboard();
  }
}

// ---- Dashboard ----
function PageDashboard() {
  const role = S.user?.role;
  const canSeeTenders = ['tender','admin','mgmt','tech','acct'].includes(role);
  const canSeeLeads = ['lead','admin','mgmt','tech','acct'].includes(role);
  const isTech = role === 'tech';
  const showCircuit = ['tech', 'acct'].includes(role);
  const useTabs = ['tech','acct','admin','mgmt'].includes(role);
  const canSeeAnalytics = ['admin','mgmt'].includes(role);
  
  if (useTabs && !S.dtab) {
    S.dtab = canSeeAnalytics ? 'analytics' : 'tenders';
  }

  let html = '';

  if (useTabs) {
    html += `
      <div class="tabs" style="margin-bottom: 20px;">
        ${canSeeAnalytics ? `<button class="tab-btn ${S.dtab === 'analytics' ? 'active' : ''}" data-dtab="analytics">Dashboard</button>` : ''}
        <button class="tab-btn ${S.dtab === 'tenders' ? 'active' : ''}" data-dtab="tenders">Tenders</button>
        <button class="tab-btn ${S.dtab === 'leads' ? 'active' : ''}" data-dtab="leads">Leads</button>
      </div>
    `;
  }

  html += `
    <div class="dash-filters" style="display:flex; gap:12px; margin-bottom: 20px;">
      <input type="text" id="dashSearch" class="form-input" placeholder="Search by Customer, Address, Circuit..." style="flex:1" autocomplete="off" />
      <select id="dashFilterStage" class="form-input" style="width:200px">
        <option value="">All Stages</option>
        ${STAGES.map(s => `<option value="${s}">${s.replace(/_/g, ' ').toUpperCase()}</option>`).join('')}
      </select>
    </div>
  `;

  const renderLeads = () => {
    const leads = (S.leads || []).map(l => ({ ...l, _type: 'Lead' })).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    return `
      <div class="card" style="margin-bottom:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <div class="sec-title" style="margin-bottom:0;flex:1">Leads Overview</div>
          <div style="display:flex;gap:8px;">
            ${['lead','admin'].includes(role) ? '<button class="btn btn-primary btn-sm" id="btnNewLead">+ New Lead</button>' : ''}
          </div>
        </div>
        ${leads.length ? `
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>S.No</th>
                  ${isTech ? '<th>Lead</th>' : ''}
                  <th>Order Number</th>
                  <th>Customer</th>
                  <th>Address</th>
                  ${isTech ? '<th>Link Type</th>' : '<th>Value</th>'}
                  <th>Contract Period</th>
                  <th>Bandwidth</th>
                  ${showCircuit ? '<th>Circuit Number</th>' : ''}
                  <th>Stage</th>
                </tr>
              </thead>
              <tbody>
                ${leads.map((acc, i) => {
                  const alert = checkAlert(acc);
                  const searchStr = `${esc(acc.org_name || '')} ${esc(acc.link_delivery_address || '')} ${esc(acc.service_type || '')} ${(acc.circuits||[]).map(c=>c.circuit_id).join(' ')}`;
                  return `
                  <tr class="tr-link dash-row ${alert ? 'alert-blinking' : ''}" data-lnav="${acc.id}" data-stage="${acc.stage}" data-search="${searchStr}">
                    <td>${i + 1}</td>
                    ${isTech ? '<td><span class="badge b-gray">Lead</span></td>' : ''}
                    <td>${esc(acc.requirements?.order_number || '-')}</td>
                    <td style="font-weight:600">${esc(acc.org_name || '-')}</td>
                    <td>${esc(acc.link_delivery_address || '-')}</td>
                    ${isTech ? `<td>${esc(acc.service_type || '-')}</td>` : `<td style="font-weight:600">${fmt(acc.quoted_bid_value, 'currency')}</td>`}
                    <td>${esc(acc.contract_period || '-')}</td>
                    <td>${acc.bandwidth_mbps ? acc.bandwidth_mbps + ' Mbps' : '-'}</td>
                    ${showCircuit ? `<td>${(acc.circuits||[]).map(c=>`<span class="badge" style="background:var(--blue);color:#fff;margin-right:4px">${esc(c.circuit_id)}</span>`).join('') || '-'}</td>` : ''}
                    <td>${stageBadge(acc.stage)} ${alert ? `<button class="alert-silence-btn" data-silence="${acc.id}" title="Silence Alert">🔕</button>` : ''}</td>
                  </tr>
                `}).join('')}
              </tbody>
            </table>
          </div>` : 
          `<div class="empty"><div class="empty-icon">📋</div><div class="empty-title">No leads yet</div>
           <div class="empty-sub">Create your first lead to get started</div></div>`}
      </div>`;
  };

  const renderTenders = () => {
    const tenders = (S.tenders || []).map(t => ({ ...t, _type: 'Tender' })).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    return `
      <div class="card" style="margin-bottom:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <div class="sec-title" style="margin-bottom:0;flex:1">Tenders Overview</div>
          <div style="display:flex;gap:8px;">
            ${['tender','admin'].includes(role) ? '<button class="btn btn-primary btn-sm" id="btnNewTender">+ New Tender</button>' : ''}
          </div>
        </div>
        ${tenders.length ? `
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>S.No</th>
                  ${isTech ? '<th>Tender</th>' : ''}
                  <th>Order Number</th>
                  <th>Customer</th>
                  <th>Address</th>
                  ${isTech ? '<th>Link Type</th>' : '<th>Value</th>'}
                  <th>Contract Period</th>
                  <th>Bandwidth</th>
                  ${showCircuit ? '<th>Circuit Number</th>' : ''}
                  <th>Stage</th>
                </tr>
              </thead>
              <tbody>
                ${tenders.map((acc, i) => {
                  const alert = checkAlert(acc);
                  const searchStr = `${esc(acc.org_name || '')} ${esc(acc.link_delivery_address || '')} ${esc(acc.service_type || '')} ${(acc.circuits||[]).map(c=>c.circuit_id).join(' ')}`;
                  return `
                  <tr class="tr-link dash-row ${alert ? 'alert-blinking' : ''}" data-tnav="${acc.id}" data-stage="${acc.stage}" data-search="${searchStr}">
                    <td>${i + 1}</td>
                    ${isTech ? '<td><span class="badge b-gray">Tender</span></td>' : ''}
                    <td>${esc(acc.requirements?.order_number || '-')}</td>
                    <td style="font-weight:600">${esc(acc.org_name || '-')}</td>
                    <td>${esc(acc.link_delivery_address || '-')}</td>
                    ${isTech ? `<td>${esc(acc.service_type || '-')}</td>` : `<td style="font-weight:600">${fmt(acc.quoted_bid_value, 'currency')}</td>`}
                    <td>${esc(acc.contract_period || '-')}</td>
                    <td>${acc.bandwidth_mbps ? acc.bandwidth_mbps + ' Mbps' : '-'}</td>
                    ${showCircuit ? `<td>${(acc.circuits||[]).map(c=>`<span class="badge" style="background:var(--blue);color:#fff;margin-right:4px">${esc(c.circuit_id)}</span>`).join('') || '-'}</td>` : ''}
                    <td>${stageBadge(acc.stage)} ${alert ? `<button class="alert-silence-btn" data-silence="${acc.id}" title="Silence Alert">🔕</button>` : ''}</td>
                  </tr>
                `}).join('')}
              </tbody>
            </table>
          </div>` : 
          `<div class="empty"><div class="empty-icon">📋</div><div class="empty-title">No tenders yet</div>
           <div class="empty-sub">Create your first tender to get started</div></div>`}
      </div>`;
  };

  if (useTabs) {
    if (S.dtab === 'analytics') html += renderAnalytics();
    else if (S.dtab === 'tenders') html += renderTenders();
    else if (S.dtab === 'leads') html += renderLeads();
  } else {
    if (canSeeLeads) html += renderLeads();
    if (canSeeTenders) html += renderTenders();
  }
  
  if (!html) {
    html = `<div class="empty"><div class="empty-title">No access</div></div>`;
  }

  return html;
}

function renderAnalytics() {
  const role = S.user?.role;
  if (!['admin','mgmt'].includes(role)) return '';
  
  const filter = S.analyticsFilter || '30d';
  const now = new Date();
  
  const filterDate = (dateStr) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (filter === 'all') return true;
    if (filter === '30d') return (now - d) <= 30 * 24 * 60 * 60 * 1000;
    if (filter === '90d') return (now - d) <= 90 * 24 * 60 * 60 * 1000;
    if (filter === 'this_year') return d.getFullYear() === now.getFullYear();
    return true;
  };

  const leads = S.leads || [];
  const tenders = S.tenders || [];
  
  const filteredLeads = leads.filter(l => filterDate(l.created_at));
  const filteredTenders = tenders.filter(t => filterDate(t.created_at));

  // KPIs
  const totalLeads = filteredLeads.length;
  const liveTenders = filteredTenders.filter(t => !['closed', 'ph3_disqualified'].includes(t.stage)).length;
  const awardedTenders = filteredTenders.filter(t => t.stage === 'ph3_awarded').length;
  
  let revenue = 0;
  let pendingBilling = 0;
  let activeProjects = 0;
  let totalInvoices = 0;
  let totalCollected = 0;
  let overdueInvoices = 0;
  let outstanding = 0;
  let paidToday = 0;

  const allItems = [...filteredTenders, ...filteredLeads];

  allItems.forEach(t => {
    revenue += parseFloat(t.quoted_bid_value || 0);
    if (t.stage === 'ph5_active') pendingBilling += parseFloat(t.quoted_bid_value || 0);
    if (['ph4_active', 'ph4_complete', 'ph5_active'].includes(t.stage)) activeProjects++;

    if (t.payment_cycles) {
      t.payment_cycles.forEach(c => {
        const due = parseFloat(c.amount_due || 0);
        const rec = parseFloat(c.amount_received || 0);
        totalInvoices += due;
        totalCollected += rec;
        if (due > rec) {
          outstanding += (due - rec);
          if (c.period_to && new Date(c.period_to) < now) overdueInvoices += (due - rec);
        }
        if (c.payment_date && filterDate(c.payment_date)) paidToday += rec;
      });
    }
  });

  const formatRev = (v) => {
    if (v >= 10000000) return '₹' + (v / 10000000).toFixed(2) + ' Cr';
    if (v >= 100000) return '₹' + (v / 100000).toFixed(2) + ' L';
    return '₹' + v.toLocaleString('en-IN');
  };

  // Pipeline Data
  let pipeLeads = filteredLeads.filter(l => ['ph1_draft', 'ph1_complete'].includes(l.stage)).length;
  let pipeDraft = filteredTenders.filter(t => ['ph1_draft', 'ph1_complete'].includes(t.stage)).length;
  let pipeTech = allItems.filter(t => ['ph2_active', 'ph2_complete'].includes(t.stage)).length;
  let pipeAwarded = allItems.filter(t => t.stage === 'ph3_awarded').length;
  let pipeBilling = allItems.filter(t => t.stage === 'ph5_active').length;

  // Analytics Data Mapping
  const data = {
    filter: filter,
    role: role,
    kpis: {
      totalLeads: { value: totalLeads },
      liveTenders: { value: liveTenders },
      awarded: { value: awardedTenders },
      activeProjects: { value: activeProjects },
      revenue: { value: revenue },
      pendingBilling: { value: pendingBilling },
    },
    pipeline: [
      { label: 'Leads', value: pipeLeads, colorClass: 'p-blue' },
      { label: 'Tender', value: pipeDraft, colorClass: 'p-purple' },
      { label: 'Technical', value: pipeTech, colorClass: 'p-amber' },
      { label: 'Awarded', value: pipeAwarded, colorClass: 'p-green' },
      { label: 'Billing', value: pipeBilling, colorClass: 'p-pink' },
    ],
    billing: {
      pendingInvoices: totalInvoices,
      overdueBilling: overdueInvoices,
      totalOutstanding: outstanding,
      collected: totalCollected,
    },
    revenueByService: [],
    customerDistribution: [],
    tenderOverview: [],
    monthlyRevenue: [],
    opportunitySource: [],
    upcomingDeadlines: [],
    quickActions: [
      { label: '+ Add New Lead', id: 'btnDashNewLead', iconKey: 'lead', show: ['lead','admin','mgmt'].includes(role) },
      { label: '+ Add New Tender', id: 'btnDashNewTender', iconKey: 'tender', show: ['tender','admin','mgmt'].includes(role) }
    ],
    recentActivity: []
  };

  // Revenue by Service Type
  const srvMap = {};
  allItems.forEach(t => {
    const s = t.service_type || 'Other';
    srvMap[s] = (srvMap[s] || 0) + parseFloat(t.quoted_bid_value || 0);
  });
  data.revenueByService = Object.entries(srvMap).sort((a,b)=>b[1]-a[1]).map(e => ({ label: e[0], value: e[1] }));

  // Customer Distribution
  const custMap = {};
  allItems.forEach((t) => {
    if (!t.org_name) return;
    const org = t.org_name.toLowerCase();
    let type = 'Enterprise';
    if (org.includes('govt') || org.includes('government') || org.includes('ministry')) type = 'Government';
    else if (org.includes('psu') || org.includes('ltd') || org.includes('limited')) type = 'PSU';
    custMap[type] = (custMap[type] || 0) + 1;
  });
  data.customerDistribution = Object.entries(custMap).map(e => ({ label: e[0], value: e[1] }));

  // Monthly Revenue Trend
  const revMap = {};
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    revMap[d.toLocaleString('en-US', {month:'short'})] = 0;
  }
  allItems.forEach(t => {
    const m = new Date(t.created_at).toLocaleString('en-US', {month:'short'});
    if (revMap[m] !== undefined && t.quoted_bid_value) {
      revMap[m] += parseFloat(t.quoted_bid_value);
    }
  });
  data.monthlyRevenue = Object.entries(revMap).map(e => ({ label: e[0], value: e[1] }));

  // Tender Overview
  const tenderStatus = { 'Awarded': 0, 'In Progress': 0, 'Lost': 0 };
  allItems.forEach(t => {
    if (t.stage === 'ph3_awarded' || t.stage === 'ph4_active' || t.stage === 'ph4_complete' || t.stage === 'ph5_active') tenderStatus['Awarded']++;
    else if (t.stage === 'closed' || t.stage === 'ph3_disqualified') tenderStatus['Lost']++;
    else tenderStatus['In Progress']++;
  });
  data.tenderOverview = Object.entries(tenderStatus).map(e => ({ label: e[0], value: e[1] }));

  // Opportunity Source
  const srcMap = {};
  filteredLeads.forEach((l) => {
    const s = l.org_name || 'Unknown';
    srcMap[s] = (srcMap[s] || 0) + 1;
  });
  data.opportunitySource = Object.entries(srcMap).sort((a,b)=>b[1]-a[1]).map(e => ({ label: e[0], value: e[1] }));

  // Upcoming Deadlines
  let upc = [];
  [...tenders, ...leads].forEach(t => {
    if (['ph1_draft','ph1_complete'].includes(t.stage) && t.bid_end_datetime) {
      const d = new Date(t.bid_end_datetime);
      upc.push({ customer: t.org_name, phase: 'Bid Submission', dateObj: d, deadline: fmt(d, 'date'), urgent: (d - now) < 7*24*60*60*1000 });
    }
  });
  data.upcomingDeadlines = upc.filter(u => u.dateObj > now).sort((a,b)=>a.dateObj-b.dateObj).slice(0, 4);

  // Recent Activity
  data.recentActivity = (S.audit||[]).slice(0, 10).map(a => {
    let detailsObj = null;
    if (a.details) {
      try {
        detailsObj = typeof a.details === 'string' ? JSON.parse(a.details) : a.details;
      } catch(e){}
    }
    return {
      actor: a.users?.name,
      action: a.action,
      entityType: a.entity_type,
      details: detailsObj,
      timeAgo: timeAgo(a.created_at)
    };
  });

  return renderAnalyticsDashboard(data);
}

function PageTenders() {
  const role = S.user?.role, list = S.tenders;
  return `
    <div class="page-header">
      <div><div class="page-title">Tenders</div><div class="page-sub">${list.length} tenders</div></div>
      <div class="page-actions">
        ${['tender','admin'].includes(role)?`<button class="btn btn-primary" id="btnNewTenderPage">+ New Tender</button>`:''}
      </div>
    </div>
    ${list.length?`
      <div class="table-wrap"><table>
        <thead><tr><th>Bid #</th><th>Order Number</th><th>Title</th><th>Organisation</th><th>Stage</th><th>Value</th><th>Due Date</th></tr></thead>
        <tbody>${list.map(t=>`
          <tr class="tr-link" data-tnav="${t.id}">
            <td style="font-size:11px;color:var(--text2);font-weight:600">${esc(t.bid_number||'-')}</td>
            <td>${esc(t.requirements?.order_number || '-')}</td>
            <td><div class="tbl-link">${esc(t.title)}</div></td>
            <td>${esc(t.org_name||'—')}</td><td>${stageBadge(t.stage)}</td>
            <td style="font-weight:700">${fmt(t.quoted_bid_value,'currency')}</td>
            <td>${fmt(t.bid_end_datetime,'date')}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`:
      `<div class="empty"><div class="empty-icon">🔍</div><div class="empty-title">No tenders</div></div>`}`;
}

// ---- Technical Page ----
function PageTechnical() {
  const tList = S.tenders || [];
  const lList = S.leads || [];
  const tPending = tList.filter(t=>['ph2_active','ph4_active'].includes(t.stage));
  const lPending = lList.filter(t=>['ph2_active','ph4_active'].includes(t.stage));
  const totalPending = tPending.length + lPending.length;
  
  return `
    <div class="page-header"><div><div class="page-title">Technical Review (Ph2/4)</div>
      <div class="page-sub">${totalPending} pending action</div></div></div>
      
    <div class="sec-title" style="margin-top:20px;">Tenders</div>
    ${tList.length?`
      <div class="table-wrap"><table>
        <thead>
          <tr>
            <th>S.No</th>
            <th>Tender</th>
            <th>Customer</th>
            <th>Address</th>
            <th>Link Type</th>
            <th>Contract Period</th>
            <th>Bandwidth</th>
            <th>Circuit Number</th>
            <th>Stage</th>
          </tr>
        </thead>
        <tbody>${tList.map((t, i)=>`
          <tr class="tr-link" data-tnav="${t.id}">
            <td>${i+1}</td>
            <td><span class="badge b-gray">Tender</span></td>
            <td style="font-weight:600">${esc(t.org_name||'-')}</td>
            <td>${esc(t.link_delivery_address||'-')}</td>
            <td>${esc(t.service_type||'-')}</td>
            <td>${esc(t.contract_period||'-')}</td>
            <td>${t.bandwidth_mbps ? t.bandwidth_mbps + ' Mbps' : '-'}</td>
            <td>${(t.circuits||[]).map(c=>`<span class="badge" style="background:var(--blue);color:#fff;margin-right:4px">${esc(c.circuit_id)}</span>`).join('') || '-'}</td>
            <td>${stageBadge(t.stage)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`:
      `<div class="empty"><div class="empty-icon">⚙</div><div class="empty-title">No technical tasks for tenders</div></div>`}
      
    <div class="sec-title" style="margin-top:32px;">Leads</div>
    ${lList.length?`
      <div class="table-wrap"><table>
        <thead>
          <tr>
            <th>S.No</th>
            <th>Lead</th>
            <th>Customer</th>
            <th>Address</th>
            <th>Link Type</th>
            <th>Contract Period</th>
            <th>Bandwidth</th>
            <th>Circuit Number</th>
            <th>Stage</th>
          </tr>
        </thead>
        <tbody>${lList.map((t, i)=>`
          <tr class="tr-link" data-lnav="${t.id}">
            <td>${i+1}</td>
            <td><span class="badge b-gray">Lead</span></td>
            <td style="font-weight:600">${esc(t.org_name||'-')}</td>
            <td>${esc(t.link_delivery_address||'-')}</td>
            <td>${esc(t.service_type||'-')}</td>
            <td>${esc(t.contract_period||'-')}</td>
            <td>${t.bandwidth_mbps ? t.bandwidth_mbps + ' Mbps' : '-'}</td>
            <td>${(t.circuits||[]).map(c=>`<span class="badge" style="background:var(--blue);color:#fff;margin-right:4px">${esc(c.circuit_id)}</span>`).join('') || '-'}</td>
            <td>${stageBadge(t.stage)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`:
      `<div class="empty"><div class="empty-icon">⚙</div><div class="empty-title">No technical tasks for leads</div></div>`}
  `;
}

// ---- Billing Page ----
function PageBilling() {
  const tList = S.tenders || [];
  const lList = S.leads || [];
  const total = tList.length + lList.length;
  
  return `
    <div class="page-header"><div><div class="page-title">Billing & Accounts (Ph5)</div>
      <div class="page-sub">${total} total</div></div></div>
      
    <div class="sec-title" style="margin-top:20px;">Tenders</div>
    ${tList.length?`
      <div class="table-wrap"><table>
        <thead><tr><th>Tender</th><th>Customer</th><th>Value</th><th>Stage</th></tr></thead>
        <tbody>${tList.map(t=>`
          <tr class="tr-link" data-tnav="${t.id}">
            <td><div class="tbl-link">${esc(t.title)}</div><div style="font-size:11px;color:var(--text2)">${esc(t.bid_number||'')}</div></td>
            <td>${esc(t.org_name||'-')}</td><td style="font-weight:700">${fmt(t.total_bid_value,'currency')}</td>
            <td>${stageBadge(t.stage)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`:
      `<div class="empty"><div class="empty-icon">💰</div><div class="empty-title">No tender billing items yet</div></div>`}
      
    <div class="sec-title" style="margin-top:32px;">Leads</div>
    ${lList.length?`
      <div class="table-wrap"><table>
        <thead><tr><th>Lead</th><th>Customer</th><th>Value</th><th>Stage</th></tr></thead>
        <tbody>${lList.map(t=>`
          <tr class="tr-link" data-lnav="${t.id}">
            <td><div class="tbl-link">${esc(t.title)}</div><div style="font-size:11px;color:var(--text2)">${esc(t.bid_number||'')}</div></td>
            <td>${esc(t.org_name||'-')}</td><td style="font-weight:700">${fmt(t.total_bid_value,'currency')}</td>
            <td>${stageBadge(t.stage)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`:
      `<div class="empty"><div class="empty-icon">💰</div><div class="empty-title">No lead billing items yet</div></div>`}
  `;
}

// ---- Admin Page ----
function PageAdmin() {
  return `
    <div class="page-header">
      <div class="page-title">Administration</div>
    </div>
    <div class="tabs">
      ${['users','audit'].map(t=>`<button class="tab-btn ${S.adminTab===t?'active':''}" data-atab="${t}">${{users:'Users',audit:'Audit Log'}[t]}</button>`).join('')}
    </div>
    <div id="atab-content">${renderAdminTab()}</div>`;
}

function renderAdminTab() {
  if (S.adminTab==='audit') return `
    <div class="table-wrap"><table>
      <thead><tr><th>Time</th><th>Action</th><th>Entity</th><th>User</th></tr></thead>
      <tbody>${S.audit.slice(0,80).map(l=>{
        let det = '';
        if (l.details) {
          try {
            const d = typeof l.details === 'string' ? JSON.parse(l.details) : l.details;
            const ks = Object.keys(d);
            if (ks.length) det = '<div style="font-size:10.5px; color:var(--text3); margin-top:4px;">' + ks.map(k => esc(k) + ': ' + esc(d[k])).join(' | ') + '</div>';
          } catch(e){}
        }
        return `
        <tr><td style="color:var(--text2);font-size:11.5px;white-space:nowrap">${timeAgo(l.created_at)}</td>
        <td>
          <span class="badge b-blue">${esc(l.action)}</span>
          ${det}
        </td>
        <td style="font-size:12px;color:var(--text2)">${esc(l.entity_type)}</td>
        <td style="font-size:11px;color:var(--text3)">${(l.user_id||'').slice(0,8)}</td></tr>`;
      }).join('')}
      ${!S.audit.length?`<tr><td colspan="4"><div class="empty"><div class="empty-icon">📋</div><div class="empty-title">No logs yet</div></div></td></tr>`:''}
      </tbody>
    </table></div>`;

  return `
    <div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Department</th><th>Status</th></tr></thead>
      <tbody>${S.users.map(u=>`
        <tr><td><div style="display:flex;align-items:center;gap:10px">
          <div class="avatar" style="width:28px;height:28px;font-size:11px">${(u.name||'U')[0]}</div>
          <span style="font-weight:600">${esc(u.name)}</span></div></td>
          <td style="color:var(--text2)">${esc(u.email)}</td>
          <td><span class="badge b-blue">${roleLabel(u.role)}</span></td>
          <td style="color:var(--text2)">${esc(u.department||'-')}</td>
          <td><span class="badge ${u.status==='active'?'b-green':'b-red'}">${u.status}</span></td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
}

function NotifPanel() {
  return `
    <div class="notif-panel">
      <div class="notif-hdr">
        <div>Notifications</div>
        ${S.unread ? `<button class="btn btn-ghost btn-sm" id="rdAllBtn" style="padding:2px 8px">Mark All Read</button>` : ''}
      </div>
      <div class="notif-list">
        ${S.notifications.map(n => `
          <div class="notif-item ${!n.read?'unread':''}" ${n.tender_id?`onclick="const isTender=(S.tenders||[]).find(x=>x.id==='${n.tender_id}');if(isTender){S.tenderId='${n.tender_id}';S.page='tenders';loadTender('${n.tender_id}').then(()=>render());}else{S.leadId='${n.tender_id}';S.page='leads';loadLead('${n.tender_id}').then(()=>render());}"`:''}>
            <div class="notif-t">${esc(n.title)}</div>
            <div class="notif-m">${esc(n.message)}</div>
            <div class="notif-time">${timeAgo(n.created_at)}</div>
          </div>
        `).join('')}
        ${!S.notifications.length ? `<div style="padding:30px;text-align:center;color:var(--text2)">No notifications</div>` : ''}
      </div>
    </div>`;
}

// ---- Tender Detail ----
function PageDetail() {
  const t = S.tender;
  if (!t) return `<div class="loading"><div class="spinner"></div> Loading...</div>`;
  const role = S.user?.role;
  const tabs = detailTabs(t, role);
  
  // fallback if tab is not available
  if (tabs.length > 0 && !tabs.find(tb=>tb.k===S.tab)) S.tab = tabs[0].k;

  return `
    <button class="back-btn" id="backTenderBtn">← Back</button>
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:14px;flex-wrap:wrap">
      <div>
        <h1 style="font-size:19px;font-weight:800;margin-bottom:6px">${esc(t.title)}</h1>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${stageBadge(t.stage)}
          ${t.bid_number?`<span style="font-size:12px;color:var(--text2)">${esc(t.bid_number)}</span>`:''}
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${ActionBtns(t,role)}</div>
    </div>
    ${Pipeline(t.stage)}
    <div class="tabs">${tabs.map(tb=>`<button class="tab-btn ${S.tab===tb.k?'active':''}" data-tab="${tb.k}">${tb.l}</button>`).join('')}</div>
    <div id="tab-body" style="padding-top:16px">${renderTab(t,S.tab,role)}</div>`;
}

function detailTabs(t, role) {
  const ALL = STAGES;
  const si = ALL.indexOf(t.stage);
  const tabs = [];
  if (role === 'tender' || role === 'admin') {
      tabs.push({k:'tender_info',l:'Phase 1: Tender'});
  }
  if (si >= ALL.indexOf('ph2_active')) tabs.push({k:'technical',l:'Phase 2: Technical'});
  if (role !== 'tech' && si >= ALL.indexOf('ph3_active')) tabs.push({k:'award',l:'Phase 3: Award'});
  if (si >= ALL.indexOf('ph4_active')) tabs.push({k:'delivery',l:'Phase 4: Delivery'});
  if (si >= ALL.indexOf('ph5_active')) tabs.push({k:'billing',l:'Phase 5: Billing'});
  return tabs;
}

function ActionBtns(t, role) {
  const btns = [];
  if (role === 'admin') btns.push(`<button class="btn btn-ghost btn-sm" data-modal="override-stage">Override Stage</button>`);
  
  if (role === 'tender' || role === 'admin') {
     if (t.stage === 'ph1_draft') btns.push(`<button class="btn btn-primary btn-sm" id="btnSubmitPh1Tender">Submit to Technical (Ph2)</button>`);
     if (t.stage === 'ph3_active') btns.push(`<button class="btn btn-primary btn-sm" data-modal="ph3-award">Declare Award / Disqualify / Qualified</button>`);
  }
  if (role === 'tech' || role === 'admin') {
     if (t.stage === 'ph2_active') btns.push(`<button class="btn btn-primary btn-sm" data-modal="ph2-report">Submit Technical Report</button>`);
     if (t.stage === 'ph4_active') btns.push(`<button class="btn btn-primary btn-sm" data-modal="ph4-deliver">Mark Delivered (Ph4)</button>`);
  }
  return btns.join('');
}

function renderTab(t, tab, role) {
  switch(tab) {
    case 'tender_info': return TabTenderInfo(t, role);
    case 'technical': return TabTechnical(t, role);
    case 'award': return TabAward(t, role);
    case 'delivery': return TabDelivery(t, role);
    case 'billing': return TabBilling(t, role);
    default: return TabTenderInfo(t, role);
  }
}

function inputGroup(id, label, value, type='text', edit=false, options=[]) {
    if (!edit) return `<div class="form-group"><label class="form-label">${label}</label><div class="kbd-val">${esc(value||'-')}</div></div>`;
    if (type === 'textarea') return `<div class="form-group"><label class="form-label">${label}</label><textarea class="form-textarea" id="${id}" rows="3">${esc(value||'')}</textarea></div>`;
    if (type === 'select') return `<div class="form-group"><label class="form-label">${label}</label><select class="form-input" id="${id}">${options.map(o=>`<option value="${o}" ${value===o?'selected':''}>${o}</option>`).join('')}</select></div>`;
    return `<div class="form-group"><label class="form-label">${label}</label><input type="${type}" class="form-input" id="${id}" value="${esc(value||'')}"></div>`;
}

// -- Phase 1 --
function TabTenderInfo(t, role) {
    const edit = (role === 'tender' || role === 'admin') && t.stage === 'ph1_draft';
    return `
      <div class="card">
        <div class="sec-title">Phase 1: Tender Details</div>
        <form id="ph1TenderForm">
        <div class="grid g3">
          ${inputGroup('bid_number','Bid Number *',t.bid_number,'text',edit)}
          ${inputGroup('order_number','Order Number',t.requirements?.order_number,'text',edit)}
          ${inputGroup('bid_init_date','Bid Initiation Date',t.bid_init_date,'date',edit)}
          ${inputGroup('bid_end_datetime','Bid End Date/Time',t.bid_end_datetime,'datetime-local',edit)}
          ${inputGroup('bid_opening_datetime','Bid Opening Date/Time',t.bid_opening_datetime,'datetime-local',edit)}
          ${inputGroup('ministry_state','Ministry/State Name',t.ministry_state,'text',edit)}
          ${inputGroup('org_name','Organisation Name',t.org_name,'text',edit)}
          ${inputGroup('dept_name','Department Name',t.dept_name,'text',edit)}
          <div class="sec-title" style="grid-column:1/-1;margin-top:12px;margin-bottom:8px">Pre-Bid Details</div>
          ${inputGroup('pre_bid_location','Pre-Bid Location',t.pre_bid_location,'text',edit)}
          ${inputGroup('pre_bid_contact','Pre-Bid Contact',t.pre_bid_contact,'text',edit)}
          ${inputGroup('pre_bid_datetime','Pre-Bid Date & Time',t.pre_bid_datetime,'datetime-local',edit)}
          <div class="sec-title" style="grid-column:1/-1;margin-top:12px;margin-bottom:8px">Tender Requirements</div>
          ${inputGroup('contract_period','Contract Period',t.contract_period,'text',edit)}
          ${inputGroup('est_bid_value','Estimated Bid Value (₹)',t.est_bid_value,'number',edit)}
          ${inputGroup('payment_terms','Payment Terms',t.payment_terms,'text',edit)}
          ${inputGroup('service_type','Type of Service',t.service_type,'select',edit,['','ILL','MPLS','BroadBand','P2P','NLD'])}
          ${inputGroup('bandwidth_mbps','Bandwidth (Mbps)',t.bandwidth_mbps,'number',edit)}
          ${inputGroup('ddos_with_ill','DDOS with ILL',t.ddos_with_ill,'select',edit,['','Yes','No','Optional'])}
          ${inputGroup('media_type','Type of Media',t.media_type,'select',edit,['','Fiber','Radio','Copper'])}
          ${inputGroup('static_ip_required','Static IP Required',t.static_ip_required,'select',edit,['','Yes','No'])}
          ${edit || t.static_ip_required === 'Yes' ? `<div id="sip_wrap" style="display:${t.static_ip_required==='Yes'?'contents':'none'}">
             ${inputGroup('num_ipv4','Number of IPv4 Pools',t.num_ipv4,'number',edit)}
             ${inputGroup('num_ipv6','Number of IPv6 Pools',t.num_ipv6,'number',edit)}
          </div>` : ''}
          ${inputGroup('router_accessories','Router/Accessories',t.router_accessories,'select',edit,['','Yes','No'])}
          ${edit || t.router_accessories === 'Yes' ? `<div id="rtr_wrap" style="display:${t.router_accessories==='Yes'?'contents':'none'}">
             ${inputGroup('router_count','Number of Routers/Accessories',t.router_count,'number',edit)}
          </div>` : ''}
          ${inputGroup('total_bid_value','Total Bid Value',t.total_bid_value,'number',edit)}
          ${role !== 'tech' ? inputGroup('gst_number','GST Number',t.gst_number,'text',edit) : ''}
        </div>
        <div class="grid g2">
          ${inputGroup('grievance_contact','Grievance Redressal Contact',t.grievance_contact,'textarea',edit)}
          ${inputGroup('link_delivery_address','Link Delivery Address',t.link_delivery_address,'textarea',edit)}
        </div>
        ${edit ? `<button type="submit" class="btn btn-primary" style="margin-top:16px">Save Phase 1 Draft</button>` : ''}
        </form>
        
        <div class="sec-title" style="margin-top:24px">Tender Documents</div>
        ${edit ? `<label class="upload-zone" id="docTenderDrop" style="margin-bottom:18px"><div class="uz-icon">☁</div><div class="uz-title">Upload Documents</div><input type="file" id="docTenderFile" style="display:none"></label>` : ''}
        <div class="file-list">${(t.documents||[]).map(d=>`
          <div class="file-item"><div class="file-icon">${fileIcon(d.mime)}</div><div style="flex:1">${esc(d.name)}</div>
          <a href="${d.url}" target="_blank" class="btn btn-ghost btn-sm">View</a></div>`).join('')}
        </div>
      </div>
    `;
}

// -- Phase 2 --
function TabTechnical(t, role) {
    const reports = t.technical_reports||[];
    const r = reports[reports.length-1] || {};
    return `
      <div class="card" style="margin-bottom:16px;">
        <div class="sec-title">Phase 1 Summary (Reference)</div>
        <div class="grid g3">
           ${inputGroup('ref_bid','Bid Number',t.bid_number)}
           ${inputGroup('ref_ord','Order Number',t.requirements?.order_number)}
           ${inputGroup('ref_min','Ministry/State Name',t.ministry_state)}
           ${inputGroup('ref_org','Organisation Name',t.org_name)}
           ${inputGroup('ref_dept','Department Name',t.dept_name)}
           ${inputGroup('ref_cp','Contract Period',t.contract_period)}
           ${inputGroup('ref_st','Type of Service',t.service_type)}
           ${inputGroup('ref_bw','Bandwidth (Mbps)',t.bandwidth_mbps)}
           ${inputGroup('ref_ddos','DDOS with ILL',t.ddos_with_ill)}
           ${inputGroup('ref_media','Type of Media',t.media_type)}
           ${inputGroup('ref_sip','Static IP Required',t.static_ip_required)}
           ${t.static_ip_required === 'Yes' ? inputGroup('ref_ipv4','Number of IPv4',t.num_ipv4) : ''}
           ${t.static_ip_required === 'Yes' ? inputGroup('ref_ipv6','Number of IPv6',t.num_ipv6) : ''}
           ${inputGroup('ref_rtr','Router/Accessories',t.router_accessories)}
           ${t.router_accessories === 'Yes' ? inputGroup('ref_rtr_cnt','Number of Routers/Accessories',t.router_count) : ''}
           ${role !== 'tech' ? inputGroup('ref_gstn','GST Number',t.gst_number) : ''}
        </div>
        <div class="grid g2" style="margin-top:16px">
           ${inputGroup('ref_gr','Grievance Redressal Contact',t.grievance_contact,'textarea')}
           ${inputGroup('ref_link','Link Delivery Address',t.link_delivery_address,'textarea')}
        </div>
      </div>

      <div class="card">
        <div class="sec-title">Phase 2: Technical Review</div>
        ${!r.id ? `<div class="empty"><div class="empty-icon">⚙</div><div class="empty-title">Pending Technical Report</div></div>` : `
        <div class="grid g2">
            ${inputGroup('r_sp','Service Provider',r.service_provider)}
            ${inputGroup('r_sdate','Survey Date',r.survey_date)}
            ${inputGroup('r_scby','Survey Conducted By',r.survey_conducted_by)}
            ${inputGroup('r_prem','Type of Premises',r.type_of_premises)}
            ${inputGroup('r_bstruct','Building Structure',r.building_structure)}
            ${inputGroup('r_popd','Nearest IPNET POP Distance (Mtr)',r.nearest_pop_dist)}
            ${inputGroup('r_acc','Accessibility',r.accessibility)}
            ${inputGroup('r_pwr','Power Availability',r.power_availability)}
            ${inputGroup('r_rack','Rack Space Availability',r.rack_space)}
            ${inputGroup('r_env','Environment Conditions',r.environment_conditions)}
            ${inputGroup('r_poptype','POP Type',r.pop_type)}
            ${inputGroup('r_dig','Digging Needed',r.digging_needed)}
            ${r.digging_needed==='Yes' ? inputGroup('r_digdet','Digging Details',r.digging_details,'textarea') : ''}
        </div>
        <div style="margin-top:16px">
            <div style="font-weight:600;margin-bottom:8px">Uploaded Reports:</div>
            ${r.feasibility_doc_url ? `<a href="${r.feasibility_doc_url}" target="_blank" class="btn btn-ghost btn-sm">📄 View Feasibility Doc</a>` : ''}
            ${r.site_survey_doc_url ? `<a href="${r.site_survey_doc_url}" target="_blank" class="btn btn-ghost btn-sm">📄 View Site Survey Doc</a>` : ''}
        </div>
        `}
      </div>
    `;
}

// -- Phase 3 --
function TabAward(t, role) {
    const recs = t.phase3_records||[];
    const r = recs[recs.length-1] || {};
    return `
      <div class="card">
        <div class="sec-title">Phase 3: Award / Qualification</div>
        ${!r.id ? `<div class="empty"><div class="empty-icon">⚖</div><div class="empty-title">Pending Award Decision</div></div>` : `
        <div class="grid g2">
            ${inputGroup('p3_res','Qualification Result',r.qualification_result)}
            ${inputGroup('p3_qval','Quoted Bid Value',r.quoted_bid_value)}
            ${inputGroup('p3_ra','Reverse Auction Held',r.reverse_auction)}
            ${r.reverse_auction==='Yes'?inputGroup('p3_rap','Final Price After RA',r.final_price_after_ra):''}
            ${r.qualification_result==='Awarded'?inputGroup('p3_ad','Award Date',r.award_date):''}
            ${r.qualification_result==='Awarded'?inputGroup('p3_dd','Expected Delivery Date',r.delivery_date):''}
            ${r.qualification_result==='Disqualified'?inputGroup('p3_dr','Disqualification Reason',r.disqualification_reason,'textarea'):''}
            ${r.qualification_result==='Qualified'?inputGroup('p3_qr','Qualification Remarks',r.qualification_remarks,'textarea'):''}
        </div>
        `}
      </div>
    `;
}

// -- Phase 4 --
function TabDelivery(t, role) {
    const recs = t.phase4_records||[];
    const r = recs[recs.length-1] || {};
    return `
      <div class="card">
        <div class="sec-title">Phase 4: Technical Delivery</div>
        ${!r.id ? `<div class="empty"><div class="empty-icon">🚚</div><div class="empty-title">Pending Delivery</div></div>` : `
        <div class="grid g2">
            ${inputGroup('p4_ad','Actual Delivery Date',r.delivery_date)}
            ${inputGroup('p4_rem','Delivery Notes',r.delivery_notes,'textarea')}
        </div>
        ${r.ipv4_addresses && r.ipv4_addresses.length ? `
        <div style="margin-top:16px">
            <div style="font-weight:600;margin-bottom:8px">IPv4 Pools:</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${r.ipv4_addresses.map(ip => `<span class="badge" style="background:var(--blue);color:#fff">${esc(ip)}</span>`).join('')}
            </div>
        </div>
        ` : ''}
        ${r.ipv6_addresses && r.ipv6_addresses.length ? `
        <div style="margin-top:16px">
            <div style="font-weight:600;margin-bottom:8px">IPv6 Pools:</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${r.ipv6_addresses.map(ip => `<span class="badge" style="background:var(--blue);color:#fff">${esc(ip)}</span>`).join('')}
            </div>
        </div>
        ` : ''}
        ${r.router_names && r.router_names.length ? `
        <div style="margin-top:16px">
            <div style="font-weight:600;margin-bottom:8px">Routers/Accessories:</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${r.router_names.map(rn => `<span class="badge b-gray">${esc(rn)}</span>`).join('')}
            </div>
        </div>
        ` : ''}
        ${t.circuits && t.circuits.length ? `
        <div style="margin-top:16px">
            <div style="font-weight:600;margin-bottom:8px">Circuit IDs:</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${t.circuits.map(c => `<span class="badge" style="background:var(--blue);color:#fff">${esc(c.circuit_id)}</span>`).join('')}
            </div>
        </div>
        ` : ''}
        <div style="margin-top:16px">
            <div style="font-weight:600;margin-bottom:8px">Documents:</div>
            ${r.acceptance_form_url ? `<a href="${r.acceptance_form_url}" target="_blank" class="btn btn-ghost btn-sm">📄 View Acceptance Form</a>` : ''}
            ${r.completion_cert_url ? `<a href="${r.completion_cert_url}" target="_blank" class="btn btn-ghost btn-sm">📄 View Completion Certificate</a>` : ''}
        </div>
        `}
      </div>
    `;
}

// -- Phase 5 --
function TabBilling(t, role) {
    const edit = (role === 'acct' || role === 'admin');
    const invs = t.invoices||[];
    const inv = invs[invs.length-1] || {};
    const cycs = t.payment_cycles||[];
    
    const headHtml = !inv.id ? 
      (edit&&t.stage==='ph5_active' ? `<button class="btn btn-primary" data-modal="ph5-invoice">Create Invoice Header</button>` : `<div class="empty"><div class="empty-icon">₹</div><div class="empty-title">Pending Invoice Creation</div></div>`) :
      `<div class="grid g3">
          ${inputGroup('i_no','Invoice Number',inv.invoice_number)}
          ${inputGroup('i_nt','Notif to Tender Date',inv.notif_to_tender_date)}
          ${inputGroup('i_ad','Award Date',inv.award_date)}
          ${inputGroup('i_tot','Total Contract Price',inv.total_price)}
          ${inputGroup('i_bp','Billing Price',inv.billing_price)}
          ${inputGroup('i_base','Base Price',inv.base_price)}
          ${inputGroup('i_gst','GST %',inv.gst_pct)}
          ${inputGroup('i_val','Invoice Value (Auto)',inv.invoice_value)}
          ${inputGroup('i_df','Duration From',inv.duration_from)}
          ${inputGroup('i_dt','Duration To',inv.duration_to)}
          ${inputGroup('i_pc','Payment Cycle',inv.payment_cycle)}
      </div>
      ${inv.invoice_upload_url ? `<div style="margin-top:12px"><a href="${inv.invoice_upload_url}" target="_blank" class="btn btn-ghost btn-sm">📄 View Invoice Document</a></div>` : ''}
      `;
      
    let totalDue = cycs.reduce((a,c)=>a+parseFloat(c.amount_due||0),0);
    let totalRec = cycs.reduce((a,c)=>a+parseFloat(c.amount_received||0),0);
    let bal = totalDue - totalRec;

    const cycHtml = !inv.id ? '' : `
      <div class="sec-title" style="margin-top:32px;display:flex;justify-content:space-between">
         <span>Payment Cycles</span>
         ${edit&&t.stage==='ph5_active' ? `<button class="btn btn-primary btn-sm" data-modal="ph5-cycle">+ Add Cycle</button>` : ''}
      </div>
      <div style="background:var(--bg2);padding:12px;border-radius:6px;display:flex;gap:24px;margin-bottom:16px;font-weight:600">
         <div>Total Due: <span style="color:var(--text1)">₹${totalDue.toLocaleString('en-IN')}</span></div>
         <div>Total Received: <span style="color:var(--green)">₹${totalRec.toLocaleString('en-IN')}</span></div>
         <div>Balance: <span style="color:var(--red)">₹${bal.toLocaleString('en-IN')}</span></div>
      </div>
      <div class="table-wrap"><table>
         <thead><tr><th>Cycle</th><th>Period</th><th>Due</th><th>Status</th><th>Received</th><th>Pay Date</th>${edit?'<th>Act</th>':''}</tr></thead>
         <tbody>${cycs.map(c=>`
            <tr>
               <td>#${c.cycle_number}</td>
               <td>${fmt(c.period_from,'date')} - ${fmt(c.period_to,'date')}</td>
               <td>${fmt(c.amount_due,'currency')}</td>
               <td><span class="badge ${c.payment_status==='Paid'?'b-green':c.payment_status==='Partial'?'b-amber':'b-gray'}">${c.payment_status}</span></td>
               <td>${fmt(c.amount_received,'currency')}</td>
               <td>${fmt(c.payment_date,'date')}</td>
               ${edit?`<td><button class="btn btn-ghost btn-sm" onclick="editCycle('${c.id}')">Edit</button></td>`:''}
            </tr>
         `).join('')}
         ${!cycs.length?`<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text3)">No payment cycles yet</td></tr>`:''}
         </tbody>
      </table></div>
    `;

    return `<div class="card"><div class="sec-title">Phase 5: Invoice Header</div>${headHtml}${cycHtml}</div>`;
}

// ---- Modals ----

// ---- LEADS MODULE (Duplicated) ----
function PageLeads() {
  const role = S.user?.role, list = S.leads || [];
  return `
    <div class="page-header">
      <div><div class="page-title">Leads</div><div class="page-sub">${list.length} leads</div></div>
      <div class="page-actions">
        ${['lead','admin'].includes(role)?`<button class="btn btn-primary" id="btnNewLeadPage">+ New Lead</button>`:''}
      </div>
    </div>
    ${list.length?`
      <div class="table-wrap"><table>
        <thead><tr><th>Order Number</th><th>Title</th><th>Organisation</th><th>Stage</th><th>Value</th><th>Due Date</th></tr></thead>
        <tbody>${list.map(t=>`
          <tr class="tr-link" data-lnav="${t.id}">
            <td>${esc(t.requirements?.order_number || '-')}</td>
            <td><div class="tbl-link">${esc(t.title)}</div></td>
            <td>${esc(t.org_name||'—')}</td><td>${stageBadge(t.stage)}</td>
            <td style="font-weight:700">${fmt(t.quoted_bid_value,'currency')}</td>
            <td>${fmt(t.bid_end_datetime,'date')}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`:
      `<div class="empty"><div class="empty-icon">🔍</div><div class="empty-title">No leads</div></div>`}`;
}

// ---- Technical Page ----
function LeadDetail() {
  const t = S.leadItem;
  if (!t) return `<div class="loading"><div class="spinner"></div> Loading...</div>`;
  const role = S.user?.role;
  const tabs = leadTabs(t, role);
  
  // fallback if tab is not available
  if (tabs.length > 0 && !tabs.find(tb=>tb.k===S.tab)) S.tab = tabs[0].k;

  return `
    <button class="back-btn" id="backLeadBtn">← Back</button>
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:14px;flex-wrap:wrap">
      <div>
        <h1 style="font-size:19px;font-weight:800;margin-bottom:6px">${esc(t.title)}</h1>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${stageBadge(t.stage)}
          ${t.bid_number?`<span style="font-size:12px;color:var(--text2)">${esc(t.bid_number)}</span>`:''}
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${LeadActionBtns(t,role)}</div>
    </div>
    ${Pipeline(t.stage)}
    <div class="tabs">${tabs.map(tb=>`<button class="tab-btn ${S.tab===tb.k?'active':''}" data-tab="${tb.k}">${tb.l}</button>`).join('')}</div>
    <div id="tab-body" style="padding-top:16px">${renderLeadTab(t,S.tab,role)}</div>`;
}

function leadTabs(t, role) {
  const ALL = STAGES;
  const si = ALL.indexOf(t.stage);
  const tabs = [];
  if (role === 'lead' || role === 'admin') {
      tabs.push({k:'lead_info',l:'Phase 1: Lead'});
  }
  if (si >= ALL.indexOf('ph2_active')) tabs.push({k:'technical',l:'Phase 2: Technical'});
  if (role !== 'tech' && si >= ALL.indexOf('ph3_active')) tabs.push({k:'award',l:'Phase 3: Award'});
  if (si >= ALL.indexOf('ph4_active')) tabs.push({k:'delivery',l:'Phase 4: Delivery'});
  if (si >= ALL.indexOf('ph5_active')) tabs.push({k:'billing',l:'Phase 5: Billing'});
  return tabs;
}

function LeadActionBtns(t, role) {
  const btns = [];
  if (role === 'admin') btns.push(`<button class="btn btn-ghost btn-sm" data-modal="override-stage">Override Stage</button>`);
  
  if (role === 'lead' || role === 'admin') {
     if (t.stage === 'ph1_draft') btns.push(`<button class="btn btn-primary btn-sm" id="btnSubmitPh1Lead">Submit to Technical (Ph2)</button>`);
     if (t.stage === 'ph3_active') btns.push(`<button class="btn btn-primary btn-sm" data-modal="ph3-award">Declare Award / Disqualify</button>`);
  }
  if (role === 'tech' || role === 'admin') {
     if (t.stage === 'ph2_active') btns.push(`<button class="btn btn-primary btn-sm" data-modal="ph2-report">Submit Technical Report</button>`);
     if (t.stage === 'ph4_active') btns.push(`<button class="btn btn-primary btn-sm" data-modal="ph4-deliver">Mark Delivered (Ph4)</button>`);
  }
  return btns.join('');
}

function renderLeadTab(t, tab, role) {
  switch(tab) {
    case 'lead_info': return TabLeadInfo(t, role);
    case 'technical': return TabLeadTechnical(t, role);
    case 'award': return TabLeadAward(t, role);
    case 'delivery': return TabLeadDelivery(t, role);
    case 'billing': return TabLeadBilling(t, role);
    default: return TabLeadInfo(t, role);
  }
}

function TabLeadInfo(t, role) {
    const edit = (role === 'lead' || role === 'admin') && t.stage === 'ph1_draft';
    return `
      <div class="card">
        <div class="sec-title">Phase 1: Lead Details</div>
        <form id="ph1LeadForm">
        <div class="grid g3">
          ${inputGroup('org_name','Organisation Name',t.org_name,'text',edit)}
          <div class="sec-title" style="grid-column:1/-1;margin-top:12px;margin-bottom:8px">Lead Requirements</div>
          ${inputGroup('order_number','Order Number',t.requirements?.order_number,'text',edit)}
          ${inputGroup('contract_period','Contract Period',t.contract_period,'text',edit)}
          ${inputGroup('payment_terms','Payment Terms',t.payment_terms,'text',edit)}
          ${inputGroup('service_type','Type of Service',t.service_type,'select',edit,['','ILL','MPLS','Broadband','P2P','NLD'])}
          ${inputGroup('bandwidth_mbps','Bandwidth (Mbps)',t.bandwidth_mbps,'number',edit)}
          ${inputGroup('ddos_with_ill','DDOS with ILL',t.ddos_with_ill,'select',edit,['','Yes','No','Optional'])}
          ${inputGroup('media_type','Type of Media',t.media_type,'select',edit,['','Fiber','Radio','Copper'])}
          ${inputGroup('static_ip_required','Static IP Required',t.static_ip_required,'select',edit,['','Yes','No'])}
          ${edit || t.static_ip_required === 'Yes' ? `<div id="sip_wrap" style="display:${t.static_ip_required==='Yes'?'contents':'none'}">
             ${inputGroup('num_ipv4','Number of IPv4',t.num_ipv4,'number',edit)}
             ${inputGroup('num_ipv6','Number of IPv6',t.num_ipv6,'number',edit)}
          </div>` : ''}
          ${inputGroup('router_accessories','Router/Accessories',t.router_accessories,'select',edit,['','Yes','No'])}
          ${edit || t.router_accessories === 'Yes' ? `<div id="rtr_wrap" style="display:${t.router_accessories==='Yes'?'contents':'none'}">
             ${inputGroup('router_count','Number of Routers/Accessories',t.router_count,'number',edit)}
          </div>` : ''}
          ${edit ? `<div class="form-group"><label class="form-label">MRCP (per month)</label><input type="number" class="form-input" id="mrcp" value="${t.mrcp||''}" oninput="calcTotal()"></div>` : `<div class="form-group"><label class="form-label">MRCP (per month)</label><div class="kbd-val">${t.mrcp||'-'}</div></div>`}
          ${edit ? `<div class="form-group"><label class="form-label">GST (%)</label><input type="number" class="form-input" id="gst" value="${t.gst !== undefined ? t.gst : 18}" oninput="calcTotal()"></div>` : `<div class="form-group"><label class="form-label">GST (%)</label><div class="kbd-val">${t.gst!==undefined?t.gst:18}</div></div>`}
          <div class="form-group"><label class="form-label">Total Value (Auto)</label><input type="text" class="form-input" id="total_bid_value" value="${t.total_bid_value || ''}" readonly style="background:#f5f5f5;cursor:not-allowed;"></div>
          ${role !== 'tech' ? inputGroup('gst_number','GST Number',t.gst_number,'text',edit) : ''}
        </div>
        <div class="grid g2">
          ${inputGroup('grievance_contact','Grievance Redressal Contact',t.grievance_contact,'textarea',edit)}
          ${inputGroup('link_delivery_address','Link Delivery Address',t.link_delivery_address,'textarea',edit)}
        </div>
        ${edit ? `<button type="submit" class="btn btn-primary" style="margin-top:16px">Save Phase 1 Draft</button>` : ''}
        </form>
        
        <div class="sec-title" style="margin-top:24px">Lead Documents</div>
        ${edit ? `<label class="upload-zone" id="docLeadDrop" style="margin-bottom:18px"><div class="uz-icon">☁</div><div class="uz-title">Upload Documents</div><input type="file" id="docLeadFile" style="display:none"></label>` : ''}
        <div class="file-list">${(t.documents||[]).map(d=>`
          <div class="file-item"><div class="file-icon">${fileIcon(d.mime)}</div><div style="flex:1">${esc(d.name)}</div>
          <a href="${d.url}" target="_blank" class="btn btn-ghost btn-sm">View</a></div>`).join('')}
        </div>
      </div>
    `;
}

// -- Phase 2 --
function TabLeadTechnical(t, role) {
    const reports = t.technical_reports||[];
    const r = reports[reports.length-1] || {};
    return `
      <div class="card" style="margin-bottom:16px;">
        <div class="sec-title">Phase 1 Summary (Reference)</div>
        <div class="grid g3">
           ${inputGroup('ref_org','Organisation Name',t.org_name)}
           ${inputGroup('ref_cp','Contract Period',t.contract_period)}
           ${inputGroup('ref_st','Type of Service',t.service_type)}
           ${inputGroup('ref_bw','Bandwidth (Mbps)',t.bandwidth_mbps)}
           ${inputGroup('ref_ddos','DDOS with ILL',t.ddos_with_ill)}
           ${inputGroup('ref_media','Type of Media',t.media_type)}
           ${inputGroup('ref_sip','Static IP Required',t.static_ip_required)}
           ${t.static_ip_required === 'Yes' ? inputGroup('ref_ipv4','Number of IPv4',t.num_ipv4) : ''}
           ${t.static_ip_required === 'Yes' ? inputGroup('ref_ipv6','Number of IPv6',t.num_ipv6) : ''}
           ${inputGroup('ref_rtr','Router/Accessories',t.router_accessories)}
           ${t.router_accessories === 'Yes' ? inputGroup('ref_rtr_cnt','Number of Routers/Accessories',t.router_count) : ''}
           ${role !== 'tech' ? inputGroup('ref_gstn','GST Number',t.gst_number) : ''}
        </div>
        <div class="grid g2" style="margin-top:16px">
           ${inputGroup('ref_gr','Grievance Redressal Contact',t.grievance_contact,'textarea')}
           ${inputGroup('ref_link','Link Delivery Address',t.link_delivery_address,'textarea')}
        </div>
      </div>

      <div class="card">
        <div class="sec-title">Phase 2: Technical Review</div>
        ${!r.id ? `<div class="empty"><div class="empty-icon">⚙</div><div class="empty-title">Pending Technical Report</div></div>` : `
        <div class="grid g2">
            ${inputGroup('r_sp','Service Provider',r.service_provider)}
            ${inputGroup('r_sdate','Survey Date',r.survey_date)}
            ${inputGroup('r_scby','Survey Conducted By',r.survey_conducted_by)}
            ${inputGroup('r_prem','Type of Premises',r.type_of_premises)}
            ${inputGroup('r_bstruct','Building Structure',r.building_structure)}
            ${inputGroup('r_popd','Nearest IPNET POP Distance (Mtr)',r.nearest_pop_dist)}
            ${inputGroup('r_acc','Accessibility',r.accessibility)}
            ${inputGroup('r_pwr','Power Availability',r.power_availability)}
            ${inputGroup('r_rack','Rack Space Availability',r.rack_space)}
            ${inputGroup('r_env','Environment Conditions',r.environment_conditions)}
            ${inputGroup('r_poptype','POP Type',r.pop_type)}
            ${inputGroup('r_dig','Digging Needed',r.digging_needed)}
            ${r.digging_needed==='Yes' ? inputGroup('r_digdet','Digging Details',r.digging_details,'textarea') : ''}
        </div>
        <div style="margin-top:16px">
            <div style="font-weight:600;margin-bottom:8px">Uploaded Reports:</div>
            ${r.feasibility_doc_url ? `<a href="${r.feasibility_doc_url}" target="_blank" class="btn btn-ghost btn-sm">📄 View Feasibility Doc</a>` : ''}
            ${r.site_survey_doc_url ? `<a href="${r.site_survey_doc_url}" target="_blank" class="btn btn-ghost btn-sm">📄 View Site Survey Doc</a>` : ''}
        </div>
        `}
      </div>
    `;
}

// -- Phase 3 --
function TabLeadAward(t, role) {
    const recs = t.phase3_records||[];
    const r = recs[recs.length-1] || {};
    return `
      <div class="card">
        <div class="sec-title">Phase 3: Award / Qualification</div>
        ${!r.id ? `<div class="empty"><div class="empty-icon">⚖</div><div class="empty-title">Pending Award Decision</div></div>` : `
        <div class="grid g2">
            ${inputGroup('p3_res','Qualification Result',r.qualification_result)}
            ${inputGroup('p3_qval','Quoted Bid Value',r.quoted_bid_value)}
            ${inputGroup('p3_ra','Reverse Auction Held',r.reverse_auction)}
            ${r.reverse_auction==='Yes'?inputGroup('p3_rap','Final Price After RA',r.final_price_after_ra):''}
            ${r.qualification_result==='Awarded'?inputGroup('p3_ad','Award Date',r.award_date):''}
            ${r.qualification_result==='Awarded'?inputGroup('p3_dd','Expected Delivery Date',r.delivery_date):''}
            ${r.qualification_result==='Disqualified'?inputGroup('p3_dr','Disqualification Reason',r.disqualification_reason,'textarea'):''}
            ${r.qualification_result==='Qualified'?inputGroup('p3_qr','Qualification Remarks',r.qualification_remarks,'textarea'):''}
        </div>
        `}
      </div>
    `;
}

// -- Phase 4 --
function TabLeadDelivery(t, role) {
    const recs = t.phase4_records||[];
    const r = recs[recs.length-1] || {};
    return `
      <div class="card">
        <div class="sec-title">Phase 4: Technical Delivery</div>
        ${!r.id ? `<div class="empty"><div class="empty-icon">🚚</div><div class="empty-title">Pending Delivery</div></div>` : `
        <div class="grid g2">
            ${inputGroup('p4_ad','Actual Delivery Date',r.delivery_date)}
            ${inputGroup('p4_rem','Delivery Notes',r.delivery_notes,'textarea')}
        </div>
        ${r.ipv4_addresses && r.ipv4_addresses.length ? `
        <div style="margin-top:16px">
            <div style="font-weight:600;margin-bottom:8px">IPv4 Pools:</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${r.ipv4_addresses.map(ip => `<span class="badge" style="background:var(--blue);color:#fff">${esc(ip)}</span>`).join('')}
            </div>
        </div>
        ` : ''}
        ${r.ipv6_addresses && r.ipv6_addresses.length ? `
        <div style="margin-top:16px">
            <div style="font-weight:600;margin-bottom:8px">IPv6 Pools:</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${r.ipv6_addresses.map(ip => `<span class="badge" style="background:var(--blue);color:#fff">${esc(ip)}</span>`).join('')}
            </div>
        </div>
        ` : ''}
        ${r.router_names && r.router_names.length ? `
        <div style="margin-top:16px">
            <div style="font-weight:600;margin-bottom:8px">Routers/Accessories:</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${r.router_names.map(rn => `<span class="badge b-gray">${esc(rn)}</span>`).join('')}
            </div>
        </div>
        ` : ''}
        ${t.circuits && t.circuits.length ? `
        <div style="margin-top:16px">
            <div style="font-weight:600;margin-bottom:8px">Circuit IDs:</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${t.circuits.map(c => `<span class="badge" style="background:var(--blue);color:#fff">${esc(c.circuit_id)}</span>`).join('')}
            </div>
        </div>
        ` : ''}
        <div style="margin-top:16px">
            <div style="font-weight:600;margin-bottom:8px">Documents:</div>
            ${r.acceptance_form_url ? `<a href="${r.acceptance_form_url}" target="_blank" class="btn btn-ghost btn-sm">📄 View Acceptance Form</a>` : ''}
            ${r.completion_cert_url ? `<a href="${r.completion_cert_url}" target="_blank" class="btn btn-ghost btn-sm">📄 View Completion Certificate</a>` : ''}
        </div>
        `}
      </div>
    `;
}

// -- Phase 5 --
function TabLeadBilling(t, role) {
    const edit = (role === 'acct' || role === 'admin');
    const invs = t.invoices||[];
    const inv = invs[invs.length-1] || {};
    const cycs = t.payment_cycles||[];
    
    const headHtml = !inv.id ? 
      (edit&&t.stage==='ph5_active' ? `<button class="btn btn-primary" data-modal="ph5-invoice">Create Invoice Header</button>` : `<div class="empty"><div class="empty-icon">₹</div><div class="empty-title">Pending Invoice Creation</div></div>`) :
      `<div class="grid g3">
          ${inputGroup('i_no','Invoice Number',inv.invoice_number)}
          ${inputGroup('i_nt','Notif to Lead Date',inv.notif_to_lead_date)}
          ${inputGroup('i_ad','Award Date',inv.award_date)}
          ${inputGroup('i_tot','Total Contract Price',inv.total_price)}
          ${inputGroup('i_bp','Billing Price',inv.billing_price)}
          ${inputGroup('i_base','Base Price',inv.base_price)}
          ${inputGroup('i_gst','GST %',inv.gst_pct)}
          ${inputGroup('i_val','Invoice Value (Auto)',inv.invoice_value)}
          ${inputGroup('i_df','Duration From',inv.duration_from)}
          ${inputGroup('i_dt','Duration To',inv.duration_to)}
          ${inputGroup('i_pc','Payment Cycle',inv.payment_cycle)}
      </div>
      ${inv.invoice_upload_url ? `<div style="margin-top:12px"><a href="${inv.invoice_upload_url}" target="_blank" class="btn btn-ghost btn-sm">📄 View Invoice Document</a></div>` : ''}
      `;
      
    let totalDue = cycs.reduce((a,c)=>a+parseFloat(c.amount_due||0),0);
    let totalRec = cycs.reduce((a,c)=>a+parseFloat(c.amount_received||0),0);
    let bal = totalDue - totalRec;

    const cycHtml = !inv.id ? '' : `
      <div class="sec-title" style="margin-top:32px;display:flex;justify-content:space-between">
         <span>Payment Cycles</span>
         ${edit&&t.stage==='ph5_active' ? `<button class="btn btn-primary btn-sm" data-modal="ph5-cycle">+ Add Cycle</button>` : ''}
      </div>
      <div style="background:var(--bg2);padding:12px;border-radius:6px;display:flex;gap:24px;margin-bottom:16px;font-weight:600">
         <div>Total Due: <span style="color:var(--text1)">₹${totalDue.toLocaleString('en-IN')}</span></div>
         <div>Total Received: <span style="color:var(--green)">₹${totalRec.toLocaleString('en-IN')}</span></div>
         <div>Balance: <span style="color:var(--red)">₹${bal.toLocaleString('en-IN')}</span></div>
      </div>
      <div class="table-wrap"><table>
         <thead><tr><th>Cycle</th><th>Period</th><th>Due</th><th>Status</th><th>Received</th><th>Pay Date</th>${edit?'<th>Act</th>':''}</tr></thead>
         <tbody>${cycs.map(c=>`
            <tr>
               <td>#${c.cycle_number}</td>
               <td>${fmt(c.period_from,'date')} - ${fmt(c.period_to,'date')}</td>
               <td>${fmt(c.amount_due,'currency')}</td>
               <td><span class="badge ${c.payment_status==='Paid'?'b-green':c.payment_status==='Partial'?'b-amber':'b-gray'}">${c.payment_status}</span></td>
               <td>${fmt(c.amount_received,'currency')}</td>
               <td>${fmt(c.payment_date,'date')}</td>
               ${edit?`<td><button class="btn btn-ghost btn-sm" onclick="editCycle('${c.id}')">Edit</button></td>`:''}
            </tr>
         `).join('')}
         ${!cycs.length?`<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text3)">No payment cycles yet</td></tr>`:''}
         </tbody>
      </table></div>
    `;

    return `<div class="card"><div class="sec-title">Phase 5: Invoice Header</div>${headHtml}${cycHtml}</div>`;
}

// ---- Modals ----

function showModal(html) {
  removeModal();
  const wrap = document.createElement('div'); wrap.id='mwrap'; wrap.innerHTML=html; document.body.appendChild(wrap);
  wrap.querySelector('.modal-overlay')?.addEventListener('click', e=>{ if(e.target===e.currentTarget) removeModal(); });
  attachModalHandlers();
}
function removeModal() { $('mwrap')?.remove(); }

function MW(title, body, footer, size='') {
  return `<div class="modal-overlay"><div class="modal ${size}">
    <div class="modal-header"><div class="modal-title">${title}</div>
      <button class="modal-close" id="mclose">✕</button></div>
    <div class="modal-body">${body}</div>
    <div class="modal-footer">${footer}</div>
  </div></div>`;
}

function attachModalHandlers() {
  $('mclose')?.addEventListener('click', removeModal);
  

  // Create new tender modal logic
  $('saveNewTenderBtn')?.addEventListener('click', async () => {
    const bid = $('ntBid')?.value;
    if (!bid) return toast('Bid Number is required','error');
    try {
      await api('POST','/tenders',{ bid_number: bid, title: $('ntTitle')?.value, org_name: $('ntOrg')?.value, stage: 'ph1_draft' });
      await loadTenders(); removeModal(); render(); toast('Tender created!','success');
    } catch(e) { toast(e.message,'error'); }
  });

  // Create new lead modal logic
  $('saveNewLeadBtn')?.addEventListener('click', async () => {
    const title = $('nlTitle')?.value;
    if (!title) return toast('Lead Title is required','error');
    try {
      await api('POST','/leads',{ title, org_name: $('nlOrg')?.value, lead_source: $('nlSource')?.value, stage: 'ph1_draft' });
      try { S.leads = await api('GET', '/leads') || []; } catch {}
      removeModal(); render(); toast('Lead created!','success');
    } catch(e) { toast(e.message,'error'); }
  });

  // Phase Transitions (modal buttons below — page-level ones are in attachAll)

  $('ph2SubmitBtn')?.addEventListener('click', async()=>{
     const fd = new FormData();
     fd.append('service_provider',$('m_sp').value); fd.append('survey_date',$('m_sdate').value); fd.append('survey_conducted_by',$('m_scby').value);
     fd.append('type_of_premises',$('m_prem').value); fd.append('building_structure',$('m_bstruct').value); fd.append('nearest_pop_dist',$('m_popd').value);
     fd.append('accessibility',$('m_acc').value); fd.append('power_availability',$('m_pwr').value); fd.append('rack_space',$('m_rack').value);
     fd.append('environment_conditions',$('m_env').value); fd.append('pop_type',$('m_poptype').value);
     fd.append('digging_needed',$('m_dig').value); fd.append('digging_details',$('m_digdet').value);
     fd.append('feasibility_status',$('m_fstat').value); fd.append('survey_notes',$('m_snotes').value);
     if($('m_fdoc').files[0]) fd.append('feasibility_doc',$('m_fdoc').files[0]);
     if($('m_sdoc').files[0]) fd.append('site_survey_doc',$('m_sdoc').files[0]);
     
     const id = S.leadId || S.tenderId;
     const base = S.leadId ? 'leads' : 'tenders';
     try { await up(`/${base}/${id}/phase2`,fd); if(S.leadId) await loadLead(id); else await loadTender(id); removeModal(); render(); toast('Report submitted!','success'); } catch(e){toast(e.message,'error');}
  });

  $('ph3SubmitBtn')?.addEventListener('click', async()=>{
     const b = {
        qualification_result: $('m3_res').value, 
        quoted_bid_value: $('m3_qval').value || null, 
        reverse_auction: $('m3_ra').value,
        final_price_after_ra: $('m3_rap').value || null, 
        award_date: $('m3_ad').value || null, 
        delivery_date: $('m3_dd').value || null, 
        disqualification_reason: $('m3_dr').value || null, 
        qualification_remarks: $('m3_qr')?.value || null
     };
     const id = S.leadId || S.tenderId;
     const base = S.leadId ? 'leads' : 'tenders';
     try { await api('POST', `/${base}/${id}/phase3`, b); if(S.leadId) await loadLead(id); else await loadTender(id); removeModal(); render(); toast('Award recorded!','success'); } catch(e){toast(e.message,'error');}
  });

  $('m3_res')?.addEventListener('change', e=>{
      const v = e.target.value;
      if(v==='Awarded') { $('m3_awarded_fields').style.display='block'; $('m3_disq_fields').style.display='none'; $('m3_qual_fields').style.display='none'; }
      else if(v==='Disqualified') { $('m3_awarded_fields').style.display='none'; $('m3_disq_fields').style.display='block'; $('m3_qual_fields').style.display='none'; }
      else if(v==='Qualified') { $('m3_awarded_fields').style.display='none'; $('m3_disq_fields').style.display='none'; $('m3_qual_fields').style.display='block'; }
  });
  
  $('m_dig')?.addEventListener('change', e=>{
      const w = $('m_digdet_wrap');
      if(w) w.style.display = e.target.value === 'Yes' ? 'block' : 'none';
  });

  $('ph4SubmitBtn')?.addEventListener('click', async()=>{
     const item = S.leadId ? S.leadItem : S.tender;
     const numV4 = parseInt(item?.num_ipv4) || 0;
     const numV6 = parseInt(item?.num_ipv6) || 0;
     const numRouters = parseInt(item?.router_count) || 0;
     
     const ipv4Regex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
     const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,2}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
     
     let v4Addrs = [], v6Addrs = [], routers = [];
     for(let i=1; i<=numV4; i++) {
        let val = $('m4_ipv4_'+i)?.value;
        if (!val) return toast('Invalid IPv4 Pool '+i, 'error');
        v4Addrs.push(val);
     }
     for(let i=1; i<=numV6; i++) {
        let val = $('m4_ipv6_'+i)?.value;
        if (!val) return toast('Invalid IPv6 Pool '+i, 'error');
        v6Addrs.push(val);
     }
     for(let i=1; i<=numRouters; i++) {
        let val = $('m4_router_'+i)?.value;
        if (!val) return toast('Router/Accessory Name '+i+' is required', 'error');
        routers.push(val);
     }

     const fd = new FormData();
     fd.append('delivery_date',$('m4_ad').value); fd.append('delivery_notes',$('m4_rem').value);
     if (v4Addrs.length) fd.append('ipv4_addresses', JSON.stringify(v4Addrs));
     if (v6Addrs.length) fd.append('ipv6_addresses', JSON.stringify(v6Addrs));
     if (routers.length) fd.append('router_names', JSON.stringify(routers));
     if($('m4_adoc').files[0]) fd.append('acceptance_form',$('m4_adoc').files[0]);
     if($('m4_cdoc').files[0]) fd.append('completion_cert',$('m4_cdoc').files[0]);
     const id = S.leadId || S.tenderId;
     const base = S.leadId ? 'leads' : 'tenders';
     try { await up(`/${base}/${id}/phase4`,fd); if(S.leadId) await loadLead(id); else await loadTender(id); removeModal(); render(); toast('Delivered!','success'); } catch(e){toast(e.message,'error');}
  });

  $('ph5InvBtn')?.addEventListener('click', async()=>{
     const fd = new FormData();
     fd.append('invoice_number',$('m5_no').value); fd.append(S.leadId ? 'notif_to_lead_date' : 'notif_to_tender_date',$('m5_nt').value); fd.append('award_date',$('m5_ad').value);
     fd.append('total_price',$('m5_tot').value); fd.append('billing_price',$('m5_bp').value); fd.append('base_price',$('m5_base').value);
     fd.append('gst_pct',$('m5_gst').value); fd.append('duration_from',$('m5_df').value); fd.append('duration_to',$('m5_dt').value);
     fd.append('payment_cycle',$('m5_pc').value);
     if($('m5_doc').files[0]) fd.append('invoice_upload',$('m5_doc').files[0]);
     const id = S.leadId || S.tenderId;
     const base = S.leadId ? 'leads' : 'tenders';
     try { await up(`/${base}/${id}/phase5`,fd); if(S.leadId) await loadLead(id); else await loadTender(id); removeModal(); render(); toast('Invoice Header Created!','success'); } catch(e){toast(e.message,'error');}
  });

  $('ph5CycBtn')?.addEventListener('click', async()=>{
     const cid = $('mc_id')?.value;
     const b = {
        period_from: $('mc_pf').value, period_to: $('mc_pt').value, amount_due: $('mc_ad').value,
        payment_status: $('mc_ps').value, amount_received: $('mc_ar').value, payment_date: $('mc_pd').value
     };
     const id = S.leadId || S.tenderId;
     const base = S.leadId ? 'leads' : 'tenders';
     try {
         if(cid) await api('PATCH',`/${base}/${id}/payment-cycles/${cid}`, b);
         else await api('POST',`/${base}/${id}/payment-cycles`, b);
         if(S.leadId) await loadLead(id); else await loadTender(id); removeModal(); render(); toast('Cycle saved!','success');
     } catch(e){toast(e.message,'error');}
  });
}

window.editCycle = (cid) => {
    const source = S.leadId ? S.leadItem : S.tender;
    const c = source?.payment_cycles?.find(x=>x.id===cid);
    if(!c) return;
    openModal('ph5-cycle');
    setTimeout(()=>{
       $('mc_id').value=cid; $('mc_pf').value=c.period_from||''; $('mc_pt').value=c.period_to||'';
       $('mc_ad').value=c.amount_due||''; $('mc_ps').value=c.payment_status||'Pending';
       $('mc_ar').value=c.amount_received||''; $('mc_pd').value=c.payment_date||'';
    },50);
}

function openModal(id) {
  if (id === 'create-tender' || id === 'btnNewTender' || id === 'btnNewTenderPage') {
    showModal(MW('New Tender', `
      <div class="form-group"><label class="form-label">Bid Number *</label><input type="text" id="ntBid" class="form-input"></div>
      <div class="form-group"><label class="form-label">Tender Title</label><input type="text" id="ntTitle" class="form-input"></div>
      <div class="form-group"><label class="form-label">Organisation Name</label><input type="text" id="ntOrg" class="form-input"></div>
    `, `<button class="btn btn-ghost" onclick="removeModal()">Cancel</button><button class="btn btn-primary" id="saveNewTenderBtn">Create</button>`));
  }

  if (id === 'create-lead' || id === 'btnNewLead' || id === 'btnNewLeadPage') {
    showModal(MW('New Lead', `
      <div class="form-group"><label class="form-label">Lead Title *</label><input type="text" id="nlTitle" class="form-input"></div>
      <div class="form-group"><label class="form-label">Organisation Name</label><input type="text" id="nlOrg" class="form-input"></div>
      <div class="form-group"><label class="form-label">Lead Source</label>
        <select id="nlSource" class="form-input">
          <option value="Direct Sales">Direct Sales</option>
          <option value="Website">Website</option>
          <option value="GEM">GEM</option>
          <option value="Reference">Reference</option>
          <option value="Existing Customer">Existing Customer</option>
          <option value="Other">Other</option>
        </select>
      </div>
    `, `<button class="btn btn-ghost" onclick="removeModal()">Cancel</button><button class="btn btn-primary" id="saveNewLeadBtn">Create</button>`));
  }
  
  if (id === 'ph2-report') {
    showModal(MW('Phase 2: Technical Report', `
      <div class="grid g2" style="max-height:60vh;overflow-y:auto;padding:4px">
         ${inputGroup('m_sp','Service Provider','','text',true)}
         ${inputGroup('m_sdate','Survey Date','','date',true)}
         ${inputGroup('m_scby','Survey Conducted By','','text',true)}
         ${inputGroup('m_prem','Type of Premises','Office','select',true,['Office','Plant','Solar Facility','Control Room'])}
         ${inputGroup('m_bstruct','Building Structure','Single Floor','select',true,['Single Floor','Multi-floor','Open Field Setup'])}
         ${inputGroup('m_popd','Nearest POP Dist (Mtr)','','number',true)}
         ${inputGroup('m_acc','Accessibility','Easy','select',true,['Easy','Moderate','Difficult'])}
         ${inputGroup('m_pwr','Power Availability','Yes','select',true,['Yes','No'])}
         ${inputGroup('m_rack','Rack Space Availability','Yes','select',true,['Yes','No'])}
         ${inputGroup('m_env','Environment Conditions','Normal','select',true,['Dust','Heat','Outdoor Exposure','Normal'])}
         ${inputGroup('m_poptype','POP Type','','select',true,['','FAT Box','Chamber','BTS','RF'])}
         ${inputGroup('m_dig','Digging Needed','No','select',true,['Yes','No'])}
         <div id="m_digdet_wrap" style="display:none; grid-column:1/-1;">
           ${inputGroup('m_digdet','Digging Details','','textarea',true)}
         </div>
         ${inputGroup('m_fstat','Feasibility Status','Feasible','select',true,['Feasible','Not Feasible','Needs Review'])}
         ${inputGroup('m_snotes','Survey Notes','','textarea',true)}
         <div class="form-group"><label class="form-label">Feasibility Doc</label><input type="file" id="m_fdoc" class="form-input"></div>
         <div class="form-group"><label class="form-label">Site Survey Doc</label><input type="file" id="m_sdoc" class="form-input"></div>
      </div>
    `, `<button class="btn btn-ghost" onclick="removeModal()">Cancel</button><button class="btn btn-primary" id="ph2SubmitBtn">Submit Report</button>`,`modal-lg`));
  }

  if (id === 'ph3-award') {
    const item = S.leadId ? S.leadItem : S.tender;
    const recs = item?.phase3_records || [];
    const r = recs[recs.length-1] || {};
    
    showModal(MW('Phase 3: Award Decision', `
      <div class="grid g2">
         ${inputGroup('m3_res','Result',r.qualification_result || 'Awarded','select',true,['Awarded','Disqualified','Qualified'])}
         ${inputGroup('m3_ra','Reverse Auction',r.reverse_auction || 'No','select',true,['Yes','No'])}
         ${inputGroup('m3_qval','Quoted Bid Value (₹)',r.quoted_bid_value || '','number',true)}
         ${inputGroup('m3_rap','Final Price After RA (₹)',r.final_price_after_ra || '','number',true)}
      </div>
      <div id="m3_awarded_fields" style="margin-top:12px; display: ${(r.qualification_result || 'Awarded') === 'Awarded' ? 'block' : 'none'}" class="grid g2">
         ${inputGroup('m3_ad','Award Date',r.award_date || '','date',true)}
         ${inputGroup('m3_dd','Expected Delivery Date',r.delivery_date || '','date',true)}
      </div>
      <div id="m3_disq_fields" style="margin-top:12px; display: ${(r.qualification_result || 'Awarded') === 'Disqualified' ? 'block' : 'none'}">
         ${inputGroup('m3_dr','Disqualification Reason',r.disqualification_reason || '','textarea',true)}
      </div>
      <div id="m3_qual_fields" style="margin-top:12px; display: ${(r.qualification_result || 'Awarded') === 'Qualified' ? 'block' : 'none'}">
         ${inputGroup('m3_qr','Qualification Remarks',r.qualification_remarks || '','textarea',true)}
      </div>
    `, `<button class="btn btn-ghost" onclick="removeModal()">Cancel</button><button class="btn btn-primary" id="ph3SubmitBtn">Save Decision</button>`));
  }

  if (id === 'ph4-deliver') {
    const item = S.leadId ? S.leadItem : S.tender;
    const isStaticIp = item?.static_ip_required === 'Yes';
    const numV4 = parseInt(item?.num_ipv4) || 0;
    const numV6 = parseInt(item?.num_ipv6) || 0;
    const hasRouters = item?.router_accessories === 'Yes';
    const numRouters = parseInt(item?.router_count) || 0;
    
    let dynamicFields = '';
    if (isStaticIp) {
       for(let i=1; i<=numV4; i++) {
           dynamicFields += inputGroup('m4_ipv4_' + i, 'IPv4 Pool ' + i, '', 'text', true);
       }
       for(let i=1; i<=numV6; i++) {
           dynamicFields += inputGroup('m4_ipv6_' + i, 'IPv6 Pool ' + i, '', 'text', true);
       }
    }
    if (hasRouters) {
       for(let i=1; i<=numRouters; i++) {
           dynamicFields += inputGroup('m4_router_' + i, 'Router/Accessory Name ' + i, '', 'text', true);
       }
    }

    showModal(MW('Phase 4: Delivery', `
      <div class="grid g1">
         ${inputGroup('m4_ad','Actual Delivery Date','','date',true)}
         <div class="grid g2" style="grid-column:1/-1;">
            ${dynamicFields}
         </div>
         ${inputGroup('m4_rem','Delivery Notes','','textarea',true)}
         <div class="form-group"><label class="form-label">Acceptance Form *</label><input type="file" id="m4_adoc" class="form-input"></div>
         <div class="form-group"><label class="form-label">Completion Cert *</label><input type="file" id="m4_cdoc" class="form-input"></div>
      </div>
    `, `<button class="btn btn-ghost" onclick="removeModal()">Cancel</button><button class="btn btn-primary" id="ph4SubmitBtn">Mark Delivered</button>`));
  }

  if (id === 'ph5-invoice') {
    showModal(MW('Phase 5: Invoice Header', `
      <div class="grid g2">
         ${inputGroup('m5_no','Invoice Number','','text',true)}
         ${inputGroup('m5_nt', S.leadId ? 'Notif to Lead Date' : 'Notif to Tender Date','','date',true)}
         ${inputGroup('m5_ad','Award Date','','date',true)}
         ${inputGroup('m5_tot','Total Contract Price','','number',true)}
         ${inputGroup('m5_bp','Billing Price','','number',true)}
         ${inputGroup('m5_base','Base Price','','number',true)}
         ${inputGroup('m5_gst','GST %','','number',true)}
         ${inputGroup('m5_df','Duration From','','date',true)}
         ${inputGroup('m5_dt','Duration To','','date',true)}
         ${inputGroup('m5_pc','Payment Cycle','Monthly','select',true,['Monthly','Quarterly','Half-yearly','Annual','One-time'])}
         <div class="form-group" style="grid-column:1/-1"><label class="form-label">Invoice Upload *</label><input type="file" id="m5_doc" class="form-input"></div>
      </div>
    `, `<button class="btn btn-ghost" onclick="removeModal()">Cancel</button><button class="btn btn-primary" id="ph5InvBtn">Save Invoice Header</button>`));
  }

  if (id === 'ph5-cycle') {
    showModal(MW('Payment Cycle', `
      <input type="hidden" id="mc_id">
      <div class="grid g2">
         ${inputGroup('mc_pf','Period From','','date',true)}
         ${inputGroup('mc_pt','Period To','','date',true)}
         ${inputGroup('mc_ad','Amount Due','','number',true)}
         ${inputGroup('mc_ps','Payment Status','Pending','select',true,['Pending','Partial','Paid'])}
         ${inputGroup('mc_ar','Amount Received','','number',true)}
         ${inputGroup('mc_pd','Payment Date','','date',true)}
      </div>
    `, `<button class="btn btn-ghost" onclick="removeModal()">Cancel</button><button class="btn btn-primary" id="ph5CycBtn">Save Cycle</button>`));
  }
}

// ---- Event Listeners ----
function attachAll() {
  $('logoutBtn')?.addEventListener('click', logout);
  $('nb-btn')?.addEventListener('click', ()=>{S.notifOpen=!S.notifOpen; render();});
  $('rdAllBtn')?.addEventListener('click', async()=>{ await api('PATCH','/notifications/read-all'); await loadNotifs(); render(); });
  
  const toggleMenu = () => {
    document.querySelector('.sidebar')?.classList.toggle('open');
    $('sidebarOverlay')?.classList.toggle('open');
  };
  $('menuBtn')?.addEventListener('click', toggleMenu);
  $('sidebarOverlay')?.addEventListener('click', toggleMenu);
  
  const filterRows = () => {
    const q = ($('dashSearch')?.value || '').toLowerCase();
    const st = $('dashFilterStage')?.value || '';
    document.querySelectorAll('.dash-row').forEach(row => {
      const matchQ = !q || row.dataset.search.toLowerCase().includes(q);
      const matchSt = !st || row.dataset.stage === st;
      row.style.display = (matchQ && matchSt) ? '' : 'none';
    });
  };
  $('dashSearch')?.addEventListener('input', filterRows);
  $('dashFilterStage')?.addEventListener('change', filterRows);

  document.body.addEventListener('click', async (e) => {
    const silenceBtn = e.target.closest('[data-silence]');
    if (silenceBtn) {
      e.stopPropagation();
      localStorage.setItem('silenced_' + (S.user?.id || '') + '_' + silenceBtn.dataset.silence, Date.now());
      toast('Alert silenced for you');
      render();
      return;
    }
  });

  document.body.addEventListener('change', (e) => {
    if (e.target.id === 'static_ip_required') {
       const w = $('sip_wrap');
       if (w) w.style.display = e.target.value === 'Yes' ? 'contents' : 'none';
    }
    if (e.target.id === 'router_accessories') {
       const w = $('rtr_wrap');
       if (w) w.style.display = e.target.value === 'Yes' ? 'contents' : 'none';
    }
  });
  
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', async () => { 
       document.querySelector('.sidebar')?.classList.remove('open');
       $('sidebarOverlay')?.classList.remove('open');
       S.page=el.dataset.nav; S.tenderId=null; 
       if (S.page === 'admin') {
           await loadUsers(); await loadAudit();
       }
       render(); 
    });
  });
  document.querySelectorAll('[data-atab]').forEach(el => {
    el.addEventListener('click', () => { 
       S.adminTab=el.dataset.atab; 
       document.querySelectorAll('[data-atab]').forEach(b => b.classList.remove('active'));
       el.classList.add('active');
       const c = $('atab-content'); if (c) c.innerHTML = renderAdminTab();
    });
  });
  document.querySelectorAll('[data-tnav]').forEach(el => {
    el.addEventListener('click', async () => { 
       S.tenderId = el.dataset.tnav; S.page = 'tenders'; 
       await loadTender(S.tenderId); 
       const tabs = detailTabs(S.tender, S.user.role);
       S.tab = tabs.length > 0 ? tabs[0].k : 'tender_info';
       render(); 
    });
  });
  document.querySelectorAll('[data-lnav]').forEach(el => {
    el.addEventListener('click', async () => { 
       S.leadId = el.dataset.lnav; S.page = 'leads'; 
       await loadLead(S.leadId); 
       if (S.leadItem) {
           const tabs = leadTabs(S.leadItem, S.user.role);
           S.tab = tabs.length > 0 ? tabs[0].k : 'lead_info';
       }
       render(); 
    });
  });
  document.querySelectorAll('[data-tab]').forEach(el => {
    el.addEventListener('click', () => { S.tab=el.dataset.tab; render(); });
  });
  document.querySelectorAll('[data-dtab]').forEach(el => {
    el.addEventListener('click', () => { S.dtab=el.dataset.dtab; render(); });
  });
  document.querySelectorAll('[data-modal]').forEach(el => {
    el.addEventListener('click', () => openModal(el.dataset.modal));
  });
  
  $('analyticsDateFilter')?.addEventListener('change', (e) => {
    S.analyticsFilter = e.target.value;
    render();
  });
  $('btnDashNewTender')?.addEventListener('click', () => openModal('btnNewTenderPage'));
  $('btnDashNewLead')?.addEventListener('click', () => openModal('btnNewLeadPage'));

  $('btnNewTender')?.addEventListener('click', () => openModal('btnNewTender'));
  $('btnNewTenderPage')?.addEventListener('click', () => openModal('btnNewTenderPage'));
  $('backTenderBtn')?.addEventListener('click', () => { S.tenderId=null; S.tender=null; S.page='dashboard'; render(); });

  // Phase 1: Save draft form (lives on main page, not in a modal)
  
  $('btnNewLead')?.addEventListener('click', () => openModal('btnNewLead'));
  $('btnNewLeadPage')?.addEventListener('click', () => openModal('btnNewLeadPage'));
  $('backLeadBtn')?.addEventListener('click', () => { S.leadId=null; S.leadItem=null; S.page='dashboard'; render(); });

  $('ph1LeadForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = {
      org_name: $('org_name').value,
      pre_bid_location: $('pre_bid_location')?.value, pre_bid_contact: $('pre_bid_contact')?.value, pre_bid_datetime: $('pre_bid_datetime')?.value,
      contract_period: $('contract_period').value,
      payment_terms: $('payment_terms').value, service_type: $('service_type').value, bandwidth_mbps: $('bandwidth_mbps').value || null,
      ddos_with_ill: $('ddos_with_ill').value, media_type: $('media_type').value, static_ip_required: $('static_ip_required').value,
      num_ipv4: $('num_ipv4')?.value ? parseInt($('num_ipv4').value) : null, num_ipv6: $('num_ipv6')?.value ? parseInt($('num_ipv6').value) : null,
      router_accessories: $('router_accessories').value, router_count: $('router_count')?.value ? parseInt($('router_count').value) : null,
      mrcp: $('mrcp').value || null, gst: $('gst').value || null, total_bid_value: $('total_bid_value').value || null,
      grievance_contact: $('grievance_contact').value, link_delivery_address: $('link_delivery_address').value,
      gst_number: $('gst_number')?.value,
      requirements: { ...(S.leadItem?.requirements || {}), order_number: $('order_number')?.value }
    };
    try { await api('PATCH', `/leads/${S.leadId}`, b); await loadLead(S.leadId); render(); toast('Phase 1 Saved!', 'success'); } catch (ex) { toast(ex.message, 'error'); }
  });

  const docLeadZone = $('docLeadDrop'), docLeadInput = $('docLeadFile');
  if (docLeadZone && docLeadInput) {
    docLeadZone.addEventListener('click', () => docLeadInput.click());
    docLeadInput.addEventListener('change', async () => {
      if (!docLeadInput.files[0]) return;
      const fd = new FormData(); fd.append('file', docLeadInput.files[0]);
      try { await up(`/leads/${S.leadId}/documents`, fd); await loadLead(S.leadId); render(); toast('Uploaded!', 'success'); }
      catch (e) { toast(e.message, 'error'); }
    });
  }

  $('btnSubmitPh1Lead')?.addEventListener('click', async () => {
    if (confirm('Submit lead to Technical team?')) {
      try { await api('POST', `/leads/${S.leadId}/move`, { stage: 'ph2_active' }); await loadAll(); await loadLead(S.leadId); render(); toast('Moved to Phase 2', 'success'); } catch (e) { toast(e.message, 'error'); }
    }
  });

  $('ph1TenderForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = {
      bid_number: $('bid_number').value, bid_init_date: $('bid_init_date').value, bid_end_datetime: $('bid_end_datetime').value,
      bid_opening_datetime: $('bid_opening_datetime').value, ministry_state: $('ministry_state').value, org_name: $('org_name').value,
      dept_name: $('dept_name').value, 
      pre_bid_location: $('pre_bid_location')?.value, pre_bid_contact: $('pre_bid_contact')?.value, pre_bid_datetime: $('pre_bid_datetime')?.value,
      contract_period: $('contract_period').value, est_bid_value: $('est_bid_value').value || null,
      payment_terms: $('payment_terms').value, service_type: $('service_type').value, bandwidth_mbps: $('bandwidth_mbps').value || null,
      ddos_with_ill: $('ddos_with_ill').value, media_type: $('media_type').value, static_ip_required: $('static_ip_required').value,
      num_ipv4: $('num_ipv4')?.value ? parseInt($('num_ipv4').value) : null, num_ipv6: $('num_ipv6')?.value ? parseInt($('num_ipv6').value) : null,
      router_accessories: $('router_accessories').value, router_count: $('router_count')?.value ? parseInt($('router_count').value) : null,
      total_bid_value: $('total_bid_value').value || null, grievance_contact: $('grievance_contact').value,
      link_delivery_address: $('link_delivery_address').value,
      gst_number: $('gst_number')?.value,
      requirements: { ...(S.tenderItem?.requirements || {}), order_number: $('order_number')?.value }
    };
    try { await api('PATCH', `/tenders/${S.tenderId}`, b); await loadTender(S.tenderId); render(); toast('Phase 1 Saved!', 'success'); } catch (ex) { toast(ex.message, 'error'); }
  });

  // Phase 1: Document upload zone (lives on main page)
  const docZone = $('docTenderDrop'), docInput = $('docTenderFile');
  if (docZone && docInput) {
    docZone.addEventListener('click', () => docInput.click());
    docInput.addEventListener('change', async () => {
      if (!docInput.files[0]) return;
      const fd = new FormData(); fd.append('file', docInput.files[0]);
      try { await up(`/tenders/${S.tenderId}/documents`, fd); await loadTender(S.tenderId); render(); toast('Uploaded!', 'success'); }
      catch (e) { toast(e.message, 'error'); }
    });
  }

  // Phase 1: Submit to Technical button (lives on main page)
  $('btnSubmitPh1Tender')?.addEventListener('click', async () => {
    if (confirm('Submit tender to Technical team? This will lock Phase 1 for editing.')) {
      try { await api('POST', `/tenders/${S.tenderId}/move`, { stage: 'ph2_active' }); await loadAll(); await loadTender(S.tenderId); render(); toast('Moved to Phase 2 — Technical', 'success'); } catch (e) { toast(e.message, 'error'); }
    }
  });
}

window.calcTotal = function() {
  const m = parseFloat(document.getElementById('mrcp')?.value || 0);
  const g = parseFloat(document.getElementById('gst')?.value || 0);
  const t = document.getElementById('total_bid_value');
  if (t) t.value = (m + (m * g / 100)).toFixed(2);
};

// ---- Run ----
init();



