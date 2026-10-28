// Comprehensive cleanup of index.html
const fs = require('fs');
const path = 'C:\\Users\\Suko\\Documents\\zenthis-protocol\\web\\index.html';
let html = fs.readFileSync(path, 'utf8');

const changes = [];

function replace(oldStr, newStr, label) {
  if (html.includes(oldStr)) {
    html = html.replace(oldStr, newStr);
    changes.push(`✅ ${label}`);
  } else {
    changes.push(`❌ ${label} — NOT FOUND`);
  }
}

function removeBlock(marker, blockStart, blockEnd, label) {
  const idx = html.indexOf(marker);
  if (idx < 0) { changes.push(`❌ ${label} — marker not found`); return; }
  const start = html.lastIndexOf(blockStart, idx);
  const end = html.indexOf(blockEnd, idx + marker.length) + blockEnd.length;
  if (start < 0 || end < 0) { changes.push(`❌ ${label} — boundary not found`); return; }
  html = html.substring(0, start) + html.substring(end);
  changes.push(`✅ ${label} (${end - start} bytes)`);
}

function removeLineContaining(marker, label) {
  const idx = html.indexOf(marker);
  if (idx < 0) { changes.push(`❌ ${label} — not found`); return; }
  const lineStart = html.lastIndexOf('\n', idx);
  let lineEnd = html.indexOf('\n', idx);
  if (lineEnd < 0) lineEnd = html.length;
  // Also consume the next \r if present
  if (html[lineEnd] === '\r') lineEnd++;
  const removed = html.substring(lineStart, lineEnd);
  html = html.substring(0, lineStart) + html.substring(lineEnd);
  changes.push(`✅ ${label}: "${removed.trim().substring(0, 50)}..."`);
}

function replaceLine(marker, replacement, label) {
  const idx = html.indexOf(marker);
  if (idx < 0) { changes.push(`❌ ${label} — not found`); return; }
  const lineStart = html.lastIndexOf('\n', idx);
  let lineEnd = html.indexOf('\n', idx);
  if (lineEnd < 0) lineEnd = html.length;
  if (html[lineEnd] === '\r') lineEnd++;
  const oldLine = html.substring(lineStart, lineEnd);
  html = html.substring(0, lineStart) + '\n' + replacement + '\n' + html.substring(lineEnd);
  changes.push(`✅ ${label}`);
}

// ==================== CLEANUP ====================

// 1. PINK SALE — already done in earlier session but replace any remaining
replace('The IDO is launching on <strong>PinkSale</strong>.', 'The IDO will be hosted directly on the Zenthis website.', 'Waitlist PinkSale');
removeLineContaining('via PinkSale', 'Legend PinkSale');
removeBlock('<div class="ido-strip-item">', '<div class="ido-strip-item">', '</div>\n', 'Launchpad strip');
removeLineContaining('IDO on <strong>PinkSale</strong>', 'Roadmap PinkSale');
removeLineContaining('Public Sale (PinkSale IDO)', 'FAQ tokenomics PinkSale');
removeLineContaining('PinkSale</a>', 'FAQ question PinkSale link');

// 2. SEPOLIA / TESTNET
removeLineContaining('verified source code (Sepolia)', 'Sepolia in roadmap');
removeLineContaining('<strong>Sepolia mainnet</strong>', 'Sepolia in security');

// 3. IMMUNEFI & BUG BOUNTY
removeBlock('Immunefi Bug Bounty', '<div class="audit-card"', '</div>\n', 'Immunefi audit card');
removeBlock('bug bounty on Immunefi', '<div class="security-item"', '</div>\n', 'Immunefi security-item');
removeLineContaining('Bug Bounty</a>', 'Footer Bug Bounty link');

// 4. MULTISIG 9/12
removeBlock('9/12 Multisig', '<div class="security-item"', '</div>\n', '9/12 Multisig');

// 5. INSURANCE FUND (security-item + LP section + FAQ)
removeBlock('<h4>Insurance fund</h4>', '<div class="security-item"', '</div>\n', 'Insurance fund security-item');
removeBlock('insurance fund fed by 5% of protocol fees</strong>', '<div class="lp-insurance">', '</div>\n', 'LP insurance section');
removeLineContaining('insurance fund</strong> funded by 5%', 'FAQ insurance fund');

// 6. BURN / DEFLATIONARY
removeBlock('<h3>Dynamic Burn</h3>', '<div class="token-card featured"', '</div>\n', 'Dynamic Burn card');
removeBlock('Projected emission &amp; burn', '<div class="emission-timeline">', '</div>\n', 'Emission chart');
removeLineContaining('<li><strong>Dynamic Burn:</strong>', 'FAQ Dynamic Burn li');
removeLineContaining('<br/>Burn:', 'FAQ Burn line');
// Three mechanisms → Two
replace('Three mechanisms', 'Two core mechanisms', 'Three → Two mechanisms');

// 7. TBA DATES
replaceLine('Date TBA · Stay tuned', '<div class="countdown-date">Presale: 18 Jun - 2 Jul 2026</div>', 'Date TBA');
replaceLine('TGE · TBA', '<div class="phase-date">TGE · After presale (Jul 2026)</div>', 'TGE TBA');
replaceLine('Token Sale - Date TBA', '<h3>Presale Live (18 Jun - 2 Jul)</h3>', 'Token Sale heading');
replaceLine('Token sale date TBA', 'Presale live (18 Jun - 2 Jul). First 30 days after TGE with triple rewards', 'LP section TBA');
replaceLine('IDO date TBA', '<strong>Presale live (18 Jun - 2 Jul)</strong>', 'IDO date TBA');

// 8. 187 tests
removeLineContaining('187 unit + integration tests', 'Roadmap 187 tests');
removeLineContaining('<strong>187 unit + integration tests</strong>', 'Security 187 tests');

// 9. Seed 15% → 10% in FAQ
replace('<li><strong>15%</strong> — Seed Round', '<li><strong>10%</strong> — Seed Round', 'Seed 15% → 10%');

// 10. "Live - Phase 1" in chains section
replace('Live - Phase 1', 'Pre-Launch', 'Live chain → Pre-Launch');

fs.writeFileSync(path, html, 'utf8');
console.log(changes.join('\n'));
console.log(`\nFinal length: ${html.length}`);
