import fs from 'fs';
import crypto from 'crypto';

function parseDate(d) {
    if (!d) return 'NULL';
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) {
        const [D,M,Y] = d.split('/');
        return `'${Y}-${M}-${D} 00:00:00'`;
    }
    const t = Date.parse(d);
    if (!isNaN(t)) return `'${new Date(t).toISOString()}'`;
    return 'NULL';
}
function esc(s) { return s ? `'${String(s).replace(/'/g, "''")}'` : 'NULL'; }
function escJSON(o) { return `'${JSON.stringify(o).replace(/'/g, "''")}'`; }

const tenderCsv = fs.readFileSync('d:/tender ops/Tender.csv', 'utf8').split('\n').map(l=>l.trim()).filter(l=>l);
const techCsv = fs.readFileSync('d:/tender ops/Tech.csv', 'utf8').split('\n').map(l=>l.trim()).filter(l=>l);

function csvParse(lines) {
    const headers = lines[0].split(',').map(h=>h.trim());
    return lines.slice(1).map(l => {
        let inQ = false, val = '', row = {}, col = 0;
        for (let i = 0; i < l.length; i++) {
            if (l[i] === '"') inQ = !inQ;
            else if (l[i] === ',' && !inQ) { row[headers[col++]] = val; val = ''; }
            else val += l[i];
        }
        row[headers[col]] = val;
        return row;
    });
}
const tenders = csvParse(tenderCsv);
const techs = csvParse(techCsv);

let sql = '-- SUPABASE SQL IMPORT SCRIPT\n\n';
sql += 'DELETE FROM lead_technical_reports;\nDELETE FROM leads;\nDELETE FROM technical_reports;\nDELETE FROM tenders;\n\n';

const defaultUser = '322a3d0c-77b8-492e-89bd-bb98ebacf286'; 

let itemMap = {};
tenders.forEach(row => {
    const recId = row['Record ID'];
    if (!recId) return;
    const isLead = row['Tender No.'] && row['Tender No.'].toLowerCase().includes('direct order');
    const id = crypto.randomUUID();
    itemMap[recId] = { id, type: isLead ? 'lead' : 'tender' };

    const title = row['Tender Name'] || ('Item ' + recId);
    const org = row['Customer / Organization'] || 'Unknown';
    const stg = (row['Bid Status'] || 'draft').toLowerCase();
    const cper = (row['Contract start Date'] || '') + (row[' Contract End date'] ? ' to ' + row[' Contract End date'] : '');
    
    const techRow = techs.find(tr => tr['Record ID'] === recId);
    const bwStr = techRow ? techRow['Bandwidth (Mbps)'] : null;
    const bw = bwStr ? (parseFloat(bwStr.replace(/[^0-9.]/g, '')) || 'NULL') : 'NULL';

    if (isLead) {
        sql += `INSERT INTO leads (id, title, org_name, stage, contract_period, service_type, bandwidth_mbps, created_by) VALUES (${esc(id)}, ${esc(title)}, ${esc(org)}, ${esc(stg)}, ${esc(cper)}, ${esc(row['Opportunity Type'])}, ${bw}, ${esc(defaultUser)});\n`;
    } else {
        const val = parseFloat(row['Tender Value']) || 0;
        const reqs = {
            lead_source: row['Lead Source'],
            customer_category: row['Customer Category'],
            tender_portal: row['Tender Portal'],
            e_pbg_amount: row['E-PBG Amount'],
            tender_fee: row['Tender Fee'],
            maf_required: row['MAF Required'],
            oem_auth_required: row['OEM Authorization Required'],
            remarks: row['Remarks']
        };
        sql += `INSERT INTO tenders (id, title, bid_number, customer, org_name, stage, value, est_bid_value, bid_init_date, pre_bid_datetime, bid_end_datetime, contract_period, service_type, bandwidth_mbps, requirements, created_by) VALUES (${esc(id)}, ${esc(title)}, ${esc(row['Tender No.'])}, ${esc(org)}, ${esc(org)}, ${esc(stg)}, ${val}, ${val}, ${parseDate(row['Publish Date'])}, ${parseDate(row['Pre-Bid Date'])}, ${parseDate(row['Bid Submission Date'])}, ${esc(cper)}, ${esc(row['Opportunity Type'])}, ${bw}, ${escJSON(reqs)}, ${esc(defaultUser)});\n`;
    }
});

sql += '\n';

techs.forEach(row => {
    const recId = row['Record ID'];
    if (!recId) return;
    const mapped = itemMap[recId];
    if (!mapped) return;

    const id = crypto.randomUUID();
    const surveyNotes = {
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
    };

    if (mapped.type === 'lead') {
        sql += `INSERT INTO lead_technical_reports (id, lead_id, submitted_by, feasibility_status, survey_date, nearest_pop_dist, service_provider, survey_notes) VALUES (${esc(id)}, ${esc(mapped.id)}, ${esc(defaultUser)}, ${esc((row['Feasibility Status'] || 'pending').toLowerCase())}, ${parseDate(row['Site Survey Date'])}, ${parseFloat(row['Approx. Distance (KM)']) || 'NULL'}, ${esc(row['Primary Provider'])}, ${escJSON(surveyNotes)});\n`;
    } else {
        sql += `INSERT INTO technical_reports (id, tender_id, submitted_by, feasibility_status, survey_date, nearest_pop_dist, service_provider, survey_notes) VALUES (${esc(id)}, ${esc(mapped.id)}, ${esc(defaultUser)}, ${esc((row['Feasibility Status'] || 'pending').toLowerCase())}, ${parseDate(row['Site Survey Date'])}, ${parseFloat(row['Approx. Distance (KM)']) || 'NULL'}, ${esc(row['Primary Provider'])}, ${escJSON(surveyNotes)});\n`;
    }
});

fs.writeFileSync('manual_insert_queries.sql', sql);
console.log('Generated manual_insert_queries.sql');
