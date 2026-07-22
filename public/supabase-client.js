// Supabase Client Wrapper
const SUPABASE_URL = 'https://temqpguspbgkapfdvlzq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFub24iLCJpYXQiOjE3ODQxNzY1MTAsImV4cCI6MjA5OTc1MjUxMH0.t6syiRYkqpXw_R1Vhj2bPqxeIpWBF4W_QZ_qb2Pu5NQ';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function getPrefix(path) {
  if (path.startsWith('/leads')) return 'lead';
  return 'tender'; // default for tenders
}

async function audit(action, type, id, details = {}) {
  await supabase.from('audit_logs').insert({ action, entity_type: type, entity_id: id, user_id: S.user.id, details });
}

async function notify(userId, title, message, type = 'info', linkId = null) {
  await supabase.from('notifications').insert({ user_id: userId, title, message, type, link_id: linkId });
}

async function uploadFile(file) {
  if (!file) return null;
  const ext = file.name.split('.').pop();
  const uuid = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substring(2);
  const filename = `${uuid}.${ext}`;
  const { data, error } = await supabase.storage.from('documents').upload(filename, file);
  if (error) throw error;
  const { data: { publicUrl } } = supabase.storage.from('documents').getPublicUrl(filename);
  return { name: file.name, stored: filename, url: publicUrl, size: file.size, mime: file.type };
}

async function api(method, path, body) {
  if (path === '/auth/login' && method === 'POST') {
    const { data, error } = await supabase.auth.signInWithPassword({ email: body.email, password: body.password });
    if (error) throw error;
    const { data: profile } = await supabase.from('users').select('*').eq('id', data.user.id).single();
    return { token: data.session.access_token, user: profile };
  }
  
  if (path === '/auth/logout' && method === 'POST') {
    await supabase.auth.signOut();
    return {};
  }
  
  if (path === '/auth/me' && method === 'GET') {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Unauth');
    const { data: profile } = await supabase.from('users').select('*').eq('id', session.user.id).single();
    return profile;
  }
  
  if (path === '/users' && method === 'GET') {
    const { data } = await supabase.from('users').select('*'); return data;
  }
  
  if (path === '/tenders' || path === '/leads') {
    const table = path === '/tenders' ? 'tenders' : 'leads';
    if (method === 'GET') {
      const { data } = await supabase.from(table).select('*'); return data;
    }
    if (method === 'POST') {
      const { data } = await supabase.from(table).insert({...body, created_by: S.user.id}).select();
      await audit('create', table.slice(0, -1), data[0].id);
      return data[0];
    }
  }
  
  if (path === '/audit' && method === 'GET') {
    const { data } = await supabase.from('audit_logs').select('*, users (name)').order('created_at', { ascending: false }).limit(50);
    return data.map(d => ({ ...d, user_name: d.users?.name || 'Unknown' }));
  }
  
  if (path === '/notifications' && method === 'GET') {
    const { data } = await supabase.from('notifications').select('*').eq('user_id', S.user.id).order('created_at', { ascending: false });
    return data;
  }
  
  if (path === '/notifications/read-all' && method === 'PATCH') {
    await supabase.from('notifications').update({ read: true }).eq('user_id', S.user.id);
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
      const { data: main } = await supabase.from(table).select('*').eq('id', id).single();
      const pId = isLead ? 'lead_id' : 'tender_id';
      
      const pDocs = supabase.from(prefix + (isLead ? 'documents' : 'tender_documents')).select('*').eq(pId, id);
      const pTech = supabase.from(prefix + 'technical_reports').select('*').eq(pId, id);
      const pPh3 = supabase.from(prefix + 'phase3_records').select('*').eq(pId, id);
      const pPh4 = supabase.from(prefix + 'phase4_records').select('*').eq(pId, id);
      const pInv = supabase.from(prefix + 'invoices').select('*').eq(pId, id);
      const pCyc = supabase.from(prefix + 'payment_cycles').select('*').eq(pId, id);
      const pCir = supabase.from('circuits').select('*').eq('parent_id', id);
      
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
      const { data } = await supabase.from(table).update(body).eq('id', id).select();
      await audit('update', eType, id, Object.keys(body));
      return data[0];
    }
    
    if (sub === 'move' && method === 'POST') {
      await supabase.from(table).update({ stage: body.stage }).eq('id', id);
      await audit('move', eType, id, { to: body.stage });
      return { success: true };
    }
    
    if (sub === 'phase3' && method === 'POST') {
      await supabase.from(prefix + 'phase3_records').insert({ ...body, [isLead ? 'lead_id' : 'tender_id']: id, created_by: S.user.id });
      const newStage = body.qualification_result === 'Awarded' ? 'ph3_awarded' : 'ph3_disqualified';
      await supabase.from(table).update({ stage: newStage }).eq('id', id);
      await audit('phase3.create', eType, id, { result: body.qualification_result });
      return { success: true };
    }
    
    if (sub === 'payment-cycles' && method === 'POST') {
      await supabase.from(prefix + 'payment_cycles').insert({ ...body, [isLead ? 'lead_id' : 'tender_id']: id, created_by: S.user.id });
      return { success: true };
    }
    
    if (sub.startsWith('payment-cycles/') && method === 'PATCH') {
      const cid = sub.split('/')[1];
      await supabase.from(prefix + 'payment_cycles').update(body).eq('id', cid);
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
    await supabase.from(prefix + (isLead ? 'documents' : 'tender_documents')).insert({
      [pId]: id, name: fileData.name, stored: fileData.stored, url: fileData.url, size: fileData.size, mime: fileData.mime, uploaded_by: S.user.id
    });
    await audit('doc.upload', eType, id, { name: fileData.name });
    return { success: true };
  }
  
  if (sub === 'phase2') {
    const fDoc = await uploadFile(fd.get('feasibility_doc'));
    const sDoc = await uploadFile(fd.get('site_survey_doc'));
    await supabase.from(prefix + 'technical_reports').insert({
      [pId]: id, submitted_by: S.user.id,
      feasibility_status: fd.get('feasibility_status'),
      survey_notes: fd.get('survey_notes'),
      feasibility_doc_url: fDoc?.url || null,
      site_survey_doc_url: sDoc?.url || null
    });
    await supabase.from(table).update({ stage: 'ph2_complete' }).eq('id', id);
    await audit('report.submit', eType, id);
    return { success: true };
  }
  
  if (sub === 'phase4') {
    const aDoc = await uploadFile(fd.get('acceptance_form'));
    const cDoc = await uploadFile(fd.get('completion_cert'));
    await supabase.from(prefix + 'phase4_records').insert({
      [pId]: id, created_by: S.user.id,
      delivery_date: fd.get('delivery_date'),
      delivery_notes: fd.get('delivery_notes'),
      acceptance_form_url: aDoc?.url || null,
      completion_cert_url: cDoc?.url || null
    });
    await supabase.from(table).update({ stage: 'ph4_complete' }).eq('id', id);
    
    const numCircuits = parseInt(fd.get('num_circuits')) || 0;
    if (numCircuits > 0) {
      // Need to handle circuit generation (Skipping for now or implement simple random logic? No, must match format IPNYYYY-MM-1xx)
      const d = new Date();
      const yy = String(d.getFullYear()).slice(2);
      const yyNext = String(d.getFullYear() + 1).slice(2);
      const yyyy = yy + yyNext; // 2627
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const seqKey = `${yyyy}-${mm}`;
      
      // We will do a basic random ID or implement exact logic if required via an Edge function or just client side with a random suffix since client-side transaction is hard
      // Let's use a random suffix for now to avoid race conditions without RPC
      const circuits = [];
      for (let i = 0; i < numCircuits; i++) {
         circuits.push({
           parent_id: id, parent_type: eType, circuit_id: `IPN${seqKey}-${Math.floor(100 + Math.random() * 900)}`
         });
      }
      await supabase.from('circuits').insert(circuits);
    }
    
    await audit('phase4.submit', eType, id);
    return { success: true };
  }
  
  if (sub === 'phase5') {
    const invDoc = await uploadFile(fd.get('invoice_upload'));
    await supabase.from(prefix + 'invoices').insert({
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
    await supabase.from(table).update({ stage: 'ph5_active' }).eq('id', id);
    await audit('phase5.submit', eType, id);
    return { success: true };
  }
  
  throw new Error('Upload path not implemented: ' + path);
}

window.api = api;
window.up = up;
