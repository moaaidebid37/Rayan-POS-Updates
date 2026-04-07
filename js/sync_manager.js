// sync_manager.js
// نظام إدارة المزامنة الشامل مع Firebase و localStorage

const SyncManager = {
  // قائمة انتظار المزامنة
  syncQueue: [],
  isSyncing: false,
  syncInterval: null,

  // تهيئة النظام
    async init() {
        if (window.firestoreReady) await window.firestoreReady;
        this.loadSyncQueue();
        this.watchConnection();
        this.startPeriodicSync();

        if (navigator.onLine && !localStorage.getItem('_firebaseBlocked')) {
            // معالجة العمليات المعلقة فقط
            setTimeout(() => this.processSyncQueue(), 1000);
            
            // المزامنة الكاملة مرة كل 3 ساعات فقط مش كل مرة نفتح الصفحة
            const lastFullSync = localStorage.getItem('_lastFullSync') || 0;
            if (Date.now() - lastFullSync > 10800000) {
                setTimeout(() => {
                    this.syncAllLocalData();
                    localStorage.setItem('_lastFullSync', Date.now());
                }, 10000);
            }
        }
    },

  // تحميل قائمة الانتظار من localStorage
  loadSyncQueue() {
    try {
      const queue = localStorage.getItem('_syncQueue');
      if (queue) {
        this.syncQueue = JSON.parse(queue);
      } else {
        this.syncQueue = [];
      }
    } catch (e) {
      console.error('Error loading sync queue:', e);
      this.syncQueue = [];
    }
  },

  // حفظ قائمة الانتظار في localStorage
  saveSyncQueue() {
    try {
      localStorage.setItem('_syncQueue', JSON.stringify(this.syncQueue));
    } catch (e) {
      console.error('Error saving sync queue:', e);
    }
  },

  // مزامنة كل البيانات المحلية إلى Firebase
  syncAllLocalData: async function() {
    if (!navigator.onLine || !window.FirestoreService) {
      console.log('Cannot sync all data: offline or Firestore not available');
      return;
    }

    // منع التكرار: لو في مزامنة شغالة دلوقتي، متعملش حاجة واخرج 
    if (window.isSyncActive) return ;
    window.isSyncActive = true; // اقفل الباب
    console.log('🔄 Starting full local data sync to Firebase...');
    
    try {
      // مزامنة الطلبات
      await this.syncCollection('orders');
      
      // مزامنة المصاريف
      await this.syncCollection('expenses');
      
      // مزامنة تاريخ المصاريف
      await this.syncCollection('expensesHistory');
      
      // مزامنة تاريخ المبيعات
      await this.syncCollection('salesHistory');
      
      // مزامنة عناصر القائمة
      await this.syncCollection('menuItems');
      
      // مزامنة المواد الخام
      await this.syncCollection('ingredients');

      // مزامنة الفئات (عشان نضمن إنها تترفع دايماً)
      await this.syncCollection('categories');

      // مزامنة الموظفين
      await this.syncCollection('employees');
      
      // مزامنة الموردين 
       await this.syncCollection('suppliers'); 
       
       // مزامنة منصات التوصيل 
       await this.syncCollection('aggregators');

      // مزامنة المستخدمين (اليوزرز) 
      await this.syncCollection('users'); 
      
      // مزامنة الإعدادات (بما فيها اسم المتجر) 
      await this.syncCollection('settings');
      
      console.log('✅ Full local data sync completed');
      
      // تحديث الصفحة إذا كنا في صفحة التقارير
      if (window.location.pathname.includes('reports.html')) {
        setTimeout(() => {
          if (typeof loadPerformance === 'function') {
            loadPerformance();
          }
        }, 1000);
      }
      
    } catch (error) {
      console.error('❌ Error during full data sync:', error);
    } finally {
      // السطر ده هيتنفذ دايماً، سواء نجحت أو فشلت 
      window.isSyncActive = false; 
    }
  },

  // مزامنة مجموعة بيانات محددة مع ضمان عدم التكرار
    syncCollection: async function(collectionName) {
        if (this.isSyncing || localStorage.getItem('_firebaseBlocked') === 'true') return;

        try {
            let localData = JSON.parse(localStorage.getItem(collectionName) || '[]');
            // 🛡️ لو الداتا object مش array (زي settings)، حوّلها أو اتجاهلها
            if (!Array.isArray(localData)) {
                localData = (localData && typeof localData === 'object') ? [localData] : [];
            }
            // 🛡️ نرفع فقط اللي واخد علامة false صريحة
            const unsyncedData = localData.filter(item => item._synced === false);

            if (unsyncedData.length === 0) return;

            this.isSyncing = true;
            for (const item of unsyncedData) {
                try {
                    const dataToSync = { ...item };
                    delete dataToSync._synced;
                    delete dataToSync._localId;
                    // 🔒 ضمان restaurantId في كل doc بيترفع لـ Firestore
                    const _rid = localStorage.getItem('userId') || localStorage.getItem('_saasUid');
                    if (_rid && !dataToSync.restaurantId) dataToSync.restaurantId = _rid;
                    await window.FirestoreService.set(collectionName, item.id, dataToSync);

                    // تحديث الحالة في اللوكال فوراً
                    const idx = localData.findIndex(x => x.id === item.id);
                    if (idx !== -1) localData[idx]._synced = true;
                } catch (error) {
                    if (error.code === 'resource-exhausted') {
                        localStorage.setItem('_firebaseBlocked', 'true');
                        break;
                    }
                }
            }
            localStorage.setItem(collectionName, JSON.stringify(localData));
        } finally {
            this.isSyncing = false;
        }
    },

  // إضافة عملية للمزامنة
  addToSyncQueue: function(collection, operation, data, localId = null) {
    // Validation: Ensure critical data is present before queuing
    if ((collection === 'orders' || collection === 'expenses') && operation === 'add' && data) {
        if (!data.shift_id && !data.shiftId) {
            console.warn(`⚠️ [SyncManager] Queuing item in '${collection}' without a shift_id. This may cause data isolation issues.`, {
                id: data.id,
                description: data.description,
                amount: data.amount
            });
        }
    }

    // Validation: Ensure order data completeness before queuing
    if (collection === 'orders' && operation === 'add' && data) {
      const requiredFields = ['id', 'paymentMethod', 'payment_method', 'items', 'total'];
      const missingFields = requiredFields.filter(field => {
        if (field === 'items') {
          return !Array.isArray(data.items) && !Array.isArray(data.cartItems);
        }
        return data[field] === undefined || data[field] === null;
      });
      
      if (missingFields.length > 0) {
        console.error(`❌ [SyncManager] Order ${data.id || 'unknown'} missing fields in queue:`, missingFields);
        console.error('   Available keys:', Object.keys(data || {}));
        console.error('   Order sample:', {
          id: data.id,
          paymentMethod: data.paymentMethod,
          payment_method: data.payment_method,
          items: Array.isArray(data.items) ? `${data.items.length} items` : 'NOT_ARRAY',
          total: data.total,
          discount: data.discount,
          status: data.status
        });
      } else {
        // Log success in dev mode (can be removed in production)
        if (typeof window !== 'undefined' && window.location && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
          console.log(`✅ [SyncManager] Order ${data.id || 'unknown'} queued with complete data (${Object.keys(data || {}).length} fields)`);
        }
      }
    }

    const queueItem = {
      id: localId || `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      collection,
      operation, // 'add', 'update', 'delete'
      data,
      timestamp: Date.now(),
      retries: 0,
      maxRetries: 3
    };

    this.syncQueue.push(queueItem);
    this.saveSyncQueue();

    // محاولة المزامنة الفورية إذا كان الإنترنت متصل (إلا إذا Firebase محظور حالياً)
    let firebaseBlocked = false;
    try { firebaseBlocked = localStorage.getItem('_firebaseBlocked') === 'true'; } catch (_) { /* ignore */ }
    if (navigator.onLine && !this.isSyncing && !firebaseBlocked) {
      this.syncImmediately(queueItem);
    }

    return queueItem.id; // <-- Keep this line
  },

  // مزامنة فورية لعنصر واحد
  syncImmediately: async function(queueItem) {
    // 🚀 Strict prompt Step 2: Add network check to prevent hanging
    if (!navigator.onLine) {
      console.log("💤 Offline: Operation queued for later background sync.");
      return false; // Exit immediately, it's already in the local queue
    }

    if (!window.FirestoreService) {
      console.warn('FirestoreService not available');
      return false;
    }
    
    // إذا Firebase محظور (قواعد/صلاحيات)، لا تحاول الآن - احتفظ بالـQueue للمزامنة لاحقاً
    try {
      if (localStorage.getItem('_firebaseBlocked') === 'true') {
        return false;
      }
    } catch (_) { /* ignore */ }

    try {
      const { collection, operation, data } = queueItem;
      let result = null;

      // تنفيذ العملية حسب النوع
      switch (operation) {
        case 'add':
          result = await this.executeAdd(collection, data);
          break;
        case 'update':
          result = await this.executeUpdate(collection, data);
          break;
        case 'delete':
          result = await this.executeDelete(collection, data);
          break;
        default:
          console.error('Unknown operation:', operation);
          return false;
      }

      // إذا نجحت المزامنة، احذف من قائمة الانتظار
      this.removeFromQueue(queueItem.id);
      
      // تحديث العنصر في localStorage ليكون _synced = true بدلاً من حذفه
      // (نحتفظ به في localStorage كنسخة احتياطية)
      if (queueItem.id.startsWith('local_')) {
        try {
          const storageKey = this.getStorageKey(collection);
          const items = JSON.parse(localStorage.getItem(storageKey) || '[]');
          const itemIndex = items.findIndex(item => 
            item._localId === queueItem.id || 
            (data.id && item.id === data.id && !item._synced)
          );
          
          if (itemIndex !== -1) {
            items[itemIndex]._synced = true;
            // Update the item with the real ID from Firestore
            if (result && result.id) {
              items[itemIndex].id = result.id;
            }
            // حذف _localId بعد المزامنة الناجحة
            delete items[itemIndex]._localId;
            localStorage.setItem(storageKey, JSON.stringify(items));
          }
        } catch (e) {
          console.error('Error updating sync status in localStorage:', e);
        }
      }

      return true;
    } catch (error) {
      console.error('Sync error:', error);
      
      // If Firestore rules block us, stop retrying and switch to local-only mode.
      // This prevents endless failures from breaking UX (reports can still use local data).
      try {
        const msg = String(error?.message || '');
        const code = String(error?.code || '');
        const isPermissionDenied =
          code === 'permission-denied' ||
          msg.toLowerCase().includes('missing or insufficient permissions');
        if (isPermissionDenied) {
          localStorage.setItem('_firebaseBlocked', 'true');
          // IMPORTANT: do NOT drop queued operations. Keep them until Firebase is fixed.
          queueItem.blocked = true;
          queueItem.blockedReason = 'permission-denied';
          if (typeof Notification !== 'undefined') {
            Notification.error('Firebase غير مُصرّح به حالياً. سيتم العمل بوضع محلي فقط حتى يتم تعديل قواعد Firebase.');
          } else {
            alert('Firebase غير مُصرّح به حالياً. سيتم العمل بوضع محلي فقط حتى يتم تعديل قواعد Firebase.');
          }
          this.saveSyncQueue();
          return false;
        }
      } catch (_) { /* ignore */ }

      queueItem.retries++;
      
      // إذا تجاوزت المحاولات الحد الأقصى، احذف من القائمة
      if (queueItem.retries >= queueItem.maxRetries) {
        console.error('Max retries reached for:', queueItem);
        this.removeFromQueue(queueItem.id);
      } else {
        this.saveSyncQueue();
      }
      
      return false;
    }
  },

  // تنفيذ عملية الإضافة
  executeAdd: async function(collection, data) {
    const service = window.FirestoreService;
    
    // Validation: Ensure order data is complete before sending to Firestore
    if (collection === 'orders' && data) {
      const hasPaymentMethod = !!(data.paymentMethod || data.payment_method);
      const hasItems = Array.isArray(data.items) && data.items.length > 0;
      const hasTotal = typeof data.total === 'number' && data.total >= 0;
      
      if (!hasPaymentMethod || !hasItems || !hasTotal) {
        console.warn(`⚠️ Incomplete order data in executeAdd for ${data.id || 'unknown'}:`, {
          hasPaymentMethod,
          hasItems,
          hasTotal,
          keys: Object.keys(data || {})
        });
      }
    }
    
    let result = null;
    
    switch (collection) {
      case 'attendance':
        result = await service.upsertAttendance(data);
        break;
      case 'categories':
        result = await service.addCategory(data);
        break;
      case 'menuItems':
        result = await service.addMenuItem(data);
        break;
      case 'ingredients':
        // Use the general set function to add a new ingredient
        // Firestore will generate a new ID if data.id is not provided
        result = await service.set('ingredients', data.id, data);
        break;
      case 'employees':
        result = await service.addEmployee(data);
        break;
      case 'suppliers':
        result = await service.addSupplier(data);
        break;
      case 'aggregators': 
         result = await service.set('aggregators', data.id, data); 
         break;
      case 'expenses':
        result = await service.addExpense(data);
        break;
      case 'expensesHistory':
        result = await service.addExpenseHistory(data);
        break;
      case 'orders':
        result = await service.addOrder(data);
        break;
      case 'settings':
        result = await service.updateSettings(data);
        break;
      case 'shifts':
        // #region agent log
        // fetch('http://127.0.0.1:7246/ingest/b757e1c9-885e-495c-b5d1-52d3a5033416',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'sync_manager.js:executeAdd:shifts',message:'add shift',data:{localId:data?.id,useCreateShiftWithId:true},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'})}).catch(()=>{});
        // #endregion
        if (data?.id && typeof service.createShiftWithId === 'function')
          result = await service.createShiftWithId(data);
        else
          result = await service.startShift({
            cashier_name: data.cashier_name || data.cashierName || 'Admin',
            opening_balance: data.opening_balance || data.openingAmount || 0
          });
        break;

      case 'tables':
        // سيتم إضافتها لاحقاً
        result = service.addTable ? await service.addTable(data) : null;
        break;
      case 'salesHistory': 
        result = await service.set('salesHistory', data.id, data); 
        break;
      default:
        throw new Error(`Unknown collection: ${collection}`);
    }
    
    return result; // Return the result (which includes the ID)
  },

  // تنفيذ عملية التحديث
  executeUpdate: async function(collection, data) {
    const service = window.FirestoreService;
    const id = data.id || data._id;
    
    if (!id) {
      throw new Error('ID is required for update operation');
    }

    switch (collection) {
      case 'attendance':
        return await service.upsertAttendance({ ...data, id });
      case 'categories':
        return await service.updateCategory(id, data);
      case 'menuItems':
        return await service.updateMenuItem(id, data);
      case 'ingredients':
        return await service.updateIngredient(id, data);
      case 'employees':
        return await service.updateEmployee(id, data);
      case 'suppliers':
        return await service.updateSupplier(id, data);
      case 'aggregators':
        return await service.set('aggregators', id, data);
      case 'expenses':
        return await service.updateExpense(id, data);
      case 'expensesHistory':
        return await service.updateExpenseHistory(id, data);
      case 'orders':
        return await service.updateOrder(id, data);
      case 'settings':
        return await service.updateSettings(data);
      case 'shifts':
        // #region agent log
        // fetch('http://127.0.0.1:7246/ingest/b757e1c9-885e-495c-b5d1-52d3a5033416',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'sync_manager.js:executeUpdate:shifts',message:'update shift',data:{id,status:data?.status},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'})}).catch(()=>{});
        // #endregion
        return await service.updateShift(id, data);
      case 'performance':
        return await service.setPerformance(data.businessDate || id, data);
      case 'daily_log': {
        const result = await service.setDailyLogRow(data.sessionId || id, data);
        // Bot-ready: after syncing daily_log, aggregate all shifts for that day and write performance_snapshots
        const bd = data.businessDate || (data.date && String(data.date).substring(0, 10)) || null;
        if (bd && typeof service.getDailyLogRows === 'function' && typeof service.setPerformanceSnapshot === 'function') {
          try {
            const dayRows = await service.getDailyLogRows(bd);
            const totalSales = (dayRows || []).reduce((s, r) => s + (Number(r.totalSales) || 0), 0);
            const totalExpenses = (dayRows || []).reduce((s, r) => s + (Number(r.totalExpenses) || 0), 0);
            const netProfit = (dayRows || []).reduce((s, r) => s + (Number(r.netProfit) || 0), 0);
            const ordersCount = (dayRows || []).reduce((s, r) => s + (Number(r.ordersCount) || 0), 0);
            await service.setPerformanceSnapshot(bd, { totalSales, totalExpenses, netProfit, ordersCount });
          } catch (e) { console.warn('[SyncManager] setPerformanceSnapshot after daily_log sync failed:', e); }
        }
        return result;
      }
      case 'performance_snapshots':
        return await service.setPerformanceSnapshot(data.businessDate || id, data);
      case 'salesHistory': 
        return await service.set('salesHistory', id, data);
      default:
        throw new Error(`Unknown collection: ${collection}`);
    }
  },

  // تنفيذ عملية الحذف
  executeDelete: async function(collection, data) {
    const service = window.FirestoreService;
    const id = data.id || data._id;
    
    if (!id) {
      throw new Error('ID is required for delete operation');
    }

    switch (collection) {
      case 'attendance':
        return await service.deleteAttendance(id);
      case 'categories':
        return await service.deleteCategory(id);
      case 'menuItems':
        return await service.deleteMenuItem(id);
      case 'ingredients':
        return await service.deleteIngredient(id);
      case 'employees':
        return await service.deleteEmployee(id);
      case 'suppliers':
        return await service.deleteSupplier(id);
      case 'aggregators':
        return await service.deleteDocument('aggregators', id);
      case 'expenses':
        return await service.deleteExpense(id);
      case 'expensesHistory':
        return await service.deleteExpenseHistory(id);
      case 'orders':
        return await service.deleteOrder(id);
      case 'shifts':
        // cashSessions تستخدم shifts collection
        return await service.deleteShift(id);
      case 'users':
        return await service.deleteUser(id);
      case 'salesHistory':
        return await service.deleteDocument('salesHistory', id);
      default:
        throw new Error(`Unknown collection: ${collection}`);
    }
  },

  // مزامنة قائمة الانتظار بالكامل
  processSyncQueue: async function() {
    if (this.isSyncing || !navigator.onLine) {
      return;
    }
    
    // إذا Firebase محظور حالياً، لا تعمل مزامنة (احتفظ بالـQueue)
    try {
      if (localStorage.getItem('_firebaseBlocked') === 'true') return;
    } catch (_) { /* ignore */ }

    if (this.syncQueue.length === 0) {
      return;
    }

    this.isSyncing = true;
    console.log(`Syncing ${this.syncQueue.length} items...`);

    const itemsToSync = [...this.syncQueue];
    let successCount = 0;
    let failCount = 0;

    for (const item of itemsToSync) {
      try {
        const success = await this.syncImmediately(item);
        if (success) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (error) {
        console.error('Error syncing item:', item, error);
        failCount++;
      }
    }

    console.log(`Sync completed: ${successCount} succeeded, ${failCount} failed`);
    this.isSyncing = false;
  },

  // حذف من قائمة الانتظار
  removeFromQueue(itemId) {
    this.syncQueue = this.syncQueue.filter(item => item.id !== itemId);
    this.saveSyncQueue();
  },

  // حذف من localStorage بعد المزامنة الناجحة (للاستخدام المستقبلي)
  removeFromLocalStorage(collection, localId, data) {
    try {
      const storageKey = this.getStorageKey(collection);
      const items = JSON.parse(localStorage.getItem(storageKey) || '[]');
      
      // البحث عن العنصر وحذفه
      const filtered = items.filter(item => {
        // إذا كان لدينا localId محدد، استخدمه
        if (item._localId === localId || item._syncId === localId) {
          return false; // حذف هذا العنصر
        }
        // إذا كان لدينا id في data، قارن به (لكن فقط إذا كان العنصر غير مزامن)
        if (data.id && item.id === data.id && item._synced === false) {
          return false; // حذف العنصر غير المزامن الذي تم مزامنته الآن
        }
        // إذا كان لدينا _id في data، قارن به
        if (data._id && item._id === data._id && item._synced === false) {
          return false;
        }
        return true; // احتفظ بهذا العنصر
      });

      localStorage.setItem(storageKey, JSON.stringify(filtered));
    } catch (e) {
      console.error('Error removing from localStorage:', e);
    }
  },

  // الحصول على مفتاح localStorage للكولكشن
  getStorageKey(collection) {
    const keyMap = {
      'attendance': 'attendance',
      'categories': 'categories',
      'menuItems': 'menuItems',
      'ingredients': 'ingredients',
      'employees': 'employees',
      'suppliers': 'suppliers',
      'expenses': 'expenses',
      'orders': 'orders',
      'users': 'users',
      'settings': 'settings', 
       'aggregators': 'aggregators',
      'salesHistory': 'salesHistory',
      'shifts': 'cashSessions', // shifts collection في Firebase = cashSessions في localStorage
      'performance': 'report_performance',
      'daily_log': 'report_daily_log',

      'tables': 'tables'
    };
    return keyMap[collection] || collection;
  },

  // مراقبة حالة الاتصال
  watchConnection() {
    window.addEventListener('online', () => {
      console.log('🌐 Connection restored! Starting full sync...');
      setTimeout(() => {
        this.processSyncQueue();
        this.syncAllLocalData(); // مزامنة كل البيانات عند عودة الاتصال
      }, 1000);
    });

    window.addEventListener('offline', () => {
      console.log('📵 Connection lost, will sync when restored');
    });
  },

  // بدء المزامنة الدورية
  startPeriodicSync() {
    // مزامنة كل 30 ثانية إذا كان الإنترنت متصل
    this.syncInterval = setInterval(() => {
      if (navigator.onLine && !this.isSyncing && this.syncQueue.length > 0) {
        this.processSyncQueue();
      }
    }, 30000);
  },

  // إيقاف المزامنة الدورية
  stopPeriodicSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  },

  // الحصول على حالة المزامنة
  getStatus() {
    return {
      queueLength: this.syncQueue.length,
      isSyncing: this.isSyncing,
      isOnline: navigator.onLine
    };
  }
};

// تصدير للاستخدام العام
if (typeof window !== 'undefined') {
  window.SyncManager = SyncManager;
  
  // تهيئة تلقائية عند تحميل الصفحة
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      SyncManager.init();
    });
  } else {
    SyncManager.init();
  }
  
  // Debug: التأكد من أن الدالة متاحة
  console.log('[SyncManager] addToSyncQueue function:', typeof window.SyncManager.addToSyncQueue);
}

// تصدير للـ CommonJS (Electron)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SyncManager;
}
