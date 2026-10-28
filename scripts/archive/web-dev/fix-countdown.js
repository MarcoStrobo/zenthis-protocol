const fs = require('fs');
let c = fs.readFileSync('C:\\Users\\Suko\\Documents\\zenthis-protocol\\web\\index.html', 'utf8');

// Fix: replace the bare JS with a proper script tag
const bareJS = `// Presale countdown - start: 18 Jun 2026 14:00 CET
  (function() {
    const target = new Date('2026-06-18T12:00:00Z'); // 14:00 CET = 12:00 UTC
    function pad(n) { return String(n).padStart(2, '0'); }
    function tick() {
      const diff = target - new Date();
      const el = document.getElementById('countdownTimer');
      if (!el) return;
      if (diff <= 0) {
        el.textContent = '🚀 PRESALE LIVE!';
        el.style.color = '#00ff88';
        return;
      }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      el.textContent = d + 'd ' + pad(h) + ':' + pad(m) + ':' + pad(s);
    }
    tick();
    setInterval(tick, 1000);
  })();`;

const wrappedJS = `  <script>` + bareJS + `\n  </script>`;

c = c.replace(bareJS, wrappedJS);

fs.writeFileSync('C:\\Users\\Suko\\Documents\\zenthis-protocol\\web\\index.html', c, 'utf8');
console.log('Fixed: countdown JS now wrapped in script tags');
console.log('Contains script tags:', c.indexOf('<script>\n  // Presale countdown') > 0);
