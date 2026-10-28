const fs = require("fs");
const path = "C:\\Users\\Suko\\Documents\\zenthis-protocol\\web\\index.html";
let html = fs.readFileSync(path, "utf8");
const ops = [];

// Read exact block by tracking from marker to proper closing
function exactBlock(marker, openTag, closeCount) {
  const idx = html.indexOf(marker);
  if (idx < 0) return null;
  const start = html.lastIndexOf(openTag, idx);
  if (start < 0) return null;
  let depth = 0;
  let pos = start + openTag.length;
  for (let found = 0; found < closeCount; found++) {
    const closePos = html.indexOf("</div>", pos);
    if (closePos < 0) return null;
    // Count open divs between pos and closePos
    let scan = pos;
    while (true) {
      const nextOpen = html.indexOf("<div", scan);
      if (nextOpen < 0 || nextOpen > closePos) break;
      depth++;
      scan = nextOpen + 4;
    }
    if (depth > 0) {
      depth--;
      pos = closePos + 6;
      found--; // Don't count this close because we have an open to match
    } else {
      pos = closePos + 6;
    }
    if (found >= closeCount - 1) {
      return html.substring(start, pos);
    }
  }
  return null;
}

// Remove by exact string
function removeExact(marker, openTag, closeCount, label) {
  const block = exactBlock(marker, openTag, closeCount);
  if (!block) {
    ops.push(`❌ ${label} — could not find block`);
    return;
  }
  html = html.replace(block, "");
  ops.push(`✅ ${label} (${block.length} bytes): "${block.substring(0, 60).trim()}"`);
}

// Remove line containing marker
function removeLine(marker, label) {
  const idx = html.indexOf(marker);
  if (idx < 0) {
    ops.push(`❌ ${label} — not found`);
    return;
  }
  const ls = html.lastIndexOf("\n", idx);
  let le = html.indexOf("\n", idx);
  if (le < 0) le = html.length;
  if (html[le] === "\r") le++;
  const line = html.substring(ls, le);
  html = html.substring(0, ls) + html.substring(le);
  ops.push(`✅ ${label}: "${line.trim().substring(0, 80)}..."`);
}

// Replace marker in line
function replaceInLine(marker, replacement, label) {
  const idx = html.indexOf(marker);
  if (idx < 0) {
    ops.push(`❌ ${label} — not found`);
    return;
  }
  const ls = html.lastIndexOf("\n", idx);
  let le = html.indexOf("\n", idx);
  if (le < 0) le = html.length;
  if (html[le] === "\r") le++;
  const line = html.substring(ls, le);
  const newLine = line.replace(marker, replacement);
  html = html.substring(0, ls) + newLine + html.substring(le);
  ops.push(`✅ ${label}: "${newLine.trim().substring(0, 80)}"`);
}

// === EXECUTE ===

// 1. Sepolia
removeLine("verified source code (Sepolia)", "Sepolia roadmap");
removeLine("<strong>Sepolia mainnet</strong>", "Sepolia security");

// 2. 187 tests
removeLine("187 unit + integration tests", "187 tests roadmap");
removeLine("<strong>187 unit", "187 tests security");

// 3. PinkSale remaining
removeLine("via PinkSale", "Legend PinkSale");
removeLine("IDO on <strong>PinkSale</strong>", "Roadmap PinkSale");
removeLine("Public Sale (PinkSale IDO)", "FAQ PinkSale");

// 4. Waitlist PinkSale
html = html.replace(
  "The IDO is launching on <strong>PinkSale</strong>. Whitelist members get guaranteed priority allocation before the public pool opens — plus early LP access and airdrop eligibility.",
  "The IDO will be hosted directly on the Zenthis website. Whitelist members get guaranteed priority allocation before the public pool opens — plus early LP access and airdrop eligibility.",
);
ops.push("✅ Waitlist PinkSale");

// 5. FAQ question PinkSale link
html = html.replace(
  '<p><strong>Token Sale date TBA</strong> — the IDO will be conducted on <strong><a href="https://pinksale.finance" target="_blank" rel="noopener" style="color:var(--primary)">PinkSale</a></strong>. Wallets registered on the whitelist at zenthisprotocol.xyz receive guaranteed priority allocation before the public pool opens. Once the whitelist round closes, any remaining tokens enter the public pool on a first-come, first-served basis.</p>',
  '<p><strong>Presale live now (18 Jun - 2 Jul)</strong> — join at <a href="/presale/" style="color:var(--primary)">zenthisprotocol.xyz/presale/</a>. Wallets registered on the whitelist receive guaranteed priority allocation. Public IDO will be hosted directly on the Zenthis website.</p>',
);
ops.push("✅ FAQ question PinkSale");

// 6. Remove Dynamic Burn featured card
removeExact("Dynamic Burn</h3>", '<div class="token-card featured"', 4, "Dynamic Burn card");

// 7. Remove emission chart
removeExact("Projected emission", '<div class="emission-timeline"', 6, "Emission chart");

// 8. Remove Immunefi card
removeExact("Immunefi Bug Bounty", '<div class="audit-card"', 5, "Immunefi audit card");

// 9. Remove Immunefi security-item
removeExact("bug bounty on Immunefi", '<div class="security-item"', 4, "Immunefi security-item");

// 10. Remove 9/12 multisig
removeExact("9/12 Multisig", '<div class="security-item"', 4, "9/12 Multisig");

// 11. Remove insurance fund
removeExact("Insurance fund</h4>", '<div class="security-item"', 4, "Insurance fund sec-item");

// 12. Remove LP insurance section
removeExact("insurance fund fed by 5%", '<div class="lp-insurance"', 2, "LP insurance");

// 13. Remove FAQ insurance
removeLine("insurance fund</strong> funded by 5%", "FAQ insurance");

// 14. Remove FAQ Dynamic Burn li
removeLine("Dynamic Burn:</strong>", "FAQ Dynamic Burn li");

// 15. Remove FAQ Burn line
removeLine("Burn: estimated 2-5%", "FAQ Burn line");

// 16. Three → Two
html = html.replace(
  "Three mechanisms create organic demand and progressive deflation",
  "Two core mechanisms create organic demand",
);
ops.push("✅ Three → Two mechanisms");

// 17. TBA dates
replaceInLine("Date TBA · Stay tuned", "Presale: 18 Jun - 2 Jul 2026", "Date TBA");
replaceInLine("TGE · TBA", "TGE · After presale (Jul 2026)", "TGE TBA");
replaceInLine("Token sale date TBA", "Presale live (18 Jun - 2 Jul)", "LP section TBA");
replaceInLine("IDO date TBA</strong>", "Presale live (18 Jun - 2 Jul)</strong>", "IDO date TBA");

// 18. Nav burn
html = html.replace(
  "<small>Staking, burn &amp; governance</small>",
  "<small>Staking &amp; governance</small>",
);
ops.push("✅ Nav burn");

// 19. Hero deflationary
html = html.replace(
  "Hard-capped total supply. Zero inflation from year 1. Deflationary burn" +
    "\n" +
    "        activated from the very first swap.",
  "Hard-capped total supply. Zero inflation from year 1.",
);
ops.push("✅ Hero deflationary");

// 20. Seed 15% → 10%
html = html.replace(
  "<li><strong>15%</strong> — Seed Round · $0.04 per token · 6-month cliff, then linear over 24 months</li>",
  "<li><strong>10%</strong> — Seed Round · $0.04 per token · 6-month cliff, then linear over 24 months</li>",
);
ops.push("✅ Seed 15% → 10%");

// 21. Security text
html = html.replace(
  "all 3 core contracts (ZenthisToken, HTLC, Vesting). Contracts are deployed and verified on",
  "all 3 core contracts (ZenthisToken, HTLC, Vesting). Contracts are deployed and verified on",
);
html = html.replace(
  "<strong>Sepolia mainnet</strong> with <strong>187 unit + integration tests</strong> at 100% pass rate. An external audit (CertiK or Trail of Bits) is scheduled before mainnet launch.",
  "<strong>Base mainnet</strong>. 187 unit + integration tests at 100% pass rate.",
);
ops.push("✅ Security text");

// 22. Footer Bug Bounty link
removeLine("Bug Bounty</a>", "Footer Bug Bounty");

// === WRITE ===
fs.writeFileSync(path, html, "utf8");
console.log(ops.join("\n"));

// Verify remaining
const verify = fs.readFileSync(path, "utf8");
console.log("\n=== VERIFY ===");
for (const term of [
  "PinkSale",
  "Sepolia",
  "Immunefi",
  "Bug Bounty",
  "9/12",
  "insurance fund",
  "Deflationary",
  "Dynamic Burn",
  "187 unit",
  "TBA",
  "1.5M",
  "15M",
]) {
  const count = (verify.match(new RegExp(term, "g")) || []).length;
  console.log(`${term}: ${count}`);
}
console.log(`\nFinal length: ${verify.length}`);
