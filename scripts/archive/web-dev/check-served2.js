const { execSync } = require('child_process');
const html = execSync('curl.exe -s "https://zenthisprotocol.xyz/?t=' + Date.now() + '"').toString();

// Find hamburger
let idx = html.indexOf('class="hamburger"');
if (idx < 0) idx = html.indexOf('aria-label="Menu"');
console.log('hamburger at:', idx);
if (idx >= 0) {
  const end = Math.min(html.length, idx + 200);
  console.log('context:', html.substring(idx, end));
} else {
  console.log('hamburger NOT found');
  // Show what's in nav section
  let navIdx = html.indexOf('<nav');
  console.log('nav:', html.substring(navIdx, navIdx + 800));
}

// Also check fallback script
const fbIdx = html.indexOf('try{var h=document.getElementById');
console.log('fallback script at:', fbIdx);
if (fbIdx >= 0) {
  console.log('fallback:', html.substring(fbIdx, fbIdx + 150));
}
