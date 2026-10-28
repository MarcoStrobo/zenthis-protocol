const { execSync } = require('child_process');
const main = execSync('curl -s "https://zenthisprotocol.xyz/js/main.js"').toString();

// Find the section structure
let sections = main.split('/* ───');
console.log('Sections found:', sections.length);
for (let i = 0; i < sections.length; i++) {
  const s = sections[i].substring(0, 100).replace(/\n/g, '\\n');
  console.log('Section ' + i + ': ' + s);
}
