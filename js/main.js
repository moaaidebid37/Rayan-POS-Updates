// Main JavaScript file

// Initialize sidebar navigation
function initSidebar() {
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  const sidebarItems = document.querySelectorAll('.sidebar-item');
  
  sidebarItems.forEach((item, index) => {
    const href = item.getAttribute('href');
    if (href === currentPage || (currentPage === '' && href === 'index.html')) {
      item.classList.add('active');
    }
    
    // Add stagger animation
    item.style.animationDelay = `${index * 0.05}s`;
    item.style.animation = 'fadeIn 0.5s ease-out';
    item.style.animationFillMode = 'both';
  });
}

// Initialize header search
function initHeaderSearch() {
  const searchInput = document.querySelector('.header-search input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      // Search functionality can be implemented per page
    });
  }
}

// Initialize modals
function initModals() {
  const modalTriggers = document.querySelectorAll('[data-modal]');
  const modalCloses = document.querySelectorAll('.modal-close');
  
  modalTriggers.forEach(trigger => {
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      const modalId = trigger.getAttribute('data-modal');
      if (modalId === 'addItemModal') {
        if (typeof window.renderDeliveryPrices === 'function') {
          window.renderDeliveryPrices({});
        }
      }
      const modal = document.getElementById(modalId);
      if (modal) {
        modal.classList.add('active');
        // Add animation
        const content = modal.querySelector('.modal-content');
        if (content) {
          content.style.animation = 'scaleIn 0.3s ease-out';
        }
      }
    });
  });
  
  modalCloses.forEach(close => {
    close.addEventListener('click', () => {
      const modal = close.closest('.modal');
      if (modal) {
        const content = modal.querySelector('.modal-content');
        if (content) {
          content.style.animation = 'scaleIn 0.3s ease-out reverse';
          setTimeout(() => {
            modal.classList.remove('active');
          }, 300);
        } else {
          modal.classList.remove('active');
        }
      }
    });
  });
  
  // Close modal on background click
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        const content = modal.querySelector('.modal-content');
        if (content) {
          content.style.animation = 'scaleIn 0.3s ease-out reverse';
          setTimeout(() => {
            modal.classList.remove('active');
          }, 300);
        } else {
          modal.classList.remove('active');
        }
      }
    });
  });
  
  // Close modal on ESC key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal.active').forEach(modal => {
        const content = modal.querySelector('.modal-content');
        if (content) {
          content.style.animation = 'scaleIn 0.3s ease-out reverse';
          setTimeout(() => {
            modal.classList.remove('active');
          }, 300);
        } else {
          modal.classList.remove('active');
        }
      });
    }
  });
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  initSidebar();
  initHeaderSearch();
  initModals();
  
  // Update store name in UI
  if (typeof updateStoreInfo === 'function') {
    updateStoreInfo();
  }
  
  // FINAL FIX: Set body attribute and force restricted elements to be visible
  const userRole = localStorage.getItem('userRole') || localStorage.getItem('userType');
  const isAdmin = userRole === 'owner' || userRole === 'admin';
  
  // Set body attribute for CSS rules
  if (isAdmin) {
    document.body.setAttribute('data-user-role', userRole);
  }
  
  // JavaScript backup to force visibility
  const forceShowRestricted = () => {
    if (isAdmin) {
      // Force all restricted elements to be visible
      const restrictedElements = document.querySelectorAll('[data-restricted="owner"]');
      restrictedElements.forEach(el => {
        el.style.setProperty('display', 'block', 'important');
        el.style.setProperty('visibility', 'visible', 'important');
        el.style.setProperty('opacity', '1', 'important');
      });
      
      // Force all sidebar items to be visible
      const sidebarItems = document.querySelectorAll('.sidebar-item');
      sidebarItems.forEach(item => {
        item.style.setProperty('display', 'flex', 'important');
        item.style.setProperty('visibility', 'visible', 'important');
        item.style.setProperty('opacity', '1', 'important');
      });
    }
  };
  
  // Initial call
  setTimeout(forceShowRestricted, 50);
  
  // Run periodically as backup
  setInterval(forceShowRestricted, 500);
  
  // Also run on any click (in case some code hides elements on interaction)
  document.addEventListener('click', () => {
    setTimeout(forceShowRestricted, 100);
  });
});

// Global Refresh Button Logic (available on all pages)
window.handleRefresh = function() {
  window.location.reload();
};

// Global Stock Notification Logic (available on all pages)
window.showStockNotifications = function() {
  let data = null;
  if (typeof menuData !== 'undefined' && menuData) data = menuData;
  else if (typeof window.menuData !== 'undefined' && window.menuData) data = window.menuData;
  else if (typeof globalMenuData !== 'undefined' && globalMenuData) data = globalMenuData;
  
  let items = [];
  if (localStorage.getItem('menuItems')) {
    try {
      items = JSON.parse(localStorage.getItem('menuItems'));
    } catch (e) {
      items = data && data.items ? data.items : [];
    }
  } else if (data && data.items) {
    items = data.items;
  }
  
  if (!items || items.length === 0) {
    if (typeof Notification !== 'undefined') {
      Notification.info('لا توجد أصناف في المخزون حالياً');
    } else {
      alert('لا توجد أصناف في المخزون حالياً');
    }
    return;
  }
  
  const lowStockItems = [];
  const criticalStockItems = [];
  
  items.forEach(item => {
    const itemType = item.type || 'physical';
    if (itemType === 'service') return;
    
    const stock = parseInt(item.stock, 10) || 0;
    const minStockLimit = parseInt(item.minStockLimit, 10) || 5;
    const criticalStockLimit = item.criticalStockLimit !== undefined ? parseInt(item.criticalStockLimit, 10) : 0;
    
    if (stock <= criticalStockLimit) {
      criticalStockItems.push({ name: item.name, stock });
    } else if (stock <= minStockLimit) {
      lowStockItems.push({ name: item.name, stock });
    }
  });
  
  if (criticalStockItems.length === 0 && lowStockItems.length === 0) {
    if (typeof Notification !== 'undefined') {
      Notification.success('كل المخزون في حالة جيدة ✅');
    } else {
      alert('كل المخزون في حالة جيدة');
    }
    return;
  }
  
  // Custom stock alert popup (centered card)
  const existingOverlay = document.querySelector('.notification-modal-overlay');
  if (existingOverlay) existingOverlay.remove();
  
  const overlay = document.createElement('div');
  overlay.className = 'notification-modal-overlay';
  
  const modal = document.createElement('div');
  modal.className = 'notification-modal notification-modal-warning';
  modal.style.maxHeight = '80vh';
  modal.style.overflowY = 'auto';
  
  let contentHtml = '';
  if (criticalStockItems.length > 0) {
    contentHtml += '<div style="font-weight:700; margin-bottom:6px; color:#E74C3C;">📕 أصناف نفدت أو على وشك النفاد:</div>';
    contentHtml += '<ul style="margin:0 0 12px 0; padding-right:18px; font-size:13px; color:#000; line-height:1.8;">';
    criticalStockItems.forEach(item => {
      contentHtml += `<li>${item.name} - الكمية الحالية ${item.stock}</li>`;
    });
    contentHtml += '</ul>';
  }
  if (lowStockItems.length > 0) {
    contentHtml += '<div style="font-weight:700; margin-bottom:6px; color:#F39C12;">📙 أصناف المخزون فيها قليل:</div>';
    contentHtml += '<ul style="margin:0; padding-right:18px; font-size:13px; color:#000; line-height:1.8;">';
    lowStockItems.forEach(item => {
      contentHtml += `<li>${item.name} - الكمية الحالية ${item.stock}</li>`;
    });
    contentHtml += '</ul>';
  }
  
  modal.innerHTML = `
    <div class="notification-modal-header">
      <div style="display:flex; align-items:center; gap:12px;">
        <div class="notification-modal-icon">⚠</div>
        <div class="notification-modal-title">تنبيهات المخزون</div>
      </div>
      <button class="notification-modal-btn notification-modal-btn-secondary" style="min-width:32px; padding:6px 10px;">×</button>
    </div>
    <div class="notification-modal-message">${contentHtml}</div>
    <div class="notification-modal-actions">
      <button class="notification-modal-btn notification-modal-btn-primary">تمام</button>
    </div>
  `;
  
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  
  const closeButtons = modal.querySelectorAll('.notification-modal-btn-secondary, .notification-modal-btn-primary');
  closeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      if (overlay.parentElement) overlay.remove();
    });
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
};


 // ============================================================ 
 // 🔒 نظام الأقفال الذكي (النسخة المضادة للهروب) 
 // ============================================================ 
 function applySaaSLocks() { 
     // لو نظام الـ SaaS لسه بيحمل، استنى 
     if (!window.SaaS || typeof window.SaaS.canUse !== 'function') return; 
 
     // خريطة الصلاحيات بالمللي (زي ما طلبت) 
     const pageFeatureMap = { 
         'reports.html': 'reports',       // برو وميجا 
         'expenses.html': 'reports',      // المصروفات (خليناها تبع التقارير عشان تبقى برو) 
         'ingredients.html': 'inventory', // المخزون (برو وميجا) 
         'customers.html': 'customers',   // ميجا فقط 
         'marketing.html': 'marketing',   // ميجا فقط 
         'employees.html': 'employees',   // ميجا فقط 
         'suppliers.html': 'suppliers'    // ميجا فقط 
     }; 
 
     document.querySelectorAll('.sidebar-item').forEach(link => { 
         // لو العنصر ده اتقفل قبل كده، متعملش فيه حاجة تاني عشان منسحبش من أداء الجهاز 
         if (link.getAttribute('data-locked') === 'true') return; 
 
         const href = link.getAttribute('href'); 
         if (!href) return; 
         
         const pageName = href.split('/').pop().split('?')[0]; 
         const requiredFeature = pageFeatureMap[pageName]; 
 
         // لو الصفحة دي محتاجة ميزة مش عند العميل في باقته 
         if (requiredFeature && !window.SaaS.canUse(requiredFeature)) { 
             
             // 1. تغيير الشكل لقفل (بهتان الألوان) 
             link.style.opacity = '0.5'; 
             link.style.background = 'transparent'; 
             
             const icon = link.querySelector('i'); 
             if (icon) { 
                 icon.className = 'fas fa-lock'; 
                 icon.style.color = '#e74c3c'; 
             } 
 
             // 2. إعطاء علامة إنه اتقفل 
             link.setAttribute('data-locked', 'true'); 
 
             // 3. استنساخ الزرار لمسح أي أكواد قديمة كانت بتفتحه بالغلط 
             const newLink = link.cloneNode(true); 
             link.parentNode.replaceChild(newLink, link); 
 
             // 4. تركيب القفل الحقيقي اللي بيرزع شاشة الدفع 
             newLink.addEventListener('click', (e) => { 
                 e.preventDefault(); 
                 e.stopImmediatePropagation(); 
                 window.SaaS.requireFeature(requiredFeature); 
             }, true); 
         } 
     }); 
 } 
 
 // 🚀 تشغيل الأقفال بـ 3 طرق لضمان التنفيذ في جميع الظروف 
 document.addEventListener('saas-ready', applySaaSLocks); // الطريقة العادية 
 document.addEventListener('DOMContentLoaded', () => setTimeout(applySaaSLocks, 300)); // بعد تحميل الصفحة 
 setInterval(applySaaSLocks, 1000); // الحارس الليلي: بيشيك كل ثانية (خفيف جداً ومبيسحبش رامات)