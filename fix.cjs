const fs = require('fs');
const file = 'public/app.js';
let c = fs.readFileSync(file, 'utf8');

// The file was likely read as utf-8, but written back with latin1/cp1252 bytes interpreted as utf-8.
// Let's try converting it back:
let fixed;
try {
    const buf = Buffer.from(c, 'latin1');
    fixed = buf.toString('utf8');
} catch (e) {
    fixed = c;
}

if (fixed.includes('—') && fixed.includes('₹') && !fixed.includes('â€”')) {
    fs.writeFileSync(file, fixed, 'utf8');
    console.log("Fixed via latin1->utf8");
} else {
    // maybe it's just a bunch of specific characters that we can manually replace
    const replacements = [
        ['â€”', '—'],
        ['â‚¹', '₹'],
        ['â—‹', '○'],
        ['â— ', '●'],
        ['âš™', '⚙'],
        ['âœ“', '✓'],
        ['âš–', '⚖'],
        ['â¨¯', '⨯'],
        ['ðŸšš', '🚚'],
        ['âŠž', '⊞'],
        ['â—ˆ', '◈'],
        ['ðŸ“Ž', '📎'],
        ['ðŸ“„', '📄'],
        ['ðŸ“ ', '📝'],
        ['ðŸ“Š', '📊'],
        ['ðŸ–¼ï¸ ', '🖼️'],
        ['â˜°', '☰'],
        ['ðŸ””', '🔔'],
        ['â »', '⏻'],
        ['â†’', '→']
    ];
    let manualFixed = c;
    for (let [bad, good] of replacements) {
        manualFixed = manualFixed.split(bad).join(good);
    }
    fs.writeFileSync(file, manualFixed, 'utf8');
    console.log("Fixed via manual replacements");
}
