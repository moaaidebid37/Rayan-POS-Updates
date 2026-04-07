// سكريبت مسح الطلبات الوهمية
// يمكن تشغيله من Developer Console

(async function() {
    console.log('🚀 بدء مسح الطلبات الوهمية...');
    
    // 1. مسح من localStorage
    const orderKeys = ['orders', 'ordersOnHold', 'salesHistory', 'resumeOrder'];
    orderKeys.forEach(key => {
        localStorage.removeItem(key);
        if (key !== 'resumeOrder') {
            localStorage.setItem(key, JSON.stringify([]));
        }
    });
    console.log('✅ تم مسح الطلبات من localStorage');
    
    // 2. مسح من Firebase
    if (typeof window !== 'undefined' && typeof window.FirestoreService !== 'undefined' && navigator.onLine) {
        try {
            const firebaseOrders = await window.FirestoreService.getAllOrders();
            console.log(`📦 وجد ${firebaseOrders.length} طلب في Firebase`);
            
            let deletedCount = 0;
            for (const order of firebaseOrders) {
                try {
                    await window.FirestoreService.deleteOrder(order.id);
                    deletedCount++;
                } catch (e) {
                    console.warn(`⚠️ فشل حذف طلب ${order.id}:`, e);
                }
            }
            console.log(`✅ تم حذف ${deletedCount} طلب من Firebase`);
        } catch (error) {
            console.error('❌ خطأ في مسح Firebase:', error);
        }
    } else {
        console.log('ℹ️ Firebase غير متاح أو غير متصل');
    }
    
    // 3. تعطيل دمج Firebase لمدة 30 دقيقة
    localStorage.setItem('_ordersCleared', Date.now().toString());
    console.log('✅ تم تعطيل دمج Firebase لمدة 30 دقيقة');
    
    // 4. تحديث الصفحة
    console.log('🔄 جاري تحديث الصفحة...');
    setTimeout(() => {
        window.location.reload();
    }, 1000);
})();
