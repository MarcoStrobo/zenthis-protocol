const { execSync } = require("child_process");
const main = execSync('curl -s "https://zenthisprotocol.xyz/js/main.js"').toString();
// Show the hero canvas section in detail
const i = main.indexOf("HERO CANVAS");
const j = main.indexOf("/* ─── COUNTER");
console.log("Hero canvas section:");
console.log(main.substring(i, j));
