const { execSync } = require("child_process");
const main = execSync('curl -s "https://zenthisprotocol.xyz/js/main.js"').toString();
const i = main.indexOf("faq-question");
console.log("Full FAQ accordion code:");
console.log(main.substring(i, i + 350));
// Also check the HTML structure
console.log("---");
console.log("Prev 50 chars before faq-question:", JSON.stringify(main.substring(i - 50, i)));
