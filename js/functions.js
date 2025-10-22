// Modern IntegrAuth Website Functions

function toggleAndSaveTheme() {
  console.log("🕹️ User changed preferred theme");
  
  // Toggle body classes
  $("body").toggleClass("bg-light bg-dark");
  
  // Update theme button
  const isDarkTheme = $("body").hasClass("bg-dark");
  const themeBtn = $(".theme-btn");
  
  if (isDarkTheme) {
    themeBtn.removeClass("btn-outline-light").addClass("btn-outline-primary");
    themeBtn.html('<i class="fas fa-sun"></i> Light');
  } else {
    themeBtn.removeClass("btn-outline-primary").addClass("btn-outline-light");
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
  
  const themeBtn = $(".theme-btn");
  themeBtn.removeClass("btn-outline-primary").addClass("btn-outline-light");
  themeBtn.html('<i class="fas fa-sun"></i> Light');
  
  // Update navbar
  $(".navbar").addClass("navbar-dark bg-dark").removeClass("navbar-light bg-light");
  
  // Trigger theme change event
  $(document).trigger('themeChanged', ['dark']);
}

function setLightTheme() {
  console.log("Setting to ⬜ Light Theme");
  $("body").addClass("bg-light").removeClass("bg-dark");
  
  const themeBtn = $(".theme-btn");
  themeBtn.removeClass("btn-outline-light").addClass("btn-outline-primary");
  themeBtn.html('<i class="fas fa-moon"></i> Dark');
  
  // Update navbar
  $(".navbar").addClass("navbar-light bg-light").removeClass("navbar-dark bg-dark");
  
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
  initButtonLoadingStates();
  
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

// Export functions for global access (if needed)
window.IntegrAuth = {
  toggleTheme: toggleAndSaveTheme,
  setDarkTheme: setDarkTheme,
  setLightTheme: setLightTheme
};
