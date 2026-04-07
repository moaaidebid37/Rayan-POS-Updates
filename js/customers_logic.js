// js/customers_logic.js - المخ المسؤول عن صفحة العملاء 
 // ========================================================== 
 // 🚀 Offline-First & Pagination & Search Logic 
 // ========================================================== 
 let currentPage = 1; 
 const customersPerPage = 24; // أنسب رقم لسرعة الصفحة وتناسق الكروت 
 let allCustomers = []; 
 let filteredCustomers = []; 
 
 // 1. أمر التشغيل الأساسي (اللي كان ممسوح وموقف الشاشة) 
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
         
         // نجيب الداتا من المحرك 
         if (window.FirestoreService && typeof window.FirestoreService.getAllCustomers === 'function') { 
             customers = await window.FirestoreService.getAllCustomers(); 
         } 
 
         // ⚠️ خطة إنقاذ الداتا: لو المحرك رجع الداتا فاضية، هنسحبها من الخزنة القديمة 
         if (!customers || customers.length === 0) { 
             const oldData = JSON.parse(localStorage.getItem('customers') || '[]'); 
             const newData = JSON.parse(localStorage.getItem('offline_customers') || '[]'); 
             
             // ناخد الخزنة اللي فيها عملاء أكتر 
             customers = oldData.length > newData.length ? oldData : newData; 
             
             // نأكد حفظهم في الخزنة الجديدة عشان ميضيعوش 
             if (customers.length > 0) { 
                 localStorage.setItem('offline_customers', JSON.stringify(customers)); 
             } 
         } 
         
         allCustomers = customers || []; 
        // السطر ده بياخد مصفوفة العملاء (اللي جاية من الفايربيز أو اللي إنت لسه ضايفها) ويخزنها أوفلاين 
        localStorage.setItem('customers', JSON.stringify(allCustomers)); 
         
        // 🔥 ترتيب العملاء من الأعلى نقاطاً إلى الأقل 
        allCustomers.sort((a, b) => (b.points || 0) - (a.points || 0)); 
         
         // الفلتر 
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
     safeSet('statVipCust', customers.filter(c => c.tier === 'vip' || c.tier === 'gold').length); 
     const totalSales = customers.reduce((sum, c) => sum + (c.totalSpent || 0), 0); 
     safeSet('statTotalSales', totalSales.toLocaleString()); 
     const monthAgo = new Date(); 
     monthAgo.setDate(monthAgo.getDate() - 30); 
     const activeCount = customers.filter(c => c.lastOrderDate && new Date(c.lastOrderDate) > monthAgo).length; 
     safeSet('statActiveCust', activeCount); 
 } 
 
 // 4. رسم العملاء في الصفحة 
 function renderCurrentPage() { 
     const listContainer = document.getElementById('customersContainer'); 
     if (!listContainer) return; 
 
     if (filteredCustomers.length === 0) { 
         listContainer.innerHTML = '<div class="empty-state" style="text-align:center; padding:30px; font-family:Cairo; font-size:18px;">لا يوجد عملاء لعرضهم.</div>'; 
         
         // إخفاء زراير التقليب عشان مفيش عملاء 
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
                     <span class="loyalty-badge ${cust.tier || 'regular'}">${getTierEmoji(cust.tier)} ${getTierName(cust.tier)}</span> 
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
                 <button class="action-btn" onclick="openCustomerForm('edit', '${cust.name}', '${cust.phone}', '${cust.address}', '${cust.tier}', ${cust.points})" title="تعديل"><i class="fas fa-pen"></i></button> 
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

// 1. دالة فتح الفورم (معدلة لفك الحظر عن رقم التليفون)
window.openCustomerForm = function(mode, name = '', phone = '', address = '', tier = 'regular', points = 0) {
    document.getElementById('customerFormModal').style.display = 'flex';
    document.getElementById('formModalTitle').textContent = mode === 'edit' ? 'تعديل بيانات العميل' : 'إضافة عميل جديد';
    
    document.getElementById('custName').value = name;
    document.getElementById('custPhone').value = phone;
    document.getElementById('custAddress').value = address;
    document.getElementById('custTier').value = tier;
    document.getElementById('custPoints').value = points;
    
    // 🔓 فك حظر تعديل الرقم عشان تقدر تمسحه وتكتب غيره
    const phoneInput = document.getElementById('custPhone');
    if(phoneInput) {
        phoneInput.disabled = false;
        phoneInput.readOnly = false;
    }
    
    // حفظ الرقم القديم في الذاكرة لو إحنا في وضع التعديل
    window.oldCustomerPhoneToEdit = mode === 'edit' ? phone : '';
};

// 2. دالة الحفظ الذكية (بتنقل الداتا وتمسح القديم لو الرقم اتغير)
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
    
    const customerData = {
        id: phoneVal ? phoneVal : 'CUST_' + Date.now(),
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
        if (isEditMode && oldPhone && oldPhone !== phoneVal) {
            if (window.FirestoreService && window.FirestoreService.deleteCustomer) {
                await window.FirestoreService.deleteCustomer(oldPhone);
            }
            allCustomers = allCustomers.filter(c => c.phone !== oldPhone);
        }

        if (window.FirestoreService && window.FirestoreService.saveCustomer) {
            await window.FirestoreService.saveCustomer(customerData);
        }

        if (isEditMode) {
            const index = allCustomers.findIndex(c => c.phone === phoneVal);
            if (index > -1) allCustomers[index] = { ...allCustomers[index], ...customerData };
            else allCustomers.unshift(customerData);
        } else {
            allCustomers.unshift(customerData);
        }
        
        allCustomers.sort((a, b) => (b.points || 0) - (a.points || 0));
        localStorage.setItem('offline_customers', JSON.stringify(allCustomers));
        // السطر ده بياخد مصفوفة العملاء (اللي جاية من الفايربيز أو اللي إنت لسه ضايفها) ويخزنها أوفلاين
        localStorage.setItem('customers', JSON.stringify(allCustomers));

        const searchBox = document.getElementById('headerSearch') || document.getElementById('customerSearchInput');
        if (searchBox) searchBox.value = '';
        filteredCustomers = allCustomers;
        updateCustomersUI();
        
        document.getElementById('customerFormModal').style.display = 'none';

        // 🔥 التعديل الآمن لرسالة النجاح
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
 
 // 7. إعدادات النقاط 
 async function loadLoyaltySettings() { 
     try { 
         const settings = await window.FirestoreService.getSettings(); 
         const loyalty = settings.loyalty || { egpPerPoint: 10, silver: 100, gold: 500, vip: 1000 }; 
         
         const egpInput = document.getElementById('loyaltyEgpPerPoint'); 
         if(egpInput) { 
             egpInput.value = loyalty.egpPerPoint; 
             document.getElementById('loyaltySilver').value = loyalty.silver; 
             document.getElementById('loyaltyGold').value = loyalty.gold; 
             document.getElementById('loyaltyVip').value = loyalty.vip; 
         } 
         window.loyaltySettings = loyalty; 
     } catch (e) {} 
 } 
 
 window.saveLoyaltySettings = async function(e) { 
     e.preventDefault(); 
     const btn = e.target.querySelector('button[type="submit"]'); 
     const originalText = btn.innerHTML; 
     btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الحفظ...'; 
     
     const newSettings = { 
         egpPerPoint: parseInt(document.getElementById('loyaltyEgpPerPoint').value) || 10, 
         silver: parseInt(document.getElementById('loyaltySilver').value) || 100, 
         gold: parseInt(document.getElementById('loyaltyGold').value) || 500, 
         vip: parseInt(document.getElementById('loyaltyVip').value) || 1000 
     }; 
 
     try { 
         const currentSettings = await window.FirestoreService.getSettings(); 
         await window.FirestoreService.updateSettings({ ...currentSettings, loyalty: newSettings }); 
         
         window.loyaltySettings = newSettings;
         if (window._invalidateLoyaltyCache) window._invalidateLoyaltyCache();
         alert("✅ تم حفظ إعدادات النقاط بنجاح!"); 
         document.getElementById('loyaltySettingsModal').style.display = 'none'; 
     } catch (error) { 
         alert("❌ خطأ في الحفظ: " + error.message); 
     } finally { 
         btn.innerHTML = originalText; 
     } 
 }