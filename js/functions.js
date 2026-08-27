// Modern IntegrAuth Website Functions - Optimized

// Theme Management
// Themes: light | dark | contrast (high-contrast, light-based) | cyber (midnight cyber, dark-based)
const THEMES = {
  light:    { base: 'bg-light', modifier: null,             icon: 'fa-sun',                label: 'Light' },
  dark:     { base: 'bg-dark',  modifier: null,             icon: 'fa-moon',               label: 'Dark' },
  contrast: { base: 'bg-light', modifier: 'theme-contrast', icon: 'fa-circle-half-stroke', label: 'High Contrast' },
  cyber:    { base: 'bg-dark',  modifier: 'theme-cyber',    icon: 'fa-bolt',               label: 'Midnight Cyber' }
};

function applyTheme(themeName) {
  const theme = THEMES[themeName] || THEMES.light;
  const $body = $('body');
  const $navbar = $('.navbar');

  // Reset all theme classes, then apply the selected one
  $body.removeClass('bg-light bg-dark theme-contrast theme-cyber');
  $body.addClass(theme.base);
  if (theme.modifier) $body.addClass(theme.modifier);

  // Sync navbar Bootstrap utility classes with base theme
  if (theme.base === 'bg-dark') {
    $navbar.removeClass('bg-light navbar-light').addClass('bg-dark navbar-dark');
  } else {
    $navbar.removeClass('bg-dark navbar-dark').addClass('bg-light navbar-light');
  }

  // Update toggle button label/icon
  $('.theme-btn .theme-icon').attr('class', 'fas ' + theme.icon + ' theme-icon');
  $('.theme-btn .theme-label').text(theme.label);

  // Update active state in dropdown
  $('.theme-option').removeClass('active').attr('aria-checked', 'false');
  $('.theme-option[data-theme="' + themeName + '"]').addClass('active').attr('aria-checked', 'true');

  localStorage.setItem('theme', themeName);
  $(document).trigger('themeChanged', [themeName]);
}

// Optimized scroll handler with throttling
let scrollTimeout;
function handleScroll() {
  if (scrollTimeout) return;

  scrollTimeout = setTimeout(() => {
    const scroll = $(window).scrollTop();
    const navbar = $('.navbar');

    // Navbar scroll effect
    if (scroll >= 100) {
      navbar.addClass('navbar-scrolled');
    } else {
      navbar.removeClass('navbar-scrolled');
    }

    // Back-to-top button visibility
    const backToTop = document.querySelector('.back-to-top');
    if (backToTop) backToTop.classList.toggle('visible', scroll > 400);

    // Active navigation state (single-page index only, matched by href)
    if (document.getElementById('home')) {
      const scrollDistance = scroll + 100;
      $('section[id]').each(function() {
        if ($(this).position().top <= scrollDistance) {
          let $link = $('.navbar-nav .nav-link[href="#' + this.id + '"]');
          if (!$link.length) {
            // Section only appears inside a nav dropdown — highlight its toggle
            const $item = $('.navbar-nav .nav-dd .dropdown-item[href="#' + this.id + '"]');
            if ($item.length) $link = $item.closest('.dropdown').find('.nav-link.dropdown-toggle');
          }
          if ($link.length) {
            $('.navbar-nav .nav-link.active').removeClass('active');
            $link.addClass('active');
          }
        }
      });
    }

    scrollTimeout = null;
  }, 100); // Throttle to 100ms
}

// Fix WhatsApp links for mobile devices
function fixWhatsAppLinks() {
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  if (isMobile) {
    $('a[href*="wa.me"], a[href*="api.whatsapp"]').each(function() {
      const href = $(this).attr('href');
      const waMatch = href.match(/wa\.me\/(\d+)(?:\?text=(.+))?/);

      if (waMatch) {
        const phone = waMatch[1];
        const text = waMatch[2] ? decodeURIComponent(waMatch[2].replace(/\+/g, ' ')) : '';
        let nativeLink = `whatsapp://send?phone=${phone}`;
        if (text) nativeLink += `&text=${encodeURIComponent(text)}`;
        $(this).attr('href', nativeLink);
      }
    });
  }
}

// Technology section collapse functions
function expandAllTech() {
  $('.tech-grid.collapse').collapse('show');
  $('.tech-category-title .collapse-icon').removeClass('fa-chevron-right').addClass('fa-chevron-down');
}

function collapseAllTech() {
  $('.tech-grid.collapse').collapse('hide');
  $('.tech-category-title .collapse-icon').removeClass('fa-chevron-down').addClass('fa-chevron-right');
}

// Services marquee: auto-scroll, pause on hover/focus/touch, mouse drag to scroll.
// Each .services-marquee loops its .services-track seamlessly by cloning the card
// set and normalizing scrollLeft back into the first set's range each frame.
function initServicesMarquee() {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.querySelectorAll('.services-marquee').forEach(function (marquee) {
    const track = marquee.querySelector('.services-track');
    if (!track || !track.children.length) return;

    const originals = Array.prototype.slice.call(track.children);
    const setCount = originals.length;

    function cloneSet() {
      originals.forEach(function (node) {
        const clone = node.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        track.appendChild(clone);
      });
    }

    // Duplicate until there is a full set plus a viewport of overflow to hide the wrap
    cloneSet();
    let setWidth = track.children[setCount].offsetLeft - track.children[0].offsetLeft;
    while (setWidth > 0 && track.scrollWidth < marquee.clientWidth + setWidth * 2) cloneSet();

    const SPEED = 30; // px per second
    const dir = marquee.getAttribute('data-direction') === 'rtl' ? -1 : 1;
    let pos = dir === 1 ? 1 : setWidth;
    let paused = false;
    let dragging = false;
    let resumeTimer = null;
    let lastT = null;

    marquee.scrollLeft = pos;

    function pause() {
      clearTimeout(resumeTimer);
      paused = true;
    }

    function scheduleResume(delay) {
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(function () { paused = false; }, delay);
    }

    // Hover pauses; leaving resumes (unless mid-drag)
    marquee.addEventListener('mouseenter', pause);
    marquee.addEventListener('mouseleave', function () {
      if (!dragging) scheduleResume(300);
    });

    // Keyboard focus pauses so arrow-key scrolling isn't fought
    marquee.addEventListener('focusin', pause);
    marquee.addEventListener('focusout', function () { scheduleResume(800); });

    // Mouse drag to scroll; touch uses native scrolling, just pause while it happens
    let lastX = 0;
    let dragStartX = 0;
    let dragMoved = false;
    marquee.addEventListener('pointerdown', function (e) {
      pause();
      if (e.pointerType !== 'mouse') return;
      dragging = true;
      lastX = e.clientX;
      dragStartX = e.clientX;
      dragMoved = false;
      marquee.classList.add('dragging');
    });

    marquee.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      marquee.scrollLeft -= e.clientX - lastX;
      lastX = e.clientX;
      // Capture the pointer only once this is a real drag: capturing on
      // pointerdown would retarget the resulting click to the marquee itself,
      // so clicks on cards inside it (product modals) would never fire.
      if (!dragMoved && Math.abs(e.clientX - dragStartX) > 6) {
        dragMoved = true;
        marquee.setPointerCapture(e.pointerId);
      }
    });

    function endDrag(e) {
      if (e.pointerType !== 'mouse') {
        scheduleResume(1800); // let touch momentum finish before resuming
        return;
      }
      if (!dragging) return;
      dragging = false;
      marquee.classList.remove('dragging');
      // A real drag must not count as a click on whatever card it ended over
      // (product cards open modals on click). Swallow the click the browser
      // fires right after pointerup; disarm on the next tick so genuine
      // clicks are unaffected.
      if (dragMoved) {
        const swallow = function (ev) { ev.stopPropagation(); ev.preventDefault(); };
        marquee.addEventListener('click', swallow, true);
        setTimeout(function () { marquee.removeEventListener('click', swallow, true); }, 0);
      }
      if (!marquee.matches(':hover')) scheduleResume(300);
    }
    marquee.addEventListener('pointerup', endDrag);
    marquee.addEventListener('pointercancel', endDrag);

    // Wheel over the marquee: only HORIZONTAL intent (trackpad side-swipes)
    // drives it — a vertical wheel scrolls the PAGE like anywhere else.
    // Hijacking vertical wheel (the original behavior) turned every marquee
    // into a cage: the reader couldn't scroll past the section without
    // steering around it. Hover already pauses the auto-scroll, so nothing
    // fights the reader while their cursor is over it, and mouse drag /
    // native touch swipe remain the ways to browse it side to side.
    marquee.addEventListener('wheel', function (e) {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      pause(); // hover already pauses; this also clears any pending resume
      const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? marquee.clientWidth : 1;
      marquee.scrollLeft += e.deltaX * unit;
    }, { passive: false });

    // Card widths change at the mobile breakpoint
    window.addEventListener('resize', function () {
      setWidth = track.children[setCount].offsetLeft - track.children[0].offsetLeft;
    });

    function frame(t) {
      if (lastT === null) lastT = t;
      const dt = Math.min((t - lastT) / 1000, 0.1);
      lastT = t;

      const auto = !paused && !dragging && !reduceMotion;
      if (auto) {
        pos += dir * SPEED * dt;
      } else {
        pos = marquee.scrollLeft; // follow the user while they interact
      }

      // Seamless wrap: keep position within [1, setWidth + 1)
      if (pos < 1) pos += setWidth;
      else if (pos >= setWidth + 1) pos -= setWidth;

      if (auto || Math.abs(pos - marquee.scrollLeft) > 1) marquee.scrollLeft = pos;

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}

// Back-to-top floating button (injected on every page that loads this file)
function initBackToTop() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'back-to-top';
  btn.setAttribute('aria-label', 'Back to top');
  btn.innerHTML = '<i class="fas fa-arrow-up" aria-hidden="true"></i>';
  btn.addEventListener('click', function () {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  });
  document.body.appendChild(btn);
  if (window.pageYOffset > 400) btn.classList.add('visible');
}

// Product Modal Functions
function openProductModal(productId) {
  const modal = document.getElementById('productModal');
  const productContent = document.getElementById(productId + '-modal');

  if (modal && productContent) {
    document.querySelectorAll('.modal-product-content').forEach(content => {
      content.style.display = 'none';
    });
    productContent.style.display = 'block';
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
}

function closeProductModal(event) {
  const modal = document.getElementById('productModal');
  if (event.target === modal || event.target.classList.contains('product-modal-close')) {
    hideProductModal(modal);
  }
}

// Close with a short exit beat (.closing plays the reverse animation) instead
// of vanishing on the spot; reduced-motion closes instantly.
function hideProductModal(modal) {
  if (!modal || !modal.classList.contains('show') || modal.classList.contains('closing')) return;
  const done = function () {
    modal.classList.remove('show', 'closing');
    document.body.style.overflow = '';
  };
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
  modal.classList.add('closing');
  setTimeout(done, 230);
}

// Initialize on DOM ready
// Scroll progress bar: a thin gradient line along the viewport's top edge that
// tracks how far down the page the reader is. Injected here so no page needs
// markup changes; decorative only, hidden from assistive tech.
function initScrollProgress() {
  if (document.querySelector('.scroll-progress')) return;
  const wrap = document.createElement('div');
  wrap.className = 'scroll-progress';
  wrap.setAttribute('aria-hidden', 'true');
  const bar = document.createElement('div');
  bar.className = 'scroll-progress-bar';
  wrap.appendChild(bar);
  document.body.appendChild(wrap);
  let ticking = false;
  function update() {
    ticking = false;
    const doc = document.documentElement;
    let p;
    // Inside an open Academy lesson the bar tracks progress through THAT
    // lesson — its top passing the viewport top through its bottom entering
    // the viewport bottom — so it reads as "how much of this lesson is left"
    // instead of position within the page chrome. A lesson shorter than the
    // viewport is fully readable at a glance, so the bar shows full.
    const reader = document.getElementById('acadReader');
    const lesson = reader && !reader.hidden ? reader.querySelector('.acad-lesson.is-active') : null;
    if (lesson) {
      const r = lesson.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      p = span > 0 ? -r.top / span : 1;
    } else {
      const max = doc.scrollHeight - window.innerHeight;
      p = max > 0 ? (window.scrollY || doc.scrollTop || 0) / max : 0;
    }
    bar.style.transform = 'scaleX(' + Math.min(1, Math.max(0, p)) + ')';
  }
  function queue() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue, { passive: true });
  // Page height and the active lesson change without a scroll event (lesson
  // navigation, collapse toggles, reveals settling) — remeasure after any
  // click/keypress and once transitions finish. One rAF each, so it's cheap.
  document.addEventListener('click', queue, true);
  document.addEventListener('keydown', queue, true);
  document.addEventListener('transitionend', queue, true);
  update();
}

// Scroll-reveal: fade-and-rise section titles and cards into view the first
// time they scroll in, with a small stagger between siblings. The .sr-item
// class is only ever applied from here — never in markup — so no-JS visitors
// and reduced-motion users always get fully rendered static content. Both
// classes and the inline stagger delay are removed once the entrance has
// played, restoring each element's own transition/hover behaviour.
function initScrollReveal() {
  if (!('IntersectionObserver' in window)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const SELECTOR = [
    '.section-title', '.section-subtitle', '.tool-card', '.tech-category',
    '.process-step', '.faq-item', '.acad-banner', '.lab-showcase',
    '.svc-list > li', '.acad-track-card',
    '#acadDrill', '#acadFlows', '#acadChallenge', '#acadExam'
  ].join(',');

  function start() {
    const pending = new Set();
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        io.unobserve(el);
        pending.delete(el);
        el.classList.add('sr-in');
        setTimeout(function () {
          el.classList.remove('sr-item', 'sr-in');
          el.style.transitionDelay = '';
        }, 1100);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });

    const counts = new Map();
    document.querySelectorAll(SELECTOR).forEach(function (el) {
      // Never animate inside a scrolling marquee — its slides (and their
      // clones) move on their own and re-enter the viewport forever.
      if (el.closest('.services-track')) return;
      // Only elements still fully BELOW the viewport get an entrance. Anything
      // already on screen — or already scrolled PAST, as on a #hash deep link
      // that lands mid-page — stays untouched: hiding content the reader has
      // effectively seen would make scrolling back up play entrances backwards.
      if (el.getBoundingClientRect().top < window.innerHeight) return;
      const parent = el.parentElement;
      const idx = counts.get(parent) || 0;
      counts.set(parent, idx + 1);
      el.classList.add('sr-item');
      if (idx) el.style.transitionDelay = (Math.min(idx, 6) * 70) + 'ms';
      io.observe(el);
      pending.add(el);
    });

    // The teleport case (same bug the Lab's reveal had): an INSTANT jump —
    // End key, a same-page anchor — can move an element from below the
    // viewport to above it without ever intersecting, and the observer fires
    // no callback for a 0→0 intersection, leaving it invisible until the
    // reader happens back past it. Sweep on scroll and finish such elements
    // instantly, with no entrance (they were skipped, not scrolled to).
    let sweepRaf = 0;
    window.addEventListener('scroll', function () {
      if (sweepRaf || !pending.size) return;
      sweepRaf = requestAnimationFrame(function () {
        sweepRaf = 0;
        pending.forEach(function (el) {
          if (el.getBoundingClientRect().bottom < 0) {
            io.unobserve(el);
            pending.delete(el);
            el.classList.remove('sr-item', 'sr-in');
            el.style.transitionDelay = '';
          }
        });
      });
    }, { passive: true });
  }

  // On pages with a boot loader, hold the reveal until the loader lifts —
  // otherwise above-the-fold entrances play out unseen behind it.
  const htmlEl = document.documentElement;
  if (htmlEl.classList.contains('site-boot')) {
    const mo = new MutationObserver(function () {
      if (!htmlEl.classList.contains('site-boot')) {
        mo.disconnect();
        start();
      }
    });
    mo.observe(htmlEl, { attributes: true, attributeFilter: ['class'] });
  } else {
    start();
  }
}

// Count-up for the Academy stat chips ("135 lessons", "120+ diagrams") the
// first time they scroll into view. The chip's real text is parsed, animated,
// and restored verbatim at the end, so markup stays the source of truth; a
// temporary min-width pins the pill so the row doesn't wobble mid-count.
function initStatCounters() {
  if (!('IntersectionObserver' in window)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const chips = document.querySelectorAll('.acad-stat');
  if (!chips.length) return;
  const io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      io.unobserve(el);
      const final = el.textContent;
      const m = final.match(/^(\d+)([\s\S]*)$/);
      if (!m) return;
      const target = parseInt(m[1], 10);
      const suffix = m[2];
      el.style.minWidth = el.offsetWidth + 'px';
      const t0 = performance.now();
      const DUR = 900;
      function tick(now) {
        const t = Math.min(1, (now - t0) / DUR);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = Math.round(target * eased) + suffix;
        if (t < 1) {
          requestAnimationFrame(tick);
        } else {
          el.textContent = final;
          el.style.minWidth = '';
        }
      }
      requestAnimationFrame(tick);
    });
  }, { threshold: 0.4 });
  chips.forEach(function (el) { io.observe(el); });
}

// Cursor spotlight + 3D tilt on tool/track cards: a faint radial highlight
// follows the mouse inside the hovered card (CSS ::after reads
// --spot-x/--spot-y) and the card leans gently toward the cursor
// (--tilt-x/--tilt-y, consumed by the :hover transform in the
// micro-interactions block). Mouse-only — touch and coarse pointers never see
// either, and High Contrast disables the overlay and pins its own hover
// transform in CSS, so stale vars can't tilt anything there.
function initCardSpotlight() {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let raf = null;
  let ev = null;
  let lastCard = null;
  const MAX_TILT = 3; // deg — enough to read as depth, not enough to distort text
  document.addEventListener('pointermove', function (e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    ev = e;
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = null;
      const card = ev.target && ev.target.closest ? ev.target.closest('.tool-card, .acad-track-card') : null;
      if (lastCard && card !== lastCard) {
        lastCard.style.removeProperty('--tilt-x');
        lastCard.style.removeProperty('--tilt-y');
      }
      lastCard = card;
      if (!card) return;
      const r = card.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      card.style.setProperty('--spot-x', x + 'px');
      card.style.setProperty('--spot-y', y + 'px');
      card.style.setProperty('--tilt-x', ((0.5 - y / r.height) * 2 * MAX_TILT).toFixed(2) + 'deg');
      card.style.setProperty('--tilt-y', ((x / r.width - 0.5) * 2 * MAX_TILT).toFixed(2) + 'deg');
    });
  }, { passive: true });
}

// Hero identity constellation: a slowly drifting network of glowing nodes —
// humans, machines and agents finding and trusting each other — drawn on a
// canvas behind the hero copy, with occasional "handshake" pulses travelling
// along a link and nodes leaning toward the visitor's cursor. The canvas is
// injected from here so no-JS visitors simply keep the gradient hero.
//
// The 404 page (.err-hero) gets the BROKEN variant of the same field: a third
// of the links render dashed, beacons flicker instead of breathing, and
// handshake pulses drop mid-link — the graph where the page went missing.
// Node/link color comes from the host's --net-ink custom property (an "R, G, B"
// triplet themed in styles.css), cached and refreshed when the body's theme
// class changes rather than read per frame.
//
// Budgets, because a pretty hero that janks is worse than no hero:
// - node count scales with hero area, capped at 76; links are O(n²) but under
//   3k pairs/frame at the cap
// - devicePixelRatio capped at 2
// - the rAF loop runs ONLY while the canvas is actually visible: an
//   IntersectionObserver on the canvas stops it when the hero scrolls away
//   AND when High Contrast hides it via display:none, and document hidden
//   pauses it too
// - reduced motion gets a single static constellation (still pretty, nothing
//   moves) and no pointer tracking
function initHeroConstellation() {
  const hero = document.querySelector('.hero-section, .err-hero');
  if (!hero || hero.querySelector('.hero-net')) return;
  const broken = hero.classList.contains('err-hero');
  const canvas = document.createElement('canvas');
  canvas.className = 'hero-net';
  canvas.setAttribute('aria-hidden', 'true');
  hero.insertBefore(canvas, hero.firstChild);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let ink = '255,255,255';
  function refreshInk() {
    const v = getComputedStyle(hero).getPropertyValue('--net-ink').trim();
    if (/^\d+\s*,\s*\d+\s*,\s*\d+$/.test(v)) ink = v;
  }
  refreshInk();
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(function () {
      refreshInk();
      if (reduceMotion) draw(0, 0); // keep the static frame on-theme too
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LINK = 140;     // px — nodes closer than this draw a line
  const MOUSE = 190;    // px — nodes closer than this to the cursor lean in and link to it
  let w = 0, h = 0;
  let nodes = [];
  let pulses = [];
  let mouse = null;
  let raf = null;
  let lastT = null;
  let lastPulse = 0;
  let onScreen = true;
  let hidden = document.hidden;

  function seed() {
    const count = Math.max(28, Math.min(76, Math.round((w * h) / 26000)));
    nodes = [];
    for (let i = 0; i < count; i++) {
      nodes.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 16, // px per second — a drift, not a swarm
        vy: (Math.random() - 0.5) * 16,
        r: 1.2 + Math.random() * 1.7,
        a: 0.35 + Math.random() * 0.35,
        beacon: i % 7 === 0, // every 7th node pulses like an agent announcing itself
        ph: Math.random() * Math.PI * 2,
        dx: 0, dy: 0 // display offset (cursor magnetism), not part of the drift
      });
    }
    pulses = [];
  }

  function resize() {
    const rect = hero.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = rect.width;
    h = rect.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
    if (reduceMotion) draw(0, 0);
  }

  function draw(t, dt) {
    ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      n.x += n.vx * dt;
      n.y += n.vy * dt;
      if (n.x < -12) n.x = w + 12; else if (n.x > w + 12) n.x = -12;
      if (n.y < -12) n.y = h + 12; else if (n.y > h + 12) n.y = -12;
      // Cursor magnetism is a DISPLAY offset that eases in and out — the
      // underlying drift is untouched, so nodes spring back on their own and
      // the simulation can never clump or run away.
      let tx = 0, ty = 0;
      if (mouse) {
        const mdx = mouse.x - n.x;
        const mdy = mouse.y - n.y;
        const md = Math.sqrt(mdx * mdx + mdy * mdy);
        if (md < MOUSE && md > 0.001) {
          const f = 0.16 * (1 - md / MOUSE);
          tx = mdx * f;
          ty = mdy * f;
        }
      }
      n.dx += (tx - n.dx) * Math.min(1, dt * 6);
      n.dy += (ty - n.dy) * Math.min(1, dt * 6);
    }

    // Links between nearby nodes, faded by distance. In broken mode every
    // third pair (deterministic, so links don't restyle frame to frame) is
    // dashed and dimmer — a connection that isn't quite holding.
    ctx.lineWidth = 1;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const ax = a.x + a.dx, ay = a.y + a.dy;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const bx = b.x + b.dx, by = b.y + b.dy;
        const ddx = ax - bx, ddy = ay - by;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 > LINK * LINK) continue;
        let alpha = 0.26 * (1 - Math.sqrt(d2) / LINK);
        const snapped = broken && (i * 31 + j) % 3 === 0;
        if (snapped) {
          alpha *= 0.7;
          ctx.setLineDash([4, 6]);
        }
        ctx.strokeStyle = 'rgba(' + ink + ',' + alpha.toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        if (snapped) ctx.setLineDash([]);
      }
    }

    // Brighter threads from the cursor to whatever it is near — the visitor is
    // one more identity in the graph
    if (mouse) {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const nx = n.x + n.dx, ny = n.y + n.dy;
        const ddx = nx - mouse.x, ddy = ny - mouse.y;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 > MOUSE * MOUSE) continue;
        const alpha = 0.32 * (1 - Math.sqrt(d2) / MOUSE);
        ctx.strokeStyle = 'rgba(' + ink + ',' + alpha.toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(mouse.x, mouse.y);
        ctx.lineTo(nx, ny);
        ctx.stroke();
      }
    }

    // Handshake pulses: every so often a bright dot travels a live link —
    // a token passing between two identities
    if (t - lastPulse > 1200 && nodes.length > 1 && !reduceMotion) {
      lastPulse = t;
      const a = nodes[(Math.random() * nodes.length) | 0];
      let best = null;
      let bestD = LINK * LINK;
      for (let i = 0; i < nodes.length; i++) {
        const b = nodes[i];
        if (b === a) continue;
        const ddx = a.x - b.x, ddy = a.y - b.y;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < bestD) { bestD = d2; best = b; }
      }
      if (best) pulses.push({ a: a, b: best, t0: t, dur: 850 });
    }
    // In broken mode a handshake never completes: the pulse fades out just
    // past the middle of the link — the dropped request the 404 is about.
    const pulseEnd = broken ? 0.6 : 1;
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      const k = (t - p.t0) / p.dur;
      const ddx = p.a.x - p.b.x, ddy = p.a.y - p.b.y;
      if (k >= pulseEnd || ddx * ddx + ddy * ddy > LINK * LINK * 1.44) {
        pulses.splice(i, 1);
        continue;
      }
      const px = p.a.x + p.a.dx + (p.b.x + p.b.dx - p.a.x - p.a.dx) * k;
      const py = p.a.y + p.a.dy + (p.b.y + p.b.dy - p.a.y - p.a.dy) * k;
      const fade = k < 0.15 ? k / 0.15 : k > pulseEnd - 0.15 ? (pulseEnd - k) / 0.15 : 1;
      ctx.fillStyle = 'rgba(' + ink + ',' + (0.14 * fade).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = 'rgba(' + ink + ',' + (0.9 * fade).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, 6.2832);
      ctx.fill();
    }

    // Nodes last, on top of their links
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      let r = n.r;
      let alpha = n.a;
      const nx = n.x + n.dx, ny = n.y + n.dy;
      if (n.beacon) {
        // Breathing pulse normally; a twitchy flicker in broken mode (two
        // incommensurate sines beat irregularly — a status light misbehaving)
        const p = broken
          ? Math.abs(Math.sin(t / 1000 * 5.3 + n.ph) * Math.sin(t / 1000 * 3.1 + n.ph))
          : 0.5 + 0.5 * Math.sin(t / 1000 * 1.4 + n.ph);
        r += p * 1.5;
        alpha = 0.4 + 0.4 * p;
        ctx.fillStyle = 'rgba(' + ink + ',' + (0.1 * p).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(nx, ny, r + 5, 0, 6.2832);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(' + ink + ',' + alpha.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(nx, ny, r, 0, 6.2832);
      ctx.fill();
    }
  }

  function frame(t) {
    raf = null;
    if (lastT === null) lastT = t;
    const dt = Math.min((t - lastT) / 1000, 0.05);
    lastT = t;
    draw(t, dt);
    schedule();
  }

  function schedule() {
    if (raf || reduceMotion || !onScreen || hidden) return;
    raf = requestAnimationFrame(frame);
  }

  function pauseLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    lastT = null; // don't integrate the time spent paused into one huge step
  }

  resize();
  window.addEventListener('resize', resize);

  if (reduceMotion) return; // static constellation already drawn; nothing else to wire

  // Observing the CANVAS (not the hero) means display:none — High Contrast
  // hides .hero-net — reads as "not intersecting" and stops the loop too.
  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver(function (entries) {
      onScreen = entries[entries.length - 1].isIntersecting;
      if (onScreen) schedule(); else pauseLoop();
    }).observe(canvas);
  }
  document.addEventListener('visibilitychange', function () {
    hidden = document.hidden;
    if (hidden) pauseLoop(); else schedule();
  });

  hero.addEventListener('pointermove', function (e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    const rect = hero.getBoundingClientRect();
    mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, { passive: true });
  hero.addEventListener('pointerleave', function () { mouse = null; });

  schedule();
}

// Trust ticker (the strip between Contact and the footer on index.html):
// without JS — or with reduced motion — the markup is a static wrapped row of
// stat chips and stays that way. With JS it becomes a rotating one-liner: one
// stat at a time slides up into view and its number counts up from zero each
// time it appears. Rotation only runs while the strip is on screen, and
// pauses while hovered so it can actually be read.
function initTrustTicker() {
  const ticker = document.querySelector('.trust-ticker');
  if (!ticker) return;
  const items = Array.prototype.slice.call(ticker.querySelectorAll('.ticker-item'));
  if (items.length < 2) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  ticker.classList.add('ticker-live');

  function countUp(el) {
    const target = parseInt(el.getAttribute('data-count'), 10);
    if (!target) return;
    const t0 = performance.now();
    const dur = 700;
    function step(t) {
      const k = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(target * eased);
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  let idx = 0;
  function show(i) {
    items.forEach(function (el, k) {
      el.classList.toggle('on', k === i);
      el.classList.toggle('was', k === idx && i !== idx);
    });
    idx = i;
    const num = items[i].querySelector('.ticker-num');
    if (num) countUp(num);
  }
  show(0);

  let timer = null;
  let visible = false;
  let hovered = false;
  function arm() {
    if (timer || !visible || hovered) return;
    timer = setInterval(function () { show((idx + 1) % items.length); }, 3600);
  }
  function disarm() {
    clearInterval(timer);
    timer = null;
  }
  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver(function (entries) {
      visible = entries[entries.length - 1].isIntersecting;
      if (visible) arm(); else disarm();
    }).observe(ticker);
  } else {
    visible = true;
    arm();
  }
  ticker.addEventListener('mouseenter', function () { hovered = true; disarm(); });
  ticker.addEventListener('mouseleave', function () { hovered = false; arm(); });
}

$(function() {
  // Apply saved theme; first-time visitors get Midnight Cyber by default
  const savedTheme = localStorage.getItem("theme");
  const initialTheme = (savedTheme && THEMES[savedTheme]) ? savedTheme : 'cyber';
  applyTheme(initialTheme);

  // Theme picker: manual open/close (bypasses Bootstrap dropdown plugin)
  // Menu is portaled to <body> on open so it escapes the navbar's backdrop-filter
  // stacking context (which otherwise traps absolute/fixed descendants invisibly).
  function positionThemeMenu($toggle, $menu) {
    const rect = $toggle[0].getBoundingClientRect();
    // Hang the menu off the NAVBAR's bottom edge, not the button's. The button sits a few px inside
    // the bar, so anchoring to it tucked the menu's top row under the navbar — invisible until the
    // z-index fix (see .dropdown-menu.theme-menu in styles.css) stopped the bar painting over it,
    // and still visually wrong. Falls back to the button when the navbar can't be measured.
    const navbar = document.querySelector('.navbar');
    const navBottom = navbar ? navbar.getBoundingClientRect().bottom : rect.bottom;
    $menu.css({
      position: 'fixed',
      top: (Math.max(rect.bottom, navBottom) + 8) + 'px',
      right: (window.innerWidth - rect.right) + 'px',
      left: 'auto',
      margin: 0
    });
  }

  $(document).on('click', '.theme-btn.dropdown-toggle', function(e) {
    e.preventDefault();
    e.stopPropagation();
    const $toggle = $(this);
    const $menu = $('.theme-menu').first();
    const wasOpen = $menu.hasClass('show');

    // A mouse click on the toggle is always preceded by hovering it, and on desktop the hover
    // handler below has already opened the menu by the time the click lands — so reading
    // "already open" as "toggle it closed" made a plain click on the button a guaranteed
    // no-op for anyone who clicks toggles rather than trusting hover. The first click after a
    // hover-open therefore CONFIRMS the open menu (and eats the flag); a second click, an
    // outside click, ESC, or picking a theme still closes it. Keyboard and touch never set
    // the flag (themeHoverOpen gates on hover-capable media), so their click toggles as before.
    const byHover = themeOpenedByHover;
    themeOpenedByHover = false;
    if (wasOpen && byHover) return;

    $('.theme-menu').removeClass('show');
    $('.theme-btn.dropdown-toggle').attr('aria-expanded', 'false');

    if (!wasOpen) {
      if (!$menu.parent().is('body')) {
        $('body').append($menu);
      }
      positionThemeMenu($toggle, $menu);
      $menu.addClass('show');
      $toggle.attr('aria-expanded', 'true');
    }
  });

  // Reposition on scroll/resize while open
  $(window).on('scroll resize', function() {
    const $menu = $('.theme-menu.show');
    if ($menu.length) {
      const $toggle = $('.theme-btn.dropdown-toggle');
      positionThemeMenu($toggle, $menu);
    }
  });

  // Close picker on outside click
  $(document).on('click', function(e) {
    if (!$(e.target).closest('.theme-dropdown').length) {
      $('.theme-menu').removeClass('show');
      $('.theme-btn.dropdown-toggle').attr('aria-expanded', 'false');
    }
  });

  // Close picker on ESC
  $(document).on('keydown', function(e) {
    if (e.key === 'Escape') {
      $('.theme-menu').removeClass('show');
      $('.theme-btn.dropdown-toggle').attr('aria-expanded', 'false');
    }
  });

  // Theme option selection
  $(document).on('click', '.theme-option', function(e) {
    e.preventDefault();
    e.stopPropagation();
    const themeName = $(this).data('theme');
    if (themeName && THEMES[themeName]) applyTheme(themeName);
    $('.theme-menu').removeClass('show');
    $('.theme-btn.dropdown-toggle').attr('aria-expanded', 'false');
  });

  // Theme picker: same hover-to-open/close as Services/Learn (and the account menu), but done in
  // JS rather than a CSS :hover rule — the menu is intentionally detached to <body> and positioned
  // by `positionThemeMenu` above (a fixed-position, JS-computed rect, not a normal in-flow dropdown
  // child), so a pure `.theme-dropdown:hover > .theme-menu` selector could never reach it once open.
  // That detachment also means the toggle's bounding box does NOT contain the menu, so a plain
  // mouseleave-closes-immediately handler would fire the instant the pointer travels from the
  // button down into the menu, before ever reaching a theme option. A short debounced close —
  // cancelled by a mouseenter on EITHER the toggle or the (now body-level) menu — bridges that gap
  // without needing to compute the physical distance between them.
  let themeHoverCloseTimer = null;
  // Set when the hover handler (not a click) is what opened the menu — the toggle's click
  // handler reads-and-clears it; see the comment there. Declared with the hover machinery but
  // hoisted usage is fine: the click handler only runs after this assignment has executed.
  let themeOpenedByHover = false;
  function themeHoverMediaOk() {
    return window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 992px)').matches;
  }
  function themeHoverOpen() {
    if (!themeHoverMediaOk()) return;
    clearTimeout(themeHoverCloseTimer);
    const $toggle = $('.theme-btn.dropdown-toggle');
    const $menu = $('.theme-menu').first();
    if ($menu.hasClass('show')) return;
    if (!$menu.parent().is('body')) $('body').append($menu);
    positionThemeMenu($toggle, $menu);
    $menu.addClass('show');
    $toggle.attr('aria-expanded', 'true');
    // Arm the click handler's confirm-instead-of-close branch — this assignment is the whole
    // mechanism; without it byHover never reads true and the first click closes the menu again.
    themeOpenedByHover = true;
  }
  function themeHoverClose() {
    if (!themeHoverMediaOk()) return;
    clearTimeout(themeHoverCloseTimer);
    themeHoverCloseTimer = setTimeout(function() {
      $('.theme-menu').removeClass('show');
      $('.theme-btn.dropdown-toggle').attr('aria-expanded', 'false');
    }, 150);
  }
  $(document).on('mouseenter', '.theme-dropdown, .theme-menu', themeHoverOpen);
  $(document).on('mouseleave', '.theme-dropdown, .theme-menu', themeHoverClose);

  // Services/Learn nav dropdowns open on hover via CSS (desktop/pointer devices
  // only — see styles.css). Bootstrap's own click-to-open state (`.show`) is
  // otherwise dismissed only by an outside click/Escape/selection, so a dropdown
  // that got click-opened would stay "stuck" open instead of auto-closing when
  // the pointer leaves, unlike the hover-opened case. Force-close it on
  // mouseleave so both paths close equally fast.
  $(document).on('mouseleave', '.navbar-nav .nav-item.dropdown', function() {
    if (!window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 992px)').matches) return;
    const toggleEl = this.querySelector(':scope > .dropdown-toggle');
    const inst = toggleEl && window.bootstrap && bootstrap.Dropdown.getInstance(toggleEl);
    if (inst) inst.hide();
  });

  // Initialize components
  fixWhatsAppLinks();
  initServicesMarquee();
  initAcademy();
  initBackToTop();
  initScrollProgress();
  initScrollReveal();
  initStatCounters();
  initCardSpotlight();
  initHeroConstellation();
  initTrustTicker();

  // Homepage boot loader: bridge first paint to full init (theme applied, marquee
  // wired up) — mirrors Academy's boot loader.
  if (document.getElementById('siteBootLoader')) dismissBootLoader();

  // Attach scroll handler with passive listener for better performance
  $(window).on('scroll', handleScroll);

  // Close mobile menu when clicking outside
  $(document).on('click', function(e) {
    if (!$(e.target).closest('.navbar').length) {
      $('.navbar-collapse').collapse('hide');
    }
  });

  // Handle tech section and tools group collapse icons
  $('.tech-grid, .tools-grid').on('show.bs.collapse', function() {
    $(this).siblings('.tech-category-header, .tools-group-header').find('.collapse-icon')
      .removeClass('fa-chevron-right').addClass('fa-chevron-down');
  });

  $('.tech-grid, .tools-grid').on('hide.bs.collapse', function() {
    $(this).siblings('.tech-category-header, .tools-group-header').find('.collapse-icon')
      .removeClass('fa-chevron-down').addClass('fa-chevron-right');
  });

  // Make collapsed tech category cards clickable
  $('.tech-category').on('click', function(e) {
    const $techGrid = $(this).find('.tech-grid');
    if (!$techGrid.hasClass('show') &&
        !$(e.target).closest('.tech-item, a, button, .btn, .tech-category-header').length) {
      $techGrid.collapse('show');
    }
  });

  // Add/remove collapsed card styling
  $('.tech-grid').on('hidden.bs.collapse', function() {
    $(this).closest('.tech-category').addClass('collapsed-card');
  }).on('shown.bs.collapse', function() {
    $(this).closest('.tech-category').removeClass('collapsed-card');
  });
});

// Close modal on ESC key
document.addEventListener('keydown', function(event) {
  if (event.key === 'Escape') {
    hideProductModal(document.getElementById('productModal'));
  }
});

// Drop the boot loader once init is done. Held for a minimum stretch so it
// reads as an intentional loading beat instead of a flicker, and — since the
// CDN stylesheets load async — also until Bootstrap's CSS has actually been
// applied, so the reveal never shows unstyled layout. The CSS wait is capped:
// a down CDN degrades the layout, it must not strand the loader.
function dismissBootLoader() {
  const MIN_MS = 700;
  const CSS_WAIT_CAP_MS = 4000;
  const html = document.documentElement;
  const t0 = typeof window.__siteBootT0 === 'number' ? window.__siteBootT0 : Date.now();
  const started = Date.now();
  const cssReady = function () {
    try {
      return Array.prototype.some.call(document.styleSheets, function (s) {
        return s.href && s.href.indexOf('bootstrap') !== -1;
      });
    } catch (e) { return true; }
  };
  (function attempt() {
    const heldFor = Date.now() - t0;
    if (heldFor < MIN_MS) { setTimeout(attempt, MIN_MS - heldFor); return; }
    if (!cssReady() && Date.now() - started < CSS_WAIT_CAP_MS) { setTimeout(attempt, 100); return; }
    html.classList.remove('site-boot');
  })();
}

// Cover outgoing same-site page navigations with the boot loader. Browsers
// keep painting the OLD page until the next document's first paint (paint
// holding), so without this the sequence reads "page → loader → page"; raising
// the loader at click time makes it "loader → loader → page" instead.
document.addEventListener('click', function(event) {
  if (event.defaultPrevented || event.button !== 0 ||
      event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest ? event.target.closest('a[href]') : null;
  if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
  // Only pages that ship a loader element participate (index + academy)
  if (!document.querySelector('.boot-loader, .acad-boot-loader')) return;
  let url;
  try { url = new URL(link.href, location.href); } catch (e) { return; }
  if (url.origin !== location.origin || url.pathname === location.pathname) return;
  const html = document.documentElement;
  html.classList.add('site-boot');
  // The navigation can still be canceled (Esc, slow server + second thoughts) —
  // never leave the loader stranded over a page that stays alive.
  setTimeout(function() { html.classList.remove('site-boot'); }, 5000);
});

// A bfcache restore resurrects the page exactly as it was hidden — possibly
// with the outgoing-navigation loader still up. Drop it.
window.addEventListener('pageshow', function(event) {
  if (event.persisted) document.documentElement.classList.remove('site-boot');
});

// Export functions for global access
window.expandAllTech = expandAllTech;
window.collapseAllTech = collapseAllTech;
window.openProductModal = openProductModal;
window.closeProductModal = closeProductModal;

// ===== IntegrAuth Academy (academy.html) =====
// One-lesson-at-a-time reader with track hub, chip nav, pager,
// localStorage progress, quiz reveals, and glossary live filter.
function initAcademy() {
  const reader = document.getElementById('acadReader');
  const hub = document.getElementById('acadHub');
  if (!reader || !hub) return;

  const TRACK_LABELS = {
    basics: 'Track 0 · The Absolute Basics',
    foundations: 'Track 1 · Foundations',
    authn: 'Track 2 · Modern Authentication',
    tokens: 'Track 3 · Token Security',
    authz: 'Track 4 · Authorization & API Security',
    proto: 'Track 5 · Protocols & Federation',
    ai: 'Track 6 · AI & Agents',
    ops: 'Track 7 · Identity Operations',
    atk: 'Track 8 · Identity Attacks & Defenses',
    ciam: 'Track 9 · Customer Identity (CIAM)',
    cloud: 'Track 10 · Cloud & Workload Identity',
    arch: 'Track 11 · Identity Architecture'
  };

  const lessons = Array.prototype.slice.call(document.querySelectorAll('.acad-lesson'));
  const byId = {};
  lessons.forEach(function (s) { byId[s.id] = s; });

  const KEY_POS = 'acad_pos';
  const KEY_READ = 'acad_read';
  const KEY_QUIZ = 'acad_quiz';

  function readSet() {
    try { return new Set(JSON.parse(localStorage.getItem(KEY_READ) || '[]')); }
    catch (e) { return new Set(); }
  }

  function saveRead(set) {
    try { localStorage.setItem(KEY_READ, JSON.stringify(Array.from(set))); } catch (e) {}
    scheduleSync();
  }

  // Cheat-sheet & pop-quiz lessons (*-quiz) only count as read once every
  // answer has been revealed; acad_quiz stores the revealed question indices.
  function quizStore() {
    try { return JSON.parse(localStorage.getItem(KEY_QUIZ) || '{}'); }
    catch (e) { return {}; }
  }

  function saveQuizStore(s) {
    try { localStorage.setItem(KEY_QUIZ, JSON.stringify(s)); } catch (e) {}
    scheduleSync();
  }

  // --- Cross-device progress sync (logged-in learners only) ---------------
  // acad_read/acad_quiz/acad_pos are this DEVICE's local cache; when signed in, this
  // device's state is unioned with the server's (never a destructive overwrite — see
  // /api/academy/progress/sync's own merge semantics) and the merged, canonical result
  // is written back locally. quizStore() is keyed by QUIZ LESSON id (e.g. "b9-quiz");
  // the server's schema is keyed by TRACK id with a revealed-question bitmask, so the
  // two helpers below translate between them via each quiz lesson's own data-track.
  const KEY_POS_AT = 'acad_pos_at';
  const KEY_EXAM = 'acad_exam'; // lab-exam's own saved best-score/passed record (academy-labs.js)
  // NOTE: there is deliberately no KEY_OWNER constant here. `acad_owner` is read and written only by
  // academy-auth.js (its OWNER_KEY), because ownership reconciliation has to happen on every page,
  // not just academy.html where this file's initAcademy() runs. A duplicate constant here was dead
  // code that made it look as though this file participated in that decision.

  // Reset epoch: the server's per-learner counter, bumped every time progress is reset. This
  // device remembers the value it last saw and presents it on every sync. It exists because the
  // sync merges by UNION, which has no way to express a deletion — so before the epoch, pressing
  // "Reset track" cleared the local marks, the debounced sync fired ~800ms later, the server
  // unioned every id back in, and the checkmarks visibly REAPPEARED. Deleting on the server alone
  // was not enough either: any other device still holding the old progress re-uploaded its stale
  // copy on its next sync and the reset silently un-happened somewhere else.
  const KEY_EPOCH = 'acad_epoch';

  function storedEpoch() {
    try {
      const raw = localStorage.getItem(KEY_EPOCH);
      const n = raw === null ? 0 : parseInt(raw, 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    } catch (e) { return 0; }
  }

  function saveEpoch(epoch) {
    try { localStorage.setItem(KEY_EPOCH, String(epoch)); } catch (e) {}
  }

  // All of this browser's Academy progress in one place. Its only caller today is
  // resetAllProgress ("Reset all") — the account-switch/sign-out ownership wipe lives in
  // academy-auth.js with its own key list, because it must run on every page, not just
  // academy.html. The two lists deliberately differ: the ownership wipe excludes
  // acad_drill_v1 (browser-local practice stats, not account progress).
  function clearLocalProgress() {
    try {
      localStorage.removeItem(KEY_READ);
      localStorage.removeItem(KEY_QUIZ);
      localStorage.removeItem(KEY_POS);
      localStorage.removeItem(KEY_POS_AT);
      localStorage.removeItem(KEY_EXAM);
      // The reset epoch belongs to an ACCOUNT, not to this browser, so a different account's
      // remembered value is meaningless here. Dropping it makes the next sync look stale, which is
      // the safe direction: the server answers with canonical truth and the current epoch, and this
      // device adopts both instead of uploading progress under the wrong epoch.
      localStorage.removeItem(KEY_EPOCH);
      // Daily-drill practice state (academy-labs.js's lab-drill). Local-only by design — it has
      // no server table, so "Reset all" is the only reset that touches it. Deliberately NOT in
      // academy-auth.js's ownership wipe: like acad_tour_seen it is this browser's practice
      // stats, not account progress, and clearLocalProgress()'s only caller is resetAllProgress.
      localStorage.removeItem('acad_drill_v1');
    } catch (e) {}
  }

  function quizLessonIdForTrack(track) {
    for (let i = 0; i < lessons.length; i++) {
      if (trackOf(lessons[i]) === track && isQuizLesson(lessons[i])) return lessons[i].id;
    }
    return null;
  }

  function maskFromIndices(indices) {
    let mask = 0;
    (indices || []).forEach(function (i) { if (i >= 0 && i < 31) mask |= (1 << i); });
    return mask;
  }

  function indicesFromMask(mask) {
    const out = [];
    for (let i = 0; i < 31; i++) if (mask & (1 << i)) out.push(i);
    return out;
  }

  function localSyncSnapshot() {
    const qStore = quizStore();
    const quizMasks = {};
    Object.keys(qStore).forEach(function (lessonId) {
      const lesson = byId[lessonId];
      const track = lesson && trackOf(lesson);
      if (track) quizMasks[track] = maskFromIndices(qStore[lessonId]);
    });
    let lastPosition = null;
    try {
      const posId = localStorage.getItem(KEY_POS);
      if (posId) lastPosition = { lessonId: posId, updatedAt: localStorage.getItem(KEY_POS_AT) || new Date(0).toISOString() };
    } catch (e) {}
    return {
      readLessons: Array.from(readSet()),
      quizMasks: quizMasks,
      lastPosition: lastPosition,
      // The server compares this against its own counter and IGNORES this whole payload if we are
      // behind — meaning this device is holding progress from before a reset it hasn't seen yet.
      epoch: storedEpoch()
    };
  }

  let acadApplyingServerProgress = false;

  // Merges the server's canonical progress DOWN into local storage — a pure union for
  // read lessons and quiz-reveal masks (never removes/overwrites an already-marked
  // item), and a last-write-wins-by-timestamp replace for "where was I last reading."
  //
  // EXCEPT after a reset. If the server reports an epoch different from the one this device last
  // saw, its answer is not a merge candidate but the post-reset truth, and it must REPLACE local
  // state rather than be unioned into it. Union would be exactly wrong here: the server's
  // readLessons is empty after a reset, and unioning an empty set into a full local one changes
  // nothing — the reset would appear to have done nothing on this device.
  function applyServerProgress(server) {
    if (!server) return;
    const serverEpoch = typeof server.epoch === 'number' ? server.epoch : null;
    const authoritative = serverEpoch !== null && serverEpoch !== storedEpoch();
    acadApplyingServerProgress = true;
    try {
      if (authoritative) {
        // Adopt the server's state verbatim, including its emptiness.
        saveRead(new Set(Array.isArray(server.readLessons) ? server.readLessons : []));
        const qStore = {};
        if (server.quizMasks && typeof server.quizMasks === 'object') {
          Object.keys(server.quizMasks).forEach(function (track) {
            const lessonId = quizLessonIdForTrack(track);
            if (lessonId) qStore[lessonId] = indicesFromMask(server.quizMasks[track] | 0);
          });
        }
        saveQuizStore(qStore);
        try {
          if (server.lastPosition && server.lastPosition.lessonId) {
            localStorage.setItem(KEY_POS, server.lastPosition.lessonId);
            localStorage.setItem(KEY_POS_AT, server.lastPosition.updatedAt || new Date().toISOString());
          } else {
            localStorage.removeItem(KEY_POS);
            localStorage.removeItem(KEY_POS_AT);
          }
        } catch (e) {}
        // Clear the on-page marks too, or a lesson still shows its ✓ until the next navigation.
        document.querySelectorAll('.acad-quiz-check, .acad-quiz-progress, .acad-lab-gate')
          .forEach(function (el) { el.remove(); });
        saveEpoch(serverEpoch);
      } else {
        if (Array.isArray(server.readLessons) && server.readLessons.length) {
          const merged = readSet();
          server.readLessons.forEach(function (id) { merged.add(id); });
          saveRead(merged);
        }
        if (server.quizMasks && typeof server.quizMasks === 'object') {
          const qStore = quizStore();
          Object.keys(server.quizMasks).forEach(function (track) {
            const lessonId = quizLessonIdForTrack(track);
            if (!lessonId) return;
            const mergedMask = maskFromIndices(qStore[lessonId]) | (server.quizMasks[track] | 0);
            qStore[lessonId] = indicesFromMask(mergedMask);
          });
          saveQuizStore(qStore);
        }
        if (server.lastPosition && server.lastPosition.lessonId) {
          let localAt = null;
          try { localAt = localStorage.getItem(KEY_POS_AT); } catch (e) {}
          const serverAt = server.lastPosition.updatedAt || null;
          if (!localAt || (serverAt && Date.parse(serverAt) > Date.parse(localAt))) {
            try {
              localStorage.setItem(KEY_POS, server.lastPosition.lessonId);
              localStorage.setItem(KEY_POS_AT, serverAt || new Date().toISOString());
            } catch (e) {}
          }
        }
        if (serverEpoch !== null) saveEpoch(serverEpoch);
      }
    } finally {
      acadApplyingServerProgress = false;
    }
    if (authoritative && window.AcadLabs && typeof window.AcadLabs.remountAll === 'function') {
      try { window.AcadLabs.remountAll(); } catch (e) {}
    }
    updateProgress();
    renderResumeBanner();
    const activeLesson = lessons.filter(function (s) { return s.classList.contains('is-active'); })[0];
    if (activeLesson) {
      if (isQuizLesson(activeLesson)) syncQuizProgress(activeLesson);
      buildChips(trackOf(activeLesson), activeLesson.id);
    }
  }

  let acadSyncTimer = null;

  // Until the FIRST sync decision has been made against a server-confirmed identity (firstSync
  // after AcademyAuth.ready(), or a confirmed academy-auth-changed event), scheduleSync must not
  // fire at all. A deep-link boot calls showLesson() synchronously, whose saveRead() would
  // otherwise queue an 800ms plain sync off the CACHED session — posting epoch 0 while ready()
  // is still two round trips away. Any account that has ever been reset rejects epoch 0 as stale
  // and answers with post-reset truth, which applyServerProgress applies authoritatively,
  // destroying the anonymous progress claimAnonymousProgress() was about to carry over — a third
  // entry point into the exact bug class the boot/listener claim paths were built to close.
  // Nothing is lost by holding back: the snapshot reads localStorage at fire time, so the marks
  // made before the gate lifts ride out with the first legitimate sync.
  let acadFirstSyncSettled = false;

  /**
   * Monotonic generation counter for progress writes.
   *
   * Every sync captures the generation it was issued under. TWO events bump it, and both are
   * moments after which any response composed earlier is not merely stale but actively harmful:
   *
   *   1. A RESET (pushResetToServer). The older sync's response carries the PRE-reset epoch and the
   *      full pre-reset progress. Since its epoch no longer matches what we stored,
   *      applyServerProgress read it as authoritative, replaced local state with the progress that
   *      was just deleted, and wrote the OLD epoch back — so the reset visibly undid itself, and the
   *      next sync was then rejected as stale and cleared it again, flickering.
   *   2. An OWNERSHIP WIPE (the academy-progress-wiped listener). The response carries the previous
   *      account's progress into a browser that has since signed out or switched accounts, and the
   *      epoch it restores then routes the next learner past the claim path — see that listener.
   *
   * It does NOT serialize two overlapping ordinary syncs (no bump between them, so both responses
   * apply) — those are safe anyway: read-marks and quiz masks merge by union, and the saved
   * position is guarded by its own timestamp comparison.
   */
  let acadSyncGeneration = 0;

  // Debounced (not per-keystroke-chatty) — fires on every read-mark/quiz-reveal via the
  // patched saveRead/saveQuizStore above, on login (academy-auth-changed), and once at
  // boot if a session is already cached. No-ops silently when logged out.
  function scheduleSync() {
    if (acadApplyingServerProgress) return;
    if (!acadFirstSyncSettled) return; // see acadFirstSyncSettled above
    if (!window.AcademyAuth || !window.AcademyAuth.getSession().loggedIn) return;
    if (acadSyncTimer) clearTimeout(acadSyncTimer);
    acadSyncTimer = setTimeout(function () {
      acadSyncTimer = null;
      const generation = acadSyncGeneration;
      window.AcademyAuth.syncProgress(localSyncSnapshot())
        .then(function (server) {
          if (generation !== acadSyncGeneration) return; // superseded — see acadSyncGeneration
          applyServerProgress(server);
        })
        .catch(handleSyncError);
    }, 800);
  }

  // A 401 mid-sync means the session ended server-side sometime after this tab last
  // checked in (idle timeout, revoke-all from another device, mid-exam expiry) — silently
  // swallowing it (the old behaviour) leaves the UI still believing it's signed in and
  // just re-fails on every future debounce tick with no way out for the learner.
  // refreshSession() re-checks with the Lab and, finding no session, fires
  // academy-auth-changed(loggedIn:false) itself, which is what actually flips the UI
  // (including the exam panel below) to the honest signed-out state — no retry loop here,
  // just handing off to the one place session truth already lives.
  function handleSyncError(err) {
    if (err && err.status === 401 && window.AcademyAuth && typeof window.AcademyAuth.refreshSession === 'function') {
      window.AcademyAuth.refreshSession();
      return;
    }
    /* otherwise: best-effort — this device's local state remains authoritative for itself */
  }

  // Flush a pending debounced sync immediately instead of losing it to a closing tab.
  // Reuses scheduleSync's own timer/state rather than a second scheduler — this only ever fires
  // early what scheduleSync already queued. Two separate losses are being closed here: the up-to-
  // 800ms debounce window (fixed by firing now), and the browser cancelling an in-flight fetch when
  // the page goes away (fixed by `keepalive`, which lets the request outlive the document). Without
  // both, a learner who finishes a lesson and immediately closes the tab loses that read mark.
  // No applyServerProgress() on this path: the page is going away, so there is nothing left to
  // apply the merged response to, and touching localStorage during unload is a good way to race.
  function flushPendingSync() {
    if (!acadSyncTimer) return;
    clearTimeout(acadSyncTimer);
    acadSyncTimer = null;
    if (acadApplyingServerProgress) return;
    if (!window.AcademyAuth || !window.AcademyAuth.getSession().loggedIn) return;
    window.AcademyAuth.syncProgress(localSyncSnapshot(), { keepalive: true })
      .catch(handleSyncError);
  }

  // iOS Safari doesn't reliably fire pagehide on tab close/swipe-away, so both events are
  // wired — whichever the browser actually delivers, the pending write goes out instead of
  // silently dying with the tab.
  window.addEventListener('pagehide', flushPendingSync);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushPendingSync();
  });

  // Account-scoping of local progress (the acad_owner check) DELIBERATELY does not live here any
  // more. It is in academy-auth.js's reconcileProgressOwner, which that file calls before it fires
  // this event — read its comment for the full reasoning. In short, a listener here could not do the
  // job: this event's first, forced firing happens while academy-auth.js's deferred script runs,
  // whereas initAcademy() is invoked from jQuery's asynchronously-resolved ready callback, so this
  // listener was always registered too late to see it; and initAcademy() no-ops entirely off
  // academy.html, so a sign-in or sign-out from any other page's navbar reconciled nothing.
  //
  // What is left here is the reaction: re-read whatever storage now says and redraw.
  document.addEventListener('academy-progress-wiped', function () {
    // INVALIDATE ANY IN-FLIGHT SYNC FIRST. This is not bookkeeping — without it the wipe is undone
    // by the network, and the progress lands in the NEXT learner's account.
    //
    // The sequence: learner A finishes a lesson, the debounced sync POSTs, and while it is in flight
    // A signs out (or a different account signs in). academy-auth.js wipes localStorage and clears
    // acad_owner. The response — a 200 carrying A's full progress AND A's epoch, computed before the
    // session ended — then arrives, its generation still matches, and applyServerProgress writes all
    // of it back into a browser that is now signed out and unowned. Worse than a stale repaint:
    // because the restored acad_epoch makes hasUnsyncedLocalProgress() answer false, learner B's
    // sign-in skips the claim path and plain-syncs A's read lessons and quiz masks straight into B's
    // account, where the union makes them permanent. That is exactly the cross-account contamination
    // the owner-scoping machinery exists to prevent, arriving through the one door it did not watch.
    //
    // Bumping the generation is the same tool pushResetToServer already uses for the reset-vs-sync
    // race, applied to the other event that invalidates every response composed before it.
    acadSyncGeneration++;
    // academy-auth.js has already cleared the keys. readSet()/quizStore() read localStorage on every
    // call, so there is no cached copy to invalidate — but the marks already PAINTED into the DOM
    // would otherwise keep showing the previous account's work until a navigation. Same repaint the
    // authoritative branch of applyServerProgress does, and for the same reason.
    repaintProgressMarks();
  });

  /**
   * Drops every progress mark drawn into the page and redraws from whatever localStorage now says.
   * Used whenever local progress is REPLACED wholesale rather than added to: a post-reset
   * authoritative server response, and an account switch that wiped this browser's copy.
   */
  function repaintProgressMarks() {
    document.querySelectorAll('.acad-quiz-check, .acad-quiz-progress, .acad-lab-gate')
      .forEach(function (el) { el.remove(); });
    if (window.AcadLabs && typeof window.AcadLabs.remountAll === 'function') {
      try { window.AcadLabs.remountAll(); } catch (e) {}
    }
    updateProgress();
    renderResumeBanner();
    const activeLesson = lessons.filter(function (s) { return s.classList.contains('is-active'); })[0];
    if (activeLesson) {
      if (isQuizLesson(activeLesson)) syncQuizProgress(activeLesson);
      buildChips(trackOf(activeLesson), activeLesson.id);
    }
  }

  /**
   * True when this browser holds Academy progress that has never been synced to any account.
   *
   * `acad_epoch` is written by every sync and by every reset, so its ABSENCE means this device has
   * never talked to the progress API — i.e. whatever is stored locally was earned anonymously.
   */
  function hasUnsyncedLocalProgress() {
    let epochSeen = null;
    try { epochSeen = localStorage.getItem(KEY_EPOCH); } catch (e) { return false; }
    if (epochSeen !== null) return false;
    if (readSet().size > 0 || Object.keys(quizStore()).length > 0) return true;
    // The saved position counts as progress too. Lessons that carry a lab are NOT auto-marked read
    // (interaction is the signal), so an anonymous learner can be several lessons deep with an empty
    // read set and nothing but acad_pos to show for it. Missing that sent them down the plain-sync
    // path, which posts epoch 0 — and any account that has ever been reset rejects that as stale and
    // answers with authoritative post-reset truth, erasing the very place they were carrying in.
    try { return !!localStorage.getItem(KEY_POS); } catch (e) { return false; }
  }

  /**
   * First sync after signing in, for a device carrying anonymous progress.
   *
   * The plain path would DESTROY that progress rather than claim it. A device that has never synced
   * sends epoch 0; if the account has ever been reset its server epoch is higher, so the server
   * rightly rejects the payload as stale and answers with post-reset truth plus the real epoch — and
   * `applyServerProgress` then treats a differing epoch as authoritative and REPLACES local state.
   * Correct for a genuinely stale device, exactly wrong for a first sign-in, where "carry my
   * anonymous progress into my account" is a promised feature.
   *
   * So: learn the account's current epoch first, adopt it, and only then merge. With the epochs now
   * equal, applyServerProgress takes its union branch (nothing local is lost) and the follow-up sync
   * uploads the local additions under an epoch the server will accept.
   */
  let acadClaimInFlight = false;
  function claimAnonymousProgress() {
    // Single-flight: on a boot where the cache said signed-out but the server says signed-in, BOTH
    // ways in (the confirmed academy-auth-changed listener and ready().then(firstSync)) arrive
    // here. The second run would only duplicate the GET and the union apply.
    if (acadClaimInFlight) return;
    if (!window.AcademyAuth || typeof window.AcademyAuth.getProgress !== 'function') {
      scheduleSync();
      return;
    }
    acadClaimInFlight = true;
    // Same supersession rule as scheduleSync: a reset clicked while this GET is in flight bumps the
    // generation, and applying the pre-reset response after it would visibly undo the reset (the
    // exact flicker the generation counter exists to close on the ordinary sync path).
    const generation = acadSyncGeneration;
    window.AcademyAuth.getProgress()
      .then(function (server) {
        acadClaimInFlight = false;
        if (generation !== acadSyncGeneration) return; // superseded — see acadSyncGeneration
        if (server && typeof server.epoch === 'number') saveEpoch(server.epoch);
        applyServerProgress(server);
        scheduleSync();
      })
      .catch(function (err) {
        acadClaimInFlight = false;
        handleSyncError(err);
        scheduleSync();
      });
  }

  document.addEventListener('academy-auth-changed', function (e) {
    const session = e.detail && e.detail.session;
    // `confirmed` distinguishes a session the server answered for from one read out of the
    // localStorage cache. Rendering may use either — showing the cached name instantly is the whole
    // point of caching it — but the sync WRITES, and writing against a guess about who is signed in
    // is how one learner's progress lands in another's account on a shared browser. The boot path
    // enforces this by waiting on AcademyAuth.ready(); this listener is the other way in, and it
    // fires on the unconfirmed boot event too, so it has to make the same distinction itself.
    const confirmed = !!(e.detail && e.detail.confirmed);
    updateProgress();
    // A confirmed event — signed in OR out — settles the first-sync decision; lift the boot gate
    // BEFORE branching so claimAnonymousProgress's own internal scheduleSync() calls pass it.
    if (confirmed) acadFirstSyncSettled = true;
    if (confirmed && session && session.loggedIn) {
      if (hasUnsyncedLocalProgress()) claimAnonymousProgress();
      else scheduleSync();
    }
    // The exam panel (academy-labs.js's lab-exam) renders its sign-in wall / unlocked
    // exam / claim-a-local-pass offer by reading window.AcademyAuth.getSession() and
    // localStorage at render time only — nothing re-renders it when auth state changes
    // later, so a learner who signs in mid-visit would keep seeing the sign-in wall (or a
    // freshly-signed-out learner would keep seeing the exam) until a manual reload.
    // AcadLabs.remountWithin() is the labs framework's existing tear-down-and-re-render
    // hook — already used by "Reset track"/"Reset all progress" and by lab-exam's own
    // sign-in button after a successful login — so reusing it here re-renders just
    // #acadExam's lab host against the new session, with no extra mechanism invented.
    const examHost = document.getElementById('acadExam');
    if (examHost && window.AcadLabs && typeof window.AcadLabs.remountWithin === 'function') {
      window.AcadLabs.remountWithin(examHost);
    }
  });

  function isQuizLesson(lesson) {
    return !!lesson && /-quiz$/.test(lesson.id) && !!lesson.querySelector('.acad-quiz');
  }

  // Paint per-question checkmarks + the progress line; returns true when all revealed.
  function syncQuizProgress(lesson) {
    const blocks = Array.prototype.slice.call(lesson.querySelectorAll('.acad-quiz'));
    const revealed = new Set(quizStore()[lesson.id] || []);
    blocks.forEach(function (b, i) {
      const q = b.querySelector('.acad-q');
      if (!q) return;
      let check = q.querySelector('.acad-quiz-check');
      if (revealed.has(i) && !check) {
        check = document.createElement('i');
        check.className = 'fas fa-check acad-quiz-check';
        check.setAttribute('aria-hidden', 'true');
        q.appendChild(check);
      } else if (!revealed.has(i) && check) {
        check.remove();
      }
    });
    let bar = lesson.querySelector('.acad-quiz-progress');
    if (!bar && blocks.length) {
      bar = document.createElement('p');
      bar.className = 'acad-quiz-progress';
      bar.setAttribute('aria-live', 'polite');
      blocks[0].parentNode.insertBefore(bar, blocks[0]);
    }
    const done = revealed.size >= blocks.length;
    if (bar) {
      bar.textContent = done
        ? '✓ All ' + blocks.length + ' answers revealed — lesson complete!'
        : revealed.size + '/' + blocks.length + ' answers revealed — reveal them all to mark this lesson read.';
      bar.classList.toggle('done', done);
    }
    return done;
  }

  // Lessons with a hands-on lab only count as read once the lab has been
  // interacted with (labs are open-ended sims, so "touched" is the completion
  // signal — same spirit as the quiz-reveal gate above). Lessons without a lab
  // (intros, summaries, glossary) still mark read on open.
  function labOf(lesson) {
    return lesson ? lesson.querySelector('.acad-lab') : null;
  }

  // Paint the gate line above the lab; reuses the quiz-progress styling.
  function syncLabGate(lesson) {
    const lab = labOf(lesson);
    if (!lab) return;
    let bar = lesson.querySelector('.acad-lab-gate');
    if (!bar) {
      bar = document.createElement('p');
      bar.className = 'acad-quiz-progress acad-lab-gate';
      bar.setAttribute('aria-live', 'polite');
      lab.parentNode.insertBefore(bar, lab);
    }
    const done = readSet().has(lesson.id);
    bar.textContent = done
      ? '✓ Lesson marked read.'
      : 'Try the hands-on lab below to mark this lesson read.';
    bar.classList.toggle('done', done);
  }

  function trackOf(lesson) { return lesson.getAttribute('data-track'); }

  function trackLessons(track) {
    return lessons.filter(function (s) { return trackOf(s) === track; });
  }

  function updateProgress() {
    const read = readSet();
    const opened = lessons.filter(function (s) { return read.has(s.id); }).length;
    const pct = Math.round((opened / lessons.length) * 100);
    const fill = document.getElementById('acadProgressFill');
    const text = document.getElementById('acadProgressText');
    if (fill) fill.style.width = pct + '%';
    if (text) text.textContent = opened + '/' + lessons.length + ' lessons read';
    const hubFill = document.getElementById('acadHubProgressFill');
    const hubText = document.getElementById('acadHubProgressText');
    if (hubFill) hubFill.style.width = pct + '%';
    if (hubText) hubText.textContent = opened + '/' + lessons.length + ' lessons read · ' + pct + '%';
    // Unlock the final-exam widget the moment every lesson is read (checked cheaply:
    // only while it's still showing its locked state, so an unlocked exam in progress
    // is never clobbered by a stray remount on later lesson views).
    const examHost = document.querySelector('#acadExam .acad-lab[data-lab="lab-exam"]');
    if (examHost && examHost.getAttribute('data-exam-locked') === '1' && opened === lessons.length && window.AcadLabs) {
      AcadLabs.remountWithin(document.getElementById('acadExam'));
    }
    // Hub: per-track counts + checkmarks
    document.querySelectorAll('.acad-track-toc a').forEach(function (a) {
      const id = (a.getAttribute('href') || '').slice(1);
      const done = read.has(id);
      a.classList.toggle('acad-read', done);
      let check = a.querySelector('.acad-toc-check');
      if (done && !check) {
        check = document.createElement('i');
        check.className = 'fas fa-check acad-toc-check';
        check.setAttribute('aria-hidden', 'true');
        a.appendChild(check);
      } else if (!done && check) {
        check.remove();
      }
    });
    document.querySelectorAll('.acad-track-card').forEach(function (card) {
      const track = card.getAttribute('data-track');
      const items = trackLessons(track);
      const done = items.filter(function (s) { return read.has(s.id); }).length;
      const meta = card.querySelector('.acad-track-done');
      if (meta) meta.textContent = done ? done + '/' + items.length + ' read' : items.length + ' lessons';
    });
  }

  function buildChips(track, activeId) {
    const chips = document.getElementById('acadChips');
    if (!chips) return;
    chips.innerHTML = '';
    const read = readSet();
    trackLessons(track).forEach(function (s) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'acad-chip' + (s.id === activeId ? ' active' : '');
      btn.setAttribute('data-goto', s.id);
      const num = s.getAttribute('data-num');
      btn.innerHTML = '<span class="acad-chip-num">' + (num === '0' ? '★' : num) + '</span>' +
        (s.getAttribute('data-short') || s.getAttribute('data-title') || s.id) +
        (read.has(s.id) ? ' <i class="fas fa-check acad-chip-check" aria-hidden="true"></i>' : '');
      chips.appendChild(btn);
    });
  }

  function buildPager(lesson) {
    const pager = document.getElementById('acadPager');
    if (!pager) return;
    pager.innerHTML = '';
    const idx = lessons.indexOf(lesson);
    const prev = lessons[idx - 1];
    const next = lessons[idx + 1];
    if (prev) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'acad-page-btn';
      b.setAttribute('data-goto', prev.id);
      const prevTrack = trackOf(prev);
      if (prevTrack !== trackOf(lesson)) {
        const track = document.createElement('span');
        track.className = 'acad-page-track';
        track.textContent = TRACK_LABELS[prevTrack] || prevTrack;
        const title = document.createElement('span');
        title.className = 'acad-page-title';
        title.textContent = '← ' + prev.getAttribute('data-title');
        b.appendChild(track);
        b.appendChild(title);
      } else {
        b.textContent = '← ' + prev.getAttribute('data-title');
      }
      pager.appendChild(b);
    } else {
      pager.appendChild(document.createElement('span'));
    }
    if (next) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'acad-page-btn';
      b.setAttribute('data-goto', next.id);
      const nextTrack = trackOf(next);
      if (nextTrack !== trackOf(lesson)) {
        const track = document.createElement('span');
        track.className = 'acad-page-track';
        track.textContent = TRACK_LABELS[nextTrack] || nextTrack;
        const title = document.createElement('span');
        title.className = 'acad-page-title';
        title.textContent = next.getAttribute('data-title') + ' →';
        b.appendChild(track);
        b.appendChild(title);
      } else {
        b.textContent = next.getAttribute('data-title') + ' →';
      }
      pager.appendChild(b);
    } else {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'acad-page-btn';
      b.setAttribute('data-goto', '__drill__');
      const track = document.createElement('span');
      track.className = 'acad-page-track';
      track.textContent = 'All tracks complete 🎉';
      const title = document.createElement('span');
      title.className = 'acad-page-title';
      title.textContent = 'Daily drill, Flow Explorer & the Final Exam →';
      b.appendChild(track);
      b.appendChild(title);
      pager.appendChild(b);
    }
  }

  // `dropPosition` says whether arriving at the hub should retire the learner's saved reading
  // position, and it is passed by the ONE kind of caller entitled to: an explicit "back to all
  // tracks" action, plus a track reset (whose saved position likely points inside the track that
  // was just cleared). Every other way of landing here — deep links like the navbar's
  // /academy#acadExam "Certificates" link, the profile nudge, hub-widget chaining, the tour, the
  // browser's Back button, a fresh boot with no hash — keeps it: merely LOOKING at the hub is not
  // "I am done with my lesson", and dropping the position on those paths meant that checking your
  // certificates destroyed "continue where you left off" on that device (worse, a fresh boot's
  // tombstone was dated newer than the server's stored position, so this device then refused to
  // adopt where the learner's OTHER device left off).
  function showHub(focusId, dropPosition) {
    reader.hidden = true;
    hub.hidden = false;
    lessons.forEach(function (s) { s.classList.remove('is-active'); });
    if (location.hash) history.replaceState(null, '', location.pathname);
    if (dropPosition) dropSavedPosition();
    updateProgress();
    renderResumeBanner();
    // Clear any leftover lesson-search state: navigating away from the hub with results showing
    // used to strand the track grid and persona paths hidden behind a stale results pane.
    if (resetHubSearch) resetHubSearch();
    const focusEl = focusId ? document.getElementById(focusId) : null;
    if (focusEl) {
      focusEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      focusEl.classList.add('acad-hub-pulse');
      setTimeout(function () { focusEl.classList.remove('acad-hub-pulse'); }, 2200);
    } else {
      window.scrollTo({ top: 0 });
    }
  }

  function dropSavedPosition() {
    // Drop the saved lesson, but leave a TOMBSTONE timestamp behind rather than clearing both.
    //
    // The obvious move is to remove both keys, and it is wrong in a way that only shows up for a
    // signed-in learner. The merge in applyServerProgress adopts the server's position when
    // `!localAt || serverAt > localAt` — and `!localAt` is the FIRST clause, so removing KEY_POS_AT
    // makes adoption UNCONDITIONAL. Backing out to the hub, reloading, and letting the sync run
    // would hand the server's stored position straight back, and the next visit would boot into the
    // very lesson the learner just left. (An earlier comment here claimed the opposite — that
    // keeping the timestamp is what allows the resurrection. It is worth being precise: the
    // timestamp is what PREVENTS it.)
    //
    // A tombstone dated now says "I deliberately have no position, as of this moment", which loses
    // to a genuinely newer position from another device and beats the stale one we just cleared.
    // The server has no way to represent a cleared position, so this stays local by design: a fresh
    // device with no local state still adopts the server's lesson, which is the wanted behaviour.
    try {
      localStorage.removeItem(KEY_POS);
      localStorage.setItem(KEY_POS_AT, new Date().toISOString());
    } catch (e) {}
  }

  // Guided tour: teaches newcomers how to get from lesson 1 to the certificate.
  const ACAD_TOUR = [
    { title: 'Welcome to the IntegrAuth Academy', text: '12 tracks, 135 byte-sized lessons and hands-on labs — free, and no account needed to learn (only the final exam and certificate ask you to sign in). Here’s how to get from your first lesson to your certificate.' },
    { selector: '.acad-track-card', title: '1. Pick a track', text: 'Click any track card — or a lesson link inside it — to start reading. Each lesson is a 3–5 minute read.' },
    // No dedicated selector of its own on purpose: chips/pager only exist inside an open lesson,
    // not on the hub the tour plays out on, so this reused .acad-track-card's spotlight instead of
    // falling back to a page-top scroll — which read as a random, disconnected highlight since the
    // step's own text is about navigating within a track, the same thing step 1 pointed at.
    { selector: '.acad-track-card', title: '2. Move through lessons', text: 'Inside a lesson, use the chips up top or the ← / → buttons at the bottom to move between lessons — even across tracks. Your progress saves automatically as you go.' },
    { selector: '#acadDrill', title: '3. Daily drill', text: 'Read every lesson and the → button carries you here: five quick questions a day from across every track — wrong answers come back sooner, and a streak keeps you honest.' },
    { selector: '#acadFlows', title: '4. Flow Explorer', text: 'Next: replay real auth flows step by step — sixteen of them, from the auth-code dance to MCP authorization.' },
    { selector: '#acadChallenge', title: '5. Challenge mode', text: 'Then: spot the security flaw in ten real-world scenarios, then pick the fix.' },
    // Question count must match `N` in lab-exam's draw (js/academy-labs.js) — it was left saying 25
    // after the exam grew to 50, which is also what made a legacy saved pass unclaimable: its raw
    // correct-answer count had been scored against a different denominator.
    { selector: '#acadExam', title: '6. Final exam & certificate', text: 'Finish with a 50-question exam pulled from every track. Sign in with a free account, score 80%+, and download a certificate anyone can verify.' },
    { selector: '#acadAccount', title: '7. Your account', text: 'Signing in is the same free account as the IntegrAuth Lab — one sign-in, both apps. Here you can set the name that prints on your certificate, see which devices are signed in, and sign out of the Academy on one device or everywhere at once.' },
    // Points at the progress bar at the TOP of the hub. There used to be a second, identical bar at
    // the very bottom that existed only to give this step something to spotlight; it has been
    // removed as a duplicate, so this step targets the real one.
    { selector: '.acad-hub-progress', title: 'Your progress', text: 'Progress saves in this browser — and syncs to your account across devices when you sign in. Reset a single track from inside it, reset everything here, or replay this tour anytime — all from this bar.' }
  ];
  let acadTourActive = false;
  let acadTourStep = 0;
  let acadTourSpotEl = null;
  let acadTourCard = null;

  function tourClearSpot() {
    if (acadTourSpotEl) { acadTourSpotEl.classList.remove('acad-tour-spot'); acadTourSpotEl = null; }
  }

  function tourRender() {
    const step = ACAD_TOUR[acadTourStep];
    tourClearSpot();
    const el = step.selector ? document.querySelector(step.selector) : null;
    if (el) {
      el.classList.add('acad-tour-spot');
      acadTourSpotEl = el;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    acadTourCard.querySelector('.acad-tour-title').textContent = step.title;
    acadTourCard.querySelector('.acad-tour-text').textContent = step.text;
    acadTourCard.querySelector('.acad-tour-count').textContent = (acadTourStep + 1) + ' / ' + ACAD_TOUR.length;
    acadTourCard.querySelector('.acad-tour-back').disabled = acadTourStep === 0;
    acadTourCard.querySelector('.acad-tour-next').textContent = acadTourStep === ACAD_TOUR.length - 1 ? 'Done' : 'Next →';
  }

  function tourKeydown(e) {
    if (e.key === 'Escape') endTour();
  }

  function endTour() {
    if (!acadTourActive) return;
    acadTourActive = false;
    tourClearSpot();
    if (acadTourCard) { acadTourCard.remove(); acadTourCard = null; }
    document.removeEventListener('keydown', tourKeydown);
  }

  function startTour() {
    if (acadTourActive) return;
    showHub();
    acadTourActive = true;
    acadTourStep = 0;
    acadTourCard = document.createElement('div');
    acadTourCard.className = 'acad-tour-card';
    acadTourCard.setAttribute('role', 'dialog');
    acadTourCard.setAttribute('aria-label', 'Academy tour');
    acadTourCard.innerHTML =
      '<div class="acad-tour-head"><span class="acad-tour-title"></span><span class="acad-tour-count"></span></div>' +
      '<p class="acad-tour-text"></p>' +
      '<div class="acad-tour-nav"><button type="button" class="acad-tour-dismiss">Skip tour</button>' +
      '<div class="acad-tour-btns"><button type="button" class="acad-tour-back">← Back</button>' +
      '<button type="button" class="acad-tour-next">Next →</button></div></div>';
    document.body.appendChild(acadTourCard);
    acadTourCard.querySelector('.acad-tour-dismiss').addEventListener('click', endTour);
    acadTourCard.querySelector('.acad-tour-back').addEventListener('click', function () {
      if (acadTourStep > 0) { acadTourStep--; tourRender(); }
    });
    acadTourCard.querySelector('.acad-tour-next').addEventListener('click', function () {
      if (acadTourStep === ACAD_TOUR.length - 1) { endTour(); return; }
      acadTourStep++; tourRender();
    });
    document.addEventListener('keydown', tourKeydown);
    tourRender();
  }

  // Live-update check: GitHub Pages is static (no push channel), so poll a
  // tiny version marker and offer a reload. Progress lives in localStorage,
  // so a reload never loses anything — safe to prompt at any point. Kept
  // light on the server: checked only on tab refocus and whenever the
  // learner crosses into a new track (not on every lesson turn, no interval).
  const acadBuildMeta = document.querySelector('meta[name="acad-build"]');
  const acadCurrentBuild = acadBuildMeta ? acadBuildMeta.content : null;
  let acadUpdateSettled = false; // stop polling once a toast has been shown or dismissed
  let acadLastCheckedTrack = null;

  function showUpdateToast() {
    if (acadUpdateSettled) return;
    acadUpdateSettled = true;
    const toast = document.createElement('div');
    toast.className = 'acad-update-toast';
    toast.setAttribute('role', 'status');
    toast.innerHTML =
      '<span>New lessons &amp; fixes are available.</span>' +
      '<button type="button" class="acad-update-reload">&#8635; Reload</button>' +
      '<button type="button" class="acad-update-dismiss" aria-label="Dismiss">&times;</button>';
    toast.querySelector('.acad-update-reload').addEventListener('click', function () { location.reload(); });
    toast.querySelector('.acad-update-dismiss').addEventListener('click', function () { toast.remove(); });
    document.body.appendChild(toast);
  }

  function checkForUpdate() {
    if (acadUpdateSettled || !acadCurrentBuild) return;
    fetch('/academy-version.txt', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (v) { if (v && v.trim() && v.trim() !== acadCurrentBuild) showUpdateToast(); })
      .catch(function () {});
  }

  if (acadCurrentBuild) {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { checkForUpdate(); maybeShowProfileNudge(); maybeShowLoginNudge(); }
    });
  }

  // Progressive-profiling nudge: logged-in learners with no certificate name yet get a
  // small dismissible banner (same shape as the live-update toast above) suggesting they
  // add one now, so it's ready when they earn a certificate. Never shown logged-out — the
  // login/profile checks themselves live in AcademyAuth (js/academy-auth.js); this is just
  // the academy.html-only UI on top, reusing .acad-update-toast styling per convention.
  function showProfileNudge() {
    if (document.querySelector('.acad-profile-nudge')) return;
    const toast = document.createElement('div');
    toast.className = 'acad-update-toast acad-profile-nudge';
    toast.setAttribute('role', 'status');
    toast.innerHTML =
      '<span>Add your name so it’s ready when you earn a certificate.</span>' +
      '<button type="button" class="acad-update-reload acad-nudge-add">Add name</button>' +
      '<button type="button" class="acad-update-dismiss" aria-label="Dismiss">&times;</button>';
    toast.querySelector('.acad-nudge-add').addEventListener('click', function () {
      toast.remove();
      window.AcademyAuth.dismissProfileNudge();
      showHub('acadAccount');
    });
    toast.querySelector('.acad-update-dismiss').addEventListener('click', function () {
      toast.remove();
      window.AcademyAuth.dismissProfileNudge();
    });
    document.body.appendChild(toast);
  }

  function maybeShowProfileNudge() {
    if (!window.AcademyAuth || typeof window.AcademyAuth.shouldShowProfileNudge !== 'function') return;
    window.AcademyAuth.shouldShowProfileNudge().then(function (show) {
      if (show) showProfileNudge();
    });
  }

  // Sign-in-to-sync nudge: mirrors the live-update toast and the profile nudge above —
  // same trigger points (tab refocus, crossing into a new track), same toast shape. Shown
  // to a learner who is NOT signed in but whose device already holds real progress, so
  // it's one cleared cache / lost device away from being gone for good. hasUnsyncedLocalProgress()
  // is this closure's own check (it owns acad_read/acad_quiz/acad_pos); AcademyAuth only
  // knows the session + dismiss state, so both are passed together.
  function showLoginNudge() {
    if (document.querySelector('.acad-login-nudge')) return;
    const toast = document.createElement('div');
    toast.className = 'acad-update-toast acad-login-nudge';
    toast.setAttribute('role', 'status');
    toast.innerHTML =
      '<span>Sign in to save your progress so it isn’t lost.</span>' +
      '<button type="button" class="acad-update-reload acad-nudge-signin">Sign in</button>' +
      '<button type="button" class="acad-update-dismiss" aria-label="Dismiss">&times;</button>';
    toast.querySelector('.acad-nudge-signin').addEventListener('click', function () {
      toast.remove();
      window.AcademyAuth.dismissLoginNudge();
      window.AcademyAuth.signIn({});
    });
    toast.querySelector('.acad-update-dismiss').addEventListener('click', function () {
      toast.remove();
      window.AcademyAuth.dismissLoginNudge();
    });
    document.body.appendChild(toast);
  }

  function maybeShowLoginNudge() {
    if (!window.AcademyAuth || typeof window.AcademyAuth.shouldShowLoginNudge !== 'function') return;
    if (window.AcademyAuth.shouldShowLoginNudge(hasUnsyncedLocalProgress())) showLoginNudge();
  }

  /**
   * Every call to showLesson() is a deliberate navigation now — a chip, the pager, search, a deep
   * link, or clicking the hub's Resume banner. Boot no longer calls this passively to reopen a
   * saved position (see the Resume banner section below), so acad_pos_at is unconditionally
   * restamped to "now" below. That restamp matters for cross-device sync, which merges the saved
   * position last-write-wins on this timestamp: it must only move when the learner actually moved,
   * or a stale device could win a merge purely by being opened.
   */
  function showLesson(id, skipScroll) {
    const lesson = byId[id];
    if (!lesson) return false;
    if (acadTourActive) endTour();
    hub.hidden = true;
    reader.hidden = false;
    lessons.forEach(function (s) { s.classList.toggle('is-active', s === lesson); });
    const track = trackOf(lesson);
    if (track !== acadLastCheckedTrack) { acadLastCheckedTrack = track; checkForUpdate(); maybeShowProfileNudge(); maybeShowLoginNudge(); }
    const label = document.getElementById('acadTrackLabel');
    if (label) label.textContent = TRACK_LABELS[track] || track;
    const read = readSet();
    if (isQuizLesson(lesson)) {
      if (syncQuizProgress(lesson)) read.add(id);
    } else if (!labOf(lesson)) {
      read.add(id);
    }
    saveRead(read);
    syncLabGate(lesson);
    try {
      localStorage.setItem(KEY_POS, id);
      localStorage.setItem(KEY_POS_AT, new Date().toISOString());
    } catch (e) {}
    buildChips(track, id);
    buildPager(lesson);
    ensureReadTime(lesson);
    updateProgress();
    if ('#' + id !== location.hash) history.replaceState(null, '', '#' + id);
    if (!skipScroll) window.scrollTo({ top: 0 });
    return true;
  }

  // "~N min read" chip next to the lesson's track pill, computed once per
  // lesson from its actual text (220 wpm) the first time it is opened.
  function ensureReadTime(lesson) {
    if (lesson.querySelector('.acad-readtime')) return;
    const chnum = lesson.querySelector('.acad-chnum');
    if (!chnum) return;
    const words = (lesson.textContent.match(/\S+/g) || []).length;
    const mins = Math.max(1, Math.round(words / 220));
    const chip = document.createElement('span');
    chip.className = 'acad-readtime';
    chip.textContent = '~' + mins + ' min read';
    chnum.insertAdjacentElement('afterend', chip);
  }

  // ← / → keys page between lessons while the reader is open. Typing fields
  // and the labs keep their keys — labs are interactive sims, so arrows there
  // must never yank the learner to another lesson.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (reader.hidden) return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable], .acad-lab')) return;
    const active = lessons.filter(function (s) { return s.classList.contains('is-active'); })[0];
    if (!active) return;
    const dest = lessons[lessons.indexOf(active) + (e.key === 'ArrowRight' ? 1 : -1)];
    if (dest) {
      e.preventDefault();
      showLesson(dest.id);
    }
  });

  // Delegated navigation: chips, pager, hub links, in-lesson cross-links
  document.addEventListener('click', function (e) {
    const gotoBtn = e.target.closest('[data-goto]');
    if (gotoBtn) {
      e.preventDefault();
      const id = gotoBtn.getAttribute('data-goto');
      const HUB_SECTIONS = { __flows__: 'acadFlows', __challenge__: 'acadChallenge', __drill__: 'acadDrill', __exam__: 'acadExam' };
      // Only the explicit "back to all tracks" action retires the saved position — chaining into
      // the hub widgets (__flows__/__challenge__/__drill__/__exam__) is exploration, not "I am done reading".
      if (id === '__hub__') showHub(null, true);
      else if (HUB_SECTIONS[id]) showHub(HUB_SECTIONS[id]);
      else showLesson(id);
      return;
    }
    const link = e.target.closest('a[href^="#"]');
    if (link && byId[(link.getAttribute('href') || '').slice(1)]) {
      e.preventDefault();
      showLesson(link.getAttribute('href').slice(1));
      return;
    }
    const reveal = e.target.closest('.acad-reveal');
    if (reveal) {
      const answer = reveal.parentElement.querySelector('.acad-answer');
      if (answer) {
        answer.hidden = !answer.hidden;
        reveal.textContent = answer.hidden ? 'Reveal answer' : 'Hide answer';
        // Quiz lessons: record the reveal (hiding again doesn't un-record)
        // and mark the lesson read once every answer has been seen.
        const lesson = reveal.closest('.acad-lesson');
        if (!answer.hidden && isQuizLesson(lesson)) {
          const blocks = Array.prototype.slice.call(lesson.querySelectorAll('.acad-quiz'));
          const idx = blocks.indexOf(reveal.closest('.acad-quiz'));
          const store = quizStore();
          const list = store[lesson.id] || (store[lesson.id] = []);
          if (idx >= 0 && list.indexOf(idx) === -1) {
            list.push(idx);
            saveQuizStore(store);
            if (syncQuizProgress(lesson)) {
              const read = readSet();
              read.add(lesson.id);
              saveRead(read);
              buildChips(trackOf(lesson), lesson.id);
            }
            updateProgress();
          }
        }
      }
    }
  });

  // Any interaction inside a lesson's lab (click/tap or typing) marks it read.
  // Hub-level labs (Flow Explorer, Challenge, Exam) sit outside .acad-lesson
  // sections, so closest() skips them.
  function onLabTouch(e) {
    const lab = e.target.closest ? e.target.closest('.acad-lab') : null;
    if (!lab) return;
    const lesson = lab.closest('.acad-lesson');
    if (!lesson) return;
    const read = readSet();
    if (read.has(lesson.id)) return;
    read.add(lesson.id);
    saveRead(read);
    syncLabGate(lesson);
    buildChips(trackOf(lesson), lesson.id);
    updateProgress();
  }
  document.addEventListener('pointerdown', onLabTouch);
  document.addEventListener('keydown', onLabTouch);

  // Wrapped, not bound directly: as a raw listener the click Event would land in
  // showHub's focusId parameter and dropPosition would be undefined, so the top
  // "All tracks" button would never write the acad_pos_at tombstone the bottom
  // `__hub__` button writes — and the Resume banner (or a cross-device merge)
  // would resurrect the lesson the learner explicitly backed out of.
  const backBtn = document.getElementById('acadBack');
  if (backBtn) backBtn.addEventListener('click', function () { showHub(null, true); });

  // Themed stand-in for window.confirm(), styled to match the Academy (acad-*
  // tokens, all 4 themes) instead of a native OS dialog. Returns a Promise<boolean>.
  function acadConfirm(opts) {
    return new Promise(function (resolve) {
      const prevFocus = document.activeElement;
      const overlay = document.createElement('div');
      overlay.className = 'acad-confirm-overlay';
      overlay.innerHTML =
        '<div class="acad-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="acadConfirmTitle" aria-describedby="acadConfirmMsg">' +
          '<h3 class="acad-confirm-title" id="acadConfirmTitle"></h3>' +
          '<p class="acad-confirm-msg" id="acadConfirmMsg"></p>' +
          '<div class="acad-confirm-btns">' +
            '<button type="button" class="acad-confirm-cancel"></button>' +
            '<button type="button" class="acad-confirm-ok"></button>' +
          '</div>' +
        '</div>';
      overlay.querySelector('.acad-confirm-title').textContent = opts.title || 'Are you sure?';
      overlay.querySelector('.acad-confirm-msg').textContent = opts.message || '';
      const cancelBtn = overlay.querySelector('.acad-confirm-cancel');
      const okBtn = overlay.querySelector('.acad-confirm-ok');
      cancelBtn.textContent = opts.cancelLabel || 'Cancel';
      okBtn.textContent = opts.confirmLabel || 'OK';
      if (opts.danger) okBtn.classList.add('acad-confirm-ok-danger');

      function close(result) {
        document.removeEventListener('keydown', onKeydown);
        overlay.remove();
        if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus();
        resolve(result);
      }

      function onKeydown(e) {
        if (e.key === 'Escape') { close(false); return; }
        if (e.key === 'Tab') {
          const order = [cancelBtn, okBtn];
          const idx = order.indexOf(document.activeElement);
          e.preventDefault();
          const step = e.shiftKey ? -1 : 1;
          order[(idx + step + order.length) % order.length].focus();
        }
      }

      overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(false); });
      cancelBtn.addEventListener('click', function () { close(false); });
      okBtn.addEventListener('click', function () { close(true); });
      document.addEventListener('keydown', onKeydown);
      document.body.appendChild(overlay);
      cancelBtn.focus();
    });
  }

  // Reset ONE track: its read marks + quiz reveals + in-lesson labs; other tracks untouched.
  function resetTrack(track) {
    const items = trackLessons(track);
    const read = readSet();
    const store = quizStore();
    const lessonIds = [];
    items.forEach(function (s) {
      lessonIds.push(s.id);
      read.delete(s.id);
      delete store[s.id];
      s.querySelectorAll('.acad-quiz-check, .acad-quiz-progress, .acad-lab-gate').forEach(function (el) { el.remove(); });
      if (window.AcadLabs && typeof window.AcadLabs.remountWithin === 'function') {
        try { window.AcadLabs.remountWithin(s); } catch (e) {}
      }
    });
    saveRead(read);
    saveQuizStore(store);
    pushResetToServer({ scope: 'track', lessonIds: lessonIds, trackIds: [track] });
    // Drop the saved position too: it very likely points inside the track that was just cleared,
    // and resuming into a lesson the learner deliberately reset is the wrong welcome back.
    showHub(null, true);
  }

  // Tells the server about a reset — the one progress change the union-merge sync cannot carry.
  //
  // The first thing this does is CANCEL the pending debounced sync, and that ordering is the whole
  // point. saveRead()/saveQuizStore() above have just queued a sync whose payload still describes
  // this device's pre-reset state on some points; letting it fire would re-upload what we are in
  // the middle of deleting. (Before the reset endpoint existed, that queued sync was itself the
  // bug: the checkmarks came back roughly 800ms after the learner pressed Reset.)
  //
  // A no-op when signed out: there is no server-side progress to delete, and the local clear the
  // caller already did is the entire operation.
  function pushResetToServer(payload) {
    const hadPendingSync = !!acadSyncTimer;
    if (acadSyncTimer) { clearTimeout(acadSyncTimer); acadSyncTimer = null; }
    // Invalidate any sync ALREADY on the wire as well. Cancelling the timer only stops one that has
    // not left yet; a request in flight would still come back carrying the pre-reset epoch and the
    // full pre-reset progress, and be applied as authoritative — undoing the reset in front of the
    // learner. See acadSyncGeneration.
    // Bumped BEFORE the signed-out early returns, so a logged-out reset still invalidates anything
    // a previous signed-in moment left in flight.
    acadSyncGeneration++;
    if (!window.AcademyAuth || !window.AcademyAuth.getSession().loggedIn) return;
    if (typeof window.AcademyAuth.resetProgress !== 'function') return;
    const generation = acadSyncGeneration;

    const doReset = function () {
      window.AcademyAuth.resetProgress(payload)
        .then(function (server) {
          if (generation !== acadSyncGeneration) return;
          applyServerProgress(server);
        })
        .catch(function (err) {
          // A FAILED reset used to be silent, and silence was the worst possible outcome: the
          // local marks were already cleared, the server still held everything, and the epoch
          // never moved — so the very next lesson the learner opened triggered a union sync that
          // pulled every checkmark and the full progress bar straight back, with nothing on screen
          // to explain it. Say so instead, and offer the retry, since the learner's local state
          // and the server's have genuinely diverged until one of them wins.
          handleSyncError(err);
          showResetFailedToast(payload);
        });
    };

    if (!hadPendingSync) {
      doReset();
      return;
    }
    // The cancelled sync was not necessarily ABOUT the track being reset: the debounce window is
    // 800ms, so it may have been carrying a just-earned read mark from a DIFFERENT track that never
    // reached the server. The reset's response is epoch-bumped and applied as authoritative
    // wholesale, so if that mark is simply dropped here it is gone for good. Flush it first — from
    // the CURRENT local snapshot, which the caller has already stripped of everything being reset,
    // so the reset target cannot ride along and resurrect itself — then reset, sequentially, so the
    // union write cannot race the delete server-side. Best-effort: a failed flush must not block
    // the reset the learner actually asked for.
    window.AcademyAuth.syncProgress(localSyncSnapshot())
      .catch(function () {})
      .then(doReset);
  }

  /**
   * Tells the learner a reset did not reach the server, and offers to try again.
   *
   * Reuses the live-update toast's styling rather than inventing a second notification component.
   */
  function showResetFailedToast(payload) {
    const existing = document.getElementById('acadResetFailedToast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'acadResetFailedToast';
    toast.className = 'acad-update-toast';
    toast.setAttribute('role', 'status');
    toast.innerHTML =
      '<span>Your progress was cleared on this device, but we couldn’t reach the server — ' +
      'it may come back when you next open a lesson.</span>' +
      '<button type="button" class="acad-page-btn" id="acadResetRetry">Try again</button>' +
      '<button type="button" class="acad-update-dismiss" aria-label="Dismiss">×</button>';
    document.body.appendChild(toast);
    toast.querySelector('#acadResetRetry').addEventListener('click', function () {
      toast.remove();
      pushResetToServer(payload);
    });
    toast.querySelector('.acad-update-dismiss').addEventListener('click', function () { toast.remove(); });
  }

  document.querySelectorAll('.acad-reset-track').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const active = document.querySelector('.acad-lesson.is-active');
      if (!active) return;
      const track = trackOf(active);
      const label = (TRACK_LABELS[track] || track).replace(/^Track \d+ · /, '');
      acadConfirm({
        title: 'Reset "' + label + '"?',
        message: 'Every read mark and quiz answer in this track will be cleared. This can’t be undone.',
        confirmLabel: 'Reset track',
        danger: true
      }).then(function (ok) { if (ok) resetTrack(track); });
    });
  });

  function resetAllProgress() {
    acadConfirm({
      title: 'Reset ALL Academy progress?',
      message: 'Every read mark and quiz answer across every track will be cleared. This can’t be undone.',
      confirmLabel: 'Reset everything',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      // Uses the shared helper rather than its own list: this used to miss KEY_POS_AT, which meant
      // "reset everything" left the last-position TIMESTAMP behind. Since last-position sync is
      // last-write-wins by that timestamp, the server then pushed the just-reset position straight
      // back on the next sync. KEY_OWNER is deliberately NOT cleared — resetting your progress is
      // not signing out, so this browser's progress still belongs to the same account.
      clearLocalProgress();
      document.querySelectorAll('.acad-quiz-check, .acad-quiz-progress, .acad-lab-gate').forEach(function (el) { el.remove(); });
      // Delete it on the server too, so the reset survives and does not get re-unioned back by this
      // device's queued sync or by the next device to come online. Signed out, this is a no-op.
      pushResetToServer({ scope: 'all' });
      // Re-render on-screen labs (Challenge, Final Exam, Flow Explorer) back to their start state.
      if (window.AcadLabs && typeof window.AcadLabs.remountAll === 'function') {
        try { window.AcadLabs.remountAll(); } catch (e) {}
      }
      updateProgress();
      // The already-rendered Resume banner still holds the pre-reset lesson; without this,
      // a signed-out learner (whose reset never round-trips through applyServerProgress)
      // keeps a live "Continue where you left off" pointing at progress they just erased.
      renderResumeBanner();
    });
  }

  document.querySelectorAll('.acad-reset-all').forEach(function (btn) {
    btn.addEventListener('click', resetAllProgress);
  });

  // Hub-level widgets/sections (Flow Explorer, Challenge mode, Final Exam, Account) aren't
  // lessons, so they aren't in byId — but they ARE valid deep-link targets from other pages
  // (e.g. the navbar's "Certificates"/"Profile" links point at /academy#acadExam /
  // #acadAccount). Route those through showHub's existing focusId scroll+pulse instead of
  // falling through to the plain "clear hash, go to hub top" branch below.
  const HUB_ANCHORS = { acadFlows: 1, acadChallenge: 1, acadDrill: 1, acadExam: 1, acadAccount: 1 };

  window.addEventListener('hashchange', function () {
    const id = location.hash.slice(1);
    if (byId[id]) showLesson(id);
    else if (HUB_ANCHORS[id]) showHub(id);
    else if (!id) showHub();
  });

  // Glossary live filter (input injected here so no-JS pages stay clean)
  const glossary = document.querySelector('.acad-glossary');
  if (glossary) {
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'acad-filter';
    input.placeholder = 'Filter terms…';
    input.setAttribute('aria-label', 'Filter glossary terms');
    glossary.insertBefore(input, glossary.firstChild);
    input.addEventListener('input', function () {
      const q = input.value.trim().toLowerCase();
      glossary.querySelectorAll('.acad-dl').forEach(function (dl) {
        let any = false;
        let show = false;
        Array.prototype.forEach.call(dl.children, function (el) {
          if (el.tagName === 'DT') {
            show = !q || (el.textContent + ' ' +
              (el.nextElementSibling ? el.nextElementSibling.textContent : ''))
              .toLowerCase().indexOf(q) !== -1;
            if (show) any = true;
          }
          el.style.display = show ? '' : 'none';
        });
        dl.style.display = any ? '' : 'none';
        const letter = dl.previousElementSibling;
        if (letter && letter.classList.contains('acad-letter')) {
          letter.style.display = any ? '' : 'none';
        }
      });
    });
  }

  // ----- Hub enhancements (injected so no-JS pages keep the static track grid) -----
  const grid = hub.querySelector('.acad-track-grid');

  // Assigned inside the search block below; showHub() calls it (when set) so returning to the
  // hub never shows a stale results pane over a hidden track grid.
  let resetHubSearch = null;

  // Minimal HTML escaper for the few places hub UI interpolates strings into innerHTML —
  // most importantly the search box's own value, which is user-typed and must never be
  // parsed as markup (self-XSS today, reflected XSS the day search ever gets URL wiring).
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  // Persona learning paths — ordered cross-track playlists. Unknown ids are skipped.
  const PERSONA_PATHS = [
    { key: 'dev', icon: 'fa-code', name: 'Developer', blurb: 'Ship a login the right way, end to end.',
      lessons: ['f1-identity', 'f3-tokens', 'b7-jwt', 'p1-oidc', 't7-birth', 'a1-passkeys', 'a10-sessions', 'r1-bff', 't1-rotation', 'az4-scopes', 'c1-signup'] },
    { key: 'arch', icon: 'fa-sitemap', name: 'Architect', blurb: 'Design the whole identity system with confidence.',
      lessons: ['f5-personas', 'f6-zerotrust', 'p5-exchange', 'r1-bff', 'r2-micro', 'r3-tenancy', 'r4-lifetimes', 'w2-wif', 'r5-buildbuy', 'r6-dr'] },
    { key: 'sec', icon: 'fa-shield-halved', name: 'Security analyst', blurb: 'Detect, defend and respond to identity attacks.',
      lessons: ['b5-encoding', 'f7-itdr', 'a3-adaptive', 'a6-breached', 'atk1-aitm', 'atk2-fatigue', 'atk5-cookies', 'atk7-detect', 'atk8-tabletop', 'o2-siem', 'c5-ato'] },
    { key: 'pm', icon: 'fa-lightbulb', name: 'Product manager', blurb: 'Balance trust, friction and compliance for users.',
      lessons: ['b1-web', 'b4-apis', 'f1-identity', 'f10-rules', 'c1-signup', 'c2-recovery', 'c4-profiling', 'a1-passkeys', 'o3-rtbf', 'c7-b2b', 'r5-buildbuy'] }
  ];

  function titleOf(id) {
    const l = byId[id];
    return l ? (l.getAttribute('data-title') || id) : id;
  }

  if (grid) {
    const tools = document.createElement('div');
    tools.className = 'acad-hubtools';

    // Search
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'acad-hub-search';
    search.placeholder = 'Search all ' + lessons.length + ' lessons…';
    search.setAttribute('aria-label', 'Search lessons');
    const results = document.createElement('div');
    results.className = 'acad-search-results';
    results.hidden = true;

    // Persona paths
    const paths = document.createElement('div');
    paths.className = 'acad-paths';
    const pathsHead = document.createElement('p');
    pathsHead.className = 'acad-paths-head';
    pathsHead.textContent = 'Or follow a learning path built for your role:';
    const pathCards = document.createElement('div');
    pathCards.className = 'acad-path-cards';
    const pathView = document.createElement('div');
    pathView.className = 'acad-path-view';
    pathView.hidden = true;

    PERSONA_PATHS.forEach(function (p) {
      const valid = p.lessons.filter(function (id) { return byId[id]; });
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'acad-path-card';
      btn.setAttribute('data-path', p.key);
      btn.innerHTML = '<i class="fas ' + p.icon + '" aria-hidden="true"></i>' +
        '<span class="acad-path-name">' + p.name + '</span>' +
        '<span class="acad-path-blurb">' + p.blurb + '</span>' +
        '<span class="acad-path-count">' + valid.length + ' lessons</span>';
      btn.addEventListener('click', function () {
        const active = btn.classList.contains('is-open');
        pathCards.querySelectorAll('.acad-path-card').forEach(function (c) { c.classList.remove('is-open'); });
        if (active) { pathView.hidden = true; return; }
        btn.classList.add('is-open');
        renderPath(p, valid);
      });
      pathCards.appendChild(btn);
    });

    function renderPath(p, valid) {
      const read = readSet();
      const done = valid.filter(function (id) { return read.has(id); }).length;
      const ol = document.createElement('ol');
      ol.className = 'acad-path-list';
      valid.forEach(function (id) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = '#' + id;
        a.setAttribute('data-goto', id);
        a.className = 'acad-path-link' + (read.has(id) ? ' acad-read' : '');
        a.innerHTML = '<span class="acad-path-track">' + (TRACK_LABELS[trackOf(byId[id])] || '').replace(/^Track \d+ · /, '') + '</span>' +
          '<span class="acad-path-title">' + titleOf(id) + '</span>';
        li.appendChild(a);
        ol.appendChild(li);
      });
      pathView.innerHTML = '<div class="acad-path-view-head"><strong>' + p.name + ' path</strong>' +
        '<span class="acad-path-progress">' + done + '/' + valid.length + ' done</span></div>';
      pathView.appendChild(ol);
      pathView.hidden = false;
    }

    paths.appendChild(pathsHead);
    paths.appendChild(pathCards);
    paths.appendChild(pathView);

    function runSearch() {
      const q = search.value.trim().toLowerCase();
      if (!q) { results.hidden = true; results.innerHTML = ''; grid.hidden = false; paths.hidden = false; return; }
      const hits = lessons.filter(function (l) {
        const lead = l.querySelector('.acad-lead');
        const hay = ((l.getAttribute('data-title') || '') + ' ' + (lead ? lead.textContent : '')).toLowerCase();
        return hay.indexOf(q) !== -1;
      });
      grid.hidden = true; paths.hidden = true; results.hidden = false;
      if (!hits.length) { results.innerHTML = '<p class="acad-search-none">No lessons match “' + escapeHtml(q) + '”.</p>'; return; }
      results.innerHTML = '<p class="acad-search-count">' + hits.length + ' lesson' + (hits.length > 1 ? 's' : '') + ' match “' + escapeHtml(q) + '”</p>';
      const ul = document.createElement('div');
      ul.className = 'acad-search-list';
      hits.forEach(function (l) {
        const a = document.createElement('a');
        a.href = '#' + l.id;
        a.setAttribute('data-goto', l.id);
        a.className = 'acad-search-hit';
        a.innerHTML = '<span class="acad-search-track">' + escapeHtml((TRACK_LABELS[trackOf(l)] || '').replace(/^Track \d+ · /, '')) + '</span>' +
          '<span class="acad-search-title">' + escapeHtml(l.getAttribute('data-title') || l.id) + '</span>';
        ul.appendChild(a);
      });
      results.appendChild(ul);
    }
    search.addEventListener('input', runSearch);

    // Hook for showHub(): an empty query routed through runSearch() restores the
    // grid/paths/results visibility trio to its resting state.
    resetHubSearch = function () {
      if (!search.value) return;
      search.value = '';
      runSearch();
    };

    tools.appendChild(search);
    tools.appendChild(results);
    tools.appendChild(paths);
    grid.parentNode.insertBefore(tools, grid);

    // Tour trigger, grouped with the top reset button so it stays visible from anywhere in the hub.
    const topReset = document.getElementById('acadResetAllTop');
    if (topReset && topReset.parentNode) {
      const tourBtn = document.createElement('button');
      tourBtn.type = 'button';
      tourBtn.id = 'acadTourBtn';
      tourBtn.textContent = '🧭 Take the tour';
      tourBtn.addEventListener('click', startTour);
      const actions = document.createElement('span');
      actions.className = 'acad-progress-actions';
      topReset.parentNode.insertBefore(actions, topReset);
      actions.appendChild(tourBtn);
      actions.appendChild(topReset);
    }
  }

  // Glossary tooltips: hover/focus any .acad-term to see its definition (from f11-glossary).
  (function () {
    const glossaryEl = document.querySelector('.acad-glossary');
    if (!glossaryEl) return;
    const termMap = {};
    glossaryEl.querySelectorAll('.acad-dl').forEach(function (dl) {
      Array.prototype.forEach.call(dl.children, function (el) {
        if (el.tagName === 'DT' && el.nextElementSibling && el.nextElementSibling.tagName === 'DD') {
          termMap[el.textContent.trim().toLowerCase()] = el.nextElementSibling.textContent.trim();
        }
      });
    });
    const pop = document.createElement('div');
    pop.className = 'acad-tip';
    pop.hidden = true;
    document.body.appendChild(pop);
    let hideTimer = null;
    function show(el) {
      const def = el.getAttribute('data-def');
      if (!def) return;
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      pop.textContent = def;
      pop.hidden = false;
      const r = el.getBoundingClientRect();
      const top = r.bottom + window.scrollY + 6;
      pop.style.top = top + 'px';
      let left = r.left + window.scrollX;
      const maxLeft = window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 12;
      if (left > maxLeft) left = Math.max(window.scrollX + 8, maxLeft);
      pop.style.left = left + 'px';
    }
    function hide() { hideTimer = setTimeout(function () { pop.hidden = true; }, 120); }
    let enhanced = false;
    function enhance() {
      if (enhanced) return; enhanced = true;
      document.querySelectorAll('.acad-lesson .acad-term').forEach(function (t) {
        const key = t.textContent.trim().toLowerCase();
        const def = termMap[key];
        if (!def) return;
        t.setAttribute('data-def', def);
        t.setAttribute('tabindex', '0');
        t.classList.add('acad-term-has-def');
        t.addEventListener('mouseenter', function () { show(t); });
        t.addEventListener('mouseleave', hide);
        t.addEventListener('focus', function () { show(t); });
        t.addEventListener('blur', hide);
      });
    }
    enhance();
  })();

  // ----- Resume banner (injected into the hub; see boot section below) -----
  //
  // Boot used to auto-open the saved lesson directly ("passive resume", showLesson(saved, true,
  // true)) on a plain /academy visit. That silently dropped a returning visitor back inside
  // whatever lesson they were last on — a new tab, a bookmark, or opening the site days later all
  // looked identical to "resume reading", with no way to tell it was about to happen. The hub is
  // now always the boot destination absent an explicit hash; this banner offers an explicit
  // "Continue" action instead, naming the saved lesson and when it was last visited (acad_pos /
  // acad_pos_at — unchanged, still the same fields the cross-device sync merges on). Only clicking
  // Continue is a deliberate navigation and restamps the position (see showLesson's header);
  // rendering this banner writes nothing, so a stale device that never gets clicked can never win
  // a sync merge purely by having been opened.
  let resumeBannerEl = null;

  function relativeTime(iso) {
    const then = iso ? Date.parse(iso) : NaN;
    if (isNaN(then)) return '';
    const diffMs = Date.now() - then;
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + ' minute' + (min === 1 ? '' : 's') + ' ago';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + ' hour' + (hr === 1 ? '' : 's') + ' ago';
    const day = Math.floor(hr / 24);
    if (day < 30) return day + ' day' + (day === 1 ? '' : 's') + ' ago';
    try { return new Date(then).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch (e) { return ''; }
  }

  // Called on every showHub() and after every server progress merge, so it always reflects
  // whatever acad_pos/acad_pos_at currently hold — including a newer position adopted from another
  // device mid-session. Cheap and idempotent; safe to call even while the hub isn't visible.
  function renderResumeBanner() {
    let id = null, at = null;
    try { id = localStorage.getItem(KEY_POS); at = localStorage.getItem(KEY_POS_AT); } catch (e) {}
    const lesson = id ? byId[id] : null;
    if (!lesson) {
      if (resumeBannerEl) resumeBannerEl.hidden = true;
      return;
    }
    if (!resumeBannerEl) {
      resumeBannerEl = document.createElement('div');
      resumeBannerEl.className = 'acad-resume-banner';
      resumeBannerEl.innerHTML =
        '<div class="acad-resume-text">' +
          '<span class="acad-resume-label">Continue where you left off</span>' +
          '<span class="acad-resume-lesson"></span>' +
          '<span class="acad-resume-when"></span>' +
        '</div>' +
        '<div class="acad-resume-actions">' +
          '<button type="button" class="acad-resume-go">Continue &rarr;</button>' +
          '<button type="button" class="acad-resume-dismiss" aria-label="Dismiss">&times;</button>' +
        '</div>';
      hub.insertBefore(resumeBannerEl, hub.firstChild);
      resumeBannerEl.querySelector('.acad-resume-go').addEventListener('click', function () {
        const target = resumeBannerEl.getAttribute('data-lesson');
        if (target) showLesson(target);
      });
      resumeBannerEl.querySelector('.acad-resume-dismiss').addEventListener('click', function () {
        resumeBannerEl.hidden = true;
      });
    }
    resumeBannerEl.setAttribute('data-lesson', id);
    resumeBannerEl.querySelector('.acad-resume-lesson').textContent =
      (TRACK_LABELS[trackOf(lesson)] || '').replace(/^Track \d+ · /, '') + ' — ' + titleOf(id);
    const when = relativeTime(at);
    resumeBannerEl.querySelector('.acad-resume-when').textContent = when ? ('Last visited ' + when) : '';
    resumeBannerEl.hidden = false;
  }

  // Boot: URL hash wins > hub (with a Resume banner for any saved position)
  const initial = location.hash.slice(1);
  if (initial && byId[initial]) {
    showLesson(initial, true);
  } else if (initial && HUB_ANCHORS[initial]) {
    showHub(initial);
    // A deep link arriving from another page (e.g. the navbar's Profile/Certificates links)
    // fires this scrollIntoView before Bootstrap's CSS — loaded async, see the boot loader
    // section — has actually applied. Bootstrap's grid/spacing rules reflow the hub afterward,
    // so the first scroll lands at coordinates that are stale by the time layout settles and
    // the learner ends up back near the top instead of at the section they clicked. Re-run the
    // same scroll once layout has actually settled. A `load` listener was the first attempt and
    // is not enough: on fast/warm-cache loads `load` has already fired before jQuery's ready
    // callback reaches this line (listener never runs), and even when it does fire, the async
    // stylesheets' rel-swap can reflow AFTER `load`. So instead: poll the document height
    // briefly and re-scroll (instantly — smooth would fight repeated corrections) after every
    // change, stopping once it has held still for a few ticks or ~5s.
    let settleLastH = 0, settleStable = 0, settleTicks = 0;
    const settleTimer = setInterval(function () {
      settleTicks++;
      const el = document.getElementById(initial);
      if (hub.hidden || !el || settleTicks > 25) { clearInterval(settleTimer); return; }
      const h = document.documentElement.scrollHeight;
      if (h !== settleLastH) {
        settleLastH = h;
        settleStable = 0;
        el.scrollIntoView({ block: 'start' });
      } else if (++settleStable >= 3) {
        clearInterval(settleTimer);
      }
    }, 200);
  } else {
    showHub();
    // First-ever, fresh landing on the hub (no deep link, no saved position at all) — offer the
    // tour once. A learner with a saved position has been through the hub before; the resume
    // banner is the relevant prompt for them, not the tour.
    let saved = null;
    try { saved = localStorage.getItem(KEY_POS); } catch (e) {}
    if (!saved) {
      try {
        if (!localStorage.getItem('acad_tour_seen')) {
          localStorage.setItem('acad_tour_seen', '1');
          setTimeout(function () {
            // Skip if the learner has already navigated away from the hub in the meantime.
            if (!location.hash) startTour();
          }, 900);
        }
      } catch (e) {}
    }
  }
  // A learner who's already signed in when they land straight in a lesson (deep link)
  // would otherwise never see the profile nudge until they change tracks or refocus
  // the tab — check once at boot too. Same reasoning for the signed-out login nudge: a
  // learner landing straight on the hub (no lesson, so no track-change check fires) with
  // prior local progress would otherwise never see it until their first refocus.
  maybeShowProfileNudge();
  maybeShowLoginNudge();
  // Same reasoning for progress sync: pull down (and push up) this account's canonical progress once
  // at boot, not just on a later login/track-change.
  //
  // But WAIT for AcademyAuth.ready() first. `getSession()` returns a localStorage cache, which is
  // only a guess about who is signed in; the first sync WRITES, so doing it against a guess is how a
  // previous learner's local progress ends up in this learner's account on a shared browser. ready()
  // resolves once identity has been settled with the server — or once we know there is no server to
  // ask, pre-cutover — and reconcileProgressOwner has therefore already run. Rendering still uses the
  // cache immediately; only the write waits.
  //
  // And take the SAME claim-vs-sync branch the academy-auth-changed listener takes. Calling
  // scheduleSync() unconditionally here looks harmless and destroys anonymous progress in a case
  // that is easy to hit: read some lessons signed out, sign in from ANOTHER page's navbar (every
  // page loads academy-auth.js), then open /academy. By then the session is already signed-in, so
  // there is no identity transition, no event fires, and the listener — the only other caller of
  // claimAnonymousProgress — never runs. The plain sync then posts epoch 0; if the account has ever
  // been reset the server rejects it as stale and answers with post-reset truth, which
  // applyServerProgress applies authoritatively, REPLACING the local state it was supposed to
  // claim. Boot is exactly as much a "first sync after signing in" as the transition is.
  const firstSync = function () {
    // Identity is settled (ready() resolved, or there is no AcademyAuth to ask) — lift the boot
    // gate first so the branch below, and claimAnonymousProgress's internal scheduleSync() calls,
    // are allowed through. See acadFirstSyncSettled.
    acadFirstSyncSettled = true;
    const auth = window.AcademyAuth;
    const session = auth && typeof auth.getSession === 'function' ? auth.getSession() : null;
    if (session && session.loggedIn && hasUnsyncedLocalProgress()) claimAnonymousProgress();
    else scheduleSync();
  };
  if (window.AcademyAuth && typeof window.AcademyAuth.ready === 'function') {
    window.AcademyAuth.ready().then(firstSync);
  } else {
    // Reachable when academy-auth.js has not executed yet — deferred scripts run in order, but
    // jQuery's ready callback can resolve as a microtask before the later files are fetched. The
    // academy-auth-changed listener above then fires the first sync instead, once AcademyAuth's own
    // boot refresh resolves, which is after reconciliation.
    firstSync();
  }
  // Boot routing is resolved (hub or lesson is now the visible one) — drop the loader.
  dismissBootLoader();
}
