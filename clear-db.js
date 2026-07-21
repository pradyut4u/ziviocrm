import https from 'https';

const SUPABASE_URL = 'https://temqpguspbgkapfdvlzq.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlbXFwZ3VzcGJna2FwZmR2bHpxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDE3NjUxMCwiZXhwIjoyMDk5NzUyNTEwfQ.v2KFOxEnLb55T2X8rXrBULx9NInQaBmIqtwivPbomv0';

function request(method, path) {
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
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
                resolve(data ? JSON.parse(data) : {});
            } catch(e) { resolve(data); }
        }
        else reject(new Error(`HTTP ${res.statusCode} on ${path}: ${data}`));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const tables = [
  'lead_documents', 'lead_technical_reports', 'lead_phase3_records', 'lead_phase4_records', 
  'lead_invoices', 'lead_payment_cycles', 'technical_reports', 'phase3_records', 'phase4_records', 
  'invoices', 'payment_cycles', 'circuits', 'leads', 'tenders'
];

async function main() {
    for (const table of tables) {
        try {
            console.log(`Deleting ${table}...`);
            const records = await request('GET', `/rest/v1/${table}?select=id`);
            if (records.length > 0) {
                // Delete in chunks of 100 to avoid long URI
                for (let i = 0; i < records.length; i += 100) {
                    const chunk = records.slice(i, i + 100);
                    const ids = chunk.map(r => r.id).join(',');
                    await request('DELETE', `/rest/v1/${table}?id=in.(${ids})`);
                }
            }
            console.log(`Cleared ${table}`);
        } catch(e) {
            console.error(`Error on ${table}:`, e.message);
        }
    }
}
main();
