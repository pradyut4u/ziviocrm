const fs = require('fs');
let file = fs.readFileSync('d:/tender ops/tenderops-fresh/public/app.js', 'utf8');

file = file.replace(
  /\$\{isAcipl && \['admin','mgmt'\]\.includes\(role\)\?`<button class="btn btn-primary btn-sm" id="btnDashNewOrder">\+ New Order<\/button>`:''\}/,
  '${isAcipl && [\'admin\',\'mgmt\',\'tender\',\'lead\'].includes(role)?`<button class="btn btn-primary btn-sm" id="btnDashNewOrder">+ New Order</button>`:\'\'}'
);

file = file.replace(
  /\{ label: '\+ New Order', id: 'btnDashNewOrder', iconKey: 'tender', show: \['admin','mgmt'\]\.includes\(role\) \},/,
  '{ label: \'+ New Order\', id: \'btnDashNewOrder\', iconKey: \'tender\', show: [\'admin\',\'mgmt\',\'tender\',\'lead\'].includes(role) },'
);

file = file.replace(
  /\$\{isAcipl && \['admin','mgmt'\]\.includes\(role\)\?`<button class="btn btn-primary" id="btnDashNewOrder">\+ New Order<\/button>`:''\}/g,
  '${isAcipl && [\'admin\',\'mgmt\',\'tender\',\'lead\'].includes(role)?`<button class="btn btn-primary" id="btnDashNewOrder">+ New Order</button>`:\'\'}'
);

fs.writeFileSync('d:/tender ops/tenderops-fresh/public/app.js', file);
console.log('Done');
