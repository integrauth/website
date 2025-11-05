// Modern IntegrAuth Website Functions - Optimized

// Theme Management
function toggleAndSaveTheme() {
  $("body").toggleClass("bg-light bg-dark");
  const isDarkTheme = $("body").hasClass("bg-dark");
  const themeBtn = $(".theme-btn");

  themeBtn.html(isDarkTheme ? '<i class="fas fa-sun"></i> Light' : '<i class="fas fa-moon"></i> Dark');
  localStorage.setItem("theme", isDarkTheme ? "dark" : "light");
  $(document).trigger('themeChanged', [isDarkTheme ? "dark" : "light"]);
}

function setDarkTheme() {
  $("body").addClass("bg-dark").removeClass("bg-light");
  $(".navbar").addClass("navbar-dark").removeClass("navbar-light");
  $(".theme-btn").html('<i class="fas fa-sun"></i> Light')
    .removeClass("btn-outline-dark").addClass("btn-outline-light");
  $(document).trigger('themeChanged', ['dark']);
}

function setLightTheme() {
  $("body").addClass("bg-light").removeClass("bg-dark");
  $(".navbar").addClass("navbar-light").removeClass("navbar-dark");
  $(".theme-btn").html('<i class="fas fa-moon"></i> Dark')
    .removeClass("btn-outline-light").addClass("btn-outline-dark");
  $(document).trigger('themeChanged', ['light']);
}

// Initialize Bootstrap Components
function initBootstrapComponents() {
  const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
  tooltipTriggerList.map(el => new bootstrap.Tooltip(el));

  const popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'));
  popoverTriggerList.map(el => new bootstrap.Popover(el));
}

// Handle theme change events
function handleThemeChange() {
  $(document).on('themeChanged', function(event, theme) {
    if (theme === 'dark') {
      $('.navbar').removeClass('bg-light navbar-light').addClass('bg-dark navbar-dark');
    } else {
      $('.navbar').removeClass('bg-dark navbar-dark').addClass('bg-light navbar-light');
    }
  });
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

    // Active navigation state
    const scrollDistance = scroll + 100;
    $('section').each(function(i) {
      if ($(this).position().top <= scrollDistance) {
        $('.navbar-nav .nav-link.active').removeClass('active');
        $('.navbar-nav .nav-link').eq(i).addClass('active');
      }
    });

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
  // Apply saved theme or system preference
  const savedTheme = localStorage.getItem("theme");
  const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  if (savedTheme === "dark" || (!savedTheme && systemPrefersDark)) {
    setDarkTheme();
  } else {
    setLightTheme();
  }

  // Initialize components
  initBootstrapComponents();
  handleThemeChange();
  fixWhatsAppLinks();

  // Attach scroll handler with passive listener for better performance
  $(window).on('scroll', handleScroll);

  // Close mobile menu when clicking outside
  $(document).on('click', function(e) {
    if (!$(e.target).closest('.navbar').length) {
      $('.navbar-collapse').collapse('hide');
    }
  });

  // Handle tech section collapse icons
  $('.tech-grid').on('show.bs.collapse', function() {
    $(this).siblings('.tech-category-header').find('.collapse-icon')
      .removeClass('fa-chevron-right').addClass('fa-chevron-down');
  });

  $('.tech-grid').on('hide.bs.collapse', function() {
    $(this).siblings('.tech-category-header').find('.collapse-icon')
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
window.IntegrAuth = {
  toggleTheme: toggleAndSaveTheme,
  setDarkTheme: setDarkTheme,
  setLightTheme: setLightTheme
};

window.expandAllTech = expandAllTech;
window.collapseAllTech = collapseAllTech;
window.openProductModal = openProductModal;
window.closeProductModal = closeProductModal;
