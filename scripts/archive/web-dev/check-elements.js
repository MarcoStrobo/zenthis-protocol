const fs = require("fs");
const c = fs.readFileSync("C:\\Users\\Suko\\Documents\\zenthis-protocol\\web\\index.html", "utf8");
console.log("heroCanvas:", c.indexOf("heroCanvas"));
console.log("donutChart:", c.indexOf("donutChart"));
console.log("hero section:", c.indexOf('<section class="hero"'));
console.log("cd-days:", c.indexOf("cd-days"));
