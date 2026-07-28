const fs = require('fs');

let file = fs.readFileSync('d:/tender ops/tenderops-fresh/public/app.js', 'utf8');

// 1. Pipeline
file = file.replace(
  'function Pipeline(stage) {\n  const STEPS = [\n    {l:\'Ph1: Tender\',stages:[\'ph1_draft\',\'ph1_complete\']},\n    {l:\'Ph2: Technical\',stages:[\'ph2_active\',\'ph2_complete\']},\n    {l:\'Ph3: Award\',stages:[\'ph3_active\',\'ph3_awarded\',\'ph3_disqualified\']},\n    {l:\'Ph4: Delivery\',stages:[\'ph4_active\',\'ph4_complete\']},\n    {l:\'Ph5: Billing\',stages:[\'ph5_active\',\'closed\']}\n  ];',
  'function Pipeline(stage, cat) {\n  const isOrder = cat === \'order\';\n  let STEPS = [\n    {l:\'Ph1: Tender\',stages:[\'ph1_draft\',\'ph1_complete\']},\n    {l:\'Ph2: Technical\',stages:[\'ph2_active\',\'ph2_complete\']},\n    {l:\'Ph3: Award\',stages:[\'ph3_active\',\'ph3_awarded\',\'ph3_disqualified\']},\n    {l:\'Ph4: Delivery\',stages:[\'ph4_active\',\'ph4_complete\']},\n    {l:\'Ph5: Billing\',stages:[\'ph5_active\',\'closed\']}\n  ];\n  if (isOrder) STEPS = [\n    {l:\'Draft\', stages:[\'ph1_draft\']},\n    {l:\'Ph5: Billing\', stages:[\'ph5_active\',\'closed\']}\n  ];'
);

// 2. detailTabs
file = file.replace(
  'function detailTabs(t, role) {\n  const cat = t.data?.category;\n  if (cat === \'order\') return [{k:\'order_details\',l:\'Order Details\'}];',
  `function detailTabs(t, role) {
  const cat = t.data?.category;
  if (cat === 'order') {
    const tabs = [{k:'order_details',l:'Order Details'}];
    if (STAGES.indexOf(t.stage) >= STAGES.indexOf('ph5_active')) tabs.push({k:'billing',l:'Phase 5: Billing'});
    return tabs;
  }`
);

// 3. ActionBtns
file = file.replace(
  'function ActionBtns(t, role) {\n  const btns = [];\n  if (role === \'admin\') btns.push(`<button class="btn btn-ghost btn-sm" data-modal="override-stage">Override Stage</button>`);\n  \n  if (role === \'tender\' || role === \'admin\') {',
  'function ActionBtns(t, role) {\n  const btns = [];\n  if (role === \'admin\') btns.push(`<button class="btn btn-ghost btn-sm" data-modal="override-stage">Override Stage</button>`);\n  \n  if (t.data?.category === \'order\') return btns.join(\'\');\n\n  if (role === \'tender\' || role === \'admin\') {'
);

// 4. leadTabs
file = file.replace(
  'function leadTabs(t, role) {\n  const cat = t.data?.category;\n  if (cat === \'support\') return [{k:\'support_ticket\',l:\'Ticket Details\'}, {k:\'support_rca\',l:\'RCA & Notes\'}];\n  if (cat === \'inventory\') return [{k:\'inventory_stock\',l:\'Stock Details\'}, {k:\'inventory_movement\',l:\'Inward/Outward\'}];\n\n  const ALL = STAGES;',
  `function leadTabs(t, role) {
  const cat = t.data?.category;
  if (cat === 'support') return [{k:'support_ticket',l:'Ticket Details'}, {k:'support_rca',l:'RCA & Notes'}];
  if (cat === 'inventory') return [{k:'inventory_stock',l:'Stock Details'}, {k:'inventory_movement',l:'Inward/Outward'}];
  if (cat === 'order') {
    const tabs = [{k:'order_details',l:'Order Details'}];
    if (STAGES.indexOf(t.stage) >= STAGES.indexOf('ph5_active')) tabs.push({k:'billing',l:'Phase 5: Billing'});
    return tabs;
  }

  const ALL = STAGES;`
);

// 5. LeadActionBtns
file = file.replace(
  'function LeadActionBtns(t, role) {\n  const btns = [];\n  if (role === \'admin\') btns.push(`<button class="btn btn-ghost btn-sm" data-modal="override-stage">Override Stage</button>`);\n  \n  if (role === \'lead\' || role === \'admin\') {',
  'function LeadActionBtns(t, role) {\n  const btns = [];\n  if (role === \'admin\') btns.push(`<button class="btn btn-ghost btn-sm" data-modal="override-stage">Override Stage</button>`);\n  \n  if (t.data?.category === \'order\') return btns.join(\'\');\n\n  if (role === \'lead\' || role === \'admin\') {'
);

// 6. renderTab
file = file.replace(
  'function renderTab(t, tab, role) {\n    if (tab === \'order_details\') return TabOrder(t, role);',
  'function renderTab(t, tab, role) {\n    if (tab === \'order_details\') return TabOrderDetails(t, role, false);'
);

// 7. renderLeadTab
file = file.replace(
  'function renderLeadTab(t, tab, role) {\n    if (tab.startsWith(\'support_\')) return TabSupport(t, tab, role);',
  'function renderLeadTab(t, tab, role) {\n    if (tab === \'order_details\') return TabOrderDetails(t, role, true);\n    if (tab.startsWith(\'support_\')) return TabSupport(t, tab, role);'
);

// 8. Pipeline invocations
file = file.replace(/\$\{Pipeline\(t\.stage\)\}/g, '${Pipeline(t.stage, t.data?.category)}');

// 9. Modal updates
file = file.replace(
  '      <input type="hidden" id="ntCat" value="${cat}">\n      <input type="hidden" id="ntIsLead" value="${isLeadCat ? \'true\' : \'false\'}">\n      <div class="form-group"><label class="form-label">${isLeadCat ? \'Title / Subject\' : \'Reference / Bid Number\'} *</label><input type="text" id="ntBid" class="form-input"></div>\n      <div class="form-group"><label class="form-label">Description / Name</label><input type="text" id="ntTitle" class="form-input"></div>\n      <div class="form-group"><label class="form-label">Organisation / Customer Name</label><input type="text" id="ntOrg" class="form-input"></div>',
  `      <input type="hidden" id="ntCat" value="\${cat}">
      \${cat === 'order' ? '<div class="form-group" style="display:flex;align-items:center;gap:8px;"><input type="checkbox" id="ntIsLead" value="true"> <label for="ntIsLead" class="form-label" style="margin:0;cursor:pointer">Store as Lead (direct sales order)</label></div>' : '<input type="hidden" id="ntIsLead" value="'+(isLeadCat ? 'true' : 'false')+'">'}
      <div class="form-group"><label class="form-label">\${isLeadCat || cat === 'order' ? 'Reference / Order Number' : 'Reference / Bid Number'} *</label><input type="text" id="ntBid" class="form-input"></div>
      <div class="form-group"><label class="form-label">Description / Name</label><input type="text" id="ntTitle" class="form-input"></div>
      <div class="form-group"><label class="form-label">Customer / Organisation Name</label><input type="text" id="ntOrg" class="form-input"></div>
      \${cat === 'order' ? '<div class="form-group"><label class="form-label">Delivery Address</label><textarea id="ntAddress" class="form-input" rows="2"></textarea></div>' : ''}`
);

// 10. saveNewTenderBtn handling
file = file.replace(
  'await api(\'POST\',\'/leads\',{ title: bid, org_name: $(\'ntOrg\')?.value, data: { category: cat, description: $(\'ntTitle\')?.value }, stage: \'ph1_draft\' });',
  'await api(\'POST\',\'/leads\',{ title: bid, org_name: $(\'ntOrg\')?.value, data: { category: cat, description: $(\'ntTitle\')?.value, delivery_address: $(\'ntAddress\')?.value, customer_name: $(\'ntOrg\')?.value }, stage: \'ph1_draft\' });'
);
file = file.replace(
  'await api(\'POST\',\'/tenders\',{ bid_number: bid, title: $(\'ntTitle\')?.value, org_name: $(\'ntOrg\')?.value, data: { category: cat }, stage: \'ph1_draft\' });',
  'await api(\'POST\',\'/tenders\',{ bid_number: bid, title: $(\'ntTitle\')?.value, org_name: $(\'ntOrg\')?.value, data: { category: cat, delivery_address: $(\'ntAddress\')?.value, customer_name: $(\'ntOrg\')?.value, order_number: bid }, stage: \'ph1_draft\' });'
);


// 11. TabOrderDetails logic
const tabOrderDetails = `
function TabOrderDetails(t, role, isLead) {
  const edit = (role === 'admin' || role === 'mgmt');
  const d = t.data || {};
  const items = d.items || [];
  const customCols = d.custom_columns || [];
  
  const baseCols = ['Product Name', 'Qty', 'Price (₹)', 'GST %', 'Amount (₹)', 'Link', 'Description', 'Source of Purchase'];
  const allCols = [...baseCols, ...customCols];
  
  let totalAmt = 0;
  
  const trs = items.map((item, idx) => {
     let amount = 0;
     const qty = parseFloat(item['Qty']) || 0;
     const price = parseFloat(item['Price (₹)']) || 0;
     const gst = parseFloat(item['GST %']) || 0;
     amount = qty * price * (1 + (gst/100));
     totalAmt += amount;
     
     const tds = allCols.map(c => {
       if (c === 'Amount (₹)') {
         return \`<td><div class="kbd-val" style="padding:4px 8px;font-size:12px;background:#f9fafb;border-radius:4px;">₹\${amount.toFixed(2)}</div></td>\`;
       }
       return \`<td><input type="text" class="form-input tbl-input" style="font-size:12px;padding:4px;" data-row="\${idx}" data-col="\${esc(c)}" value="\${esc(item[c]||'')}"></td>\`;
     }).join('');
     
     return \`<tr>\${tds}<td style="width:40px"><button class="btn btn-ghost btn-sm text-red del-row-btn" data-row="\${idx}">×</button></td></tr>\`;
  }).join('');
  
  let docsHtml = '';
  const docs = t.documents || [];
  if (docs.length) {
    docsHtml = '<div style="margin-top:12px;display:flex;flex-direction:column;gap:8px;">' + docs.map(d => \`
      <div class="file-item">
        <div class="file-icon">\${fileIcon(d.mime)}</div>
        <div class="file-details">
          <div class="file-name"><a href="\${d.url}" target="_blank">\${esc(d.name)}</a></div>
          <div class="file-meta">\${fmt(d.size,'size')} • \${fmt(d.created_at,'date')}</div>
        </div>
        <button class="btn btn-ghost text-red del-doc-btn" data-id="\${d.id}">Delete</button>
      </div>
    \`).join('') + '</div>';
  } else {
    docsHtml = '<div class="empty" style="padding:16px"><div class="empty-icon">📁</div><div class="empty-title">No documents uploaded</div></div>';
  }

  return \`<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3>Order Details</h3>
      <button class="btn btn-primary btn-sm" id="btnSaveOrderHeader">Save Header</button>
    </div>
    <div class="form-grid">
      \${!isLead ? inputGroup('ord_num','Order Number',d.order_number,'text',edit) : ''}
      \${inputGroup('ord_cust','Customer Name',d.customer_name || t.org_name,'text',edit)}
      \${inputGroup('ord_addr','Delivery Address',d.delivery_address,'textarea',edit)}
    </div>
  </div>
  
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
      <h3>Items</h3>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-outline btn-sm" id="btnAddOrderCol">+ Add Column</button>
        <button class="btn btn-outline btn-sm" id="btnAddOrderRow">+ Add Row</button>
        <button class="btn btn-primary btn-sm" id="btnSaveOrderItems">Save Items</button>
        <button class="btn btn-primary btn-sm" id="btnExportOrderExcel" style="background:#10b981;border-color:#10b981">Export to Excel</button>
      </div>
    </div>
    <div class="table-wrap" style="overflow-x:auto;">
      <table style="min-width:800px;font-size:12px">
        <thead>
          <tr>
            \${allCols.map(c => \`<th style="white-space:nowrap">\${esc(c)}</th>\`).join('')}
            <th></th>
          </tr>
        </thead>
        <tbody>\${trs}</tbody>
        \${items.length ? \`<tfoot><tr>
           <td colspan="\${allCols.indexOf('Amount (₹)')}" style="text-align:right;font-weight:700">Total:</td>
           <td style="font-weight:700">₹\${totalAmt.toFixed(2)}</td>
           <td colspan="\${allCols.length - allCols.indexOf('Amount (₹)')}"></td>
        </tr></tfoot>\` : ''}
      </table>
      \${!items.length ? '<div class="empty" style="padding:20px"><div class="empty-title">No items added</div></div>' : ''}
    </div>
  </div>
  
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3>Documents</h3>
      <div style="display:flex;gap:8px;">
         <input type="file" id="orderDocsInput" multiple style="display:none">
         <button class="btn btn-outline btn-sm" onclick="document.getElementById('orderDocsInput').click()">+ Upload Files</button>
      </div>
    </div>
    \${docsHtml}
  </div>
  
  \${(role === 'admin' && t.stage !== 'ph5_active' && t.stage !== 'closed') ? \`<div class="card" style="border: 1px solid var(--border); background: #f8fafc;">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div>
        <h3 style="margin-bottom:4px">Finalise Order</h3>
        <div style="color:var(--text2);font-size:13px;">Skip to Phase 5 (Billing & Accounts)</div>
      </div>
      <button class="btn btn-primary" id="btnFinaliseOrder" style="background:var(--primary);font-size:14px;padding:8px 16px;">Finalise Order →</button>
    </div>
  </div>\` : ''}
  \`;
}
`;

const oldTabOrder = `function TabOrder(t, role) { 
  const edit = (role === 'admin' || role === 'mgmt');
  return \`<div class="card">
    <h3 style="margin-bottom:16px">Order Details</h3>
    <div class="form-grid">
      \${inputGroup('ord_po','Customer PO Number',t.ord_po,'text',edit)}
      \${inputGroup('ord_gem','GeM Contract',t.ord_gem,'text',edit)}
      \${inputGroup('ord_so','Sales Order ID',t.ord_so,'text',edit)}
      \${inputGroup('ord_svo','Service Order ID',t.ord_svo,'text',edit)}
      \${inputGroup('ord_cr','Change Requests',t.ord_cr,'text',edit)}
      \${inputGroup('ord_close','Order Closure Status',t.ord_close,'select',edit,['Pending','Closed'])}
    </div>
  </div>\`; 
}`;

file = file.replace(oldTabOrder, tabOrderDetails);

// Add event listeners for the new Order Details tab in attachTabHandlers()
const handlersToAdd = `
  $('btnSaveOrderHeader')?.addEventListener('click', async () => {
    const isLead = !!S.leadId;
    const id = isLead ? S.leadId : S.tenderId;
    const source = isLead ? S.leadItem : S.tender;
    const d = { ...(source.data || {}) };
    d.customer_name = $('ord_cust')?.value || '';
    d.delivery_address = $('ord_addr')?.value || '';
    if (!isLead) d.order_number = $('ord_num')?.value || '';
    try {
      await api('PATCH', \`/\${isLead ? 'leads' : 'tenders'}/\${id}\`, { data: d });
      if (isLead) await loadLead(id); else await loadTender(id);
      render(); toast('Header saved!','success');
    } catch(e) { toast(e.message,'error'); }
  });

  $('btnAddOrderRow')?.addEventListener('click', () => {
    const isLead = !!S.leadId;
    const source = isLead ? S.leadItem : S.tender;
    const d = { ...(source.data || {}) };
    if (!d.items) d.items = [];
    d.items.push({});
    source.data = d;
    mount('tab-body', renderTab(source, S.tab, S.user.role));
    attachTabHandlers();
  });

  $('btnAddOrderCol')?.addEventListener('click', () => {
    const c = prompt('Enter new column name:');
    if (!c || !c.trim()) return;
    const isLead = !!S.leadId;
    const source = isLead ? S.leadItem : S.tender;
    const d = { ...(source.data || {}) };
    if (!d.custom_columns) d.custom_columns = [];
    if (!d.custom_columns.includes(c.trim())) {
      d.custom_columns.push(c.trim());
      source.data = d;
      mount('tab-body', renderTab(source, S.tab, S.user.role));
      attachTabHandlers();
    }
  });

  document.querySelectorAll('.del-row-btn').forEach(btn => btn.addEventListener('click', (e) => {
    const idx = parseInt(e.target.dataset.row);
    const isLead = !!S.leadId;
    const source = isLead ? S.leadItem : S.tender;
    const d = { ...(source.data || {}) };
    if (d.items) d.items.splice(idx, 1);
    source.data = d;
    mount('tab-body', renderTab(source, S.tab, S.user.role));
    attachTabHandlers();
  }));
  
  // Real-time calculation on input change
  document.querySelectorAll('.tbl-input').forEach(inp => inp.addEventListener('input', (e) => {
    const isLead = !!S.leadId;
    const source = isLead ? S.leadItem : S.tender;
    const idx = parseInt(e.target.dataset.row);
    const col = e.target.dataset.col;
    if (!source.data.items) source.data.items = [];
    if (!source.data.items[idx]) source.data.items[idx] = {};
    source.data.items[idx][col] = e.target.value;
    
    // Simple re-render to update calc (could be optimized, but works fine for small tables)
    if (['Qty', 'Price (₹)', 'GST %'].includes(col)) {
      mount('tab-body', renderTab(source, S.tab, S.user.role));
      attachTabHandlers();
      // Refocus the input
      const newInp = document.querySelector(\`.tbl-input[data-row="\${idx}"][data-col="\${col}"]\`);
      if (newInp) { newInp.focus(); newInp.selectionStart = newInp.value.length; }
    }
  }));

  $('btnSaveOrderItems')?.addEventListener('click', async () => {
    const isLead = !!S.leadId;
    const id = isLead ? S.leadId : S.tenderId;
    const source = isLead ? S.leadItem : S.tender;
    
    // Flush current DOM values to state first
    const d = { ...(source.data || {}) };
    if (!d.items) d.items = [];
    document.querySelectorAll('.tbl-input').forEach(inp => {
       const idx = parseInt(inp.dataset.row);
       const col = inp.dataset.col;
       if (!d.items[idx]) d.items[idx] = {};
       d.items[idx][col] = inp.value;
    });
    
    try {
      await api('PATCH', \`/\${isLead ? 'leads' : 'tenders'}/\${id}\`, { data: d });
      if (isLead) await loadLead(id); else await loadTender(id);
      render(); toast('Items saved!','success');
    } catch(e) { toast(e.message,'error'); }
  });
  
  $('btnExportOrderExcel')?.addEventListener('click', () => {
    if (typeof XLSX === 'undefined') return toast('Excel exporter not loaded yet', 'error');
    const isLead = !!S.leadId;
    const source = isLead ? S.leadItem : S.tender;
    const d = source.data || {};
    const items = d.items || [];
    const baseCols = ['Product Name', 'Qty', 'Price (₹)', 'GST %', 'Amount (₹)', 'Link', 'Description', 'Source of Purchase'];
    const allCols = [...baseCols, ...(d.custom_columns || [])];
    
    const wsData = items.map(item => {
       const row = {};
       const qty = parseFloat(item['Qty']) || 0;
       const price = parseFloat(item['Price (₹)']) || 0;
       const gst = parseFloat(item['GST %']) || 0;
       const amt = qty * price * (1 + (gst/100));
       
       allCols.forEach(c => {
         row[c] = c === 'Amount (₹)' ? amt : (item[c] || '');
       });
       return row;
    });
    
    const ws = XLSX.utils.json_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Order Items");
    XLSX.writeFile(wb, \`Order_\${isLead ? source.title : source.bid_number}.xlsx\`);
  });
  
  $('orderDocsInput')?.addEventListener('change', async (e) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    const isLead = !!S.leadId;
    const id = isLead ? S.leadId : S.tenderId;
    const base = isLead ? 'leads' : 'tenders';
    try {
      toast(\`Uploading \${files.length} file(s)...\`, 'info');
      for (let i = 0; i < files.length; i++) {
        const fd = new FormData();
        fd.append('file', files[i]);
        await up(\`/\${base}/\${id}/documents\`, fd);
      }
      if (isLead) await loadLead(id); else await loadTender(id);
      render(); toast('Files uploaded!','success');
    } catch (err) { toast(err.message, 'error'); }
  });
  
  document.querySelectorAll('.del-doc-btn').forEach(btn => btn.addEventListener('click', async (e) => {
    if (!confirm('Delete this document?')) return;
    const docId = e.target.dataset.id;
    const isLead = !!S.leadId;
    try {
      // Need to use sbClient directly for deletes, but let's just make it simple
      await api('DELETE', \`/\${isLead ? 'leads' : 'tenders'}/\${isLead ? S.leadId : S.tenderId}/documents/\${docId}\`); 
      if (isLead) await loadLead(S.leadId); else await loadTender(S.tenderId);
      render(); toast('Document deleted!','success');
    } catch(err) { toast(err.message, 'error'); }
  }));

  $('btnFinaliseOrder')?.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to finalise this order and send it directly to Billing (Phase 5)?')) return;
    const isLead = !!S.leadId;
    const id = isLead ? S.leadId : S.tenderId;
    const base = isLead ? 'leads' : 'tenders';
    try {
      await api('POST', \`/\${base}/\${id}/move\`, { stage: 'ph5_active' });
      if (isLead) await loadLead(id); else await loadTender(id);
      S.tab = 'billing';
      render(); toast('Order finalised! Moved to Billing.','success');
    } catch (err) { toast(err.message, 'error'); }
  });

`;

file = file.replace('function attachTabHandlers() {\n', 'function attachTabHandlers() {\n' + handlersToAdd);


// Write file
fs.writeFileSync('d:/tender ops/tenderops-fresh/public/app.js', file);
console.log('Done replacing strings.');
