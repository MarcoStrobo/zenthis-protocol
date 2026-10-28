const { execSync } = require("child_process");
const html = execSync('curl -s "https://zenthisprotocol.xyz/"').toString();
const i = html.indexOf('hamburger" id="hamburger"');
console.log("hamburger line:", html.substring(i, 200));
