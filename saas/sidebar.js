/**
 * Solo POS — Shared Sidebar Component
 * ====================================
 * رسم القائمة الجانبية + hamburger toggle
 */
(function () {
  'use strict';

  const ITEMS = [
    { href: 'index.html',       icon: 'home',            label: 'الرئيسية' },
    { href: 'orders.html',      icon: 'clipboard-list',  label: 'الطلبات' },
    { href: 'reports.html',     icon: 'chart-line',      label: 'التقارير',       restricted: 'owner' },
    { href: 'menu.html',        icon: 'utensils',        label: 'المطبخ' },
    { href: 'ingredients.html', icon: 'boxes',           label: 'المخزون' },
    { href: 'customers.html',   icon: 'address-book',    label: 'العملاء' },
    { href: 'employees.html',   icon: 'users',           label: 'الموظفون',       restricted: 'owner' },
    { href: 'suppliers.html',   icon: 'truck',           label: 'الموردين',       restricted: 'owner' },
    { href: 'marketing.html',   icon: 'bullhorn',        label: 'ادارة التسويق', restricted: 'owner' },
    { href: 'settings.html?section=aggregators', icon: 'motorcycle', label: 'شركات التوصيل', restricted: 'owner' },
    { href: 'settings.html',    icon: 'cog',             label: 'الاعدادات',     restricted: 'owner' },
  ];

  // ── hamburger + overlay ───────────────────────────────────────────────
  function _ensureHamburger() {
    if (document.getElementById('sidebar-hamburger-btn')) return;

    // Overlay
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    overlay.id = 'sidebar-overlay';
    overlay.addEventListener('click', _close);
    document.body.appendChild(overlay);

    // Hamburger button — inject into header
    const btn = document.createElement('button');
    btn.id = 'sidebar-hamburger-btn';
    btn.className = 'sidebar-hamburger';
    btn.setAttribute('aria-label', 'القائمة');
    btn.innerHTML = '<i class="fas fa-bars"></i>';
    btn.addEventListener('click', _toggle);

    const actions = document.querySelector('.header-actions');
    const header  = document.querySelector('.header');
    if (actions) {
      actions.appendChild(btn);
    } else if (header) {
      header.appendChild(btn);
    }
  }

  function _toggle() {
    const nav = document.querySelector('nav.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!nav) return;
    const isOpen = nav.classList.contains('open');
    if (isOpen) {
      _close();
    } else {
      nav.classList.add('open');
      if (overlay) overlay.classList.add('visible');
    }
  }

  function _close() {
    const nav = document.querySelector('nav.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (nav) nav.classList.remove('open');
    if (overlay) overlay.classList.remove('visible');
  }

  // ── خريطة feature → اسم الملف (متطابقة مع auth.js) ─────────────────
  const PAGE_FEATURE_MAP = {
    'pos': 'index.html', 'orders': 'orders.html', 'kitchen': 'kitchen.html',
    'reports': 'reports.html', 'inventory': 'ingredients.html',
    'customers': 'customers.html', 'marketing': 'marketing.html',
    'suppliers': 'suppliers.html', 'settings': 'settings.html',
    'employees': 'employees.html',
  };

  function _getAllowedItems() {
    // نستخدم Auth.getUserRole() عشان التطبيع يكون واحد (عربي + إنجليزي)
    const userRole = (typeof Auth !== 'undefined' && Auth.getUserRole)
        ? Auth.getUserRole()
        : (() => {
            const r = (localStorage.getItem('userRole') || '').toLowerCase().trim();
            return (r === 'owner' || r === 'admin' || r === 'مدير' || r === '') ? 'owner' : 'cashier';
          })();

    if (userRole === 'owner') return ITEMS;

    // نجيب الملفات المسموحة من Auth (بعد التحويل الصحيح feature→filename)
    const allowedFiles = (typeof Auth !== 'undefined' && Auth._getAllowedFiles)
        ? (Auth._getAllowedFiles() || ['index.html'])
        : ['index.html'];

    return ITEMS.filter(item =>
        allowedFiles.some(f => item.href === f) || item.href === 'index.html'
    );
  }

  // ── رسم القائمة الجانبية ─────────────────────────────────────────────
  function _render() {
    const nav = document.querySelector('nav.sidebar');
    if (!nav) return;

    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    const allowedItems = _getAllowedItems();

    const itemsHTML = allowedItems.map(item => {
      const isActive       = item.href === currentPage || (currentPage === '' && item.href === 'index.html');
      const restrictedAttr = item.restricted ? ` data-restricted="${item.restricted}"` : '';
      return `<a href="${item.href}" class="sidebar-item${isActive ? ' active' : ''}"${restrictedAttr}>
          <i class="fas fa-${item.icon}"></i>
          <span class="sidebar-item-label">${item.label}</span>
        </a>`;
    }).join('\n        ');

    nav.innerHTML = `
        ${itemsHTML}
        <div class="sidebar-profile">
            <div class="sidebar-item" onclick="window.SaaS ? window.SaaS.signOut() : (typeof logout === 'function' && logout())">
                <i class="fas fa-sign-out-alt"></i>
                <span class="sidebar-item-label">تسجيل الخروج</span>
            </div>
        </div>
    `;

    // Close sidebar when a nav link is clicked
    nav.querySelectorAll('a.sidebar-item').forEach(function (a) {
      a.addEventListener('click', _close);
    });

    // Hamburger
    _ensureHamburger();

    // Re-apply SaaS feature gates after sidebar rebuild
    if (window.SaaS && typeof window.SaaS._applyFeatureGates === 'function') {
      window.SaaS._applyFeatureGates();
    }
  }

  // ── تشغيل فوري ───────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _render);
  } else {
    _render();
  }

  // إعادة الرسم لما SaaS يجهز
  window.addEventListener('saas-ready', _render);

  window.SaaSSidebar = { render: _render, open: _toggle, close: _close };
})();
