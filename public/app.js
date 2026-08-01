// ============================================================
// TENDEROPS — ISP Tender Management System (Vanilla JS SPA)
// ============================================================

// ---- State ----
const S = {
  user: null, token: localStorage.getItem('_tok'),
  workspaceId: localStorage.getItem('_ws') || null, workspaces: [],
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
  return path.split('_')[0];
}

function getVal(t) {
  if ((t.data?.category === 'order' || t.data?.category === 'project') && t.data?.items) {
    const sum = t.data.items.reduce((s, item) => {
      const qty = parseFloat(item['Qty']) || 1;
      const price = parseFloat(item['Price (₹)']) || 0;
      const amt = parseFloat(item['Amount (₹)']) || 0;
      const gst = parseFloat(item['GST %']) || 0;
      
      let itemTotal = amt;
      if (itemTotal === 0 && price > 0) {
        itemTotal = qty * price * (1 + (gst/100));
      }
      return s + itemTotal;
    }, 0);
    if (sum > 0) return sum;
  }
  return parseFloat(t.quoted_bid_value || t.total_bid_value || t.value || t.est_bid_value || 0);
}

function getPeriod(t) {
  if ((t.data?.category === 'order' || t.data?.category === 'project') && t.data?.items && t.data.items.length > 0) {
    return t.data.items[0]['Period'] || t.contract_period || '-';
  }
  return t.contract_period || '-';
}

async function audit(action, type, id, details = {}) {
  await sbClient.from('audit_logs').insert({ action, entity_type: type, entity_id: id, user_id: S.user.id, details, workspace_id: S.workspaceId });
}

async function notify(userId, title, message, type = 'info', linkId = null) {
  await sbClient.from('notifications').insert({ user_id: userId, title, message, type, link_id: linkId, workspace_id: S.workspaceId });
}

async function notifyRole(roleName, title, message, type = 'info', linkId = null) {
  const { data: users } = await sbClient.from('users').select('*').eq('role', roleName).eq('status', 'active');
  if (!users) return;
  const { data: wu } = await sbClient.from('workspace_users').select('user_id')[S.workspaceId ? 'eq' : 'is']('workspace_id', S.workspaceId || null);
  const allowed = wu ? wu.map(w => w.user_id) : [];
  for (const u of users) {
    if (u.role === 'admin' || allowed.includes(u.id)) {
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
  
  if (path === '/users' && method === 'POST') {
    const { data: authData, error: authError } = await sbClient.auth.signUp({
      email: body.email,
      password: body.password,
    });
    if (authError) throw authError;
    const { data, error } = await sbClient.from('users').insert([{
      id: authData.user?.id,
      name: body.name,
      email: body.email,
      role: body.role,
      status: 'active'
    }]).select().single();
    if (error) throw error;
    return data;
  }
  
  if (path === '/tenders' || path === '/leads') {
    const table = path === '/tenders' ? 'tenders' : 'leads';
    const p3Table = path === '/tenders' ? 'phase3_records' : 'lead_phase3_records';
    if (method === 'GET') {
      const { data } = await sbClient.from(table).select(`*, ${p3Table}(quoted_bid_value)`)[S.workspaceId ? 'eq' : 'is']('workspace_id', S.workspaceId || null);
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
      const { data } = await sbClient.from(table).insert({...body, created_by: S.user.id, workspace_id: S.workspaceId}).select();
      await audit('create', table.slice(0, -1), data[0].id);
      return data[0];
    }
  }
  
  if (path === '/audit' && method === 'GET') {
    const { data } = await sbClient.from('audit_logs').select('*, users (name)')[S.workspaceId ? 'eq' : 'is']('workspace_id', S.workspaceId || null).order('created_at', { ascending: false }).limit(50);
    return data.map(d => ({ ...d, user_name: d.users?.name || 'Unknown' }));
  }
  
  if (path === '/notifications' && method === 'GET') {
    const { data } = await sbClient.from('notifications').select('*').eq('user_id', S.user.id)[S.workspaceId ? 'eq' : 'is']('workspace_id', S.workspaceId || null).order('created_at', { ascending: false });
    return data;
  }
  
  if (path === '/notifications/read-all' && method === 'PATCH') {
    await sbClient.from('notifications').update({ read: true }).eq('user_id', S.user.id);
    return { success: true };
  }
  
  if (path === '/export/data' && method === 'GET') {
    const fetchFull = async (isLead) => {
      const table = isLead ? 'leads' : 'tenders';
      const prefix = isLead ? 'lead_' : '';
      const pId = isLead ? 'lead_id' : 'tender_id';
      
      const { data: main } = await sbClient.from(table).select('*')[S.workspaceId ? 'eq' : 'is']('workspace_id', S.workspaceId || null);
      if (!main) return [];
      
      const [docs, tech, ph3, ph4, inv, cyc, cir] = await Promise.all([
        sbClient.from(prefix + (isLead ? 'documents' : 'tender_documents')).select('*'),
        sbClient.from(prefix + 'technical_reports').select('*'),
        sbClient.from(prefix + 'phase3_records').select('*'),
        sbClient.from(prefix + 'phase4_records').select('*'),
        sbClient.from(prefix + 'invoices').select('*'),
        sbClient.from(prefix + 'payment_cycles').select('*'),
        sbClient.from('circuits').select('*').eq('parent_type', isLead ? 'lead' : 'tender')
      ]);
      
      return main.map(item => ({
        ...item,
        documents: (docs.data || []).filter(d => d[pId] === item.id),
        technical_reports: (tech.data || []).filter(d => d[pId] === item.id),
        phase3_records: (ph3.data || []).filter(d => d[pId] === item.id),
        phase4_records: (ph4.data || []).filter(d => d[pId] === item.id),
        invoices: (inv.data || []).filter(d => d[pId] === item.id),
        payment_cycles: (cyc.data || []).filter(d => d[pId] === item.id),
        circuits: (cir.data || []).filter(d => d.parent_id === item.id)
      }));
    };
    const [tenders, leads] = await Promise.all([fetchFull(false), fetchFull(true)]);
    return { tenders, leads };
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
      await sbClient.from(prefix + 'technical_reports').insert({ ...body, [isLead ? 'lead_id' : 'tender_id']: id, created_by: S.user.id, workspace_id: S.workspaceId });
      await sbClient.from(table).update({ stage: 'ph3_active' }).eq('id', id);
      await audit('report.submit', eType, id);
      const eName = isLead ? S.leadItem?.title : S.tender?.bid_number;
      await notifyRole('tender', 'Technical Report Ready', `Phase 2 complete for "${eName}". ${isLead ? 'Lead' : 'Tender'} has automatically moved to Phase 3.`, 'success', id);
      return { success: true };
    }
    
    if (sub === 'phase3' && method === 'POST') {
      await sbClient.from(prefix + 'phase3_records').insert({ ...body, [isLead ? 'lead_id' : 'tender_id']: id, created_by: S.user.id, workspace_id: S.workspaceId });
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
          parent_id: id, parent_type: isLead ? 'lead' : 'tender', circuit_id: `IPN${seqKey}-${nextVal}`, workspace_id: S.workspaceId
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
      await sbClient.from(prefix + 'payment_cycles').insert({ ...body, [isLead ? 'lead_id' : 'tender_id']: id, created_by: S.user.id, workspace_id: S.workspaceId });
      return { success: true };
    }
    
    if (sub.startsWith('payment-cycles/') && method === 'PATCH') {
      const cid = sub.split('/')[1];
      await sbClient.from(prefix + 'payment_cycles').update(body).eq('id', cid);
      return { success: true };
    }
  }
  
  const docDelMatch = path.match(/^\/(tenders|leads)\/[^\/]+\/documents\/([^\/]+)$/);
  if (docDelMatch && method === 'DELETE') {
    const table = docDelMatch[1] === 'leads' ? 'lead_documents' : 'tender_documents';
    const { error } = await sbClient.from(table).delete().eq('id', docDelMatch[2]);
    if (error) throw error;
    return { success: true };
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
      [pId]: id, name: fileData.name, stored: fileData.stored, url: fileData.url, size: fileData.size, mime: fileData.mime, uploaded_by: S.user.id, workspace_id: S.workspaceId
    });
    await audit('doc.upload', eType, id, { name: fileData.name });
    return { success: true };
  }
  
  if (sub === 'phase2') {
    const fDoc = await uploadFile(fd.get('feasibility_doc'));
    const sDoc = await uploadFile(fd.get('site_survey_doc'));
    await sbClient.from(prefix + 'technical_reports').insert({
      [pId]: id, submitted_by: S.user.id, workspace_id: S.workspaceId,
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
      [pId]: id, created_by: S.user.id, workspace_id: S.workspaceId,
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
    const basePrice = parseFloat(fd.get('base_price') || 0);
    const gstPct = parseFloat(fd.get('gst_pct') || 0);
    const invoiceVal = basePrice + (basePrice * (gstPct / 100));
    
    await sbClient.from(prefix + 'invoices').insert({
      [pId]: id, created_by: S.user.id, workspace_id: S.workspaceId,
      invoice_number: fd.get('invoice_number'),
      [prefix === 'lead_' ? 'notif_to_lead_date' : 'notif_to_tender_date']: fd.get('notif_to_tender_date') || fd.get('notif_to_lead_date'),
      award_date: fd.get('award_date'),
      total_price: parseFloat(fd.get('total_price') || 0),
      billing_price: parseFloat(fd.get('billing_price') || 0),
      base_price: basePrice,
      gst_pct: gstPct,
      invoice_value: invoiceVal,
      duration_from: fd.get('duration_from'),
      duration_to: fd.get('duration_to'),
      payment_cycle: fd.get('payment_cycle'),
      invoice_upload_url: invDoc?.url || null
    });
    await sbClient.from(table).update({ stage: 'ph5_active' }).eq('id', id);
    await audit('phase5.submit', eType, id);
    return { success: true };
  }
  
  if (sub === 'payment-cycles' || sub.startsWith('payment-cycles/')) {
    const isUpdate = sub.includes('/');
    const cid = isUpdate ? sub.split('/')[1] : null;
    
    const payload = {};
    if (fd.has('cycle_number')) payload.cycle_number = parseInt(fd.get('cycle_number'));
    if (fd.has('period_from')) payload.period_from = fd.get('period_from');
    if (fd.has('period_to')) payload.period_to = fd.get('period_to');
    if (fd.has('amount_due')) payload.amount_due = parseFloat(fd.get('amount_due') || 0);
    if (fd.has('payment_status')) payload.payment_status = fd.get('payment_status');
    if (fd.has('amount_received')) payload.amount_received = parseFloat(fd.get('amount_received') || 0);
    if (fd.has('payment_date')) payload.payment_date = fd.get('payment_date');
    if (fd.has('invoice_number')) payload.invoice_number = fd.get('invoice_number');
    
    if (fd.has('invoice_doc')) {
       const invDoc = await uploadFile(fd.get('invoice_doc'));
       if (invDoc) payload.invoice_doc_url = invDoc.url;
    }
    
    if (isUpdate) {
       await sbClient.from(prefix + 'payment_cycles').update(payload).eq('id', cid);
    } else {
       payload[pId] = id;
       payload.created_by = S.user.id;
       payload.workspace_id = S.workspaceId;
       await sbClient.from(prefix + 'payment_cycles').insert(payload);
    }
    
    // Auto-close check
    const { data: cycles } = await sbClient.from(prefix + 'payment_cycles').select('payment_status').eq(pId, id);
    if (cycles && cycles.length > 0 && cycles.every(cy => cy.payment_status === 'Paid')) {
        await sbClient.from(table).update({ stage: 'closed' }).eq('id', id);
    }
    
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
    
    let ws = [];
    if (S.user.role === 'admin') {
      const { data, error } = await sbClient.from('workspaces').select('*');
      ws = data || []; if(error) alert('WS Fetch Error: ' + error.message);
    } else {
      const { data } = await sbClient.from('workspace_users').select('workspaces(*)').eq('user_id', S.user.id);
      ws = data ? data.map(d => d.workspaces).filter(Boolean) : [];
    }
    S.workspaces = ws;
    if (!S.workspaceId || !S.workspaces.find(w => w.id === S.workspaceId)) {
      S.workspaceId = S.workspaces.find(w => w.name === 'IPNET')?.id || (S.workspaces[0] ? S.workspaces[0].id : null);
      if (S.workspaceId) localStorage.setItem('_ws', S.workspaceId);
    }
    
    await loadAll();
    setupRealtime();
    setInterval(loadNotifs, 30000);
    render();
  } catch { localStorage.removeItem('_tok'); showLogin(); }
}

window.switchWorkspace = async function(id) {
  S.workspaceId = id;
  localStorage.setItem('_ws', id);
  S.tenderId = null;
  S.leadId = null;
  S.tender = null;
  S.leadItem = null;
  S.tab = null;
  await loadAll();
  render();
};

function setupRealtime() {
  if (!window.subscribeToTable) return;
  
  window.subscribeToTable('leads', async () => {
    await loadLeads();
    render();
  });
  
  window.subscribeToTable('tenders', async () => {
    await loadTenders();
    if (S.tenderId) await loadTender(S.tenderId);
    render();
  });
  
  window.subscribeToTable('notifications', async () => {
    if (typeof loadNotifs === 'function') await loadNotifs();
    render();
  });
  
  if (['admin', 'mgmt'].includes(S.user?.role)) {
    window.subscribeToTable('audit_logs', async () => {
      if (typeof loadAudit === 'function') await loadAudit();
      render();
    });
    window.subscribeToTable('users', async () => {
      if (typeof loadUsers === 'function') await loadUsers();
      render();
    });
  }
}

async function loadAll() {
  const p = [loadTenders(), loadLeads(), loadNotifs()];
  if (['admin', 'mgmt'].includes(S.user?.role)) { p.push(loadAudit()); p.push(loadUsers()); }
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
      <div style="flex:1"></div>
      <select id="workspaceSwitcher" onchange="window.switchWorkspace(this.value)" style="margin-right: 20px; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-weight: 500; font-size: 14px; cursor: pointer; min-width: 100px;">
        ${S.workspaces.map(ws => `<option value="${ws.id}" ${ws.id === S.workspaceId ? 'selected' : ''}>${esc(ws.name)}</option>`).join('')}
      </select>
      <div class="page-actions">
        <button class="icon-btn" id="nb-btn" title="Notifications">🔔
          <span class="notif-badge" id="nb" style="display:${S.unread?'flex':'none'}">${S.unread}</span>
        </button>
      </div>
    </header>`;
}

// ---- Pipeline ----
function Pipeline(stage, cat) {
  const isOrder = cat === 'order';
  let STEPS = [
    {l:'Ph1: Tender',stages:['ph1_draft','ph1_complete']},
    {l:'Ph2: Technical',stages:['ph2_active','ph2_complete']},
    {l:'Ph3: Award',stages:['ph3_active','ph3_awarded','ph3_disqualified']},
    {l:'Ph4: Delivery',stages:['ph4_active','ph4_complete']},
    {l:'Ph5: Billing',stages:['ph5_active','closed']}
  ];
  if (isOrder) STEPS = [
    {l:'Draft', stages:['ph1_draft']},
    {l:'Ph5: Billing', stages:['ph5_active','closed']}
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
    let leads = (S.leads || []).map(l => ({ ...l, _type: 'Lead' })).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    if (role === 'tech') leads = leads.filter(l => l.stage !== 'ph1_draft');
    const isAcipl = (S.workspaces.find(w => w.id === S.workspaceId)?.name || '').toLowerCase() === 'acipl';
    return `
      <div class="card" style="margin-bottom:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <div class="sec-title" style="margin-bottom:0;flex:1">Leads Overview</div>
          <div style="display:flex;gap:8px;">
            ${['lead','admin'].includes(role) ? '<button class="btn btn-primary btn-sm" id="btnNewLead">+ New Lead</button>' : ''}
            ${isAcipl && ['admin','mgmt','tender','lead'].includes(role)?`<button class="btn btn-primary btn-sm" onclick="openModal('create-order')">+ New Order</button>`:''}
            ${isAcipl && ['admin','mgmt','tender','lead'].includes(role)?`<button class="btn btn-primary btn-sm" onclick="openModal('create-project')">+ New Project</button>`:''}
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
                    ${isTech ? `<td>${esc(acc.service_type || '-')}</td>` : `<td style="font-weight:600">${fmt(getVal(acc), 'currency')}</td>`}
                    <td>${esc(getPeriod(acc))}</td>
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
    let tenders = (S.tenders || []).map(t => ({ ...t, _type: 'Tender' })).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    if (role === 'tech') tenders = tenders.filter(t => t.stage !== 'ph1_draft');
    const isAcipl = (S.workspaces.find(w => w.id === S.workspaceId)?.name || '').toLowerCase() === 'acipl';
    return `
      <div class="card" style="margin-bottom:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <div class="sec-title" style="margin-bottom:0;flex:1">Tenders Overview</div>
          <div style="display:flex;gap:8px;">
            ${['tender','admin'].includes(role) ? '<button class="btn btn-primary btn-sm" id="btnNewTender">+ New Tender</button>' : ''}
            ${isAcipl && ['admin','mgmt','tender','lead'].includes(role)?`<button class="btn btn-primary btn-sm" onclick="openModal('create-order')">+ New Order</button>`:''}
            ${isAcipl && ['admin','mgmt','tender','lead'].includes(role)?`<button class="btn btn-primary btn-sm" onclick="openModal('create-project')">+ New Project</button>`:''}
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
                    ${isTech ? `<td>${esc(acc.service_type || '-')}</td>` : `<td style="font-weight:600">${fmt(getVal(acc), 'currency')}</td>`}
                    <td>${esc(getPeriod(acc))}</td>
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
  const awardedTenders = filteredTenders.filter(t => ['ph3_awarded', 'ph4_active', 'ph4_complete', 'ph5_active', 'closed'].includes(t.stage)).length;
  
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
    const v = getVal(t);
    if (t.stage === 'ph5_active') {
      revenue += v;
      pendingBilling += v;
    }
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
    upcomingDeadlines: [],
    recentActivity: []
  };

  const isAcipl = (S.workspaces.find(w => w.id === S.workspaceId)?.name || '').toLowerCase() === 'acipl';
  
  data.quickActions = [
    { label: '+ Add New Lead', id: 'btnDashNewLead', iconKey: 'lead', show: ['lead','admin','mgmt'].includes(role) },
    { label: '+ Add New Tender', id: 'btnDashNewTender', iconKey: 'tender', show: ['tender','admin','mgmt'].includes(role) }
  ];

  if (isAcipl) {
    data.quickActions.push(
      { label: '+ New Order', id: 'btnDashNewOrder', iconKey: 'tender', show: ['admin','mgmt','tender','lead'].includes(role) },
      { label: '+ New Project', id: 'btnDashNewProject', iconKey: 'tender', show: ['admin','mgmt','tender','lead'].includes(role) }
    );
  }

  // Revenue by Service Type
  const srvMap = {};
  allItems.forEach(t => {
    if (t.stage !== 'ph5_active') return;
    const s = t.service_type || 'Other';
    srvMap[s] = (srvMap[s] || 0) + getVal(t);
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
    if (t.stage !== 'ph5_active') return;
    const m = new Date(t.created_at).toLocaleString('en-US', {month:'short'});
    const v = getVal(t);
    if (revMap[m] !== undefined && v > 0) {
      revMap[m] += v;
    }
  });
  data.monthlyRevenue = Object.entries(revMap).map(e => ({ label: e[0], value: e[1] }));

  // Tender Overview
  const tenderStatus = { 'Awarded': 0, 'In Progress': 0, 'Lost': 0, 'Completed': 0 };
  allItems.forEach(t => {
    if (t.stage === 'ph3_awarded' || t.stage === 'ph4_active' || t.stage === 'ph4_complete' || t.stage === 'ph5_active') tenderStatus['Awarded']++;
    else if (t.stage === 'closed') tenderStatus['Completed']++;
    else if (t.stage === 'ph3_disqualified') tenderStatus['Lost']++;
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
  const role = S.user?.role;
  let list = S.tenders || [];
  if (role === 'tech') list = list.filter(t => t.stage !== 'ph1_draft');
  const isAcipl = (S.workspaces.find(w => w.id === S.workspaceId)?.name || '').toLowerCase() === 'acipl';
  return `
    <div class="page-header">
      <div><div class="page-title">Tenders</div><div class="page-sub">${list.length} tenders</div></div>
      <div class="page-actions" style="display:flex; gap:8px;">
        ${role === 'admin' ? `<button class="btn btn-outline" id="btnExportTenders">Export CSV</button>` : ''}
        ${['tender','admin'].includes(role)?`<button class="btn btn-primary" id="btnNewTenderPage">+ New Tender</button>`:''}
        ${isAcipl && ['admin','mgmt','tender','lead'].includes(role)?`<button class="btn btn-primary" onclick="openModal('create-order')">+ New Order</button>`:''}
        ${isAcipl && ['admin','mgmt','tender','lead'].includes(role)?`<button class="btn btn-primary" onclick="openModal('create-project')">+ New Project</button>`:''}
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
            <td style="font-weight:700">${fmt(getVal(t),'currency')}</td>
            <td>${fmt(t.bid_end_datetime,'date')}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`:
      `<div class="empty"><div class="empty-icon">ðŸ”</div><div class="empty-title">No tenders</div></div>`}`;
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
            <td>${esc(getPeriod(t))}</td>
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
            <td>${esc(getPeriod(t))}</td>
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
      `<div class="empty"><div class="empty-icon">ðŸ’°</div><div class="empty-title">No tender billing items yet</div></div>`}
      
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
      `<div class="empty"><div class="empty-icon">ðŸ’°</div><div class="empty-title">No lead billing items yet</div></div>`}
  `;
}

// ---- Admin Page ----
function PageAdmin() {
  return `
    <div class="header-row">
      <h2>Administration</h2>
    </div>
    <div class="tabs">
      <button class="tab-btn ${S.adminTab==='users'?'active':''}" onclick="S.adminTab='users';render()">Users</button>
      <button class="tab-btn ${S.adminTab==='audit'?'active':''}" onclick="S.adminTab='audit';render()">Audit Logs</button>
      <button class="tab-btn ${S.adminTab==='workspaces'?'active':''}" onclick="S.adminTab='workspaces';render()">Workspaces</button>
    </div>
    ${S.adminTab === 'users' ? `
      <!-- Users list -->
      <div class="card p-24" style="margin-bottom: 24px; display: flex; gap: 12px; align-items: flex-end;">
        <div style="flex:1">
          <label class="form-label">Name</label>
          <input type="text" id="nu-name" class="form-control" placeholder="New User Name">
        </div>
        <div style="flex:1">
          <label class="form-label">Email</label>
          <input type="email" id="nu-email" class="form-control" placeholder="user@company.com">
        </div>
        <div style="flex:1">
          <label class="form-label">Password</label>
          <input type="password" id="nu-pass" class="form-control" placeholder="Initial Password">
        </div>
        <div style="flex:1">
          <label class="form-label">Role</label>
          <select id="nu-role" class="form-control">
            <option value="lead">Phase 1 & 3: Lead Manager</option>
            <option value="tender">Phase 1 & 3: Tender Manager</option>
            <option value="tech">Phase 2 & 4: Technical</option>
            <option value="acct">Phase 5: Billing & Accounts</option>
            <option value="admin">Administrator</option>
            <option value="mgmt">Management</option>
          </select>
        </div>
        <button class="btn btn-primary" onclick="createUser()">Add User</button>
      </div>
      <div class="card p-24">
        <table class="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${S.users.map(u => `
              <tr>
                <td>${esc(u.name)}</td>
                <td>${esc(u.email)}</td>
                <td><span class="status-badge ${u.role==='admin'?'b-purple':'b-blue'}">${roleLabel(u.role)}</span></td>
                <td><span class="status-badge ${u.status==='active'?'b-green':'b-red'}">${u.status}</span></td>
                <td>
                  <button class="icon-btn" onclick="toggleUserStatus('${u.id}', '${u.status}')" title="${u.status==='active'?'Deactivate':'Activate'}">${u.status==='active'?'⏻':'✓'}</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : S.adminTab === 'audit' ? `
      <div class="card p-24">
        <table class="table">
          <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
          <tbody>
            ${S.audit.map(a => `
              <tr>
                <td><div class="table-subtext">${fmt(a.created_at, 'date')}</div></td>
                <td>${esc(a.user_name||'')}</td>
                <td>${esc(a.action)}</td>
                <td>${esc(a.entity_type)}</td>
                <td><div class="table-subtext">${JSON.stringify(a.details)}</div></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : renderAdminWorkspaces()}
  `;
}

function renderAdminWorkspaces() {
  return `
    <div class="card p-24" style="margin-bottom: 24px; display: flex; gap: 12px; align-items: flex-end;">
      <div style="flex:1">
        <label class="form-label">Workspace Name</label>
        <input type="text" id="nw-name" class="form-control" placeholder="New Workspace Name">
      </div>
      <button class="btn btn-primary" onclick="createWorkspace()">Add Workspace</button>
    </div>
    <div class="card p-24">
      <table class="table">
        <thead><tr><th>Workspace ID</th><th>Name</th><th>Actions</th></tr></thead>
        <tbody>
          ${(S.workspaces || []).map(w => `
            <tr>
              <td>${esc(w.id)}</td>
              <td>${esc(w.name)}</td>
              <td>
                <button class="btn btn-sm btn-secondary" onclick="openManageAccess('${w.id}')">Manage Access</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function createWorkspace() {
  const name = document.getElementById('nw-name').value.trim();
  if (!name) return typeof toast !== 'undefined' ? toast('Name is required', 'error') : alert('Name required');
  
  try {
    const { data, error } = await sbClient.from('workspaces').insert({ name }).select();
    if (error) throw error;
    
    const newId = data[0].id;
    await sbClient.from('workspace_users').upsert({ workspace_id: newId, user_id: S.user.id }, { onConflict: 'workspace_id,user_id', ignoreDuplicates: true });
    
    // Reload workspaces
    let ws = [];
    if (S.user.role === 'admin') {
      const { data } = await sbClient.from('workspaces').select('*');
      ws = data || [];
    } else {
      const { data } = await sbClient.from('workspace_users').select('workspaces(*)').eq('user_id', S.user.id);
      ws = data ? data.map(d => d.workspaces).filter(Boolean) : [];
    }
    S.workspaces = ws;
    
    render();
    if (typeof toast !== 'undefined') toast('Workspace created', 'success');
  } catch(e) {
    if (typeof toast !== 'undefined') toast('Error: ' + e.message, 'error');
    else alert('Error: ' + e.message);
  }
}

async function openManageAccess(wsId) {
  S.managingWorkspaceId = wsId;
  S.managingWorkspaceUsers = [];
  
  try {
    if (!S.users || S.users.length === 0) await loadUsers();
    const { data, error } = await sbClient.from('workspace_users').select('user_id')[wsId ? 'eq' : 'is']('workspace_id', wsId || null);
    if (error) throw error;
    S.managingWorkspaceUsers = data ? data.map(d => d.user_id) : [];
    renderManageAccessModal();
  } catch(e) {
    if (typeof toast !== 'undefined') toast('Failed to load workspace access: ' + e.message, 'error');
  }
}

function renderManageAccessModal() {
  const ws = S.workspaces.find(w => w.id === S.managingWorkspaceId);
  const body = `
    <div style="max-height: 400px; overflow-y: auto;">
      <table class="table">
        <thead><tr><th>User</th><th>Email</th><th>Access</th></tr></thead>
        <tbody>
          ${(S.users || []).map(u => {
            const hasAccess = S.managingWorkspaceUsers.includes(u.id);
            const isAdmin = u.role === 'admin';
            return `
              <tr>
                <td>${esc(u.name)}</td>
                <td>${esc(u.email)}</td>
                <td>
                  <div class="switch-container">
                    <label class="switch">
                      <input type="checkbox" ${hasAccess || isAdmin ? 'checked' : ''} 
                             ${isAdmin ? 'disabled title="Admins always have access"' : ''}
                             onchange="toggleWorkspaceAccess('${u.id}', this.checked)">
                      <span class="slider round"></span>
                    </label>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
  
  showModal(MW(`Manage Access: ${esc(ws?.name || '')}`, body, `<button class="btn btn-ghost" onclick="removeModal()">Close</button>`));
}

async function toggleWorkspaceAccess(userId, hasAccess) {
  try {
    if (!hasAccess) {
      const { error } = await sbClient.from('workspace_users').delete().match({ workspace_id: S.managingWorkspaceId, user_id: userId });
      if (error) throw error;
      S.managingWorkspaceUsers = S.managingWorkspaceUsers.filter(id => id !== userId);
    } else {
      const { error } = await sbClient.from('workspace_users').upsert({ workspace_id: S.managingWorkspaceId, user_id: userId }, { onConflict: 'workspace_id,user_id', ignoreDuplicates: true });
      if (error) throw error;
      if (!S.managingWorkspaceUsers.includes(userId)) S.managingWorkspaceUsers.push(userId);
    }
  } catch(e) {
    if (typeof toast !== 'undefined') toast('Failed to update access: ' + e.message, 'error');
  }
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
          <div class="notif-item ${!n.read?'unread':''}" ${n.link_id?`onclick="const isTender=(S.tenders||[]).find(x=>x.id==='${n.link_id}');if(isTender){S.tenderId='${n.link_id}';S.page='tenders';loadTender('${n.link_id}').then(()=>render());}else{S.leadId='${n.link_id}';S.page='leads';loadLead('${n.link_id}').then(()=>render());}"`:''}>
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
    ${Pipeline(t.stage, t.data?.category)}
    <div class="tabs">${tabs.map(tb=>`<button class="tab-btn ${S.tab===tb.k?'active':''}" data-tab="${tb.k}">${tb.l}</button>`).join('')}</div>
    <div id="tab-body" style="padding-top:16px">${renderTab(t,S.tab,role)}</div>`;
}

function detailTabs(t, role) {
  const cat = t.data?.category;
  if (cat === 'order') {
    const tabs = [{k:'order_details',l:'Order Details'}];
    if (STAGES.indexOf(t.stage) >= STAGES.indexOf('ph5_active')) tabs.push({k:'billing',l:'Phase 5: Billing'});
    return tabs;
  }
  if (cat === 'procurement') return [{k:'procurement_details',l:'Procurement Details'}];
  
  const ALL = STAGES;
  const si = ALL.indexOf(t.stage);
  const tabs = [];
  
  if (cat === 'project') {
    if (role === 'tender' || role === 'admin' || role === 'mgmt' || role === 'lead') {
        tabs.push({k:'project_details',l:'Phase 1: Project Details'});
    }
    if (si >= ALL.indexOf('ph2_active')) tabs.push({k:'project_technical',l:'Phase 2: Technical'});
    if (role !== 'tech' && si >= ALL.indexOf('ph3_active')) tabs.push({k:'project_installation',l:'Phase 3: Installation'});
    if (si >= ALL.indexOf('ph5_active')) tabs.push({k:'billing',l:'Phase 5: Billing'});
    return tabs;
  }

  if (role === 'tender' || role === 'admin' || role === 'mgmt') {
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
  
  if (t.data?.category === 'order') return btns.join('');

  if (role === 'tender' || role === 'admin') {
     if (t.stage === 'ph1_draft') btns.push(`<button class="btn btn-primary btn-sm" id="btnSubmitPh1Tender">Submit to Technical (Ph2)</button>`);
     if (t.stage === 'ph3_active' && t.data?.category !== 'project') btns.push(`<button class="btn btn-primary btn-sm" data-modal="ph3-award">Declare Award / Disqualify / Qualified</button>`);
  }
  if (role === 'tech' || role === 'admin') {
     if (t.stage === 'ph2_active') btns.push(`<button class="btn btn-primary btn-sm" data-modal="ph2-report">Submit Technical Report</button>`);
     if (t.stage === 'ph4_active') btns.push(`<button class="btn btn-primary btn-sm" data-modal="ph4-deliver">Mark Delivered (Ph4)</button>`);
  }
  
  if (t.data?.category === 'project' && t.stage === 'ph3_active' && ['admin', 'tech', 'tender', 'lead'].includes(role)) {
      btns.push(`<button class="btn btn-primary btn-sm" id="btnSubmitProjectPh3">Submit to Billing (Ph5)</button>`);
  }
  return btns.join('');
}

function renderTab(t, tab, role) {
    if (tab === 'order_details') return TabOrderDetails(t, role, false);
    if (tab === 'procurement_details') return TabProcurement(t, role);
    if (tab.startsWith('project_')) return TabProject(t, tab, role);

    switch(tab) {
      case 'tender_info': return TabTenderInfo(t, role);
      case 'technical': return TabTechnical(t, role);
      case 'award': return TabAward(t, role);
      case 'delivery': return TabDelivery(t, role);
      case 'billing': return TabBilling(t, role);
      default: return TabTenderInfo(t, role);
    }
}

function TabOrderDetails(t, role, isLead) {
  const edit = ['admin', 'mgmt', 'tender', 'lead'].includes(role);
  const d = t.data || {};
  const items = d.items || [];
  const customCols = d.custom_columns || [];
  
  const baseCols = ['Product Name', 'Qty', 'Price (₹)', 'GST %', 'Amount (₹)', 'Period', 'Link', 'Description', 'Source of Purchase'];
  const allCols = [...baseCols, ...customCols];
  
  let totalAmt = 0;
  
  const trs = items.map((item, idx) => {
     let amount = 0;
     const qty = parseFloat(item['Qty']) || 0;
     const price = parseFloat(item['Price (₹)']) || 0;
     const gst = parseFloat(item['GST %']) || 0;
     amount = qty * price * (1 + (gst/100));
     totalAmt += amount;
     
     const tds = allCols.map(c => {
       if (c === 'Amount (₹)') {
         return `<td><div class="kbd-val" style="padding:4px 8px;font-size:12px;background:#f9fafb;border-radius:4px;">₹${amount.toFixed(2)}</div></td>`;
       }
       if (!edit) return `<td><div class="kbd-val" style="font-size:12px;padding:4px 8px;">${esc(item[c]||'-')}</div></td>`;
       return `<td><input type="text" class="form-input tbl-input" style="font-size:12px;padding:4px;" data-row="${idx}" data-col="${esc(c)}" value="${esc(item[c]||'')}"></td>`;
     }).join('');
     
     return `<tr>${tds}<td style="width:40px">${edit ? `<button class="btn btn-ghost btn-sm text-red del-row-btn" data-row="${idx}">×</button>` : ''}</td></tr>`;
  }).join('');
  
  let docsHtml = '';
  const docs = t.documents || [];
  if (docs.length) {
    docsHtml = '<div style="margin-top:12px;display:flex;flex-direction:column;gap:8px;">' + docs.map(d => `
      <div class="file-item">
        <div class="file-icon">${fileIcon(d.mime)}</div>
        <div class="file-details">
          <div class="file-name"><a href="${d.url}" target="_blank">${esc(d.name)}</a></div>
          <div class="file-meta">${fmt(d.size,'size')} • ${fmt(d.created_at,'date')}</div>
        </div>
        ${edit ? `<button class="btn btn-ghost text-red del-doc-btn" data-id="${d.id}">Delete</button>` : ''}
      </div>
    `).join('') + '</div>';
  } else {
    docsHtml = '<div class="empty" style="padding:16px"><div class="empty-icon">📁</div><div class="empty-title">No documents uploaded</div></div>';
  }

  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3>Order Details</h3>
      ${edit ? `<button class="btn btn-primary btn-sm" id="btnSaveOrderHeader">Save Header</button>` : ''}
    </div>
    <div class="form-grid">
      ${inputGroup('ord_num','Order Number',d.order_number || t.requirements?.order_number,'text',edit)}
      ${inputGroup('ord_cust','Customer Name',d.customer_name || t.org_name,'text',edit)}
      ${inputGroup('ord_addr','Delivery Address',d.delivery_address,'textarea',edit)}
    </div>
  </div>
  
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
      <h3>Items</h3>
      <div style="display:flex;gap:8px;">
        ${edit ? `
        <button class="btn btn-outline btn-sm" id="btnAddOrderCol">+ Add Column</button>
        <button class="btn btn-outline btn-sm" id="btnAddOrderRow">+ Add Row</button>
        <button class="btn btn-primary btn-sm" id="btnSaveOrderItems">Save Items</button>
        ` : ''}
        <button class="btn btn-primary btn-sm" id="btnExportOrderExcel" style="background:#10b981;border-color:#10b981">Export to Excel</button>
      </div>
    </div>
    <div class="table-wrap" style="overflow-x:auto;">
      <table style="min-width:800px;font-size:12px">
        <thead>
          <tr>
            ${allCols.map(c => `<th style="white-space:nowrap">${esc(c)}</th>`).join('')}
            <th></th>
          </tr>
        </thead>
        <tbody>${trs}</tbody>
        ${items.length ? `<tfoot><tr>
           <td colspan="${allCols.indexOf('Amount (₹)')}" style="text-align:right;font-weight:700">Total:</td>
           <td style="font-weight:700">₹${totalAmt.toFixed(2)}</td>
           <td colspan="${allCols.length - allCols.indexOf('Amount (₹)')}"></td>
           <td></td>
        </tr></tfoot>` : ''}
      </table>
      ${!items.length ? '<div class="empty" style="padding:20px"><div class="empty-title">No items added</div></div>' : ''}
    </div>
  </div>
  
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3>Documents</h3>
      <div style="display:flex;gap:8px;">
         <input type="file" id="orderDocsInput" multiple style="display:none">
         ${edit ? `<button class="btn btn-outline btn-sm" onclick="document.getElementById('orderDocsInput').click()">+ Upload Files</button>` : ''}
      </div>
    </div>
    ${docsHtml}
  </div>
  
  ${(role === 'admin' && t.stage !== 'ph5_active' && t.stage !== 'closed') ? `<div class="card" style="border: 1px solid var(--border); background: #f8fafc;">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div>
        <h3 style="margin-bottom:4px">Finalise Order</h3>
        <div style="color:var(--text2);font-size:13px;">Skip to Phase 5 (Billing & Accounts)</div>
      </div>
      <button class="btn btn-primary" id="btnFinaliseOrder" style="background:#3b82f6;color:white;font-size:14px;padding:8px 16px;border:none;border-radius:6px;cursor:pointer;">Finalise Order →</button>
    </div>
  </div>` : ''}
  `;
}

function TabProcurement(t, role) { 
  const edit = (role === 'admin' || role === 'mgmt');
  const d = t.data || {};
  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3>Procurement Form</h3>
      ${edit ? `<button class="btn btn-primary btn-sm" id="btnSaveProcurement">Save Procurement</button>` : ''}
    </div>
    <div class="form-grid">
      ${inputGroup('pr_req','Purchase Request #',d.pr_req,'text',edit)}
      ${inputGroup('pr_rfq','RFQ ID',d.pr_rfq,'text',edit)}
      ${inputGroup('pr_vq','Vendor Quotation',d.pr_vq,'text',edit)}
      ${inputGroup('pr_po','Purchase Order',d.pr_po,'text',edit)}
      ${inputGroup('pr_grn','GRN / Material Tracking',d.pr_grn,'text',edit)}
      ${inputGroup('pr_bill','Vendor Bill',d.pr_bill,'text',edit)}
    </div>
  </div>`; 
}

function TabProject(t, tab, role) { 
  let edit = ['admin', 'mgmt', 'tech', 'tender', 'lead'].includes(role);
  if (role === 'tech' && (tab === 'project_details' || tab === 'project_technical')) edit = false;
  if (STAGES.indexOf(t.stage) >= STAGES.indexOf('ph2_active') && (tab === 'project_details' || tab === 'project_technical')) edit = false;
  if (tab === 'project_details') {
  const d = t.data || {};
  const items = d.items || [];
  const customCols = d.custom_columns || [];
  
  const baseCols = ['Product Name', 'Qty', 'Price (₹)', 'GST %', 'Amount (₹)', 'Period', 'Link', 'Description', 'Source of Purchase'];
  const allCols = [...baseCols, ...customCols];
  
  let totalAmt = 0;
  
  const trs = items.map((item, idx) => {
     let amount = 0;
     const qty = parseFloat(item['Qty']) || 0;
     const price = parseFloat(item['Price (₹)']) || 0;
     const gst = parseFloat(item['GST %']) || 0;
     amount = qty * price * (1 + (gst/100));
     totalAmt += amount;
     
     const tds = allCols.map(c => {
       if (c === 'Amount (₹)') {
         return `<td><div class="kbd-val" style="padding:4px 8px;font-size:12px;background:#f9fafb;border-radius:4px;">₹${amount.toFixed(2)}</div></td>`;
       }
       if (!edit) return `<td><div class="kbd-val" style="font-size:12px;padding:4px 8px;">${esc(item[c]||'-')}</div></td>`;
       return `<td><input type="text" class="form-input tbl-input" style="font-size:12px;padding:4px;" data-row="${idx}" data-col="${esc(c)}" value="${esc(item[c]||'')}"></td>`;
     }).join('');
     
     return `<tr>${tds}<td style="width:40px">${edit ? `<button class="btn btn-ghost btn-sm text-red del-row-btn" data-row="${idx}">×</button>` : ''}</td></tr>`;
  }).join('');
  
  let docsHtml = '';
  const docs = t.documents || [];
  if (docs.length) {
    docsHtml = '<div style="margin-top:12px;display:flex;flex-direction:column;gap:8px;">' + docs.map(d => `
      <div class="file-item">
        <div class="file-icon">${fileIcon(d.mime)}</div>
        <div class="file-details">
          <div class="file-name"><a href="${d.url}" target="_blank">${esc(d.name)}</a></div>
          <div class="file-meta">${fmt(d.size,'size')} • ${fmt(d.created_at,'date')}</div>
        </div>
        ${edit ? `<button class="btn btn-ghost text-red del-doc-btn" data-id="${d.id}">Delete</button>` : ''}
      </div>
    `).join('') + '</div>';
  } else {
    docsHtml = '<div class="empty" style="padding:16px"><div class="empty-icon">📁</div><div class="empty-title">No documents uploaded</div></div>';
  }

    const isLead = window.S?.page === 'leads' || !!window.S?.leadId;

    return `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3>Project Plan & Overview</h3>
        ${edit ? `<button class="btn btn-primary btn-sm" id="btnSaveOrderHeader">Save Header</button>` : ''}
      </div>
      <div class="form-grid">
        ${!isLead ? inputGroup('ord_num','Project Number',d.project_number || d.order_number || t.requirements?.order_number,'text',edit) : ''}
        ${inputGroup('ord_cust','Customer Name',d.customer_name || t.org_name,'text',edit)}
        ${inputGroup('ord_addr','Delivery Address',d.delivery_address,'textarea',edit)}
      </div>
    </div>
    
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
      <h3>Items</h3>
      <div style="display:flex;gap:8px;">
        ${edit ? `
        <button class="btn btn-outline btn-sm" id="btnAddOrderCol">+ Add Column</button>
        <button class="btn btn-outline btn-sm" id="btnAddOrderRow">+ Add Row</button>
        <button class="btn btn-primary btn-sm" id="btnSaveOrderItems">Save Items</button>
        ` : ''}
        <button class="btn btn-primary btn-sm" id="btnExportOrderExcel" style="background:#10b981;border-color:#10b981">Export to Excel</button>
      </div>
    </div>
    <div class="table-wrap" style="overflow-x:auto;">
      <table style="min-width:800px;font-size:12px">
        <thead>
          <tr>
            ${allCols.map(c => `<th style="white-space:nowrap">${esc(c)}</th>`).join('')}
            <th></th>
          </tr>
        </thead>
        <tbody>${trs}</tbody>
        ${items.length ? `<tfoot><tr>
           <td colspan="${allCols.indexOf('Amount (₹)')}" style="text-align:right;font-weight:700">Total:</td>
           <td style="font-weight:700">₹${totalAmt.toFixed(2)}</td>
           <td colspan="${allCols.length - allCols.indexOf('Amount (₹)')}"></td>
           <td></td>
        </tr></tfoot>` : ''}
      </table>
      ${!items.length ? '<div class="empty" style="padding:20px"><div class="empty-title">No items added</div></div>' : ''}
    </div>
  </div>
  
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3>Documents</h3>
      <div style="display:flex;gap:8px;">
         <input type="file" id="orderDocsInput" multiple style="display:none">
         ${edit ? `<button class="btn btn-outline btn-sm" onclick="document.getElementById('orderDocsInput').click()">+ Upload Files</button>` : ''}
      </div>
    </div>
    ${docsHtml}
  </div>
    `;
  }
  if (tab === 'project_technical') {
    return TabTechnical(t, role);
  }
  if (tab === 'project_installation') {
    return `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3>Installation & Closure</h3>
        ${edit ? `<button class="btn btn-primary btn-sm" id="btnSaveProjectInst">Save Installation</button>` : ''}
      </div>
      <div class="form-grid">
        ${inputGroup('prj_inst','Installation Status',t.data?.prj_inst,'select',edit,['Pending','In Progress','Completed'])}
        ${inputGroup('prj_uat','Testing and UAT',t.data?.prj_uat,'select',edit,['Pending','Passed','Failed'])}
        ${inputGroup('prj_live','Live Monitoring',t.data?.prj_live,'text',edit)}
        ${inputGroup('prj_dism','Dismantling',t.data?.prj_dism,'select',edit,['N/A','Pending','Done'])}
        ${inputGroup('prj_close','Handover & Closure',t.data?.prj_close,'select',edit,['Pending','Closed'])}
      </div>
    </div>`; 
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
          ${inputGroup('bandwidth_mbps','Bandwidth (Mbps)',t.bandwidth_mbps,'text',edit)}
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
        ${edit ? `<label class="upload-zone" id="docTenderDrop" style="margin-bottom:18px"><div class="uz-icon">â˜ </div><div class="uz-title">Upload Documents</div><input type="file" id="docTenderFile" style="display:none"></label>` : ''}
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
         <thead><tr><th>Cycle</th><th>Invoice</th><th>Period</th><th>Due</th><th>Status</th><th>Received</th><th>Pay Date</th>${edit?'<th>Act</th>':''}</tr></thead>
         <tbody>${cycs.map(c=>`
            <tr>
               <td>#${c.cycle_number}</td>
               <td>${c.invoice_number||'-'}${c.invoice_doc_url ? ` <a href="${c.invoice_doc_url}" target="_blank" title="View Invoice">📄</a>` : ''}</td>
               <td>${fmt(c.period_from,'date')} - ${fmt(c.period_to,'date')}</td>
               <td>${fmt(c.amount_due,'currency')}</td>
               <td><span class="badge ${c.payment_status==='Paid'?'b-green':c.payment_status==='Partial'?'b-amber':'b-gray'}">${c.payment_status}</span></td>
               <td>${fmt(c.amount_received,'currency')}</td>
               <td>${fmt(c.payment_date,'date')}</td>
               ${edit?`<td><button class="btn btn-ghost btn-sm" onclick="editCycle('${c.id}')">Edit</button></td>`:''}
            </tr>
         `).join('')}
         ${!cycs.length?`<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text3)">No payment cycles yet</td></tr>`:''}
         </tbody>
      </table></div>
    `;

    return `<div class="card"><div class="sec-title">Phase 5: Invoice Header</div>${headHtml}${cycHtml}</div>`;
}

// ---- Modals ----

// ---- LEADS MODULE (Duplicated) ----
function PageLeads() {
  const role = S.user?.role;
  let list = S.leads || [];
  if (role === 'tech') list = list.filter(l => l.stage !== 'ph1_draft');
  const isAcipl = (S.workspaces.find(w => w.id === S.workspaceId)?.name || '').toLowerCase() === 'acipl';
  return `
    <div class="page-header">
      <div><div class="page-title">Leads</div><div class="page-sub">${list.length} leads</div></div>
      <div class="page-actions" style="display:flex; gap:8px;">
        ${role === 'admin' ? `<button class="btn btn-outline" id="btnExportLeads">Export CSV</button>` : ''}
        ${['lead','admin'].includes(role)?`<button class="btn btn-primary" id="btnNewLeadPage">+ New Lead</button>`:''}
        ${isAcipl && ['admin','mgmt','tender','lead'].includes(role)?`<button class="btn btn-primary" id="btnDashNewOrder">+ New Order</button>`:''}
        ${isAcipl && ['admin','mgmt','tender','lead'].includes(role)?`<button class="btn btn-primary" id="btnDashNewProject">+ New Project</button>`:''}
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
            <td style="font-weight:700">${fmt(getVal(t),'currency')}</td>
            <td>${fmt(t.bid_end_datetime,'date')}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`:
      `<div class="empty"><div class="empty-icon">ðŸ” </div><div class="empty-title">No leads</div></div>`}`;
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
    ${Pipeline(t.stage, t.data?.category)}
    <div class="tabs">${tabs.map(tb=>`<button class="tab-btn ${S.tab===tb.k?'active':''}" data-tab="${tb.k}">${tb.l}</button>`).join('')}</div>
    <div id="tab-body" style="padding-top:16px">${renderLeadTab(t,S.tab,role)}</div>`;
}

function leadTabs(t, role) {
  const cat = t.data?.category;
  if (cat === 'support') return [{k:'support_ticket',l:'Ticket Details'}, {k:'support_rca',l:'RCA & Notes'}];
  if (cat === 'inventory') return [{k:'inventory_stock',l:'Stock Details'}, {k:'inventory_movement',l:'Inward/Outward'}];
  if (cat === 'order') {
    const tabs = [{k:'order_details',l:'Order Details'}];
    if (STAGES.indexOf(t.stage) >= STAGES.indexOf('ph5_active')) tabs.push({k:'billing',l:'Phase 5: Billing'});
    return tabs;
  }
  
  if (cat === 'project') {
    const tabs = [{k:'project_details',l:'Phase 1: Project Details'}];
    if (STAGES.indexOf(t.stage) >= STAGES.indexOf('ph2_active')) tabs.push({k:'project_technical',l:'Phase 2: Technical'});
    if (STAGES.indexOf(t.stage) >= STAGES.indexOf('ph3_active')) tabs.push({k:'project_installation',l:'Phase 3: Installation'});
    if (STAGES.indexOf(t.stage) >= STAGES.indexOf('ph5_active')) tabs.push({k:'billing',l:'Phase 5: Billing'});
    return tabs;
  }

  const ALL = STAGES;
  const si = ALL.indexOf(t.stage);
  const tabs = [];
  if (role === 'lead' || role === 'admin' || role === 'mgmt') {
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
  
  if (t.data?.category === 'order') return btns.join('');

  if (role === 'lead' || role === 'admin') {
     if (t.stage === 'ph1_draft') btns.push(`<button class="btn btn-primary btn-sm" id="btnSubmitPh1Lead">Submit to Technical (Ph2)</button>`);
     if (t.stage === 'ph3_active' && t.data?.category !== 'project') btns.push(`<button class="btn btn-primary btn-sm" data-modal="ph3-award">Declare Award / Disqualify / Qualified</button>`);
  }
  if (role === 'tech' || role === 'admin') {
     if (t.stage === 'ph2_active') btns.push(`<button class="btn btn-primary btn-sm" data-modal="ph2-report">Submit Technical Report</button>`);
     if (t.stage === 'ph4_active') btns.push(`<button class="btn btn-primary btn-sm" data-modal="ph4-deliver">Mark Delivered (Ph4)</button>`);
  }
  
  if (t.data?.category === 'project' && t.stage === 'ph3_active' && ['admin', 'tech', 'tender', 'lead'].includes(role)) {
      btns.push(`<button class="btn btn-primary btn-sm" id="btnSubmitProjectPh3">Submit to Billing (Ph5)</button>`);
  }
  return btns.join('');
}

function renderLeadTab(t, tab, role) {
    if (tab === 'order_details') return TabOrderDetails(t, role, true);
    if (tab.startsWith('project_')) return TabProject(t, tab, role);
    if (tab.startsWith('support_')) return TabSupport(t, tab, role);
    if (tab.startsWith('inventory_')) return TabInventory(t, tab, role);

    switch(tab) {
      case 'lead_info': return TabLeadInfo(t, role);
      case 'technical': return TabLeadTechnical(t, role);
      case 'award': return TabLeadAward(t, role);
      case 'delivery': return TabLeadDelivery(t, role);
      case 'billing': return TabLeadBilling(t, role);
      default: return TabLeadInfo(t, role);
    }
}

function TabSupport(t, tab, role) { 
  const edit = true; // All roles can interact with support for now
  if (tab === 'support_ticket') {
    return `<div class="card">
      <h3 style="margin-bottom:16px">Ticket Details</h3>
      <div class="form-grid">
        ${inputGroup('sup_status','Ticket Status',t.sup_status,'select',edit,['New','Assigned','In Progress','Customer Pending','Vendor Pending','Escalated','Resolved','Closed'])}
        ${inputGroup('sup_desc','Issue Description',t.sup_desc,'textarea',edit)}
        ${inputGroup('sup_sla','SLA Status',t.sup_sla,'select',edit,['Within SLA','SLA Breached'])}
      </div>
      ${edit ? `<button class="btn btn-primary" id="btnSaveSupport" style="margin-top:16px">Save Support Form</button>` : ''}
    </div>`;
  }
  return `<div class="card">
    <h3 style="margin-bottom:16px">RCA & Knowledge</h3>
    <div class="form-grid">
      ${inputGroup('sup_rca','Root Cause Analysis (RCA)',t.sup_rca,'textarea',edit)}
      ${inputGroup('sup_kb','Knowledge Base Reference',t.sup_kb,'text',edit)}
    </div>
    ${edit ? `<button class="btn btn-primary" id="btnSaveSupport" style="margin-top:16px">Save Support Form</button>` : ''}
  </div>`;
}

function TabInventory(t, tab, role) { 
  const edit = (role === 'admin' || role === 'mgmt');
  if (tab === 'inventory_stock') {
    return `<div class="card">
      <h3 style="margin-bottom:16px">Stock & Inventory</h3>
      <div class="form-grid">
        ${inputGroup('inv_stock','Stock Level',t.inv_stock,'number',edit)}
        ${inputGroup('inv_res','Reservations',t.inv_res,'text',edit)}
        ${inputGroup('inv_serial','Serialized Assets',t.inv_serial,'textarea',edit)}
        ${inputGroup('inv_cust','Customer / Rental Assets',t.inv_cust,'text',edit)}
      </div>
      ${edit ? `<button class="btn btn-primary" id="btnSaveInventory" style="margin-top:16px">Save Inventory</button>` : ''}
    </div>`;
  }
  return `<div class="card">
    <h3 style="margin-bottom:16px">Movement & Audit</h3>
    <div class="form-grid">
      ${inputGroup('inv_in','Inward',t.inv_in,'text',edit)}
      ${inputGroup('inv_out','Outward',t.inv_out,'text',edit)}
      ${inputGroup('inv_rma','Returns / RMA',t.inv_rma,'text',edit)}
      ${inputGroup('inv_audit','Stock Audit Status',t.inv_audit,'text',edit)}
    </div>
    ${edit ? `<button class="btn btn-primary" id="btnSaveInventory" style="margin-top:16px">Save Inventory</button>` : ''}
  </div>`;
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
          ${inputGroup('bandwidth_mbps','Bandwidth (Mbps)',t.bandwidth_mbps,'text',edit)}
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
        ${edit ? `<label class="upload-zone" id="docLeadDrop" style="margin-bottom:18px"><div class="uz-icon">â˜</div><div class="uz-title">Upload Documents</div><input type="file" id="docLeadFile" style="display:none"></label>` : ''}
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
         <thead><tr><th>Cycle</th><th>Invoice</th><th>Period</th><th>Due</th><th>Status</th><th>Received</th><th>Pay Date</th>${edit?'<th>Act</th>':''}</tr></thead>
         <tbody>${cycs.map(c=>`
            <tr>
               <td>#${c.cycle_number}</td>
               <td>${c.invoice_number||'-'}${c.invoice_doc_url ? ` <a href="${c.invoice_doc_url}" target="_blank" title="View Invoice">📄</a>` : ''}</td>
               <td>${fmt(c.period_from,'date')} - ${fmt(c.period_to,'date')}</td>
               <td>${fmt(c.amount_due,'currency')}</td>
               <td><span class="badge ${c.payment_status==='Paid'?'b-green':c.payment_status==='Partial'?'b-amber':'b-gray'}">${c.payment_status}</span></td>
               <td>${fmt(c.amount_received,'currency')}</td>
               <td>${fmt(c.payment_date,'date')}</td>
               ${edit?`<td><button class="btn btn-ghost btn-sm" onclick="editCycle('${c.id}')">Edit</button></td>`:''}
            </tr>
         `).join('')}
         ${!cycs.length?`<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text3)">No payment cycles yet</td></tr>`:''}
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
      <button class="modal-close" id="mclose">✖</button></div>
    <div class="modal-body">${body}</div>
    <div class="modal-footer">${footer}</div>
  </div></div>`;
}

function attachModalHandlers() {
  $('mclose')?.addEventListener('click', removeModal);
  

  // Create new tender modal logic
  $('saveNewTenderBtn')?.addEventListener('click', async () => {
    const bid = $('ntBid')?.value;
    const cat = $('ntCat')?.value || '';
    const ntIsLeadEl = $('ntIsLead');
    const isLead = ntIsLeadEl ? (ntIsLeadEl.type === 'checkbox' ? ntIsLeadEl.checked : ntIsLeadEl.value === 'true') : false;
    if (!bid) return toast('Reference Number is required','error');
    try {
      if (isLead) {
        await api('POST','/leads',{ title: bid, org_name: $('ntOrg')?.value, data: { category: cat, description: $('ntTitle')?.value, delivery_address: $('ntAddress')?.value, customer_name: $('ntOrg')?.value }, stage: 'ph1_draft' });
        try { S.leads = await api('GET', '/leads') || []; } catch {}
      } else {
        await api('POST','/tenders',{ bid_number: bid, title: $('ntTitle')?.value, org_name: $('ntOrg')?.value, data: { category: cat, delivery_address: $('ntAddress')?.value, customer_name: $('ntOrg')?.value, order_number: bid }, stage: 'ph1_draft' });
      }
      if (isLead) await loadLeads(); else await loadTenders();
      removeModal(); render(); toast('Record created!','success');
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
        qualification_remarks: $('m3_qr')?.value || null,
        extended_date: $('m3_ed')?.value || null
     };
     const id = S.leadId || S.tenderId;
     const base = S.leadId ? 'leads' : 'tenders';
     try { await api('POST', `/${base}/${id}/phase3`, b); if(S.leadId) await loadLead(id); else await loadTender(id); removeModal(); render(); toast('Award recorded!','success'); } catch(e){toast(e.message,'error');}
  });

  $('m3_res')?.addEventListener('change', e=>{
      const v = e.target.value;
      if(v==='Awarded') { $('m3_awarded_fields').style.display='block'; $('m3_disq_fields').style.display='none'; $('m3_qual_fields').style.display='none'; if($('m3_ext_fields')) $('m3_ext_fields').style.display='none'; }
      else if(v==='Disqualified') { $('m3_awarded_fields').style.display='none'; $('m3_disq_fields').style.display='block'; $('m3_qual_fields').style.display='none'; if($('m3_ext_fields')) $('m3_ext_fields').style.display='none'; }
      else if(v==='Qualified') { $('m3_awarded_fields').style.display='none'; $('m3_disq_fields').style.display='none'; $('m3_qual_fields').style.display='block'; if($('m3_ext_fields')) $('m3_ext_fields').style.display='none'; }
      else if(v==='Extended') { $('m3_awarded_fields').style.display='none'; $('m3_disq_fields').style.display='none'; $('m3_qual_fields').style.display='none'; if($('m3_ext_fields')) $('m3_ext_fields').style.display='block'; }
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
        if (!val || !ipv4Regex.test(val)) return toast('Invalid IPv4 Pool '+i, 'error');
        v4Addrs.push(val);
     }
     for(let i=1; i<=numV6; i++) {
        let val = $('m4_ipv6_'+i)?.value;
        if (!val || !ipv6Regex.test(val)) return toast('Invalid IPv6 Pool '+i, 'error');
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
     fd.append(S.leadId ? 'notif_to_lead_date' : 'notif_to_tender_date',$('m5_nt').value); fd.append('award_date',$('m5_ad').value);
     fd.append('total_price',$('m5_tot').value); fd.append('billing_price',$('m5_bp').value); fd.append('base_price',$('m5_base').value);
     fd.append('gst_pct',$('m5_gst').value); fd.append('duration_from',$('m5_df').value); fd.append('duration_to',$('m5_dt').value);
     fd.append('payment_cycle',$('m5_pc').value);
     const id = S.leadId || S.tenderId;
     const base = S.leadId ? 'leads' : 'tenders';
     try { await up(`/${base}/${id}/phase5`,fd); if(S.leadId) await loadLead(id); else await loadTender(id); removeModal(); render(); toast('Invoice Header Created!','success'); } catch(e){toast(e.message,'error');}
  });

  $('ph5CycBtn')?.addEventListener('click', async()=>{
     const cid = $('mc_id')?.value;
     const source = S.leadId ? S.leadItem : S.tender;
     const cycs = source?.payment_cycles || [];
     
     const fd = new FormData();
     if(!cid) fd.append('cycle_number', cycs.length + 1);
     fd.append('period_from', $('mc_pf').value); fd.append('period_to', $('mc_pt').value); fd.append('amount_due', $('mc_ad').value);
     fd.append('payment_status', $('mc_ps').value); fd.append('amount_received', $('mc_ar').value); fd.append('payment_date', $('mc_pd').value);
     if($('mc_in')?.value) fd.append('invoice_number', $('mc_in').value);
     if($('mc_doc')?.files[0]) fd.append('invoice_doc', $('mc_doc').files[0]);
     
     const id = S.leadId || S.tenderId;
     const base = S.leadId ? 'leads' : 'tenders';
     try {
         if(cid) await up(`/${base}/${id}/payment-cycles/${cid}`, fd);
         else await up(`/${base}/${id}/payment-cycles`, fd);
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
       if($('mc_in')) $('mc_in').value=c.invoice_number||'';
    },50);
}

function openModal(id) {
  if (id === 'create-tender' || id === 'btnNewTender' || id === 'btnNewTenderPage' || id.startsWith('create-')) {
    let title = 'New Tender';
    let cat = '';
    if (id === 'create-order') { title = 'New Order'; cat = 'order'; }
    if (id === 'create-procurement') { title = 'New Procurement Request'; cat = 'procurement'; }
    if (id === 'create-project') { title = 'New Project/Event'; cat = 'project'; }
    if (id === 'create-support') { title = 'New Support Ticket'; cat = 'support'; }
    if (id === 'create-inventory') { title = 'New Inventory Record'; cat = 'inventory'; }
    
    // Support and Inventory will be stored in Leads, others in Tenders.
    const isLeadCat = ['support', 'inventory'].includes(cat);
    
    showModal(MW(title, `
      <input type="hidden" id="ntCat" value="${cat}">
      ${['order','project'].includes(cat) ? '<div class="form-group"><label class="custom-toggle" style="margin: 0 auto; width: fit-content; margin-bottom: 16px;"><input type="checkbox" id="ntIsLead" value="true"><div class="toggle-track"></div><div class="toggle-label">Store as Lead (Direct/Internal)</div></label></div>' : '<input type="hidden" id="ntIsLead" value="'+(isLeadCat ? 'true' : 'false')+'">'}
      <div class="form-group"><label class="form-label">${isLeadCat || ['order','project'].includes(cat) ? 'Reference / Order Number' : 'Reference / Bid Number'} *</label><input type="text" id="ntBid" class="form-input"></div>
      <div class="form-group"><label class="form-label">Description / Name</label><input type="text" id="ntTitle" class="form-input"></div>
      <div class="form-group"><label class="form-label">Customer / Organisation Name</label><input type="text" id="ntOrg" class="form-input"></div>
      ${['order','project'].includes(cat) ? '<div class="form-group"><label class="form-label">Delivery Address</label><textarea id="ntAddress" class="form-input" rows="2"></textarea></div>' : ''}
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
         ${inputGroup('m3_res','Result',r.qualification_result || 'Awarded','select',true,['Awarded','Disqualified','Qualified','Extended'])}
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
      <div id="m3_ext_fields" style="margin-top:12px; display: ${(r.qualification_result || 'Awarded') === 'Extended' ? 'block' : 'none'}">
         ${inputGroup('m3_ed','Extended Date',r.extended_date || '','date',true)}
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
         ${inputGroup('m5_nt', S.leadId ? 'Notif to Lead Date' : 'Notif to Tender Date','','date',true)}
         ${inputGroup('m5_ad','Award Date','','date',true)}
         ${inputGroup('m5_tot','Total Contract Price','','number',true)}
         ${inputGroup('m5_bp','Billing Price','','number',true)}
         ${inputGroup('m5_base','Base Price','','number',true)}
         ${inputGroup('m5_gst','GST %','','number',true)}
         ${inputGroup('m5_df','Duration From','','date',true)}
         ${inputGroup('m5_dt','Duration To','','date',true)}
         ${inputGroup('m5_pc','Payment Cycle','Monthly','select',true,['Monthly','Quarterly','Half-yearly','Annual','One-time'])}
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
         ${inputGroup('mc_in','Invoice Number','','text',true)}
         <div class="form-group"><label class="form-label">Invoice Doc</label><input type="file" id="mc_doc" class="form-input"></div>
      </div>
    `, `<button class="btn btn-ghost" onclick="removeModal()">Cancel</button><button class="btn btn-primary" id="ph5CycBtn">Save Cycle</button>`));
  }
}

// ---- Event Listeners ----
async function openExportModal(type) {
  const isTender = type === 'tenders';
  
  const curBtn = isTender ? $('btnExportTendersAdmin') : $('btnExportLeadsAdmin');
  if (curBtn) curBtn.textContent = 'Loading...';
  
  let res;
  try {
    res = await api('GET', '/export/data');
  } catch (e) {
    if (curBtn) curBtn.textContent = isTender ? 'Export Tenders' : 'Export Leads';
    return toast('Failed to fetch data: ' + e.message, 'error');
  }
  
  if (curBtn) curBtn.textContent = isTender ? 'Export Tenders' : 'Export Leads';
  
  const data = isTender ? res.tenders : res.leads;
  if (!data || !data.length) return toast('No data to export', 'error');

  const baseKeys = [
    { id: 'bid_number', label: 'Bid/Ref Number' },
    { id: 'title', label: 'Title' },
    { id: 'org_name', label: 'Organisation Name' },
    { id: 'stage', label: 'Current Stage' },
    { id: 'service_type', label: 'Service Type' },
    { id: 'bandwidth_mbps', label: 'Bandwidth (Mbps)' },
    { id: 'contract_period', label: 'Contract Period' },
    { id: 'link_delivery_address', label: 'Delivery Address' },
    { id: 'created_at', label: 'Created At' },
    { id: 'updated_at', label: 'Updated At' }
  ];

  const allKeys = new Set();
  const groupMap = {};
  const labelMap = {};

  baseKeys.forEach(k => {
    allKeys.add(k.id);
    groupMap[k.id] = 'Basic Info';
    labelMap[k.id] = k.label;
  });

  const prettyName = (k) => k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  data.forEach(item => {
    ['technical_reports', 'phase3_records', 'phase4_records', 'invoices', 'payment_cycles', 'circuits'].forEach(rel => {
        if (item[rel] && item[rel].length) {
           item[rel].forEach(relItem => {
              Object.keys(relItem).forEach(k => {
                 if (['id', 'tender_id', 'lead_id', 'created_by', 'submitted_by', 'created_at', 'updated_at'].includes(k)) return;
                 if (k.endsWith('_url')) return;
                 
                 if (k === 'survey_notes' && typeof relItem[k] === 'string') {
                     try {
                        const parsed = JSON.parse(relItem[k]);
                        Object.keys(parsed).forEach(pk => {
                           if (parsed[pk] !== null && parsed[pk] !== '') {
                             const fK = `Ph2_Survey_${pk}`;
                             allKeys.add(fK);
                             groupMap[fK] = 'Phase 2: Survey Data';
                             labelMap[fK] = prettyName(pk);
                           }
                        });
                     } catch(e){}
                 } else {
                     const fK = `${rel}_${k}`;
                     allKeys.add(fK);
                     let gName = rel.replace('_records', '').replace('_', ' ').toUpperCase();
                     if (gName === 'TECHNICAL REPORTS') gName = 'PHASE 2: REPORTS';
                     groupMap[fK] = gName;
                     labelMap[fK] = prettyName(k);
                 }
              });
           });
        }
    });
  });

  let colHtml = '';
  const groups = [...new Set(Array.from(allKeys).map(k => groupMap[k]))];
  groups.forEach(g => {
    colHtml += `<div style="margin-top:12px;font-weight:600;font-size:13px;color:var(--text1)">${g}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px;">`;
    Array.from(allKeys).filter(k => groupMap[k] === g).forEach(k => {
       const isBase = groupMap[k] === 'Basic Info';
       colHtml += `<label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text2)">
         <input type="checkbox" class="exp-col-chk" value="${k}" ${isBase ? 'checked' : ''}> ${labelMap[k]}
       </label>`;
    });
    colHtml += `</div>`;
  });

  showModal(MW(`Export ${isTender ? 'Tenders' : 'Leads'}`, `
    <div style="margin-bottom:12px;color:var(--text2);font-size:13px">Select specific fields. Nested records (like multiple invoices) will be comma-separated in their respective columns.</div>
    <div class="form-group">
       <label class="form-label">Export Format</label>
       <select id="exportFormat" class="form-input">
         <option value="csv">CSV (Selected Columns)</option>
         <option value="json">JSON (Full Raw Data)</option>
       </select>
    </div>
    <div id="colSelectWrap" style="max-height: 400px; overflow-y: auto; padding-right: 8px;">${colHtml}</div>
  `, `<button class="btn btn-ghost" onclick="removeModal()">Cancel</button><button class="btn btn-primary" id="btnConfirmExport">Download</button>`));
  
  $('exportFormat')?.addEventListener('change', (e) => {
     $('colSelectWrap').style.display = e.target.value === 'csv' ? 'block' : 'none';
  });

  $('btnConfirmExport')?.addEventListener('click', async () => {
     try {
       const fmt = $('exportFormat').value;
       if (fmt === 'json') {
         const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
         const url = URL.createObjectURL(blob);
         const link = document.createElement('a'); link.href=url; link.download=`${type}_full_export_${new Date().toISOString().split('T')[0]}.json`; link.click();
       } else {
         const selectedCols = Array.from(document.querySelectorAll('.exp-col-chk:checked')).map(cb => cb.value);
         if (!selectedCols.length) return toast('Select at least one column', 'error');
         
         const headers = selectedCols;
         
         const getVal = (item, key) => {
             if (groupMap[key] === 'Basic Info') {
                 let v = item[key];
                 if (v === undefined && item.requirements && item.requirements[key] !== undefined) v = item.requirements[key];
                 return v;
             }
             
             if (key.startsWith('Ph2_Survey_')) {
                 const pk = key.replace('Ph2_Survey_', '');
                 return (item.technical_reports || []).map(r => {
                     if (r.survey_notes) {
                         try {
                             const p = JSON.parse(r.survey_notes);
                             if (p[pk] !== undefined && p[pk] !== null && p[pk] !== '') return p[pk];
                         } catch(e){}
                     }
                     return null;
                 }).filter(Boolean).join(' | ');
             }
             
             for (const rel of ['technical_reports', 'phase3_records', 'phase4_records', 'invoices', 'payment_cycles', 'circuits']) {
                 if (key.startsWith(rel + '_')) {
                     const rK = key.replace(rel + '_', '');
                     return (item[rel] || []).map(r => {
                         let v = r[rK];
                         if (Array.isArray(v)) v = v.join(', ');
                         return v;
                     }).filter(v => v !== null && v !== undefined && v !== '').join(' | ');
                 }
             }
             return '';
         };

         const rows = data.map(item => headers.map(k => {
           let val = getVal(item, k);
           if (val === null || val === undefined) val = '';
           return `"${String(val).replace(/"/g, '""')}"`;
         }).join(','));
         const csvContent = "\uFEFF" + [headers.map(k => labelMap[k]).join(','), ...rows].join('\n');
         const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
         const url = URL.createObjectURL(blob);
         const link = document.createElement('a'); link.href=url; link.download=`${type}_custom_export_${new Date().toISOString().split('T')[0]}.csv`; link.click();
       }
       removeModal();
       toast('Export completed successfully', 'success');
     } catch (e) { toast('Export failed: ' + e.message, 'error'); }
  });
}

function attachAll() {
  $('logoutBtn')?.addEventListener('click', logout);
  $('nb-btn')?.addEventListener('click', ()=>{S.notifOpen=!S.notifOpen; render();});
  
  $('btnExportTenders')?.addEventListener('click', () => openExportModal('tenders'));
  $('btnExportLeads')?.addEventListener('click', () => openExportModal('leads'));
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
       S.page=el.dataset.nav; S.tenderId=null; S.leadId=null; S.leadItem=null; S.tender=null; S.tab=null;
       if (S.page === 'admin') {
           await loadUsers(); await loadAudit();
       }
       render(); 
    });
  });

  document.querySelectorAll('[data-tnav]').forEach(el => {
    el.addEventListener('click', async () => { 
       S.prevPage = S.page;
       S.tenderId = el.dataset.tnav; S.page = 'tenders'; 
       await loadTender(S.tenderId); 
       const tabs = detailTabs(S.tender, S.user.role);
       S.tab = (S.prevPage === 'billing' && tabs.find(t=>t.k==='billing')) ? 'billing' : (tabs.length > 0 ? tabs[0].k : 'tender_info');
       render(); 
    });
  });
  document.querySelectorAll('[data-lnav]').forEach(el => {
    el.addEventListener('click', async () => { 
       S.prevPage = S.page;
       S.leadId = el.dataset.lnav; S.page = 'leads'; 
       await loadLead(S.leadId); 
       if (S.leadItem) {
           const tabs = leadTabs(S.leadItem, S.user.role);
           S.tab = (S.prevPage === 'billing' && tabs.find(t=>t.k==='billing')) ? 'billing' : (tabs.length > 0 ? tabs[0].k : 'lead_info');
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

  $('btnDashNewOrder')?.addEventListener('click', () => openModal('create-order'));
  $('btnDashNewProcurement')?.addEventListener('click', () => openModal('create-procurement'));
  $('btnDashNewProject')?.addEventListener('click', () => openModal('create-project'));
  $('btnDashNewSupport')?.addEventListener('click', () => openModal('create-support'));
  $('btnDashNewInventory')?.addEventListener('click', () => openModal('create-inventory'));

  $('btnNewTender')?.addEventListener('click', () => openModal('btnNewTender'));
  $('btnNewTenderPage')?.addEventListener('click', () => openModal('btnNewTenderPage'));
  $('backTenderBtn')?.addEventListener('click', () => { S.tenderId=null; S.tender=null; S.page=S.prevPage||'dashboard'; render(); });

  // Phase 1: Save draft form (lives on main page, not in a modal)
  
  $('btnNewLead')?.addEventListener('click', () => openModal('btnNewLead'));
  $('btnNewLeadPage')?.addEventListener('click', () => openModal('btnNewLeadPage'));
  $('backLeadBtn')?.addEventListener('click', () => { S.leadId=null; S.leadItem=null; S.page=S.prevPage||'dashboard'; render(); });

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
      requirements: { ...(S.tender?.requirements || {}), order_number: $('order_number')?.value }
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

  $('btnSubmitProjectPh3')?.addEventListener('click', async () => {
    if (confirm('Submit project to Billing (skip Phase 4)?')) {
      try { 
        const isLead = S.page === 'leads' || !!S.leadId;
        const it = isLead ? S.leadItem : S.tender;
        const endpoint = isLead ? `/leads/${it.id}/move` : `/tenders/${it.id}/move`;
        await api('POST', endpoint, { stage: 'ph5_active' }); 
        await loadAll(); 
        if (isLead) await loadLead(it.id); else await loadTender(it.id);
        render(); 
        toast('Moved to Phase 5 - Billing', 'success'); 
      } catch (e) { toast(e.message, 'error'); }
    }
  });

  // --- Order Flow Event Handlers ---
  $('btnSaveSupport')?.addEventListener('click', async () => {
    const isLead = S.page === 'leads' || !!S.leadId;
    const it = isLead ? S.leadItem : S.tender;
    const b = {
      sup_status: $('sup_status')?.value,
      sup_desc: $('sup_desc')?.value,
      sup_sla: $('sup_sla')?.value,
      sup_rca: $('sup_rca')?.value,
      sup_kb: $('sup_kb')?.value
    };
    try {
      const endpoint = isLead ? `/leads/${it.id}` : `/tenders/${it.id}`;
      await api('PATCH', endpoint, b);
      isLead ? await loadLead(it.id) : await loadTender(it.id);
      render(); toast('Support Saved!','success');
    } catch(e) { toast(e.message,'error'); }
  });

  $('btnSaveInventory')?.addEventListener('click', async () => {
    const isLead = S.page === 'leads' || !!S.leadId;
    const it = isLead ? S.leadItem : S.tender;
    const b = {
      inv_stock: $('inv_stock')?.value ? parseInt($('inv_stock').value) : null,
      inv_res: $('inv_res')?.value,
      inv_serial: $('inv_serial')?.value,
      inv_cust: $('inv_cust')?.value,
      inv_in: $('inv_in')?.value,
      inv_out: $('inv_out')?.value,
      inv_rma: $('inv_rma')?.value,
      inv_audit: $('inv_audit')?.value
    };
    try {
      const endpoint = isLead ? `/leads/${it.id}` : `/tenders/${it.id}`;
      await api('PATCH', endpoint, b);
      isLead ? await loadLead(it.id) : await loadTender(it.id);
      render(); toast('Inventory Saved!','success');
    } catch(e) { toast(e.message,'error'); }
  });

  $('btnSaveProjectInst')?.addEventListener('click', async () => {
    const isLead = S.page === 'leads' || !!S.leadId;
    const it = isLead ? S.leadItem : S.tender;
    const d = it.data || {};
    const b = {
      ...d,
      prj_inst: $('prj_inst')?.value,
      prj_uat: $('prj_uat')?.value,
      prj_live: $('prj_live')?.value,
      prj_dism: $('prj_dism')?.value,
      prj_close: $('prj_close')?.value
    };
    try {
      if (isLead) {
        await api('PATCH', `/leads/${it.id}`, { data: b });
        await loadLead(it.id);
      } else {
        await api('PATCH', `/tenders/${it.id}`, { data: b });
        await loadTender(it.id);
      }
      render(); toast('Installation Saved!','success');
    } catch(e) { toast(e.message,'error'); }
  });

  $('btnSaveProcurement')?.addEventListener('click', async () => {
    const isLead = S.page === 'leads' || !!S.leadId;
    const it = isLead ? S.leadItem : S.tender;
    const d = it.data || {};
    const b = {
      ...d,
      pr_req: $('pr_req')?.value,
      pr_rfq: $('pr_rfq')?.value,
      pr_vq: $('pr_vq')?.value,
      pr_po: $('pr_po')?.value,
      pr_grn: $('pr_grn')?.value,
      pr_bill: $('pr_bill')?.value
    };
    try {
      const endpoint = isLead ? `/leads/${it.id}` : `/tenders/${it.id}`;
      await api('PATCH', endpoint, { data: b });
      isLead ? await loadLead(it.id) : await loadTender(it.id);
      render(); toast('Procurement Saved!','success');
    } catch(e) { toast(e.message,'error'); }
  });

  $('btnSaveOrderHeader')?.addEventListener('click', async () => {
    const isLead = S.page === 'leads' || !!S.leadId;
    const it = isLead ? S.leadItem : S.tender;
    const d = it.data || {};
    const b = {
      customer_name: $('ord_cust')?.value,
      delivery_address: $('ord_addr')?.value
    };
    const reqs = it.requirements || {};
    reqs.order_number = $('ord_num')?.value;
    try {
      if (isLead) {
        await api('PATCH', `/leads/${it.id}`, { data: { ...d, ...b }, requirements: reqs });
        await loadLead(it.id);
      } else {
        b.order_number = $('ord_num')?.value;
        await api('PATCH', `/tenders/${it.id}`, { data: { ...d, ...b }, requirements: reqs });
        await loadTender(it.id);
      }
      render(); toast('Header Saved!','success');
    } catch(e) { toast(e.message,'error'); }
  });

  $('btnAddOrderCol')?.addEventListener('click', async () => {
    const colName = prompt('Enter new column name:');
    if (!colName) return;
    const isLead = S.page === 'leads' || !!S.leadId;
    const it = isLead ? S.leadItem : S.tender;
    const d = it.data || {};
    const items = d.items || [];
    
    document.querySelectorAll('.tbl-input').forEach(inp => {
       const rowIdx = parseInt(inp.dataset.row);
       const cName = inp.dataset.col;
       if (!items[rowIdx]) items[rowIdx] = {};
       items[rowIdx][cName] = inp.value;
    });

    const customCols = d.custom_columns || [];
    if (customCols.includes(colName)) return toast('Column exists','error');
    customCols.push(colName);
    try {
      const endpoint = isLead ? `/leads/${it.id}` : `/tenders/${it.id}`;
      await api('PATCH', endpoint, { data: { ...d, items, custom_columns: customCols } });
      isLead ? await loadLead(it.id) : await loadTender(it.id);
      render(); toast('Column added','success');
    } catch(e) { toast(e.message,'error'); }
  });

  $('btnAddOrderRow')?.addEventListener('click', async () => {
    const isLead = S.page === 'leads' || !!S.leadId;
    const it = isLead ? S.leadItem : S.tender;
    const d = it.data || {};
    const items = d.items || [];
    
    document.querySelectorAll('.tbl-input').forEach(inp => {
       const rowIdx = parseInt(inp.dataset.row);
       const colName = inp.dataset.col;
       if (!items[rowIdx]) items[rowIdx] = {};
       items[rowIdx][colName] = inp.value;
    });

    items.push({});
    try {
      const endpoint = isLead ? `/leads/${it.id}` : `/tenders/${it.id}`;
      await api('PATCH', endpoint, { data: { ...d, items } });
      isLead ? await loadLead(it.id) : await loadTender(it.id);
      render(); toast('Row added','success');
    } catch(e) { toast(e.message,'error'); }
  });

  document.querySelectorAll('.del-row-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const isLead = S.page === 'leads' || !!S.leadId;
      const it = isLead ? S.leadItem : S.tender;
      const d = it.data || {};
      const items = d.items || [];
      
      document.querySelectorAll('.tbl-input').forEach(inp => {
         const rIdx = parseInt(inp.dataset.row);
         const colName = inp.dataset.col;
         if (!items[rIdx]) items[rIdx] = {};
         items[rIdx][colName] = inp.value;
      });

      const rowIdx = parseInt(e.target.dataset.row);
      items.splice(rowIdx, 1);
      try {
        const endpoint = isLead ? `/leads/${it.id}` : `/tenders/${it.id}`;
        await api('PATCH', endpoint, { data: { ...d, items } });
        isLead ? await loadLead(it.id) : await loadTender(it.id);
        render(); toast('Row deleted','success');
      } catch(ex) { toast(ex.message,'error'); }
    });
  });

  $('btnSaveOrderItems')?.addEventListener('click', async () => {
    const isLead = S.page === 'leads' || !!S.leadId;
    const it = isLead ? S.leadItem : S.tender;
    const d = it.data || {};
    const items = d.items || [];
    
    document.querySelectorAll('.tbl-input').forEach(inp => {
       const rowIdx = parseInt(inp.dataset.row);
       const colName = inp.dataset.col;
       if (!items[rowIdx]) items[rowIdx] = {};
       items[rowIdx][colName] = inp.value;
    });

    try {
      const endpoint = isLead ? `/leads/${it.id}` : `/tenders/${it.id}`;
      await api('PATCH', endpoint, { data: { ...d, items } });
      isLead ? await loadLead(it.id) : await loadTender(it.id);
      render(); toast('Items Saved!','success');
    } catch(e) { toast(e.message,'error'); }
  });

  $('btnFinaliseOrder')?.addEventListener('click', async () => {
    if (!confirm('Finalise order? This will skip to Phase 5 (Billing).')) return;
    const isLead = S.page === 'leads' || !!S.leadId;
    const it = isLead ? S.leadItem : S.tender;
    try {
      const endpoint = isLead ? `/leads/${it.id}/move` : `/tenders/${it.id}/move`;
      await api('POST', endpoint, { stage: 'ph5_active' });
      isLead ? await loadLead(it.id) : await loadTender(it.id);
      render(); toast('Order Finalised! Moved to Billing.', 'success');
    } catch(e) { toast(e.message, 'error'); }
  });

  const orderDocInput = $('orderDocsInput');
  if (orderDocInput) {
    orderDocInput.addEventListener('change', async () => {
       const isLead = S.page === 'leads' || !!S.leadId;
       const it = isLead ? S.leadItem : S.tender;
       if (!orderDocInput.files.length) return;
       for (let i=0; i<orderDocInput.files.length; i++) {
         const fd = new FormData(); fd.append('file', orderDocInput.files[i]);
         try {
           const endpoint = isLead ? `/leads/${it.id}/documents` : `/tenders/${it.id}/documents`;
           await up(endpoint, fd);
         } catch(e) { toast(e.message, 'error'); }
       }
       toast('Files uploaded', 'success');
       isLead ? await loadLead(it.id) : await loadTender(it.id);
       render();
    });
  }

  document.querySelectorAll('.del-doc-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
       if(!confirm('Delete this document?')) return;
       const isLead = S.page === 'leads' || !!S.leadId;
       const it = isLead ? S.leadItem : S.tender;
       const docId = e.target.dataset.id;
       try {
         const endpoint = isLead ? `/leads/${it.id}/documents/${docId}` : `/tenders/${it.id}/documents/${docId}`;
         await api('DELETE', endpoint);
         toast('Document deleted', 'success');
         isLead ? await loadLead(it.id) : await loadTender(it.id);
         render();
       } catch(ex) { toast(ex.message, 'error'); }
    });
  });

  $('btnExportOrderExcel')?.addEventListener('click', () => {
    const isLead = S.page === 'leads' || !!S.leadId;
    const it = isLead ? S.leadItem : S.tender;
    const d = it.data || {};
    const items = d.items || [];
    if (!items.length) return toast('No items to export','error');
    
    // Auto calculate amounts for export
    const exportData = items.map(item => {
       const qty = parseFloat(item['Qty']) || 0;
       const price = parseFloat(item['Price (₹)']) || 0;
       const gst = parseFloat(item['GST %']) || 0;
       const amount = qty * price * (1 + (gst/100));
       return { ...item, 'Amount (₹)': amount.toFixed(2) };
    });
    
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Order Items");
    XLSX.writeFile(wb, `Order_${it.title || 'Export'}.xlsx`);
  });

}

window.calcTotal = function() {
  const m = parseFloat(document.getElementById('mrcp')?.value || 0);
  const g = parseFloat(document.getElementById('gst')?.value || 0);
  const t = document.getElementById('total_bid_value');
  if (t) t.value = (m + (m * g / 100)).toFixed(2);
};

window.createUser = async function() {
  const body = {
    name: $('nu-name')?.value,
    email: $('nu-email')?.value,
    password: $('nu-pass')?.value,
    role: $('nu-role')?.value,
    workspace_id: S.workspaceId
  };
  if (!body.name || !body.email || !body.password) return toast('Name, email, and password are required', 'error');
  try {
    await api('POST', '/users', body);
    await loadUsers();
    render();
    toast('User created!', 'success');
  } catch(e) {
    toast(e.message, 'error');
  }
};

window.toggleUserStatus = async function(userId, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
  try {
    await api('PATCH', `/users/${userId}`, { status: newStatus, workspace_id: S.workspaceId });
    await loadUsers();
    render();
    toast('User status updated', 'success');
  } catch(e) {
    toast(e.message, 'error');
  }
};

// ---- Run ----
init();

