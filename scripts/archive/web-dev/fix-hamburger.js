const fs = require('fs');
const path = 'C:\\Users\\Suko\\Documents\\zenthis-protocol\\web\\index.html';
let c = fs.readFileSync(path, 'utf8');

// Add onclick to hamburger
c = c.replace(
  '<button class="hamburger" id="hamburger" aria-label="Menu">',
  '<button class="hamburger" id="hamburger" aria-label="Menu" onclick="document.getElementById(\'mobileMenu\').classList.toggle(\'open\')">'
);

// Add fallback inline script
c = c.replace(
  '</body>',
  '  <script>try{var h=document.getElementById("hamburger");var m=document.getElementById("mobileMenu");if(h&&m)h.onclick=function(){m.classList.toggle("open")}}catch(e){}</script>\r\n</body>'
);

fs.writeFileSync(path, c, 'utf8');
console.log('Done');
