const fs = require('fs');
const c = fs.readFileSync('C:\\Users\\Suko\\Documents\\zenthis-protocol\\web\\index.html', 'utf8');
console.log('onclick attr:', c.indexOf('onclick="document'));
console.log('fallback script:', c.indexOf('try{var h=document'));
console.log('script count:', (c.match(/<script/g)||[]).length);
console.log('close count:', (c.match(/<\/script>/g)||[]).length);
const i = c.indexOf('hamburger');
console.log('hamburger html:', c.substring(i, i+180));
