const { execSync } = require("child_process");
const main = execSync('curl -s "https://zenthisprotocol.xyz/js/main.js"').toString();
const i = main.indexOf("faq-question");
console.log(main.substring(i, i + 600));
