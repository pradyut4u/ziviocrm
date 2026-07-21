import { randomUUID, pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const DB_FILE = join(root, 'data', 'db.json');
const hashPwd = (p, s) => pbkdf2Sync(p, s, 100000, 64, 'sha256').toString('hex');

function mkUser(name, email, role, dept) {
  const salt = randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  return { id: randomUUID(), name, email, password_hash: hashPwd('demo123', salt), salt, role, department: dept, status: 'active', created_at: now, updated_at: now };
}

const now = new Date();
const dt = d => new Date(now - d * 86400000).toISOString();

const users = [
  mkUser('Prateek Shukla', 'admin@tenderops.com', 'admin', 'Administration'),
  mkUser('Rakhi', 'tender@tenderops.com', 'tender', 'Tender Department'),
  mkUser('Abhishek Gill', 'tech@tenderops.com', 'tech', 'Technical Department'),
  mkUser('Bharat', 'accounts@tenderops.com', 'acct', 'Finance & Accounts'),
  mkUser('Vikram Singh', 'mgmt@tenderops.com', 'mgmt', 'Management'),
  mkUser('Sales Lead', 'lead@tenderops.com', 'lead', 'Sales Department'),
];

const t1 = randomUUID(), t2 = randomUUID(), t3 = randomUUID(), t4 = randomUUID();

const tenders = [
  { id: t1, title: 'BSNL 1Gbps ILL — Mumbai HQ', bid_number: 'BSNL/2024/ILL/0042', customer: 'BSNL Mumbai', description: 'Supply and commissioning of 1 Gbps ILL at BSNL Mumbai HQ. Redundant path, SLA 99.5%, 24x7 NOC.', due_date: '2026-07-28', value: 1200000, priority: 'high', stage: 'uploaded', created_by: users[1].id, assigned_to: null, requirements: { scope: '1 Gbps Internet Leased Line at BSNL HQ, Mumbai. Redundant fiber path required. 99.5% uptime SLA mandatory.', technical_specs: 'Fiber optic, BGP routing, /29 IPv4 block, dual-router setup, 24x7 NOC with 4-hour MTR.', eligibility: 'Valid ISP license (Category A), min 3 years ISP experience, annual turnover ₹10 Cr+, CMMI certified preferred.', submission_info: 'Online submission via GeM portal. Physical copy of EMD to BSNL Mumbai Circle Office by 5PM.', deadline: '2026-07-28' }, admin_override: false, created_at: dt(3), updated_at: dt(1) },
  { id: t2, title: 'DMRC MPLS WAN — 25 Stations', bid_number: 'DMRC/2024/WAN/011', customer: 'Delhi Metro Rail Corporation', description: 'MPLS WAN connectivity for 25 metro stations across Delhi NCR with centralized management at Rajiv Chowk.', due_date: '2026-07-31', value: 4500000, priority: 'high', stage: 'technical_complete', created_by: users[1].id, assigned_to: users[2].id, requirements: { scope: 'MPLS WAN for 25 stations. Hub: Rajiv Chowk. Spokes: remaining 24 stations. Centralized management.', technical_specs: '10 Mbps per station, MPLS L3 VPN, QoS for CCTV (DSCP EF), BGP+OSPF, redundant links at hub.', eligibility: 'NLD + ISP license mandatory. CMMI L3+ certification. 5+ years enterprise WAN experience.', submission_info: 'Physical submission at DMRC HQ, Barakhamba Road, New Delhi. DD of ₹5 lakh as EMD.', deadline: '2026-07-31' }, admin_override: false, created_at: dt(7), updated_at: dt(2) },
  { id: t3, title: 'AIIMS Delhi P2P Link — Emergency Block', bid_number: 'AIIMS/2024/P2P/003', customer: 'AIIMS New Delhi', description: 'Point-to-point dark fiber link between AIIMS Main campus and Emergency Block (approx 2km).', due_date: '2026-08-10', value: 850000, priority: 'medium', stage: 'bid_final', created_by: users[1].id, assigned_to: users[2].id, requirements: { scope: '10G P2P dark fiber, 2km, AIIMS Main to Emergency Block. OTDR certification on delivery.', technical_specs: '10G capacity, OTU framing, SFP+ optics, armored underground cable, OTDR certification.', eligibility: 'ISP license, OFC laying experience, prior work at government hospitals preferred.', submission_info: 'GeM portal submission. Physical copy to AIIMS Procurement Section by EOD.', deadline: '2026-08-10' }, admin_override: false, created_at: dt(10), updated_at: dt(1) },
  { id: t4, title: 'NIC Cloud Connectivity — 50 Mbps', bid_number: 'NIC/2024/CLOUD/007', customer: 'National Informatics Centre', description: 'Managed cloud connectivity (50 Mbps) for NIC data center to major public cloud regions.', due_date: '2026-08-20', value: 600000, priority: 'low', stage: 'draft', created_by: users[1].id, assigned_to: null, requirements: null, admin_override: false, created_at: dt(1), updated_at: dt(0) },
];

const reports = [
  { id: randomUUID(), tender_id: t2, submitted_by: users[2].id, feasibility: 'feasible', summary: 'MPLS WAN is fully feasible across all 25 DMRC stations. All sites have PoP within 2km. Recommended dual-homed MPLS L3 VPN with QoS configured for CCTV priority.', technical_notes: 'Hub: Rajiv Chowk (existing PoP). 24 spokes via MPLS L3 VPN. BGP upstream. OSPF internal. QoS: CCTV DSCP EF, Management CS5, Data BE. CPE: Cisco ISR 4321 at hub, Cisco 1111 at spokes.', recommendation: 'Proceed with bid. Estimated rollout: 90 days post-PO. Minor risk: civil permission delay at 3 underground stations (Kashmere Gate, Chawri Bazar, Chandi Chowk). Price accordingly.', attachment_name: null, attachment_url: null, created_at: dt(3), updated_at: dt(3) },
];

const bid_docs = [
  { id: randomUUID(), tender_id: t3, created_by: users[1].id, version: 1, status: 'final', title: 'Technical & Financial Bid — AIIMS P2P Dark Fiber', scope: 'Supply, installation and commissioning of 10G P2P dark fiber link between AIIMS Main campus and Emergency Block. Includes OTDR testing, route documentation, and 1-year warranty on all hardware.', price: '825000', validity: '90 days from submission date', notes: 'All OFC hardware is BIS certified and Make-in-India compliant. Civil works include trenchless HDD drilling at 3 road crossings. Installation within 30 days of PO. SLA 99.9%.', attachment_name: null, attachment_url: null, created_at: dt(2), updated_at: dt(1) },
];

const db = {
  users, sessions: [],
  tenders, tender_documents: [],
  technical_reports: reports,
  bid_documents: bid_docs,
  invoices: [], notifications: [], audit_logs: []
};

await mkdir(join(root, 'data'), { recursive: true });
await writeFile(DB_FILE, JSON.stringify(db, null, 2));

console.log('\n✅ Seed complete!\n');
console.log('Demo Users (password: demo123):');
console.log('─'.repeat(52));
users.forEach(u => console.log(`  ${u.role.padEnd(12)} ${u.email}`));
console.log('\nDemo Tenders:');
console.log('─'.repeat(52));
tenders.forEach(t => console.log(`  [${t.stage.padEnd(20)}] ${t.title}`));
console.log('\nRun: node server.mjs\n');
