/**
 * Matchly Dashboard UI Interactions
 * Enhances responsive sidebar drawer, modal keyboard shortcuts, and smooth tab navigation.
 */

document.addEventListener('DOMContentLoaded', () => {
  const menuBtn = document.getElementById('workspace-menu-btn');
  const navMenu = document.getElementById('workspace-nav');

  if (menuBtn && navMenu) {
    menuBtn.addEventListener('click', () => {
      const isExpanded = menuBtn.getAttribute('aria-expanded') === 'true';
      navMenu.classList.toggle('is-open', !isExpanded);
      menuBtn.setAttribute('aria-expanded', String(!isExpanded));
      menuBtn.textContent = !isExpanded ? 'Close' : 'Menu';
    });

    // Close menu when clicking any nav item
    navMenu.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => {
        if (window.innerWidth <= 860) {
          navMenu.classList.remove('is-open');
          menuBtn.setAttribute('aria-expanded', 'false');
          menuBtn.textContent = 'Menu';
        }
      });
    });
  }

  // Close modals on Escape key
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const modal = document.getElementById('modal-override');
      if (modal && modal.classList.contains('active')) {
        if (typeof closeOverrideModal === 'function') {
          closeOverrideModal();
        } else {
          modal.classList.remove('active');
        }
      }
    }
  });
});
