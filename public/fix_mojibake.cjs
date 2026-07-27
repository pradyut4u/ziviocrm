const fs = require('fs');
const file = 'd:/tender ops/tenderops-fresh/public/app.js';
let content = fs.readFileSync(file, 'utf8');

const replacements = {
  'â€¢': '•',
  'âœ•': '✖',
  'âœ”': '✔',
  'â‚¹': '₹',
  'â†’': '→',
  'â†': '←',
  'â€”': '—',
  'Â·': '·',
  'Ã—': '×',
  'âš ': '⚠️'
};

for (const [bad, good] of Object.entries(replacements)) {
  content = content.split(bad).join(good);
}

fs.writeFileSync(file, content);
console.log('Fixed mojibake in app.js');
