// js/dashboard.js
// Use DataManager from data.js (exposed on window). Do not re-declare to avoid "already been declared" error.
function getDataManager() {
  return (typeof window !== 'undefined' && window.DataManager) || (typeof DataManager !== 'undefined' ? DataManager : null);
}

// ⏰ الوقت الآن بتوقيت مصر — بديل لـ egyptNow() الذي يُرجع UTC
function egyptNow() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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
    const SYS_LABELS = { owner: 'مالك', admin: 'مدير', cashier: 'كاشير' };

    // ── جيب الموظفين العاديين (SQLite أولاً) ──
    let manualEmps = [];
    try {
        if (window.DBService) {
            const dbEmps = await window.DBService.getEmployees();
            if (Array.isArray(dbEmps) && dbEmps.length > 0) manualEmps = dbEmps;
        }
    } catch (e) {
        console.warn('[loadEmployeesForAttendance] SQLite employees:', e.message);
    }
    if (!manualEmps.length) {
        try { manualEmps = JSON.parse(localStorage.getItem('employees') || '[]'); } catch (_) {}
    }

    // ── جيب مستخدمي النظام ──
    let systemUsers = [];
    try {
        systemUsers = window.DBService
            ? (await window.DBService.getUsers() || [])
            : JSON.parse(localStorage.getItem('users') || '[]');
    } catch (_) {
        try { systemUsers = JSON.parse(localStorage.getItem('users') || '[]'); } catch (__) {}
    }

    // حوّل مستخدمي النظام لـ employee-like objects
    const sysEmps = systemUsers
        .filter(u => u.displayName || u.name || u.username)
        .map(u => ({
            id:           String(u.id || u.uid || u.username || ''),
            name:         u.displayName || u.name || u.username || '',
            role:         SYS_LABELS[u.role] || u.role || 'كاشير',
            isSystemUser: true,
        }));

    // ادمج بدون تكرار (لو اسم الموظف نفس اسم المستخدم يظهر مرة واحدة بس)
    const sysNamesLc = new Set(sysEmps.map(e => e.name.toLowerCase()));
    const filteredManual = manualEmps.filter(e =>
        !sysNamesLc.has((e.name || '').toLowerCase())
    );

    return [...sysEmps, ...filteredManual];
}

async function loadAttendanceForDate(businessDate) {
    // SQLite أولاً (المصدر الرئيسي)
    if (window.DBService) {
        try {
            const all = await window.DBService.getAttendance({ businessDate: String(businessDate) });
            if (Array.isArray(all) && all.length > 0) return all;
        } catch(e) { console.warn('[loadAttendanceForDate] SQLite:', e.message); }
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

    // بناء map: employeeId → سجل الحضور المحفوظ مسبقاً لهذا اليوم
    const recordedMap = {};
    (attendanceRecords || []).forEach(r => {
        const eid = String(r.employeeId ?? r.employee_id ?? '');
        if (eid) recordedMap[eid] = r;
    });

    const _statusLabel = { present: 'حاضر', absent: 'غائب', vacation: 'إجازة', default: 'افتراضي' };
    const _statusColor = { present: '#16a34a', absent: '#dc2626', vacation: '#d97706', default: '#666' };

    container.innerHTML = employees.map(emp => {
        const id    = String(emp.id ?? '');
        const name  = emp.name || 'غير محدد';
        const role  = emp.role || '';
        const salary = round2(emp.salary || 0);
        const rowId  = `att_${encodeURIComponent(id)}`;

        const existing = recordedMap[id]; // سجل موجود مسبقاً لهذا اليوم
        const isLocked = !!existing;      // مسجّل → اقفل الصف
        const savedStatus = existing ? (existing.status || 'default') : 'default';
        const dailyWage  = existing ? round2(existing.dailyWage || 0) : 0;

        const borderStyle = isLocked
            ? 'border:2px solid #ef4444; background:#fff5f5;'
            : 'border:1px solid #e8e8e8; background:#ffffff;';

        const lockedBadge = isLocked ? `
            <div style="display:flex;align-items:center;gap:6px;background:#fee2e2;border:1px solid #fca5a5;
                border-radius:8px;padding:5px 10px;font-size:12px;font-weight:700;color:#dc2626;white-space:nowrap;">
                <i class="fas fa-lock" style="font-size:11px;"></i>
                مسجّل — ${_statusLabel[savedStatus] || savedStatus}
                ${dailyWage > 0 ? `<span style="margin-right:4px;color:#7f1d1d;">(${dailyWage} ج.م)</span>` : ''}
            </div>` : '';

        const makeRadio = (val) => {
            const isChecked = savedStatus === val;
            const bg = isChecked
                ? (val === 'present' ? '#dcfce7' : val === 'absent' ? '#fee2e2' : val === 'vacation' ? '#fef9c3' : '#f0f0f0')
                : '#fafafa';
            const borderClr = isChecked
                ? (val === 'present' ? '#16a34a' : val === 'absent' ? '#dc2626' : val === 'vacation' ? '#d97706' : '#aaa')
                : '#e8e8e8';
            return `
                <label style="display:inline-flex;align-items:center;gap:6px;border:1px solid ${borderClr};
                    padding:8px 10px;border-radius:10px;
                    cursor:${isLocked ? 'not-allowed' : 'pointer'};
                    background:${bg};opacity:${isLocked ? '0.65' : '1'};">
                    <input type="radio" name="${rowId}" value="${val}"
                        ${isChecked ? 'checked' : ''}
                        ${isLocked ? 'disabled' : ''} />
                    <span style="font-weight:700;font-size:12px;color:${isChecked ? _statusColor[val] : '#333'};">
                        ${_statusLabel[val]}
                    </span>
                </label>`;
        };

        const sysBadge = emp.isSystemUser
            ? `<span style="font-size:10px;background:#f5f5f5;color:#aaa;border-radius:4px;padding:1px 5px;margin-right:4px;">⚙️ نظام</span>`
            : '';
        // جيب الراتب من مستخدمي النظام لو مش موجود في الـ employee object
        const effectiveSalary = salary || (() => {
            if (!emp.isSystemUser) return 0;
            try {
                const u = JSON.parse(localStorage.getItem('users') || '[]').find(x =>
                    String(x.id || x.uid || x.username || '') === id
                );
                return round2(u?.salary || 0);
            } catch(_) { return 0; }
        })();

        return `
            <div style="${borderStyle} border-radius:12px; padding:12px 14px; display:flex; justify-content:space-between; align-items:center; gap:12px;">
                <div style="min-width:200px;">
                    <div style="font-weight:800;color:#000000;font-size:15px;line-height:1.4;">${name} ${sysBadge}</div>
                    <div style="color:#666666;font-size:12px;margin-top:2px;">${role || ''} ${effectiveSalary ? `— الراتب: ${effectiveSalary} ج.م` : ''}</div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;align-items:center;">
                    ${isLocked ? lockedBadge : `
                        ${makeRadio('default')}
                        ${makeRadio('present')}
                        ${makeRadio('absent')}
                        ${makeRadio('vacation')}
                    `}
                </div>
            </div>`;
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

        // نجيب السجلات الموجودة لهذا اليوم لنتجنب التكرار
        const existingRecords = await loadAttendanceForDate(businessDate);
        const existingIds = new Set(existingRecords.map(r => String(r.employeeId ?? r.employee_id ?? '')));

        // جيب بيانات مستخدمي النظام من localStorage (للراتب)
        let sysUsersCache = [];
        try { sysUsersCache = JSON.parse(localStorage.getItem('users') || '[]'); } catch(_) {}

        for (const emp of employees) {
            const empId = String(emp.id ?? '');
            if (!empId) continue;

            // موظف مسجّل مسبقاً → تخطى تماماً (لا تعيد الكتابة ولا تخصم يومية مرة ثانية)
            if (existingIds.has(empId)) continue;

            const radioName = `att_${encodeURIComponent(empId)}`;
            const checked = document.querySelector(`input[name="${radioName}"]:checked`);
            const status = checked ? checked.value : 'default';

            if (status === 'default') continue;

            // ── مستخدمو النظام: أضفهم في جدول employees أولاً عشان يعدي الـ FK ──
            let effectiveSalary = parseFloat(emp.salary || 0);
            if (emp.isSystemUser && window.DBService) {
                try {
                    const sysUser = sysUsersCache.find(u =>
                        String(u.id || u.uid || u.username || '') === empId
                    );
                    if (sysUser?.salary) effectiveSalary = parseFloat(sysUser.salary) || 0;
                    // أدخل/حدّث السجل في جدول employees عشان يعدي الـ FK constraint
                    await window.DBService.saveEmployee({
                        id:     empId,
                        name:   emp.name  || '',
                        role:   emp.role  || '',
                        phone:  sysUser?.phone  || '',
                        salary: effectiveSalary,
                    });
                } catch (fkErr) {
                    console.warn('[saveAttendance] ensure system user in employees table:', fkErr.message);
                }
            } else {
                effectiveSalary = parseFloat(emp.salary || 0);
            }

            // حساب اليومية
            const dailyWage = effectiveSalary > 0 ? parseFloat((effectiveSalary / 30).toFixed(2)) : 0;
            const attendanceId = `${businessDate}_${empId}`;
            
            const attendanceRecord = {
                id: attendanceId,
                businessDate: businessDate, // نص صريح
                employeeId: empId,
                employeeName: emp.name || 'غير محدد',
                status, 
                dailyWage: dailyWage,
                markedBy,
                markedAt: egyptNow()
            };

            // حفظ الحضور — localStorage + SQLite
            upsertLocalArray('attendance', attendanceRecord);
            if (window.DBService) {
                try { await window.DBService.saveAttendance(attendanceRecord); } catch(e) { console.warn('[saveAttendance] SQLite:', e.message); }
            }
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

                // 1. حفظه في localStorage + SQLite
                upsertLocalArray('expenses', payrollExpense);
                upsertLocalArray('expensesHistory', payrollExpense);
                if (window.DBService) {
                    try { await window.DBService.saveExpense(payrollExpense); } catch(e) { console.warn('[saveAttendance] saveExpense SQLite:', e.message); }
                }

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
                    cost: firstVariant.costPrice || firstVariant.cost || item.cost || 0,
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
                cost: item.cost || 0, // 👈 السطر ده كان ناقص وهو اللي بيصفر التكلفة!
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

    async function _renderMenuFromCache() {
        // قراءة SQLite أولاً ثم localStorage كـ fallback
        try {
            let parsed = [];
            if (window.DBService) {
                try {
                    parsed = await window.DBService.getCategories() || [];
                } catch (e) {
                    console.warn('_renderMenuFromCache: DBService.getCategories failed:', e);
                    parsed = [];
                }
            } else {
                parsed = [];
            }
            const clean = _dedupById(parsed);
            if (clean.length !== parsed.length && window.DBService) {
                for (const cat of clean) {
                    try { await window.DBService.saveCategory(cat); } catch(_) {}
                }
            }
            if (!window.menuData) window.menuData = {};
            window.menuData.categories = clean;
        } catch (e) {
            if (!window.menuData) window.menuData = {};
            window.menuData.categories = [];
        }
        // رسم الفئات والمنتجات فوراً
        await initCategories();
        const categoryTabs = document.getElementById('categoryTabs');
        if (!categoryTabs || categoryTabs.children.length === 0) await initMenu();
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
                if (window.DBService) {
                    for (const cat of clean) {
                        try { await window.DBService.saveCategory(cat); } catch(_) {}
                    }
                }
                if (!window.menuData) window.menuData = {};
                window.menuData.categories = clean;
                if (clean.length !== prevCatLen) changed = true;
            }
            if (Array.isArray(fbItems) && fbItems.length > 0) {
                const clean = _dedupById(fbItems);
                if (window.DBService) {
                    for (const item of clean) {
                        try { await window.DBService.saveMenuItem(item); } catch(_) {}
                    }
                }
                if (changed || !window.menuData.items || window.menuData.items.length !== clean.length) {
                    if (!window.menuData) window.menuData = {};
                    window.menuData.items = clean;
                    changed = true;
                }
            }
            if (changed) {
                await initCategories();
                const categoryTabs = document.getElementById('categoryTabs');
                if (!categoryTabs || categoryTabs.children.length === 0) await initMenu();
            }
        } catch (e) {
            console.warn('Menu Firebase sync failed:', e);
        }
    }

    // المرحلة 1: عرض فوري من SQLite/localStorage
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
        // إعادة رسم المنتجات بالأسعار الأصلية
        if (typeof initCategories === 'function') initCategories();
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
  
             const prevOrders = orders.filter(o => (o.session_id || o.shift_id || o.shiftId) === prevSessionId); 
             const prevExpensesList = expenses.filter(e => (e.session_id || e.shift_id || e.shiftId) === prevSessionId); 
  
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
async function initCategories() {
    // 0. تحميل كاش الخامات (عشان حساب المخزون من الوصفات)
    if (!window._ingredientsCache || window._ingredientsCacheAge < Date.now() - 30000) {
        try {
            if (window.DBService && window.DBService.getIngredients) {
                window._ingredientsCache = await window.DBService.getIngredients() || [];
                window._ingredientsCacheAge = Date.now();
            }
        } catch(e) { window._ingredientsCache = []; }
    }

    // 1. لازم نعرف الفئات ونسحبها الأول قبل أي حاجة
    let categories = [];
    if (typeof window.menuData !== 'undefined' && window.menuData.categories && window.menuData.categories.length > 0) {
        categories = window.menuData.categories;
    } else {
        try {
            if (window.DBService) {
                categories = await window.DBService.getCategories() || [];
            }
        } catch (e) {
            console.warn('initCategories: DBService.getCategories failed:', e);
        }
        if (!categories || categories.length === 0) {
            categories = []; // SQLite هو المصدر الوحيد
        }
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
async function initMenu() {
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
            let dbCats = [], dbItems = [];
            if (window.DBService) {
                dbCats = await window.DBService.getCategories() || [];
                dbItems = await window.DBService.getMenuItems() || [];
            }
            if (dbCats.length > 0 && dbItems.length > 0) {
                data = { categories: dbCats, items: dbItems };
            } else {
                // Fallback to localStorage
                // SQLite هو المصدر الوحيد — لا نقرأ من localStorage
                data = { categories: [], items: [] };
            }
        } catch (e) {
            console.warn('initMenu: fallback from DBService/localStorage failed', e);
        }
    }
    if (!data) {
        menuGrid.innerHTML = '<div class="empty-state">⚠️ خطأ في تحميل البيانات</div>';
        return;
    }

    let items = [];
    const firstRunCompleted = localStorage.getItem('first_run_completed');
    // Try DBService first for menuItems
    let dbMenuItems = null;
    if (window.DBService) {
        try {
            dbMenuItems = await window.DBService.getMenuItems();
        } catch(_) {}
    }
    if (dbMenuItems && dbMenuItems.length > 0) {
        items = dbMenuItems;
    } else if (!firstRunCompleted && data && data.items) {
        // استخدام البيانات الافتراضية فقط إذا لم يكن أول تشغيل قد تم
        items = data.items || [];
        if (window.DBService) {
            for (const item of items) {
                try { await window.DBService.saveMenuItem(item); } catch(_) {}
            }
        }
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
    window._allMenuItems = items; // ← خزّن كل المنتجات عشان البحث العام

    menuGrid.innerHTML = '';

    // تحميل الفئات من SQLite/localStorage لتحديد selectedCategory
    let categories = [];
    // firstRunCompleted تم تعريفه أعلاه في نفس الدالة
    let dbCatsForMenu = null;
    if (window.DBService) {
        try {
            dbCatsForMenu = await window.DBService.getCategories();
        } catch(_) {}
    }
    if (dbCatsForMenu && dbCatsForMenu.length > 0) {
        categories = dbCatsForMenu;
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

    // ── Helper: ينشئ زرار المنتج الواحد ──────────────────────────────────────
    function _buildMenuItemBtn(item, visualIndex) {
        const menuItemBtn = document.createElement('button');
        menuItemBtn.className = 'menu-item-btn ripple';
        // الـ delay الأقصى 0.15 ثانية عشان المنتجات تظهر فوراً مهما كان عددهم
        menuItemBtn.style.animationDelay = `${Math.min(visualIndex * 0.02, 0.15)}s`;
        menuItemBtn.dataset.category = item.categoryId || '';

        // عرض سعر الـ aggregator لو مفعّل
        let effectivePrice = item.price || 0;
        if (activeAggregator && item.aggregatorPrices) {
            const aggName = activeAggregator.companyName || activeAggregator.name || activeAggregator.title || '';
            if (item.aggregatorPrices[aggName]) {
                effectivePrice = parseFloat(item.aggregatorPrices[aggName]);
            }
        }
        const displayPrice = item.variants && item.variants.length > 0
            ? `من ${Utils.formatCurrency(Math.min(...item.variants.map(v => v.price)))}`
            : (effectivePrice ? Utils.formatCurrency(effectivePrice) : '');

        const itemType = item.type || 'physical';
        let stockInfo = '';
        if (itemType === 'physical') {
            // حساب المخزون من الوصفة (أقصى عدد وجبات ممكنة)
            let stock = item.stock || 0;
            const recipe = item.recipe || [];
            if (recipe.length > 0 && window._ingredientsCache) {
                let maxServings = Infinity;
                for (const ri of recipe) {
                    const ingId = ri.ingredientId || ri.ingredient_id || ri.id;
                    const needed = parseFloat(ri.quantity || ri.amount || 0);
                    if (!ingId || needed <= 0) continue;
                    const ing = window._ingredientsCache.find(i => String(i.id) === String(ingId));
                    if (ing) {
                        const available = parseFloat(ing.quantity || ing.stock || ing.current_stock || 0);
                        maxServings = Math.min(maxServings, Math.floor(available / needed));
                    } else {
                        maxServings = 0;
                    }
                }
                if (maxServings !== Infinity && maxServings >= 0) {
                    stock = maxServings;
                }
            }
            const minStockLimit = item.minStockLimit || 5;
            const criticalStockLimit = item.criticalStockLimit !== undefined ? item.criticalStockLimit : 0;
            let quantityBgColor = 'linear-gradient(135deg, #27AE60 0%, #229954 100%)';
            if (stock <= criticalStockLimit) {
                quantityBgColor = 'linear-gradient(135deg, #E74C3C 0%, #C0392B 100%)';
            } else if (stock <= minStockLimit) {
                quantityBgColor = 'linear-gradient(135deg, #F39C12 0%, #E67E22 100%)';
            }
            stockInfo = `<div class="menu-item-stock-info"><div class="menu-item-stock-quantity" style="background:${quantityBgColor};">${stock}</div></div>`;
        } else {
            stockInfo = `<div class="menu-item-stock-info"><div class="menu-item-stock-quantity" style="background:linear-gradient(135deg,#3498DB 0%,#2980B9 100%);font-size:16px;">∞</div></div>`;
        }

        menuItemBtn.innerHTML = `
            ${stockInfo}
            <div class="menu-item-name">${item.name}</div>
            ${displayPrice ? `<div style="font-size:13px;color:#333;margin-top:8px;font-weight:bold;">${displayPrice}</div>` : ''}
        `;

        if (item.variants && item.variants.length > 0) {
            menuItemBtn.addEventListener('click', () => showVariantModal(item));
        } else {
            menuItemBtn.addEventListener('click', () => {
                addToCart({ ...item, price: Utils.roundToTwoDecimals(item.price || 0) });
            });
        }
        return menuItemBtn;
    }

    // ── Full Render (DocumentFragment = append واحد = أسرع) ──────────────────
    const frag = document.createDocumentFragment();
    filteredItems.forEach((item, i) => {
        frag.appendChild(_buildMenuItemBtn(item, i));
    });
    menuGrid.appendChild(frag);
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
            cost: selectedVariant.costPrice || selectedVariant.cost || selectedItemForVariant.cost || 0, // 👈 costPrice من menu.html
            variant: selectedVariant.name,
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
    const priceAdjustmentContainer = document.getElementById('priceAdjustmentContainer'); // 👈 عرفنا الزرار هنا 

    if (!cartItems || !cartSummary) return; 
    
    if (cart.length === 0) { 
        // 🛡️ إزالة الخصم/الزيادة تلقائياً لما السلة تفضى 
        window.orderGlobalDiscount = 0; 
        window.orderGlobalSurcharge = 0; 
        const discRow = document.getElementById('discountRow'); 
        if (discRow) discRow.style.display = 'none'; 
        cartItems.innerHTML = '<div class="empty-state">السلة فارغة</div>'; 
        cartSummary.style.display = 'none'; 
        if (orderTypeSelection) orderTypeSelection.style.display = 'none'; 
        if (priceAdjustmentContainer) priceAdjustmentContainer.style.display = 'none';
        const notesContainer = document.getElementById('orderNotesContainer');
        if (notesContainer) notesContainer.style.display = 'none';
        return;
    }

    if (orderTypeSelection) orderTypeSelection.style.display = 'block';
    if (priceAdjustmentContainer) priceAdjustmentContainer.style.display = 'block';
    const notesContainer = document.getElementById('orderNotesContainer');
    if (notesContainer) notesContainer.style.display = 'block';
    
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
                    <input type="number" class="quantity-value" value="${item.quantity}" min="1"
                        onchange="setQuantity(${index}, this.value)"
                        onclick="this.select()"
                        style="width: 48px; text-align: center; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 16px; font-weight: 700; padding: 4px 0; background: #fff; color: #000; -moz-appearance: textfield; outline: none;"
                    >
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
    // الضريبة لا تُطبق على أوردرات شركات التوصيل (Talabat, etc.)
    const isAggregatorOrder = !!activeAggregator;
    const taxAmount = Utils.roundToTwoDecimals(!isAggregatorOrder && taxRate > 0 ? (subtotal - discount) * (taxRate / 100) : 0);

    let serviceChargeAmount = 0;
    if (orderType === 'dinein' && serviceChargeRate > 0 && !isAggregatorOrder) {
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

// Set Quantity directly (from input)
window.setQuantity = function(index, value) {
    const qty = parseInt(value, 10);
    if (!qty || qty <= 0) {
        removeFromCart(index);
    } else {
        cart[index].quantity = qty;
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
        // Try DBService first
        if (window.DBService) {
            try {
                menuItems = await window.DBService.getMenuItems() || [];
            } catch (e) {
                console.warn('decreaseStockForOrder: DBService.getMenuItems failed:', e);
                menuItems = [];
            }
        }
        if (!menuItems || menuItems.length === 0) {
            // SQLite هو المصدر الوحيد
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

        // Save updated menuItems to SQLite
        if (window.DBService) {
            for (const item of menuItems) {
                try { await window.DBService.saveMenuItem(item); } catch(_) {}
            }
        }

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

        // Load ingredients (SQLite first, then localStorage fallback)
        let ingredients = [];
        if (window.DBService) {
            try {
                ingredients = await window.DBService.getIngredients() || [];
            } catch (e) {
                console.warn('decreaseIngredientsStockForOrder: DBService.getIngredients failed:', e);
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
                if (window.DBService) {
                    for (const ing of ingredients) {
                        try { await window.DBService.saveIngredient(ing); } catch(_) {}
                    }
                }
            } catch (e) {
                console.warn('Could not fetch ingredients from Firebase:', e);
            }
        }

        // If we still have no ingredients locally, we can still try Firestore decrements
        // (but local UI won't reflect until next sync/mirror refresh).

        // Load menu items to resolve recipes (source of truth)
        let menuItems = [];
        if (window.DBService) {
            try {
                menuItems = await window.DBService.getMenuItems() || [];
            } catch (e) {
                console.warn('decreaseIngredientsStockForOrder: DBService.getMenuItems failed:', e);
            }
        }
        // menuItems فارغة — SQLite هو المصدر الوحيد

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

        // 🚀 الحل الجذري لمشكلة المخزون اللي بيرجع يزيد 
         ingredients.forEach(ing => { 
             const consumed = consumptionByIngredientId.get(ing.id); 
             if (consumed && consumed > 0) { 
                 const currentStock = Number(ing.stock ?? ing.quantity ?? 0); 
                 const newStock = Math.max(0, currentStock - consumed); 
                 ing.stock = newStock; 
                 ing.quantity = newStock; 
                 ing.current_stock = newStock; 
                 
                 // إجبار الفايربيز يقبل الخصم عشان ميرجعش يملى المخزون تاني لما تعمل ريفريش 
                 if (window.SyncManager) { 
                     window.SyncManager.addToSyncQueue('ingredients', 'update', ing, `local_${ing.id}`); 
                 } else if (window.FirestoreService && typeof window.FirestoreService.updateIngredient === 'function') { 
                     window.FirestoreService.updateIngredient(ing); 
                 } 
             } 
         }); 
         if (window.DBService) {
             for (const ing of ingredients) {
                 try { await window.DBService.saveIngredient(ing); } catch(_) {}
             }
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
        // الضريبة لا تُطبق على أوردرات شركات التوصيل
        const isAggregatorOrder = !!activeAggregator;
        const taxAmount = Utils.roundToTwoDecimals(!isAggregatorOrder && taxRate > 0 ? (baseSubtotal - discount + surcharge) * (taxRate / 100) : 0);
        let serviceChargeAmount = 0;
        if (orderType === 'dinein' && serviceChargeRate > 0 && !isAggregatorOrder) {
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

        // 🚀 الحل الجذري لحساب تكلفة الخامات (COGS)
         const totalCost = cart.reduce((sum, item) => {
             let itemCost = parseFloat(item.cost) || parseFloat(item.costPrice) || 0;
             // لو التكلفة صفر، هنجيبها بالعافية من المنيو
             if (itemCost === 0 && window.globalMenuData && window.globalMenuData.items) {
                 const originalItem = window.globalMenuData.items.find(i => String(i.id) === String(item.id));
                 if (originalItem) {
                     itemCost = parseFloat(originalItem.cost) || parseFloat(originalItem.costPrice) || parseFloat(originalItem.buyingPrice) || 0;
                 }
             }
             return sum + (itemCost * item.quantity);
         }, 0);
        
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
            totalCost: Utils.roundToTwoDecimals(totalCost), // 👈 حفظ التكلفة عشان التقارير تقرأها
            orderSource: activeAggregator ? (activeAggregator.companyName || activeAggregator.name || activeAggregator.title || activeAggregator.en_name || activeAggregator.ar_name || 'شركة توصيل') : 'direct',
            aggregatorMarkup: markupAmount,
            expectedCommission: activeAggregator ? Utils.roundToTwoDecimals(orderTotal * (activeAggregator.commissionPercentage / 100)) : 0,
            notes: (document.getElementById('orderNotes')?.value || '').trim() || undefined,
        };

        // ── الأوردر والبيع — لازم await عشان الـ ID يتولد ──
        await DataManager.saveOrder(order);

        await DataManager.saveSale({
            id: 'SALE-' + order.id,
            orderId: order.id,
            amount: Utils.roundToTwoDecimals(orderTotal),
            date: egyptNow(),
            businessDate: businessDate
        });

        // ── إرسال الأوردر للمطبخ KDS (في الخلفية) ──
        if (typeof window.sendOrderToKDS === 'function') {
            window.sendOrderToKDS(order).catch(e => console.warn('KDS send err', e));
        }

        // ── المخزون والنقاط — في الخلفية عشان متأخرش الـ UI ──
        Promise.all([
            decreaseStockForOrder(order.items).catch(e => console.warn('stock err', e)),
            decreaseIngredientsStockForOrder(order.items).catch(e => console.warn('ing err', e)),
        ]);

        // ── تحديث نقاط العميل في الخلفية (لا await) ──
        // 🔧 دعم الدليفري: لو مفيش currentOrderCustomer بس في deliveryInfo.phone → نبحث بالرقم
        const _customerPhone = window.currentOrderCustomer?.phone || deliveryInfo?.phone;
        if (_customerPhone) {
            (async () => {
                try {
                    let dbCustomer = null;
                    // بحث بالرقم — SQLite أولاً (Offline-First) ثم Firebase
                    if (window.DBService && window.DBService.getCustomerByPhone) {
                        dbCustomer = await window.DBService.getCustomerByPhone(_customerPhone);
                    }
                    if (!dbCustomer && window.FirestoreService && window.FirestoreService.getCustomerByPhone) {
                        dbCustomer = await window.FirestoreService.getCustomerByPhone(_customerPhone);
                    }
                    // لو العميل مش موجود وفيه بيانات دليفري → أنشئ كارت جديد
                    if (!dbCustomer) {
                        if (deliveryInfo && deliveryInfo.phone) {
                            dbCustomer = {
                                phone:       deliveryInfo.phone,
                                name:        deliveryInfo.customerName || 'عميل دليفري',
                                address:     deliveryInfo.address || '',
                                tier:        'regular',
                                points:      0,
                                ordersCount: 0,
                                totalSpent:  0,
                                createdAt:   egyptNow(),
                            };
                            console.log('🆕 إنشاء كارت عميل جديد من الدليفري:', deliveryInfo.phone);
                        } else {
                            return;
                        }
                    }
                    const loyalty = await _loadLoyaltySettings();
                    const egpPerPoint = parseInt(loyalty.egpPerPoint) || 10;
                    const silverTier = parseInt(loyalty.silver)    || 100;
                    const goldTier   = parseInt(loyalty.gold)      || 500;
                    const vipTier    = parseInt(loyalty.vip)       || 1000;
                    const newPoints  = Math.floor(orderTotal / egpPerPoint);
                    const updatedData = {
                        ...dbCustomer,
                        ordersCount:     (dbCustomer.ordersCount  || dbCustomer.total_orders || 0) + 1,
                        points:          (dbCustomer.points       || 0) + newPoints,
                        totalSpent:      (dbCustomer.totalSpent   || dbCustomer.total_spent || 0) + orderTotal,
                        lastOrderDate:   egyptNow(),
                        lastOrderAmount: orderTotal,
                    };
                    if      (updatedData.points >= vipTier)    updatedData.tier = 'vip';
                    else if (updatedData.points >= goldTier)   updatedData.tier = 'gold';
                    else if (updatedData.points >= silverTier) updatedData.tier = 'silver';
                    // حفظ في SQLite أولاً (Offline-First) ثم Firebase في الخلفية
                    if (window.DBService) {
                        await window.DBService.saveCustomer(updatedData);
                    }
                    if (window.FirestoreService && window.FirestoreService.saveCustomer) {
                        window.FirestoreService.saveCustomer(updatedData).catch(e => console.warn('Firebase customer sync:', e.message));
                    }
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
        const notesEl = document.getElementById('orderNotes');
        if (notesEl) notesEl.value = '';
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
 let _isCheckingSession = false; 
 let _sessionCheckedOnce = false; 
 
 // ════════════════════════════════════════════════════════════════════════════
 // نظام الشيفت — مبني من الصفر على SQLite كمصدر وحيد للحقيقة
 // ════════════════════════════════════════════════════════════════════════════

 async function checkCashDrawerSession() {
     if (_isCheckingSession) return;
     _isCheckingSession = true;
     try {
         // SQLite هو المرجع الوحيد — مش DataManager ومش Firebase
         const openShift = window.DBService ? await window.DBService.getOpenSession() : null;
         const closeDayBtn = document.getElementById('closeDayBtn');
         const openModal   = document.getElementById('openCashDrawerModal');

         if (openShift) {
             if (closeDayBtn) closeDayBtn.style.display = 'flex';
             if (openModal)  { openModal.classList.remove('active'); openModal.style.display = 'none'; }
         } else {
             if (closeDayBtn) closeDayBtn.style.display = 'none';
             if (openModal)  { openModal.classList.add('active');    openModal.style.display = 'flex'; }
         }
     } catch(e) {
         console.error('[checkCashDrawerSession]', e);
     } finally {
         _isCheckingSession = false;
     }
 }
 window.checkCashDrawerSession = checkCashDrawerSession;
 

window.handleOpenCashDrawer = async function(event) {
    event.preventDefault();
    const btn = event.submitter || event.target.querySelector('[type=submit]');
    if (btn) { btn.disabled = true; btn.textContent = 'جاري الفتح...'; }

    try {
        const openingBalance = Math.max(0, parseFloat(document.getElementById('openingAmount').value) || 0);
        const currentUser = (typeof Auth !== 'undefined' && Auth.getUsername) ? Auth.getUsername() : (localStorage.getItem('username') || 'Admin');
        const now = (typeof egyptNow === 'function') ? egyptNow() : new Date().toISOString();
        const today = now.slice(0, 10).replace(/-/g, '');
        const shiftId = `SHIFT-${today}-${Date.now().toString().slice(-6)}`;

        // 1. حفظ في SQLite أولاً (المصدر الوحيد للحقيقة)
        await window.DBService.saveCashSession({
            id: shiftId,
            opened_by: currentUser,
            opening_balance: openingBalance,
            status: 'open',
            opened_at: now,
        });

        // 2. مزامنة Firebase في الخلفية
        if (window.SyncManager) {
            window.SyncManager.addToSyncQueue('shifts', 'add', {
                id: shiftId,
                opened_by: currentUser,
                opening_balance: openingBalance,
                status: 'open',
                opened_at: now,
            }, shiftId);
        }

        closeOpenCashDrawerModal();
        if (typeof Notification !== 'undefined') Notification.success('تم فتح الشيفت بنجاح');
        const closeDayBtn = document.getElementById('closeDayBtn');
        if (closeDayBtn) closeDayBtn.style.display = 'flex';
        setTimeout(async () => await initDashboard(), 300);
    } catch(e) {
        console.error('[handleOpenCashDrawer]', e);
        if (typeof Notification !== 'undefined') Notification.error('فشل فتح الشيفت');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'فتح الدرج'; }
    }
};

window.closeOpenCashDrawerModal = function() {
    const modal = document.getElementById('openCashDrawerModal');
    if (modal) { modal.classList.remove('active'); modal.style.display = 'none'; }
    const form = document.getElementById('openCashDrawerForm');
    if (form) form.reset();
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
    return egyptNow().split('T')[0];
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
        // SQLite أولاً
        const openShift = window.DBService ? await window.DBService.getOpenSession() : null;
        if (!openShift) {
            if (typeof Notification !== 'undefined') Notification.error('لا يوجد شيفت مفتوح');
            return;
        }
        const sessionId = openShift.id;

        // جلب الأوردرات والمصاريف والمنصات من SQLite
        const [orders, allExpenses, aggregators] = await Promise.all([
            window.DBService.getOrders({ session_id: sessionId }),
            window.DBService.getExpenses(),
            window.DBService.getAggregators(),
        ]);

        const sessionOrders   = orders;  // getOrders already filtered by session_id
        const sessionExpenses = allExpenses.filter(e => (e.session_id || e.shift_id || e.shiftId) === sessionId);

        // بناء خريطة منصات التوصيل (id → name)
        const aggMap = {};
        aggregators.forEach(a => { if (a.id) aggMap[a.id] = a.name || a.companyName || a.id; });

        // ═══ حساب المبيعات ═══
        let grossCash = 0, netCash = 0, grossCard = 0, netCard = 0;
        const aggMap2 = {}; // { name: { count, total } }

        sessionOrders.forEach((order) => {
            const orderTotal = _getOrderTotal(order);
            const orderGross = _getOrderGrossTotal(order);
            const paymentMethod = _getOrderPaymentMethod(order);
            const orderSource = order.orderSource || 'direct';
            const orderDiscount = parseFloat(order.discount) || 0;
            const orderGrossTotal = _getOrderGrossTotal(order); // إجمالي قبل الخصم

            const src = order.orderSource || order.order_source || 'direct';
            const aggId = order.aggregator_id || order.aggregatorId || '';
            const companyName = aggId ? (aggMap[aggId] || aggId) : (src !== 'direct' ? src : null);

            // كل أوردر بيتحسب في الكاش أو الفيزا بناءً على طريقة الدفع — حتى لو من شركة توصيل
            if (_isCashPaymentMethod(paymentMethod)) {
                grossCash += orderGross;
                netCash   += orderTotal;
            } else {
                grossCard += orderGross;
                netCard   += orderTotal;
            }

            // شركات التوصيل بتتتبع بشكل منفصل لقسم التوصيل (بغض النظر عن طريقة الدفع)
            if (companyName) {
                if (!aggMap2[companyName]) aggMap2[companyName] = { count: 0, total: 0 };
                aggMap2[companyName].count++;
                aggMap2[companyName].total += orderTotal;
            }
        });

        const cashDiscount  = Utils.roundToTwoDecimals(grossCash - netCash);
        const cardDiscount  = Utils.roundToTwoDecimals(grossCard - netCard);
        const totalExpenses = Utils.roundToTwoDecimals(
            sessionExpenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)
        );
        const openingBal    = parseFloat(openShift.opening_balance || openShift.openingAmount || 0);
        const expectedAmount = Utils.roundToTwoDecimals(openingBal + netCash - totalExpenses);

        // ═══ عرض قسم التوصيل بعدد الأوردرات جوا المودال ═══
        const aggContainer = document.getElementById('aggregatorSalesContainer');
        if (aggContainer) {
            const aggEntries = Object.entries(aggMap2).filter(([,v]) => v.count > 0);
            if (aggEntries.length > 0) {
                const totalAgg = aggEntries.reduce((s,[,v]) => s + v.total, 0);
                aggContainer.innerHTML = `
                    <div style="font-weight:700; color:#c2410c; font-size:13px; margin-bottom:10px;">🛵 مبيعات التوصيل</div>
                    ${aggEntries.map(([name, {total}]) => `
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                            <span style="color:#78350f; font-size:13px;">${name}</span>
                            <strong class="_ms-val" style="color:#c2410c; font-size:13px;">${Utils.formatCurrency(total)}</strong>
                        </div>`).join('')}
                    <div style="border-top:1px dashed #fed7aa; margin-top:8px; padding-top:8px; display:flex; justify-content:space-between;">
                        <span style="font-weight:700; color:#92400e;">الإجمالي:</span>
                        <strong class="_ms-val" style="color:#92400e;">${Utils.formatCurrency(totalAgg)}</strong>
                    </div>`;
                aggContainer.style.display = 'block';
            } else {
                aggContainer.style.display = 'none';
            }
        }

        // ═══ عرض باقي البيانات ═══
        document.getElementById('closeOpeningAmount').textContent = Utils.formatCurrency(openingBal);
        document.getElementById('closeCashGross').textContent     = Utils.formatCurrency(grossCash);
        const cashDiscRow = document.getElementById('closeCashDiscountRow');
        if (cashDiscRow) cashDiscRow.style.display = cashDiscount > 0 ? 'flex' : 'none';
        document.getElementById('closeCashDiscount').textContent  = Utils.formatCurrency(cashDiscount);
        document.getElementById('closeCashNet').textContent       = Utils.formatCurrency(netCash);
        document.getElementById('closeVisaGross').textContent     = Utils.formatCurrency(grossCard);
        const visaDiscRow = document.getElementById('closeVisaDiscountRow');
        if (visaDiscRow) visaDiscRow.style.display = cardDiscount > 0 ? 'flex' : 'none';
        document.getElementById('closeVisaDiscount').textContent  = Utils.formatCurrency(cardDiscount);
        document.getElementById('closeVisaNet').textContent       = Utils.formatCurrency(netCard);
        const netSummaryEl = document.getElementById('closeCashNetSummary');
        if (netSummaryEl) netSummaryEl.textContent = Utils.formatCurrency(netCash);
        document.getElementById('closeTotalExpenses').textContent = Utils.formatCurrency(totalExpenses);
        document.getElementById('closeExpectedAmount').textContent = Utils.formatCurrency(expectedAmount);
        document.getElementById('closingAmount').value = Math.max(0, expectedAmount).toFixed(2);

        calculateDifference();
        const modal = document.getElementById('closeCashDrawerModal');
        if (modal) { modal.classList.add('active'); modal.style.display = 'flex'; }

        // تطبيق التشفير على الأرقام الحساسة بعد ما اتملت
        if (typeof window._applyModalSecure === 'function') window._applyModalSecure();

    } catch(error) {
        console.error('[openCloseCashDrawerModal]', error);
        if (typeof Notification !== 'undefined') Notification.error('حدث خطأ في شاشة الإغلاق');
    }
};

window.calculateDifference = function() {
    const closingAmount  = parseFloat(document.getElementById('closingAmount').value) || 0;
    // اقرأ القيمة الحقيقية (data-real-ms) لو الأرقام مشفرة
    const expEl = document.getElementById('closeExpectedAmount');
    const expRaw = expEl ? (expEl.dataset.realMs || expEl.textContent || '0') : '0';
    const expectedAmount = parseFloat(expRaw.replace(/[^\d.-]/g, '')) || 0;
    const diff = Utils.roundToTwoDecimals(closingAmount - expectedAmount);
    const el = document.getElementById('closeDifference');
    if (el) {
        const formatted = Utils.formatCurrency(diff);
        el.dataset.realMs = formatted;
        el.textContent = (window._modalSecureUnlocked === false) ? '****' : formatted;
        el.style.color = Math.abs(diff) < 0.01 ? '#000' : diff < 0 ? '#e74c3c' : '#27ae60';
    }
};

window.handleCloseCashDrawer = async function(e) {
    if (e) e.preventDefault();
    const btn = document.querySelector('#closeCashDrawerModal [type=submit], #closeCashDrawerModal .btn-primary');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإغلاق...'; }

    try {
        // SQLite أولاً
        const openShift = window.DBService ? await window.DBService.getOpenSession() : null;
        if (!openShift) {
            if (typeof Notification !== 'undefined') Notification.error('لا يوجد شيفت مفتوح');
            return;
        }

        const closingBalance = parseFloat(document.getElementById('closingAmount')?.value) || 0;
        const notes = document.getElementById('closingNotes')?.value || '';
        const now = (typeof egyptNow === 'function') ? egyptNow() : new Date().toISOString();

        // ═══ احسب الأرقام النهائية من الأوردرات واحفظها — عشان الشيفت يبقى ثابت ومش بيتحسب من جديد ═══
        let finalCashSales = 0, finalVisaSales = 0, finalAggSales = 0, finalExpenses = 0;
        let finalCashDiscount = 0;       // للطباعة فقط
        const soldItemsMap = {};         // { itemName: totalQty }       للطباعة فقط
        const aggregatorForPrint = {};   // { companyName: totalAmount }  للطباعة فقط
        try {
            const [shiftOrders, shiftExpenses, aggregators] = await Promise.all([
                window.DBService.getOrders({ session_id: openShift.id }),
                window.DBService.getExpenses(),
                window.DBService.getAggregators(),
            ]);
            const aggMapClose = {};
            aggregators.forEach(a => { if (a.id) aggMapClose[a.id] = a.name || a.id; });
            const sessionExp = shiftExpenses.filter(e => (e.session_id || e.shift_id || e.shiftId) === openShift.id);
            finalExpenses = sessionExp.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

            shiftOrders.forEach(o => {
                const total = _getOrderTotal(o);
                const gross = _getOrderGrossTotal(o);
                const pm = String(_getOrderPaymentMethod(o)).toLowerCase();
                if (pm.includes('visa') || pm.includes('card')) {
                    finalVisaSales += total;
                } else {
                    finalCashSales += total;
                    finalCashDiscount += Math.max(0, gross - total);
                }
                const src = o.orderSource || o.order_source || 'direct';
                const aggId = o.aggregator_id || o.aggregatorId || '';
                if (aggId || src !== 'direct') {
                    finalAggSales += total;
                    const cName = aggId ? (aggMapClose[aggId] || aggId) : src;
                    aggregatorForPrint[cName] = (aggregatorForPrint[cName] || 0) + total;
                }
                // جرد المنتجات لتقرير الطباعة
                (o.items || []).forEach(item => {
                    const iName = item.name || item.itemName || '—';
                    const iQty  = parseInt(item.quantity || item.qty || 1);
                    soldItemsMap[iName] = (soldItemsMap[iName] || 0) + iQty;
                });
            });
        } catch(calcErr) {
            console.warn('[handleCloseCashDrawer] totals calc failed:', calcErr);
        }

        const updateData = {
            status: 'closed',
            closing_balance: closingBalance,
            closed_at: now,
            notes: notes,
            cash_sales: Math.round(finalCashSales * 100) / 100,
            visa_sales: Math.round(finalVisaSales * 100) / 100,
            aggregator_sales: Math.round(finalAggSales * 100) / 100,
            total_expenses: Math.round(finalExpenses * 100) / 100,
        };

        // 1. SQLite
        await window.DBService.updateCashSession(openShift.id, updateData);

        // ═══ طباعة تقرير الشيفت (Z-Report) ═══
        try {
            const openingBal   = parseFloat(openShift.opening_balance || openShift.openingAmount || 0);
            const expectedCash = Utils.roundToTwoDecimals(openingBal + finalCashSales - finalExpenses);
            const diff         = Utils.roundToTwoDecimals(closingBalance - expectedCash);
            const diffText     = diff === 0 ? '✅ مطابق'
                               : diff > 0   ? `↑ زيادة ${Utils.formatCurrency(diff)}`
                               :              `↓ عجز ${Utils.formatCurrency(Math.abs(diff))}`;

            const openedAt = _safeToDate(openShift.opened_at || openShift.openedAt || openShift.createdAt);
            const closedAt = _safeToDate(now);
            const _stoName = (() => {
                try {
                    const _s = JSON.parse(localStorage.getItem('storeSettings') || '{}');
                    const _f = JSON.parse(localStorage.getItem('settings') || '{}');
                    return localStorage.getItem('solo_store_name') || _f.storeName || _s.storeName || 'Solo POS';
                } catch(_e) { return 'Solo POS'; }
            })();
            const _stoAddr = (() => {
                try {
                    const _s = JSON.parse(localStorage.getItem('storeSettings') || '{}');
                    const _f = JSON.parse(localStorage.getItem('settings') || '{}');
                    return _s.address || _f.address || localStorage.getItem('solo_user_address') || '';
                } catch(_e) { return ''; }
            })();
            const _stoPhones = (() => {
                try {
                    const _s = JSON.parse(localStorage.getItem('storeSettings') || '{}');
                    const _f = JSON.parse(localStorage.getItem('settings') || '{}');
                    const first = _s.phone || _f.phone || localStorage.getItem('solo_user_phone') || '';
                    const extras = JSON.parse(localStorage.getItem('solo_user_extra_phones') || '[]');
                    return [...new Set([first, ...extras].filter(Boolean))];
                } catch(_e) { return []; }
            })();
            const _fmt = (d, opts) => d ? d.toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', ...opts }) : '—';

            const shiftReportData = {
                storeName:       _stoName,
                storeAddress:    _stoAddr,
                storePhones:     _stoPhones,
                date:            _fmt(openedAt, { year: 'numeric', month: '2-digit', day: '2-digit' }),
                cashierName:     openShift.cashier_name || openShift.cashierName || '—',
                startTime:       _fmt(openedAt, { hour: '2-digit', minute: '2-digit' }),
                endTime:         _fmt(closedAt, { hour: '2-digit', minute: '2-digit' }),
                openingAmount:   openingBal,
                cashSales:       Math.round(finalCashSales   * 100) / 100,
                discounts:       Math.round(finalCashDiscount * 100) / 100,
                expenses:        Math.round(finalExpenses     * 100) / 100,
                expectedCash:    expectedCash,
                actualCash:      closingBalance,
                differenceText:  diffText,
                visaSales:       Math.round(finalVisaSales * 100) / 100,
                aggregatorSales: aggregatorForPrint,
                soldItems:       Object.entries(soldItemsMap).map(([name, qty]) => ({ name, qty })),
            };
            if (typeof window.printShiftReceipt === 'function') {
                setTimeout(() => window.printShiftReceipt(shiftReportData), 500);
            }
        } catch(printErr) {
            console.warn('[handleCloseCashDrawer] Z-Report print failed:', printErr);
        }

        // 2. Firebase في الخلفية
        if (window.SyncManager) {
            window.SyncManager.addToSyncQueue('shifts', 'update', { id: openShift.id, ...updateData }, openShift.id);
        }

        closeCloseCashDrawerModal();
        const closeDayBtn = document.getElementById('closeDayBtn');
        if (closeDayBtn) closeDayBtn.style.display = 'none';
        if (typeof Notification !== 'undefined') Notification.success('تم إغلاق الشيفت بنجاح');

        setTimeout(() => window.location.reload(), 1500);

    } catch(error) {
        console.error('[handleCloseCashDrawer]', error);
        if (typeof Notification !== 'undefined') Notification.error('حدث خطأ في الإغلاق');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = 'إغلاق اليوم'; }
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
    const todaySession = await  DataManager.getTodayCashSession(); 
    if (!todaySession || todaySession.status !== 'open' ) { 
        if (typeof Notification !== 'undefined' ) { 
            Notification.error('يجب فتح شيفت نقدي أولاً' ); 
        } else  { 
            alert('يجب فتح شيفت نقدي أولاً' ); 
        } 
        return ; 
    } 
    
    const modal = document.getElementById('addExpenseModal' ); 
    if  (modal) { 
        modal.style.display = 'flex' ; 
        modal.classList.add('active'); // 👈 السطر السحري اللي هيظهر المودال ويشيل الفريز 
        document.getElementById('addExpenseForm' ).reset(); 
    } 
};

window.closeAddExpenseModal = function() { 
    const modal = document.getElementById('addExpenseModal' ); 
    if  (modal) { 
        modal.style.display = 'none' ; 
        modal.classList.remove('active'); // 👈 لازم نشيله وإحنا بنقفل عشان ميخرفش بعدين 
    } 
    document.getElementById('addExpenseForm' ).reset(); 
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
        createdAt: egyptNow(), // استخدام التوقيت المحلي
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
    if (!searchInput) return;

    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.trim().toLowerCase();
        const menuGrid = document.getElementById('menuGrid');
        if (!menuGrid) return;

        // لو مفيش نص → رجّع الفئة الحالية
        if (!searchTerm) {
            initMenu();
            return;
        }

        // ابحث في كل المنتجات (مش بس الفئة الحالية)
        const allItems = window._allMenuItems || [];
        const matched = allItems.filter(item =>
            (item.name || '').toLowerCase().includes(searchTerm)
        );

        menuGrid.innerHTML = '';
        if (matched.length === 0) {
            menuGrid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;text-align:center;padding:40px;color:#999;">لا توجد نتائج</div>';
            return;
        }

        const frag = document.createDocumentFragment();
        matched.forEach((item, i) => {
            // نفس بناء الزرار المستخدم في initMenu
            const btn = document.createElement('button');
            btn.className = 'menu-item-btn ripple';
            btn.style.animationDelay = `${Math.min(i * 0.02, 0.15)}s`;
            btn.dataset.category = item.categoryId || '';

            let effectivePrice = item.price || 0;
            if (activeAggregator && item.aggregatorPrices) {
                const aggName = activeAggregator.companyName || activeAggregator.name || activeAggregator.title || '';
                if (item.aggregatorPrices[aggName]) effectivePrice = parseFloat(item.aggregatorPrices[aggName]);
            }
            const displayPrice = item.variants && item.variants.length > 0
                ? `من ${Utils.formatCurrency(Math.min(...item.variants.map(v => v.price)))}`
                : (effectivePrice ? Utils.formatCurrency(effectivePrice) : '');

            const hasImage = item.image && item.image !== 'null' && item.image !== '';
            btn.innerHTML = `
                <div class="menu-item-image" style="${hasImage ? `background-image:url('${item.image}');background-size:cover;background-position:center;` : 'background:#f5f5f5;'}">
                    ${!hasImage ? `<div class="menu-item-placeholder"><i class="fas fa-utensils" style="font-size:28px;color:#ccc;"></i></div>` : ''}
                </div>
                <div class="menu-item-info">
                    <div class="menu-item-name">${item.name || ''}</div>
                    <div class="menu-item-price">${displayPrice}</div>
                </div>`;

            btn.addEventListener('click', () => {
                if (item.variants && item.variants.length > 0) {
                    showVariantModal(item);
                } else {
                    addToCart(item);
                }
            });
            frag.appendChild(btn);
        });
        menuGrid.appendChild(frag);
    });
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
            let expenses = [];
            let history = [];
            if (window.DBService) {
                try {
                    expenses = await window.DBService.getExpenses() || [];
                    history = await window.DBService.getExpensesHistory() || [];
                } catch (e) {
                    console.warn('Self-healing: DBService failed:', e);
                    expenses = [];
                    history = [];
                }
            } else {
                expenses = [];
                history = [];
            }
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
         let rawData = [];
         if (window.DBService) {
             try {
                 rawData = await window.DBService.getAggregators() || [];
             } catch (e) {
                 console.warn('loadAggregatorsForPOS: DBService.getAggregators failed:', e);
             }
         }
         // SQLite هو المصدر الوحيد — لا نقرأ من localStorage

         if (navigator.onLine && window.FirestoreService) {
             const firestoreData = await window.FirestoreService.getCollection('aggregators');
             if (firestoreData && firestoreData.length > 0) {
                 rawData = firestoreData;
                 if (window.DBService) {
                     for (const agg of firestoreData) {
                         try { await window.DBService.saveAggregator(agg); } catch(_) {}
                     }
                 }
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
             // إعادة رسم المنتجات عشان تظهر بأسعار الـ aggregator
             if (typeof initCategories === 'function') initCategories();
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
    
    const modal = document.getElementById('priceAdjustModal'); 
    modal.style.display = 'flex'; 
    modal.classList.add('active'); // 👈 السطر السحري اللي كان ناقص 
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
                <h2>${shiftData.storeName || 'Solo POS'}</h2>
                ${shiftData.storeAddress ? `<div style="font-size: 12px; margin-top: 3px;">${shiftData.storeAddress}</div>` : ''}
                ${(shiftData.storePhones || []).map(p => `<div style="font-size: 12px;">Tel: ${p}</div>`).join('')}
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
             
             // 🔍 البحث عن العميل أولاً بالرقم — لو موجود نحدّثه بدل ما نعمل كارت جديد
             let existingCustomer = null;
             try {
                 if (window.FirestoreService && window.FirestoreService.getCustomerByPhone) {
                     existingCustomer = await window.FirestoreService.getCustomerByPhone(phone);
                 } else if (window.DBService && window.DBService.getCustomerByPhone) {
                     existingCustomer = await window.DBService.getCustomerByPhone(phone);
                 }
             } catch(_) {}

             const newCustomer = existingCustomer
                 ? { ...existingCustomer, name: name || existingCustomer.name, address: address || existingCustomer.address }
                 : { phone, name, address, tier: 'regular', points: 0, ordersCount: 0, totalSpent: 0, createdAt: egyptNow() };

             try {
                if (window.FirestoreService && window.FirestoreService.saveCustomer) {
                    await window.FirestoreService.saveCustomer(newCustomer);
                } else {
                    if (window.DBService) {
                        try {
                            await window.DBService.saveCustomer(newCustomer);
                        } catch (e) {
                            console.warn('saveCustomer to DBService failed:', e);
                        }
                    }
                }

                // تحديث بيانات السلة بالعميل
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

