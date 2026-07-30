import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import xlsx from 'xlsx';
import { fileURLToPath } from 'node:url';

const __root = fileURLToPath(new URL('..', import.meta.url));
const DB_FILE = join(__root, 'data', 'db.json');

async function main() {
    try {
        console.log("Reading DB...");
        const dbData = await readFile(DB_FILE, 'utf8');
        const db = JSON.parse(dbData);
        if (!db.leads) db.leads = [];

        console.log("Reading CSV...");
        const wb = xlsx.readFile('d:/tender ops/DAIC Official sheet (3).csv');
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const data = xlsx.utils.sheet_to_json(sheet, { defval: null });

        // Get a default user for created_by
        const defaultUser = db.users && db.users.length > 0 ? db.users[0].id : null;
        let count = 0;

        for (const row of data) {
            const sn = row['S.No'];
            if (!sn) continue; // Skip empty rows

            const eventName = row['EVENT NAME'];
            if (!eventName) continue;

            const company = row['Company Name'] || '';
            const customer = row['Customer Name'] || '';
            const mobile = row['Mobile No'] || '';
            const email = row['Email address'] || '';
            
            const baseValRaw = row['Base Value'] ? row['Base Value'].toString().replace(/[^0-9.]/g, '') : '0';
            const gstRaw = row['GST'] ? row['GST'].toString().replace(/[^0-9.]/g, '') : '0';
            const totalRaw = row['Total'] ? row['Total'].toString().replace(/[^0-9.]/g, '') : '0';

            const baseVal = parseFloat(baseValRaw) || 0;
            const gst = parseFloat(gstRaw) || 0;
            const total = parseFloat(totalRaw) || 0;

            // Extract bandwidth if possible
            let mbpsRaw = row['Mbps Qty'] ? row['Mbps Qty'].toString().replace(/[^0-9.]/g, '') : null;
            let mbps = mbpsRaw ? parseFloat(mbpsRaw) : null;

            const id = randomUUID();
            const lead = {
                id,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                title: eventName,
                org_name: company,
                customer_name: customer,
                customer_phone: mobile,
                customer_email: email,
                est_bid_value: baseVal,
                total_bid_value: total,
                gst: (gst / baseVal * 100) || 18,
                bandwidth_mbps: mbps,
                stage: 'ph5_active', // Billing Phase
                created_by: defaultUser,
                description: row['Description'] || '',
                remarks: row['Remarks'] || '',
                owner_name: row['ACIPL person'] || ''
            };

            db.leads.push(lead);
            
            // Add custom Phase 5 / invoice entry to ensure it appears in Billing properly
            if (!db.invoices) db.invoices = [];
            const invId = randomUUID();
            db.invoices.push({
                id: invId,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                lead_id: id,
                tender_id: null,
                invoice_number: row['Invoice no'] || `INV-${sn}`,
                base_price: baseVal,
                gst_pct: lead.gst,
                invoice_value: total,
                created_by: defaultUser
            });

            count++;
        }

        await writeFile(DB_FILE, JSON.stringify(db, null, 2));
        console.log(`Successfully imported ${count} leads and moved them to billing phase!`);

    } catch (e) {
        console.error("Error:", e);
    }
}

main();
