// app_logic.js - نظام الصلاحيات والتحميل الذكي للبيانات
// Implements "Blind Cashier Mode" & Data Pre-fetching

// Global current user state
let currentUser = null;

// ============================================================
// 🚀 1. التشغيل عند بداية التطبيق
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  // أ. التحقق من تسجيل الدخول
  const savedUser = localStorage.getItem('currentUser');
  const userRole = localStorage.getItem('userRole');
  const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
  
  if (isLoggedIn && userRole) {
    // Build currentUser object
    if (savedUser) {
      try {
        currentUser = JSON.parse(savedUser);
      } catch (e) {
        currentUser = { role: userRole, name: localStorage.getItem('username') || 'User' };
      }
    } else {
      currentUser = { role: userRole, name: localStorage.getItem('username') || 'User' };
    }
    
    // تطبيق الصلاحيات
    applyRoleBasedAccess(currentUser.role || userRole);
  }
  
  // ب. 🔥 التحميل المسبق للبيانات (الحل الجذري لمشكلة اختفاء الموظفين)
  // ده هيجبر النظام يجيب الداتا من الفايربيز ويحطها في اللوكال
  await preloadEssentialData();

  // ج. التحقق من الترخيص — معطّل (SaaS بيتحكم في الاشتراكات)
  // const currentPage = window.location.pathname.split('/').pop() || '';
  // SaaS subscription-manager.js بيتولى هذه المهمة الآن

  // د. التعامل مع الروابط المباشرة (Hashes)
  if (window.location.hash === '#employees') {
    setTimeout(() => {
      if (typeof window.showEmployeesSection === 'function') window.showEmployeesSection();
    }, 500);
  }
});

// ============================================================ 
 // 🔥 2. دالة التحميل المسبق (النسخة الصامتة اللي بتمنع الرعشة) 
 // ============================================================ 
 async function preloadEssentialData() { 
     try { 
         console.log("⚡ جاري تحديث البيانات في الخلفية بهدوء..."); 
 
         // هنجيب البيانات من الفايربيز في الخلفية بدون ما نوقف السيستم 
         Promise.all([ 
             DataManager.getCategories(), 
             DataManager.getMenuItems(), 
             DataManager.getEmployees(), 
             DataManager.getSuppliers(), 
             DataManager.getAggregators(), 
             DataManager.getCashSessions() // 👈 الحقنة السحرية اللي بتسحب الشيفتات فوراً مع فتح الصفحة 
         ]).then(() => {
             console.log("✅ تم مزامنة كل البيانات الأساسية مع السيرفر بنجاح!");
             // 🚀 فحص الشيفت بعد أن أصبحت البيانات جاهزة 100%
             if (typeof window.checkCashDrawerSession === 'function') {
                 window.checkCashDrawerSession();
             }
         }).catch(err => { 
             console.warn("⚠️ النظام يعمل الآن بدون إنترنت.", err); 
         }); 
 
     } catch (err) { 
         console.error("⚠️ خطأ في التحميل المسبق:", err); 
     } 
 }

// ============================================================
// 🔐 3. نظام الصلاحيات (Role-Based Access Control)
// ============================================================
function applyRoleBasedAccess(role) {
  if (!role) return;

  localStorage.setItem('originalRole', role);

  // نظّف الرول: عربي أو إنجليزي
  const r = (role || '').toLowerCase().trim();
  const isOwner = (r === 'owner' || r === 'admin' || r === 'مدير');

  document.body.setAttribute('data-user-role', isOwner ? 'owner' : 'cashier');

  // إخفاء/إظهار عناصر المالك فقط
  document.querySelectorAll('[data-restricted="owner"]').forEach(el => {
    el.style.display = isOwner ? '' : 'none';
  });

  if (isOwner) {
    // المالك: اظهر كل حاجة
    document.querySelectorAll('.sidebar-item[href]').forEach(item => {
      item.style.removeProperty('display');
    });
  } else {
    // الكاشير: فوّض لـ auth.js و sidebar.js اللي بيقرأوا userPermissions صح
    if (typeof Auth !== 'undefined' && Auth.applyPermissions) {
      Auth.applyPermissions();
    }
  }
}

function enableAllFeatures() {
  // محجوزة للتوافق مع الكود القديم
}

// ============================================================
// 🔑 4. نظام الترخيص (Licenses)
// ============================================================
window.validateLicense = async function(code) {
  try {
    if (!code || !code.trim()) return { success: false, message: '❌ أدخل الكود' };
    if (!navigator.onLine) return { success: false, message: '❌ لا يوجد إنترنت' };
    if (!window.FirestoreService) return { success: false, message: '❌ خطأ في الاتصال' };
    
    const systemId = typeof window.Activation !== 'undefined' 
        ? window.Activation.getSystemId() 
        : (localStorage.getItem('solo_system_id') || 'default');
    
    const markResult = await window.FirestoreService.markValidLicenseCodeUsed(code.trim(), systemId);
    const durationDays = Number(markResult?.durationDays) || 365; // افتراضي سنة لو مفيش رد
    
    if (markResult.success) {
        const now = Date.now();
        const expiryDate = now + (durationDays * 24 * 60 * 60 * 1000);
        
        // حفظ بيانات الترخيص
        const licenseData = {
          isActivated: true,
          licenseCode: code.trim(),
          expiryDate: expiryDate,
          activatedAt: now,
          durationDays: durationDays
        };
        
        localStorage.setItem('solo_license_info', JSON.stringify(licenseData));
        
        // محاولة الحفظ في الفايربيز كنسخة احتياطية
        try { await window.FirestoreService.addLicense(licenseData); } catch(e) {}
        
        return { success: true, message: `✅ تم التفعيل لمدة ${durationDays} يوم`, expiryDate };
    } else {
        return { success: false, message: markResult.message || '❌ الكود غير صالح' };
    }
  } catch (error) {
    return { success: false, message: '❌ خطأ: ' + error.message };
  }
};

window.checkLicenseExpiry = async function() {
  try {
    const licenseInfo = JSON.parse(localStorage.getItem('solo_license_info') || 'null');
    if (!licenseInfo || !licenseInfo.expiryDate) {
      return { isValid: false, message: '⚠️ النسخة غير مفعلة', daysRemaining: 0 };
    }
    
    const now = Date.now();
    // إضافة فترة سماح 30 يوم
    const gracePeriod = 30 * 24 * 60 * 60 * 1000;
    const daysRemaining = Math.ceil((licenseInfo.expiryDate + gracePeriod - now) / (86400000));
    
    if (daysRemaining < 0) {
      return { isValid: false, message: '❌ الترخيص منتهي', daysRemaining: 0 };
    }
    
    return { isValid: true, daysRemaining, isExpiringSoon: daysRemaining <= 7 };
    
  } catch (e) { return { isValid: false, message: 'خطأ', daysRemaining: 0 }; }
};

function showLicenseExpiredModal(message) {
  const body = document.body;
  if (body) body.style.overflow = 'hidden';
  
  const modal = document.createElement('div');
  modal.id = 'licenseExpiredModal';
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0, 0, 0, 0.9); z-index: 99999;
    display: flex; align-items: center; justify-content: center;
    font-family: 'Cairo', sans-serif;
  `;
  
  modal.innerHTML = `
    <div style="background: white; border-radius: 15px; padding: 30px; text-align: center; max-width: 400px;">
      <h2 style="color: #e74c3c;">⚠️ تنبيه الترخيص</h2>
      <p style="margin: 20px 0; font-size: 18px;">${message || 'الترخيص منتهي'}</p>
      <button onclick="window.location.href='settings.html#subscription'" 
        style="background: #2c3e50; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; font-size: 16px;">
        تجديد الاشتراك
      </button>
    </div>
  `;
  
  document.body.appendChild(modal);
}

// ============================================================
// 🌐 دوال مساعدة عامة (Global Exports)
// ============================================================
window.applyRoleBasedAccess = applyRoleBasedAccess;
window.getCurrentUser = () => currentUser;
window.isUserLoggedIn = () => localStorage.getItem('isLoggedIn') === 'true';
window.isAdmin = () => {
    const r = localStorage.getItem('userRole');
    return r === 'admin' || r === 'owner';
};

// ============================================================
// 🧹 5. وظيفة مسح البيانات التشغيلية (Operational Wipe)
// ============================================================
window.performOperationalWipe = async function() {
    // التأكد من عدم وجود نافذة مفتوحة بالفعل
    if (document.getElementById('wipe-confirmation-modal')) return;

    // إنشاء النافذة المنبثقة (Modal) بدلاً من prompt/confirm
    const modalOverlay = document.createElement('div');
    modalOverlay.id = 'wipe-confirmation-modal';
    modalOverlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0, 0, 0, 0.85); z-index: 99999;
        display: flex; align-items: center; justify-content: center;
        font-family: 'Cairo', sans-serif;
        backdrop-filter: blur(5px);
    `;

    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
        background: #ffffff; width: 90%; max-width: 450px;
        border-radius: 16px; padding: 30px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        text-align: center; border: 1px solid #e74c3c;
        animation: slideIn 0.3s ease-out;
    `;

    // إضافة ستايل الأنيميشن
    if (!document.getElementById('wipe-modal-style')) {
        const style = document.createElement('style');
        style.id = 'wipe-modal-style';
        style.innerHTML = `@keyframes slideIn { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`;
        document.head.appendChild(style);
    }

    modalContent.innerHTML = `
        <div style="width: 60px; height: 60px; background: #ffebee; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
            <i class="fas fa-exclamation-triangle" style="font-size: 30px; color: #e74c3c;"></i>
        </div>
        <h2 style="color: #e74c3c; margin-bottom: 10px; font-weight: 800;">تحذير نهائي!</h2>
        <p style="color: #555; font-size: 15px; line-height: 1.6; margin-bottom: 20px;">
            سيتم حذف جميع البيانات التشغيلية (الطلبات، المبيعات، المصاريف، الشيفتات).
            <br><strong>هذا الإجراء لا يمكن التراجع عنه.</strong>
        </p>
        
        <div style="margin-bottom: 25px;">
            <label style="display: block; margin-bottom: 8px; font-size: 13px; color: #666; font-weight: 600;">للتأكيد، اكتب كلمة <span style="color: #e74c3c;">"مسح"</span> أدناه:</label>
            <input type="text" id="wipe-confirm-input" placeholder="اكتب كلمة مسح هنا" 
                style="width: 100%; padding: 12px; border: 2px solid #ddd; border-radius: 8px; font-size: 16px; text-align: center; transition: border-color 0.3s;">
        </div>

        <div style="display: flex; gap: 10px;">
            <button id="btn-cancel-wipe" style="flex: 1; padding: 12px; background: #f1f3f4; color: #333; border: none; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 14px;">إلغاء</button>
            <button id="btn-confirm-wipe" disabled style="flex: 1; padding: 12px; background: #e74c3c; color: white; border: none; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 14px; opacity: 0.5; transition: all 0.3s;">تأكيد المسح</button>
        </div>
    `;

    modalOverlay.appendChild(modalContent);
    document.body.appendChild(modalOverlay);

    // Event Listeners
    const input = document.getElementById('wipe-confirm-input');
    const confirmBtn = document.getElementById('btn-confirm-wipe');
    const cancelBtn = document.getElementById('btn-cancel-wipe');

    input.focus();

    input.addEventListener('input', (e) => {
        if (e.target.value === 'مسح') {
            confirmBtn.disabled = false;
            confirmBtn.style.opacity = '1';
        } else {
            confirmBtn.disabled = true;
            confirmBtn.style.opacity = '0.5';
        }
    });

    cancelBtn.onclick = () => {
        document.body.removeChild(modalOverlay);
    };

    confirmBtn.onclick = async () => {
        // Disable controls
        input.disabled = true;
        cancelBtn.disabled = true;
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري المسح...';

        try {
            await executeWipe();
        } catch (error) {
            console.error("Wipe Error:", error);
            alert("حدث خطأ: " + error.message);
            document.body.removeChild(modalOverlay);
        }
    };

    async function executeWipe() {
        console.log("🚀 Starting Operational Wipe...");

        // 2. مسح LocalStorage
        const keysToRemove = [
            'orders', 'salesHistory', 'ordersOnHold', // Orders
            'expenses', 'expensesHistory', // Expenses
            'cashSessions', // Shifts
            'notifications', // Notifications
            'attendance', // Attendance
            'daily_log', // Daily Log
            'performance', 'performance_snapshots' // Performance
        ];

        keysToRemove.forEach(key => {
            localStorage.removeItem(key);
            // إعادة تعيين المصفوفات الفارغة بدلاً من الحذف التام لتجنب الأخطاء
            localStorage.setItem(key, JSON.stringify([]));
        });
        console.log("✅ LocalStorage cleared.");

        // 3. مسح Firebase Firestore
        if (navigator.onLine && window.FirestoreService && window.FirestoreService.clearCollection) {
            const collections = ['orders', 'expenses', 'expensesHistory', 'shifts', 'notifications', 'attendance', 'daily_log', 'performance', 'salesHistory'];
            
            // تنفيذ المسح بالتوازي للسرعة
            const wipePromises = collections.map(col => window.FirestoreService.clearCollection(col));
            await Promise.all(wipePromises);
            console.log("✅ Firebase collections cleared.");
        } else {
            console.warn("⚠️ Firebase wipe skipped: Offline or Service missing.");
        }

        // 4. نجاح وإعادة تحميل
        document.body.removeChild(modalOverlay);
        // نستخدم setTimeout بسيط للتأكد من إغلاق المودال قبل التنبيه
        setTimeout(() => {
             alert("✅ تم مسح البيانات التشغيلية بنجاح!\nسيتم إعادة تحميل النظام الآن.");
             window.location.reload();
        }, 100);
    }
};

// ============================================================
// 🛑 منطقة الخطر: تجاوز وظيفة المسح القديمة (Capture Phase Fix)
// هذا الكود يضمن تشغيل المسح الشامل بدلاً من الكود القديم في settings.html
// ============================================================
document.addEventListener('click', async function(e) {
    const target = e.target;
    // البحث عن الزرار سواء تم الضغط على النص أو الأيقونة بداخله
    const button = target.tagName === 'BUTTON' ? target : target.closest('button');

    // التأكد من أن الزرار هو المقصود (عن طريق النص أو الـ class المميز)
    if (button && (
        button.innerText.includes('مسح البيانات التشغيلية') || 
        button.classList.contains('danger-btn') ||
        button.getAttribute('onclick') === 'clearOperationalDataOnly()'
    )) {
        // 1. قتل الوظيفة القديمة فوراً
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation(); // 👈 دي أهم سطر: بيمنع كود HTML القديم من التشغيل

        console.log("🛑 تم اعتراض زر المسح.. جاري تنفيذ المسح الشامل الجديد...");

        // 2. تشغيل وظيفة المسح الحديثة
        if (typeof window.performOperationalWipe === 'function') {
            await window.performOperationalWipe();
        } else {
            console.error('Critical: performOperationalWipe function missing');
            alert('خطأ: دالة المسح غير موجودة.');
        }
    }
}, true); // 👈 الـ true هنا معناها: التقط الحدث في البداية قبل أي كود آخر