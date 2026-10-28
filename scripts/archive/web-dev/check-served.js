const { execSync } = require("child_process");
const html = execSync('curl -s "https://zenthisprotocol.xyz/"').toString();
const i = html.indexOf("hamburger");
console.log("hamburger context:", html.substring(i, 200));
console.log("onclick found:", html.indexOf("onclick="));
console.log("fallback found:", html.indexOf("try{var h"));
console.log("closeBanner defined:", html.indexOf("function closeBanner"));
console.log("last 200 chars:", html.substring(html.length - 200));
