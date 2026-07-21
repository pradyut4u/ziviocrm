import xlsx from 'xlsx';
import https from 'https';

const SUPABASE_URL = 'https://temqpguspbgkapfdvlzq.supabase.co';
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

function parseExcelDate(excelDate) {
    if (!excelDate) return null;
    if (typeof excelDate === 'number') {
        const date = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
        return date.toISOString();
    }
    // Try to parse string dates like DD/MM/YYYY
    if (typeof excelDate === 'string') {
        const parts = excelDate.split('/');
        if (parts.length === 3) {
            return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).toISOString();
        }
    }
    return new Date(excelDate).toISOString();
}

async function main() {
    try {
        console.log("Fetching users to assign default created_by...");
        const users = await request('GET', '/rest/v1/users?select=id&limit=1');
        const defaultUserId = users.length > 0 ? users[0].id : null;

        console.log("Reading Tender.xlsx...");
        const tenderWb = xlsx.readFile('d:/tender ops/Tender.xlsx');
        const tenderSheet = tenderWb.Sheets['Tender Department'];
        const tenderData = xlsx.utils.sheet_to_json(tenderSheet, { defval: null });

        console.log("Reading Tech.xlsx...");
        const techWb = xlsx.readFile('d:/tender ops/Tech.xlsx');
        const techSheet = techWb.Sheets['Technical Department'];
        const techData = xlsx.utils.sheet_to_json(techSheet, { defval: null });

        // Build a map of tenders to insert
        const tendersToInsert = [];
        const leadsToInsert = [];
        const itemMap = {}; // mapping Record ID to { type, id }
        const seenRecordIds = new Set();
        const crypto = await import('crypto');

        for (const row of tenderData) {
            const recordId = row['Record ID'];
            if (!recordId) continue;
            if (seenRecordIds.has(recordId)) {
                console.log(`Skipping duplicate Record ID: ${recordId}`);
                continue;
            }
            seenRecordIds.add(recordId);

            const isLead = row['Tender No.'] && row['Tender No.'].toString().toLowerCase().includes('direct order');
            const itemId = crypto.randomUUID();
            itemMap[recordId] = { type: isLead ? 'lead' : 'tender', id: itemId };

            const item = {
                id: itemId,
                title: row['Tender Name'] || `Item ${row['Record ID']}`,
                bid_number: row['Tender No.'],
                customer: row['Customer / Organization'] || 'Unknown',
                org_name: row['Customer / Organization'] || 'Unknown',
                description: row['Opportunity Type'] ? `Type: ${row['Opportunity Type']}` : null,
                due_date: parseExcelDate(row['Bid Submission Date']),
                bid_end_datetime: parseExcelDate(row['Bid Submission Date']),
                bid_init_date: parseExcelDate(row['Publish Date']),
                pre_bid_datetime: parseExcelDate(row['Pre-Bid Date']),
                value: parseFloat(row['Tender Value']) || 0,
                est_bid_value: parseFloat(row['Tender Value']) || null,
                priority: 'medium',
                stage: (row['Bid Status'] || 'draft').toLowerCase(),
                created_by: defaultUserId,
                ministry_state: row['State'],
                contract_period: (row['Contract start Date'] || '') + (row[' Contract End date'] ? ' to ' + row[' Contract End date'] : ''),
                service_type: row['Opportunity Type'],
                bandwidth_mbps: null, // Will populate from tech sheet
                requirements: {
                    lead_source: row['Lead Source'],
                    customer_category: row['Customer Category'],
                    tender_portal: row['Tender Portal'],
                    e_pbg_amount: row['E-PBG Amount'],
                    tender_fee: row['Tender Fee'],
                    maf_required: row['MAF Required'],
                    oem_auth_required: row['OEM Authorization Required'],
                    remarks: row['Remarks']
                }
            };

            if (isLead) {
                delete item.bid_number;
                delete item.due_date;
                delete item.bid_end_datetime;
                delete item.bid_init_date;
                delete item.pre_bid_datetime;
                delete item.est_bid_value;
                delete item.ministry_state;
                delete item.customer;
                delete item.value;
                delete item.priority;
                delete item.requirements;
                leadsToInsert.push(item);
            } else {
                tendersToInsert.push(item);
            }
        }


        const techReportsToInsert = [];
        const leadTechReportsToInsert = [];
        const seenTechRecordIds = new Set();
        for (const row of techData) {
            const recordId = row['Record ID'];
            if (!recordId) continue;
            if (seenTechRecordIds.has(recordId)) {
                continue;
            }
            seenTechRecordIds.add(recordId);

            const mappedItem = itemMap[recordId];
            if (!mappedItem) {
                console.warn(`No tender/lead found for Tech report Record ID: ${recordId}`);
                continue;
            }

            // Find item and populate bandwidth
            const itemObj = mappedItem.type === 'lead' ? leadsToInsert.find(t => t.id === mappedItem.id) : tendersToInsert.find(t => t.id === mappedItem.id);
            if (itemObj && row['Bandwidth (Mbps)']) {
                itemObj.bandwidth_mbps = parseFloat(row['Bandwidth (Mbps)'].toString().replace(/[^0-9.]/g, '')) || null;
            }

            const techReport = {
                id: crypto.randomUUID(),
                submitted_by: defaultUserId,
                feasibility_status: (row['Feasibility Status'] || 'pending').toLowerCase(),
                survey_date: parseExcelDate(row['Site Survey Date']),
                nearest_pop_dist: row['Approx. Distance (KM)'] ? parseFloat(row['Approx. Distance (KM)']) : null,
                service_provider: row['Primary Provider'],
                survey_notes: JSON.stringify({
                    site_address: row['Site Address'],
                    nearest_pop: row['Nearest POP'],
                    backup_provider: row['Backup Provider'],
                    redundancy: row['Redundancy'],
                    bandwidth: row['Bandwidth (Mbps)'],
                    last_mile: row['Last Mile Type'],
                    public_ip_count: row['Public IP Count'],
                    bgp_required: row['BGP Required'],
                    customer_asn: row['Customer ASN'],
                    router_model: row['Router Model'],
                    firewall_model: row['Firewall Model'],
                    switch_model: row['Switch Model'],
                    ap_model: row['Access Point Model'],
                    boq_status: row['BOQ Status'],
                    hld_status: row['HLD Status'],
                    lld_status: row['LLD Status'],
                    oem_lead_time: row['OEM Lead Time'],
                    implementation_lead_time: row['Implementation Lead Time'],
                    technical_status: row['Technical Status'],
                    assigned_engineer: row['Assigned Engineer'],
                    lan_pool: row['LAN POOL'],
                    wan_ip: row['WAN IP'],
                    remarks: row['Remarks']
                })
            };
            if (mappedItem.type === 'lead') {
                techReport.lead_id = mappedItem.id;
                leadTechReportsToInsert.push(techReport);
            } else {
                techReport.tender_id = mappedItem.id;
                techReportsToInsert.push(techReport);
            }
        }

        if (leadsToInsert.length > 0) {
            console.log(`Inserting ${leadsToInsert.length} leads...`);
            await request('POST', '/rest/v1/leads', leadsToInsert);
        }

        if (tendersToInsert.length > 0) {
            console.log(`Inserting ${tendersToInsert.length} tenders...`);
            await request('POST', '/rest/v1/tenders', tendersToInsert);
        }

        if (leadTechReportsToInsert.length > 0) {
            console.log(`Inserting ${leadTechReportsToInsert.length} lead tech reports...`);
            await request('POST', '/rest/v1/lead_technical_reports', leadTechReportsToInsert);
        }

        if (techReportsToInsert.length > 0) {
            console.log(`Inserting ${techReportsToInsert.length} tech reports...`);
            await request('POST', '/rest/v1/technical_reports', techReportsToInsert);
        }

        console.log("Done!");
    } catch (e) {
        console.error("Error:", e.message);
    }
}

main();
