// js/dashboard.js
// Use DataManager from data.js (exposed on window). Do not re-declare to avoid "already been declared" error.
function getDataManager() {
  return (typeof window !== 'undefined' && window.DataManager) || (typeof DataManager !== 'undefined' ? DataManager : null);
}

// تعريف المتغيرات العامة
let selectedCategory = null; // Category id (string preferred)
let cart = [];
let selectedItemForVariant = null;
let selectedVariant = null;
let orderType = 'takeaway'; // 'takeaway', 'dinein', or 'delivery'
let deliveryInfo = null;
let deliveryFee = 0;
let activeAggregator = null;
let aggregatorsData = [];
let isProcessingOrder = false; // Flag to prevent multiple submissions
let lastProceedClickTime = 0; // Track last click time to prevent double-clicks

// ── كاش الإعدادات عشان متروحش Firestore/localStorage في كل عملية ──
let _cachedTaxSettings = null;
let _cachedLoyaltySettings = null;

function _getTaxSettings() {
    if (_cachedTaxSettings) return _cachedTaxSettings;
    try {
        _cachedTaxSettings = JSON.parse(localStorage.getItem('taxServiceSettings') || '{}');
    } catch(e) { _cachedTaxSettings = {}; }
    return _cachedTaxSettings;
}

// امسح الكاش لما الإعدادات تتغير
window._invalidateTaxCache = function() { _cachedTaxSettings = null; };
window._invalidateLoyaltyCache = function() { _cachedLoyaltySettings = null; };

// لود إعدادات الولاء مرة واحدة في الخلفية
async function _loadLoyaltySettings() {
    if (_cachedLoyaltySettings) return _cachedLoyaltySettings;
    try {
        if (window.FirestoreService && window.FirestoreService.getSettings) {
            const s = await window.FirestoreService.getSettings();
            _cachedLoyaltySettings = (s && s.loyalty) ? s.loyalty : {};
        } else {
            _cachedLoyaltySettings = {};
        }
    } catch(e) { _cachedLoyaltySettings = {}; }
    return _cachedLoyaltySettings;
}

// ابدأ تحميل إعدادات الولاء في الخلفية بمجرد تحميل الصفحة
setTimeout(() => { _loadLoyaltySettings(); }, 2000);

// ===========================
// Attendance + Payroll (daily expense) - Cashier flow
// ===========================
function getBusinessDateSafe() {
    try {
        var dm = getDataManager();
        if (dm && typeof dm.getBusinessDate === 'function') {
            return dm.getBusinessDate();
        }
    } catch (_) { /* ignore */ }
    // Fallback: local YYYY-MM-DD
    try {
        return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    } catch (_) {
        const d = new Date();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${mm}-${dd}`;
    }
}

function round2(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return typeof Utils !== 'undefined' && typeof Utils.roundToTwoDecimals === 'function'
        ? Utils.roundToTwoDecimals(x)
        : parseFloat(x.toFixed(2));
}

function upsertLocalArray(storageKey, record) {
    const arr = JSON.parse(localStorage.getItem(storageKey) || '[]');
    const id = String(record?.id ?? '').trim();
    if (!id) return;

    // Dedupe by id (fix legacy duplicates) then upsert.
    const byId = new Map();
    for (const item of Array.isArray(arr) ? arr : []) {
        const key = String(item?.id ?? '').trim();
        if (!key) continue;
        // preserve last write wins (later item overrides earlier)
        byId.set(key, item);
    }
    const existing = byId.get(id) || {};
    byId.set(id, { ...existing, ...record, id });
    localStorage.setItem(storageKey, JSON.stringify(Array.from(byId.values())));
}

function removeLocalById(storageKey, id) {
    const arr = JSON.parse(localStorage.getItem(storageKey) || '[]');
    const filtered = arr.filter(x => String(x.id ?? '') !== String(id));
    localStorage.setItem(storageKey, JSON.stringify(filtered));
}

async function loadEmployeesForAttendance() {
    // Prefer Firebase
    if (typeof window !== 'undefined' && window.FirestoreService && navigator.onLine) {
        try {
            const list = await window.FirestoreService.getAllEmployees();
            if (Array.isArray(list)) return list;
        } catch (e) {
            console.warn('Error loading employees from Firebase:', e);
        }
    }
    // Fallback localStorage
    try {
        return JSON.parse(localStorage.getItem('employees') || '[]');
    } catch {
        return [];
    }
}

async function loadAttendanceForDate(businessDate) {
    // Prefer Firebase
    if (typeof window !== 'undefined' && window.FirestoreService && navigator.onLine) {
        try {
            if (typeof window.FirestoreService.getAttendanceByDate === 'function') {
                const list = await window.FirestoreService.getAttendanceByDate(businessDate);
                if (Array.isArray(list)) return list;
            }
        } catch (e) {
            console.warn('Error loading attendance from Firebase:', e);
        }
    }
    // Fallback localStorage
    try {
        const all = JSON.parse(localStorage.getItem('attendance') || '[]');
        return all.filter(r => String(r.businessDate) === String(businessDate));
    } catch {
        return [];
    }
}

function renderAttendanceModal({ businessDate, employees, attendanceRecords }) {
    const container = document.getElementById('attendanceList');
    const dateEl = document.getElementById('attendanceBusinessDate');
    if (dateEl) dateEl.textContent = businessDate;
    if (!container) return;

    if (!employees || employees.length === 0) {
        container.innerHTML = '<div style="text-align:center; color:#999999; padding: 18px;">لا يوجد موظفين. أضف موظفين أولاً من صفحة الموظفين.</div>';
        return;
    }

    // عند فتح النافذة نعرض دائماً "افتراضي" كمحدد (لا نحمّل الحالة المحفوظة)
    const status = 'default';

    container.innerHTML = employees.map(emp => {
        const id = String(emp.id ?? '');
        const name = emp.name || 'غير محدد';
        const role = emp.role || '';
        const salary = round2(emp.salary || 0);
        const rowId = `att_${encodeURIComponent(id)}`;
        return `
            <div style="border:1px solid #e8e8e8; border-radius: 12px; padding: 12px 14px; background:#ffffff; display:flex; justify-content:space-between; align-items:center; gap: 12px;">
                <div style="min-width: 220px;">
                    <div style="font-weight: 800; color:#000000; font-size: 15px; line-height: 1.4;">${name}</div>
                    <div style="color:#666666; font-size: 12px; margin-top: 2px;">${role ? role : ''} ${salary ? `— الراتب: ${salary} ج.م` : ''}</div>
                </div>
                <div style="display:flex; gap: 8px; flex-wrap: wrap; justify-content:flex-end;">
                    <label style="display:inline-flex; align-items:center; gap:6px; border:1px solid #e8e8e8; padding: 8px 10px; border-radius: 10px; cursor:pointer; background:${status==='default'?'#f0f0f0':'#fafafa'};">
                        <input type="radio" name="${rowId}" value="default" ${status==='default'?'checked':''} />
                        <span style="font-weight:700; font-size: 12px;">افتراضي</span>
                    </label>
                    <label style="display:inline-flex; align-items:center; gap:6px; border:1px solid #e8e8e8; padding: 8px 10px; border-radius: 10px; cursor:pointer; background:#fafafa;">
                        <input type="radio" name="${rowId}" value="present" />
                        <span style="font-weight:700; font-size: 12px;">حاضر</span>
                    </label>
                    <label style="display:inline-flex; align-items:center; gap:6px; border:1px solid #e8e8e8; padding: 8px 10px; border-radius: 10px; cursor:pointer; background:#fafafa;">
                        <input type="radio" name="${rowId}" value="absent" />
                        <span style="font-weight:700; font-size: 12px;">غائب</span>
                    </label>
                    <label style="display:inline-flex; align-items:center; gap:6px; border:1px solid #e8e8e8; padding: 8px 10px; border-radius: 10px; cursor:pointer; background:#fafafa;">
                        <input type="radio" name="${rowId}" value="vacation" />
                        <span style="font-weight:700; font-size: 12px;">إجازة</span>
                    </label>
                </div>
            </div>
        `;
    }).join('');
}

async function openAttendanceModalInternal() {
    const modal = document.getElementById('attendanceModal');
    if (!modal) return;

    const businessDate = getBusinessDateSafe();
    const employees = await loadEmployeesForAttendance();
    const attendanceRecords = await loadAttendanceForDate(businessDate);
    renderAttendanceModal({ businessDate, employees, attendanceRecords });
    modal.classList.add('active');
}

window.openAttendanceModal = function() {
    openAttendanceModalInternal().catch(err => {
        console.error('openAttendanceModal error:', err);
        alert('حدث خطأ أثناء تحميل الحضور: ' + (err?.message || err));
    });
};

window.reloadAttendanceModal = function() {
    openAttendanceModalInternal().catch(err => {
        console.error('reloadAttendanceModal error:', err);
    });
};

window.closeAttendanceModal = function() {
    const modal = document.getElementById('attendanceModal');
    if (modal) modal.classList.remove('active');
};

window.saveAttendance = async function() {
    try {
        const businessDate = String(getBusinessDateSafe()); // نتأكد إنه نص (2026-02-06)
        const employees = await loadEmployeesForAttendance();
        const markedBy = (typeof Auth !== 'undefined' && typeof Auth.getUsername === 'function')
            ? Auth.getUsername()
            : (localStorage.getItem('username') || 'المستخدم');

        // 🔥 1. نجيب الشيفت المفتوح عشان نربط المصروف بيه
        let currentShiftId = null;
        if (typeof DataManager !== 'undefined') {
            const session = await DataManager.getTodayCashSession();
            if (session && session.status === 'open') {
                currentShiftId = session.id;
            }
        }

        let totalPayrollAdded = 0;

        for (const emp of employees) {
            const empId = String(emp.id ?? '');
            if (!empId) continue;

            const radioName = `att_${encodeURIComponent(empId)}`;
            const checked = document.querySelector(`input[name="${radioName}"]:checked`);
            const status = checked ? checked.value : 'default';

            if (status === 'default') continue;

            // حساب اليومية
            const salary = parseFloat(emp.salary || 0);
            const dailyWage = salary > 0 ? parseFloat((salary / 30).toFixed(2)) : 0;
            const attendanceId = `${businessDate}_${empId}`;
            
            const attendanceRecord = {
                id: attendanceId,
                businessDate: businessDate, // نص صريح
                employeeId: empId,
                employeeName: emp.name || 'غير محدد',
                status, 
                dailyWage: dailyWage,
                markedBy,
                markedAt: new Date().toISOString()
            };

            // حفظ الحضور
            upsertLocalArray('attendance', attendanceRecord);
            if (window.SyncManager) {
                window.SyncManager.addToSyncQueue('attendance', 'add', attendanceRecord, `local_${attendanceId}`);
            }

            // 🔥 التعديل المظبوط لتسجيل مصروف اليومية ومزامنته فوراً
            if ((status === 'present' || status === 'حاضر') && dailyWage > 0 && currentShiftId) {
                const expenseId = `PAYROLL_${businessDate}_${empId}`;
                const payrollExpense = {
                    id: expenseId,
                    description: `يومية موظف: ${emp.name}`,
                    amount: dailyWage,
                    category: "رواتب العمال",
                    type: "employees",
                    date: businessDate,
                    businessDate: businessDate,
                    shift_id: currentShiftId, // 👈 الربط بالشيفت اللي اتفقنا عليه
                    createdBy: markedBy,
                    source: 'auto_payroll',
                    _synced: false // 👈 علامة إنه لسه مرفعش
                };

                // 1. حفظه محلياً في المصاريف والأرشيف
                upsertLocalArray('expenses', payrollExpense);
                upsertLocalArray('expensesHistory', payrollExpense);

                // 2. 🔥 السطر السحري: إعطاء أمر مزامنة للمصروف
                if (window.SyncManager) {
                    window.SyncManager.addToSyncQueue('expenses', 'add', payrollExpense, expenseId);
                }
                
                totalPayrollAdded += dailyWage;
            }
        }

        // رسالة تأكيد بالمبلغ
        if (totalPayrollAdded > 0) {
            if (typeof Notification !== 'undefined') {
                Notification.success(`تم إضافة ${totalPayrollAdded} ج.م للمصاريف`);
            } else {
                alert(`تم إضافة ${totalPayrollAdded} ج.م للمصاريف`);
            }
        } else {
             if (typeof Notification !== 'undefined') Notification.success('تم حفظ الحضور');
        }
        
        window.closeAttendanceModal();
        
        // تحديث الداشبورد
        setTimeout(async () => {
             if (typeof initDashboard === 'function') await initDashboard();
        }, 200);

    } catch (err) {
        console.error('saveAttendance error:', err);
        alert('حدث خطأ: ' + (err?.message || err));
    }
};

// Quick actions (cashier): mark all employees present / absent / افتراضي
window.selectAllAttendance = function(status) {
    const st = String(status || '').toLowerCase();
    const value = st === 'present' ? 'present' : (st === 'default' || st === 'افتراضي' ? 'default' : 'absent');

    // For each employee row, radio name looks like "att_<encodedEmployeeId>"
    const names = new Set(
        Array.from(document.querySelectorAll('input[type="radio"][name^="att_"]'))
            .map((el) => el.getAttribute('name'))
            .filter(Boolean)
    );

    names.forEach((name) => {
        const selector = `input[type="radio"][name="${CSS.escape(name)}"][value="${value}"]`;
        const radio = document.querySelector(selector);
        if (radio) radio.checked = true;
    });
};


// التحقق من تسجيل الدخول وتطبيق الصلاحيات
if (typeof Auth !== 'undefined') {
    const isLoggedIn = Auth.isLoggedIn();
    if (!isLoggedIn) {
        if (!window.location.pathname.includes('login.html')) {
            if (!window._redirectingToLogin) {
                window._redirectingToLogin = true;
                setTimeout(() => {
                    window.location.href = 'login.html';
                }, 100);
            }
        }
    } else {
        Auth.applyPermissions();
    }
} else {
    // Fallback إذا لم يكن Auth متاحاً
    if (localStorage.getItem('isLoggedIn') !== 'true') {
        if (!window.location.pathname.includes('login.html')) {
            if (!window._redirectingToLogin) {
                window._redirectingToLogin = true;
                setTimeout(() => {
                    window.location.href = 'login.html';
                }, 100);
            }
        }
    }
}

// امسح ده من dashboard.js
/*
window.logout = function() {
    if (typeof Auth !== 'undefined') {
        Auth.logout();
    } else {
        localStorage.removeItem('isLoggedIn');
        localStorage.removeItem('username');
        localStorage.removeItem('userType');
        window.location.href = 'login.html';
    }
};
*/

// Global Functions

// Switch Category Function
window.switchCategory = function(categoryId) {
    try {
        selectedCategory = categoryId;
        const categoryTabs = document.getElementById('categoryTabs');
        
        if (categoryTabs) {
            // تحديث الزرار النشط (اللون الأسود)
            categoryTabs.querySelectorAll('.category-tab').forEach(btn => {
                const btnCatId = btn.dataset.categoryId;
                if (String(btnCatId) === String(categoryId)) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        }
        
        // إعادة رسم المنتجات على النضافة بدون فراغات
        initMenu();
        
    } catch (e) {
        console.error('Error in switchCategory:', e);
    }
};

// Add Item to Cart Function
window.addItemToCart = function(item) {
    try {
        if (!item) {
            alert('خطأ: المنتج غير موجود');
            return;
        }
        
        if (item.variants && item.variants.length > 0) {
            if (typeof showVariantModal === 'function') {
                showVariantModal(item);
            } else {
                // Fallback: add first variant
                const firstVariant = item.variants[0];
                const itemToAdd = {
                    id: item.id,
                    name: item.name,
                    icon: item.icon,
                    categoryId: item.categoryId,
                    price: firstVariant.price,
                    variant: firstVariant.name,
                    quantity: 1
                };
                if (typeof addToCart === 'function') {
                    addToCart(itemToAdd);
                } else {
                    alert('خطأ: دالة addToCart غير موجودة');
                }
            }
        } else {
            const itemToAdd = {
                id: item.id,
                name: item.name,
                icon: item.icon,
                categoryId: item.categoryId,
                price: item.price || 0,
                variant: '',
                quantity: 1
            };
            if (typeof addToCart === 'function') {
                addToCart(itemToAdd);
            } else {
                console.error('addToCart function not found');
                alert('خطأ: دالة addToCart غير موجودة');
            }
        }
    } catch (e) {
        console.error('خطأ في addItemToCart:', e);
        alert('حدث خطأ: ' + e.message);
    }
};

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
    // انتظار توفر DataManager (مهم في Electron عند تحميل غير متزامن)
    function waitForDataManager(retries = 50) {
        return new Promise((resolve) => {
            function check(i) {
                if (getDataManager()) {
                    return resolve(true);
                }
                if (i >= retries) return resolve(false);
                setTimeout(() => check(i + 1), 100);
            }
            check(0);
        });
    }
    var ready = await waitForDataManager();
    if (!ready) {
        console.error('DataManager not loaded after retries');
        if (typeof Notification !== 'undefined') {
            Notification.error('خطأ في تحميل النظام. حدّث الصفحة.');
        }
    }

    // إضافة event listener مباشر على form إغلاق الشيفت
    const closeCashDrawerForm = document.getElementById('closeCashDrawerForm');
    if (closeCashDrawerForm) {
        closeCashDrawerForm.addEventListener('submit', async function(e) {
            if (typeof window.handleCloseCashDrawer === 'function') {
                await window.handleCloseCashDrawer(e);
            } else {
                console.error('handleCloseCashDrawer is not a function');
            }
        });
    }

    // محاولة تشغيل الداشبورد (فقط إذا توفر DataManager)
    if (getDataManager()) {
        try {
            await initDashboard();
        } catch (e) {
            console.error("خطأ في الداشبورد:", e);
        }
    }
    
    // تحديث الداشبورد تلقائياً عند تغيير البيانات في localStorage
    ('storage', async (e) => {
        if (e.key === 'orders' || e.key === 'expenses' || e.key === 'salesHistory' || e.key === 'cashSessions') {
            await initDashboard();
        }
    });
    

    
    // استماع لتحديثات الطلبات من خلال CustomEvent
    window.addEventListener('orderUpdated', async () => {
        await initDashboard();
    });

    // محاولة تشغيل السلة
    try {
        initCart();
    } catch (e) {
        console.error("خطأ في السلة:", e);
    }

    loadAggregatorsForPOS();

    // باقي الوظائف
    try {
        initSearch();
        initProceedBtn();
        initOrderType();
    } catch (e) {
        console.error("خطأ في باقي الوظائف:", e);
    }
    
    // استئناف طلب معلق إذا موجود في localStorage
    try {
        const resumeOrderRaw = localStorage.getItem('resumeOrder');
        if (resumeOrderRaw) {
            const resumeOrder = JSON.parse(resumeOrderRaw);
            if (resumeOrder && Array.isArray(resumeOrder.items) && resumeOrder.items.length > 0 && typeof addToCart === 'function') {
                cart = [];
                resumeOrder.items.forEach((item) => {
                    addToCart({ ...item });
                });
                orderType = resumeOrder.orderType || 'takeaway';
                deliveryInfo = resumeOrder.deliveryInfo || null;
                updateCart();
            }
            localStorage.removeItem('resumeOrder');
        }
    } catch (e) {
        console.error('خطأ أثناء استئناف الطلب المعلق:', e);
    }
    
    // التحقق من جلسة الدرج النقدي - بعد تأخير بسيط لضمان تحميل البيانات
    setTimeout(async () => {
        try {
            await checkCashDrawerSession();
        } catch (e) {
            console.error("خطأ في التحقق من الدرج النقدي:", e);
        }
    }, 300);
    
    // ═════════════════════════════════════════════════════════════════
    // 🚀 Offline-First Menu Engine
    // المرحلة 1: localStorage فوراً (0ms) — المرحلة 2: Firebase خلفية
    // ═════════════════════════════════════════════════════════════════

    // مساعد dedup
    const _dedupById = (arr) => {
        if (!Array.isArray(arr)) return [];
        const seen = new Map();
        arr.forEach(item => { if (item && item.id) seen.set(String(item.id), item); });
        return Array.from(seen.values());
    };

    function _renderMenuFromCache() {
        // قراءة localStorage فوراً
        try {
            const raw = localStorage.getItem('categories');
            const parsed = (raw && raw !== '[]' && raw !== 'null') ? JSON.parse(raw) : [];
            const clean = _dedupById(parsed);
            if (clean.length !== parsed.length) localStorage.setItem('categories', JSON.stringify(clean));
            if (!window.menuData) window.menuData = {};
            window.menuData.categories = clean;
        } catch (e) {
            if (!window.menuData) window.menuData = {};
            window.menuData.categories = [];
        }
        // رسم الفئات والمنتجات فوراً
        initCategories();
        const categoryTabs = document.getElementById('categoryTabs');
        if (!categoryTabs || categoryTabs.children.length === 0) initMenu();
    }

    let _menuSynced = false;
    async function _syncMenuFromFirebase() {
        if (_menuSynced || !navigator.onLine) return;
        if (!window.FirestoreService) {
            let w = 0;
            await new Promise(res => {
                const iv = setInterval(() => {
                    w += 100;
                    if (window.FirestoreService || w >= 3000) { clearInterval(iv); res(); }
                }, 100);
            });
            if (!window.FirestoreService) return;
        }
        _menuSynced = true;
        try {
            const [fbCats, fbItems] = await Promise.all([
                window.FirestoreService.getAllCategories(),
                window.FirestoreService.getAllMenuItems()
            ]);
            let changed = false;
            const prevCatLen = (window.menuData && window.menuData.categories) ? window.menuData.categories.length : 0;
            if (Array.isArray(fbCats) && fbCats.length > 0) {
                const clean = _dedupById(fbCats);
                localStorage.setItem('categories', JSON.stringify(clean));
                if (!window.menuData) window.menuData = {};
                window.menuData.categories = clean;
                if (clean.length !== prevCatLen) changed = true;
            }
            if (Array.isArray(fbItems) && fbItems.length > 0) {
                const clean = _dedupById(fbItems);
                localStorage.setItem('menuItems', JSON.stringify(clean));
                if (changed || !window.menuData.items || window.menuData.items.length !== clean.length) {
                    if (!window.menuData) window.menuData = {};
                    window.menuData.items = clean;
                    changed = true;
                }
            }
            if (changed) {
                initCategories();
                const categoryTabs = document.getElementById('categoryTabs');
                if (!categoryTabs || categoryTabs.children.length === 0) initMenu();
            }
        } catch (e) {
            console.warn('Menu Firebase sync failed:', e);
        }
    }

    // المرحلة 1: عرض فوري من localStorage
    _renderMenuFromCache();

    // المرحلة 2: sync فوري لو UID موجود، أو بعد saas-ready
    const _uid = localStorage.getItem('_saasUid') || localStorage.getItem('userId');
    if (_uid && navigator.onLine) {
        _syncMenuFromFirebase();
    }
    window.addEventListener('saas-ready', _syncMenuFromFirebase, { once: true }); 
    
}); // 👈 دي قفلة دالة DOMContentLoaded الأساسية 

// ❌ مسحنا كود window.onload والمحاولات المتكررة لأنها كانت بتعمل الرعشة والريفريش!

// Order Type Logic
function initOrderType() {
    const takeawayBtn = document.getElementById('takeawayBtn');
    const dineinBtn = document.getElementById('dineinBtn');
    const deliveryBtn = document.getElementById('deliveryBtn');
    const deliveryFeeInput = document.getElementById('deliveryFeeInput');
    const deliveryFeeRow = document.getElementById('deliveryFeeRow');
    const tableNumberInput = document.getElementById('tableNumberInput');
    
    const setActiveButton = (activeBtn, inactiveBtns) => {
        activeBtn.classList.add('active');
        activeBtn.style.background = 'var(--color-text-dark)';
        activeBtn.style.color = 'var(--color-white)';
        activeBtn.style.borderColor = 'var(--color-text-dark)';
        
        inactiveBtns.forEach(btn => {
            if (btn) {
                btn.classList.remove('active');
                btn.style.background = 'var(--color-white)';
                btn.style.color = 'var(--color-text-dark)';
                btn.style.borderColor = 'var(--color-separator)';
            }
        });

        document.querySelectorAll('.aggregator-btn').forEach(btn => {
            btn.classList.remove('active');
            btn.style.background = 'var(--color-white)';
            btn.style.color = 'var(--color-text-dark)';
            btn.style.borderColor = 'var(--color-separator)';
        });
    };

    // 💡 دالة ترجيع الأسعار للسعر الأساسي لما تلغي شركة التوصيل
    const resetCartPrices = () => {
        cart.forEach(item => {
            if (item.originalPrice !== undefined) {
                item.price = item.originalPrice;
            }
        });
        window.orderGlobalDiscount = 0; 
        window.orderGlobalSurcharge = 0;
    };
    
    if (takeawayBtn) {
        takeawayBtn.addEventListener('click', () => {
            orderType = 'takeaway';
            deliveryInfo = null;
            deliveryFee = 0;
            activeAggregator = null;
            resetCartPrices();
            setActiveButton(takeawayBtn, [dineinBtn, deliveryBtn]);
            if (deliveryFeeInput) deliveryFeeInput.style.display = 'none';
            if (deliveryFeeRow) deliveryFeeRow.style.display = 'none';
            if (tableNumberInput) tableNumberInput.style.display = 'none';
            updateCart();
        });
    }
    
    if (dineinBtn) {
        dineinBtn.addEventListener('click', () => {
            orderType = 'dinein';
            deliveryInfo = null;
            deliveryFee = 0;
            activeAggregator = null;
            resetCartPrices();
            setActiveButton(dineinBtn, [takeawayBtn, deliveryBtn]);
            if (deliveryFeeInput) deliveryFeeInput.style.display = 'none';
            if (deliveryFeeRow) deliveryFeeRow.style.display = 'none';
            if (tableNumberInput) tableNumberInput.style.display = 'block';
            updateCart();
        });
    }
    
    if (deliveryBtn) {
        deliveryBtn.addEventListener('click', () => {
            orderType = 'delivery';
            activeAggregator = null;
            resetCartPrices();
            setActiveButton(deliveryBtn, [takeawayBtn, dineinBtn]);
            if (deliveryFeeInput) deliveryFeeInput.style.display = 'block';
            if (deliveryFeeRow) deliveryFeeRow.style.display = 'flex';
            if (tableNumberInput) tableNumberInput.style.display = 'none';
            updateCart();
        });
    }
}
// دالة مساعدة لحساب النسبة المئوية وتلوين الأسهم 
 function updateDashboardBadge(elementId, currentValue, previousValue, invertColors = false) { 
     const badgeEl = document.getElementById(elementId); 
     if (!badgeEl) return; 
 
     let percent = 0; 
     if (previousValue === 0) { 
         percent = currentValue > 0 ? 100 : 0; 
     } else { 
         percent = ((currentValue - previousValue) / previousValue) * 100; 
     } 
 
     percent = Math.round(percent); 
 
     let badgeClass = 'badge-info'; 
     let arrow = ''; 
 
     if (percent > 0) { 
         // لو بنحسب مصاريف، الزيادة لونها أحمر، لو إيرادات الزيادة أخضر 
         badgeClass = invertColors ? 'badge-danger' : 'badge-success'; 
         arrow = '↑'; 
     } else if (percent < 0) { 
         // العكس في النقصان 
         badgeClass = invertColors ? 'badge-success' : 'badge-danger'; 
         arrow = '↓'; 
     } 
 
     badgeEl.className = `dashboard-card-badge ${badgeClass}`; 
     badgeEl.textContent = `${arrow}${Math.abs(percent)}%`; 
 } 

async function initDashboard() { 
     if (!getDataManager()) return; 
     try { 
         const todayOrdersEl = document.getElementById('todayOrders'); 
         const netRevenueEl = document.getElementById('netRevenue'); 
         const totalRevenueEl = document.getElementById('totalRevenue'); 
         const todayExpensesEl = document.getElementById('todayExpenses'); 
             
         if (!todayOrdersEl || !netRevenueEl || !totalRevenueEl || !todayExpensesEl) return; 
 
         const todaySession = await DataManager.getTodayCashSession(); 
         
         if (!todaySession || todaySession.status !== 'open') { 
             todayOrdersEl.textContent = '0'; 
             totalRevenueEl.textContent = Utils.formatCurrency(0); 
             todayExpensesEl.textContent = Utils.formatCurrency(0); 
             netRevenueEl.textContent = Utils.formatCurrency(0); 
             return; 
         } 
 
         const currentSessionId = todaySession.id; 
 
         const [orders, salesHistory, expenses] = await Promise.all([ 
             DataManager.getOrders() || [], 
             DataManager.getSalesHistory() || [], 
             DataManager.getExpenses() || [] 
         ]); 
 
         const sessionOrders = orders.filter(order => { 
             if (!order) return false; 
             const orderShiftId = order.shift_id || order.shiftId; 
             return orderShiftId === currentSessionId; 
         }); 
 
         const sessionExpenses = expenses.filter(expense => { 
             if (!expense) return false; 
             const expShiftId = expense.shift_id || expense.shiftId; 
             return expShiftId === currentSessionId; 
         }); 
 
         // 🛑 التعديل هنا: فصل الكاش عن الإجمالي 
         let totalRevenue = 0; // إجمالي المبيعات (كاش + فيزا) 
         let cashRevenue = 0;  // الكاش فقط 
         let totalDiscounts = 0; 
         
         sessionOrders.forEach((order) => { 
             const orderFinalAmount = Number(order.total || order.netTotal || order.orderTotal || 0); 
             const orderDiscount = parseFloat(order.discount) || 0; 
             const pm = String(order.paymentMethod || order.payment_method || '').trim().toLowerCase(); 
             const isCash = (pm === 'cash' || pm === 'نقدي' || pm === 'نقد' || pm === ''); 
             
             totalRevenue += orderFinalAmount; 
             if (isCash) cashRevenue += orderFinalAmount; // يجمع الكاش بس 
             totalDiscounts += orderDiscount; 
         }); 
         
         const totalExpenses = sessionExpenses.reduce((sum, exp) => sum + (parseFloat(exp.amount) || 0), 0); 
         
         todayOrdersEl.textContent = sessionOrders.length; 
         
         // الإجمالي (شامل كل حاجة: كاش وفيزا) 
         const grossRevenue = totalRevenue + totalDiscounts; 
         totalRevenueEl.textContent = Utils.formatCurrency(grossRevenue); 
         
         todayExpensesEl.textContent = Utils.formatCurrency(totalExpenses); 
         
         // صافي الكاش في الدرج (الكاش فقط - المصاريف) 
         const netCashInDrawer = cashRevenue - totalExpenses; 
         netRevenueEl.textContent = Utils.formatCurrency(netCashInDrawer); 
 
         // ======= حساب الشيفت السابق والبادجز ======= 
         const allSessions = await DataManager.getCashSessions() || []; 
         const sortedSessions = allSessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); 
         const currentSessionIndex = sortedSessions.findIndex(s => s.id === currentSessionId); 
          
         let prevOrdersCount = 0; 
         let prevGrossRevenue = 0; 
         let prevTotalExpenses = 0; 
         let prevNetCash = 0; 
  
         if (currentSessionIndex >= 0 && currentSessionIndex + 1 < sortedSessions.length) { 
             const prevSession = sortedSessions[currentSessionIndex + 1]; 
             const prevSessionId = prevSession.id; 
  
             const prevOrders = orders.filter(o => (o.shift_id || o.shiftId) === prevSessionId); 
             const prevExpensesList = expenses.filter(e => (e.shift_id || e.shiftId) === prevSessionId); 
  
             prevOrdersCount = prevOrders.length; 
              
             let prevRev = 0; 
             let prevCashRev = 0; 
             let prevDisc = 0; 
             
             prevOrders.forEach(o => { 
                 const amt = Number(o.total || o.netTotal || o.orderTotal || 0); 
                 const pm = String(o.paymentMethod || o.payment_method || '').trim().toLowerCase(); 
                 const isCash = (pm === 'cash' || pm === 'نقدي' || pm === 'نقد' || pm === ''); 
                  
                 prevRev += amt; 
                 if (isCash) prevCashRev += amt; 
                 prevDisc += parseFloat(o.discount) || 0; 
             }); 
              
             prevGrossRevenue = prevRev + prevDisc; 
             prevTotalExpenses = prevExpensesList.reduce((sum, exp) => sum + (parseFloat(exp.amount) || 0), 0); 
             prevNetCash = prevCashRev - prevTotalExpenses; 
         } 
  
         updateDashboardBadge('todayOrdersBadge', sessionOrders.length, prevOrdersCount); 
         updateDashboardBadge('totalRevenueBadge', grossRevenue, prevGrossRevenue); 
         updateDashboardBadge('todayExpensesBadge', totalExpenses, prevTotalExpenses, true); 
         updateDashboardBadge('netRevenueBadge', netCashInDrawer, prevNetCash); 
 
     } catch (error) { 
         console.error("❌ Error in initDashboard:", error); 
     } 
 }
// Categories Init
function initCategories() {
    // 1. لازم نعرف الفئات ونسحبها الأول قبل أي حاجة 
    let categories = [];
    if (typeof window.menuData !== 'undefined' && window.menuData.categories && window.menuData.categories.length > 0) {
        categories = window.menuData.categories;
    } else {
        categories = JSON.parse(localStorage.getItem('categories') || '[]');
    }

    // 2. دلوقتي نقدر نرتبها بأمان لأن السيستم عرفها خلاص 
    categories.sort((a, b) => {
        let orderA = a.order !== undefined ? Number(a.order) : (a.createdAt || 9999999999999);
        let orderB = b.order !== undefined ? Number(b.order) : (b.createdAt || 9999999999999);
        return orderA - orderB;
    });

    const categoryTabs = document.getElementById('categoryTabs');
    if (!categoryTabs) {
        return;
    }
    
    if (!categories || categories.length === 0) {
        categoryTabs.innerHTML = '<div style="text-align: center; padding: var(--spacing-md); color: #e74c3c;">لا توجد فئات</div>';
        return;
    }
    
    // 🛡️ درع حماية الفئات: فلترة إجبارية لأي فئة مكررة في الشاشة
    const uniqueCategories = [];
    const seenCatNames = new Set();
    categories.forEach(cat => {
        const catName = (cat.name || "").trim().toUpperCase();
        if (catName && !seenCatNames.has(catName)) {
            seenCatNames.add(catName);
            uniqueCategories.push(cat);
        }
    });
    categories = uniqueCategories; // استخدام الفئات الصافية فقط

    categoryTabs.innerHTML = '';
    
    categories.forEach((category) => {
        const btn = document.createElement('button');
        btn.className = 'category-tab';
        btn.textContent = category.name;
        btn.dataset.categoryId = String(category.id);
        btn.addEventListener('click', () => {
            document.querySelectorAll('.category-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedCategory = String(category.id);
            initMenu();
        });
        categoryTabs.appendChild(btn);
    });
    
    if (categoryTabs.firstElementChild) {
        categoryTabs.firstElementChild.classList.add('active');
        selectedCategory = String(categories[0].id);
        // استدعاء initMenu مباشرة بعد تعيين selectedCategory
        initMenu();
    }
}

// Menu Init
function initMenu() {
    const menuGrid = document.getElementById('menuGrid');
    if (!menuGrid) {
        return;
    }
    
    let data = null;
    if (typeof menuData !== 'undefined' && menuData) data = menuData;
    else if (typeof window.menuData !== 'undefined' && window.menuData) data = window.menuData;
    else if (typeof globalMenuData !== 'undefined' && globalMenuData) data = globalMenuData;
    if (!data) {
        try {
            const catRaw = localStorage.getItem('categories');
            const itemsRaw = localStorage.getItem('menuItems');
            if (catRaw && itemsRaw) {
                data = { categories: JSON.parse(catRaw), items: JSON.parse(itemsRaw) };
            }
        } catch (e) {
            console.warn('initMenu: fallback from localStorage failed', e);
        }
    }
    if (!data) {
        menuGrid.innerHTML = '<div class="empty-state">⚠️ خطأ في تحميل البيانات</div>';
        return;
    }
    
    let items = [];
    const firstRunCompleted = localStorage.getItem('first_run_completed');
    if (localStorage.getItem('menuItems')) {
        try {
            items = JSON.parse(localStorage.getItem('menuItems'));
        } catch (e) {
            items = [];
        }
    } else if (!firstRunCompleted && data && data.items) {
        // استخدام البيانات الافتراضية فقط إذا لم يكن أول تشغيل قد تم
        items = data.items || [];
        localStorage.setItem('menuItems', JSON.stringify(items));
    } else {
        // إذا كان أول تشغيل تم وليس هناك menuItems، نستخدم مصفوفة فارغة
        items = [];
    }
    
    if (!items || items.length === 0) {
        menuGrid.innerHTML = '<div class="empty-state">لا توجد منتجات</div>';
        return;
    }

    // 🛡️ درع حماية المنتجات: فلترة إجبارية لأي منتج مكرر
    const uniqueItems = [];
    const seenItemNames = new Set();
    items.forEach(item => {
        const itemName = (item.name || "").trim().toUpperCase();
        if (itemName && !seenItemNames.has(itemName)) {
            seenItemNames.add(itemName);
            uniqueItems.push(item);
        }
    });
    items = uniqueItems; // استخدام المنتجات الصافية فقط
    
    menuGrid.innerHTML = '';
    
    // تحميل الفئات من localStorage لتحديد selectedCategory
    let categories = [];
    // firstRunCompleted تم تعريفه أعلاه في نفس الدالة
    if (localStorage.getItem('categories')) {
        try {
            categories = JSON.parse(localStorage.getItem('categories'));
        } catch (e) {
            console.warn('Error loading categories in initMenu:', e);
        }
    } else if (!firstRunCompleted) {
        // استخدام الفئات الافتراضية فقط إذا لم يكن أول تشغيل قد تم
        if (data && data.categories) {
            categories = data.categories;
        }
    }
    
    // Ensure selectedCategory is set - default to first category if not set
    if (!selectedCategory && categories && categories.length > 0) {
        selectedCategory = String(categories[0].id);
    }
    
    // 🔥 التعديل الجذري: فلترة المنتجات (قبل) رسمها في الشاشة لمنع الفراغات
    let filteredItems = items;
    if (selectedCategory && selectedCategory !== 'all') {
        const selectedCategoryStr = String(selectedCategory);
        filteredItems = items.filter(item => String(item.categoryId) === selectedCategoryStr);
    }
    
    if (filteredItems.length === 0) {
        menuGrid.innerHTML = '<div class="empty-state" style="grid-column: 1/-1; text-align: center; padding: 40px; color: #999;">لا توجد منتجات في هذه الفئة</div>';
        return;
    }
    
    filteredItems.forEach((item, index) => {
        const menuItemBtn = document.createElement('button');
        menuItemBtn.className = 'menu-item-btn ripple';
        
        // السر هنا: الـ index بيبدأ من صفر للمنتجات المرئية بس، فهتظهر فوراً بدون تأخير
        menuItemBtn.style.animationDelay = `${index * 0.05}s`;
        menuItemBtn.dataset.category = item.categoryId || '';
        
        const displayPrice = item.variants && item.variants.length > 0
            ? `من ${Utils.formatCurrency(Math.min(...item.variants.map(v => v.price)))}`
            : (item.price ? Utils.formatCurrency(item.price) : '');
        
        // Get stock info
        const itemType = item.type || 'physical';
        let stockInfo = '';
        if (itemType === 'physical') {
            const stock = item.stock || 0;
            const minStockLimit = item.minStockLimit || 5;
            const criticalStockLimit = item.criticalStockLimit !== undefined ? item.criticalStockLimit : 0;
            
            let quantityBgColor = 'linear-gradient(135deg, #27AE60 0%, #229954 100%)'; // Green
            if (stock <= criticalStockLimit) {
                quantityBgColor = 'linear-gradient(135deg, #E74C3C 0%, #C0392B 100%)'; // Red
            } else if (stock <= minStockLimit) {
                quantityBgColor = 'linear-gradient(135deg, #F39C12 0%, #E67E22 100%)'; // Yellow
            }
            
            stockInfo = `
                <div class="menu-item-stock-info">
                    <div class="menu-item-stock-quantity" style="background: ${quantityBgColor};">
                        ${stock}
                    </div>
                </div>
            `;
        } else {
            // For services, show infinity symbol
            stockInfo = `
                <div class="menu-item-stock-info">
                    <div class="menu-item-stock-quantity" style="background: linear-gradient(135deg, #3498DB 0%, #2980B9 100%); font-size: 16px;">
                        ∞
                    </div>
                </div>
            `;
        }
        
        menuItemBtn.innerHTML = `
            ${stockInfo}
            <div class="menu-item-name">${item.name}</div>
            ${displayPrice ? `<div style="font-size: 13px; color: #333; margin-top: 8px; font-weight: bold;">${displayPrice}</div>` : ''}
        `;
        
        if (item.variants && item.variants.length > 0) {
            menuItemBtn.addEventListener('click', () => showVariantModal(item));
        } else {
            menuItemBtn.addEventListener('click', () => {
                const itemToAdd = { ...item, price: Utils.roundToTwoDecimals(item.price || 0) };
                addToCart(itemToAdd);
            });
        }
        
        menuGrid.appendChild(menuItemBtn);
    });
}

// Show Variant Modal
window.showVariantModal = function(item) {
    selectedItemForVariant = item;
    selectedVariant = null;
    const variantModalTitle = document.getElementById('variantModalTitle');
    const variantOptions = document.getElementById('variantOptions');
    if (!variantModalTitle || !variantOptions) return;
    
    variantModalTitle.textContent = item.name;
    variantOptions.innerHTML = '';
    
    item.variants.forEach(variant => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary';
        btn.textContent = `${variant.name} - ${Utils.formatCurrency(variant.price)}`;
        btn.addEventListener('click', () => {
            document.querySelectorAll('#variantOptions .btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedVariant = variant;
        });
        variantOptions.appendChild(btn);
    });
    
    const variantModal = document.getElementById('variantModal');
    if (variantModal) variantModal.classList.add('active');
};

// Add Variant Button Event
const addVariantBtn = document.getElementById('addVariantBtn');
 if (addVariantBtn) {
     addVariantBtn.addEventListener('click', () => {
         if (!selectedVariant || !selectedItemForVariant) return;
         
         const item = {
             ...selectedItemForVariant,
             price: selectedVariant.price,
             variant: selectedVariant.name,
             // 🔥 السطر السحري: بناخد أسعار التوصيل الخاصة بالمتغير ونرفقها معاه في السلة
             aggregatorPrices: selectedVariant.aggregatorPrices || {}
         };
         
         addToCart(item);
         document.getElementById('variantModal').classList.remove('active');
     });
 }

// Add to Cart Logic
function addToCart(item) {
    try {
        if (!item) return;
        if (!cart) cart = [];
        
        const existingItem = cart.find(c => c.id === item.id && c.variant === (item.variant || ''));
        
        if (existingItem) {
            existingItem.quantity++;
        } else {
            let basePrice = Utils.roundToTwoDecimals(item.price || 0);
            let currentEffectivePrice = basePrice;

            // لو الكاشير مختار شركة توصيل حالياً، طبق سعرها على المنتج فوراً قبل ما ينزل السلة
            if (orderType === 'aggregator' && activeAggregator) {
                const aggName = activeAggregator.companyName || activeAggregator.name || activeAggregator.title || activeAggregator.en_name || activeAggregator.ar_name || 'شركة غير معروفة';
                if (item.aggregatorPrices && item.aggregatorPrices[aggName]) {
                    currentEffectivePrice = parseFloat(item.aggregatorPrices[aggName]);
                }
            }

            cart.push({
                ...item,
                price: currentEffectivePrice,
                originalPrice: basePrice, // 👈 بنحفظ السعر الأصلي هنا عشان نقدر نرجعه لو لغينا التوصيل
                quantity: item.quantity || 1,
                variant: item.variant || ''
            });
        }
        
        updateCart();
        // فيدباك خفيف بدون notification ثقيلة — الكارت بيتحدث فوراً
        _flashCartBadge();
    } catch (e) {
        console.error('Error in addToCart:', e);
    }
}

// وميض سريع على عداد السلة بدل notification
function _flashCartBadge() {
    try {
        const badge = document.getElementById('cartItemCount') || document.querySelector('.cart-count');
        if (!badge) return;
        badge.style.transform = 'scale(1.4)';
        badge.style.transition = 'transform 0.15s ease';
        setTimeout(() => { badge.style.transform = 'scale(1)'; }, 150);
    } catch(e) {}
}
// Make addToCart globally accessible
window.addToCart = addToCart;

// Update Cart UI
window.updateCart = function() {
    const cartItems = document.getElementById('cartItems');
    const cartSummary = document.getElementById('cartSummary');
    const orderTypeSelection = document.getElementById('orderTypeSelection');
    const aggregatorMarkupRow = document.getElementById('aggregatorMarkupRow');
    const aggregatorMarkupLabel = document.getElementById('aggregatorMarkupLabel');
    const aggregatorMarkupDisplay = document.getElementById('aggregatorMarkupDisplay');

    if (!cartItems || !cartSummary) return;
    
    if (cart.length === 0) {
        cartItems.innerHTML = '<div class="empty-state">السلة فارغة</div>';
        cartSummary.style.display = 'none';
        if (orderTypeSelection) orderTypeSelection.style.display = 'none';
        return;
    }
    
    if (orderTypeSelection) orderTypeSelection.style.display = 'block';
    
    cartItems.innerHTML = cart.map((item, index) => `
        <div class="cart-item">
            <div class="cart-item-header">
                <div class="cart-item-name">${item.name}${item.variant ? ` (${item.variant})` : ''}</div>
                <button class="cart-item-remove" onclick="removeFromCart(${index})">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="cart-item-footer">
                <div class="cart-item-quantity">
                    <button class="quantity-btn" onclick="updateQuantity(${index}, -1)">-</button>
                    <span class="quantity-value">${item.quantity}</span>
                    <button class="quantity-btn" onclick="updateQuantity(${index}, 1)">+</button>
                </div>
                <div class="cart-item-price">${Utils.formatCurrency(item.price * item.quantity)}</div>
            </div>
        </div>
    `).join('');
    
    // 💡 الحسبة بقت نظيفة ومباشرة بتعتمد على سعر المنتج الجديد
    const subtotal = cart.reduce((sum, item) => sum + (parseFloat(item.price) * item.quantity), 0);
    
    let discount = window.orderGlobalDiscount || 0;
    let surcharge = window.orderGlobalSurcharge || 0;
    if (discount > subtotal) discount = subtotal;
    
    let markupAmount = activeAggregator ? Utils.roundToTwoDecimals(subtotal * (activeAggregator.menuMarkupPercentage / 100)) : 0;

    if (markupAmount > 0 && activeAggregator) {
        aggregatorMarkupRow.style.display = 'flex';
        const aggNameDisplay = activeAggregator.companyName || activeAggregator.name || activeAggregator.title || 'شركة توصيل';
        aggregatorMarkupLabel.textContent = `زيادة أسعار (${aggNameDisplay})`;
        aggregatorMarkupDisplay.textContent = `+${markupAmount.toFixed(2)} ج.م`;
    } else {
        aggregatorMarkupRow.style.display = 'none';
    }

    const deliveryFeeInput = document.getElementById('deliveryFee');
    let deliveryFee = 0;
    if (deliveryFeeInput && orderType === 'delivery') {
        deliveryFee = Utils.roundToTwoDecimals(parseFloat(deliveryFeeInput.value) || 0);
    }
    
    const taxServiceSettings = _getTaxSettings();
    const taxRate = taxServiceSettings.taxRate != null ? parseFloat(taxServiceSettings.taxRate) : 0;
    const serviceChargeRate = taxServiceSettings.serviceChargeRate != null ? parseFloat(taxServiceSettings.serviceChargeRate) : 0;
    
    const netSubtotal = Utils.roundToTwoDecimals(subtotal + markupAmount + surcharge - discount);
    const taxAmount = Utils.roundToTwoDecimals(taxRate > 0 ? (subtotal - discount) * (taxRate / 100) : 0);
    
    let serviceChargeAmount = 0;
    if (orderType === 'dinein' && serviceChargeRate > 0) {
        serviceChargeAmount = Utils.roundToTwoDecimals((subtotal - discount) * (serviceChargeRate / 100));
    }
    
    const total = Utils.roundToTwoDecimals(netSubtotal + serviceChargeAmount + taxAmount + deliveryFee);

    if (orderType === 'delivery') {
        const deliveryFeeDisplay = document.getElementById('deliveryFeeDisplay');
        if (deliveryFeeDisplay) deliveryFeeDisplay.textContent = Utils.formatCurrency(deliveryFee);
        const deliveryFeeRow = document.getElementById('deliveryFeeRow');
        if (deliveryFeeRow) deliveryFeeRow.style.display = 'flex';
    }
    
    const subtotalEl = document.getElementById('subtotal');
    if(subtotalEl) subtotalEl.textContent = Utils.formatCurrency(subtotal);

    const discountEl = document.getElementById('discount');
    const discountRow = document.getElementById('discountRow');
    const totalEl = document.getElementById('total');
    
    if (discountEl) {
        discountEl.textContent = `-${Utils.formatCurrency(discount)}`;
    }
    if (discountRow) {
        discountRow.style.display = discount > 0 ? 'flex' : 'none';
    }

    const surchargeRow = document.getElementById('surchargeRow');
    const surchargeDisplay = document.getElementById('surchargeDisplay');
    if (surchargeRow && surchargeDisplay) {
        surchargeRow.style.display = surcharge > 0 ? 'flex' : 'none';
        surchargeDisplay.textContent = `+${Utils.formatCurrency(surcharge)}`;
    }

    if (totalEl) totalEl.textContent = Utils.formatCurrency(total);
    cartSummary.style.display = 'block';
};
// Remove from Cart (Global for onclick)
window.removeFromCart = function(index) {
    cart.splice(index, 1);
    updateCart();
};

// Update Quantity (Global for onclick)
window.updateQuantity = function(index, change) {
    cart[index].quantity += change;
    if (cart[index].quantity <= 0) {
        removeFromCart(index);
    } else {
        updateCart();
    }
};

// Hold Cart
const holdCartBtn = document.getElementById('holdCartBtn');
if (holdCartBtn) {
    holdCartBtn.addEventListener('click', async () => {
        if (cart.length === 0) return;
        
        // إنشاء التاريخ والوقت بالتوقيت المحلي للجهاز
        const nowHold = new Date();
        const localDateStrHold = DataManager.getEgyptDate(); // YYYY-MM-DD
        const localTimeStrHold = nowHold.toLocaleTimeString('en-US', { hour12: false }); // HH:mm:ss
        const localDateTimeHold = `${localDateStrHold}T${localTimeStrHold}`;
        
        // الحصول على رقم الطاولة إذا كان النوع Dine In
        const tableNumberInputHold = document.getElementById('tableNumber');
        const tableNumberHold = (orderType === 'dinein' && tableNumberInputHold) ? tableNumberInputHold.value : null;
        
        const order = {
            id: 'HOLD-' + Date.now(),
            items: cart.map(item => ({...item})),
            date: localDateTimeHold,
            status: 'on-hold',
            orderType: orderType,
            deliveryInfo: deliveryInfo,
            cashier: Auth ? Auth.getUsername() : (localStorage.getItem('username') || 'المستخدم'),
            createdBy: Auth ? Auth.getUsername() : (localStorage.getItem('username') || 'المستخدم'),
            // إضافة رقم الطاولة للطلبات Dine In
            tableNumber: tableNumberHold || undefined
        };
        
        await DataManager.saveOrderOnHold(order);
        cart = [];
        window.orderGlobalDiscount = 0; 
        window.orderGlobalSurcharge = 0; 
        orderType = 'takeaway';
        deliveryInfo = null;
        deliveryFee = 0;
        activeAggregator = null;
        
        const deliveryFeeInput = document.getElementById('deliveryFee');
        if (deliveryFeeInput) deliveryFeeInput.value = '0';
        
        updateCart();
        setTimeout(async () => await initDashboard(), 100);
        
        const takeawayBtn = document.getElementById('takeawayBtn');
        const deliveryBtn = document.getElementById('deliveryBtn');
        const deliveryFeeInputDiv = document.getElementById('deliveryFeeInput');
        const deliveryFeeRow = document.getElementById('deliveryFeeRow');
        
        if (takeawayBtn && deliveryBtn) {
            takeawayBtn.classList.add('active');
            takeawayBtn.style.background = 'var(--color-text-dark)';
            takeawayBtn.style.color = 'var(--color-white)';
            takeawayBtn.style.borderColor = 'var(--color-text-dark)';
            deliveryBtn.classList.remove('active');
            deliveryBtn.style.background = 'var(--color-white)';
            deliveryBtn.style.color = 'var(--color-text-dark)';
            deliveryBtn.style.borderColor = 'var(--color-separator)';
        }
        
        if (deliveryFeeInputDiv) deliveryFeeInputDiv.style.display = 'none';
        if (deliveryFeeRow) deliveryFeeRow.style.display = 'none';
        
        if (typeof Notification !== 'undefined') {
            Notification.success('تم تعليق الطلب');
        }
    });
}

// Proceed Order Logic
window.handleProceedOrder = async function() { 
     const DM = typeof DataManager !== 'undefined' ? DataManager : window.DataManager; 
     if (!DM) { 
         if (typeof Notification !== 'undefined') Notification.error('خطأ في تحميل النظام. حدّث الصفحة.'); 
         return; 
     } 
     
     const now = Date.now(); 
     if (now - lastProceedClickTime < 500) return; 
     lastProceedClickTime = now; 
     
     if (isProcessingOrder) return; 
     
     if (cart.length === 0) { 
         if (typeof Notification !== 'undefined') Notification.error('السلة فارغة'); 
         else alert('السلة فارغة'); 
         return; 
     } 
 
     // التأكد من فتح الشيفت 
     if (typeof DataManager !== 'undefined') { 
         let todaySession = await DataManager.getTodayCashSession(); 
         if (!todaySession || todaySession.status !== 'open') { 
              if (typeof Notification !== 'undefined') Notification.error('يجب فتح شيفت نقدي أولاً قبل إنشاء الطلبات'); 
              return; 
         } 
     } 
     
     isProcessingOrder = true; 
     
     const proceedBtn = document.getElementById('proceedBtn'); 
     if (proceedBtn) { 
         proceedBtn.disabled = true; 
         proceedBtn.style.opacity = '0.6'; 
         proceedBtn.style.cursor = 'not-allowed'; 
     } 
     
     // 🌟 التعامل مع الدليفري (إرجاع البوب-أب عشان التأكيد) 
     if (orderType === 'delivery') { 
         showDeliveryModal(); 
         setTimeout(() => { 
             const modal = document.getElementById('deliveryInfoModal'); 
             if (modal && !modal.classList.contains('active')) { 
                 isProcessingOrder = false; 
                 if (proceedBtn) { 
                     proceedBtn.disabled = false; 
                     proceedBtn.style.opacity = '1'; 
                     proceedBtn.style.cursor = 'pointer'; 
                 } 
             } 
         }, 100); 
         return; 
     } 
     
     // 🌟 التعامل مع الصالة والتيك أواي 
     showCheckoutModal(); 
 };

window.showDeliveryModal = function() { 
     const modal = document.getElementById('deliveryInfoModal'); 
     if (modal) { 
         // 🚀 ملء بيانات العميل تلقائياً لو موجود 
         if (window.currentOrderCustomer) { 
             const phoneInput = document.getElementById('deliveryPhone'); 
             const addressInput = document.getElementById('deliveryAddress'); 
             const nameInput = document.getElementById('deliveryName'); // 👈 عرفنا خانة الاسم 
 
             if (phoneInput) phoneInput.value = window.currentOrderCustomer.phone || ''; 
             if (addressInput) addressInput.value = window.currentOrderCustomer.address || ''; 
             if (nameInput) nameInput.value = window.currentOrderCustomer.name || ''; // 👈 رمينا الاسم جواه 
         } else { 
             // لو مفيش عميل، نتأكد إن الفورم فاضية تماماً 
             const form = document.getElementById('deliveryForm'); 
             if (form) form.reset(); 
         } 
 
         modal.classList.add('active'); 
         modal.style.display = 'flex'; 
     } 
 };

window.closeDeliveryModal = function() {
    const modal = document.getElementById('deliveryInfoModal');
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
    }
    document.getElementById('deliveryForm').reset();
    if (isProcessingOrder && cart.length > 0) {
        isProcessingOrder = false;
        const proceedBtn = document.getElementById('proceedBtn');
        if (proceedBtn) {
            proceedBtn.disabled = false;
            proceedBtn.style.opacity = '1';
            proceedBtn.style.cursor = 'pointer';
        }
    }
};

window.handleDeliverySubmit = async function(event) { 
     event.preventDefault(); 
     
     const todaySession = await DataManager.getTodayCashSession(); 
     if (!todaySession || todaySession.status !== 'open') { 
         isProcessingOrder = false; 
         const proceedBtn = document.getElementById('proceedBtn'); 
         if (proceedBtn) { proceedBtn.disabled = false; proceedBtn.style.opacity = '1'; proceedBtn.style.cursor = 'pointer'; } 
         closeDeliveryModal(); 
         if (typeof Notification !== 'undefined') Notification.error('يجب فتح شيفت نقدي أولاً قبل إنشاء الطلبات'); 
         else alert('يجب فتح شيفت نقدي أولاً قبل إنشاء الطلبات'); 
         return; 
     } 
     
     if (cart.length === 0) { 
         closeDeliveryModal(); 
         return; 
     } 
     
     const phone = document.getElementById('deliveryPhone').value; 
     const address = document.getElementById('deliveryAddress').value; 
     
     // 🔥 سحب اسم العميل (من الخانة الجديدة أو من المتسجل) 
      let custName = ''; 
      const nameInput = document.getElementById('deliveryName'); 
      
      if (nameInput && nameInput.value.trim() !== '') { 
          custName = nameInput.value.trim(); // لو الكاشير كتبه أو عدله بإيده 
      } else if (window.currentOrderCustomer && window.currentOrderCustomer.name) { 
          custName = window.currentOrderCustomer.name; // الاحتياطي من الداتا 
      } 
     
     if (!phone || !address) { 
         if (typeof Notification !== 'undefined') Notification.error('يرجى إدخال جميع البيانات المطلوبة'); 
         else alert('يرجى إدخال جميع البيانات المطلوبة'); 
         return; 
     } 
     
     // حفظ الاسم في أوبجكت الدليفري 
     deliveryInfo = { phone, address, customerName: custName }; 
     closeDeliveryModal(); 
     processOrder(); 
 };

// Decrease stock for order items
async function decreaseStockForOrder(orderItems) {
    try {
        let menuItems = [];
        const firstRunCompleted = localStorage.getItem('first_run_completed');
        if (localStorage.getItem('menuItems')) {
            try {
                menuItems = JSON.parse(localStorage.getItem('menuItems'));
            } catch (e) {
                console.error('Error parsing menuItems:', e);
                menuItems = [];
            }
        } else {
            // إذا كان أول تشغيل تم، نستخدم مصفوفة فارغة بدلاً من البيانات الافتراضية
            menuItems = [];
        }
        
        orderItems.forEach(orderItem => {
            const menuItem = menuItems.find(item => item.id === orderItem.id);
            if (!menuItem) {
                return;
            }
            
            const itemType = menuItem.type || 'physical';
            if (itemType === 'service') {
                return; // Service items don't have stock
            }
            
            const quantity = orderItem.quantity || 1;
            const currentStock = menuItem.stock || 0;
            const newStock = Math.max(0, currentStock - quantity);

            menuItem.stock = newStock;
        });
        
        // Save updated menuItems to localStorage
        localStorage.setItem('menuItems', JSON.stringify(menuItems));
        
        // Refresh menu display in index.html
        if (typeof initMenu === 'function') {
            initMenu();
        }
        
        // Trigger event to update menu.html if it's open
        const event = new Event('menuItemsUpdated');
        window.dispatchEvent(event);
    } catch (e) {
        console.error('Error decreasing stock:', e);
    }
}

// Decrease ingredients stock based on recipes for the order items
async function decreaseIngredientsStockForOrder(orderItems) {
    try {
        if (!Array.isArray(orderItems) || orderItems.length === 0) {
            return;
        }

        const canUseFirebaseIngredients =
            typeof window !== 'undefined' &&
            navigator.onLine &&
            window.FirestoreService &&
            typeof window.FirestoreService.updateStock === 'function';

        const canFetchFirebaseIngredients =
            typeof window !== 'undefined' &&
            navigator.onLine &&
            window.FirestoreService &&
            typeof window.FirestoreService.getAllIngredients === 'function';

        // Load ingredients (local mirror first)
        let ingredients = [];
        if (localStorage.getItem('ingredients')) {
            try {
                ingredients = JSON.parse(localStorage.getItem('ingredients')) || [];
            } catch (e) {
                console.error('Error parsing ingredients:', e);
                ingredients = [];
            }
        }

        // Mixed mode: if local mirror is empty, fetch from Firebase so we can both
        // decrement Firestore and keep a local mirror for reports/offline.
        if ((!ingredients || ingredients.length === 0) && canFetchFirebaseIngredients) {
            try {
                const fbIngredients = await window.FirestoreService.getAllIngredients();
                ingredients = (fbIngredients || []).map((ing) => {
                    const qty = Number(ing.current_stock ?? ing.stock ?? ing.quantity ?? 0) || 0;
                    return {
                        ...ing,
                        id: ing.id,
                        // local-compatible fields
                        stock: qty,
                        quantity: qty,
                        current_stock: qty
                    };
                });
                localStorage.setItem('ingredients', JSON.stringify(ingredients));
            } catch (e) {
                console.warn('Could not fetch ingredients from Firebase:', e);
            }
        }

        // If we still have no ingredients locally, we can still try Firestore decrements
        // (but local UI won't reflect until next sync/mirror refresh).

        // Load menu items to resolve recipes (source of truth)
        let menuItems = [];
        if (localStorage.getItem('menuItems')) {
            try {
                menuItems = JSON.parse(localStorage.getItem('menuItems')) || [];
            } catch (e) {
                console.error('Error parsing menuItems in decreaseIngredientsStockForOrder:', e);
                menuItems = [];
            }
        }

        // Aggregate consumption per ingredient id
        const consumptionByIngredientId = new Map();

        orderItems.forEach(orderItem => {
            if (!orderItem) return;

            const quantity = orderItem.quantity || 1;

            // Try to find matching menuItem by id first, then by name
            let menuItem = null;
            if (menuItems && menuItems.length > 0) {
                menuItem = menuItems.find(item => item.id === orderItem.id) ||
                           menuItems.find(item => item.name === orderItem.name);
            }

            // Fallback: use recipe info from orderItem itself (variants array) if menuItem not found
            let recipe = null;

            if (menuItem) {
                if (menuItem.variants && menuItem.variants.length > 0 && orderItem.variant) {
                    const variant = menuItem.variants.find(v => v.name === orderItem.variant);
                    if (variant && Array.isArray(variant.recipe)) {
                        recipe = variant.recipe;
                    }
                }

                // If no variant recipe, try main recipe on menuItem
                if (!recipe && Array.isArray(menuItem.recipe)) {
                    recipe = menuItem.recipe;
                }
            }

            // If still no recipe, inspect orderItem.variants as last resort
            if (!recipe && orderItem.variants && orderItem.variants.length > 0 && orderItem.variant) {
                const variantFromOrder = orderItem.variants.find(v => v.name === orderItem.variant);
                if (variantFromOrder && Array.isArray(variantFromOrder.recipe)) {
                    recipe = variantFromOrder.recipe;
                }
            }

            if (!recipe || !Array.isArray(recipe) || recipe.length === 0) {
                return;
            }

            recipe.forEach(recipeItem => {
                if (!recipeItem) return;

                const ingredientId = recipeItem.ingredientId ?? recipeItem.ingredient_id;
                const recipeQuantity = parseFloat(recipeItem.quantity) || 0;
                if (!ingredientId || recipeQuantity <= 0) return;
                const totalToConsume = recipeQuantity * quantity;
                const key = String(ingredientId);
                consumptionByIngredientId.set(key, (consumptionByIngredientId.get(key) || 0) + totalToConsume);
            });
        });

        // 1) Decrement in Firebase (source of truth in mixed/online mode)
        if (canUseFirebaseIngredients && consumptionByIngredientId.size > 0) {
            for (const [ingredientId, qty] of consumptionByIngredientId.entries()) {
                try {
                    await window.FirestoreService.updateStock(String(ingredientId), -Number(qty || 0));
                } catch (e) {
                    console.warn('Failed to decrement ingredient stock in Firebase:', ingredientId, e);
                }
            }
        }

        // 2) Update local mirror for reports/offline continuity
        if (Array.isArray(ingredients) && ingredients.length > 0 && consumptionByIngredientId.size > 0) {
            for (const [ingredientId, qty] of consumptionByIngredientId.entries()) {
                const ingredient = ingredients.find(ing => String(ing.id) === String(ingredientId));
                if (!ingredient) continue;

                const consume = Number(qty || 0) || 0;
                const currentStock = parseFloat(ingredient.stock ?? ingredient.quantity ?? ingredient.current_stock) || 0;
                const newStock = Math.max(0, currentStock - consume);

                ingredient.stock = newStock;
                ingredient.quantity = newStock;
                ingredient.current_stock = newStock;
            }
            localStorage.setItem('ingredients', JSON.stringify(ingredients));
        }
    } catch (e) {
        console.error('Error decreasing ingredients stock:', e);
    }
}




async function processOrder(paymentMethod = 'cash') {
    try {
        const todaySession = await DataManager.getTodayCashSession();
        if (!todaySession || todaySession.status !== 'open') {
            isProcessingOrder = false;
            const proceedBtn = document.getElementById('proceedBtn');
            if (proceedBtn) {
                proceedBtn.disabled = false;
                proceedBtn.style.opacity = '1';
                proceedBtn.style.cursor = 'pointer';
            }
            if (typeof Notification !== 'undefined') Notification.error('يجب فتح شيفت نقدي أولاً قبل إنشاء الطلبات');
            else alert('يجب فتح شيفت نقدي أولاً قبل إنشاء الطلبات');
            return;
        }
        
        if (cart.length === 0) {
            isProcessingOrder = false;
            const proceedBtn = document.getElementById('proceedBtn');
            if (proceedBtn) { proceedBtn.disabled = false; proceedBtn.style.opacity = '1'; proceedBtn.style.cursor = 'pointer'; }
            return;
        }
        
        const baseSubtotal = cart.reduce((sum, item) => sum + ((item._originalPrice || item.price) * item.quantity), 0);
        const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        // خصومات الأصناف (لما الخصم بيتطبق على صنف بعينه)
        const itemLevelDiscounts = cart.reduce((sum, item) => {
            if (item._originalPrice && item._originalPrice > item.price) {
                return sum + Utils.roundToTwoDecimals((item._originalPrice - item.price) * item.quantity);
            }
            return sum;
        }, 0);

        let discount = Utils.roundToTwoDecimals((window.orderGlobalDiscount || 0) + itemLevelDiscounts);
        let surcharge = window.orderGlobalSurcharge || 0;
        if (discount > baseSubtotal) discount = baseSubtotal;

        const markupAmount = activeAggregator ? Utils.roundToTwoDecimals(baseSubtotal * (activeAggregator.menuMarkupPercentage / 100)) : 0; 
        const deliveryFeeInputEl = document.getElementById('deliveryFee'); 
        let deliveryFee = 0; 
        if (deliveryFeeInputEl && orderType === 'delivery') { 
            deliveryFee = Utils.roundToTwoDecimals(parseFloat(deliveryFeeInputEl.value) || 0); 
        } 
     
        const taxServiceSettings = JSON.parse(localStorage.getItem('taxServiceSettings') || '{}'); 
        const taxRate = parseFloat(taxServiceSettings.taxRate) || 0; 
        const serviceChargeRate = parseFloat(taxServiceSettings.serviceChargeRate) || 0; 
        const taxId = taxServiceSettings.taxId || ''; 
        const taxAmount = Utils.roundToTwoDecimals(taxRate > 0 ? (baseSubtotal - discount + surcharge) * (taxRate / 100) : 0);
        let serviceChargeAmount = 0;
        if (orderType === 'dinein' && serviceChargeRate > 0) {
            serviceChargeAmount = Utils.roundToTwoDecimals((baseSubtotal - discount + surcharge) * (serviceChargeRate / 100));
        }

        const orderTotal = Utils.roundToTwoDecimals(baseSubtotal + markupAmount + surcharge - discount + serviceChargeAmount + taxAmount + deliveryFee);
        const netSubtotal = Utils.roundToTwoDecimals(baseSubtotal + markupAmount + surcharge - discount); 
        const cartItemsCopy = cart.map(item => ({...item}));
        
        const now = new Date();
        const localDateStr = DataManager.getEgyptDate();
        const localTimeStr = now.toLocaleTimeString('en-US', { hour12: false });
        const localDateTime = `${localDateStr}T${localTimeStr}`;
        const tableNumberInput = document.getElementById('tableNumber');
        const tableNumber = (orderType === 'dinein' && tableNumberInput) ? tableNumberInput.value : null;
        const businessDate = DataManager.getBusinessDate();
        
        const order = {
            id: 'ORD' + String(Date.now()).slice(-6),
            items: cartItemsCopy,
            date: localDateTime,
            businessDate: businessDate,
            status: 'completed',
            total: Utils.roundToTwoDecimals(orderTotal),
            subtotal: Utils.roundToTwoDecimals(netSubtotal),
            originalSubtotal: Utils.roundToTwoDecimals(baseSubtotal),
            deliveryFee: Utils.roundToTwoDecimals(deliveryFee),
            discount: Utils.roundToTwoDecimals(discount),
            surcharge: window.orderGlobalSurcharge || 0,
            orderType: orderType,
            deliveryInfo: deliveryInfo,
            cashier: Auth ? Auth.getUsername() : (localStorage.getItem('username') || 'المستخدم'),
            createdBy: Auth ? Auth.getUsername() : (localStorage.getItem('username') || 'المستخدم'),
            paymentMethod: paymentMethod || 'cash',
            payment_method: paymentMethod || 'cash',
            tax: Utils.roundToTwoDecimals(taxAmount),
            serviceCharge: Utils.roundToTwoDecimals(serviceChargeAmount),
            taxId: taxId,
            tableNumber: tableNumber || undefined,
            shift_id: todaySession.id || null,
            orderSource: activeAggregator ? activeAggregator.companyName : 'direct',
            aggregatorMarkup: markupAmount,
            expectedCommission: activeAggregator ? Utils.roundToTwoDecimals(orderTotal * (activeAggregator.commissionPercentage / 100)) : 0,
        };

        // ── الأوردر والبيع — لازم await عشان الـ ID يتولد ──
        await DataManager.saveOrder(order);

        await DataManager.saveSale({
            id: 'SALE-' + order.id,
            orderId: order.id,
            amount: Utils.roundToTwoDecimals(orderTotal),
            date: now.toISOString(),
            businessDate: businessDate
        });

        // ── المخزون والنقاط — في الخلفية عشان متأخرش الـ UI ──
        Promise.all([
            decreaseStockForOrder(order.items).catch(e => console.warn('stock err', e)),
            decreaseIngredientsStockForOrder(order.items).catch(e => console.warn('ing err', e)),
        ]);

        // ── تحديث نقاط العميل في الخلفية (لا await) ──
        if (window.currentOrderCustomer && window.FirestoreService) {
            (async () => {
                try {
                    const phone = window.currentOrderCustomer.phone;
                    const dbCustomer = await window.FirestoreService.getCustomerByPhone(phone);
                    if (!dbCustomer) return;
                    const loyalty = await _loadLoyaltySettings();
                    const egpPerPoint = parseInt(loyalty.egpPerPoint) || 10;
                    const silverTier = parseInt(loyalty.silver)    || 100;
                    const goldTier   = parseInt(loyalty.gold)      || 500;
                    const vipTier    = parseInt(loyalty.vip)       || 1000;
                    const newPoints  = Math.floor(orderTotal / egpPerPoint);
                    const updatedData = {
                        ...dbCustomer,
                        ordersCount:     (dbCustomer.ordersCount  || 0) + 1,
                        points:          (dbCustomer.points       || 0) + newPoints,
                        totalSpent:      (dbCustomer.totalSpent   || 0) + orderTotal,
                        lastOrderDate:   new Date().toISOString(),
                        lastOrderAmount: orderTotal,
                    };
                    if      (updatedData.points >= vipTier)    updatedData.tier = 'vip';
                    else if (updatedData.points >= goldTier)   updatedData.tier = 'gold';
                    else if (updatedData.points >= silverTier) updatedData.tier = 'silver';
                    await window.FirestoreService.saveCustomer(updatedData);
                    console.log(`✅ نقاط العميل: +${newPoints}`);
                } catch (err) { console.error('loyalty err', err); }
            })();
        }

        // ==========================================
        // 🌟 2. مسح العميل من السلة غصب عن السيستم 🌟
        // ==========================================
        if (typeof clearCartCustomer === 'function') {
            clearCartCustomer();
        } else {
            window.currentOrderCustomer = null;
            const activeState = document.getElementById('activeCustomerState');
            const searchState = document.getElementById('searchCustomerState');
            const phoneSearch = document.getElementById('quickPhoneSearch');
            if (activeState) activeState.style.display = 'none';
            if (searchState) searchState.style.display = 'flex';
            if (phoneSearch) phoneSearch.value = '';
        }

        // Print receipt (مع التحقق من حالة زرار الطباعة الجديد)
        const printToggle = document.getElementById('printReceiptToggle');
        const shouldPrint = printToggle ? printToggle.checked : true;
        
        if (shouldPrint && typeof Utils !== 'undefined' && Utils.printInvoice) {
            setTimeout(() => { Utils.printInvoice(order); }, 300);
        }
        
        if (typeof Notification !== 'undefined') {
            Notification.success(`تم إتمام الطلب بنجاح! رقم الطلب: ${order.id} - الإجمالي: ${Utils.formatCurrency(orderTotal)}`);
        } else {
            alert(`تم إتمام الطلب بنجاح!\nرقم الطلب: ${order.id}\nالإجمالي: ${Utils.formatCurrency(orderTotal)}`);
        }

        // 🚀 إغلاق النوافذ المفتوحة بعد النجاح
        if (typeof closeCheckoutModal === 'function') closeCheckoutModal();
        if (typeof closeDeliveryModal === 'function') closeDeliveryModal();
        
        cart = [];
        window.orderGlobalDiscount = 0; 
        window.orderGlobalSurcharge = 0; 
        orderType = 'takeaway';
        deliveryInfo = null;
        deliveryFee = 0;
        activeAggregator = null; 
        if (deliveryFeeInputEl) deliveryFeeInputEl.value = '0';
        
        const tableNumberInputEl = document.getElementById('tableNumber');
        if (tableNumberInputEl) tableNumberInputEl.value = '';
        const tableNumberInputDiv = document.getElementById('tableNumberInput');
        if (tableNumberInputDiv) tableNumberInputDiv.style.display = 'none';
        
        const discountInputReset = document.getElementById('discountInputField');
        if (discountInputReset) discountInputReset.value = '0';
        
        updateCart();
        await initDashboard();
        
        const takeawayBtn = document.getElementById('takeawayBtn');
        const deliveryBtn = document.getElementById('deliveryBtn');
        const dineinBtnReset = document.getElementById('dineinBtn');
        const deliveryFeeInputDiv = document.getElementById('deliveryFeeInput');
        const deliveryFeeRow = document.getElementById('deliveryFeeRow');
        const tableNumberInputDivReset = document.getElementById('tableNumberInput');
        
        if (takeawayBtn && deliveryBtn && dineinBtnReset) {
            takeawayBtn.classList.add('active'); takeawayBtn.style.background = 'var(--color-text-dark)'; takeawayBtn.style.color = 'var(--color-white)'; takeawayBtn.style.borderColor = 'var(--color-text-dark)';
            deliveryBtn.classList.remove('active'); deliveryBtn.style.background = 'var(--color-white)'; deliveryBtn.style.color = 'var(--color-text-dark)'; deliveryBtn.style.borderColor = 'var(--color-separator)';
            dineinBtnReset.classList.remove('active'); dineinBtnReset.style.background = 'var(--color-white)'; dineinBtnReset.style.color = 'var(--color-text-dark)'; dineinBtnReset.style.borderColor = 'var(--color-separator)';
        }
        
        document.querySelectorAll('.aggregator-btn').forEach(btn => {
            btn.classList.remove('active'); btn.style.background = 'var(--color-white)'; btn.style.color = 'var(--color-text-dark)'; btn.style.borderColor = 'var(--color-separator)';
        });

        if (deliveryFeeInputDiv) deliveryFeeInputDiv.style.display = 'none';
        if (deliveryFeeRow) deliveryFeeRow.style.display = 'none';
        if (tableNumberInputDivReset) tableNumberInputDivReset.style.display = 'none';
        
        isProcessingOrder = false;
        const proceedBtn = document.getElementById('proceedBtn');
        if (proceedBtn) { proceedBtn.disabled = false; proceedBtn.style.opacity = '1'; proceedBtn.style.cursor = 'pointer'; }
        
        setTimeout(async () => await initDashboard(), 500);
        
    } catch (error) {
        console.error('Error processing order:', error);
        isProcessingOrder = false;
        const proceedBtn = document.getElementById('proceedBtn');
        if (proceedBtn) { proceedBtn.disabled = false; proceedBtn.style.opacity = '1'; proceedBtn.style.cursor = 'pointer'; }
        alert('حدث خطأ أثناء معالجة الطلب: ' + error.message);
    }
}
function initProceedBtn() {
    const proceedBtn = document.getElementById('proceedBtn');
    if (!proceedBtn) {
        setTimeout(initProceedBtn, 100);
        return;
    }
    const newProceedBtn = proceedBtn.cloneNode(true);
    proceedBtn.parentNode.replaceChild(newProceedBtn, proceedBtn);
    newProceedBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (isProcessingOrder || cart.length === 0) return;
        handleProceedOrder();
    });
}

// Checkout Modal Logic
window.showCheckoutModal = function() { 
     const modal = document.getElementById('checkout-modal'); 
     if (!modal) return; 
     
     const baseSubtotal = cart.reduce((sum, item) => sum + ((item._originalPrice || item.price) * item.quantity), 0);
     const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
     const _itemDisc2 = cart.reduce((sum, item) => item._originalPrice && item._originalPrice > item.price ? sum + Utils.roundToTwoDecimals((item._originalPrice - item.price) * item.quantity) : sum, 0);
     let discount = Utils.roundToTwoDecimals((window.orderGlobalDiscount || 0) + _itemDisc2);
     let surcharge = window.orderGlobalSurcharge || 0;
     if (discount > baseSubtotal) discount = baseSubtotal;
 const deliveryFeeInput = document.getElementById('deliveryFee');
 let deliveryFee = 0;
 if (deliveryFeeInput && orderType === 'delivery') {
     deliveryFee = Utils.roundToTwoDecimals(parseFloat(deliveryFeeInput.value) || 0);
 }
 const markupAmount = activeAggregator ? Utils.roundToTwoDecimals(baseSubtotal * (activeAggregator.menuMarkupPercentage / 100)) : 0;

 const taxServiceSettings = JSON.parse(localStorage.getItem('taxServiceSettings') || '{}');
 const taxRate = parseFloat(taxServiceSettings.taxRate) || 0;
 const serviceChargeRate = parseFloat(taxServiceSettings.serviceChargeRate) || 0;

 const taxAmount = taxRate > 0 ? (baseSubtotal - discount + surcharge) * (taxRate / 100) : 0;
 let serviceChargeAmount = 0;
 if (orderType === 'dinein' && serviceChargeRate > 0) {
     serviceChargeAmount = (baseSubtotal - discount + surcharge) * (serviceChargeRate / 100);
 }

 const total = baseSubtotal + markupAmount + surcharge - discount + serviceChargeAmount + taxAmount + deliveryFee; 
 const totalAmountEl = document.getElementById('checkoutTotalAmount'); 
 if (totalAmountEl) { 
 totalAmountEl.textContent = Utils.formatCurrency(total); 
 } 
 
 modal.style.display = 'flex'; 
 modal.classList.add('active'); 
 
 
 };

window.closeCheckoutModal = function() {
    const modal = document.getElementById('checkout-modal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
    }
    
    // Re-enable proceed button
    isProcessingOrder = false;
    const proceedBtn = document.getElementById('proceedBtn');
    if (proceedBtn) {
        proceedBtn.disabled = false;
        proceedBtn.style.opacity = '1';
        proceedBtn.style.cursor = 'pointer';
    }
};

window.completePayment = async function(paymentMethod) {
    // Close checkout modal
    closeCheckoutModal();
    
    // Set payment method and process order
    window.currentPaymentMethod = paymentMethod;
    await processOrder(paymentMethod);
};

// Checkout Modal Logic


window.closeCheckoutModal = function() {
    const modal = document.getElementById('checkout-modal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
    }
    
    // Re-enable proceed button
    isProcessingOrder = false;
    const proceedBtn = document.getElementById('proceedBtn');
    if (proceedBtn) {
        proceedBtn.disabled = false;
        proceedBtn.style.opacity = '1';
        proceedBtn.style.cursor = 'pointer';
    }
};

window.completePayment = async function(paymentMethod) {
    // Close checkout modal
    closeCheckoutModal();
    
    // Set payment method and process order
    window.currentPaymentMethod = paymentMethod;
    await processOrder(paymentMethod);
};

// Payment Modal Logic
window.showPaymentSuccessModal = function(order, total) {
    const modal = document.getElementById('paymentSuccessModal');
    if (!modal) return;
    
    const orderNumber = document.getElementById('successOrderNumber');
    const paymentTime = document.getElementById('successPaymentTime');
    const paymentMethodEl = document.getElementById('successPaymentMethod');
    const serverName = document.getElementById('successServerName');
    const totalAmount = document.getElementById('successTotalAmount');
    
    if (!orderNumber || !paymentTime || !paymentMethodEl || !serverName || !totalAmount) return;
    
    const username = localStorage.getItem('username') || 'المستخدم';
    const now = new Date();
    const paymentMethod = window.currentPaymentMethod || 'cash';
    
    orderNumber.textContent = order.id;
    paymentTime.textContent = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    paymentMethodEl.textContent = paymentMethod === 'visa' ? 'Visa' : 'نقدي';
    serverName.textContent = username;
    totalAmount.textContent = Utils.formatCurrency(total);
    
    modal.classList.add('active');
    modal.style.display = 'flex';
};

window.newOrderFromSuccess = async function() {
    const modal = document.getElementById('paymentSuccessModal');
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
    }
    cart = [];
    window.orderGlobalDiscount = 0; 
    window.orderGlobalSurcharge = 0; 
    updateCart();
    await initDashboard();
};

window.printReceipt = async function() {
    const orderNumberEl = document.getElementById('successOrderNumber');
    if (!orderNumberEl) return;
    const orderNumber = orderNumberEl.textContent.trim();
    try {
        const orders = await DataManager.getOrders();
        const order = orders.find(o => o.id === orderNumber);
        if (order) Utils.printInvoice(order);
    } catch (error) {
        console.error('Error printing receipt:', error);
    }
};

// Cash Drawer Logic
async function checkCashDrawerSession() {
    if (!getDataManager()) return;

    // التأكد من تحميل الجلسات أولاً
    await DataManager.getCashSessions();

    const todaySession = await DataManager.getTodayCashSession();
    const closeDayBtn = document.getElementById('closeDayBtn');

    // 🚀 التأكد أن الشيفت "مفتوح" وليس مجرد موجود
    if (todaySession && todaySession.status === 'open') {
        if (closeDayBtn) closeDayBtn.style.display = 'flex';
        const modal = document.getElementById('openCashDrawerModal');
        if (modal) {
            modal.classList.remove('active');
            modal.style.display = 'none';
        }
    } else {
        if (closeDayBtn) closeDayBtn.style.display = 'none';
        setTimeout(() => {
            const modal = document.getElementById('openCashDrawerModal');
            if (modal && !modal.classList.contains('active')) {
                modal.classList.add('active');
                modal.style.display = 'flex';
            }
        }, 500);
    }
}
window.checkCashDrawerSession = checkCashDrawerSession;

window.handleOpenCashDrawer = async function(event) {
    event.preventDefault();

    const openingAmount = Utils.roundToTwoDecimals(parseFloat(document.getElementById('openingAmount').value) || 0);
    
    if (openingAmount < 0) {
        if (typeof Notification !== 'undefined') Notification.error('يرجى إدخال مبلغ صحيح');
        return;
    }
    
    const businessDate = DataManager.getBusinessDate();
    const now = new Date();
    const currentUser = Auth ? Auth.getUsername() : (localStorage.getItem('username') || 'المستخدم');
    
    // إغلاق أي شيفت مفتوح لنفس اليوم قبل فتح شيفت جديد (شيفت مفتوح واحد فقط لكل يوم)
    const sessions = await DataManager.getCashSessions();
    const openSameDay = (sessions || []).filter(s => s.status === 'open');
    for (const s of openSameDay) {
        if (s.id) {
            await DataManager.updateCashSession(s.id, {
                status: 'closed',
                closedAt: now.toISOString(),
                closedBy: currentUser
            });
        }
    }
    
    const session = { 
         id: `SHIFT_${Date.now()}`, 
         openingAmount: openingAmount, 
         status: 'open', 
         date: businessDate, 
         businessDate: businessDate, 
         openedBy: currentUser, 
         createdAt: now.toISOString(), 
         openedAt: now.toISOString() 
     }; 
 
     // 👈 التثبيت الإجباري في ذاكرة المتصفح عشان الشيفت يلزق فوراً 
     const currentSessions = JSON.parse(localStorage.getItem('cashSessions') || '[]'); 
     currentSessions.unshift(session); 
     localStorage.setItem('cashSessions', JSON.stringify(currentSessions)); 
 
     await DataManager.saveCashSession(session);

    closeOpenCashDrawerModal();
    
    if (typeof Notification !== 'undefined') Notification.success('تم فتح الدرج النقدي بنجاح');
    
    const closeDayBtn = document.getElementById('closeDayBtn');
    if (closeDayBtn) closeDayBtn.style.display = 'flex';
    
    setTimeout(async () => await initDashboard(), 300);
};

window.closeOpenCashDrawerModal = function() {
    const modal = document.getElementById('openCashDrawerModal');
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
    }
    document.getElementById('openCashDrawerForm').reset();
};

// ===========================
// Cash drawer helpers (cash vs card + expense classification)
// ===========================
function _safeToDate(value) {
    if (!value) return null;
    try {
        if (value instanceof Date) return value;
        if (typeof value?.toDate === 'function') return value.toDate(); // Firestore Timestamp
        return new Date(value);
    } catch (e) {
        return null;
    }
}

function _toBusinessDateString(value) {
    if (!value) return null;
    if (typeof value === 'string') {
        // YYYY-MM-DD
        if (value.match(/^\d{4}-\d{2}-\d{2}$/)) return value;
        // ISO
        if (value.includes('T') && value.match(/^\d{4}-\d{2}-\d{2}T/)) return value.substring(0, 10);
        // Anything else -> attempt Date parsing
    }
    const d = _safeToDate(value);
    if (!d || Number.isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
}

function _getExpenseBusinessDate(expense) {
    if (!expense) return null;
    // Prefer explicit businessDate if present
    if (expense.businessDate) return String(expense.businessDate);
    // Else derive from date or createdAt
    return _toBusinessDateString(expense.date) || _toBusinessDateString(expense.createdAt);
}

function _getExpenseFullDate(expense) {
    if (!expense) return null;
    // createdAt is usually the best "event time"
    return _safeToDate(expense.createdAt) || _safeToDate(expense.date);
}

function _isSalaryExpense(expense) {
    if (!expense) return false;
    const id = String(expense.id || '');
    const type = String(expense.type || '');
    const source = String(expense.source || '');
    return type === 'employees' || id.startsWith('PAYROLL_') || source === 'payroll_daily';
}

function _isCashPaymentMethod(method) {
    const m = String(method || '').trim().toLowerCase();
    return m === 'cash' || m === 'نقدي' || m === 'نقد';
}

function _getOrderPaymentMethod(order) {
    if (!order) return '';
    return order.payment_method ?? order.paymentMethod ?? order.payment ?? order.paymentType ?? '';
}

function _getOrderTotal(order) { 
    if (!order) return 0; 
    // التحقق الصارم כדי يقبل الصفر كقيمة فعلية ولا يتجاهلها 
    if (order.total !== undefined && order.total !== null) return parseFloat(order.total) || 0; 
    if (order.orderTotal !== undefined && order.orderTotal !== null) return parseFloat(order.orderTotal) || 0; 
    if (order.netTotal !== undefined && order.netTotal !== null) return parseFloat(order.netTotal) || 0; 
    if (order.amount !== undefined && order.amount !== null) return parseFloat(order.amount) || 0; 

    if (order.items && Array.isArray(order.items)) { 
        const subtotal = order.items.reduce((sum, item) => sum + ((parseFloat(item.price) || 0) * (parseFloat(item.quantity) || 1)), 0); 
        const discount = parseFloat(order.discount) || 0; 
        const surcharge = parseFloat(order.surcharge) || 0; 
        const tax = parseFloat(order.tax) || 0; 
        const serviceCharge = parseFloat(order.serviceCharge) || 0; 
        const deliveryFee = parseFloat(order.deliveryFee) || 0; 
        const markupAmount = parseFloat(order.aggregatorMarkup) || 0;
        return subtotal - discount + surcharge + tax + serviceCharge + deliveryFee + markupAmount; 
    } 
    return 0; 
} 
 
function _getOrderGrossTotal(order) { 
    if (!order) return 0; 
    if (order.originalSubtotal !== undefined && order.originalSubtotal !== null) return parseFloat(order.originalSubtotal) || 0; 

    if (order.items && Array.isArray(order.items) && order.items.length > 0) { 
        return order.items.reduce((sum, item) => sum + ((parseFloat(item.price) || 0) * (parseFloat(item.quantity) || 1)), 0); 
    } 

    // Fallback if no items, try to reverse from total
    const total = _getOrderTotal(order); 
    const discount = parseFloat(order.discount) || 0; 
    const surcharge = parseFloat(order.surcharge) || 0; 
    const tax = parseFloat(order.tax) || 0; 
    const serviceCharge = parseFloat(order.serviceCharge) || 0; 
    const deliveryFee = parseFloat(order.deliveryFee) || 0; 
    const markupAmount = parseFloat(order.aggregatorMarkup) || 0;

    return total + discount - surcharge - tax - serviceCharge - deliveryFee - markupAmount; 
}

window.openCloseCashDrawerModal = async function() {
    try {
        const todaySession = await DataManager.getTodayCashSession();
        if (!todaySession) {
            if (typeof Notification !== 'undefined') Notification.error('لا توجد جلسة مفتوحة اليوم');
            return;
        }

        const sessionId = todaySession.id;

        const [orders, allExpenses, aggregators] = await Promise.all([
            DataManager.getOrders() || [],
            DataManager.getExpenses() || [],
            DataManager.getAggregators() || []
        ]);

        const sessionOrders = orders.filter(order => (order.shift_id || order.shiftId) === sessionId);
        const sessionExpenses = allExpenses.filter(expense => (expense.shift_id || expense.shiftId) === sessionId);

        let cashRevenue = 0; 
        let cardRevenue = 0; 
        let totalDiscounts = 0; 
        const aggregatorSales = {}; 
        if (aggregators && aggregators.length > 0) { 
            aggregators.forEach(agg => { 
                aggregatorSales[agg.companyName] = 0; 
            }); 
        } 
 
        let grossCashRevenue = 0; // To store gross cash sales

        sessionOrders.forEach((order) => { 
            const orderTotal = _getOrderTotal(order); // Net total
            const paymentMethod = _getOrderPaymentMethod(order); 
            const orderSource = order.orderSource || 'direct'; 
            const orderDiscount = parseFloat(order.discount) || 0; 
            const orderGrossTotal = _getOrderGrossTotal(order); // Gross total

            // جمع الخصومات 
            totalDiscounts += orderDiscount; 

            if (_isCashPaymentMethod(paymentMethod)) { 
                cashRevenue += orderTotal; // Net cash sales
                grossCashRevenue += orderGrossTotal; // Gross cash sales
            } else { 
                cardRevenue += orderTotal; 
            } 

            if (orderSource !== 'direct' && aggregatorSales.hasOwnProperty(orderSource)) { 
                aggregatorSales[orderSource] += orderTotal; 
            } 
        });

        const netCashSales = Utils.roundToTwoDecimals(cashRevenue);
        const grossCashSales = Utils.roundToTwoDecimals(grossCashRevenue);
        const cardSales = Utils.roundToTwoDecimals(cardRevenue);

        let cashExpenses = 0;
        let salaryExpenses = 0;
        sessionExpenses.forEach((exp) => {
            const amount = parseFloat(exp.amount) || 0;
            // All expenses are deducted from cash drawer
            if (_isSalaryExpense(exp)) {
                salaryExpenses += amount;
            } else {
                cashExpenses += amount;
            }
        });

        cashExpenses = Utils.roundToTwoDecimals(cashExpenses);
        salaryExpenses = Utils.roundToTwoDecimals(salaryExpenses);
        const totalCashExpenses = Utils.roundToTwoDecimals(cashExpenses + salaryExpenses);

        // Expected amount in drawer should ONLY consider cash sales, not card or aggregator sales
        const expectedAmount = Utils.roundToTwoDecimals((todaySession.openingAmount || 0) + netCashSales - totalCashExpenses);

        // Render Aggregator Sales into its dedicated container
        const aggregatorSalesContainer = document.getElementById('aggregatorSalesContainer');
        if (aggregatorSalesContainer) {
            let aggregatorHtml = '';
            let totalAggregatorSales = 0;
            for (const [name, total] of Object.entries(aggregatorSales)) {
                 totalAggregatorSales += total;
                if (total > 0) {
                    aggregatorHtml += `
                        <div class="summary-row">
                            <span>مبيعات ${name}</span>
                            <span class="summary-value">${Utils.formatCurrency(total)}</span>
                        </div>`;
                }
            }
             if(totalAggregatorSales > 0){
                  aggregatorSalesContainer.innerHTML = aggregatorHtml;
                  aggregatorSalesContainer.style.display = 'block';
             } else {
                  aggregatorSalesContainer.style.display = 'none';
             }
           
        }

        // Update modal fields 
        const closeTotalDiscountsEl = document.getElementById('closeTotalDiscounts'); 
        if (closeTotalDiscountsEl) closeTotalDiscountsEl.textContent = Utils.formatCurrency(totalDiscounts); 
         
        document.getElementById('closeOpeningAmount').textContent = Utils.formatCurrency(todaySession.openingAmount || 0);
        document.getElementById('closeCashSales').textContent = Utils.formatCurrency(grossCashSales);
        document.getElementById('closeVisaSalesDisplay').textContent = Utils.formatCurrency(cardSales);
        document.getElementById('closeTotalExpenses').textContent = Utils.formatCurrency(totalCashExpenses); // This should be all cash expenses
        document.getElementById('closeExpectedAmount').textContent = Utils.formatCurrency(expectedAmount);
        document.getElementById('closingAmount').value = expectedAmount.toFixed(2);
        
        calculateDifference();
        
        const modal = document.getElementById('closeCashDrawerModal');
        if (modal) {
            modal.classList.add('active');
            modal.style.display = 'flex';
        }
    } catch (error) {
        console.error("Error opening close cash drawer modal:", error);
        if (typeof Notification !== 'undefined') Notification.error('حدث خطأ أثناء عرض شاشة إغلاق الدرج');
    }
};

window.calculateDifference = function() {
    const closingAmount = Utils.roundToTwoDecimals(parseFloat(document.getElementById('closingAmount').value) || 0);
    const expectedAmountText = document.getElementById('closeExpectedAmount').textContent;
    const expectedAmount = Utils.roundToTwoDecimals(parseFloat(expectedAmountText.replace(/[^\d.-]/g, '')) || 0);
    const difference = Utils.roundToTwoDecimals(closingAmount - expectedAmount);
    
    const differenceEl = document.getElementById('closeDifference');
    if (differenceEl) {
        differenceEl.textContent = Utils.formatCurrency(difference);
        if (Math.abs(difference) < 0.01) {
            differenceEl.style.color = '#000000';
        } else if (difference < 0) {
            differenceEl.style.color = '#e74c3c';
        } else {
            differenceEl.style.color = '#27ae60';
        }
    }
};

window.handleCloseCashDrawer = async function(event) {
    if (event) event.preventDefault();
    if (window._closingCashDrawer) return;
    window._closingCashDrawer = true;
    
    const submitBtn = document.getElementById('closeDaySubmitBtn');
    const submitBtnDefaultText = submitBtn ? submitBtn.textContent : 'إغلاق اليوم';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'جاري الإغلاق...';
    }
    const restoreBtn = () => {
        window._closingCashDrawer = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = submitBtnDefaultText;
        }
    };

    try {
        const closingAmount = Utils.roundToTwoDecimals(parseFloat(document.getElementById('closingAmount').value) || 0);
        const closingNotes = document.getElementById('closingNotes')?.value.trim() || '';

        if (closingAmount < 0) {
            restoreBtn();
            if (typeof Notification !== 'undefined') Notification.error('يرجى إدخال مبلغ صحيح');
            return;
        }
    
        const todaySession = await DataManager.getTodayCashSession();
        if (!todaySession) {
            restoreBtn();
            if (typeof Notification !== 'undefined') Notification.error('لا توجد جلسة مفتوحة');
            return;
        }
        
        const currentSessionId = todaySession.id;

        const [orders, allExpenses, aggregators] = await Promise.all([
            DataManager.getOrders() || [],
            DataManager.getExpenses() || [],
            DataManager.getAggregators() || []
        ]);
        
        const sessionOrders = orders.filter(o => (o.shift_id || o.shiftId) === currentSessionId);
        const sessionExpenses = allExpenses.filter(e => (e.shift_id || e.shiftId) === currentSessionId);
    
        let cashRevenue = 0;
        let cardRevenue = 0;
        let totalDiscounts = 0;
        const aggregatorSales = {}; 

        if (aggregators && aggregators.length > 0) {
            aggregators.forEach(agg => {
                aggregatorSales[agg.companyName] = 0;
            });
        }

        sessionOrders.forEach((order) => {
            const orderTotal = _getOrderTotal(order); 
            const orderDiscount = parseFloat(order.discount) || 0;
            const paymentMethod = _getOrderPaymentMethod(order);
            const orderSource = order.orderSource || 'direct';

            totalDiscounts += orderDiscount;

            if (_isCashPaymentMethod(paymentMethod)) {
                cashRevenue += orderTotal;
            } else {
                cardRevenue += orderTotal;
            }

            if (orderSource !== 'direct' && aggregatorSales.hasOwnProperty(orderSource)) {
                aggregatorSales[orderSource] += orderTotal;
            }
        });

        const cashSales = Utils.roundToTwoDecimals(cashRevenue);
        const cardSales = Utils.roundToTwoDecimals(cardRevenue);
        
        let cashExpenses = 0;
        let salaryExpenses = 0;
        sessionExpenses.forEach((e) => {
            const amount = parseFloat(e.amount) || 0;
            if (_isSalaryExpense(e)) {
                salaryExpenses += amount;
            } else {
                cashExpenses += amount;
            }
        });

        const totalCashExpensesForClose = Utils.roundToTwoDecimals(cashExpenses + salaryExpenses);
        const expectedAmount = Utils.roundToTwoDecimals((todaySession.openingAmount || 0) + cashSales - totalCashExpensesForClose);
        
        const totalSalesForClose = Utils.roundToTwoDecimals(cashSales + cardSales + Object.values(aggregatorSales).reduce((a, b) => a + b, 0));
        const netProfitForClose = Utils.roundToTwoDecimals(totalSalesForClose - totalDiscounts - totalCashExpensesForClose);
        const differenceForClose = Utils.roundToTwoDecimals(closingAmount - expectedAmount);

        let amountStatusForClose = 'مطابق';
        let diffTextForPrint = 'مطابق ✅ 0 ج.م';
        
        if (Math.abs(differenceForClose) >= 0.01) {
            amountStatusForClose = differenceForClose > 0 ? 'زيادة' : 'عجز';
            diffTextForPrint = differenceForClose > 0 ? `زيادة 🔵 ${differenceForClose} ج.م` : `عجز ❌ ${Math.abs(differenceForClose)} ج.م`;
        }

        const expensesBreakdownForClose = {};
        sessionExpenses.forEach((e) => {
            const category = e.category || e.type || 'other';
            expensesBreakdownForClose[category] = (expensesBreakdownForClose[category] || 0) + (parseFloat(e.amount) || 0);
        });

        // 🔥 التعديل السحري: جرد المنتجات المباعة في الشيفت 
         const soldItemsMap = new Map(); 
         sessionOrders.forEach(order => { 
             if (order.status !== 'cancelled' && order.items && Array.isArray(order.items)) { 
                 order.items.forEach(item => { 
                     const itemName = item.variant ? `${item.name} (${item.variant})` : item.name; 
                     const qty = parseFloat(item.quantity) || 1; 
                     soldItemsMap.set(itemName, (soldItemsMap.get(itemName) || 0) + qty); 
                 }); 
             } 
         }); 
         const soldItemsList = Array.from(soldItemsMap.entries()) 
             .map(([name, qty]) => ({ name, qty })) 
             .sort((a, b) => b.qty - a.qty); 

        const dailyLogRow = {
            sessionId: todaySession.id,
            businessDate: todaySession.date,
            openedBy: todaySession.openedBy,
            openedAt: todaySession.createdAt,
            closedAt: new Date().toISOString(),
            status: 'closed',
            ordersCount: sessionOrders.length,
            totalSales: totalSalesForClose,
            totalDiscounts: totalDiscounts,
            totalExpenses: totalCashExpensesForClose,
            netProfit: netProfitForClose,
            openingAmount: todaySession.openingAmount || 0,
            expectedAmount: expectedAmount,
            closingAmount: closingAmount,
            difference: differenceForClose,
            amountStatus: amountStatusForClose,
            notes: closingNotes,
            cashSales: cashSales,
            visaSales: cardSales,
            aggregatorSales: aggregatorSales, 
            expensesBreakdown: expensesBreakdownForClose,
        };
        
        upsertLocalArray('daily_log', dailyLogRow);

        if (window.SyncManager) {
            window.SyncManager.addToSyncQueue('daily_log', 'update', { id: todaySession.id, ...dailyLogRow });
        }
        
        await DataManager.updateCashSession(todaySession.id, {
            status: 'closed',
            closedAt: new Date().toISOString(),
            closedBy: Auth.getUsername(),
            closingAmount: closingAmount,
            notes: closingNotes
        });

        // ==========================================
        // 🖨️ كود تجهيز وإرسال الفاتورة للطباعة
        // ==========================================
        const shiftReportData = { 
             cashierName: Auth.getUsername() || localStorage.getItem('username') || 'المستخدم', 
             date: todaySession.date || DataManager.getBusinessDate(), 
             startTime: new Date(todaySession.createdAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }), 
             endTime: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }), 
             openingAmount: todaySession.openingAmount || 0, 
             cashSales: cashSales, 
             discounts: totalDiscounts, 
             expenses: totalCashExpensesForClose, 
             expectedCash: expectedAmount, 
             actualCash: closingAmount, 
             differenceText: diffTextForPrint, 
             visaSales: cardSales, 
             aggregatorSales: aggregatorSales, 
             soldItems: soldItemsList // 👈👈 ده السطر اللي إنت نسيته يا هندسة! 
         };
        
        // استدعاء دالة الطباعة (اللي هنضيفها في الخطوة 2)
        if (typeof printShiftReceipt === 'function') {
            printShiftReceipt(shiftReportData);
        }
        // ==========================================

        closeCloseCashDrawerModal();
        document.getElementById('closeDayBtn').style.display = 'none';
        if (typeof Notification !== 'undefined') {
            Notification.success('تم إغلاق الدرج النقدي بنجاح وجاري طباعة التقرير');
        }
        
        // تأخير إعادة تحميل الصفحة ثانية واحدة للسماح للطابعة بالتقاط الأمر قبل ما الصفحة تفصل
        setTimeout(() => {
            window.location.reload();
        }, 1500);

    } catch (error) {
        restoreBtn();
        console.error('Error closing cash drawer:', error);
        if (typeof Notification !== 'undefined') {
            Notification.error('حدث خطأ أثناء إغلاق الدرج النقدي: ' + error.message);
        } else {
            alert('حدث خطأ أثناء إغلاق الدرج النقدي: ' + error.message);
        }
    }
};

window.closeCloseCashDrawerModal = function() {
    const modal = document.getElementById('closeCashDrawerModal');
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
    }
    document.getElementById('closeCashDrawerForm').reset();
};

// Add Expense Modal Functions
window.openAddExpenseModal = async function() {
    const todaySession = await DataManager.getTodayCashSession();
    if (!todaySession || todaySession.status !== 'open') {
        if (typeof Notification !== 'undefined') {
            Notification.error('يجب فتح شيفت نقدي أولاً');
        } else {
            alert('يجب فتح شيفت نقدي أولاً');
        }
        return;
    }
    
    const modal = document.getElementById('addExpenseModal');
    if (modal) {
        modal.style.display = 'flex';
        document.getElementById('addExpenseForm').reset();
    }
};

window.closeAddExpenseModal = function() {
    const modal = document.getElementById('addExpenseModal');
    if (modal) {
        modal.style.display = 'none';
    }
    document.getElementById('addExpenseForm').reset();
};

window.handleAddExpenseSubmit = async function(event) {
    event.preventDefault();
    
    // 🔥 1. نجيب الشيفت المفتوح عشان نربط المصروف بيه
    let todaySession = null;
    if (typeof DataManager !== 'undefined') {
        todaySession = await DataManager.getTodayCashSession();
    }
    
    if (!todaySession || todaySession.status !== 'open') {
        if (typeof Notification !== 'undefined') {
            Notification.error('يجب فتح شيفت نقدي أولاً');
        } else {
            alert('يجب فتح شيفت نقدي أولاً');
        }
        return;
    }
    
    const expenseType = document.getElementById('expenseType').value;
    const expenseAmount = parseFloat(document.getElementById('expenseAmount').value);
    const expenseDescription = document.getElementById('expenseDescription').value.trim();
    
    if (!expenseType || !expenseAmount || expenseAmount <= 0) {
        if (typeof Notification !== 'undefined') {
            Notification.error('يرجى إدخال نوع المصروف والمبلغ بشكل صحيح');
        } else {
            alert('يرجى إدخال نوع المصروف والمبلغ بشكل صحيح');
        }
        return;
    }
    
    const currentUser = (typeof Auth !== 'undefined' ? Auth.getUsername() : (localStorage.getItem('username') || 'المستخدم'));
    const businessDate = todaySession.date || DataManager.getBusinessDate();
    const now = new Date();
    
    const expenseTypeLabels = {
        'employees': 'رواتب العمال',
        'supplies': 'شراء بضاعة',
        'bills': 'فواتير',
        'rent': 'إيجار',
        'other': 'أخرى'
    };
    
    const expense = {
        type: expenseType,
        category: expenseTypeLabels[expenseType] || expenseType,
        amount: Utils.roundToTwoDecimals(expenseAmount),
        date: businessDate, // استخدام businessDate
        description: expenseDescription,
        createdBy: currentUser,
        createdAt: now.toISOString(), // استخدام التوقيت المحلي
        sessionDate: businessDate, // تاريخ الجلسة
        shift_id: todaySession.id || null // ربط المصروف بالشيفت الحالي فقط
    };
    
    try {
        await DataManager.saveExpense(expense);
        closeAddExpenseModal();
        await initDashboard(); // تحديث الكروت فوراً
        
        if (typeof Notification !== 'undefined') {
            Notification.success('تم إضافة المصروف بنجاح');
        } else {
            alert('تم إضافة المصروف بنجاح');
        }
    } catch (error) {
        console.error('Error adding expense:', error);
        if (typeof Notification !== 'undefined') {
            Notification.error('حدث خطأ أثناء إضافة المصروف');
        } else {
            alert('حدث خطأ أثناء إضافة المصروف');
        }
    }
};

// Initialize Add Expense Button
document.addEventListener('DOMContentLoaded', () => {
    const addExpenseBtn = document.getElementById('addExpenseBtn');
    if (addExpenseBtn) {
        addExpenseBtn.addEventListener('click', () => {
            openAddExpenseModal();
        });
    }
});

// Search Logic
function initSearch() {
    const searchInput = document.getElementById('menuSearch');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const menuItems = document.querySelectorAll('.menu-item-btn');
            
            menuItems.forEach(btn => {
                const name = btn.querySelector('.menu-item-name').textContent.toLowerCase();
                if (name.includes(searchTerm)) {
                    btn.style.display = '';
                } else {
                    btn.style.display = 'none';
                }
            });
        });
    }
}

// Init Cart (Initial call)
function initCart() {
    updateCart();
}

// Self-Healing: Ensure all payroll expenses are in history
document.addEventListener('DOMContentLoaded', async () => {
    // Wait for DataManager
    if (typeof DataManager === 'undefined') return;
    
    setTimeout(async () => {
        try {
            const expenses = JSON.parse(localStorage.getItem('expenses') || '[]');
            const history = JSON.parse(localStorage.getItem('expensesHistory') || '[]');
            const historyIds = new Set(history.map(e => e.id));
            
            let repairedCount = 0;
            
            for (const exp of expenses) {
                // Check for PAYROLL_ items or any item missing from history
                if (exp.id && String(exp.id).startsWith('PAYROLL_') && !historyIds.has(exp.id)) {
                    console.log('Reparing missing history item:', exp.id);
                    await DataManager.saveExpenseToHistory(exp);
                    repairedCount++;
                }
            }
            
            if (repairedCount > 0) {
                console.log(`Repaired ${repairedCount} missing payroll items in history.`);
            }
        } catch (e) {
            console.error('Error in self-healing history:', e);
        }
    }, 3000); // Run after 3 seconds to ensure everything loaded
});

async function loadAggregatorsForPOS() { 
     try { 
         // 1. تحميل الداتا 
         let rawData = JSON.parse(localStorage.getItem('aggregators') || '[]'); 
         
         if (navigator.onLine && window.FirestoreService) { 
             const firestoreData = await window.FirestoreService.getCollection('aggregators'); 
             if (firestoreData && firestoreData.length > 0) { 
                 rawData = firestoreData; 
                 localStorage.setItem('aggregators', JSON.stringify(firestoreData)); 
             } 
         } 
 
         // 2. 🔥 فلترة المكرر قبل العرض في الـ POS 
         const uniqueAggs = []; 
         const seenNames = new Set(); 
         
         rawData.forEach(agg => { 
             const name = (agg.companyName || agg.name || "").trim().toUpperCase(); 
             if (name && !seenNames.has(name)) { 
                 seenNames.add(name); 
                 uniqueAggs.push(agg); 
             } 
         }); 
 
         aggregatorsData = uniqueAggs; 
         renderAggregatorButtons(); 
         
     } catch (e) { 
         console.error("Error loading aggregators:", e); 
     } 
 } 
function renderAggregatorButtons() { 
     const container = document.getElementById('aggregatorBtnsContainer'); 
     if (!container) return; 
     
     // 👈 السطر ده مهم جداً عشان ميكررش الزراير في الواجهة 
     container.innerHTML = ''; 
     
     if (!aggregatorsData || aggregatorsData.length === 0) return; 
     
     aggregatorsData.forEach(agg => { 
         const btn = document.createElement('button'); 
         btn.className = 'btn-order-type aggregator-btn'; 
         btn.style.cssText = 'flex: 1; min-width: 100px; padding: 10px; border: 1px solid var(--color-separator); background: var(--color-white); color: var(--color-text-dark); border-radius: var(--border-radius-lg); cursor: pointer; font-weight: 600; font-size: 13px; transition: all 0.3s ease; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: var(--shadow-sm);'; 
         
         const aggNameDisplay = agg.companyName || agg.name || agg.title || agg.en_name || agg.ar_name || 'شركة غير معروفة'; 
         btn.innerHTML = `<i class="fas fa-motorcycle" style="margin-left: 4px; font-size: 12px;"></i> ${aggNameDisplay}`; 
         
         btn.addEventListener('click', () => { 
             orderType = 'aggregator'; 
             activeAggregator = agg; 
             deliveryInfo = null; 
             deliveryFee = 0; 
             
             window.orderGlobalDiscount = 0; 
             window.orderGlobalSurcharge = 0; 
             
             cart.forEach(item => { 
                 if (item.originalPrice === undefined) { 
                     item.originalPrice = item.price; 
                 } 
                 const aggName = activeAggregator.companyName || activeAggregator.name || activeAggregator.title || activeAggregator.en_name || activeAggregator.ar_name || 'شركة غير معروفة'; 
                 if (item.aggregatorPrices && item.aggregatorPrices[aggName]) { 
                     item.price = parseFloat(item.aggregatorPrices[aggName]); 
                 } else { 
                     item.price = item.originalPrice; 
                 } 
             }); 
 
             document.querySelectorAll('.btn-order-type').forEach(b => { 
                 b.classList.remove('active'); 
                 b.style.background = 'var(--color-white)'; 
                 b.style.color = 'var(--color-text-dark)'; 
                 b.style.borderColor = 'var(--color-separator)'; 
             }); 
             
             btn.classList.add('active'); 
             btn.style.background = 'var(--color-text-dark)'; 
             btn.style.color = 'var(--color-white)'; 
             btn.style.borderColor = 'var(--color-text-dark)'; 
             
             const delFeeInput = document.getElementById('deliveryFeeInput'); 
             const tableNumInput = document.getElementById('tableNumberInput'); 
             if (delFeeInput) delFeeInput.style.display = 'none'; 
             if (tableNumInput) tableNumInput.style.display = 'none'; 
             
             updateCart(); 
         }); 
         container.appendChild(btn); 
     }); 
 }
 window.orderGlobalDiscount = 0; 
window.orderGlobalSurcharge = 0; 

// 1. الدالة المسؤولة عن تلوين الزراير بالأسود لما تنداس
window.selectAdjBtn = function(containerId, clickedBtn) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // تصفير كل الزراير
    container.querySelectorAll('button').forEach(btn => {
        btn.classList.remove('active'); 
        btn.style.background = '#fff';
        btn.style.color = btn.classList.contains('adj-op-btn') && btn.dataset.value === 'surcharge' ? '#27ae60' : '#000';
        btn.style.borderColor = '#ddd';
    });
    
    // تلوين الزرار المختار بالأسود
    clickedBtn.classList.add('active'); 
    clickedBtn.style.background = '#000';
    clickedBtn.style.color = '#fff'; 
    clickedBtn.style.borderColor = '#000';
};

// 2. دالة فتح المودال
window.openPriceAdjustmentModal = function() { 
    if (!cart || cart.length === 0) { 
        if (typeof Notification !== 'undefined') Notification.error('السلة فارغة'); 
        return; 
    } 
    const select = document.getElementById('adjTarget'); 
    select.innerHTML = '<option value="order">🛒 الطلب بالكامل</option>'; 
    cart.forEach((item, index) => { 
        select.innerHTML += `<option value="${index}">📦 صنف: ${item.name} ${item.variant ? `(${item.variant})` : ''}</option>`; 
    }); 
    document.getElementById('adjValue').value = '0'; 
    document.getElementById('adjPreview').innerHTML = 'اكتب القيمة لرؤية الحسبة النهائية...'; 
    document.getElementById('priceAdjustModal').style.display = 'flex'; 
}; 

// 3. دالة حساب المعاينة (الرقم اللي بيظهر تحت)
window.calculateAdjPreview = function() { 
    const target = document.getElementById('adjTarget').value; 
    
    // قراءة البيانات من الزراير الجديدة
    const opBtn = document.querySelector('#adjOpContainer .active');
    const typeBtn = document.querySelector('#adjTypeContainer .active');
    if (!opBtn || !typeBtn) return;
    
    const op = opBtn.dataset.value;
    const type = typeBtn.dataset.value;
    const val = parseFloat(document.getElementById('adjValue').value) || 0; 

    let basePrice = 0; 
    if (target === 'order') { 
        basePrice = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0); 
    } else { 
        basePrice = cart[target].price * cart[target].quantity; 
    } 
    let adjAmount = type === 'percent' ? (basePrice * val / 100) : val; 
    let finalPrice = op === 'discount' ? (basePrice - adjAmount) : (basePrice + adjAmount); 

    const previewEl = document.getElementById('adjPreview'); 
    if (val === 0) { 
        previewEl.innerHTML = 'اكتب القيمة لرؤية الحسبة النهائية...'; 
    } else { 
        previewEl.innerHTML = `قبل: <span style="text-decoration:line-through; color:#e74c3c;">${basePrice.toFixed(2)}</span> 👈 بعد: <span style="color:#27ae60; font-size:16px;">${finalPrice.toFixed(2)} ج.م</span>`; 
    } 
}; 

// 4. الدالة اللي بتطبق الخصم أو الزيادة على السلة فعلياً
window.applyPriceAdjustment = function() { 
    const target = document.getElementById('adjTarget').value; 
    
    // قراءة البيانات من الزراير الجديدة
    const opBtn = document.querySelector('#adjOpContainer .active');
    const typeBtn = document.querySelector('#adjTypeContainer .active');
    if (!opBtn || !typeBtn) return;

    const op = opBtn.dataset.value;
    const type = typeBtn.dataset.value;
    const val = parseFloat(document.getElementById('adjValue').value) || 0; 

    if (val <= 0) return; 

    if (target === 'order') { 
        // تطبيق على الأوردر بالكامل
        const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0); 
        let adjAmount = type === 'percent' ? (subtotal * val / 100) : val; 
        
        if (op === 'discount') { 
            window.orderGlobalDiscount = adjAmount; 
            window.orderGlobalSurcharge = 0; 
        } else { 
            window.orderGlobalSurcharge = adjAmount; 
            window.orderGlobalDiscount = 0; 
        } 
    } else { 
        // تطبيق على صنف معين
        const index = parseInt(target); 
        const item = cart[index]; 
        let adjAmountPerItem = type === 'percent' ? (item.price * val / 100) : (val / item.quantity); 
        
        if (op === 'discount') {
            // احتفظ بالسعر الأصلي لحساب الخصم وقت حفظ الأوردر
            item._originalPrice = item._originalPrice || item.price;
            item.price -= adjAmountPerItem;
            item.variant = (item.variant ? item.variant + ' ' : '') + '(خصم)';
        } else {
            item.price += adjAmountPerItem; 
            // تم إزالة إضافة كلمة زيادة لتظهر بالسعر الجديد كأنها منتج طبيعي 
        } 
        item.price = Utils.roundToTwoDecimals(item.price); 
    } 
    
    document.getElementById('priceAdjustModal').style.display = 'none'; 
    if (typeof Notification !== 'undefined') Notification.success('تم التعديل بنجاح'); 
    updateCart(); 
};

// ======================================================== 
// 🖨️ دالة طباعة تقرير الشيفت على طابعة الكاشير 
// ======================================================== 
// ======================================================== 
// 🖨️ دالة طباعة تقرير الشيفت (تصميم مقاوم للقص - 80mm)
// ======================================================== 
window.printShiftReceipt = function(shiftData) { 
    let aggregatorHtml = ''; 
    if (shiftData.aggregatorSales && Object.keys(shiftData.aggregatorSales).length > 0) { 
        let hasAggSales = false; 
        let aggRows = ''; 
        for (const [name, amount] of Object.entries(shiftData.aggregatorSales)) { 
            if (amount > 0) { 
                hasAggSales = true; 
                aggRows += `<div class="row"><span>${name}</span> <span>${Utils.formatCurrency(amount)}</span></div>`; 
            } 
        } 
        if (hasAggSales) { 
            aggregatorHtml = ` 
            <div class="section"> 
                <div class="title">مستحقات شركات التوصيل</div> 
                ${aggRows} 
            </div>`; 
        } 
    } 

    // 🌟 جرد المنتجات المباعة
    let soldItemsHtml = '';
    if (shiftData.soldItems && shiftData.soldItems.length > 0) {
        let itemsRows = '';
        shiftData.soldItems.forEach(item => {
            itemsRows += `<div class="row"><span>${item.name}</span> <span class="bold" style="font-size: 15px;">${item.qty}</span></div>`;
        });
        soldItemsHtml = `
        <div class="section">
            <div class="title">جرد المنتجات (المباع خلال الشيفت)</div>
            ${itemsRows}
        </div>`;
    }

    const receiptHtml = ` 
        <!DOCTYPE html> 
        <html lang="ar" dir="rtl"> 
        <head> 
            <meta charset="UTF-8"> 
            <style> 
                 @page { margin: 0; } 
                 * { box-sizing: border-box; } 
                 body { font-family: 'Cairo', sans-serif; width: 80mm; margin: 0 auto; padding: 2mm 5mm; color: #000; font-size: 13px; direction: rtl; } 
                 .header { text-align: center; border-bottom: 2px dashed #000; padding-bottom: 10px; margin-bottom: 10px; } 
                 .header h2 { margin: 0; font-size: 24px; font-weight: 800; } 
                 .section { border-bottom: 1px dashed #000; padding-bottom: 10px; margin-bottom: 10px; } 
                 
                 /* 🛡️ السطر السحري لمنع قص الكلام العربي */
                 .row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; page-break-inside: avoid; } 
                 .row span:first-child { flex: 1; text-align: right; word-wrap: break-word; overflow-wrap: break-word; line-height: 1.4; padding-left: 8px; } 
                 .row span:last-child { white-space: nowrap; font-weight: bold; text-align: left; } 
                 
                 .bold { font-weight: bold; } 
                 .title { font-weight: bold; text-align: center; background: #000; color: #fff; padding: 4px; margin-bottom: 10px; border-radius: 4px; font-size: 13px; -webkit-print-color-adjust: exact; print-color-adjust: exact; } 
                 .footer { text-align: center; margin-top: 15px; font-size: 12px; font-weight: bold;} 
             </style> 
        </head> 
        <body> 
            <div class="header"> 
                <h2>مطعم ريان</h2> 
                <div style="font-size: 16px; font-weight: bold; margin-top: 5px;">تقرير إغلاق شيفت</div> 
            </div> 
            
            <div class="section"> 
                <div class="row"><span>التاريخ:</span> <span class="bold">${shiftData.date}</span></div> 
                <div class="row"><span>الكاشير:</span> <span class="bold">${shiftData.cashierName}</span></div> 
                <div class="row"><span>الوقت:</span> <span dir="ltr">${shiftData.startTime} - ${shiftData.endTime}</span></div> 
            </div> 

            <div class="section"> 
                <div class="title">العهدة النقدية (الكاش)</div> 
                <div class="row"><span>رصيد البداية:</span> <span>${Utils.formatCurrency(shiftData.openingAmount)}</span></div> 
                <div class="row"><span>مبيعات كاش:</span> <span>+${Utils.formatCurrency(shiftData.cashSales)}</span></div> 
                <div class="row"><span>خصومات الكاش:</span> <span>-${Utils.formatCurrency(shiftData.discounts)}</span></div> 
                <div class="row"><span>مصاريف خرجت:</span> <span>-${Utils.formatCurrency(shiftData.expenses)}</span></div> 
                <div class="row bold" style="margin-top: 5px; padding-top: 5px; border-top: 1px dotted #000; font-size: 15px;"><span>المفروض في الدرج:</span> <span>${Utils.formatCurrency(shiftData.expectedCash)}</span></div> 
                <div class="row bold" style="font-size: 15px;"><span>العد الفعلي:</span> <span>${Utils.formatCurrency(shiftData.actualCash)}</span></div> 
                <div class="row bold" style="margin-top: 8px;"><span>النتيجة:</span> <span style="font-size: 15px;">${shiftData.differenceText}</span></div> 
            </div> 

            <div class="section"> 
                <div class="title">مستحقات البنك (الفيزا)</div> 
                <div class="row"><span>إجمالي الفيزا:</span> <span class="bold">${Utils.formatCurrency(shiftData.visaSales)}</span></div> 
            </div> 

            ${aggregatorHtml} 
            ${soldItemsHtml} 
            
            <div class="footer"> 
                <div>تمت الطباعة بواسطة Solo System</div> 
                <div dir="ltr" style="margin-top: 4px; font-weight: normal;">${new Date().toLocaleString('ar-EG')}</div> 
            </div> 
        </body> 
        </html> 
    `; 

    try { 
        if (typeof require !== 'undefined') { 
            const { ipcRenderer } = require('electron'); 
            ipcRenderer.send('print-receipt-hidden', receiptHtml); 
        } else { 
            const printWindow = window.open('', '_blank'); 
            printWindow.document.write(receiptHtml); 
            printWindow.document.close(); 
            setTimeout(() => printWindow.print(), 250); 
        } 
    } catch (error) { 
        console.error("⚠️ خطأ في طباعة التقرير:", error); 
    } 
};
// ========================================================= 
 // 🚀 اختراق حماية Electron لتشغيل شاشة العميل (النسخة الصاروخية) 
 // ========================================================= 
 document.addEventListener('click', function(e) { 
     const addBtn = e.target.closest('#forceAddCustomerBtn'); 
     if (addBtn) { 
         e.preventDefault(); 
         
         const existing = document.getElementById('dynamicFastModal'); 
         if (existing) existing.remove(); 
 
         const overlay = document.createElement('div'); 
         overlay.id = 'dynamicFastModal'; 
         // ⚡ شيلنا الـ Blur نهائياً عشان نمنع أي ثقل أو بطء في المتصفح 
         overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.6); z-index: 2147483647; display: flex; align-items: center; justify-content: center;'; 
         
         const searchInput = document.getElementById('quickPhoneSearch'); 
         const defaultPhone = searchInput ? searchInput.value : ''; 
 
         // ⚡ شيلنا الأنيميشن عشان الشاشة تطلع في نفس اللحظة بدون تأخير 
         overlay.innerHTML = ` 
             <div style="background: #fff; padding: 25px; border-radius: 16px; width: 90%; max-width: 400px; box-shadow: 0 15px 40px rgba(0,0,0,0.4); direction: rtl;"> 
                 <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid #f0f0f0; padding-bottom: 15px;"> 
                     <h3 style="margin: 0; font-family: 'Cairo'; color: #000; font-size: 20px; font-weight: 800;">إضافة عميل سريع 🚀</h3> 
                     <span onclick="document.getElementById('dynamicFastModal').remove()" style="font-size: 32px; color: #999; cursor: pointer; line-height: 1;">&times;</span> 
                 </div> 
                 <div style="margin-bottom: 15px;"> 
                     <label style="display: block; margin-bottom: 8px; font-weight: bold; font-size: 14px; color: #333;">رقم الهاتف *</label> 
                     <input type="tel" id="dfPhone" value="${defaultPhone}" placeholder="أدخل رقم الهاتف" style="width: 100%; padding: 12px; border: 2px solid #eee; border-radius: 8px; font-family: inherit; font-size: 15px; outline: none; transition: 0.2s;" onfocus="this.style.borderColor='#000'" onblur="this.style.borderColor='#eee'"> 
                 </div> 
                 <div style="margin-bottom: 15px;"> 
                     <label style="display: block; margin-bottom: 8px; font-weight: bold; font-size: 14px; color: #333;">اسم العميل *</label> 
                     <input type="text" id="dfName" placeholder="أدخل اسم العميل" style="width: 100%; padding: 12px; border: 2px solid #eee; border-radius: 8px; font-family: inherit; font-size: 15px; outline: none; transition: 0.2s;" onfocus="this.style.borderColor='#000'" onblur="this.style.borderColor='#eee'"> 
                 </div> 
                 <div style="margin-bottom: 25px;"> 
                     <label style="display: block; margin-bottom: 8px; font-weight: bold; font-size: 14px; color: #333;">العنوان (اختياري)</label> 
                     <input type="text" id="dfAddress" placeholder="أدخل العنوان للتوصيل" style="width: 100%; padding: 12px; border: 2px solid #eee; border-radius: 8px; font-family: inherit; font-size: 15px; outline: none; transition: 0.2s;" onfocus="this.style.borderColor='#000'" onblur="this.style.borderColor='#eee'"> 
                 </div> 
                 <button type="button" id="dfSaveBtn" style="width: 100%; background: #000; color: #fff; border: none; padding: 14px; border-radius: 10px; font-family: 'Cairo'; font-weight: 800; font-size: 16px; cursor: pointer;">إضافة العميل</button> 
             </div> 
         `; 
         
         document.body.appendChild(overlay); 
 
         // ⚡ ميزة جديدة: التركيز التلقائي (الماوس هيقف في الخانة الفاضية علطول عشان الكاشير يكتب بدون ما يدوس) 
         setTimeout(() => { 
             const phoneInput = document.getElementById('dfPhone'); 
             const nameInput = document.getElementById('dfName'); 
             if (phoneInput && !phoneInput.value) { 
                 phoneInput.focus(); 
             } else if (nameInput) { 
                 nameInput.focus(); 
             } 
         }, 10); 
 
         // دالة الحفظ 
         document.getElementById('dfSaveBtn').addEventListener('click', async function() { 
             const phone = document.getElementById('dfPhone').value.trim(); 
             const name = document.getElementById('dfName').value.trim(); 
             const address = document.getElementById('dfAddress').value.trim(); 
             
             if (!phone || !name) { 
                 alert('يرجى إدخال الاسم ورقم الهاتف!'); 
                 return; 
             } 
             
             this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الحفظ...'; 
             this.disabled = true; 
             
             const newCustomer = { 
                 id: 'CUST_' + Date.now(), 
                 phone: phone, 
                 name: name, 
                 address: address, 
                 tier: 'regular', 
                 points: 0, 
                 ordersCount: 0, 
                 totalSpent: 0, 
                 createdAt: new Date().toISOString() 
             }; 
             
             try {
                if (window.FirestoreService && window.FirestoreService.saveCustomer) {
                    await window.FirestoreService.saveCustomer(newCustomer);
                    // saveCustomer بيحدّث localStorage تلقائياً
                } else {
                    try {
                        const loc = JSON.parse(localStorage.getItem('customers') || '[]');
                        const idx2 = loc.findIndex(c => c.phone === newCustomer.phone);
                        if (idx2 >= 0) loc[idx2] = newCustomer; else loc.push(newCustomer);
                        localStorage.setItem('customers', JSON.stringify(loc));
                    } catch(_) {}
                }

                // تحديث بيانات السلة بالعميل الجديد
                window.currentOrderCustomer = newCustomer; 
                 
                 const searchState = document.getElementById('searchCustomerState'); 
                 const activeState = document.getElementById('activeCustomerState'); 
                 
                 // الآيديهات دي هي اللي إنت مستخدمها في تصميم السلة في index.html 
                 const cartCustName = document.getElementById('cartCustName'); 
                 const cartCustTier = document.getElementById('cartCustTier'); 
                 const cartCustPoints = document.getElementById('cartCustPoints'); 
                 
                 if (searchState) searchState.style.display = 'none'; 
                 if (activeState) activeState.style.display = 'flex'; 
                 
                 if (cartCustName) cartCustName.innerText = name; // بيعرض الاسم الحقيقي 
                 
                 // تصفير النقاط والتصنيف لأنه عميل جديد 
                 if (cartCustTier) { 
                     cartCustTier.innerText = '👤 عادي'; 
                     cartCustTier.style.color = '#666'; 
                     cartCustTier.style.background = '#f5f5f5'; 
                 } 
                 
                 if (cartCustPoints) { 
                     cartCustPoints.innerText = '0 نقطة'; 
                 } 
                 
                 if (searchInput) searchInput.value = ''; 
                 overlay.remove(); 
                 
                 if (typeof Notification !== 'undefined') Notification.success('تم إضافة العميل بنجاح'); 
                 
             } catch (err) { 
                 console.error(err); 
                 alert('حدث خطأ أثناء الحفظ!'); 
                 this.innerText = 'إضافة العميل'; 
                 this.disabled = false; 
             } 
         }); 
     } 
 });

