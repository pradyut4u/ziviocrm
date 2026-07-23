const fs = require('fs');
const file = 'd:/tender ops/tenderops-fresh/public/analytics.js';
let content = fs.readFileSync(file, 'utf8');
content = content.replace(/\\\$\{/g, '${');
fs.writeFileSync(file, content);
