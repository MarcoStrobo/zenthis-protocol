/* ─── NAVBAR SCROLL ─── */
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 40);
});

/* ─── DROPDOWN NAV ─── */
document.querySelectorAll('.nav-dropdown').forEach(dropdown => {
  const btn = dropdown.querySelector('.nav-drop-btn');

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains('open');
    // close all
    document.querySelectorAll('.nav-dropdown.open').forEach(d => d.classList.remove('open'));
    if (!isOpen) dropdown.classList.add('open');
  });
});

// close on outside click
document.addEventListener('click', () => {
  document.querySelectorAll('.nav-dropdown.open').forEach(d => d.classList.remove('open'));
});

// close on nav link click
document.querySelectorAll('.nav-drop-menu a').forEach(a => {
  a.addEventListener('click', () => {
    document.querySelectorAll('.nav-dropdown.open').forEach(d => d.classList.remove('open'));
  });
});

/* ─── HAMBURGER ─── */
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobileMenu');
hamburger.addEventListener('click', () => {
  mobileMenu.classList.toggle('open');
});
mobileMenu.querySelectorAll('a').forEach(a => {
  a.addEventListener('click', () => mobileMenu.classList.remove('open'));
});

/* ─── HERO CANVAS — PARTICLE NETWORK ─── */
(function () {
  const canvas = document.getElementById('heroCanvas');
  const ctx = canvas.getContext('2d');
  let W, H, particles;

  const COUNT = 60;
  const LINK_DIST = 150;
  const COLORS = ['#7c3aed', '#06b6d4', '#9d5df5', '#22d3ee', '#10b981'];

  function resize() {
    W = canvas.width = canvas.offsetWidth;
    H = canvas.height = canvas.offsetHeight;
  }

  function makeParticle() {
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - .5) * .4,
      vy: (Math.random() - .5) * .4,
      r: Math.random() * 2.5 + 1,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    };
  }

  function init() {
    resize();
    particles = Array.from({ length: COUNT }, makeParticle);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > W) p.vx *= -1;
      if (p.y < 0 || p.y > H) p.vy *= -1;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = .7;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < LINK_DIST) {
          const alpha = (1 - dist / LINK_DIST) * .25;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = particles[i].color;
          ctx.globalAlpha = alpha;
          ctx.lineWidth = .8;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }

    requestAnimationFrame(draw);
  }

  init();
  draw();
  window.addEventListener('resize', init);
})();

/* ─── COUNTER ANIMATION ─── */
function animateCounter(el, target, duration = 1800) {
  const start = performance.now();
  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.floor(ease * target).toLocaleString('en-US');
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ─── INTERSECTION OBSERVER — FADE-UP + COUNTERS ─── */
const io = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('visible');

    const counter = entry.target.querySelector('[data-target]');
    if (counter && !counter.dataset.animated) {
      counter.dataset.animated = '1';
      animateCounter(counter, parseInt(counter.dataset.target));
    }

    io.unobserve(entry.target);
  });
}, { threshold: 0.15 });

document.querySelectorAll(
  '.section-title, .section-sub, .problem-card, .how-step, ' +
  '.token-card, .audit-card, .security-item, .lp-mode, ' +
  '.legend-item, .phase, .buy-step, .hero-stats, .whitepaper-cta, ' +
  '.faq-item, .rm-item, .team-card, .team-foundation'
).forEach(el => {
  el.classList.add('fade-up');
  io.observe(el);
});

/* also observe hero-stats parent for counter */
const heroStats = document.querySelector('.hero-stats');
if (heroStats) {
  const statObserver = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    const counter = entry.target.querySelector('[data-target]');
    if (counter && !counter.dataset.animated) {
      counter.dataset.animated = '1';
      animateCounter(counter, parseInt(counter.dataset.target));
    }
    statObserver.unobserve(entry.target);
  }, { threshold: 0.3 });
  statObserver.observe(heroStats);
}

/* ─── DONUT CHART ─── */
(function () {
  const canvas = document.getElementById('donutChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const data = [
    { pct: 35, color: '#7c3aed', label: 'Public Sale & Seed' },
    { pct: 25, color: '#06b6d4', label: 'Liquidity Rewards' },
    { pct: 10, color: '#10b981', label: 'Team & Dev' },
    { pct: 20, color: '#f59e0b', label: 'Treasury & Founder Ops' },
    { pct: 10, color: '#ef4444', label: 'Community Airdrop' },
  ];

  let hovered = -1;
  const CX = canvas.width / 2;
  const CY = canvas.height / 2;
  const R_OUT = 130;
  const R_IN  = 82;
  const GAP   = 0.025;

  function drawChart() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let angle = -Math.PI / 2;

    data.forEach((seg, i) => {
      const sweep = (seg.pct / 100) * Math.PI * 2 - GAP;
      const isHov = i === hovered;
      const rOut = isHov ? R_OUT + 10 : R_OUT;

      ctx.beginPath();
      ctx.moveTo(CX, CY);
      ctx.arc(CX, CY, rOut, angle + GAP / 2, angle + sweep + GAP / 2);
      ctx.arc(CX, CY, R_IN, angle + sweep + GAP / 2, angle + GAP / 2, true);
      ctx.closePath();

      if (isHov) {
        ctx.shadowColor = seg.color;
        ctx.shadowBlur = 20;
      }
      ctx.fillStyle = seg.color;
      ctx.globalAlpha = isHov ? 1 : 0.85;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      angle += sweep + GAP;
    });
  }

  drawChart();

  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width) - CX;
    const my = (e.clientY - rect.top) * (canvas.height / rect.height) - CY;
    const dist = Math.sqrt(mx * mx + my * my);

    if (dist < R_IN || dist > R_OUT + 12) {
      if (hovered !== -1) { hovered = -1; drawChart(); }
      return;
    }

    let angle = Math.atan2(my, mx) - (-Math.PI / 2);
    if (angle < 0) angle += Math.PI * 2;

    let cumulative = 0;
    let found = -1;
    data.forEach((seg, i) => {
      const sweep = (seg.pct / 100) * Math.PI * 2;
      if (angle >= cumulative && angle < cumulative + sweep) found = i;
      cumulative += sweep;
    });

    if (found !== hovered) {
      hovered = found;
      drawChart();
      // highlight legend
      document.querySelectorAll('.legend-item').forEach((el, i) => {
        el.classList.toggle('active', i === hovered);
      });
    }
  });

  canvas.addEventListener('mouseleave', () => {
    hovered = -1;
    drawChart();
    document.querySelectorAll('.legend-item').forEach(el => el.classList.remove('active'));
  });

  // legend hover → highlight chart
  document.querySelectorAll('.legend-item').forEach((el, i) => {
    el.addEventListener('mouseenter', () => { hovered = i; drawChart(); });
    el.addEventListener('mouseleave', () => { hovered = -1; drawChart(); });
  });
})();

/* ─── SWAP DEMO ─── */
(function () {
  const PRICES = { ETH: 2803.55, USDC: 1, ARB: 1.12, WBTC: 63420, MATIC: 0.71, WETH: 2803.55, POL: 0.71 };
  const CHAINS  = {
    arbitrum:  { name: 'Arbitrum',  sym: '◆' },
    ethereum:  { name: 'Ethereum',  sym: 'Ξ'  },
    optimism:  { name: 'Optimism',  sym: '○'  },
    bnb:       { name: 'BNB Chain', sym: '◉'  },
    avalanche: { name: 'Avalanche', sym: '▲'  },
    polygon:   { name: 'Polygon',   sym: '⬡'  },
  };

  let fromChain = 'arbitrum';
  let toChain   = 'polygon';

  const fromAmountEl = document.getElementById('fromAmount');
  const toAmountEl   = document.getElementById('toAmount');
  const fromUsdEl    = document.getElementById('fromUsd');
  const toUsdEl      = document.getElementById('toUsd');
  const fromTokenEl  = document.getElementById('fromToken');
  const toTokenEl    = document.getElementById('toToken');
  const swapRateEl   = document.getElementById('swapRate');
  const swapBtn      = document.getElementById('swapBtn');
  const fromChainEl  = document.querySelector('#fromChainSelect .chain-option');
  const toChainEl    = document.querySelector('#toChainSelect .chain-option');

  function getPrice(sym) { return PRICES[sym] || 1; }

  function updateSwap() {
    const fromSym = fromTokenEl ? fromTokenEl.value : 'ETH';
    const toSym   = toTokenEl   ? toTokenEl.value   : 'MATIC';
    const amt     = parseFloat(fromAmountEl ? fromAmountEl.value : 0) || 0;

    const fromUsd = amt * getPrice(fromSym);
    const toAmt   = fromUsd > 0 ? (fromUsd * 0.999) / getPrice(toSym) : 0;

    if (toAmountEl) toAmountEl.textContent = toAmt > 0 ? toAmt.toFixed(4) : '—';
    if (fromUsdEl)  fromUsdEl.textContent  = amt > 0 ? `≈ $${fromUsd.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})} USD` : '';
    if (toUsdEl)    toUsdEl.textContent    = toAmt > 0 ? `≈ $${(toAmt * getPrice(toSym)).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})} USD` : '';
    if (swapRateEl && amt > 0) {
      const rate = getPrice(fromSym) / getPrice(toSym);
      swapRateEl.textContent = `1 ${fromSym} = ${rate.toFixed(4)} ${toSym}`;
    } else if (swapRateEl) {
      swapRateEl.textContent = 'Enter an amount';
    }
  }

  function setChainDisplay(target, chainKey) {
    const data = CHAINS[chainKey];
    const el   = target === 'from' ? fromChainEl : toChainEl;
    if (el && data) {
      el.querySelector('.chain-sym').textContent = data.sym;
      el.querySelector('.chain-name').textContent = ' ' + data.name;
    }
  }

  /* chain chip clicks */
  document.querySelectorAll('.csp-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const target = chip.dataset.target;
      const chain  = chip.dataset.chain;

      /* prevent same chain on both sides */
      if (target === 'from' && chain === toChain) return;
      if (target === 'to'   && chain === fromChain) return;

      if (target === 'from') fromChain = chain;
      else                   toChain   = chain;

      /* update active chip */
      document.querySelectorAll(`.csp-chip[data-target="${target}"]`).forEach(c => c.classList.remove('active'));
      chip.classList.add('active');

      setChainDisplay(target, chain);
      updateSwap();
    });
  });

  /* flip */
  const flipBtn = document.getElementById('flipBtn');
  if (flipBtn) {
    flipBtn.addEventListener('click', () => {
      [fromChain, toChain] = [toChain, fromChain];

      document.querySelectorAll('.csp-chip[data-target="from"]').forEach(c => {
        c.classList.toggle('active', c.dataset.chain === fromChain);
      });
      document.querySelectorAll('.csp-chip[data-target="to"]').forEach(c => {
        c.classList.toggle('active', c.dataset.chain === toChain);
      });

      setChainDisplay('from', fromChain);
      setChainDisplay('to',   toChain);
      updateSwap();
    });
  }

  if (fromAmountEl) fromAmountEl.addEventListener('input', updateSwap);
  if (fromTokenEl)  fromTokenEl.addEventListener('change', updateSwap);
  if (toTokenEl)    toTokenEl.addEventListener('change', updateSwap);

  /* animated swap execution */
  if (swapBtn) {
    swapBtn.addEventListener('click', () => {
      const amt = parseFloat(fromAmountEl ? fromAmountEl.value : 0);
      if (!amt || amt <= 0) return;

      const progress = document.getElementById('swapProgress');
      const steps    = [document.getElementById('sp1'), document.getElementById('sp2'),
                        document.getElementById('sp3'), document.getElementById('sp4')];
      const result   = document.getElementById('spResult');

      if (!progress) return;

      /* reset */
      steps.forEach(s => { if (s) { s.classList.remove('done','active'); s.querySelector('.sp-dot').className = 'sp-dot'; } });
      if (result) result.textContent = '';
      progress.style.display = 'block';

      swapBtn.disabled = true;
      swapBtn.textContent = 'Swapping…';

      const delays = [0, 800, 1800, 3000];
      steps.forEach((step, i) => {
        if (!step) return;
        setTimeout(() => {
          if (i > 0 && steps[i-1]) steps[i-1].classList.replace('active','done');
          step.classList.add('active');
          step.querySelector('.sp-dot').className = 'sp-dot';
        }, delays[i]);
      });

      setTimeout(() => {
        if (steps[3]) { steps[3].classList.replace('active','done'); steps[3].querySelector('.sp-dot').className = 'sp-dot'; }
        const toSym = toTokenEl ? toTokenEl.value : 'POL';
        const out   = toAmountEl ? toAmountEl.textContent : '—';
        if (result) result.textContent = `✓ ${out} ${toSym} received on ${CHAINS[toChain].name}`;
        swapBtn.disabled = false;
        swapBtn.textContent = 'Swap Again';
      }, 4200);
    });
  }

  /* init */
  setChainDisplay('from', fromChain);
  setChainDisplay('to',   toChain);
  updateSwap();
})();

/* ─── COUNTDOWN TIMER ─── */
(function () {
  const TGE = new Date('2026-06-15T12:00:00Z').getTime();

  function pad(n) { return String(n).padStart(2, '0'); }

  function tick() {
    const now  = Date.now();
    const diff = TGE - now;

    if (diff <= 0) {
      ['cd-days','cd-hours','cd-mins','cd-secs'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '00';
      });
      return;
    }

    const days  = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins  = Math.floor((diff % 3600000)  / 60000);
    const secs  = Math.floor((diff % 60000)    / 1000);

    const d = document.getElementById('cd-days');
    const h = document.getElementById('cd-hours');
    const m = document.getElementById('cd-mins');
    const s = document.getElementById('cd-secs');

    if (d) d.textContent = pad(days);
    if (h) h.textContent = pad(hours);
    if (m) m.textContent = pad(mins);
    if (s) s.textContent = pad(secs);
  }

  tick();
  setInterval(tick, 1000);
})();

/* ─── FAQ ACCORDION ─── */
document.querySelectorAll('.faq-question').forEach(btn => {
  btn.addEventListener('click', () => {
    const answer  = btn.nextElementSibling;
    const isOpen  = btn.classList.contains('open');

    /* close all others */
    document.querySelectorAll('.faq-question.open').forEach(other => {
      if (other !== btn) {
        other.classList.remove('open');
        other.nextElementSibling.classList.remove('open');
      }
    });

    btn.classList.toggle('open', !isOpen);
    answer.classList.toggle('open', !isOpen);
  });
});

/* ─── STICKY BAR SHOW / HIDE ─── */
const stickyBar   = document.getElementById('stickyBar');
const stickyClose = document.getElementById('stickyClose');
let stickyDismissed = false;

function hideStickyBar() {
  stickyDismissed = true;
  if (stickyBar) stickyBar.classList.remove('visible');
}

if (stickyClose) stickyClose.addEventListener('click', hideStickyBar);

window.addEventListener('scroll', () => {
  if (stickyDismissed || !stickyBar) return;
  const waitlistSection = document.getElementById('waitlist');
  if (!waitlistSection) return;
  const rect = waitlistSection.getBoundingClientRect();
  /* show bar once user scrolls past the waitlist section */
  if (rect.bottom < 0) {
    stickyBar.classList.add('visible');
  } else {
    stickyBar.classList.remove('visible');
  }
}, { passive: true });

/* ─── SMOOTH SCROLL (fallback for older browsers) ─── */
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })