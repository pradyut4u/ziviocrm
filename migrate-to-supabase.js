// migrate-to-supabase.js
// Run with: node migrate-to-supabase.js
// Uses only built-in Node.js https module — no npm required.

import https from 'https';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = 'https://temqpguspbgkapfdvlzq.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlbXFwZ3VzcGJna2FwZmR2bHpxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDE3NjUxMCwiZXhwIjoyMDk5NzUyNTEwfQ.v2KFOxEnLb55T2X8rXrBULx9NInQaBmIqtwivPbomv0';
const TEMP_PASSWORD = 'TenderOps2026!';

const DB_PATH = join(__dirname, 'data', 'db.json');
const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));

function request(method, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL + path);
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        ...extraHeaders
      }
    };
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        const parsed = data ? JSON.parse(data) : {};
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
        else reject(new Error(`HTTP ${res.statusCode} on ${path}: ${data}`));
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function upsertRows(table, rows) {
  if (!rows || rows.length === 0) return;
  return request('POST', `/rest/v1/${table}`, rows, { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
}

function cleanRow(row) {
  const { password_hash, salt, ...clean } = row;
  for (const k of Object.keys(clean)) if (clean[k] === undefined) clean[k] = null;
  return clean;
}

async function main() {
  console.log('=== TenderOps -> Supabase Migration ===\n');

  // 1. Create Auth users
  console.log('Step 1: Creating auth users...');
  const userIdMap = {};

  for (const u of db.users) {
    try {
      const res = await request('POST', '/auth/v1/admin/users', {
        email: u.email,
        password: TEMP_PASSWORD,
        email_confirm: true,
        user_metadata: { name: u.name, role: u.role, department: u.department }
      });
      userIdMap[u.id] = res.id;
      console.log(`  OK Created ${u.email} (${u.role}) -> ${res.id}`);
    } catch (e) {
      if (e.message.includes('already been registered') || e.message.includes('already exists') || e.message.includes('422')) {
        console.log(`  ~ ${u.email} already exists, fetching...`);
        try {
          const listRes = await request('GET', `/auth/v1/admin/users`);
          const existing = (listRes.users || []).find(x => x.email === u.email);
          if (existing) { userIdMap[u.id] = existing.id; console.log(`    -> Mapped to ${existing.id}`); }
          else { userIdMap[u.id] = u.id; }
        } catch (e2) { console.warn(`    Could not fetch users: ${e2.message}`); userIdMap[u.id] = u.id; }
      } else {
        console.warn(`  Failed ${u.email}: ${e.message}`);
        userIdMap[u.id] = u.id;
      }
    }
  }

  const remap = (id) => (id && userIdMap[id]) ? userIdMap[id] : (id || null);

  // 2. User profiles
  console.log('\nStep 2: Inserting user profiles...');
  const profiles = db.users.map(u => ({
    id: remap(u.id), name: u.name, email: u.email,
    role: u.role, department: u.department, status: u.status,
    created_at: u.created_at, updated_at: u.updated_at
  }));
  await upsertRows('users', profiles);
  console.log(`  OK ${profiles.length} profiles`);

  // 3. Tenders
  console.log('\nStep 3: Inserting tenders...');
  const tenders = (db.tenders || []).map(t => ({
    ...cleanRow(t), created_by: remap(t.created_by),
    assigned_to: remap(t.assigned_to), override_by: remap(t.override_by)
  }));
  if (tenders.length) { await upsertRows('tenders', tenders); console.log(`  OK ${tenders.length} tenders`); }

  // 4. Technical reports
  const reports = (db.technical_reports || []).map(r => {
    const clean = { ...cleanRow(r), submitted_by: remap(r.submitted_by) };
    delete clean.feasibility; delete clean.summary; delete clean.technical_notes; delete clean.recommendation; delete clean.attachment_name; delete clean.attachment_url;
    return clean;
  });
  if (reports.length) { await upsertRows('technical_reports', reports); console.log(`  OK ${reports.length} technical reports`); }

  // 5-8. Phase records, invoices, payment cycles for tenders
  const ph3 = (db.phase3_records || []).map(r => ({ ...cleanRow(r), created_by: remap(r.created_by) }));
  if (ph3.length) { await upsertRows('phase3_records', ph3); console.log(`  OK ${ph3.length} phase3 records`); }
  const ph4 = (db.phase4_records || []).map(r => ({ ...cleanRow(r), created_by: remap(r.created_by) }));
  if (ph4.length) { await upsertRows('phase4_records', ph4); console.log(`  OK ${ph4.length} phase4 records`); }
  const invs = (db.invoices || []).map(r => ({ ...cleanRow(r), created_by: remap(r.created_by) }));
  if (invs.length) { await upsertRows('invoices', invs); console.log(`  OK ${invs.length} invoices`); }
  const cycs = (db.payment_cycles || []).map(r => ({ ...cleanRow(r), created_by: remap(r.created_by) }));
  if (cycs.length) { await upsertRows('payment_cycles', cycs); console.log(`  OK ${cycs.length} payment cycles`); }

  // 9. Leads
  console.log('\nStep 9: Leads...');
  const leads = (db.leads || []).map(l => {
    const { bid_init_date, bid_end_datetime, bid_opening_datetime, ministry_state, dept_name, ...rest } = cleanRow(l);
    return { ...rest, created_by: remap(l.created_by), override_by: remap(l.override_by) };
  });
  if (leads.length) { await upsertRows('leads', leads); console.log(`  OK ${leads.length} leads`); }

  // 10-15. Lead sub-tables
  const ldocs = (db.lead_documents || []).map(d => ({ ...cleanRow(d), uploaded_by: remap(d.uploaded_by) }));
  if (ldocs.length) { await upsertRows('lead_documents', ldocs); console.log(`  OK ${ldocs.length} lead docs`); }
  const ltr = (db.lead_technical_reports || []).map(r => {
    const clean = { ...cleanRow(r), submitted_by: remap(r.submitted_by) };
    delete clean.feasibility; delete clean.summary; delete clean.technical_notes; delete clean.recommendation; delete clean.attachment_name; delete clean.attachment_url;
    return clean;
  });
  if (ltr.length) { await upsertRows('lead_technical_reports', ltr); console.log(`  OK ${ltr.length} lead tech reports`); }
  const lph3 = (db.lead_phase3_records || []).map(r => ({ ...cleanRow(r), created_by: remap(r.created_by) }));
  if (lph3.length) { await upsertRows('lead_phase3_records', lph3); console.log(`  OK ${lph3.length} lead ph3`); }
  const lph4 = (db.lead_phase4_records || []).map(r => ({ ...cleanRow(r), created_by: remap(r.created_by) }));
  if (lph4.length) { await upsertRows('lead_phase4_records', lph4); console.log(`  OK ${lph4.length} lead ph4`); }
  const linvs = (db.lead_invoices || []).map(r => ({ ...cleanRow(r), created_by: remap(r.created_by) }));
  if (linvs.length) { await upsertRows('lead_invoices', linvs); console.log(`  OK ${linvs.length} lead invoices`); }
  const lcycs = (db.lead_payment_cycles || []).map(r => ({ ...cleanRow(r), created_by: remap(r.created_by) }));
  if (lcycs.length) { await upsertRows('lead_payment_cycles', lcycs); console.log(`  OK ${lcycs.length} lead payment cycles`); }

  // 16. Circuits
  const circuits = (db.circuits || []);
  if (circuits.length) { await upsertRows('circuits', circuits); console.log(`  OK ${circuits.length} circuits`); }

  console.log('\n=== Migration complete! ===');
  console.log(`\nTemporary password for all users: ${TEMP_PASSWORD}`);
  console.log('Please ask each user to change their password after first login.\n');
}

main().catch(e => { console.error('\nMigration failed:', e.message); process.exit(1); });
