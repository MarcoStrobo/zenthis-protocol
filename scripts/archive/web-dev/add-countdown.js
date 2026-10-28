const fs = require('fs');
let c = fs.readFileSync('C:\\Users\\Suko\\Documents\\zenthis-protocol\\web\\index.html', 'utf8');

// 1. Add CSS to the inline style overrides
const countdownCSS = `
  .presale-countdown {
    background: linear-gradient(135deg, #1a1a3e 0%, #0d0d2b 100%);
    border-bottom: 1px solid rgba(255, 215, 0, 0.2);
    padding: 8px 0;
    text-align: center;
    position: relative;
    z-index: 5;
  }
  .countdown-inner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .countdown-label {
    color: #ffd700;
    font-weight: 600;
    font-size: 0.95rem;
  }
  .countdown-timer {
    color: #fff;
    font-weight: 700;
    font-size: 1.1rem;
    font-family: 'Space Grotesk', monospace;
    letter-spacing: 0.5px;
  }
`;

// Add after the last </style> in head
const styleEnd = c.lastIndexOf('</style>');
const afterStyle = c.indexOf('</head>');
if (styleEnd > 0 && c.substring(styleEnd - 5, styleEnd) !== '</style') {
  // There are multiple style blocks, find the inline overrides one
}

// Find the inline overrides style tag
const overrideStart = c.indexOf('/* INLINE OVERRIDES');
if (overrideStart >= 0) {
  const closeStyle = c.indexOf('</style>', overrideStart);
  c = c.substring(0, closeStyle) + countdownCSS + c.substring(closeStyle);
} else {
  // Find any style tag before </head>
  const lastStyleClose = c.lastIndexOf('</style>', c.indexOf('</head>'));
  if (lastStyleClose >= 0) {
    c = c.substring(0, lastStyleClose) + countdownCSS + c.substring(lastStyleClose);
  }
}

// 2. Add countdown HTML between </nav> and hero section
const heroStart = c.indexOf('<section class="hero"');
const navEnd = c.indexOf('</nav>');
const countdownHTML = `
  <!-- ─── PRESALE COUNTDOWN ─── -->
  <div class="presale-countdown" id="presaleCountdown">
    <div class="container countdown-inner">
      <span class="countdown-label">🔸 Presale starts in</span>
      <span class="countdown-timer" id="countdownTimer">--d --:--:--</span>
    </div>
  </div>
`;
c = c.substring(0, navEnd + 6) + countdownHTML + c.substring(heroStart);

// 3. Add countdown JS to the inline script at the bottom
const closeBody = c.lastIndexOf('</body>');
const countdownJS = `
  // Presale countdown - start: 18 Jun 2026 14:00 CET
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
  })();
`;
c = c.substring(0, closeBody) + countdownJS + c.substring(closeBody);

fs.writeFileSync('C:\\Users\\Suko\\Documents\\zenthis-protocol\\web\\index.html', c, 'utf8');
console.log('Countdown added successfully');
console.log('Hero section present:', c.indexOf('<section class="hero"') > 0);
console.log('Countdown present:', c.indexOf('presaleCountdown') > 0);
