const { execSync } = require('child_process');
const main = execSync('curl -s "https://zenthisprotocol.xyz/js/main.js"').toString();

// Look for FAQ/accordion related JS
let keywords = ['accordion', 'faq', 'toggle', 'faq-toggle', 'faq-answer', 'faq-question'];
for (let kw of keywords) {
  let i = main.indexOf(kw);
  if (i >= 0) {
    console.log('Found "' + kw + '" at', i, ':', main.substring(i, i + 120));
  } else {
    console.log('"' + kw + '" NOT found in main.js');
  }
}

console.log('---');
// Also check for any event listeners on FAQ buttons
let clickIdx = main.indexOf('click');
console.log('First "click" at', clickIdx, ':', main.substring(clickIdx, clickIdx + 80));

// Check classList.toggle patterns
let toggleIdx = main.indexOf('classList.toggle');
let count = 0;
while (toggleIdx >= 0 && count < 5) {
  console.log('classList.toggle at', toggleIdx, ':', main.substring(Math.max(0, toggleIdx - 30), toggleIdx + 60));
  toggleIdx = main.indexOf('classList.toggle', toggleIdx + 1);
  count++;
}
