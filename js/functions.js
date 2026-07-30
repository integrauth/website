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

    // Mouse wheel over the marquee drives it horizontally instead of scrolling
    // the page (move off the marquee to scroll the page). Touch is unaffected —
    // wheel events don't fire for touch, so mobile keeps native swipe.
    marquee.addEventListener('wheel', function (e) {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!delta) return;
      e.preventDefault();
      pause(); // hover already pauses; this also clears any pending resume
      const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? marquee.clientWidth : 1;
      marquee.scrollLeft += delta * unit;
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
    modal.classList.remove('show');
    document.body.style.overflow = '';
  }
}

// Initialize on DOM ready
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
    $menu.css({
      position: 'fixed',
      top: (rect.bottom + 8) + 'px',
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
    const modal = document.getElementById('productModal');
    if (modal && modal.classList.contains('show')) {
      modal.classList.remove('show');
      document.body.style.overflow = '';
    }
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
  const KEY_OWNER = 'acad_owner'; // userId this browser's local progress currently belongs to

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

  // All of this browser's Academy progress in one place, so both call sites below (account
  // switch, sign-out) wipe the same list instead of drifting out of sync with each other.
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
    const activeLesson = lessons.filter(function (s) { return s.classList.contains('is-active'); })[0];
    if (activeLesson) {
      if (isQuizLesson(activeLesson)) syncQuizProgress(activeLesson);
      buildChips(trackOf(activeLesson), activeLesson.id);
    }
  }

  let acadSyncTimer = null;
  // Debounced (not per-keystroke-chatty) — fires on every read-mark/quiz-reveal via the
  // patched saveRead/saveQuizStore above, on login (academy-auth-changed), and once at
  // boot if a session is already cached. No-ops silently when logged out.
  function scheduleSync() {
    if (acadApplyingServerProgress) return;
    if (!window.AcademyAuth || !window.AcademyAuth.getSession().loggedIn) return;
    if (acadSyncTimer) clearTimeout(acadSyncTimer);
    acadSyncTimer = setTimeout(function () {
      acadSyncTimer = null;
      window.AcademyAuth.syncProgress(localSyncSnapshot())
        .then(applyServerProgress)
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

  // Local progress (acad_read/acad_quiz/acad_pos/acad_pos_at/acad_exam) lives in this
  // BROWSER, not tied to any account — so on a shared/kiosk machine, if learner A signs
  // out and learner B signs in next on the same browser, B's very first debounced sync
  // would upload A's read-lessons and quiz-reveals as B's own. Worse, A's saved acad_exam
  // record (best score + passed flag) would still be sitting in localStorage, so
  // lab-exam's "claim this local pass as your certificate" offer (academy-labs.js) would
  // hand B a real, permanently-verifiable certificate (see /verify) for an exam A took —
  // one click away from a false credential in B's name. acad_owner pins this browser's
  // local progress to the userId that produced it: a mismatch means the state on this
  // device belongs to someone else and must be thrown away before sync — or the exam
  // panel's remount below — ever gets a chance to read or upload it. No owner recorded
  // yet means the existing local progress predates any sign-in on this browser, which is
  // the intentional "carry my anonymous progress into my new account" path — it's simply
  // claimed (stamped), not wiped.
  document.addEventListener('academy-auth-changed', function (e) {
    const session = e.detail && e.detail.session;
    if (session && session.loggedIn) {
      let owner = null;
      try { owner = localStorage.getItem(KEY_OWNER); } catch (err) {}
      if (owner && owner !== session.userId) clearLocalProgress();
      try { localStorage.setItem(KEY_OWNER, session.userId); } catch (err) {}
      updateProgress();
      scheduleSync();
    } else {
      clearLocalProgress();
      try { localStorage.removeItem(KEY_OWNER); } catch (err) {}
      updateProgress();
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
      b.setAttribute('data-goto', '__flows__');
      const track = document.createElement('span');
      track.className = 'acad-page-track';
      track.textContent = 'All tracks complete 🎉';
      const title = document.createElement('span');
      title.className = 'acad-page-title';
      title.textContent = 'Flow Explorer, Challenge mode & Final Exam →';
      b.appendChild(track);
      b.appendChild(title);
      pager.appendChild(b);
    }
  }

  function showHub(focusId) {
    reader.hidden = true;
    hub.hidden = false;
    lessons.forEach(function (s) { s.classList.remove('is-active'); });
    if (location.hash) history.replaceState(null, '', location.pathname);
    // Both must clear together: leaving KEY_POS_AT behind after KEY_POS is gone means the
    // NEXT server sync sees "no local position, but a recent-looking timestamp" and, being
    // last-write-wins by timestamp, can resurrect the exact lesson the learner just backed
    // out of the moment the server's own lastPosition is older than that stale timestamp.
    try { localStorage.removeItem(KEY_POS); localStorage.removeItem(KEY_POS_AT); } catch (e) {}
    updateProgress();
    const focusEl = focusId ? document.getElementById(focusId) : null;
    if (focusEl) {
      focusEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      focusEl.classList.add('acad-hub-pulse');
      setTimeout(function () { focusEl.classList.remove('acad-hub-pulse'); }, 2200);
    } else {
      window.scrollTo({ top: 0 });
    }
  }

  // Guided tour: teaches newcomers how to get from lesson 1 to the certificate.
  const ACAD_TOUR = [
    { title: 'Welcome to the IntegrAuth Academy', text: '12 tracks, 133 byte-sized lessons and hands-on labs — all client-side, nothing to sign up for. Here’s how to get from your first lesson to your certificate.' },
    { selector: '.acad-track-card', title: '1. Pick a track', text: 'Click any track card — or a lesson link inside it — to start reading. Each lesson is a 3–5 minute read.' },
    { title: '2. Move through lessons', text: 'Inside a lesson, use the chips up top or the ← / → buttons at the bottom to move between lessons — even across tracks. Your progress saves automatically as you go.' },
    { selector: '#acadFlows', title: '3. Flow Explorer', text: 'Read every lesson and the → button carries you here: replay real auth flows step by step.' },
    { selector: '#acadChallenge', title: '4. Challenge mode', text: 'Next: spot the security flaw in five real-world scenarios, then pick the fix.' },
    { selector: '#acadExam', title: '5. Final exam & certificate', text: 'Finish with a 25-question exam pulled from every track. Score 80%+ to unlock a certificate you can download.' },
    { selector: '.acad-hub-foot', title: 'Your progress', text: 'Everything lives in your browser — reset a single track, or replay this tour anytime from the button up top.' }
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
      if (document.visibilityState === 'visible') { checkForUpdate(); maybeShowProfileNudge(); }
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

  function showLesson(id, skipScroll) {
    const lesson = byId[id];
    if (!lesson) return false;
    if (acadTourActive) endTour();
    hub.hidden = true;
    reader.hidden = false;
    lessons.forEach(function (s) { s.classList.toggle('is-active', s === lesson); });
    const track = trackOf(lesson);
    if (track !== acadLastCheckedTrack) { acadLastCheckedTrack = track; checkForUpdate(); maybeShowProfileNudge(); }
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
    try { localStorage.setItem(KEY_POS, id); localStorage.setItem(KEY_POS_AT, new Date().toISOString()); } catch (e) {}
    buildChips(track, id);
    buildPager(lesson);
    updateProgress();
    if ('#' + id !== location.hash) history.replaceState(null, '', '#' + id);
    if (!skipScroll) window.scrollTo({ top: 0 });
    return true;
  }

  // Delegated navigation: chips, pager, hub links, in-lesson cross-links
  document.addEventListener('click', function (e) {
    const gotoBtn = e.target.closest('[data-goto]');
    if (gotoBtn) {
      e.preventDefault();
      const id = gotoBtn.getAttribute('data-goto');
      const HUB_SECTIONS = { __flows__: 'acadFlows', __challenge__: 'acadChallenge', __exam__: 'acadExam' };
      if (id === '__hub__') showHub();
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

  const backBtn = document.getElementById('acadBack');
  if (backBtn) backBtn.addEventListener('click', showHub);

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
    showHub();
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
    if (acadSyncTimer) { clearTimeout(acadSyncTimer); acadSyncTimer = null; }
    if (!window.AcademyAuth || !window.AcademyAuth.getSession().loggedIn) return;
    if (typeof window.AcademyAuth.resetProgress !== 'function') return;
    window.AcademyAuth.resetProgress(payload)
      .then(applyServerProgress)
      .catch(handleSyncError);
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
  const HUB_ANCHORS = { acadFlows: 1, acadChallenge: 1, acadExam: 1, acadAccount: 1 };

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
      if (!hits.length) { results.innerHTML = '<p class="acad-search-none">No lessons match “' + q + '”.</p>'; return; }
      results.innerHTML = '<p class="acad-search-count">' + hits.length + ' lesson' + (hits.length > 1 ? 's' : '') + ' match “' + q + '”</p>';
      const ul = document.createElement('div');
      ul.className = 'acad-search-list';
      hits.forEach(function (l) {
        const a = document.createElement('a');
        a.href = '#' + l.id;
        a.setAttribute('data-goto', l.id);
        a.className = 'acad-search-hit';
        a.innerHTML = '<span class="acad-search-track">' + (TRACK_LABELS[trackOf(l)] || '').replace(/^Track \d+ · /, '') + '</span>' +
          '<span class="acad-search-title">' + (l.getAttribute('data-title') || l.id) + '</span>';
        ul.appendChild(a);
      });
      results.appendChild(ul);
    }
    search.addEventListener('input', runSearch);

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

  // Boot: URL hash wins > saved position > hub
  const initial = location.hash.slice(1);
  if (initial && byId[initial]) {
    showLesson(initial, true);
  } else if (initial && HUB_ANCHORS[initial]) {
    showHub(initial);
  } else {
    let saved = null;
    try { saved = localStorage.getItem(KEY_POS); } catch (e) {}
    if (saved && byId[saved]) {
      showLesson(saved, true);
    } else {
      showHub();
      // First-ever, fresh landing on the hub (no deep link, no resumed lesson) — offer the tour once.
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
  // A learner who's already signed in when they land straight in a lesson (deep link,
  // resumed position) would otherwise never see the profile nudge until they change
  // tracks or refocus the tab — check once at boot too.
  maybeShowProfileNudge();
  // Same reasoning for progress sync: pull down (and push up) this account's canonical
  // progress once at boot, not just on a later login/track-change. academy-auth.min.js
  // loads AFTER this file, so window.AcademyAuth is typically not defined yet at this
  // exact line (scheduleSync() no-ops safely when so) — the academy-auth-changed
  // listener registered above is what actually fires the first sync in that case, once
  // AcademyAuth's own boot-time refreshSession() resolves. This direct call only helps
  // in the (currently hypothetical) case both scripts are ever reordered.
  scheduleSync();
  // Boot routing is resolved (hub or lesson is now the visible one) — drop the loader.
  dismissBootLoader();
}
