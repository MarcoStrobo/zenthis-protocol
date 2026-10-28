const { execSync } = require('child_process');
const main = execSync('curl -s "https://zenthisprotocol.xyz/js/main.js"').toString();

// Check each section from 4 onwards for potential errors
const sections = ['HERO CANVAS', 'COUNTER ANIMATION', 'INTERSECTION OBSERVER', 'DONUT CHART', 'SWAP DEMO', 'COUNTDOWN TIMER', 'FAQ ACCORDION'];
for (let s of sections) {
  const i = main.indexOf(s);
  const next = sections[sections.indexOf(s) + 1];
  const j = next ? main.indexOf(next) : main.length;
  if (i >= 0) {
    const code = main.substring(i, j);
    // Try to evaluate if it would throw
    console.log('Section: ' + s + ' (' + code.length + ' bytes)');
    console.log('Starts with:', code.substring(0, 80).replace(/\n/g, '\\n'));
    console.log('---');
  }
}
