const fs = require('fs');
let c = fs.readFileSync('C:\\Users\\Suko\\Documents\\zenthis-protocol\\web\\index.html', 'utf8');

// Add inline style overrides before </head> to hide desktop nav-links/cta
const override = `<style>
  /* INLINE OVERRIDES - bypass Cloudflare cache */
  .nav-links, .nav-cta { display: none !important; }
  .hamburger { display: flex !important; }
  .mobile-menu { display: none; }
  .mobile-menu.open { display: flex !important; }
  @media (max-width: 768px) {
    .nav-cta-app { display: none !important; }
    .btn.btn-app[style*="margin-left"] { display: none !important; }
  }
</style>
`;

c = c.replace('</head>', override + '</head>');
fs.writeFileSync('C:\\Users\\Suko\\Documents\\zenthis-protocol\\web\\index.html', c, 'utf8');
console.log('Added inline overrides');
