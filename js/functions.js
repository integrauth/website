// Modern IntegrAuth Website Functions

function toggleAndSaveTheme() {
  console.log("🕹️ User changed preferred theme");

  // Toggle body classes
  $("body").toggleClass("bg-light bg-dark");

  // Update theme button
  const isDarkTheme = $("body").hasClass("bg-dark");
  const themeBtn = $(".theme-btn");

  if (isDarkTheme) {
    themeBtn.html('<i class="fas fa-sun"></i> Light');
  } else {
    themeBtn.html('<i class="fas fa-moon"></i> Dark');
  }

  // Save theme preference
  console.log("Saving theme into 💾 localStorage");
  const theme = isDarkTheme ? "dark" : "light";
  localStorage.setItem("theme", theme);

  // Trigger custom event for other components
  $(document).trigger('themeChanged', [theme]);
}

function setDarkTheme() {
  console.log("Setting to ⬛ Dark Theme");
  $("body").addClass("bg-dark").removeClass("bg-light");

  // Update navbar for dark theme
  $(".navbar").addClass("navbar-dark").removeClass("navbar-light");

  const themeBtn = $(".theme-btn");
  themeBtn.html('<i class="fas fa-sun"></i> Light');
  themeBtn.removeClass("btn-outline-dark").addClass("btn-outline-light");

  // Trigger theme change event
  $(document).trigger('themeChanged', ['dark']);
}

function setLightTheme() {
  console.log("Setting to ⬜ Light Theme");
  $("body").addClass("bg-light").removeClass("bg-dark");

  // Update navbar for light theme
  $(".navbar").addClass("navbar-light").removeClass("navbar-dark");

  const themeBtn = $(".theme-btn");
  themeBtn.html('<i class="fas fa-moon"></i> Dark');
  themeBtn.removeClass("btn-outline-light").addClass("btn-outline-dark");

  // Trigger theme change event
  $(document).trigger('themeChanged', ['light']);
}

// Smooth scrolling for navigation links
function initSmoothScrolling() {
  $('a[href^="#"]').on('click', function(e) {
    e.preventDefault();
    
    const target = $(this.getAttribute('href'));
    if (target.length) {
      const offsetTop = target.offset().top - 80; // Account for fixed navbar
      
      $('html, body').animate({
        scrollTop: offsetTop
      }, 800, 'easeInOutQuart');
    }
  });
}

// Add easing function for smooth animations
$.easing.easeInOutQuart = function (x, t, b, c, d) {
  if ((t/=d/2) < 1) return c/2*t*t*t*t + b;
  return -c/2 * ((t-=2)*t*t*t - 2) + b;
};

// Initialize tooltips and popovers
function initBootstrapComponents() {
  // Initialize tooltips
  const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
  tooltipTriggerList.map(function (tooltipTriggerEl) {
    return new bootstrap.Tooltip(tooltipTriggerEl);
  });
  
  // Initialize popovers
  const popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'));
  popoverTriggerList.map(function (popoverTriggerEl) {
    return new bootstrap.Popover(popoverTriggerEl);
  });
}

// Handle theme change events
function handleThemeChange() {
  $(document).on('themeChanged', function(event, theme) {
    console.log(`Theme changed to: ${theme}`);
    
    // Update any theme-specific elements here
    if (theme === 'dark') {
      // Dark theme specific updates
      $('.navbar').removeClass('bg-light navbar-light').addClass('bg-dark navbar-dark');
    } else {
      // Light theme specific updates
      $('.navbar').removeClass('bg-dark navbar-dark').addClass('bg-light navbar-light');
    }
  });
}

// Add loading states to buttons
function initButtonLoadingStates() {
  $('.btn').on('click', function() {
    const $btn = $(this);
    const originalText = $btn.html();
    
    // Add loading state
    $btn.addClass('loading').html('<i class="fas fa-spinner fa-spin"></i> Loading...');
    
    // Remove loading state after a delay (simulate action)
    setTimeout(() => {
      $btn.removeClass('loading').html(originalText);
    }, 2000);
  });
}

// Initialize all functions when document is ready
$(function () {
  console.log("🚀 Initializing IntegrAuth Website");
  
  // Check for saved theme preference or default to system preference
  const savedTheme = localStorage.getItem("theme");
  const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  
  console.log("Saved theme:", savedTheme);
  console.log("System prefers dark:", systemPrefersDark);
  
  // Apply theme
  if (savedTheme === "dark" || (!savedTheme && systemPrefersDark)) {
    setDarkTheme();
  } else {
    setLightTheme();
  }
  
  // Initialize all components
  initSmoothScrolling();
  initBootstrapComponents();
  handleThemeChange();
  fixWhatsAppLinks(); // Fix WhatsApp links for mobile devices
  // initButtonLoadingStates(); // Disabled - not needed for this site
  
  // Add scroll effect to navbar
  $(window).scroll(function() {
    const scroll = $(window).scrollTop();
    const navbar = $('.navbar');
    
    if (scroll >= 100) {
      navbar.addClass('navbar-scrolled');
    } else {
      navbar.removeClass('navbar-scrolled');
    }
  });
  
  // Add active state to navigation based on scroll position
  $(window).scroll(function() {
    const scrollDistance = $(window).scrollTop();
    
    $('section').each(function(i) {
      if ($(this).position().top <= scrollDistance + 100) {
        $('.navbar-nav .nav-link.active').removeClass('active');
        $('.navbar-nav .nav-link').eq(i).addClass('active');
      }
    });
  });
  
  // Add click outside to close mobile menu
  $(document).on('click', function(e) {
    if (!$(e.target).closest('.navbar').length) {
      $('.navbar-collapse').collapse('hide');
    }
  });
  
  console.log("✅ Website initialization complete");
});

// Fix WhatsApp links for mobile devices
function fixWhatsAppLinks() {
  // Detect if user is on mobile or tablet
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  if (isMobile) {
    // Find all WhatsApp links
    $('a[href*="wa.me"], a[href*="api.whatsapp"]').each(function() {
      const $link = $(this);
      const href = $link.attr('href');

      // Extract phone number and text from wa.me link
      const waMatch = href.match(/wa\.me\/(\d+)(?:\?text=(.+))?/);

      if (waMatch) {
        const phone = waMatch[1];
        const text = waMatch[2] ? decodeURIComponent(waMatch[2].replace(/\+/g, ' ')) : '';

        // Convert to native WhatsApp protocol
        let nativeLink = `whatsapp://send?phone=${phone}`;
        if (text) {
          nativeLink += `&text=${encodeURIComponent(text)}`;
        }

        $link.attr('href', nativeLink);
        console.log(`📱 Converted WhatsApp link to native protocol for mobile`);
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

// Handle chevron icon rotation on collapse toggle
$(document).ready(function() {
  $('.tech-grid').on('show.bs.collapse', function() {
    $(this).siblings('.tech-category-header').find('.collapse-icon')
      .removeClass('fa-chevron-right').addClass('fa-chevron-down');
  });

  $('.tech-grid').on('hide.bs.collapse', function() {
    $(this).siblings('.tech-category-header').find('.collapse-icon')
      .removeClass('fa-chevron-down').addClass('fa-chevron-right');
  });

  // Make entire tech-category card clickable when collapsed
  $('.tech-category').on('click', function(e) {
    const $category = $(this);
    const $techGrid = $category.find('.tech-grid');

    // Only make card clickable if the section is collapsed
    // And if the click is NOT on a tech-item link, button, or already on the header
    if (!$techGrid.hasClass('show') &&
        !$(e.target).closest('.tech-item, a, button, .btn').length &&
        !$(e.target).closest('.tech-category-header').length) {
      // Trigger the collapse directly
      $techGrid.collapse('show');
    }
  });

  // Add cursor pointer to collapsed cards
  $('.tech-grid').on('hidden.bs.collapse', function() {
    $(this).closest('.tech-category').addClass('collapsed-card');
  });

  $('.tech-grid').on('shown.bs.collapse', function() {
    $(this).closest('.tech-category').removeClass('collapsed-card');
  });
});

// Export functions for global access (if needed)
window.IntegrAuth = {
  toggleTheme: toggleAndSaveTheme,
  setDarkTheme: setDarkTheme,
  setLightTheme: setLightTheme
};

// Make collapse functions globally accessible
window.expandAllTech = expandAllTech;
window.collapseAllTech = collapseAllTech;
