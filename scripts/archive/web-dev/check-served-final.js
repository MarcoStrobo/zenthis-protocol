const { execSync } = require('child_process');
const url = 'https://zenthisprotocol.xyz/?cb=' + Date.now();
const h = execSync('curl -s "' + url + '"').toString();
const i = h.indexOf('Presale countdown');
console.log('Before countdown:', JSON.stringify(h.substring(i - 40, i)));
console.log('Has <script> tag before countdown:', h.substring(i - 40, i).indexOf('<script') >= 0);
console.log('Length:', h.length);
