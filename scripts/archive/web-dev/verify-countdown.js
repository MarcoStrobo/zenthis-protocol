const fs = require("fs");
const c = fs.readFileSync("C:\\Users\\Suko\\Documents\\zenthis-protocol\\web\\index.html", "utf8");
const navEnd = c.indexOf("</nav>");
const heroStart = c.indexOf('<section class="hero"');
console.log("Between nav and hero:");
console.log(c.substring(navEnd - 10, heroStart + 10));
console.log("---");
// Check countdown JS exists
console.log("Countdown JS present:", c.indexOf("Presale countdown") > 0);
console.log("Target date:", c.indexOf("2026-06-18T12:00:00Z") > 0);
console.log("CSS countdown present:", c.indexOf(".presale-countdown") > 0);
