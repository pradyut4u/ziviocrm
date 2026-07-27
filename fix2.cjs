const fs = require('fs');
const file = 'public/app.js';
let c = fs.readFileSync(file, 'utf8');

c = c.split('ðŸ“‹').join('📋');
c = c.split(`    S.workspaces = ws && ws.length ? ws : [
      { id: 'IPNET-fallback', name: 'IPNET' },
      { id: 'ACIPL-fallback', name: 'ACIPL' }
    ];`).join(`    S.workspaces = ws || [];`);

fs.writeFileSync(file, c, 'utf8');
console.log("Done fixing clipboard emoji and workspace hardcoding.");
