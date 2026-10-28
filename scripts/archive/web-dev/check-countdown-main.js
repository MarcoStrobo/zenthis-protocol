const { execSync } = require("child_process");
const main = execSync('curl -s "https://zenthisprotocol.xyz/js/main.js"').toString();
// Section 9 - Countdown timer
const s9start = main.indexOf("COUNTDOWN TIMER");
const s10start = main.indexOf("FAQ ACCORDION");
console.log("Section 9 (Countdown Timer):");
console.log(main.substring(s9start, s10start));
