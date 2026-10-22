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

  // Initialize active user session
  initUserSession();
});

// Auth Session Manager
function initUserSession() {
  const sessionStr = localStorage.getItem('matchly_user');
  let user = null;
  if (sessionStr) {
    try {
      user = JSON.parse(sessionStr);
    } catch (e) {}
  }

  // Default to Admin if not logged in yet so prototype remains fully interactive
  if (!user) {
    user = {
      email: 'parthivnanavatimatchly7@gmail.com',
      first_name: 'Parthiv',
      last_name: 'Nanavati',
      role: 'ADMIN'
    };
    localStorage.setItem('matchly_user', JSON.stringify(user));
  }

  const nameEl = document.getElementById('current-user-name');
  const roleEl = document.getElementById('current-user-role');
  const avatarEl = document.getElementById('current-user-avatar');

  const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;
  const initials = ((user.first_name?.[0] || '') + (user.last_name?.[0] || '')).toUpperCase() || 'PN';

  if (nameEl) nameEl.textContent = fullName;
  if (roleEl) roleEl.textContent = user.role || 'MEMBER';
  if (avatarEl) avatarEl.textContent = initials;
}

function handleLogout() {
  localStorage.removeItem('matchly_token');
  localStorage.removeItem('matchly_user');
  fetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => {});
  window.location.href = '/login';
}
