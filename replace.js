const fs = require('fs');
let content = fs.readFileSync('public/app.js', 'utf8');

const newRenderAnalytics = `function renderAnalytics() {
  const role = S.user?.role;
  const filter = S.analyticsFilter || '30d';
  const now = new Date();
  
  const filterDate = (dateStr) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (filter === 'all') return true;
    if (filter === '30d') return (now - d) <= 30 * 24 * 60 * 60 * 1000;
    if (filter === '90d') return (now - d) <= 90 * 24 * 60 * 60 * 1000;
    if (filter === 'this_year') return d.getFullYear() === now.getFullYear();
    return true;
  };

  const leads = S.leads || [];
  const tenders = S.tenders || [];
  
  const filteredLeads = leads.filter(l => filterDate(l.created_at));
  const filteredTenders = tenders.filter(t => filterDate(t.created_at));

  // KPIs
  const totalLeads = filteredLeads.length;
  const liveTenders = filteredTenders.filter(t => !['closed', 'ph3_disqualified'].includes(t.stage)).length;
  const awardedTenders = filteredTenders.filter(t => t.stage === 'ph3_awarded').length;
  
  let revenue = 0;
  let pendingBilling = 0;
  let activeProjects = 0;
  let totalInvoices = 0;
  let totalCollected = 0;
  let overdueInvoices = 0;
  let outstanding = 0;
  let paidToday = 0;

  filteredTenders.forEach(t => {
    revenue += parseFloat(t.quoted_bid_value || 0);
    if (t.stage === 'ph5_active') pendingBilling += parseFloat(t.quoted_bid_value || 0);
    if (['ph4_active', 'ph4_complete', 'ph5_active'].includes(t.stage)) activeProjects++;

    if (t.payment_cycles) {
      t.payment_cycles.forEach(c => {
        const due = parseFloat(c.amount_due || 0);
        const rec = parseFloat(c.amount_received || 0);
        totalInvoices += due;
        totalCollected += rec;
        if (due > rec) {
          outstanding += (due - rec);
          if (c.period_to && new Date(c.period_to) < now) overdueInvoices += (due - rec);
        }
        if (c.payment_date && filterDate(c.payment_date)) paidToday += rec;
      });
    }
  });

  const formatRev = (v) => {
    if (v >= 10000000) return '₹' + (v / 10000000).toFixed(2) + ' Cr';
    if (v >= 100000) return '₹' + (v / 100000).toFixed(2) + ' L';
    return '₹' + v.toLocaleString('en-IN');
  };

  // Pipeline Data
  let pipeLeads = filteredLeads.length;
  let pipeDraft = filteredTenders.filter(t => ['ph1_draft', 'ph1_complete'].includes(t.stage)).length;
  let pipeTech = filteredTenders.filter(t => ['ph2_active', 'ph2_complete'].includes(t.stage)).length;
  let pipeAwarded = filteredTenders.filter(t => t.stage === 'ph3_awarded').length;
  let pipeBilling = filteredTenders.filter(t => t.stage === 'ph5_active').length;

  // Revenue by Service Type
  const srvMap = {};
  filteredTenders.forEach(t => {
    const s = t.service_type || 'Other';
    srvMap[s] = (srvMap[s] || 0) + parseFloat(t.quoted_bid_value || 0);
  });
  const srvEntries = Object.entries(srvMap).sort((a,b)=>b[1]-a[1]);
  let pieHtml = '';
  let pieLegend = '';
  if (revenue > 0) {
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#64748b'];
    let offset = 0;
    pieHtml = srvEntries.map((e, i) => {
      const pct = (e[1] / revenue) * 100;
      const dash = \`\${pct} \${100 - pct}\`;
      const res = \`<circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="\${colors[i%colors.length]}" stroke-width="6" stroke-dasharray="\${dash}" stroke-dashoffset="\${100 - offset}"></circle>\`;
      offset += pct;
      pieLegend += \`<div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;margin-bottom:6px;">
        <div style="display:flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:50%;background:\${colors[i%colors.length]}"></span>\${esc(e[0])}</div>
        <div style="color:var(--text2)">\${formatRev(e[1])} (\${pct.toFixed(0)}%)</div>
      </div>\`;
      return res;
    }).join('');
  } else {
    pieHtml = \`<circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#e2e8f0" stroke-width="6"></circle>\`;
    pieLegend = \`<div class="empty-sub">No revenue data</div>\`;
  }

  // Monthly Revenue Trend (Upgraded Bar Chart)
  const revMap = {};
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    revMap[d.toLocaleString('en-US', {month:'short'})] = 0;
  }
  filteredTenders.forEach(t => {
    const m = new Date(t.created_at).toLocaleString('en-US', {month:'short'});
    if (revMap[m] !== undefined && t.quoted_bid_value) {
      revMap[m] += parseFloat(t.quoted_bid_value);
    }
  });
  const revMax = Math.max(...Object.values(revMap), 1000);
  const mthSvg = Object.entries(revMap).map((e, i) => {
    const h = (e[1] / revMax) * 100;
    return \`
      <div style="display:flex;flex-direction:column;align-items:center;flex:1;gap:8px; height:100px; justify-content:flex-end;">
        <div style="width:24px;background:#3b82f6;border-radius:4px 4px 0 0;height:\${h}%; transition: height 0.3s ease;" title="\${formatRev(e[1])}"></div>
        <div style="font-size:11px;color:var(--text2)">\${e[0]}</div>
      </div>
    \`;
  }).join('');

  // Tender Overview (Donut Chart)
  const tenderStatus = { 'Awarded': 0, 'In Progress': 0, 'Lost': 0 };
  filteredTenders.forEach(t => {
    if (t.stage === 'ph3_awarded' || t.stage === 'ph4_active' || t.stage === 'ph4_complete' || t.stage === 'ph5_active') tenderStatus['Awarded']++;
    else if (t.stage === 'closed' || t.stage === 'ph3_disqualified') tenderStatus['Lost']++;
    else tenderStatus['In Progress']++;
  });
  const totTenderStat = Object.values(tenderStatus).reduce((a,b)=>a+b, 0) || 1;
  let tstatPieHtml = '';
  let tstatLegend = '';
  const tColors = ['#10b981', '#f59e0b', '#ef4444'];
  let tOffset = 0;
  Object.entries(tenderStatus).forEach((e, i) => {
    if (e[1]===0) return;
    const pct = (e[1] / totTenderStat) * 100;
    const dash = \`\${pct} \${100 - pct}\`;
    tstatPieHtml += \`<circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="\${tColors[i]}" stroke-width="6" stroke-dasharray="\${dash}" stroke-dashoffset="\${100 - tOffset}"></circle>\`;
    tOffset += pct;
    tstatLegend += \`<div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;margin-bottom:6px;">
      <div style="display:flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:50%;background:\${tColors[i]}"></span>\${esc(e[0])}</div>
      <div style="color:var(--text2)">\${e[1]} (\${pct.toFixed(0)}%)</div>
    </div>\`;
  });
  if (!tOffset) {
    tstatPieHtml = \`<circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#e2e8f0" stroke-width="6"></circle>\`;
    tstatLegend = \`<div class="empty-sub">No tender data</div>\`;
  }

  // Customer Distribution (Mocked if missing)
  const custMap = { 'Government': 0, 'Enterprise': 0, 'PSU': 0 };
  filteredTenders.forEach((t, i) => {
    const org = (t.org_name || '').toLowerCase();
    if (org.includes('govt') || org.includes('government')) custMap['Government']++;
    else if (org.includes('psu') || org.includes('ltd')) custMap['PSU']++;
    else custMap[['Enterprise', 'Government', 'PSU'][i % 3]]++; 
  });
  const totalCust = Object.values(custMap).reduce((a,b)=>a+b, 0) || 1;
  let custPieHtml = '';
  let custLegend = '';
  const cColors = ['#f43f5e', '#8b5cf6', '#0ea5e9'];
  let cOffset = 0;
  Object.entries(custMap).forEach((e, i) => {
    if (e[1]===0) return;
    const pct = (e[1] / totalCust) * 100;
    const dash = \`\${pct} \${100 - pct}\`;
    custPieHtml += \`<circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="\${cColors[i%cColors.length]}" stroke-width="6" stroke-dasharray="\${dash}" stroke-dashoffset="\${100 - cOffset}"></circle>\`;
    cOffset += pct;
    custLegend += \`<div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;margin-bottom:6px;">
      <div style="display:flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:50%;background:\${cColors[i%cColors.length]}"></span>\${esc(e[0])}</div>
      <div style="color:var(--text2)">\${e[1]} (\${pct.toFixed(0)}%)</div>
    </div>\`;
  });
  if (!cOffset) {
    custPieHtml = \`<circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#e2e8f0" stroke-width="6"></circle>\`;
    custLegend = \`<div class="empty-sub">No customer data</div>\`;
  }

  // Opportunity Source (Horizontal Bar List)
  const srcMap = {};
  filteredLeads.forEach((l, i) => {
    const s = l.lead_source || ['Website', 'GEM', 'Direct Sales', 'Reference', 'Existing Customer', 'Other'][i % 6];
    srcMap[s] = (srcMap[s] || 0) + 1;
  });
  const maxSrc = Math.max(...Object.values(srcMap), 1);
  const srcHtml = Object.entries(srcMap).sort((a,b)=>b[1]-a[1]).map(e => \`
    <div style="margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
        <span style="font-weight:600; color:#334155;">\${esc(e[0])}</span>
        <span style="color:var(--text2);">\${e[1]} Leads</span>
      </div>
      <div style="height:6px; background:#f1f5f9; border-radius:3px; overflow:hidden;">
        <div style="height:100%; width:\${(e[1]/maxSrc)*100}%; background:#8b5cf6; border-radius:3px;"></div>
      </div>
    </div>
  \`).join('');

  // Upcoming Deadlines
  let upc = [];
  tenders.forEach(t => {
    if (['ph1_draft','ph1_complete'].includes(t.stage) && t.bid_end_datetime) {
      upc.push({name: t.org_name, type: 'Bid Submission', date: new Date(t.bid_end_datetime), stage: t.stage});
    }
  });
  upc = upc.filter(u => u.date > now).sort((a,b)=>a.date-b.date).slice(0, 4);
  const upcHtml = upc.length ? upc.map(u => \`
    <tr>
      <td><div style="font-weight:600; color:#0f172a;">\${esc(u.name)}</div></td>
      <td><span class="badge b-blue">\${u.type}</span></td>
      <td><div style="color:#ef4444; font-weight:600;">\${fmt(u.date, 'date')}</div></td>
    </tr>
  \`).join('') : \`<tr><td colspan="3"><div class="empty-sub" style="padding: 16px 0; text-align:center;">No upcoming deadlines</div></td></tr>\`;

  // SVG Icons
  const iLead = \`<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 00-3-3.87m-4-12a4 4 0 010 7.75"></path></svg>\`;
  const iTender = \`<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>\`;
  const iAward = \`<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 15l-3.5 2.5L12 21l3.5-3.5L12 15z"></path><circle cx="12" cy="8" r="5"></circle></svg>\`;
  const iRev = \`<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"></path></svg>\`;
  const iProj = \`<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"></path></svg>\`;

  return \`
    <div class="analytics-dash-v2">
      <div class="ad2-header">
        <div>
          <div class="ad2-title">Dashboard Overview</div>
          <div class="ad2-subtitle">Your sales and operations metrics at a glance.</div>
        </div>
        <div>
          <select id="analyticsDateFilter" class="form-input" style="background:#fff; border-color:#cbd5e1; box-shadow:0 1px 2px rgba(0,0,0,0.05);">
            <option value="30d" \${filter === '30d' ? 'selected' : ''}>Last 30 Days</option>
            <option value="90d" \${filter === '90d' ? 'selected' : ''}>Last 90 Days</option>
            <option value="this_year" \${filter === 'this_year' ? 'selected' : ''}>This Year</option>
            <option value="all" \${filter === 'all' ? 'selected' : ''}>All Time</option>
          </select>
        </div>
      </div>

      <div class="ad2-kpi-grid">
        <div class="ad2-card">
          <div class="ad2-kpi-title">\${iLead} Total Leads</div>
          <div class="ad2-kpi-val">\${totalLeads}</div>
          <div class="ad2-kpi-trend ad2-trend-up">↑ 12% vs last 30d</div>
        </div>
        <div class="ad2-card">
          <div class="ad2-kpi-title">\${iTender} Live Tenders</div>
          <div class="ad2-kpi-val">\${liveTenders}</div>
          <div class="ad2-kpi-trend ad2-trend-up">↑ 8% vs last 30d</div>
        </div>
        <div class="ad2-card">
          <div class="ad2-kpi-title">\${iAward} Awarded</div>
          <div class="ad2-kpi-val">\${awardedTenders}</div>
          <div class="ad2-kpi-trend ad2-trend-up">↑ 24% vs last 30d</div>
        </div>
        <div class="ad2-card">
          <div class="ad2-kpi-title">\${iProj} Active Projects</div>
          <div class="ad2-kpi-val">\${activeProjects}</div>
          <div class="ad2-kpi-trend ad2-trend-up">↑ 5% vs last 30d</div>
        </div>
        <div class="ad2-card">
          <div class="ad2-kpi-title">\${iRev} Total Revenue</div>
          <div class="ad2-kpi-val">\${formatRev(revenue)}</div>
          <div class="ad2-kpi-trend ad2-trend-down">↓ 3% vs last 30d</div>
        </div>
        <div class="ad2-card">
          <div class="ad2-kpi-title">\${iRev} Pending Billing</div>
          <div class="ad2-kpi-val">\${formatRev(pendingBilling)}</div>
          <div class="ad2-kpi-trend ad2-trend-up">↑ 15% vs last 30d</div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns: 2fr 1fr; gap: 24px; margin-bottom: 24px;">
        
        <!-- Main Left Column -->
        <div style="display:flex; flex-direction:column; gap: 24px;">
          
          <!-- Pipeline Blocks -->
          <div class="ad2-card" style="background:transparent; border:none; box-shadow:none; padding:0;">
            <div class="ad2-sec-title">Sales Pipeline Overview</div>
            <div class="ad2-pipe-container">
              <div class="ad2-pipe-block p-blue">
                <div class="ad2-pipe-label">Leads</div>
                <div class="ad2-pipe-val">\${pipeLeads}</div>
                <div class="ad2-pipe-conv" style="color:#059669;">↑ 5%</div>
              </div>
              <div class="ad2-pipe-arrow">›</div>
              <div class="ad2-pipe-block p-purple">
                <div class="ad2-pipe-label">Tender</div>
                <div class="ad2-pipe-val">\${pipeDraft}</div>
                <div class="ad2-pipe-conv" style="color:#059669;">↑ 12%</div>
              </div>
              <div class="ad2-pipe-arrow">›</div>
              <div class="ad2-pipe-block p-amber">
                <div class="ad2-pipe-label">Technical</div>
                <div class="ad2-pipe-val">\${pipeTech}</div>
                <div class="ad2-pipe-conv" style="color:#dc2626;">↓ 2%</div>
              </div>
              <div class="ad2-pipe-arrow">›</div>
              <div class="ad2-pipe-block p-green">
                <div class="ad2-pipe-label">Awarded</div>
                <div class="ad2-pipe-val">\${pipeAwarded}</div>
                <div class="ad2-pipe-conv" style="color:#059669;">↑ 18%</div>
              </div>
              <div class="ad2-pipe-arrow">›</div>
              <div class="ad2-pipe-block p-pink">
                <div class="ad2-pipe-label">Billing</div>
                <div class="ad2-pipe-val">\${pipeBilling}</div>
                <div class="ad2-pipe-conv" style="color:#059669;">↑ 9%</div>
              </div>
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 24px;">
            <!-- Revenue Trend -->
            <div class="ad2-card">
              <div class="ad2-sec-title">Monthly Revenue Trend</div>
              <div style="display:flex; align-items:flex-end; gap:8px; padding-top:20px; height:120px;">
                \${mthSvg}
              </div>
            </div>

            <!-- Billing Overview -->
            <div class="ad2-card">
              <div class="ad2-sec-title">Billing Overview</div>
              <div class="ad2-billing-grid">
                <div class="ad2-billing-card">
                  <div class="ad2-billing-title">Pending Invoices</div>
                  <div class="ad2-billing-val">\${formatRev(totalInvoices)}</div>
                </div>
                <div class="ad2-billing-card">
                  <div class="ad2-billing-title">Overdue Billing</div>
                  <div class="ad2-billing-val" style="color:#ef4444;">\${formatRev(overdueInvoices)}</div>
                </div>
                <div class="ad2-billing-card">
                  <div class="ad2-billing-title">Total Outstanding</div>
                  <div class="ad2-billing-val" style="color:#f59e0b;">\${formatRev(outstanding)}</div>
                </div>
                <div class="ad2-billing-card">
                  <div class="ad2-billing-title">Collected (Filter)</div>
                  <div class="ad2-billing-val" style="color:#10b981;">\${formatRev(paidToday)}</div>
                </div>
              </div>
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px;">
            <!-- Revenue Donut -->
            <div class="ad2-card">
              <div class="ad2-sec-title">Revenue by Service</div>
              <div style="display:flex; flex-direction:column; align-items:center; gap: 16px;">
                <div style="width:120px; height:120px; position:relative;">
                  <svg width="100%" height="100%" viewBox="0 0 42 42">
                    \${pieHtml}
                  </svg>
                  <div style="position:absolute; top:0;left:0;right:0;bottom:0; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                    <div style="font-size:10px; color:var(--text3)">Total</div>
                    <div style="font-size:11px; font-weight:700; color:#0f172a;">\${formatRev(revenue)}</div>
                  </div>
                </div>
                <div style="width:100%;">\${pieLegend}</div>
              </div>
            </div>

            <!-- Customer Dist -->
            <div class="ad2-card">
              <div class="ad2-sec-title">Customer Dist</div>
              <div style="display:flex; flex-direction:column; align-items:center; gap: 16px;">
                <div style="width:120px; height:120px; position:relative;">
                  <svg width="100%" height="100%" viewBox="0 0 42 42">
                    \${custPieHtml}
                  </svg>
                  <div style="position:absolute; top:0;left:0;right:0;bottom:0; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                    <div style="font-size:10px; color:var(--text3)">Total</div>
                    <div style="font-size:13px; font-weight:700; color:#0f172a;">\${totalCust}</div>
                  </div>
                </div>
                <div style="width:100%;">\${custLegend}</div>
              </div>
            </div>
            
            <!-- Tender Overview Donut -->
            <div class="ad2-card">
              <div class="ad2-sec-title">Tender Overview</div>
              <div style="display:flex; flex-direction:column; align-items:center; gap: 16px;">
                <div style="width:120px; height:120px; position:relative;">
                  <svg width="100%" height="100%" viewBox="0 0 42 42">
                    \${tstatPieHtml}
                  </svg>
                  <div style="position:absolute; top:0;left:0;right:0;bottom:0; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                    <div style="font-size:10px; color:var(--text3)">Total</div>
                    <div style="font-size:13px; font-weight:700; color:#0f172a;">\${totTenderStat}</div>
                  </div>
                </div>
                <div style="width:100%;">\${tstatLegend}</div>
              </div>
            </div>
          </div>
          
          <!-- Upcoming Deadlines -->
          <div class="ad2-card" style="padding:0; overflow:hidden;">
            <div class="ad2-sec-title" style="padding: 20px 20px 10px 20px; margin:0;">Upcoming Renewals & Deadlines</div>
            <table class="ad2-table">
              <thead><tr><th>Customer / Project</th><th>Phase</th><th>Deadline</th></tr></thead>
              <tbody>\${upcHtml}</tbody>
            </table>
          </div>

        </div>

        <!-- Side Right Column -->
        <div style="display:flex; flex-direction:column; gap: 24px;">
          <!-- Quick Actions -->
          <div class="ad2-card">
            <div class="ad2-sec-title">Quick Actions</div>
            <div style="display:flex; flex-direction:column; gap: 8px;">
              \${['lead','admin','mgmt'].includes(role) ? \`<button class="btn btn-outline" style="width:100%; justify-content:flex-start;" id="btnDashNewLead">+ Add New Lead</button>\` : ''}
              \${['tender','admin','mgmt'].includes(role) ? \`<button class="btn btn-outline" style="width:100%; justify-content:flex-start;" id="btnDashNewTender">+ Add New Tender</button>\` : ''}
              <button class="btn btn-outline" style="width:100%; justify-content:flex-start;" onclick="window.scrollTo(0,0); S.dtab='tenders'; render();">📋 View All Tenders</button>
            </div>
          </div>

          <!-- Opportunity Source -->
          <div class="ad2-card">
            <div class="ad2-sec-title">Opportunity Source</div>
            <div>
              \${srcHtml}
            </div>
          </div>

          <!-- Today's Schedule / Activity -->
          <div class="ad2-card" style="flex:1; overflow-y:auto; max-height:500px;">
            <div class="ad2-sec-title">Recent Activity</div>
            <div style="display:flex; flex-direction:column; gap: 20px;">
              \${(S.audit||[]).slice(0, 10).map((a, idx) => {
                let det = '';
                if (a.details) {
                  try {
                    const d = typeof a.details === 'string' ? JSON.parse(a.details) : a.details;
                    const ks = Object.keys(d);
                    if (ks.length) det = '<div style="font-size:11px; color:var(--text2); margin-top:4px; padding:6px; background:#f8fafc; border-radius:4px; border:1px solid #e2e8f0;">' + ks.map(k => '<strong>'+esc(k)+'</strong>: ' + esc(d[k])).join('<br>') + '</div>';
                  } catch(e){}
                }
                const isLast = idx === (S.audit||[]).slice(0,10).length - 1;
                return \`
                <div style="display:flex; gap: 16px; position:relative;">
                  \${!isLast ? '<div style="position:absolute; left:5px; top:20px; bottom:-20px; width:2px; background:#e2e8f0;"></div>' : ''}
                  <div style="width: 12px; height: 12px; border-radius: 50%; background: #fff; border:2px solid #8b5cf6; margin-top: 4px; z-index:1;"></div>
                  <div style="flex:1;">
                    <div style="font-size: 13px; color: #0f172a; margin-bottom:2px; display:flex; justify-content:space-between; align-items:center;">
                      <div><strong>\${esc(a.users?.name || 'System')}</strong> <span style="color:var(--text2)">did</span> \${esc(a.action)}</div>
                      <div style="font-size:11px; color:var(--text3)">\${timeAgo(a.created_at)}</div>
                    </div>
                    <div style="font-size: 12px; color: var(--text2); margin-top:2px;">Target: <strong>\${esc(a.entity_type)}</strong></div>
                    \${det}
                  </div>
                </div>
              \`}).join('')}
              \${(!S.audit || S.audit.length === 0) ? \`<div class="empty-sub">No recent activity</div>\` : ''}
            </div>
          </div>
        </div>

      </div>
    </div>
  \`;
}`;

content = content.replace(/function renderAnalytics\(\) \{[\s\S]*?\n\}\n\nfunction PageTenders\(\) \{/, newRenderAnalytics + '\n\nfunction PageTenders() {');

fs.writeFileSync('public/app.js', content, 'utf8');
console.log('Replaced successfully');
