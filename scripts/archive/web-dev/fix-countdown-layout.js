const fs = require("fs");
const c = fs.readFileSync("C:\\Users\\Suko\\Documents\\zenthis-protocol\\web\\index.html", "utf8");

// Fix: Add margin-top to presale-countdown to account for fixed navbar
// Also improve hero padding-top to account for countdown
const oldCSS = `.presale-countdown {
    background: linear-gradient(135deg, #1a1a3e 0%, #0d0d2b 100%);
    border-bottom: 1px solid rgba(255, 215, 0, 0.2);
    padding: 8px 0;
    text-align: center;
    position: relative;
    z-index: 5;
  }`;

const newCSS = `.presale-countdown {
    background: linear-gradient(135deg, #1a1a3e 0%, #0d0d2b 100%);
    border-bottom: 1px solid rgba(255, 215, 0, 0.2);
    padding: 68px 0 8px;
    text-align: center;
    position: relative;
    z-index: 5;
  }`;

const result = c.replace(oldCSS, newCSS);
if (result === c) {
  console.log("ERROR: CSS replacement failed - string not found");
  // Find the actual CSS
  const i = c.indexOf(".presale-countdown");
  console.log("Actual CSS:", c.substring(i, i + 250));
} else {
  fs.writeFileSync("C:\\Users\\Suko\\Documents\\zenthis-protocol\\web\\index.html", result, "utf8");
  console.log("Fixed: added padding-top to presale-countdown");
}
