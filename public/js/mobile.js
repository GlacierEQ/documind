/**
 * Mobile UI helpers for Documind
 * Enhances the user experience on mobile devices
 */

document.addEventListener('DOMContentLoaded', function() {
  // Initialize mobile UI enhancements
  initMobileUI();
});

/**
 * Initialize mobile UI features
 */
function initMobileUI() {
  setupMobileNavigation();
  setupMobileToggles();
  setupMobileDrawers();
  optimizeForTouch();
}

/**
 * Setup mobile navigation
 */
function setupMobileNavigation() {
  // Create mobile bottom navigation if it doesn't exist
  if (!document.querySelector('.mobile-nav') && window.innerWidth <= 768) {
    createMobileNavigation();
  }
  
  // Setup navbar toggler
  const navbarToggler = document.querySelector('.navbar-toggler');
  const navbarCollapse = document.querySelector('.navbar-collapse');
  
  if (navbarToggler && navbarCollapse) {
    navbarToggler.addEventListener('click', function() {
      navbarCollapse.classList.toggle('show');
      
      // Create and toggle overlay
      let overlay = document.querySelector('.overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'overlay';
        document.body.appendChild(overlay);
      }
      
      if (navbarCollapse.classList.contains('show')) {
        overlay.classList.add('visible');
        
        // Close menu when clicking outside
        overlay.addEventListener('click', function() {
          navbarCollapse.classList.remove('show');
          overlay.classList.remove('visible');
        });
      } else {
        overlay.classList.remove('visible');
      }
    });
  }
}

/**
 * Create mobile bottom navigation
 */
function createMobileNavigation() {
  const mobileNav = document.createElement('nav');
  mobileNav.className = 'mobile-nav d-md-none';
  
  // Define navigation items
  const navItems = [
    { icon: 'bi-house', text: 'Home', url: '/' },
    { icon: 'bi-folder', text: 'Files', url: '/documents' },
    { icon: 'bi-search', text: 'Search', url: '/search' },
    { icon: 'bi-calendar', text: 'Timeline', url: '/timeline' },
    { icon: 'bi-gear', text: 'Settings', url: '/settings' }
  ];
  
  // Create nav items
  mobileNav.innerHTML = navItems.map(item => {
    const isActive = window.location.pathname === item.url || 
                      (item.url !== '/' && window.location.pathname.startsWith(item.url));
    
    return `
      <a href="${item.url}" class="mobile-nav-item ${isActive ? 'active' : ''}">
        <i class="bi ${item.icon}"></i>
        <span>${item.text}</span>
      </a>
    `;
  }).join('');
  
  document.body.appendChild(mobileNav);
  
  // Adjust body padding to accommodate the nav
  document.body.style.paddingBottom = '60px';
}

/**
 * Setup mobile toggles for panels and sidebars
 */
function setupMobileToggles() {
  // Add toggle button for sidebar if it exists
  const sidebar = document.querySelector('.sidebar');
  const mainContent = document.querySelector('.main-content');
  
  if (sidebar && mainContent && window.innerWidth <= 992) {
    // Hide sidebar by default on mobile
    sidebar.style.display = 'none';
    mainContent.style.marginLeft = '0';
    
    // Create toggle button
    const toggleButton = document.createElement('button');
    toggleButton.className = 'modern-btn modern-btn-outline mobile-sidebar-toggle';
    toggleButton.innerHTML = '<i class="bi bi-layout-sidebar"></i>';
    
    // Insert button before main content
    mainContent.parentNode.insertBefore(toggleButton, mainContent);
    
    // Toggle sidebar when clicked
    toggleButton.addEventListener('click', function() {
      if (sidebar.style.display === 'none') {
        sidebar.style.display = 'block';
        sidebar.classList.add('mobile-sidebar-active');
      } else {
        sidebar.style.display = 'none';
        sidebar.classList.remove('mobile-sidebar-active');
      }
    });
  }
}

/**
 * Setup mobile drawers
 */
function setupMobileDrawers() {
  // Find all elements with data-mobile-drawer attribute
  const drawerTriggers = document.querySelectorAll('[data-mobile-drawer]');
  
  drawerTriggers.forEach(trigger => {
    const drawerId = trigger.getAttribute('data-mobile-drawer');
    const drawer = document.getElementById(drawerId);
    
    if (!drawer) return;
    
    // Create overlay if it doesn't exist
    let overlay = document.querySelector('.overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'overlay';
      document.body.appendChild(overlay);
    }
    
    // Setup trigger to open drawer
    trigger.addEventListener('click', function(e) {
      e.preventDefault();
      drawer.classList.add('open');
      overlay.classList.add('visible');
    });
    
    // Set up close button inside drawer
    const closeBtn = drawer.querySelector('.mobile-drawer-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        drawer.classList.remove('open');
        overlay.classList.remove('visible');
      });
    }
    
    // Close drawer when clicking overlay
    overlay.addEventListener('click', function() {
      drawer.classList.remove('open');
      overlay.classList.remove('visible');
    });
  });
}

/**
 * Optimize elements for touch interaction
 */
function optimizeForTouch() {
  // Adjust dropdowns to be touch friendly
  const dropdownToggles = document.querySelectorAll('.dropdown-toggle');
  
  dropdownToggles.forEach(toggle => {
    toggle.addEventListener('click', function(e) {
      // Check if we're on mobile
      if (window.innerWidth <= 768) {
        // Prevent default only on mobile to allow the dropdown to open with a tap
        if (toggle.parentElement.classList.contains('show')) {
          return; // Let it close normally
        }
        e.preventDefault();
        e.stopPropagation();
        
        // Close all other dropdowns
        document.querySelectorAll('.dropdown-menu.show').forEach(menu => {
          if (menu.previousElementSibling !== toggle) {
            menu.classList.remove('show');
            menu.parentElement.classList.remove('show');
          }
        });
        
        // Toggle this dropdown
        const dropdown = toggle.nextElementSibling;
        dropdown.classList.toggle('show');
        toggle.parentElement.classList.toggle('show');
        
        // Close when clicking anywhere else
        const closeDropdown = function(event) {
          if (!toggle.contains(event.target) && !dropdown.contains(event.target)) {
            dropdown.classList.remove('show');
            toggle.parentElement.classList.remove('show');
            document.removeEventListener('click', closeDropdown);
          }
        };
        
        document.addEventListener('click', closeDropdown);
      }
    });
  });
  
  // Make tables horizontally scrollable on mobile
  const tables = document.querySelectorAll('table:not(.table-responsive)');
  tables.forEach(table => {
    const wrapper = document.createElement('div');
    wrapper.className = 'table-responsive';
    table.parentNode.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });
}

/**
 * Update UI based on screen width changes
 */
window.addEventListener('resize', function() {
  // Check if we need to add/remove mobile nav
  if (window.innerWidth <= 768 && !document.querySelector('.mobile-nav')) {
    createMobileNavigation();
  } else if (window.innerWidth > 768 && document.querySelector('.mobile-nav')) {
    const mobileNav = document.querySelector('.mobile-nav');
    if (mobileNav) {
      mobileNav.remove();
      document.body.style.paddingBottom = '0';
    }
  }
});

/**
 * Open mobile drawer programmatically
 */
function openMobileDrawer(drawerId) {
  const drawer = document.getElementById(drawerId);
  if (!drawer) return;
  
  drawer.classList.add('open');
  
  let overlay = document.querySelector('.overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'overlay';
    document.body.appendChild(overlay);
  }
  
  overlay.classList.add('visible');
}

/**
 * Close mobile drawer programmatically
 */
function closeMobileDrawer(drawerId) {
  const drawer = document.getElementById(drawerId);
  if (!drawer) return;
  
  drawer.classList.remove('open');
  
  const overlay = document.querySelector('.overlay');
  if (overlay) {
    overlay.classList.remove('visible');
  }
}
