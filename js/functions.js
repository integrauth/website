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
          const $link = $('.navbar-nav .nav-link[href="#' + this.id + '"]');
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

  // Initialize components
  fixWhatsAppLinks();
  initServicesMarquee();
  initAcademy();
  initBackToTop();

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
    foundations: 'Track 1 · Foundations',
    authn: 'Track 2 · Modern Authentication',
    tokens: 'Track 3 · Token Security',
    ai: 'Track 4 · AI & Agents',
    ops: 'Track 5 · Identity Operations',
    authz: 'Track 6 · Authorization & API Security',
    proto: 'Track 7 · Protocols & Federation',
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
  }

  // Cheat-sheet & pop-quiz lessons (*-quiz) only count as read once every
  // answer has been revealed; acad_quiz stores the revealed question indices.
  function quizStore() {
    try { return JSON.parse(localStorage.getItem(KEY_QUIZ) || '{}'); }
    catch (e) { return {}; }
  }

  function saveQuizStore(s) {
    try { localStorage.setItem(KEY_QUIZ, JSON.stringify(s)); } catch (e) {}
  }

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

  function trackOf(lesson) { return lesson.getAttribute('data-track'); }

  function trackLessons(track) {
    return lessons.filter(function (s) { return trackOf(s) === track; });
  }

  function updateProgress() {
    const read = readSet();
    const opened = lessons.filter(function (s) { return read.has(s.id); }).length;
    const fill = document.getElementById('acadProgressFill');
    const text = document.getElementById('acadProgressText');
    if (fill) fill.style.width = Math.round((opened / lessons.length) * 100) + '%';
    if (text) text.textContent = opened + '/' + lessons.length + ' lessons read';
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
      b.textContent = '← ' + prev.getAttribute('data-title');
      pager.appendChild(b);
    } else {
      pager.appendChild(document.createElement('span'));
    }
    if (next) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'acad-page-btn';
      b.setAttribute('data-goto', next.id);
      b.textContent = next.getAttribute('data-title') + ' →';
      pager.appendChild(b);
    } else {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'acad-page-btn';
      b.setAttribute('data-goto', '__hub__');
      b.textContent = 'Back to all tracks ↺';
      pager.appendChild(b);
    }
  }

  function showHub() {
    reader.hidden = true;
    hub.hidden = false;
    lessons.forEach(function (s) { s.classList.remove('is-active'); });
    if (location.hash) history.replaceState(null, '', location.pathname);
    try { localStorage.removeItem(KEY_POS); } catch (e) {}
    updateProgress();
    window.scrollTo({ top: 0 });
  }

  function showLesson(id, skipScroll) {
    const lesson = byId[id];
    if (!lesson) return false;
    hub.hidden = true;
    reader.hidden = false;
    lessons.forEach(function (s) { s.classList.toggle('is-active', s === lesson); });
    const track = trackOf(lesson);
    const label = document.getElementById('acadTrackLabel');
    if (label) label.textContent = TRACK_LABELS[track] || track;
    const read = readSet();
    if (isQuizLesson(lesson)) {
      if (syncQuizProgress(lesson)) read.add(id);
    } else {
      read.add(id);
    }
    saveRead(read);
    try { localStorage.setItem(KEY_POS, id); } catch (e) {}
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
      if (id === '__hub__') showHub(); else showLesson(id);
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

  const backBtn = document.getElementById('acadBack');
  if (backBtn) backBtn.addEventListener('click', showHub);

  // Reset ONE track: its read marks + quiz reveals; other tracks untouched.
  function resetTrack(track) {
    const items = trackLessons(track);
    const read = readSet();
    const store = quizStore();
    items.forEach(function (s) {
      read.delete(s.id);
      delete store[s.id];
      s.querySelectorAll('.acad-quiz-check, .acad-quiz-progress').forEach(function (el) { el.remove(); });
    });
    saveRead(read);
    saveQuizStore(store);
    showHub();
  }

  document.querySelectorAll('.acad-reset-track').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const active = document.querySelector('.acad-lesson.is-active');
      if (active) resetTrack(trackOf(active));
    });
  });

  const resetAllBtn = document.getElementById('acadResetAll');
  if (resetAllBtn) resetAllBtn.addEventListener('click', function () {
    if (!window.confirm('Reset ALL Academy progress? Every read mark and quiz answer will be cleared.')) return;
    try {
      localStorage.removeItem(KEY_POS);
      localStorage.removeItem(KEY_READ);
      localStorage.removeItem(KEY_QUIZ);
    } catch (e) {}
    document.querySelectorAll('.acad-quiz-check, .acad-quiz-progress').forEach(function (el) { el.remove(); });
    updateProgress();
  });

  window.addEventListener('hashchange', function () {
    const id = location.hash.slice(1);
    if (byId[id]) showLesson(id); else if (!id) showHub();
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
      lessons: ['f1-identity', 'f3-tokens', 'p1-oidc', 't7-birth', 'a1-passkeys', 'a10-sessions', 'r1-bff', 't1-rotation', 'az4-scopes', 'c1-signup'] },
    { key: 'arch', icon: 'fa-sitemap', name: 'Architect', blurb: 'Design the whole identity system with confidence.',
      lessons: ['f5-personas', 'f6-zerotrust', 'p5-exchange', 'r1-bff', 'r2-micro', 'r3-tenancy', 'r4-lifetimes', 'w2-wif', 'r5-buildbuy', 'r6-dr'] },
    { key: 'sec', icon: 'fa-shield-halved', name: 'Security analyst', blurb: 'Detect, defend and respond to identity attacks.',
      lessons: ['f7-itdr', 'a3-adaptive', 'a6-breached', 'atk1-aitm', 'atk2-fatigue', 'atk5-cookies', 'atk7-detect', 'atk8-tabletop', 'o2-siem', 'c5-ato'] },
    { key: 'pm', icon: 'fa-lightbulb', name: 'Product manager', blurb: 'Balance trust, friction and compliance for users.',
      lessons: ['f1-identity', 'f10-rules', 'c1-signup', 'c2-recovery', 'c4-profiling', 'a1-passkeys', 'o3-rtbf', 'c7-b2b', 'r5-buildbuy'] }
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
  } else {
    let saved = null;
    try { saved = localStorage.getItem(KEY_POS); } catch (e) {}
    if (saved && byId[saved]) showLesson(saved, true); else showHub();
  }
}
