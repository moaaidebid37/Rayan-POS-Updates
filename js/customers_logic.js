// js/customers_logic.js - المخ المسؤول عن صفحة العملاء
// ==========================================================
// 🚀 Offline-First & Pagination & Search Logic
// ==========================================================
let currentPage = 1;
const customersPerPage = 24; // أنسب رقم لسرعة الصفحة وتناسق الكروت
let allCustomers = [];
let filteredCustomers = [];

// 1. أمر التشغيل الأساسي
document.addEventListener('DOMContentLoaded', async () => {
    await loadCustomersWithCache();
    setupPagination();
    setupSearch();
    await loadLoyaltySettings();
});

// 2. دالة جلب العملاء واسترجاع الداتا القديمة
async function loadCustomersWithCache() {
    const listContainer = document.getElementById('customersContainer');
    if (!listContainer) return;

    try {
        let customers = [];

        // 🚀 SQLite أولاً (Offline-First + Tenant Isolation)
        if (window.DBService) {
            try {
                customers = await window.DBService.getCustomers();
            } catch(e) { console.warn('[Customers] DBService.getCustomers err:', e.message); }
        }

        // 🌐 مزامنة Firebase في الخلفية
        if (window.FirestoreService && typeof window.FirestoreService.getAllCustomers === 'function') {
            setTimeout(async () => {
                try {
                    const remoteData = await window.FirestoreService.getAllCustomers();
                    if (remoteData && remoteData.length > 0 && window.DBService) {
                        for (const c of remoteData)
                            await window.DBService.saveCustomer(c, { alreadySynced: true });
                    }
                } catch(e) {}
            }, 3000);
        }

        // ⚠️ خطة إنقاذ الداتا: لو SQLite فاضية نهاجر من localStorage مرة واحدة
        if ((!customers || customers.length === 0) && window.DBService) {
            let legacyData = [];
            try {
                const oldData = JSON.parse(localStorage.getItem('customers') || '[]');
                const newData = JSON.parse(localStorage.getItem('offline_customers') || '[]');
                legacyData = oldData.length > newData.length ? oldData : newData;
            } catch(e) {}
            if (legacyData.length > 0) {
                for (const c of legacyData) {
                    try { await window.DBService.saveCustomer(c); } catch(e) {}
                }
                // بعد الترحيل الناجح، امسح البيانات القديمة
                localStorage.removeItem('customers');
                localStorage.removeItem('offline_customers');
                customers = legacyData;
            }
        }

        allCustomers = customers || [];
        allCustomers.sort((a, b) => (b.points || 0) - (a.points || 0));

        const searchBox = document.getElementById('headerSearch') || document.getElementById('customerSearchInput');
        const searchTerm = searchBox ? searchBox.value.toLowerCase() : '';

        if (searchTerm) {
            filteredCustomers = allCustomers.filter(cust =>
                (cust.name && cust.name.toLowerCase().includes(searchTerm)) ||
                (cust.phone && cust.phone.includes(searchTerm))
            );
        } else {
            filteredCustomers = allCustomers;
        }

        updateCustomersUI();

    } catch (error) {
        console.error("Error loading customers:", error);
        listContainer.innerHTML = `<div class="empty-state error" style="color:red; text-align:center; padding:20px;">⚠️ خطأ: ${error.message}</div>`;
    }
}

// 3. تحديث الأرقام (الإحصائيات)
function updateCustomersUI() {
    try { updateStats(filteredCustomers); } catch(e) { console.warn("Stats error", e); }
    renderCurrentPage();
}

function updateStats(customers) {
    const safeSet = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    safeSet('statTotalCust', customers.length);

    // حساب كبار العملاء باستخدام getAutoTier (نفس دالة الكروت)
    const vipCount = customers.filter(c => {
        const tier = getAutoTier(c);
        return tier === 'vip' || tier === 'gold';
    }).length;
    safeSet('statVipCust', vipCount);

    const totalSales = customers.reduce((sum, c) => sum + (c.totalSpent || 0), 0);
    safeSet('statTotalSales', totalSales.toLocaleString());

    // العملاء النشطين: عندهم نقاط أو أوردرات أو آخر طلب خلال 30 يوم
    const monthAgo = new Date();
    monthAgo.setDate(monthAgo.getDate() - 30);
    const activeCount = customers.filter(c => {
        const lastDate = c.lastOrderDate || c.lastPurchase || c.lastVisit || c.updatedAt;
        if (lastDate && new Date(lastDate) > monthAgo) return true;
        if ((c.ordersCount || c.orders_count || 0) > 0) return true;
        if ((c.points || c.loyaltyPoints || c.totalSpent || 0) > 0) return true;
        return false;
    }).length;
    safeSet('statActiveCust', activeCount);
}

// 4. رسم العملاء في الصفحة
function renderCurrentPage() {
    const listContainer = document.getElementById('customersContainer');
    if (!listContainer) return;

    if (filteredCustomers.length === 0) {
        listContainer.innerHTML = '<div class="empty-state" style="text-align:center; padding:30px; font-family:Cairo; font-size:18px;">لا يوجد عملاء لعرضهم.</div>';
        const paginationControls = document.getElementById('paginationControls');
        if (paginationControls) paginationControls.style.display = 'none';
        return;
    }

    const startIndex = (currentPage - 1) * customersPerPage;
    const endIndex = startIndex + customersPerPage;
    const paginatedCustomers = filteredCustomers.slice(startIndex, endIndex);

    listContainer.innerHTML = paginatedCustomers.map(cust => `
        <div class="customer-card">
            <div class="card-header">
                <div class="customer-avatar"><span>${cust.name ? cust.name.charAt(0) : '👤'}</span></div>
                <div class="card-name-tier">
                    <h3>${cust.name || 'بدون اسم'}</h3>
                    <span class="loyalty-badge ${getAutoTier(cust)}">${getTierEmoji(getAutoTier(cust))} ${getTierName(getAutoTier(cust))}</span>
                </div>
            </div>
            <div class="card-body">
                <p class="info-item"><i class="fas fa-phone"></i> ${cust.phone || 'N/A'}</p>
                <p class="info-item"><i class="fas fa-map-marker-alt"></i> ${cust.address || 'لا يوجد عنوان'}</p>
            </div>
            <div class="card-stats">
                <div class="stat-item"><span>الطلبات</span><strong>${cust.ordersCount || 0}</strong></div>
                <div class="stat-item"><span>النقاط</span><strong>${cust.points || 0}</strong></div>
            </div>
            <div class="card-actions">
                <button class="action-btn" onclick="openWhatsApp('${cust.phone}')" title="واتساب"><i class="fab fa-whatsapp"></i></button>
                <button class="action-btn" onclick="openCustomerForm('edit', '${cust.name}', '${cust.phone}', '${cust.address || ''}', '${getAutoTier(cust)}', ${cust.points || cust.loyaltyPoints || 0})" title="تعديل"><i class="fas fa-pen"></i></button>
                <button class="action-btn delete" onclick="deleteCustomerHandler('${cust.phone}', '${cust.name}')" title="حذف"><i class="fas fa-trash-alt"></i></button>
            </div>
        </div>
    `).join('');

    try {
        const pageInfo = document.getElementById('pageInfo');
        const prevPageBtn = document.getElementById('prevPageBtn');
        const nextPageBtn = document.getElementById('nextPageBtn');
        const paginationControls = document.getElementById('paginationControls');
        const totalPages = Math.ceil(filteredCustomers.length / customersPerPage);

        if (pageInfo) pageInfo.textContent = `صفحة ${currentPage} من ${totalPages}`;
        if (prevPageBtn) prevPageBtn.disabled = currentPage === 1;
        if (nextPageBtn) nextPageBtn.disabled = currentPage === totalPages;
        if (paginationControls) paginationControls.style.display = totalPages > 1 ? 'flex' : 'none';
    } catch(e) {}
}

// 5. دوال البحث والتقليب والترجمة
function setupPagination() {
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentPage > 1) { currentPage--; renderCurrentPage(); }
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredCustomers.length / customersPerPage);
            if (currentPage < totalPages) { currentPage++; renderCurrentPage(); }
        });
    }
}

function setupSearch() {
    const searchInput = document.getElementById('headerSearch') || document.getElementById('customerSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            filteredCustomers = allCustomers.filter(cust =>
                (cust.name && cust.name.toLowerCase().includes(searchTerm)) ||
                (cust.phone && cust.phone.includes(searchTerm))
            );
            currentPage = 1;
            updateCustomersUI();
        });
    }
}

// حساب التير تلقائياً من النقاط (دايماً يحسب — مبيستخدمش القيمة المخزنة)
function getAutoTier(cust) {
    const s = JSON.parse(localStorage.getItem('loyaltySettings') || '{}');
    const pts = cust.points || cust.loyaltyPoints || 0;
    const vipMin    = s.vip    || s.vipThreshold    || 750;
    const goldMin   = s.gold   || s.goldThreshold   || 500;
    const silverMin = s.silver || s.silverThreshold || 100;
    if (pts >= vipMin)    return 'vip';
    if (pts >= goldMin)   return 'gold';
    if (pts >= silverMin) return 'silver';
    return 'regular';
}

function getTierName(t) {
    const names = { 'gold': 'ذهبي', 'silver': 'فضي', 'bronze': 'برونزي', 'vip': 'VIP' };
    return names[t] || 'عادي';
}

function getTierEmoji(t) {
    const emojis = { 'gold': '🥇', 'silver': '🥈', 'bronze': '🥉', 'vip': '👑' };
    return emojis[t] || '👤';
}

// 6. الحفظ والتصدير
// متغير عشان نحتفظ برقم العميل القديم قبل ما الكاشير يعدله
window.oldCustomerPhoneToEdit = '';

// 1. دالة فتح الفورم
window.openCustomerForm = function(mode, name = '', phone = '', address = '', tier = 'regular', points = 0) {
    document.getElementById('customerFormModal').style.display = 'flex';
    document.getElementById('formModalTitle').textContent = mode === 'edit' ? 'تعديل بيانات العميل' : 'إضافة عميل جديد';

    document.getElementById('custName').value = name;
    document.getElementById('custPhone').value = phone;
    document.getElementById('custAddress').value = address;
    document.getElementById('custTier').value = tier;
    document.getElementById('custPoints').value = points;
    const pointsDisplay = document.getElementById('custPointsDisplay');
    if (pointsDisplay) pointsDisplay.textContent = points;

    // 🔓 فك حظر تعديل الرقم
    const phoneInput = document.getElementById('custPhone');
    if(phoneInput) {
        phoneInput.disabled = false;
        phoneInput.readOnly = false;
    }

    // حفظ الرقم القديم في الذاكرة لو إحنا في وضع التعديل
    window.oldCustomerPhoneToEdit = mode === 'edit' ? phone : '';
};

// 2. دالة الحفظ الذكية (Offline-First)
window.handleCustomerSubmit = async function(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الحفظ...';

    const isEditMode = document.getElementById('formModalTitle').textContent.includes('تعديل');
    const phoneVal = document.getElementById('custPhone').value.trim();
    const oldPhone = window.oldCustomerPhoneToEdit;

    let ordersCount = 0;
    let totalSpent = 0;
    let createdAt = new Date().toISOString();

    if (isEditMode) {
        const oldCust = allCustomers.find(c => c.phone === (oldPhone || phoneVal));
        if (oldCust) {
            ordersCount = oldCust.ordersCount || 0;
            totalSpent = oldCust.totalSpent || 0;
            createdAt = oldCust.createdAt || createdAt;
        }
    }

    // 🔧 استخدام نفس صيغة الـ ID اللي بيستخدمها FirestoreService عشان نمنع التكرار
    const _uid = localStorage.getItem('userId') || localStorage.getItem('_saasUid') || '';
    const customerId = _uid && phoneVal ? `${_uid}_${phoneVal}` : (phoneVal || 'CUST_' + Date.now());

    const customerData = {
        id: customerId,
        name: document.getElementById('custName').value.trim(),
        phone: phoneVal,
        address: document.getElementById('custAddress').value.trim(),
        tier: document.getElementById('custTier').value || 'regular',
        points: parseInt(document.getElementById('custPoints').value) || 0,
        ordersCount: ordersCount,
        totalSpent: totalSpent,
        createdAt: createdAt
    };

    try {
        // لو الرقم اتغير، امسح القديم
        if (isEditMode && oldPhone && oldPhone !== phoneVal) {
            // SQLite: مسح العميل القديم (لو عندنا deleteCustomer)
            if (window.DBService && typeof window.DBService.removeCustomer === 'function') {
                try { await window.DBService.removeCustomer(oldPhone); } catch(e) {}
            }
            // Firestore: مسح القديم في الخلفية
            if (window.FirestoreService && window.FirestoreService.deleteCustomer) {
                try { await window.FirestoreService.deleteCustomer(oldPhone); } catch(e) {}
            }
            allCustomers = allCustomers.filter(c => c.phone !== oldPhone);
        }

        // 🚀 SQLite أولاً (Offline-First)
        if (window.DBService) {
            try {
                await window.DBService.saveCustomer(customerData);
            } catch(e) { console.warn('[Customers] DBService.saveCustomer err:', e.message); }
        }

        // 🌐 SyncManager لمزامنة Firebase في الخلفية
        if (window.SyncManager) {
            const localId = `local_${Date.now()}`;
            window.SyncManager.addToSyncQueue('customers', isEditMode ? 'update' : 'add', customerData, localId);
        } else if (window.FirestoreService && window.FirestoreService.saveCustomer) {
            // Fallback: Firebase مباشرة لو مفيش SyncManager
            try { await window.FirestoreService.saveCustomer(customerData); } catch(e) {}
        }

        // تحديث allCustomers في الذاكرة
        if (isEditMode) {
            const index = allCustomers.findIndex(c => c.phone === phoneVal);
            if (index > -1) allCustomers[index] = { ...allCustomers[index], ...customerData };
            else allCustomers.unshift(customerData);
        } else {
            allCustomers.unshift(customerData);
        }

        allCustomers.sort((a, b) => (b.points || 0) - (a.points || 0));
        // SQLite is already updated via DBService.saveCustomer above — no localStorage needed

        const searchBox = document.getElementById('headerSearch') || document.getElementById('customerSearchInput');
        if (searchBox) searchBox.value = '';
        filteredCustomers = allCustomers;
        updateCustomersUI();

        document.getElementById('customerFormModal').style.display = 'none';

        if (typeof Notification !== 'undefined' && typeof Notification.success === 'function') {
            Notification.success('تم الحفظ بنجاح');
        } else {
            alert('تم الحفظ بنجاح');
        }

    } catch (err) {
        alert("خطأ في الحفظ: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = 'حفظ بيانات العميل';
        window.oldCustomerPhoneToEdit = '';
    }
}

window.exportCustomersToExcel = async function() {
    try {
        const customers = allCustomers;
        if (customers.length === 0) { alert("لا يوجد عملاء لتصديرهم."); return; }

        let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
        csvContent += "الاسم,رقم الهاتف,العنوان,عدد الطلبات,النقاط,التصنيف\n";

        customers.forEach(cust => {
            const name = cust.name ? cust.name.replace(/,/g, " ") : "بدون اسم";
            const phone = cust.phone ? cust.phone.replace(/,/g, "") : "";
            const address = cust.address ? cust.address.replace(/,/g, " ") : "لا يوجد";
            const orders = cust.ordersCount || 0;
            const points = cust.points || 0;
            const tier = getTierName(cust.tier);
            csvContent += `${name},${phone},${address},${orders},${points},${tier}\n`;
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `customers_solo_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (error) {
        console.error("Export error:", error);
        alert("حدث خطأ أثناء تحميل الملف.");
    }
}

// ══════════════════════════════════════════════════════════════════
// 7. إعدادات النقاط — مودال ثابت في HTML (بدون إنشاء ديناميكي)
// ══════════════════════════════════════════════════════════════════

async function loadLoyaltySettings() {
    const defaults = { egpPerPoint: 10, silver: 100, gold: 500, vip: 1000 };
    let loyalty = defaults;
    try {
        const cached = localStorage.getItem('loyaltySettings');
        if (cached) loyalty = { ...defaults, ...JSON.parse(cached) };
    } catch(e) {}
    window.loyaltySettings = loyalty;

    // مزامنة Firebase في الخلفية
    if (window.FirestoreService && navigator.onLine) {
        setTimeout(async () => {
            try {
                const settings = await window.FirestoreService.getSettings();
                if (settings && settings.loyalty) {
                    const remoteLoyalty = { ...defaults, ...settings.loyalty };
                    localStorage.setItem('loyaltySettings', JSON.stringify(remoteLoyalty));
                    window.loyaltySettings = remoteLoyalty;
                }
            } catch(e) {}
        }, 2000);
    }
}

// ── فتح المودال ────────────────────────────────────────────────
function openLoyaltySettingsModal() {
    const modal = document.getElementById('loyaltySettingsModal');
    if (!modal) { console.warn('[Loyalty] Modal element not found'); return; }

    // تعبئة القيم الحالية
    const s = window.loyaltySettings || { egpPerPoint: 10, silver: 100, gold: 500, vip: 1000 };
    const egpInput    = document.getElementById('loyaltyEgpInput');
    const silverInput = document.getElementById('loyaltySilverInput');
    const goldInput   = document.getElementById('loyaltyGoldInput');
    const vipInput    = document.getElementById('loyaltyVipInput');
    if (egpInput)    egpInput.value    = s.egpPerPoint;
    if (silverInput) silverInput.value = s.silver;
    if (goldInput)   goldInput.value   = s.gold;
    if (vipInput)    vipInput.value    = s.vip;

    // إظهار المودال
    modal.style.display = 'flex';
}

// ── إغلاق المودال ──────────────────────────────────────────────
function closeLoyaltySettingsModal() {
    const modal = document.getElementById('loyaltySettingsModal');
    if (modal) modal.style.display = 'none';
}

// ── حفظ الإعدادات ──────────────────────────────────────────────
async function saveLoyaltySettings() {
    const saveBtn = document.getElementById('loyaltySaveAction');
    if (saveBtn) {
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الحفظ...';
        saveBtn.disabled = true;
    }

    const newSettings = {
        egpPerPoint: parseInt(document.getElementById('loyaltyEgpInput').value) || 10,
        silver:      parseInt(document.getElementById('loyaltySilverInput').value) || 100,
        gold:        parseInt(document.getElementById('loyaltyGoldInput').value) || 500,
        vip:         parseInt(document.getElementById('loyaltyVipInput').value) || 1000
    };

    localStorage.setItem('loyaltySettings', JSON.stringify(newSettings));
    window.loyaltySettings = newSettings;
    if (window._invalidateLoyaltyCache) window._invalidateLoyaltyCache();

    // إغلاق المودال
    closeLoyaltySettingsModal();

    // إعادة الزرار لحالته الأصلية
    if (saveBtn) {
        saveBtn.innerHTML = 'حفظ الإعدادات';
        saveBtn.disabled = false;
    }

    if (typeof Notification !== 'undefined' && typeof Notification.success === 'function') {
        Notification.success('تم حفظ إعدادات النقاط بنجاح!');
    }

    // مزامنة Firebase في الخلفية
    if (window.FirestoreService && navigator.onLine) {
        setTimeout(async () => {
            try {
                const cur = await window.FirestoreService.getSettings();
                await window.FirestoreService.updateSettings({ ...cur, loyalty: newSettings });
            } catch(e) { console.warn('[Loyalty] Firebase sync failed:', e.message); }
        }, 500);
    }
}

// ── ربط الأحداث — مرة واحدة بعد جاهزية الصفحة ─────────────────
(function _initLoyaltySystem() {
    function bindAll() {
        // زرار فتح المودال
        const openBtn = document.getElementById('loyaltySettingsBtn');
        if (openBtn) {
            openBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                openLoyaltySettingsModal();
            });
        }

        // زرار إغلاق (X)
        const closeBtn = document.getElementById('loyaltyCloseBtn');
        if (closeBtn) closeBtn.addEventListener('click', closeLoyaltySettingsModal);

        // زرار إلغاء
        const cancelBtn = document.getElementById('loyaltyCancelAction');
        if (cancelBtn) cancelBtn.addEventListener('click', closeLoyaltySettingsModal);

        // زرار حفظ
        const saveBtn = document.getElementById('loyaltySaveAction');
        if (saveBtn) saveBtn.addEventListener('click', saveLoyaltySettings);

        // إغلاق بالضغط على الخلفية
        const modal = document.getElementById('loyaltySettingsModal');
        if (modal) {
            modal.addEventListener('mousedown', function(e) {
                if (e.target === modal) closeLoyaltySettingsModal();
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindAll);
    } else {
        bindAll();
    }
})()
