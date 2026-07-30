import { randomUUID } from 'node:crypto';
import xlsx from 'xlsx';
import https from 'https';

const SUPABASE_URL = 'https://temqpguspbgkapfdvlzq.supabase.co';
// The service key used in your other scripts
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlbXFwZ3VzcGJna2FwZmR2bHpxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDE3NjUxMCwiZXhwIjoyMDk5NzUyNTEwfQ.v2KFOxEnLb55T2X8rXrBULx9NInQaBmIqtwivPbomv0';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL + path);
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      }
    };
    
    if (body) {
        opts.headers['Prefer'] = 'resolution=merge-duplicates,return=representation';
    }

    const req = https.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(data ? JSON.parse(data) : {}); }
            catch(e) { resolve(data); }
        } else {
            reject(new Error(`HTTP ${res.statusCode} on ${path}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
    try {
        console.log("Fetching a default user for created_by...");
        let defaultUserId = null;
        try {
            const users = await request('GET', '/rest/v1/users?select=id&limit=1');
            if (users && users.length > 0) defaultUserId = users[0].id;
        } catch (e) {
            console.log("Could not fetch user, using null.");
        }

        console.log("Reading CSV...");
        // Although the package is named 'xlsx', it natively parses standard CSV files perfectly.
        const wb = xlsx.readFile('d:/tender ops/DAIC Official sheet (3).csv');
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const data = xlsx.utils.sheet_to_json(sheet, { defval: null });

        const leadsToInsert = [];
        const invoicesToInsert = [];

        let count = 0;

        for (const row of data) {
            const sn = row['S.No'];
            if (!sn) continue; // Skip empty rows

            const eventName = row['EVENT NAME'];
            if (!eventName) continue;

            const company = row['Company Name'] || '';
            const customer = row['Customer Name'] || '';
            
            const baseValRaw = row['Base Value'] ? row['Base Value'].toString().replace(/[^0-9.]/g, '') : '0';
            const gstRaw = row['GST'] ? row['GST'].toString().replace(/[^0-9.]/g, '') : '0';
            const totalRaw = row['Total'] ? row['Total'].toString().replace(/[^0-9.]/g, '') : '0';

            const baseVal = parseFloat(baseValRaw) || 0;
            const gst = parseFloat(gstRaw) || 0;
            const total = parseFloat(totalRaw) || 0;

            let mbpsRaw = row['Mbps Qty'] ? row['Mbps Qty'].toString().replace(/[^0-9.]/g, '') : null;
            let mbps = mbpsRaw ? parseFloat(mbpsRaw) : null;

            const leadId = randomUUID();
            
            // Map according to the Supabase leads schema
            const lead = {
                id: leadId,
                title: eventName,
                org_name: company,
                est_bid_value: baseVal,
                total_bid_value: total,
                gst: baseVal > 0 ? (gst / baseVal * 100) : 18,
                bandwidth_mbps: mbps,
                stage: 'ph5_active', // Billing Phase
                created_by: defaultUserId,
                workspace_id: 'f4afb318-a978-4ff7-942a-fad41409c06f'
            };

            leadsToInsert.push(lead);

            // Phase 5 requires invoices
            invoicesToInsert.push({
                id: randomUUID(),
                lead_id: leadId,
                invoice_number: row['Invoice no'] || `INV-DAIC-${sn}`,
                base_price: baseVal,
                gst_pct: lead.gst,
                invoice_value: total,
                created_by: defaultUserId,
                workspace_id: 'f4afb318-a978-4ff7-942a-fad41409c06f'
            });

            count++;
        }

        console.log(`Inserting ${leadsToInsert.length} leads into Supabase...`);
        // Insert in batches of 10 to avoid payload issues
        for (let i = 0; i < leadsToInsert.length; i += 10) {
            await request('POST', '/rest/v1/leads', leadsToInsert.slice(i, i + 10));
        }

        console.log(`Inserting ${invoicesToInsert.length} invoices into Supabase...`);
        for (let i = 0; i < invoicesToInsert.length; i += 10) {
            await request('POST', '/rest/v1/lead_invoices', invoicesToInsert.slice(i, i + 10));
        }

        console.log(`Successfully pushed ${count} leads and invoices to Supabase!`);

    } catch (e) {
        console.error("Error:", e);
    }
}

main();
