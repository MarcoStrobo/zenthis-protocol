const fs = require('fs');
let main = fs.readFileSync('C:\\Users\\Suko\\Documents\\zenthis-protocol\\web\\js\\main.js', 'utf8');

// Wrap the hero canvas IIFE in try/catch
const heroStart = main.indexOf('/* ─── HERO CANVAS');
const heroCodeStart = main.indexOf('(function () {', heroStart);
const heroEnd = main.indexOf('/* ─── COUNTER', heroStart);

const oldHero = main.substring(heroStart, heroEnd);
const newHero = '/* ─── HERO CANVAS — PARTICLE NETWORK ─── */\ntry {\n' +
  main.substring(heroCodeStart, heroEnd) + '\n} catch(e) { console.warn("Hero canvas error:", e); }';

main = main.substring(0, heroStart) + newHero + main.substring(heroEnd);

// Also wrap the swap demo (might also throw)
const swapStart = main.indexOf('/* ─── SWAP DEMO');
const swapCodeStart = main.indexOf('(function () {', swapStart);
const swapEnd = main.indexOf('/* ─── COUNTDOWN', swapStart);

const oldSwap = main.substring(swapStart, swapEnd);
const newSwap = '/* ─── SWAP DEMO ─── */\ntry {\n' +
  main.substring(swapCodeStart, swapEnd) + '\n} catch(e) { console.warn("Swap demo error:", e); }';

main = main.substring(0, swapStart) + newSwap + main.substring(swapEnd);

// Also wrap the donut chart
const donutStart = main.indexOf('/* ─── DONUT CHART');
const donutCodeStart = main.indexOf('(function () {', donutStart);
const donutEnd = main.indexOf('/* ─── SWAP DEMO', donutStart);

const oldDonut = main.substring(donutStart, donutEnd);
const newDonut = '/* ─── DONUT CHART ─── */\ntry {\n' +
  main.substring(donutCodeStart, donutEnd) + '\n} catch(e) { console.warn("Donut chart error:", e); }';

main = main.substring(0, donutStart) + newDonut + main.substring(donutEnd);

// Also wrap the countdown timer  
const cdStart = main.indexOf('/* ─── COUNTDOWN TIMER');
const cdCodeStart = main.indexOf('(function () {', cdStart);
const cdEnd = main.indexOf('/* ─── FAQ ACCORDION', cdStart);

const oldCD = main.substring(cdStart, cdEnd);
const newCD = '/* ─── COUNTDOWN TIMER ─── */\ntry {\n' +
  main.substring(cdCodeStart, cdEnd) + '\n} catch(e) { console.warn("Countdown timer error:", e); }';

main = main.substring(0, cdStart) + newCD + main.substring(cdEnd);

fs.writeFileSync('C:\\Users\\Suko\\Documents\\zenthis-protocol\\web\\js\\main.js', main, 'utf8');
console.log('Wrapped hero canvas, donut chart, swap demo, and countdown timer in try/catch');
console.log('Main.js length:', main.length);
