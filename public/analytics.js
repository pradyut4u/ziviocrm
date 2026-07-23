const PALETTE = ['#3b82f6', '#5651f6', '#f59e0b', '#10b981', '#ec4899', '#06B6D4', '#ef4444'];

function formatRev(n) {
  n = Number(n) || 0;
  if (n >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr';
  if (n >= 1e5) return '₹' + (n / 1e5).toFixed(2) + ' L';
  if (n >= 1e3) return '₹' + (n / 1e3).toFixed(1) + ' K';
  return '₹' + n.toFixed(0);
}

function trendChip(changePct) {
  if (changePct === undefined || changePct === null || Number.isNaN(changePct)) {
    return `<span class="ad2-kpi-trend ad2-trend-flat">—</span>`;
  }
  const up = changePct >= 0;
  const arrow = up ? '↑' : '↓';
  return `<span class="ad2-kpi-trend ${up ? 'ad2-trend-up' : 'ad2-trend-down'}">${arrow} ${Math.abs(changePct).toFixed(0)}%</span>`;
}

/* ---------------- KPI icons (inline, no external deps) ---------------- */
const ICONS = {
  leads: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
  tenders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>',
  awarded: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.5 13.5L17 22l-5-3-5 3 1.5-8.5"/></svg>',
  projects: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>',
  revenue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
  billing: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
  lead: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  invoice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>',
  customer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
};

function kpiCard({ label, value, changePct, iconKey, iconClass, isMoney }) {
  return `
    <div class="ad2-card ad2-kpi-card">
      <div class="ad2-kpi-top">
        <div class="ad2-kpi-icon ${iconClass}">${ICONS[iconKey] || ''}</div>
        ${trendChip(changePct)}
      </div>
      <div class="ad2-kpi-label">${esc(label)}</div>
      <div class="ad2-kpi-val">${isMoney ? formatRev(value) : (value ?? 0)}</div>
    </div>`;
}

/* ---------------- Donut chart ---------------- */
function donutChart(segments, opts = {}) {
  const total = segments.reduce((s, x) => s + (Number(x.value) || 0), 0);
  const r = 15.91549; // circumference = 100 on this radius, simplifies dasharray math
  let cumulative = 0;
  const arcs = segments.map((seg, i) => {
    const pct = total > 0 ? (seg.value / total) * 100 : 0;
    const color = seg.color || PALETTE[i % PALETTE.length];
    const dasharray = `${pct} ${100 - pct}`;
    const dashoffset = 100 - cumulative; // rotate(-90deg) on the svg handles the 12 o'clock start
    cumulative += pct;
    if (pct <= 0) return '';
    return `<circle cx="21" cy="21" r="${r}" fill="none" stroke="${color}" stroke-width="7"
              stroke-dasharray="${dasharray}" stroke-dashoffset="${dashoffset}" pathLength="100"></circle>`;
  }).join('');

  const svg = total > 0
    ? `<svg viewBox="0 0 42 42">${arcs}</svg>`
    : `<svg viewBox="0 0 42 42"><circle cx="21" cy="21" r="${r}" fill="none" stroke="var(--border)" stroke-width="7"></circle></svg>`;

  const legend = segments.map((seg, i) => {
    const pct = total > 0 ? ((seg.value / total) * 100).toFixed(0) : '0';
    const color = seg.color || PALETTE[i % PALETTE.length];
    return `
      <div class="ad2-legend-row">
        <span class="ad2-legend-dot" style="background:${color}"></span>
        <span class="ad2-legend-lbl">${esc(seg.label)}</span>
        <span class="ad2-legend-val">${opts.isMoney ? formatRev(seg.value) : seg.value}</span>
        <span class="ad2-legend-pct">(${pct}%)</span>
      </div>`;
  }).join('');

  return `
    <div class="ad2-donut-wrap">
      <div class="ad2-donut-svg-box">
        ${svg}
        <div class="ad2-donut-center">
          <div class="ad2-donut-center-lbl">Total</div>
          <div class="ad2-donut-center-val">${opts.isMoney ? formatRev(total) : total}</div>
        </div>
      </div>
      <div class="ad2-legend">${legend || `<div class="ad2-empty">No data yet</div>`}</div>
    </div>`;
}

/* ---------------- Trend line/area chart ---------------- */
function trendChart(points, { width = 560, height = 160 } = {}) {
  if (!points || points.length === 0) {
    return `<div class="ad2-chart-empty">No revenue data for this period</div>`;
  }
  const padL = 8, padR = 8, padT = 16, padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const max = Math.max(...points.map(p => p.value), 1);
  const step = points.length > 1 ? innerW / (points.length - 1) : 0;

  const coords = points.map((p, i) => {
    const x = padL + step * i;
    const y = padT + innerH - (p.value / max) * innerH;
    return { x, y, label: p.label, value: p.value };
  });

  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${padT + innerH} L ${coords[0].x.toFixed(1)} ${padT + innerH} Z`;

  const dots = coords.map(c => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3.5" fill="var(--purple)" stroke="var(--bg2)" stroke-width="2"/>`).join('');
  const labels = coords.map(c => `<text x="${c.x.toFixed(1)}" y="${height - 8}" font-size="10.5" fill="var(--text3)" text-anchor="middle">${esc(c.label)}</text>`).join('');
  const last = coords[coords.length - 1];

  return `
    <svg class="ad2-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="ad2TrendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--purple)" stop-opacity="0.22"/>
          <stop offset="100%" stop-color="var(--purple)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <line x1="${padL}" y1="${padT + innerH}" x2="${width - padR}" y2="${padT + innerH}" stroke="var(--border)" stroke-width="1"/>
      <path d="${areaPath}" fill="url(#ad2TrendFill)"/>
      <path d="${linePath}" fill="none" stroke="var(--purple)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
      ${labels}
      <text x="${last.x.toFixed(1)}" y="${Math.max(last.y - 10, 12)}" font-size="11" font-weight="700" fill="var(--purple)" text-anchor="middle">${formatRev(last.value)}</text>
    </svg>`;
}

/* ---------------- Opportunity source (proportional bars) ---------------- */
function opportunitySource(rows) {
  if (!rows || rows.length === 0) return `<div class="ad2-empty">No sources tracked yet</div>`;
  const max = Math.max(...rows.map(r => r.value), 1);
  return `
    <div class="ad2-opp-list">
      ${rows.map((r, i) => {
        const pct = Math.max((r.value / max) * 100, 4);
        const color = r.color || PALETTE[i % PALETTE.length];
        return `
          <div class="ad2-opp-row">
            <div class="ad2-opp-top">
              <span class="ad2-opp-name">${esc(r.label)}</span>
              <span class="ad2-opp-count">${r.value} Lead${r.value === 1 ? '' : 's'}</span>
            </div>
            <div class="ad2-opp-track">
              <div class="ad2-opp-fill" style="width:${pct}%; background:${color};"></div>
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

/* ---------------- Recent activity ---------------- */
function humanizeActivity(entry) {
  if (entry.summary) return entry.summary;
  const details = entry.details && typeof entry.details === 'object' ? entry.details : null;
  if (!details) return `updated ${esc(entry.entityType || 'a record')}`;
  const keys = Object.keys(details).filter(k => details[k] !== null && details[k] !== undefined && details[k] !== '');
  if (keys.length === 0) return `updated ${esc(entry.entityType || 'a record')}`;
  const k = keys[0];
  const readableKey = k.replace(/_/g, ' ');
  const extra = keys.length > 1 ? ` (+${keys.length - 1} more field${keys.length - 1 === 1 ? '' : 's'})` : '';
  return `set <strong>${esc(readableKey)}</strong> to "${esc(details[k])}"${extra}`;
}

function activityFeed(items) {
  if (!items || items.length === 0) return `<div class="ad2-empty">No recent activity</div>`;
  return `
    <div class="ad2-activity-list">
      ${items.slice(0, 10).map(entry => `
        <div class="ad2-activity-item">
          <div class="ad2-activity-rail"></div>
          <div class="ad2-activity-dot"></div>
          <div class="ad2-activity-body">
            <div class="ad2-activity-head">
              <div class="ad2-activity-text"><strong>${esc(entry.actor || 'System')}</strong> ${esc(entry.action || 'updated')} ${entry.entityType ? `<span style="color:var(--text3)">·</span> ${esc(entry.entityType)}` : ''}</div>
              <div class="ad2-activity-time">${esc(entry.timeAgo || '')}</div>
            </div>
            <div class="ad2-activity-sub">${humanizeActivity(entry)}</div>
          </div>
        </div>
      `).join('')}
    </div>`;
}

/* ---------------- Quick actions ---------------- */
const QA_ICON_CLASS = { lead: 'ad2-icon-blue', tender: 'ad2-icon-purple', invoice: 'ad2-icon-amber', customer: 'ad2-icon-green' };
function quickActions(actions) {
  const visible = (actions || []).filter(a => a.show !== false);
  if (visible.length === 0) return `<div class="ad2-empty">No actions available for your role</div>`;
  return `
    <div class="ad2-qa-list">
      ${visible.map(a => `
        <button class="ad2-qa-btn" id="${esc(a.id)}">
          <span class="ad2-qa-icon ${QA_ICON_CLASS[a.iconKey] || 'ad2-icon-blue'}">${ICONS[a.iconKey] || ICONS.lead}</span>
          ${esc(a.label)}
        </button>`).join('')}
    </div>`;
}

/* ---------------- Deadlines table ---------------- */
function deadlinesTable(rows) {
  if (!rows || rows.length === 0) {
    return `<table class="ad2-table"><thead><tr><th>Customer / Project</th><th>Phase</th><th>Deadline</th></tr></thead>
            <tbody><tr><td colspan="3" class="ad2-table-empty">No upcoming deadlines</td></tr></tbody></table>`;
  }
  return `
    <table class="ad2-table">
      <thead><tr><th>Customer / Project</th><th>Phase</th><th>Deadline</th></tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td><strong>${esc(r.customer)}</strong></td>
            <td><span class="badge b-purple">${esc(r.phase)}</span></td>
            <td style="${r.urgent ? 'color:var(--red);font-weight:700;' : ''}">${esc(r.deadline)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ---------------- Main render ---------------- */
function renderAnalyticsDashboard(data) {
  const { filter = '30d', kpis = {}, pipeline = [], monthlyRevenue = [], billing = {},
          revenueByService = [], customerDistribution = [], tenderOverview = [],
          opportunitySource: oppSource = [], upcomingDeadlines = [], quickActions: qa = [],
          recentActivity = [] } = data;

  return `
  <div class="analytics-dash-v2">
    <div class="ad2-header">
      <div>
        <div class="ad2-title">Dashboard Overview</div>
        <div class="ad2-subtitle">Your sales and operations metrics at a glance.</div>
      </div>
      <div>
        <select id="analyticsDateFilter" class="form-input" style="background:var(--bg2);">
          <option value="30d" ${filter === '30d' ? 'selected' : ''}>Last 30 Days</option>
          <option value="90d" ${filter === '90d' ? 'selected' : ''}>Last 90 Days</option>
          <option value="this_year" ${filter === 'this_year' ? 'selected' : ''}>This Year</option>
          <option value="all" ${filter === 'all' ? 'selected' : ''}>All Time</option>
        </select>
      </div>
    </div>

    <div class="ad2-kpi-grid">
      ${kpiCard({ label: 'Total Leads', value: kpis.totalLeads?.value, changePct: kpis.totalLeads?.changePct, iconKey: 'leads', iconClass: 'ad2-icon-blue' })}
      ${kpiCard({ label: 'Live Tenders', value: kpis.liveTenders?.value, changePct: kpis.liveTenders?.changePct, iconKey: 'tenders', iconClass: 'ad2-icon-purple' })}
      ${kpiCard({ label: 'Awarded', value: kpis.awarded?.value, changePct: kpis.awarded?.changePct, iconKey: 'awarded', iconClass: 'ad2-icon-green' })}
      ${kpiCard({ label: 'Active Projects', value: kpis.activeProjects?.value, changePct: kpis.activeProjects?.changePct, iconKey: 'projects', iconClass: 'ad2-icon-cyan' })}
      ${kpiCard({ label: 'Total Revenue', value: kpis.revenue?.value, changePct: kpis.revenue?.changePct, iconKey: 'revenue', iconClass: 'ad2-icon-green', isMoney: true })}
      ${kpiCard({ label: 'Pending Billing', value: kpis.pendingBilling?.value, changePct: kpis.pendingBilling?.changePct, iconKey: 'billing', iconClass: 'ad2-icon-amber', isMoney: true })}
    </div>

    <div style="display:grid; grid-template-columns: 2fr 1fr; gap: 24px; margin-bottom: 24px;">

      <!-- Main left column -->
      <div style="display:flex; flex-direction:column; gap: 24px;">

        <div>
          <div class="ad2-sec-title">Sales Pipeline Overview</div>
          <div class="ad2-pipe-container">
            ${pipeline.map((stage, i) => `
              ${i > 0 ? '<div class="ad2-pipe-arrow">›</div>' : ''}
              <div class="ad2-pipe-block ${stage.colorClass || ''}">
                <div class="ad2-pipe-label">${esc(stage.label)}</div>
                <div class="ad2-pipe-val">${stage.value}</div>
                ${stage.convPct !== undefined ? `<div class="ad2-pipe-conv" style="color:${stage.convPct >= 0 ? 'var(--green)' : 'var(--red)'}">${stage.convPct >= 0 ? '↑' : '↓'} ${Math.abs(stage.convPct)}%</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>

        <div style="display:flex; flex-direction:column; gap: 24px;">
          <div class="ad2-card">
            <div class="ad2-sec-title">Monthly Revenue Trend</div>
            <div class="ad2-chart-wrap">${trendChart(monthlyRevenue)}</div>
          </div>

          <div class="ad2-card">
            <div class="ad2-sec-title">Billing Overview</div>
            <div class="ad2-billing-grid">
              <div class="ad2-billing-card">
                <div class="ad2-billing-title">Pending Invoices</div>
                <div class="ad2-billing-val" style="color:#3b82f6;">${formatRev(billing.pendingInvoices)}</div>
              </div>
              <div class="ad2-billing-card">
                <div class="ad2-billing-title">Overdue Billing</div>
                <div class="ad2-billing-val" style="color:var(--red);">${formatRev(billing.overdueBilling)}</div>
              </div>
              <div class="ad2-billing-card">
                <div class="ad2-billing-title">Total Outstanding</div>
                <div class="ad2-billing-val" style="color:var(--amber);">${formatRev(billing.totalOutstanding)}</div>
              </div>
              <div class="ad2-billing-card">
                <div class="ad2-billing-title">Collected (Filter)</div>
                <div class="ad2-billing-val" style="color:var(--green);">${formatRev(billing.collected)}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="ad2-donut-row">
          <div class="ad2-card">
            <div class="ad2-sec-title">Revenue by Service</div>
            ${donutChart(revenueByService, { isMoney: true })}
          </div>
          <div class="ad2-card">
            <div class="ad2-sec-title">Customer Dist</div>
            ${donutChart(customerDistribution)}
          </div>
          <div class="ad2-card">
            <div class="ad2-sec-title">Tender Overview</div>
            ${donutChart(tenderOverview)}
          </div>
        </div>

        <div class="ad2-card" style="padding:0; overflow:hidden;">
          <div class="ad2-sec-title" style="padding: 18px 20px 12px; margin:0;">Upcoming Deadlines</div>
          ${deadlinesTable(upcomingDeadlines)}
        </div>
      </div>

      <!-- Right column -->
      <div style="display:flex; flex-direction:column; gap: 24px;">
        <div class="ad2-card">
          <div class="ad2-sec-title">Quick Actions</div>
          ${quickActions(qa)}
        </div>

        <div class="ad2-card">
          <div class="ad2-sec-title">Opportunity Source</div>
          ${opportunitySource(oppSource)}
        </div>

        <div class="ad2-card" style="flex:1; overflow-y:auto; max-height:500px;">
          <div class="ad2-sec-title">Recent Activity</div>
          ${activityFeed(recentActivity)}
        </div>
      </div>
    </div>
  </div>`;
}

if (typeof window !== 'undefined') {
  window.renderAnalyticsDashboard = renderAnalyticsDashboard;
}
