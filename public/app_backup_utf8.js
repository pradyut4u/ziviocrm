// ============================================================
// TENDEROPS â€” ISP Tender Management System (Vanilla JS SPA)
// ============================================================

// ---- State ----
const S = {
  user: null, token: localStorage.getItem('_tok'),
  page: 'dashboard', tenderId: null, tab: 'overview',
  adminTab: 'users', tenders: [], tender: null,
  users: [], audit: [], notifications: [], unread: 0,
  modal: null, notifOpen: false
};

// ---- Utils ----
const $  = id => document.getElementById(id);
const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const mount = (id, html) => { const e = $(id); if (e) e.innerHTML = html; };

function toast(msg, type = 'info') {
  let c = $('tc'); if (!c) { c = document.createElement('div'); c.id='tc'; c.className='toast-container'; document.body.appendChild(c); }
  const t = document.createElement('div'); t.className=`toast toast-${type}`; t.textContent = msg; c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function fmt(val, type) {
  if (val === null || val === undefined || val === '') return '<span style="color:var(--text3)">â€”</span>';
  if (type === 'date') { try { return new Date(val).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); } catch { return val; } }
  if (type === 'currency') return 'â‚¹' + parseFloat(val).toLocaleString('en-IN');
  if (type === 'size') { const s=parseInt(val)||0; return s>1048576?(s/1048576).toFixed(1)+' MB':(s/1024).toFixed(0)+' KB'; }
  return esc(val);
}

function timeAgo(d) {
  if (!d) return ''; const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff/60000); if (m<1) return 'just now'; if (m<60) return `${m}m ago`;
  const h = Math.floor(m/60); if (h<24) return `${h}h ago`; return `${Math.floor(h/24)}d ago`;
}

function fileIcon(mime) {
  if (!mime) return 'ðŸ“Ž'; mime = String(mime).toLowerCase();
  if (mime.includes('pdf')) return 'ðŸ“„';
  if (mime.includes('word')||mime.includes('doc')) return 'ðŸ“';
  if (mime.includes('excel')||mime.includes('sheet')||mime.includes('xls')) return 'ðŸ“Š';
  if (mime.includes('image')) return 'ðŸ–¼'; return 'ðŸ“Ž';
}

function stageBadge(stage) {
  const m = {
    draft:['b-gray','â—‹ Draft'], uploaded:['b-blue','â— Uploaded'],
    technical_assigned:['b-purple','âš™ Tech Review'], technical_complete:['b-cyan','âœ“ Tech Complete'],
    bid_draft:['b-amber','âœ Bid Draft'], bid_final:['b-amber','â˜… Bid Ready'],
    billing_pending:['b-red','â‚¹ Billing Pending'], billed:['b-green','âœ“ Billed'], closed:['b-green','â— Closed']
  }[stage] || ['b-gray', stage];
  return `<span class="badge ${m[0]}">${m[1]}</span>`;
}

function prioBadge(p) {
  const m = {high:['b-red','High'],medium:['b-amber','Medium'],low:['b-green','Low']}[p||'medium']||['b-gray','â€”'];
  return `<span class="badge ${m[0]}">${m[1]}</span>`;
}

function roleLabel(r) {
  return {admin:'Administrator',tender:'Tender Manager',technical:'Technical Team',accounts:'Accounts',management:'Management'}[r]||r;
}

// ---- API ----
async function api(method, path, body) {
  const opts = { method, headers: {'Content-Type':'application/json'} };
  if (S.token) opts.headers['Authorization'] = `Bearer ${S.token}`;
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`/api${path}`, opts);
  if (res.status === 401 && path !== '/auth/login') { logout(); return null; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function up(path, fd) {
  const res = await fetch(`/api${path}`, { method:'POST', headers:{'Authorization':`Bearer ${S.token}`}, body: fd });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data;
}

// ---- Auth ----
async function init() {
  if (!S.token) return showLogin();
  try {
    S.user = await api('GET', '/auth/me');
    if (!S.user) return showLogin();
    await loadAll();
    setInterval(loadNotifs, 30000);
    render();
  } catch { localStorage.removeItem('_tok'); showLogin(); }
}

async function loadAll() {
  await Promise.all([loadTenders(), loadNotifs()]);
}

async function loadTenders() {
  try { S.tenders = await api('GET', '/tenders') || []; } catch {}
}

async function loadTender(id) {
  try { S.tender = await api('GET', `/tenders/${id}`); } catch { S.tender = null; }
}

async function loadUsers() {
  try { S.users = await api('GET', '/users') || []; } catch {}
}

async function loadAudit() {
  try { S.audit = await api('GET', '/audit') || []; } catch {}
}

async function loadNotifs() {
  try {
    S.notifications = await api('GET', '/notifications') || [];
    S.unread = S.notifications.filter(n => !n.read).length;
    const b = $('nb'); if (b) { b.textContent = S.unread; b.style.display = S.unread ? 'flex' : 'none'; }
  } catch {}
}

async function doLogin(email, password) {
  const data = await api('POST', '/auth/login', { email, password });
  S.token = data.token; S.user = data.user;
  localStorage.setItem('_tok', data.token);
  await loadAll();
  render();
}

function logout() {
  api('POST', '/auth/logout').catch(()=>{});
  localStorage.removeItem('_tok');
  S.user = null; S.token = null;
  showLogin();
}

// ---- Render ----
function showLogin() {
  document.body.innerHTML = `
    <div id="tc" class="toast-container"></div>
    <main class="login-layout">
      <div class="login-left">
        <div class="login-left-content">
          <h1>AI-Powered HR.<br><span>People-First Future.</span></h1>
          <p>Zivio HR brings together automation, intelligence, and human connection to build high-performing teams.</p>

          <div class="login-badges">
            <div class="login-badge login-badge-active">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              AI Insights
            </div>
            <div class="login-badge">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              Smart Automation
            </div>
            <div class="login-badge">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
              People Analytics
            </div>
          </div>

          <div class="login-promo-stack">
            <div class="promo-card promo-card-back">
              <div class="promo-row">
                <span class="promo-row-title">Leave Requests</span>
                <a href="#" class="promo-view-all">View all</a>
              </div>
              <div class="promo-row-sub">Pending Approvals</div>
              <div class="promo-avatars">
                <span class="promo-avatar">B</span>
                <span class="promo-avatar">C</span>
              </div>
              <div class="promo-row promo-row-payroll">
                <div>
                  <div class="promo-row-title">Payroll Run</div>
                  <div class="promo-row-sub">June 2026</div>
                </div>
                <span class="promo-status-pill">Completed</span>
              </div>
            </div>

            <div class="promo-card promo-card-front">
              <div class="promo-card-header">
                <span class="promo-card-title">AI Insights</span>
                <span class="promo-ai-pill">AI</span>
              </div>
              <p class="promo-card-text">Employee engagement is trending up</p>
              <div class="promo-metric">+18%</div>
              <svg class="promo-sparkline" viewBox="0 0 160 40" preserveAspectRatio="none">
                <polyline points="0,32 20,30 40,26 60,28 80,18 100,20 120,10 140,6 160,4" fill="none" stroke="currentColor" stroke-width="2.5"/>
              </svg>
            </div>
          </div>

          <div class="login-security">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            <div>
              <div class="login-security-title">Enterprise-grade security</div>
              <div class="login-security-sub">SOC 2 Type II • GDPR Compliant</div>
            </div>
          </div>
        </div>
      </div>
      <div class="login-right">
        <div class="login-form-wrapper">
          <div style="margin-bottom: 40px;">
            <img src="/assets/Zivio.png" alt="Zivio HR" style="height: 60px; object-fit: contain;" />
          </div>
          <div class="login-header">
            <h2>Welcome back</h2>
            <p>Sign in to your Zivio workspace</p>
          </div>
          <form id="lf">
            <div class="login-field">
              <label>Work Email</label>
              <div class="login-input-wrap">
                <svg class="login-input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                <input type="email" id="le" placeholder="you@company.com" autocomplete="email" required>
              </div>
            </div>
            <div class="login-field">
              <label>Password</label>
              <div class="login-input-wrap">
                <svg class="login-input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                <input type="password" id="lp" placeholder="••••••••" autocomplete="current-password" required>
                <button type="button" class="login-show-pwd" id="lshow">Show</button>
              </div>
            </div>
            <div id="lerr" style="display:none; color: var(--red); font-size: 13px; margin-bottom: 16px;"></div>
            <div class="login-actions">
              <label class="remember-me"><input type="checkbox"> Remember me</label>
              <a href="#" class="forgot-pwd">Forgot password?</a>
            </div>
            <button class="btn-signin" type="submit" id="lbtn">Sign in &rarr;</button>
          </form>
          <div class="ai-notice">
            <div class="ai-notice-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7h-9m3-3v6M4 17h9m-3 3v-6M15 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM9 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>
            </div>
            <div class="ai-notice-text">
              <h4>Automated Compliance</h4>
              <p>We stay on top of the latest regulations so your HR policies are always up to date.</p>
            </div>
          </div>
        </div>
      </div>
    </main>`;

  $('lshow').onclick = () => {
    const pw = $('lp');
    const isPwd = pw.type === 'password';
    pw.type = isPwd ? 'text' : 'password';
    $('lshow').textContent = isPwd ? 'Hide' : 'Show';
  };

  $('lf').onsubmit = async e => {
    e.preventDefault();
    const btn = $('lbtn'); btn.disabled=true; btn.textContent='Signing in...';
    const err = $('lerr'); err.style.display='none';
    try { await doLogin($('le').value, $('lp').value); }
    catch(ex) { err.textContent = ex.message; err.style.display='flex'; }
    finally { btn.disabled=false; btn.textContent='Sign In →'; }
  };
}

function render() {
  document.body.innerHTML = `
    <div id="tc" class="toast-container"></div>
    <div class="layout">
      ${Sidebar()}
      <div class="main-area">${Header()}<div class="content" id="content">${renderPage()}</div></div>
    </div>
    ${S.notifOpen ? NotifPanel() : ''}`;
  attachAll();
}

function Sidebar() {
  const role = S.user?.role;
  const items = [
    {p:'dashboard',l:'Dashboard',i:'âŠž',all:true},
    {p:'tenders',l:'Tenders',i:'â–£',roles:['tender','admin','management']},
    {p:'technical',l:'Technical',i:'âš™',roles:['technical','admin']},
    {p:'billing',l:'Billing',i:'â‚¹',roles:['accounts','admin']},
    {p:'admin',l:'Admin Panel',i:'â—ˆ',roles:['admin']},
  ].filter(x => x.all || x.roles?.includes(role));
  return `
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="brand-icon">T</div>
        <div><div class="brand-name">TenderOps</div><div class="brand-tag">ISP Tender Management</div></div>
      </div>
      <nav class="sidebar-nav">
        ${items.map(x=>`
          <button class="nav-item ${S.page===x.p&&!S.tenderId?'active':''}" data-nav="${x.p}">
            <span class="nav-icon">${x.i}</span><span class="nav-label">${x.l}</span>
            ${x.p==='dashboard'&&S.unread?`<span class="nav-badge">${S.unread}</span>`:''}
          </button>`).join('')}
      </nav>
      <div class="sidebar-footer">
        <div class="avatar">${(S.user?.name||'U')[0].toUpperCase()}</div>
        <div style="flex:1;min-width:0"><div class="user-name">${esc(S.user?.name||'')}</div><div class="user-role">${roleLabel(role)}</div></div>
        <button class="logout-btn" id="logoutBtn" title="Logout">â»</button>
      </div>
    </aside>`;
}

function Header() {
  const t = {dashboard:'Dashboard',tenders:'Tenders',technical:'Technical Review',billing:'Billing & Accounts',admin:'Administration'}[S.page]||'TenderOps';
  return `
    <header class="topbar">
      <div class="topbar-title">${t}</div>
      <div class="page-actions">
        <button class="icon-btn" id="nb-btn" title="Notifications">ðŸ””
          <span class="notif-badge" id="nb" style="display:${S.unread?'flex':'none'}">${S.unread}</span>
        </button>
      </div>
    </header>`;
}

// ---- Pipeline ----
function Pipeline(stage) {
  const ALL = ['draft','uploaded','technical_assigned','technical_complete','bid_draft','bid_final','billing_pending','billed','closed'];
  const STEPS = [
    {l:'Upload',stages:['draft','uploaded']},
    {l:'Technical',stages:['technical_assigned','technical_complete']},
    {l:'Proposal',stages:['bid_draft','bid_final']},
    {l:'Billing',stages:['billing_pending','billed']},
    {l:'Closed',stages:['closed']}
  ];
  const ci = ALL.indexOf(stage);
  let html = '<div class="pipeline">';
  STEPS.forEach((step, si) => {
    const active = step.stages.includes(stage);
    const done = ci > ALL.indexOf(step.stages[step.stages.length-1]);
    const cls = active ? 'active' : done ? 'done' : '';
    html += `<div class="pip-step"><div class="pip-node">
      <div class="pip-dot ${cls}">${done?'âœ“':si+1}</div>
      <div class="pip-lbl ${cls}">${step.l}</div>
    </div></div>`;
    if (si < STEPS.length-1) html += `<div class="pip-line ${done?'done':''}"></div>`;
  });
  return html + '</div>';
}

// ---- Pages ----
function renderPage() {
  switch(S.page) {
    case 'dashboard': return PageDashboard();
    case 'tenders':   return S.tenderId ? PageDetail() : PageTenders();
    case 'technical': return S.tenderId ? PageDetail() : PageTechnical();
    case 'billing':   return S.tenderId ? PageDetail() : PageBilling();
    case 'admin':     return PageAdmin();
    default: return PageDashboard();
  }
}

// ---- Dashboard ----
function PageDashboard() {
  const ts = S.tenders, role = S.user?.role;
  const stats = [
    {icon:'ðŸ“‹',label:'Total Tenders',val:ts.length,color:'si-blue',sub:'All time'},
    {icon:'ðŸ”„',label:'Active',val:ts.filter(t=>!['draft','closed'].includes(t.stage)).length,color:'si-cyan',sub:'In progress'},
    {icon:'âš™ï¸',label:'Tech Pending',val:ts.filter(t=>t.stage==='technical_assigned').length,color:'si-purple',sub:'Awaiting review'},
    {icon:'ðŸ’°',label:'Bill Pending',val:ts.filter(t=>['bid_final','billing_pending'].includes(t.stage)).length,color:'si-amber',sub:'Ready for billing'},
  ];
  const recent = ts.slice(0,6);
  return `
    <div class="grid g4" style="margin-bottom:20px">
      ${stats.map(s=>`
        <div class="stat-card">
          <div class="stat-icon ${s.color}">${s.icon}</div>
          <div><div class="stat-val">${s.val}</div><div class="stat-lbl">${s.label}</div><div class="stat-sub">${s.sub}</div></div>
        </div>`).join('')}
    </div>
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div class="sec-title" style="margin-bottom:0;flex:1">Recent Tenders</div>
        ${['tender','admin'].includes(role)?`<button class="btn btn-primary btn-sm" data-modal="create-tender">+ New Tender</button>`:''}
      </div>
      ${recent.length?`
        <div class="table-wrap">
          <table><thead><tr><th>Tender</th><th>Customer</th><th>Stage</th><th>Priority</th><th>Due</th><th>Updated</th></tr></thead>
          <tbody>${recent.map(t=>`
            <tr class="tr-link" data-tnav="${t.id}">
              <td><div class="tbl-link" style="font-weight:600">${esc(t.title)}</div><div style="font-size:11px;color:var(--text2)">${esc(t.bid_number||'')}</div></td>
              <td>${esc(t.customer||'â€”')}</td><td>${stageBadge(t.stage)}</td>
              <td>${prioBadge(t.priority)}</td><td>${fmt(t.due_date,'date')}</td>
              <td style="color:var(--text2)">${timeAgo(t.updated_at)}</td>
            </tr>`).join('')}
          </tbody></table>
        </div>`:
        `<div class="empty"><div class="empty-icon">ðŸ“‹</div><div class="empty-title">No tenders yet</div>
         <div class="empty-sub">Create your first tender to get started</div>
         ${['tender','admin'].includes(role)?`<button class="btn btn-primary" data-modal="create-tender">+ Create Tender</button>`:''}</div>`}
    </div>`;
}

// ---- Tenders List ----
function PageTenders() {
  const role = S.user?.role, list = S.tenders;
  return `
    <div class="page-header">
      <div><div class="page-title">Tenders</div><div class="page-sub">${list.length} tenders</div></div>
      <div class="page-actions">
        ${['tender','admin'].includes(role)?`<button class="btn btn-primary" data-modal="create-tender">+ New Tender</button>`:''}
      </div>
    </div>
    ${list.length?`
      <div class="table-wrap"><table>
        <thead><tr><th>Bid #</th><th>Title</th><th>Customer</th><th>Stage</th><th>Priority</th><th>Value</th><th>Due Date</th><th>Docs</th></tr></thead>
        <tbody>${list.map(t=>`
          <tr class="tr-link" data-tnav="${t.id}">
            <td style="font-size:11px;color:var(--text2);font-weight:600">${esc(t.bid_number||'â€”')}</td>
            <td><div class="tbl-link">${esc(t.title)}</div></td>
            <td>${esc(t.customer||'â€”')}</td><td>${stageBadge(t.stage)}</td>
            <td>${prioBadge(t.priority)}</td><td style="font-weight:700">${fmt(t.value,'currency')}</td>
            <td>${fmt(t.due_date,'date')}</td>
            <td>${t.doc_count?`<span class="badge b-blue">ðŸ“Ž ${t.doc_count}</span>`:'â€”'}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`:
      `<div class="empty"><div class="empty-icon">ðŸ”</div><div class="empty-title">No tenders</div>
       ${['tender','admin'].includes(role)?`<button class="btn btn-primary" data-modal="create-tender">+ New Tender</button>`:''}</div>`}`;
}

// ---- Technical Page ----
function PageTechnical() {
  const assigned = S.tenders.filter(t=>t.stage==='technical_assigned');
  const done = S.tenders.filter(t=>['technical_complete','bid_draft','bid_final','billing_pending','billed','closed'].includes(t.stage));
  return `
    <div class="page-header"><div><div class="page-title">Technical Review</div>
      <div class="page-sub">${assigned.length} pending Â· ${done.length} completed</div></div></div>
    ${assigned.length?`
      <div class="sec-title">âš¡ Pending Review (${assigned.length})</div>
      <div class="table-wrap" style="margin-bottom:24px"><table>
        <thead><tr><th>Tender</th><th>Customer</th><th>Priority</th><th>Due</th><th>Docs</th></tr></thead>
        <tbody>${assigned.map(t=>`
          <tr class="tr-link" data-tnav="${t.id}">
            <td><div class="tbl-link">${esc(t.title)}</div><div style="font-size:11px;color:var(--text2)">${esc(t.bid_number||'')}</div></td>
            <td>${esc(t.customer||'â€”')}</td><td>${prioBadge(t.priority)}</td>
            <td>${fmt(t.due_date,'date')}</td>
            <td>${t.doc_count?`<span class="badge b-blue">ðŸ“Ž ${t.doc_count}</span>`:'â€”'}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`:`<div class="alert alert-success" style="margin-bottom:20px"><span>âœ…</span><span>No pending technical reviews.</span></div>`}
    ${done.length?`
      <div class="sec-title">Completed</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Tender</th><th>Customer</th><th>Stage</th><th>Updated</th></tr></thead>
        <tbody>${done.map(t=>`
          <tr class="tr-link" data-tnav="${t.id}">
            <td><div style="font-weight:600">${esc(t.title)}</div></td>
            <td>${esc(t.customer||'â€”')}</td><td>${stageBadge(t.stage)}</td>
            <td style="color:var(--text2)">${timeAgo(t.updated_at)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`:''}`;
}

// ---- Billing Page ----
function PageBilling() {
  const list = S.tenders.filter(t=>['bid_final','billing_pending','billed','closed'].includes(t.stage));
  const pending = list.filter(t=>['bid_final','billing_pending'].includes(t.stage));
  return `
    <div class="page-header"><div><div class="page-title">Billing & Accounts</div>
      <div class="page-sub">${pending.length} pending Â· ${list.length} total</div></div></div>
    ${pending.length?`<div class="alert alert-warning" style="margin-bottom:18px"><span>âš ï¸</span><span>${pending.length} tender${pending.length>1?'s':''} awaiting invoice</span></div>`:''}
    ${list.length?`
      <div class="table-wrap"><table>
        <thead><tr><th>Tender</th><th>Customer</th><th>Value</th><th>Stage</th><th>Invoice</th></tr></thead>
        <tbody>${list.map(t=>`
          <tr class="tr-link" data-tnav="${t.id}">
            <td><div class="tbl-link">${esc(t.title)}</div><div style="font-size:11px;color:var(--text2)">${esc(t.bid_number||'')}</div></td>
            <td>${esc(t.customer||'â€”')}</td><td style="font-weight:700">${fmt(t.value,'currency')}</td>
            <td>${stageBadge(t.stage)}</td>
            <td>${t.stage==='billed'?`<span class="badge b-green">âœ“ Billed</span>`:t.stage==='billing_pending'?`<span class="badge b-amber">Created</span>`:`<span class="badge b-gray">None</span>`}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`:
      `<div class="empty"><div class="empty-icon">ðŸ’°</div><div class="empty-title">No billing items yet</div><div class="empty-sub">Finalized bid documents will appear here</div></div>`}`;
}

// ---- Admin Page ----
function PageAdmin() {
  return `
    <div class="page-header">
      <div class="page-title">Administration</div>
      <button class="btn btn-primary" data-modal="create-user">+ Add User</button>
    </div>
    <div class="tabs">
      ${['users','audit','pipeline'].map(t=>`<button class="tab-btn ${S.adminTab===t?'active':''}" data-atab="${t}">${{users:'Users',audit:'Audit Log',pipeline:'Pipeline View'}[t]}</button>`).join('')}
    </div>
    <div id="atab-content">${renderAdminTab()}</div>`;
}

function renderAdminTab() {
  if (S.adminTab==='audit') return `
    <div class="table-wrap"><table>
      <thead><tr><th>Time</th><th>Action</th><th>Entity</th><th>User</th></tr></thead>
      <tbody>${S.audit.slice(0,80).map(l=>`
        <tr><td style="color:var(--text2);font-size:11.5px;white-space:nowrap">${timeAgo(l.created_at)}</td>
        <td><span class="badge b-blue">${esc(l.action)}</span></td>
        <td style="font-size:12px;color:var(--text2)">${esc(l.entity_type)}</td>
        <td style="font-size:11px;color:var(--text3)">${(l.user_id||'').slice(0,8)}</td></tr>`).join('')}
      ${!S.audit.length?`<tr><td colspan="4"><div class="empty"><div class="empty-icon">ðŸ“‹</div><div class="empty-title">No logs yet</div></div></td></tr>`:''}
      </tbody>
    </table></div>`;

  if (S.adminTab==='pipeline') {
    const groups = [
      {l:'ðŸ“„ Upload',stages:['draft','uploaded']},{l:'âš™ï¸ Technical',stages:['technical_assigned','technical_complete']},
      {l:'ðŸ“ Proposal',stages:['bid_draft','bid_final']},{l:'ðŸ’° Billing',stages:['billing_pending','billed']},{l:'âœ… Closed',stages:['closed']}
    ];
    return `<div class="grid g3">${groups.map(g=>{
      const gt = S.tenders.filter(t=>g.stages.includes(t.stage));
      return `<div class="card"><div class="sec-title">${g.l} <span class="badge b-blue" style="margin-left:4px">${gt.length}</span></div>
        ${gt.length?`<div style="display:flex;flex-direction:column;gap:6px">${gt.slice(0,5).map(t=>`
          <div class="tr-link" data-tnav="${t.id}" style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--bg3);border-radius:6px">
            <div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.title)}</div>
            <div style="font-size:10px;color:var(--text2)">${esc(t.customer||'')}</div></div>${stageBadge(t.stage)}
          </div>`).join('')}${gt.length>5?`<div style="font-size:11px;color:var(--text2);text-align:center">+${gt.length-5} more</div>`:''}</div>`:
        `<div style="color:var(--text3);font-size:12px">None</div>`}
      </div>`;}).join('')}</div>`;
  }

  // users tab
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Department</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${S.users.map(u=>`
        <tr><td><div style="display:flex;align-items:center;gap:10px">
          <div class="avatar" style="width:28px;height:28px;font-size:11px">${(u.name||'U')[0]}</div>
          <span style="font-weight:600">${esc(u.name)}</span></div></td>
          <td style="color:var(--text2)">${esc(u.email)}</td>
          <td><span class="badge b-blue">${roleLabel(u.role)}</span></td>
          <td style="color:var(--text2)">${esc(u.department||'â€”')}</td>
          <td><span class="badge ${u.status==='active'?'b-green':'b-red'}">${u.status}</span></td>
          <td><button class="btn btn-ghost btn-sm" data-toggle-user="${u.id}" data-status="${u.status}">${u.status==='active'?'Disable':'Enable'}</button></td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
}

// ---- Tender Detail ----
function PageDetail() {
  const t = S.tender;
  if (!t) return `<div class="loading"><div class="spinner"></div> Loading...</div>`;
  const role = S.user?.role;
  const tabs = detailTabs(t);
  return `
    <button class="back-btn" id="backBtn">â† Back</button>
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:14px;flex-wrap:wrap">
      <div>
        <h1 style="font-size:19px;font-weight:800;margin-bottom:6px">${esc(t.title)}</h1>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${stageBadge(t.stage)}${prioBadge(t.priority)}
          ${t.bid_number?`<span style="font-size:12px;color:var(--text2)">${esc(t.bid_number)}</span>`:''}
          ${t.customer?`<span style="font-size:12px;color:var(--text2)">Â· ${esc(t.customer)}</span>`:''}
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${ActionBtns(t,role)}</div>
    </div>
    ${Pipeline(t.stage)}
    <div class="tabs">${tabs.map(tb=>`<button class="tab-btn ${S.tab===tb.k?'active':''}" data-tab="${tb.k}">${tb.l}</button>`).join('')}</div>
    <div id="tab-body">${renderTab(t,S.tab,role)}</div>`;
}

function detailTabs(t) {
  const ALL_STAGES = ['draft','uploaded','technical_assigned','technical_complete','bid_draft','bid_final','billing_pending','billed','closed'];
  const si = ALL_STAGES.indexOf(t.stage);
  const tabs = [{k:'overview',l:'Overview'},{k:'documents',l:`Documents${t.documents?.length?` (${t.documents.length})`:''}`},{k:'requirements',l:'Requirements'}];
  if (si>=2) tabs.push({k:'report',l:`Tech Report${t.technical_reports?.length?' âœ“':''}`});
  if (si>=4) tabs.push({k:'bid',l:`Bid/Proposal${t.bid_documents?.length?' âœ“':''}`});
  if (si>=6) tabs.push({k:'invoice',l:`Invoice${t.invoices?.length?' âœ“':''}`});
  return tabs;
}

function ActionBtns(t, role) {
  const btns = [];
  if (['tender','admin'].includes(role) && t.stage!=='closed') btns.push(`<button class="btn btn-ghost btn-sm" data-modal="upload-doc">ðŸ“Ž Upload Doc</button>`);
  if (role==='tender') {
    if (t.stage==='uploaded'&&(t.documents?.length||0)>0) btns.push(`<button class="btn btn-primary btn-sm" id="sendTechBtn">âš™ Send to Technical</button>`);
    if (t.stage==='technical_complete') btns.push(`<button class="btn btn-primary btn-sm" data-modal="create-bid">ðŸ“ Create Bid</button>`);
    if (t.stage==='bid_draft') { btns.push(`<button class="btn btn-success btn-sm" id="finalizeBidBtn">â˜… Finalize Bid</button>`); btns.push(`<button class="btn btn-ghost btn-sm" data-modal="create-bid">âœ Update Bid</button>`); }
  }
  if (role==='technical'&&t.stage==='technical_assigned') btns.push(`<button class="btn btn-primary btn-sm" data-modal="submit-report">ðŸ“‹ Submit Report</button>`);
  if (role==='accounts') {
    if (['bid_final','billing_pending'].includes(t.stage)) btns.push(`<button class="btn btn-primary btn-sm" data-modal="create-invoice">ðŸ’° Create Invoice</button>`);
    if (t.stage==='billing_pending'&&(t.invoices?.length||0)>0) btns.push(`<button class="btn btn-success btn-sm" id="markBilledBtn">âœ“ Mark Billed</button>`);
    if (t.stage==='billed') btns.push(`<button class="btn btn-ghost btn-sm" id="closeBtn">Close</button>`);
  }
  if (role==='admin') btns.push(`<button class="btn btn-ghost btn-sm" data-modal="override-stage">âš¡ Override Stage</button>`);
  return btns.join('');
}

function renderTab(t, tab, role) {
  switch(tab) {
    case 'overview': return TabOverview(t);
    case 'documents': return TabDocs(t, role);
    case 'requirements': return TabReqs(t, role);
    case 'report': return TabReport(t, role);
    case 'bid': return TabBid(t, role);
    case 'invoice': return TabInvoice(t, role);
    default: return TabOverview(t);
  }
}

function TabOverview(t) {
  return `
    <div class="grid g2">
      <div class="card">
        <div class="sec-title">Basic Information</div>
        <div class="detail-grid">
          <div><div class="detail-label">Title</div><div class="detail-value">${esc(t.title)}</div></div>
          <div><div class="detail-label">Bid Number</div><div class="detail-value">${esc(t.bid_number||'â€”')}</div></div>
          <div><div class="detail-label">Customer</div><div class="detail-value">${esc(t.customer||'â€”')}</div></div>
          <div><div class="detail-label">Value</div><div class="detail-value lg">${fmt(t.value,'currency')}</div></div>
          <div><div class="detail-label">Priority</div><div class="detail-value">${prioBadge(t.priority)}</div></div>
          <div><div class="detail-label">Due Date</div><div class="detail-value">${fmt(t.due_date,'date')}</div></div>
          <div style="grid-column:1/-1"><div class="detail-label">Description</div><div class="detail-value">${esc(t.description||'â€”')}</div></div>
        </div>
      </div>
      <div>
        <div class="card" style="margin-bottom:14px">
          <div class="sec-title">Status</div>
          <div style="margin-bottom:10px">${stageBadge(t.stage)}</div>
          ${t.admin_override?`<div class="alert alert-warning" style="margin-top:8px"><span>âš¡</span><span>Admin override: ${esc(t.override_reason||'')}</span></div>`:''}
          <div style="margin-top:10px;font-size:11.5px;color:var(--text2)">Created ${fmt(t.created_at,'date')} Â· Updated ${timeAgo(t.updated_at)}</div>
        </div>
        <div class="card">
          <div class="sec-title">Quick Stats</div>
          ${[['Documents',t.documents?.length||0,'b-blue'],['Tech Reports',t.technical_reports?.length||0,'b-cyan'],['Bid Documents',t.bid_documents?.length||0,'b-amber'],['Invoices',t.invoices?.length||0,'b-green']].map(([l,v,c])=>`
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px">
              <span style="color:var(--text2)">${l}</span><span class="badge ${c}">${v}</span>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
}

function TabDocs(t, role) {
  const docs = t.documents||[];
  return `
    ${['tender','admin'].includes(role)?`
      <label class="upload-zone" id="docDrop" style="margin-bottom:18px">
        <div class="uz-icon">â˜</div>
        <div class="uz-title">Drop files here or click to upload</div>
        <div class="uz-sub">PDF, Word, Excel â€” max 50MB</div>
        <input type="file" id="docFile" style="display:none" accept=".pdf,.doc,.docx,.xls,.xlsx" multiple>
      </label>`:''}
    ${docs.length?`<div class="file-list">${docs.map(d=>`
      <div class="file-item">
        <div class="file-icon">${fileIcon(d.mime)}</div>
        <div style="flex:1;min-width:0"><div class="file-name-text">${esc(d.name)}</div>
          <div class="file-meta">${esc(d.category)} Â· ${fmt(d.size,'size')} Â· ${timeAgo(d.created_at)}</div></div>
        <a href="${d.url}" target="_blank" class="btn btn-ghost btn-sm">View â†—</a>
        <a href="${d.url}" download="${esc(d.name)}" class="btn btn-ghost btn-sm">â†“</a>
      </div>`).join('')}</div>`:
    `<div class="empty"><div class="empty-icon">ðŸ“Ž</div><div class="empty-title">No documents uploaded</div>
     <div class="empty-sub">Upload tender documents to proceed</div></div>`}`;
}

function TabReqs(t, role) {
  const r = t.requirements||{};
  const edit = ['tender','admin'].includes(role)&&t.stage!=='closed';
  const ROW = (id,label,val,rows=3)=>edit?`<div class="form-group"><label class="form-label">${label}</label>
    <textarea class="form-textarea" id="${id}" rows="${rows}">${esc(val||'')}</textarea></div>`:
    `<div class="form-group"><label class="form-label">${label}</label><div class="kbd-val">${esc(val||'â€”')}</div></div>`;
  return `
    <div class="grid g2">
      <div class="card">${edit?`<form id="reqForm1">`:''}<div class="sec-title">Scope & Technical</div>
        ${ROW('reqScope','Scope of Work',r.scope,4)}${ROW('reqTech','Technical Specifications',r.technical_specs,4)}
        ${edit?`<button type="submit" class="btn btn-primary" style="margin-top:4px">Save</button></form>`:''}</div>
      <div class="card">${edit?`<form id="reqForm2">`:''}<div class="sec-title">Eligibility & Submission</div>
        ${ROW('reqElig','Eligibility Criteria',r.eligibility)}${ROW('reqSub','Submission Requirements',r.submission_info)}
        ${edit?`<div class="form-group"><label class="form-label">Deadline</label><input type="date" class="form-input" id="reqDeadline" value="${r.deadline||''}"></div>`:
        `<div class="form-group"><label class="form-label">Deadline</label><div class="detail-value" style="font-size:14px;font-weight:600">${fmt(r.deadline,'date')}</div></div>`}
        ${edit?`<button type="submit" class="btn btn-primary" style="margin-top:4px">Save</button></form>`:''}</div>
    </div>`;
}

function TabReport(t, role) {
  const rpts = t.technical_reports||[];
  const latest = rpts[rpts.length-1];
  const canSubmit = ['technical','admin'].includes(role)&&t.stage==='technical_assigned';
  return `
    ${canSubmit?`<div class="alert alert-info" style="margin-bottom:16px"><span>â„¹ï¸</span><span>This tender is assigned for technical review. Please submit your assessment.</span></div>
      <button class="btn btn-primary" data-modal="submit-report" style="margin-bottom:20px">ðŸ“‹ Submit Technical Report</button>`:''}
    ${latest?`<div class="report-card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div class="sec-title" style="margin-bottom:0;flex:1">Technical Report</div>
        <span class="badge ${latest.feasibility==='feasible'?'b-green':latest.feasibility==='not_feasible'?'b-red':'b-amber'}">${latest.feasibility||'â€”'}</span>
      </div>
      ${latest.summary?`<div class="form-group" style="margin-bottom:12px"><label class="form-label">Summary</label><div class="kbd-val">${esc(latest.summary)}</div></div>`:''}
      ${latest.technical_notes?`<div class="form-group" style="margin-bottom:12px"><label class="form-label">Technical Notes</label><div class="kbd-val">${esc(latest.technical_notes)}</div></div>`:''}
      ${latest.recommendation?`<div class="form-group"><label class="form-label">Recommendation</label><div class="kbd-val">${esc(latest.recommendation)}</div></div>`:''}
      ${latest.attachment_url?`<div style="margin-top:14px">
        <div class="form-label" style="margin-bottom:8px">Attached File</div>
        <div class="file-item" style="width:fit-content">
          <div class="file-icon">ðŸ“„</div>
          <div class="file-name-text">${esc(latest.attachment_name||'Report')}</div>
          <a href="${latest.attachment_url}" target="_blank" class="btn btn-ghost btn-sm">View â†—</a>
          <a href="${latest.attachment_url}" download class="btn btn-ghost btn-sm">â†“</a>
        </div></div>`:''}
    </div>`:
    `<div class="empty"><div class="empty-icon">ðŸ“‹</div><div class="empty-title">No technical report yet</div>
     <div class="empty-sub">Awaiting technical team submission</div></div>`}`;
}

function TabBid(t, role) {
  const bids = t.bid_documents||[];
  const latest = bids[bids.length-1];
  const can = ['tender','admin'].includes(role);
  return `
    ${can?`<button class="btn btn-primary" data-modal="create-bid" style="margin-bottom:18px">
      ${latest?'âœ Update Bid':'ðŸ“ Create Bid Document'}</button>`:''}
    ${latest?`<div class="card" style="border-color:rgba(245,158,11,.3)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div class="sec-title" style="margin-bottom:0;flex:1">Bid Document v${latest.version}</div>
        <span class="badge ${latest.status==='final'?'b-green':'b-amber'}">${latest.status==='final'?'â˜… Final':'âœ Draft'}</span>
      </div>
      <div class="detail-grid" style="margin-bottom:14px">
        ${latest.title?`<div style="grid-column:1/-1"><div class="detail-label">Title</div><div class="detail-value">${esc(latest.title)}</div></div>`:''}
        ${latest.price?`<div><div class="detail-label">Bid Price</div><div class="detail-value lg">${fmt(latest.price,'currency')}</div></div>`:''}
        ${latest.validity?`<div><div class="detail-label">Validity</div><div class="detail-value">${esc(latest.validity)}</div></div>`:''}
      </div>
      ${latest.scope?`<div class="form-group" style="margin-bottom:12px"><label class="form-label">Scope</label><div class="kbd-val">${esc(latest.scope)}</div></div>`:''}
      ${latest.notes?`<div class="form-group"><label class="form-label">Notes</label><div class="kbd-val">${esc(latest.notes)}</div></div>`:''}
      ${latest.attachment_url?`<div style="margin-top:14px"><div class="form-label" style="margin-bottom:8px">Attached File</div>
        <div class="file-item" style="width:fit-content">
          <div class="file-icon">ðŸ“</div><div class="file-name-text">${esc(latest.attachment_name||'Bid Document')}</div>
          <a href="${latest.attachment_url}" target="_blank" class="btn btn-ghost btn-sm">View â†—</a>
          <a href="${latest.attachment_url}" download class="btn btn-ghost btn-sm">â†“</a>
        </div></div>`:''}
    </div>`:
    `<div class="empty"><div class="empty-icon">ðŸ“</div><div class="empty-title">No bid document yet</div>
     <div class="empty-sub">Create a bid/proposal from the technical report</div></div>`}`;
}

function TabInvoice(t, role) {
  const invs = t.invoices||[];
  const inv = invs[invs.length-1];
  const can = ['accounts','admin'].includes(role);
  return `
    ${can?`<button class="btn btn-primary" data-modal="create-invoice" style="margin-bottom:18px">ðŸ’° ${inv?'Update Invoice':'Create Invoice'}</button>`:''}
    ${inv?`<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div><div class="sec-title" style="margin-bottom:4px">Invoice ${esc(inv.invoice_number)}</div>
          <span class="badge ${inv.status==='paid'?'b-green':inv.status==='sent'?'b-blue':'b-gray'}">${(inv.status||'draft').toUpperCase()}</span></div>
        <div style="text-align:right"><div style="font-size:26px;font-weight:800;color:var(--green)">â‚¹${parseFloat(inv.total||0).toLocaleString('en-IN')}</div>
          <div style="font-size:11px;color:var(--text2)">Total Amount</div></div>
      </div>
      <div class="detail-grid" style="margin-bottom:14px">
        <div><div class="detail-label">Base Amount</div><div class="detail-value">${fmt(inv.amount,'currency')}</div></div>
        <div><div class="detail-label">Tax/GST</div><div class="detail-value">${fmt(inv.tax,'currency')}</div></div>
        <div><div class="detail-label">Due Date</div><div class="detail-value">${fmt(inv.due_date,'date')}</div></div>
        <div><div class="detail-label">Created</div><div class="detail-value">${fmt(inv.created_at,'date')}</div></div>
      </div>
      ${inv.notes?`<div class="form-group" style="margin-bottom:14px"><label class="form-label">Notes</label><div class="kbd-val">${esc(inv.notes)}</div></div>`:''}
      ${can&&inv.status!=='paid'?`<div style="display:flex;gap:8px">
        ${inv.status==='draft'?`<button class="btn btn-primary" id="sendInvBtn" data-iid="${inv.id}">ðŸ“¤ Send Invoice</button>`:''}
        ${inv.status==='sent'?`<button class="btn btn-success" id="markPaidBtn" data-iid="${inv.id}">âœ“ Mark as Paid</button>`:''}
      </div>`:''}
    </div>`:
    `<div class="empty"><div class="empty-icon">ðŸ’°</div><div class="empty-title">No invoice yet</div>
     <div class="empty-sub">Create an invoice for this tender</div></div>`}`;
}

// ---- Notifications Panel ----
function NotifPanel() {
  const ns = S.notifications.slice(0,20);
  return `<div class="notif-panel" id="npanel">
    <div class="notif-hdr"><span>Notifications${S.unread?` (${S.unread})`:''}</span>
      ${S.unread?`<button class="btn btn-ghost btn-sm" id="rdAllBtn" style="font-size:11px;padding:3px 8px">Read all</button>`:''}
    </div>
    <div class="notif-list">${ns.length?ns.map(n=>`
      <div class="notif-item ${!n.read?'unread':''}" data-nid="${n.id}" ${n.tender_id?`data-tnav="${n.tender_id}"`:''}>
        <div class="notif-t">${esc(n.title)}</div>
        <div class="notif-m">${esc(n.message)}</div>
        <div class="notif-time">${timeAgo(n.created_at)}</div>
      </div>`).join(''):
      `<div style="text-align:center;padding:40px;color:var(--text2);font-size:13px">No notifications</div>`}
    </div>
  </div>`;
}

// ---- Modals ----
function showModal(html) {
  removeModal();
  const wrap = document.createElement('div'); wrap.id='mwrap'; wrap.innerHTML=html; document.body.appendChild(wrap);
  wrap.querySelector('.modal-overlay')?.addEventListener('click', e=>{ if(e.target===e.currentTarget) removeModal(); });
  attachModalHandlers();
}
function removeModal() { $('mwrap')?.remove(); }

function MW(title, body, footer, size='') {
  return `<div class="modal-overlay"><div class="modal ${size}">
    <div class="modal-header"><div class="modal-title">${title}</div>
      <button class="modal-close" id="mclose">âœ•</button></div>
    <div class="modal-body">${body}</div>
    <div class="modal-footer">${footer}</div>
  </div></div>`;
}

function attachModalHandlers() {
  $('mclose')?.addEventListener('click', removeModal);
  // Create tender
  $('saveTenderBtn')?.addEventListener('click', async () => {
    const body = { title:$('ntTitle')?.value?.trim(), bid_number:$('ntBid')?.value, customer:$('ntCustomer')?.value, value:$('ntValue')?.value, due_date:$('ntDue')?.value, priority:$('ntPrio')?.value, description:$('ntDesc')?.value };
    if (!body.title) return toast('Title is required','error');
    try {
      await api('POST','/tenders',body); await loadTenders(); removeModal(); render();
      toast('Tender created!','success');
    } catch(e) { toast(e.message,'error'); }
  });
  // Upload doc
  const docZone = $('mdocDrop'), docInput = $('mdocFile');
  if (docZone && docInput) {
    docZone.addEventListener('click', ()=>docInput.click());
    docInput.addEventListener('change', ()=>{ if(docInput.files[0]) $('mfileLabel').textContent=docInput.files[0].name; });
    docZone.addEventListener('dragover',e=>{e.preventDefault();docZone.classList.add('drag-over');});
    docZone.addEventListener('dragleave',()=>docZone.classList.remove('drag-over'));
    docZone.addEventListener('drop',e=>{e.preventDefault();docZone.classList.remove('drag-over');if(e.dataTransfer.files[0]){docInput.files=e.dataTransfer.files;$('mfileLabel').textContent=e.dataTransfer.files[0].name;}});
  }
  $('uploadDocBtn')?.addEventListener('click', async () => {
    const file = $('mdocFile')?.files[0]; if (!file) return toast('Select a file','error');
    const fd = new FormData(); fd.append('file',file); fd.append('category',$('mdocCat')?.value||'tender');
    try { await up(`/tenders/${S.tenderId}/documents`,fd); await loadTender(S.tenderId); removeModal(); render(); toast('Uploaded!','success'); }
    catch(e) { toast(e.message,'error'); }
  });
  // Submit report
  const rptZone = $('rptDrop'), rptInput = $('rptFile');
  if (rptZone&&rptInput) {
    rptZone.addEventListener('click',()=>rptInput.click());
    rptInput.addEventListener('change',()=>{ if(rptInput.files[0]) $('rptFileName').textContent=rptInput.files[0].name; });
  }
  $('submitRptBtn')?.addEventListener('click', async () => {
    const summary = $('rptSummary')?.value?.trim(); if (!summary) return toast('Summary required','error');
    const fd = new FormData();
    fd.append('feasibility',$('rptFeas')?.value||'feasible');
    fd.append('summary',summary);
    fd.append('technical_notes',$('rptNotes')?.value||'');
    fd.append('recommendation',$('rptRec')?.value||'');
    const file = $('rptFile')?.files[0]; if (file) fd.append('file',file);
    try { await up(`/tenders/${S.tenderId}/technical-report`,fd); await loadTender(S.tenderId); removeModal(); S.tab='report'; render(); toast('Report submitted!','success'); }
    catch(e) { toast(e.message,'error'); }
  });
  // Create bid
  const bidZone = $('bidDrop'), bidInput = $('bidFile');
  if (bidZone&&bidInput) {
    bidZone.addEventListener('click',()=>bidInput.click());
    bidInput.addEventListener('change',()=>{ if(bidInput.files[0]) $('bidFileName').textContent=bidInput.files[0].name; });
  }
  $('saveBidBtn')?.addEventListener('click', async () => {
    const fd = new FormData();
    fd.append('title',$('bidTitle')?.value||'');
    fd.append('scope',$('bidScope')?.value||'');
    fd.append('price',$('bidPrice')?.value||'');
    fd.append('validity',$('bidValid')?.value||'');
    fd.append('notes',$('bidNotes')?.value||'');
    fd.append('status',$('bidStatus')?.value||'draft');
    const file = $('bidFile')?.files[0]; if (file) fd.append('file',file);
    try { await up(`/tenders/${S.tenderId}/bid-document`,fd); await loadTender(S.tenderId); removeModal(); S.tab='bid'; render(); toast('Bid document saved!','success'); }
    catch(e) { toast(e.message,'error'); }
  });
  // Create invoice
  $('invAmt')?.addEventListener('input', ()=>{
    const a=parseFloat($('invAmt')?.value)||0, tx=parseFloat($('invTax')?.value)||0;
    const d=$('invTotal'); if(d) d.textContent=`Total: â‚¹${(a+tx).toLocaleString('en-IN')}`;
  });
  $('invTax')?.addEventListener('input', ()=>{
    const a=parseFloat($('invAmt')?.value)||0, tx=parseFloat($('invTax')?.value)||0;
    const d=$('invTotal'); if(d) d.textContent=`Total: â‚¹${(a+tx).toLocaleString('en-IN')}`;
  });
  $('saveInvBtn')?.addEventListener('click', async () => {
    const amount = $('invAmt')?.value; if (!amount) return toast('Amount required','error');
    try {
      await api('POST',`/tenders/${S.tenderId}/invoice`,{invoice_number:$('invNum')?.value,amount,tax:$('invTax')?.value,due_date:$('invDue')?.value,notes:$('invNotes')?.value});
      await loadTender(S.tenderId); removeModal(); S.tab='invoice'; render(); toast('Invoice created!','success');
    } catch(e) { toast(e.message,'error'); }
  });
  // Override stage
  $('applyOverrideBtn')?.addEventListener('click', async () => {
    const stage=$('ovStage')?.value, reason=$('ovReason')?.value?.trim();
    if (!reason) return toast('Reason required','error');
    try { await api('POST',`/tenders/${S.tenderId}/move`,{stage,reason}); await loadTender(S.tenderId); removeModal(); render(); toast('Stage overridden','info'); }
    catch(e) { toast(e.message,'error'); }
  });
  // Create user
  $('saveUserBtn')?.addEventListener('click', async () => {
    const body={name:$('nuName')?.value,email:$('nuEmail')?.value,password:$('nuPass')?.value,role:$('nuRole')?.value,department:$('nuDept')?.value};
    if (!body.name||!body.email||!body.password) return toast('Fill all required fields','error');
    try { await api('POST','/users',body); await loadUsers(); removeModal(); mount('atab-content',renderAdminTab()); toast('User created!','success'); }
    catch(e) { toast(e.message,'error'); }
  });
}

// ---- Modal Templates ----
function mCreateTender() {
  return MW('Create New Tender', `
    <div class="form-group"><label class="form-label">Tender Title *</label>
      <input class="form-input" id="ntTitle" placeholder="e.g. BSNL 1Gbps ILL â€” Mumbai HQ" required></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Bid / Reference Number</label>
        <input class="form-input" id="ntBid" placeholder="BSNL/2024/ILL/001"></div>
      <div class="form-group"><label class="form-label">Customer / Organisation</label>
        <input class="form-input" id="ntCustomer" placeholder="e.g. BSNL Mumbai"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Estimated Value (â‚¹)</label>
        <input class="form-input" type="number" id="ntValue" placeholder="1200000"></div>
      <div class="form-group"><label class="form-label">Submission Due Date</label>
        <input class="form-input" type="date" id="ntDue"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Priority</label>
        <select class="form-select" id="ntPrio"><option value="high">High</option><option value="medium" selected>Medium</option><option value="low">Low</option></select></div>
    </div>
    <div class="form-group"><label class="form-label">Description</label>
      <textarea class="form-textarea" id="ntDesc" rows="3" placeholder="Brief description..."></textarea></div>`,
  `<button class="btn btn-ghost" id="mclose">Cancel</button><button class="btn btn-primary" id="saveTenderBtn">Create Tender â†’</button>`);
}

function mUploadDoc() {
  return MW('Upload Document', `
    <div class="form-group"><label class="form-label">Category</label>
      <select class="form-select" id="mdocCat"><option value="tender">Tender Document</option><option value="bid">Bid Document</option>
        <option value="boq">BOQ / Price Sheet</option><option value="technical">Technical Spec</option>
        <option value="corrigendum">Corrigendum</option><option value="other">Other</option></select></div>
    <label class="upload-zone" id="mdocDrop">
      <div class="uz-icon">ðŸ“Ž</div><div class="uz-title">Click or drop file here</div>
      <div class="uz-sub">PDF, Word, Excel â€” max 50MB</div>
      <input type="file" id="mdocFile" style="display:none" accept=".pdf,.doc,.docx,.xls,.xlsx">
    </label>
    <div id="mfileLabel" style="font-size:12px;color:var(--text2)"></div>`,
  `<button class="btn btn-ghost" id="mclose">Cancel</button><button class="btn btn-primary" id="uploadDocBtn">Upload</button>`);
}

function mSubmitReport() {
  return MW('Submit Technical Report', `
    <div class="alert alert-info"><span>ðŸ“‹</span><span>Provide your technical assessment. You can attach a full report file.</span></div>
    <div class="form-group"><label class="form-label">Feasibility *</label>
      <select class="form-select" id="rptFeas"><option value="feasible">âœ“ Feasible</option>
        <option value="conditional">âš¡ Conditional / Partial</option><option value="not_feasible">âœ— Not Feasible</option></select></div>
    <div class="form-group"><label class="form-label">Summary *</label>
      <textarea class="form-textarea" id="rptSummary" rows="4" placeholder="Summarize the technical assessment..." required></textarea></div>
    <div class="form-group"><label class="form-label">Technical Notes</label>
      <textarea class="form-textarea" id="rptNotes" rows="3" placeholder="Routing, equipment, site-specific notes..."></textarea></div>
    <div class="form-group"><label class="form-label">Recommendation</label>
      <textarea class="form-textarea" id="rptRec" rows="3" placeholder="Proceed / conditions / risks..."></textarea></div>
    <div class="form-group"><label class="form-label">Attach Report File (optional)</label>
      <label class="upload-zone" id="rptDrop" style="padding:20px">
        <div class="uz-title" style="font-size:13px">Click or drop to attach</div>
        <div class="uz-sub">PDF, Word, Excel</div>
        <input type="file" id="rptFile" style="display:none" accept=".pdf,.doc,.docx,.xls,.xlsx">
      </label>
      <div id="rptFileName" style="font-size:12px;color:var(--text2);margin-top:4px"></div></div>`,
  `<button class="btn btn-ghost" id="mclose">Cancel</button><button class="btn btn-success" id="submitRptBtn">âœ“ Submit Report</button>`, 'modal-lg');
}

function mCreateBid() {
  return MW('Create Bid / Proposal Document', `
    <div class="form-group"><label class="form-label">Document Title</label>
      <input class="form-input" id="bidTitle" placeholder="e.g. Technical & Financial Bid â€” DMRC WAN"></div>
    <div class="form-group"><label class="form-label">Scope / Deliverables</label>
      <textarea class="form-textarea" id="bidScope" rows="3" placeholder="What your company will deliver..."></textarea></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Bid Price (â‚¹)</label>
        <input class="form-input" type="number" id="bidPrice" placeholder="0"></div>
      <div class="form-group"><label class="form-label">Validity</label>
        <input class="form-input" id="bidValid" placeholder="e.g. 90 days"></div>
    </div>
    <div class="form-group"><label class="form-label">Notes / Terms</label>
      <textarea class="form-textarea" id="bidNotes" rows="2" placeholder="Conditions, exclusions..."></textarea></div>
    <div class="form-group"><label class="form-label">Attach Document (optional)</label>
      <label class="upload-zone" id="bidDrop" style="padding:20px">
        <div class="uz-title" style="font-size:13px">Click or drop to attach</div>
        <div class="uz-sub">PDF, Word, Excel</div>
        <input type="file" id="bidFile" style="display:none" accept=".pdf,.doc,.docx,.xls,.xlsx">
      </label>
      <div id="bidFileName" style="font-size:12px;color:var(--text2);margin-top:4px"></div></div>
    <div class="form-group"><label class="form-label">Status</label>
      <select class="form-select" id="bidStatus"><option value="draft">Draft â€” continue editing</option>
        <option value="final">Final â€” mark complete & notify accounts</option></select></div>`,
  `<button class="btn btn-ghost" id="mclose">Cancel</button><button class="btn btn-primary" id="saveBidBtn">Save Bid Document</button>`, 'modal-lg');
}

function mCreateInvoice() {
  const tv = S.tender?.value||'';
  return MW('Create Invoice', `
    <div class="form-row">
      <div class="form-group"><label class="form-label">Invoice Number *</label>
        <input class="form-input" id="invNum" value="INV-${Date.now().toString().slice(-6)}"></div>
      <div class="form-group"><label class="form-label">Due Date</label>
        <input class="form-input" type="date" id="invDue"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Amount (â‚¹) *</label>
        <input class="form-input" type="number" id="invAmt" placeholder="0" value="${tv}"></div>
      <div class="form-group"><label class="form-label">GST / Tax (â‚¹)</label>
        <input class="form-input" type="number" id="invTax" placeholder="0"></div>
    </div>
    <div id="invTotal" style="font-size:15px;font-weight:700;color:var(--green);text-align:right;padding:6px 0">Total: â‚¹${parseFloat(tv||0).toLocaleString('en-IN')}</div>
    <div class="form-group"><label class="form-label">Notes</label>
      <textarea class="form-textarea" id="invNotes" rows="3" placeholder="Payment terms, bank details..."></textarea></div>`,
  `<button class="btn btn-ghost" id="mclose">Cancel</button><button class="btn btn-success" id="saveInvBtn">ðŸ’° Create Invoice</button>`);
}

function mOverride() {
  const LABELS = {draft:'Draft',uploaded:'Uploaded',technical_assigned:'Tech Review',technical_complete:'Tech Complete',bid_draft:'Bid Draft',bid_final:'Bid Ready',billing_pending:'Billing Pending',billed:'Billed',closed:'Closed'};
  return MW('âš¡ Admin Stage Override', `
    <div class="alert alert-warning"><span>âš ï¸</span><span>Bypasses normal workflow rules. Use only when necessary.</span></div>
    <div class="form-group"><label class="form-label">Current Stage</label><div>${stageBadge(S.tender?.stage)}</div></div>
    <div class="form-group"><label class="form-label">Move to Stage *</label>
      <select class="form-select" id="ovStage">${Object.entries(LABELS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Reason *</label>
      <textarea class="form-textarea" id="ovReason" rows="2" placeholder="Why are you overriding?" required></textarea></div>`,
  `<button class="btn btn-ghost" id="mclose">Cancel</button><button class="btn btn-danger" id="applyOverrideBtn">âš¡ Apply Override</button>`);
}

function mCreateUser() {
  return MW('Add New User', `
    <div class="form-row">
      <div class="form-group"><label class="form-label">Full Name *</label>
        <input class="form-input" id="nuName" placeholder="Full name"></div>
      <div class="form-group"><label class="form-label">Email *</label>
        <input class="form-input" type="email" id="nuEmail" placeholder="user@company.com"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Role *</label>
        <select class="form-select" id="nuRole"><option value="tender">Tender Manager</option>
          <option value="technical">Technical Team</option><option value="accounts">Accounts</option>
          <option value="management">Management</option><option value="admin">Admin</option></select></div>
      <div class="form-group"><label class="form-label">Department</label>
        <input class="form-input" id="nuDept" placeholder="Department"></div>
    </div>
    <div class="form-group"><label class="form-label">Password *</label>
      <input class="form-input" type="password" id="nuPass" placeholder="Initial password"></div>`,
  `<button class="btn btn-ghost" id="mclose">Cancel</button><button class="btn btn-primary" id="saveUserBtn">Create User</button>`);
}

// ---- Attach All Handlers ----
function attachAll() {
  $('logoutBtn')?.addEventListener('click', logout);

  // Sidebar nav
  document.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click', async()=>{
    S.page=b.dataset.nav; S.tenderId=null; S.tender=null; S.tab='overview';
    if (S.page==='admin') { await loadUsers(); await loadAudit(); }
    render();
  }));

  // Tender nav (row click)
  document.querySelectorAll('[data-tnav]').forEach(el=>el.addEventListener('click', async()=>{
    const id=el.dataset.tnav;
    S.tenderId=id; S.tab='overview'; S.notifOpen=false;
    // Set page context
    const t = S.tenders.find(x=>x.id===id);
    if (t) {
      const role=S.user?.role;
      if (role==='technical') S.page='technical';
      else if (role==='accounts') S.page='billing';
      else S.page='tenders';
    }
    await loadTender(id); render();
  }));

  // Back button
  $('backBtn')?.addEventListener('click', async()=>{
    S.tenderId=null; S.tender=null; S.tab='overview';
    await loadTenders(); render();
  });

  // Tabs
  document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{
    S.tab=b.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x.dataset.tab===S.tab));
    mount('tab-body', renderTab(S.tender,S.tab,S.user.role));
    attachTabHandlers();
  }));

  // Admin tabs
  document.querySelectorAll('[data-atab]').forEach(b=>b.addEventListener('click', async()=>{
    S.adminTab=b.dataset.atab;
    if(S.adminTab==='audit') await loadAudit();
    if(S.adminTab==='users') await loadUsers();
    document.querySelectorAll('[data-atab]').forEach(x=>x.classList.toggle('active',x.dataset.atab===S.adminTab));
    mount('atab-content',renderAdminTab());
    attachAdminHandlers();
  }));

  // Modal triggers are now handled by a global event listener on document

  // Notifications
  $('nb-btn')?.addEventListener('click', e=>{
    e.stopPropagation(); S.notifOpen=!S.notifOpen; render();
  });
  document.addEventListener('click', e=>{
    if (S.notifOpen && !$('npanel')?.contains(e.target) && !$('nb-btn')?.contains(e.target)) {
      S.notifOpen=false; render();
    }
  });

  // Read all
  $('rdAllBtn')?.addEventListener('click', async()=>{
    await api('PATCH','/notifications/read-all'); await loadNotifs(); render();
  });
  document.querySelectorAll('[data-nid]').forEach(el=>el.addEventListener('click', async()=>{
    await api('PATCH',`/notifications/${el.dataset.nid}/read`); await loadNotifs();
    if (el.dataset.tnav) { el.click(); }
  }));


  attachTabHandlers();
  attachAdminHandlers();
}

function attachTabHandlers() {
  // Drop zone on docs tab
  const dz=$('docDrop'),di=$('docFile');
  if(dz&&di){
    dz.addEventListener('click',()=>di.click());
    di.addEventListener('change',()=>{ if(di.files.length) handleDocUpload(di.files); });
    dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('drag-over');});
    dz.addEventListener('dragleave',()=>dz.classList.remove('drag-over'));
    dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('drag-over');if(e.dataTransfer.files.length)handleDocUpload(e.dataTransfer.files);});
  }

  // Requirements forms
  $('reqForm1')?.addEventListener('submit', async e=>{
    e.preventDefault(); const r=S.tender?.requirements||{};
    r.scope=$('reqScope')?.value||''; r.technical_specs=$('reqTech')?.value||'';
    await api('PATCH',`/tenders/${S.tenderId}`,{requirements:r}); await loadTender(S.tenderId);
    toast('Requirements saved!','success'); mount('tab-body',renderTab(S.tender,S.tab,S.user.role)); attachTabHandlers();
  });
  $('reqForm2')?.addEventListener('submit', async e=>{
    e.preventDefault(); const r=S.tender?.requirements||{};
    r.eligibility=$('reqElig')?.value||''; r.submission_info=$('reqSub')?.value||''; r.deadline=$('reqDeadline')?.value||'';
    await api('PATCH',`/tenders/${S.tenderId}`,{requirements:r}); await loadTender(S.tenderId);
    toast('Saved!','success'); mount('tab-body',renderTab(S.tender,S.tab,S.user.role)); attachTabHandlers();
  });
  // Action buttons on detail
  $('sendTechBtn')?.addEventListener('click', async()=>{
    try { await api('POST',`/tenders/${S.tenderId}/move`,{stage:'technical_assigned'}); await loadTender(S.tenderId); render(); toast('Sent to technical team!','success'); }
    catch(e){toast(e.message,'error');}
  });
  $('finalizeBidBtn')?.addEventListener('click', async()=>{
    try { await api('POST',`/tenders/${S.tenderId}/move`,{stage:'bid_final'}); await loadTender(S.tenderId); render(); toast('Bid finalized!','success'); }
    catch(e){toast(e.message,'error');}
  });
  $('markBilledBtn')?.addEventListener('click', async()=>{
    try { await api('POST',`/tenders/${S.tenderId}/move`,{stage:'billed'}); await loadTender(S.tenderId); render(); toast('Marked as billed!','success'); }
    catch(e){toast(e.message,'error');}
  });
  $('closeBtn')?.addEventListener('click', async()=>{
    try { await api('POST',`/tenders/${S.tenderId}/move`,{stage:'closed'}); await loadTender(S.tenderId); render(); toast('Tender closed','info'); }
    catch(e){toast(e.message,'error');}
  });
  $('sendInvBtn')?.addEventListener('click', async e=>{
    try { await api('PATCH',`/tenders/${S.tenderId}/invoice/${e.target.dataset.iid}`,{status:'sent'}); await loadTender(S.tenderId); mount('tab-body',renderTab(S.tender,S.tab,S.user.role)); attachTabHandlers(); toast('Invoice sent!','success'); }
    catch(ex){toast(ex.message,'error');}
  });
  $('markPaidBtn')?.addEventListener('click', async e=>{
    try { await api('PATCH',`/tenders/${S.tenderId}/invoice/${e.target.dataset.iid}`,{status:'paid'}); await loadTender(S.tenderId); mount('tab-body',renderTab(S.tender,S.tab,S.user.role)); attachTabHandlers(); toast('Marked as paid!','success'); }
    catch(ex){toast(ex.message,'error');}
  });
}

function attachAdminHandlers() {
  document.querySelectorAll('[data-toggle-user]').forEach(btn=>btn.addEventListener('click', async()=>{
    const newStatus = btn.dataset.status==='active'?'inactive':'active';
    try { await api('PATCH',`/users/${btn.dataset.toggleUser}`,{status:newStatus}); await loadUsers(); mount('atab-content',renderAdminTab()); attachAdminHandlers(); toast(`User ${newStatus}d`,'info'); }
    catch(e){toast(e.message,'error');}
  }));
}

async function handleDocUpload(files) {
  for (const file of files) {
    const fd = new FormData(); fd.append('file',file); fd.append('category','tender');
    try { await up(`/tenders/${S.tenderId}/documents`,fd); toast(`Uploaded: ${file.name}`,'success'); }
    catch(e){ toast(e.message,'error'); }
  }
  await loadTender(S.tenderId); mount('tab-body',renderTab(S.tender,S.tab,S.user.role)); attachTabHandlers();
}

// ---- Global Modal Delegation ----
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-modal]');
  if (btn) {
    const m = btn.dataset.modal;
    const html = {
      'create-tender':mCreateTender,'upload-doc':mUploadDoc,'submit-report':mSubmitReport,
      'create-bid':mCreateBid,'create-invoice':mCreateInvoice,'override-stage':mOverride,'create-user':mCreateUser
    }[m];
    if (html) showModal(html());
  }
});

// ---- Start ----
init();

