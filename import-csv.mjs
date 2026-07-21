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
    if (typeof excelDate === 'number' || !isNaN(parseFloat(excelDate))) {
        const num = parseFloat(excelDate);
        if (num > 30000) {
            const date = new Date(Math.round((num - 25569) * 86400 * 1000));
            return date.toISOString();
        }
    }
    if (typeof excelDate === 'string') {
        const parts = excelDate.split(/[-/]/);
        if (parts.length === 3) {
            if (parts[2].length === 4) { 
                return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).toISOString();
            }
        }
    }
    return new Date(excelDate).toISOString();
}

function calculatePeriod(startRaw, endRaw) {
    if (!startRaw || !endRaw) return (startRaw || '') + (endRaw ? ' to ' + endRaw : '');
    try {
        const startDate = new Date(parseExcelDate(startRaw));
        const endDate = new Date(parseExcelDate(endRaw));
        if (isNaN(startDate) || isNaN(endDate)) return startRaw + ' to ' + endRaw;
        
        const diffDays = Math.round(Math.abs(endDate - startDate) / (1000 * 60 * 60 * 24));
        const diffMonths = Math.round(diffDays / 30.436875);
        
        if (diffMonths > 0) {
            if (diffMonths % 12 === 0) return (diffMonths / 12) + (diffMonths / 12 === 1 ? ' Year' : ' Years');
            return diffMonths + ' Months';
        }
        return diffDays + ' Days';
    } catch(e) {
        return startRaw + ' to ' + endRaw;
    }
}

async function main() {
    try {
        console.log("Fetching users to assign default created_by...");
        const users = await request('GET', '/rest/v1/users?select=id&limit=1');
        const defaultUserId = users.length > 0 ? users[0].id : null;

        console.log("Reading Tender (1).csv...");
        const tenderWb = xlsx.readFile('d:/tender ops/Tender (1).csv');
        const tenderSheet = tenderWb.Sheets[tenderWb.SheetNames[0]];
        const tenderData = xlsx.utils.sheet_to_json(tenderSheet, { defval: null });

        console.log("Reading tech_Tender (1).csv...");
        const techWb = xlsx.readFile('d:/tender ops/tech_Tender (1).csv');
        const techSheet = techWb.Sheets[techWb.SheetNames[0]];
        const techData = xlsx.utils.sheet_to_json(techSheet, { defval: null });

        console.log("Reading bandwidthTender (1).csv...");
        let bwData = [];
        try {
            const bwWb = xlsx.readFile('d:/tender ops/bandwidthTender (1).csv');
            const bwSheet = bwWb.Sheets[bwWb.SheetNames[0]];
            bwData = xlsx.utils.sheet_to_json(bwSheet, { defval: null });
        } catch (e) {
            console.warn("Could not read bandwidth CSV:", e.message);
        }

        const bwMap = {};
        for (const row of bwData) {
            if (row['CONTRACT NO.'] && row['Speed']) {
                bwMap[row['CONTRACT NO.']] = row['Speed'];
            }
        }

        const tendersToInsert = [];
        const leadsToInsert = [];
        const itemMap = {}; 
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
            let tenderValRaw = row['Tender Value'];
            if (typeof tenderValRaw === 'string') tenderValRaw = tenderValRaw.replace(/[^\d.]/g, '');
            const parsedTenderVal = parseFloat(tenderValRaw) || null;
            itemMap[recordId] = { type: isLead ? 'lead' : 'tender', id: itemId, tenderValue: parsedTenderVal };

            let stageVal = (row['Bid Status'] || 'draft').toLowerCase().trim();
            if (stageVal === 'won') {
                stageVal = 'ph5_active';
            }

            const city = row['City'] || '';
            const state = row['State'] || '';
            const linkDeliveryAddress = [city, state].filter(Boolean).join(', ');

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
                value: parsedTenderVal || 0,
                est_bid_value: parsedTenderVal,
                priority: 'medium',
                stage: stageVal,
                created_by: defaultUserId,
                ministry_state: row['State'],
                link_delivery_address: linkDeliveryAddress,
                contract_period: calculatePeriod(row['Contract start Date'], row[' Contract End date']),
                service_type: row['Opportunity Type'],
                bandwidth_mbps: null, 
                requirements: {
                    order_number: row['Record ID'],
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

            if (bwMap[recordId]) {
                const spdStr = bwMap[recordId].toString();
                item.bandwidth_mbps = parseFloat(spdStr.replace(/[^0-9.]/g, '')) || null;
            } else if (row['Bandwidth (Mbps)']) {
                item.bandwidth_mbps = parseFloat(row['Bandwidth (Mbps)'].toString().replace(/[^0-9.]/g, '')) || null;
            }

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
        const phase3RecordsToInsert = [];
        const leadPhase3RecordsToInsert = [];
        const phase4RecordsToInsert = [];
        const leadPhase4RecordsToInsert = [];
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

            const itemObj = mappedItem.type === 'lead' ? leadsToInsert.find(t => t.id === mappedItem.id) : tendersToInsert.find(t => t.id === mappedItem.id);
            if (itemObj && !itemObj.bandwidth_mbps && row['Bandwidth (Mbps)']) {
                itemObj.bandwidth_mbps = parseFloat(row['Bandwidth (Mbps)'].toString().replace(/[^0-9.]/g, '')) || null;
            }
            if (itemObj && bwMap[recordId]) {
                const spdStr = bwMap[recordId].toString();
                itemObj.bandwidth_mbps = parseFloat(spdStr.replace(/[^0-9.]/g, '')) || itemObj.bandwidth_mbps;
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

            if (itemObj && itemObj.stage === 'ph5_active') {
                const p3Rec = {
                    id: crypto.randomUUID(),
                    created_by: defaultUserId,
                    award_date: parseExcelDate(row['Site Survey Date']) || new Date().toISOString(),
                    delivery_date: parseExcelDate(row['Site Survey Date']) || new Date().toISOString(),
                    quoted_bid_value: mappedItem.tenderValue
                };
                
                let ipv4Pools = [];
                if (row['LAN POOL']) ipv4Pools.push(...row['LAN POOL'].split(',').map(s=>s.trim()).filter(Boolean));
                if (row['WAN IP']) ipv4Pools.push(...row['WAN IP'].split(',').map(s=>s.trim()).filter(Boolean));

                const p4Rec = {
                    id: crypto.randomUUID(),
                    created_by: defaultUserId,
                    delivery_date: parseExcelDate(row['Site Survey Date']) || new Date().toISOString(),
                    delivery_notes: "Migrated from Tech Report",
                    ipv4_addresses: ipv4Pools.length > 0 ? ipv4Pools : null,
                    ipv6_addresses: null,
                    router_names: null
                };

                if (mappedItem.type === 'lead') {
                    p3Rec.lead_id = mappedItem.id;
                    p4Rec.lead_id = mappedItem.id;
                    leadPhase3RecordsToInsert.push(p3Rec);
                    leadPhase4RecordsToInsert.push(p4Rec);
                } else {
                    p3Rec.tender_id = mappedItem.id;
                    p4Rec.tender_id = mappedItem.id;
                    phase3RecordsToInsert.push(p3Rec);
                    phase4RecordsToInsert.push(p4Rec);
                }
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

        if (leadPhase3RecordsToInsert.length > 0) {
            console.log(`Inserting ${leadPhase3RecordsToInsert.length} lead phase 3 records...`);
            await request('POST', '/rest/v1/lead_phase3_records', leadPhase3RecordsToInsert);
        }

        if (phase3RecordsToInsert.length > 0) {
            console.log(`Inserting ${phase3RecordsToInsert.length} tender phase 3 records...`);
            await request('POST', '/rest/v1/phase3_records', phase3RecordsToInsert);
        }

        if (leadPhase4RecordsToInsert.length > 0) {
            console.log(`Inserting ${leadPhase4RecordsToInsert.length} lead phase 4 records...`);
            await request('POST', '/rest/v1/lead_phase4_records', leadPhase4RecordsToInsert);
        }

        if (phase4RecordsToInsert.length > 0) {
            console.log(`Inserting ${phase4RecordsToInsert.length} tender phase 4 records...`);
            await request('POST', '/rest/v1/phase4_records', phase4RecordsToInsert);
        }

        console.log("Done!");
    } catch (e) {
        console.error("Error:", e.message);
    }
}

main();
