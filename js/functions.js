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

    // Active navigation state (single-page index only)
    if (document.getElementById('home')) {
      const scrollDistance = scroll + 100;
      $('section').each(function(i) {
        if ($(this).position().top <= scrollDistance) {
          $('.navbar-nav .nav-link.active').removeClass('active');
          $('.navbar-nav .nav-link').eq(i).addClass('active');
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
    marquee.addEventListener('pointerdown', function (e) {
      pause();
      if (e.pointerType !== 'mouse') return;
      dragging = true;
      lastX = e.clientX;
      marquee.classList.add('dragging');
      marquee.setPointerCapture(e.pointerId);
    });

    marquee.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      marquee.scrollLeft -= e.clientX - lastX;
      lastX = e.clientX;
    });

    function endDrag(e) {
      if (e.pointerType !== 'mouse') {
        scheduleResume(1800); // let touch momentum finish before resuming
        return;
      }
      if (!dragging) return;
      dragging = false;
      marquee.classList.remove('dragging');
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
    foundations: 'Foundations',
    authn: 'Modern Authentication',
    tokens: 'Token Security',
    ai: 'AI & Agents',
    ops: 'Identity Operations'
  };

  const lessons = Array.prototype.slice.call(document.querySelectorAll('.acad-lesson'));
  const byId = {};
  lessons.forEach(function (s) { byId[s.id] = s; });

  const KEY_POS = 'acad_pos';
  const KEY_READ = 'acad_read';

  function readSet() {
    try { return new Set(JSON.parse(localStorage.getItem(KEY_READ) || '[]')); }
    catch (e) { return new Set(); }
  }

  function saveRead(set) {
    try { localStorage.setItem(KEY_READ, JSON.stringify(Array.from(set))); } catch (e) {}
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
    read.add(id);
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
      }
    }
  });

  const backBtn = document.getElementById('acadBack');
  if (backBtn) backBtn.addEventListener('click', showHub);

  const resetBtn = document.getElementById('acadReset');
  if (resetBtn) resetBtn.addEventListener('click', function () {
    try {
      localStorage.removeItem(KEY_POS);
      localStorage.removeItem(KEY_READ);
    } catch (e) {}
    showHub();
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
