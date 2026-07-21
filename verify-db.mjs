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
            try { resolve(data ? JSON.parse(data) : {}); }
            catch(e) { resolve(data); }
        } else {
            reject(new Error(`HTTP ${res.statusCode} on ${path}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function verify() {
    try {
        const tenders = await request('GET', '/rest/v1/tenders?select=*');
        const techReports = await request('GET', '/rest/v1/technical_reports?select=*');

        console.log(`\n=== Verification Results ===\n`);
        console.log(`Total Tenders in DB: ${tenders.length}`);
        if (tenders.length > 0) {
            console.log(`\nSample Tender:\nID: ${tenders[0].id}\nTitle: ${tenders[0].title}\nBid Number: ${tenders[0].bid_number}\nCustomer: ${tenders[0].customer}`);
        }

        console.log(`\n----------------------------\n`);
        console.log(`Total Technical Reports in DB: ${techReports.length}`);
        if (techReports.length > 0) {
            console.log(`\nSample Tech Report:\nID: ${techReports[0].id}\nTender ID: ${techReports[0].tender_id}\nFeasibility Status: ${techReports[0].feasibility_status}\nNearest POP Dist: ${techReports[0].nearest_pop_dist}`);
        }
        console.log(`\n============================\n`);
    } catch (e) {
        console.error("Verification failed:", e.message);
    }
}

verify();
