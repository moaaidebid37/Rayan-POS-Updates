
// بيانات نظام نقاط البيع - مطعم ريان
// تم إفراغ البيانات الافتراضية ليكون النظام جاهزاً للبيانات الحية فقط

const menuData = {
  categories: [], // مصفوفة فارغة
  items: []       // مصفوفة فارغة
};

// Make menuData globally accessible
if (typeof window !== 'undefined') {
    window.menuData = menuData;
}
var globalMenuData = menuData;

// Initialize localStorage keys if they don't exist
const localStorageKeys = [
    'categories', 'menuItems', 'ingredients', 'orders', 'expenses',
    'suppliers', 'employees', 'cashSessions', 'salesHistory',
    'expensesHistory', 'ordersOnHold', 'users', 'customers',
    'settings', 'attendance', 'notifications', 'performance',
    'daily_log', 'performance_snapshots'
];

try {
    localStorageKeys.forEach(key => {
        if (localStorage.getItem(key) === null) {
            localStorage.setItem(key, JSON.stringify([]));
        }
    });

    // Clear all data on first run (for clean distribution)
    if (!localStorage.getItem('first_run_completed')) {
        const keysToRemove = [
            'orders', 'ordersOnHold', 'salesHistory', 'suppliers', 'cashSessions', 
            'expenses', 'expensesHistory', 'menuItems', 'ingredients', 'categories', 
            'employees', 'users', 'customers', 'isLoggedIn', 'username', 'userType', 
            'solo_store_name', 'taxServiceSettings', 'storeSettings', 'appSettings'
        ];
        keysToRemove.forEach(key => localStorage.removeItem(key));
        localStorage.setItem('first_run_completed', 'true');
    }
} catch (e) {
    console.warn("LocalStorage is not available. Running in a limited mode.");
}

const DataManager = {
  useFirebase: () => {
    try {
      if (localStorage.getItem('_firebaseBlocked') === 'true') return false;
    } catch (_) { /* ignore */ }
    if (typeof window !== 'undefined' && window.FirestoreService) {
      return true;
    }
    return false;
  },
  getStoreName: () => {
    // SaaS → localStorage → fallback
    if (window.SaaS && window.SaaS.getState) {
      const s = window.SaaS.getState();
      if (s && s.restaurant) return s.restaurant;
    }
    return localStorage.getItem('solo_store_name') ||
           localStorage.getItem('solo_user_restaurant') ||
           'مطعمي';
  },
  getStorePhone: () => localStorage.getItem('solo_store_phone') || '',
  getStoreAddress: () => localStorage.getItem('solo_store_address') || '',

  // --- ترتيب الفئات زي ما كانت ---
  // getCategories defined below (line ~350) — this duplicate removed
  getAggregators: async () => {
    let localData = [];
    try {
        localData = JSON.parse(localStorage.getItem('aggregators') || '[]');
    } catch (e) { localData = []; }

    let remoteData = [];
    if (DataManager.useFirebase() && navigator.onLine) {
        try {
            remoteData = await window.FirestoreService.getCollection('aggregators') || [];
        } catch (e) { console.warn("Failed to update aggregators:", e); }
    }

    const allData = [...localData, ...remoteData];
    const uniqueMap = new Map();
    allData.forEach(item => {
        const name = (item.companyName || "").trim().toUpperCase();
        if (name) {
            uniqueMap.set(name, item);
        }
    });

    const cleanList = Array.from(uniqueMap.values());
    localStorage.setItem('aggregators', JSON.stringify(cleanList));
    return cleanList;
  },

  getEmployees: async () => {
      let localData = [];
      try {
          localData = JSON.parse(localStorage.getItem('employees') || '[]');
      } catch (e) { localData = []; }

      // Offline-first: return local immediately, sync in background
      if (localData.length > 0) {
          if (DataManager.useFirebase() && navigator.onLine) {
              setTimeout(async () => {
                  try {
                      const remoteData = await window.FirestoreService.getAllEmployees();
                      if (remoteData && remoteData.length > 0) {
                          localStorage.setItem('employees', JSON.stringify(remoteData));
                      }
                  } catch (e) {}
              }, 3000);
          }
          return localData;
      }
      // First time — wait for Firebase
      if (DataManager.useFirebase() && navigator.onLine) {
          try {
              const remoteData = await window.FirestoreService.getAllEmployees();
              if (remoteData && remoteData.length > 0) {
                  localStorage.setItem('employees', JSON.stringify(remoteData));
                  return remoteData;
              }
          } catch (e) { console.warn("فشل تحديث الموظفين:", e); }
      }
      return localData;
  },

  // ======================
  // 🔥 الموردين (Suppliers) - تحديث إجباري ودمج
  // ======================
  getSuppliers: async () => {
    let localData = [];
    try {
        localData = JSON.parse(localStorage.getItem('suppliers') || '[]');
    } catch (e) { localData = []; }

    // Offline-first
    if (localData.length > 0) {
        if (DataManager.useFirebase() && navigator.onLine) {
            setTimeout(async () => {
                try {
                    const remoteData = await window.FirestoreService.getAllSuppliers();
                    if (remoteData && remoteData.length > 0) {
                        const dataMap = new Map();
                        localData.forEach(item => dataMap.set(item.id, item));
                        remoteData.forEach(item => dataMap.set(item.id, item));
                        localStorage.setItem('suppliers', JSON.stringify(Array.from(dataMap.values())));
                    }
                } catch (e) {}
            }, 3000);
        }
        return localData;
    }
    // First time
    if (DataManager.useFirebase() && navigator.onLine) {
        try {
            const remoteData = await window.FirestoreService.getAllSuppliers();
            if (remoteData && remoteData.length > 0) {
                localStorage.setItem('suppliers', JSON.stringify(remoteData));
                return remoteData;
            }
        } catch (e) { console.warn("فشل تحديث الموردين:", e); }
    }
    return localData;
  },

  // ======================
  // 🔥 المستخدمين (Users) - إضافة جديدة
  // ======================
  getUsers: async () => {
    let localData = [];
    try {
        localData = JSON.parse(localStorage.getItem('users') || '[]');
    } catch (e) { localData = []; }

    // لو أونلاين، هات الجديد وحدث اللوكال
    if (DataManager.useFirebase() && navigator.onLine) {
        try {
            // نستخدم دالة عامة لجلب الكولكشن لأن مفيش دالة مخصصة لليوزرز
            const db = window.firebaseDb;
            if (db && window.FirestoreModule && window.FirestoreModule.collection) {
                const usersRef = window.FirestoreModule.collection(db, "users");
                const safeGetDocs = window.FirestoreModule.getDocs;
                const snap = await safeGetDocs(usersRef);
                const remoteData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                
                if (remoteData && remoteData.length > 0) {
                    // دمج البيانات (البعيد يحدث المحلي)
                    const dataMap = new Map();
                    localData.forEach(item => dataMap.set(item.id, item));
                    remoteData.forEach(item => dataMap.set(item.id, item)); // الفايربيز يكتب فوق المحلي
                    
                    const merged = Array.from(dataMap.values());
                    localStorage.setItem('users', JSON.stringify(merged));
                    return merged;
                }
            }
        } catch (e) { console.warn("فشل تحديث المستخدمين:", e); }
    }
    return localData;
  },

  // ======================
  // 🔥 العملاء (Customers) - إعادة إضافة
  // ======================
  getCustomers: async () => {
    let localData = [];
    try {
        localData = JSON.parse(localStorage.getItem('customers') || '[]');
    } catch (e) { localData = []; }

    if (DataManager.useFirebase() && navigator.onLine) {
        try {
            const remoteData = await window.FirestoreService.getAllCustomers();
            if (remoteData && remoteData.length > 0) {
                const dataMap = new Map();
                localData.forEach(item => dataMap.set(item.id, item));
                remoteData.forEach(item => dataMap.set(item.id, item));
                
                const merged = Array.from(dataMap.values());
                localStorage.setItem('customers', JSON.stringify(merged));
                return merged;
            }
        } catch (e) { console.warn("فشل تحديث العملاء:", e); }
    }
    return localData;
  },

  saveSupplier: async (supplier) => {
    const localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    supplier._localId = localId;
    supplier._synced = false;
    
    let suppliers = JSON.parse(localStorage.getItem('suppliers') || '[]');
    const isUpdate = supplier.id && suppliers.findIndex(s => s.id === supplier.id) !== -1;
    
    if (supplier.id) {
      const index = suppliers.findIndex(s => s.id === supplier.id);
      if (index !== -1) suppliers[index] = supplier;
      else suppliers.push(supplier);
    } else {
      supplier.id = 'SUP' + String(Date.now()).slice(-6);
      suppliers.push(supplier);
    }
    
    localStorage.setItem('suppliers', JSON.stringify(suppliers));
    
    if (DataManager.useFirebase() && window.SyncManager) {
      window.SyncManager.addToSyncQueue('suppliers', isUpdate ? 'update' : 'add', supplier, localId);
    }
    return true;
  },

  removeSupplier: async (supplierId) => {
    let suppliers = JSON.parse(localStorage.getItem('suppliers') || '[]');
    const supplier = suppliers.find(s => s.id === supplierId);
    const filtered = suppliers.filter(s => s.id !== supplierId);
    localStorage.setItem('suppliers', JSON.stringify(filtered));
    
    if (window.SyncManager && supplier) {
      window.SyncManager.addToSyncQueue('suppliers', 'delete', { id: supplierId, ...supplier });
    }
    return true;
  },

  removeEmployee: async (employeeId) => {
    let employees = JSON.parse(localStorage.getItem('employees') || '[]');
    const employee = employees.find(e => e.id === employeeId);
    const filtered = employees.filter(e => e.id !== employeeId);
    localStorage.setItem('employees', JSON.stringify(filtered));
    
    if (window.SyncManager && employee) {
      window.SyncManager.addToSyncQueue('employees', 'delete', { id: employeeId, ...employee });
    }
    return true;
  },

  saveAggregator: async (aggregator) => {
    const localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    aggregator._localId = localId;
    aggregator._synced = false;
    
    let aggregators = JSON.parse(localStorage.getItem('aggregators') || '[]');
    
    const existingIndex = aggregators.findIndex(item => item.companyName === aggregator.companyName);

    if (existingIndex !== -1) {
        // Update existing item
        aggregators[existingIndex] = { ...aggregators[existingIndex], ...aggregator };
    } else {
        // Add new item
        aggregator.id = 'AGG' + String(Date.now()).slice(-6);
        aggregators.push(aggregator);
    }
    
    localStorage.setItem('aggregators', JSON.stringify(aggregators));
    
    const isUpdate = existingIndex !== -1;
    if (DataManager.useFirebase() && window.SyncManager) {
        window.SyncManager.addToSyncQueue('aggregators', isUpdate ? 'update' : 'add', aggregator, localId);
    }
    return true;
  },

  removeAggregator: async (aggregatorId) => {
    let aggregators = JSON.parse(localStorage.getItem('aggregators') || '[]');
    const aggregator = aggregators.find(s => s.id === aggregatorId);
    const filtered = aggregators.filter(s => s.id !== aggregatorId);
    localStorage.setItem('aggregators', JSON.stringify(filtered));
    
    if (window.SyncManager && aggregator) {
      window.SyncManager.addToSyncQueue('aggregators', 'delete', { id: aggregatorId, ...aggregator });
    }
    return true;
  },

  // ======================
  // 🔥 المنيو (Menu)
  // ======================
   getMenuItems: async () => { 
       let localItems = JSON.parse(localStorage.getItem('menuItems') || '[]'); 
       
       // الاعتماد على الداتا المحلية فوراً لمنع التأخير 
       if (localItems.length > 0) { 
           // جلب التحديثات في الخلفية بدون تعطيل الشاشة 
           if (DataManager.useFirebase() && navigator.onLine) { 
               setTimeout(async () => { 
                   try { 
                       const remoteItems = await window.FirestoreService.getAllMenuItems(); 
                       // لا تقم بالتحديث إلا لو فيه اختلاف حقيقي في عدد المنتجات 
                       if (remoteItems && remoteItems.length > 0 && remoteItems.length !== localItems.length) { 
                           localStorage.setItem('menuItems', JSON.stringify(remoteItems)); 
                       } 
                   } catch (e) {} 
               }, 2000); // تأخير الفحص ثانيتين عشان الأولوية للكاشير يشتغل 
           } 
           return localItems; // يرجع اللوكال فوراً زي الصاروخ 
       } 
       
       // لو الجهاز جديد ومفيش داتا محلية، نستنى السيرفر 
       if (DataManager.useFirebase() && navigator.onLine) { 
           try { 
               const remoteItems = await window.FirestoreService.getAllMenuItems(); 
               if (remoteItems && remoteItems.length > 0) { 
                   localStorage.setItem('menuItems', JSON.stringify(remoteItems)); 
                   return remoteItems; 
               } 
           } catch (e) {} 
       } 
       return localItems; 
   }, 
 
   getCategories: async () => {
       let localCats = [];
       try { localCats = JSON.parse(localStorage.getItem('categories') || '[]'); } catch(e) {}

       const _mergeAndSortCats = (local, remote) => {
           const allData = [...local, ...remote];
           const uniqueMap = new Map();
           allData.forEach(item => {
               const name = (item.name || '').trim().toUpperCase();
               if (name) {
                   const existing = uniqueMap.get(name);
                   if (!item.createdAt && existing && existing.createdAt) item.createdAt = existing.createdAt;
                   uniqueMap.set(name, item);
               }
           });
           const cleanList = Array.from(uniqueMap.values());
           cleanList.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
           return cleanList;
       };

       // Offline-first: return local immediately, sync in background
       if (localCats.length > 0) {
           if (DataManager.useFirebase() && navigator.onLine) {
               setTimeout(async () => {
                   try {
                       const remoteCats = await window.FirestoreService.getAllCategories() || [];
                       if (remoteCats.length > 0) {
                           const merged = _mergeAndSortCats(localCats, remoteCats);
                           localStorage.setItem('categories', JSON.stringify(merged));
                       }
                   } catch (e) {}
               }, 3000);
           }
           localCats.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
           return localCats;
       }
       // First time
       if (DataManager.useFirebase() && navigator.onLine) {
           try {
               const remoteCats = await window.FirestoreService.getAllCategories() || [];
               if (remoteCats.length > 0) {
                   const merged = _mergeAndSortCats([], remoteCats);
                   localStorage.setItem('categories', JSON.stringify(merged));
                   return merged;
               }
           } catch (e) { console.warn('Failed to update categories:', e); }
       }
       return localCats;
   }, 
 
   getIngredients: async () => { 
       let localIngs = JSON.parse(localStorage.getItem('ingredients') || '[]'); 
       
       if (localIngs.length > 0) { 
           if (DataManager.useFirebase() && navigator.onLine) { 
               setTimeout(async () => { 
                   try { 
                       const remoteIngs = await window.FirestoreService.getAllIngredients(); 
                       if (remoteIngs && remoteIngs.length > 0 && remoteIngs.length !== localIngs.length) { 
                           localStorage.setItem('ingredients', JSON.stringify(remoteIngs)); 
                       } 
                   } catch (e) {} 
               }, 2000); 
           } 
           return localIngs; 
       } 
 
       if (DataManager.useFirebase() && navigator.onLine) { 
           try { 
               const remoteIngs = await window.FirestoreService.getAllIngredients(); 
               if (remoteIngs && remoteIngs.length > 0) { 
                   localStorage.setItem('ingredients', JSON.stringify(remoteIngs)); 
                   return remoteIngs; 
               } 
           } catch (e) {} 
       } 
       return localIngs; 
   },

  // ======================
  // Orders
  // ======================
  getOrders: async () => {
      let localOrders = [];
      try {
          localOrders = JSON.parse(localStorage.getItem('orders') || '[]');
      } catch (e) { return []; }

      const ordersLocalOnly = localStorage.getItem('_ordersLocalOnly') === 'true';
      if (ordersLocalOnly) return localOrders;

      const _sortOrders = (arr) => arr.sort((a, b) => {
          const dateA = new Date(a.createdAt || a.date || a.timestamp || 0).getTime();
          const dateB = new Date(b.createdAt || b.date || b.timestamp || 0).getTime();
          return dateB - dateA;
      });

      // Offline-first: return local immediately, sync in background
      if (localOrders.length > 0) {
          if (DataManager.useFirebase() && navigator.onLine) {
              setTimeout(async () => {
                  try {
                      const remoteOrders = await window.FirestoreService.getAllOrders();
                      if (remoteOrders && remoteOrders.length > 0) {
                          const ordersMap = new Map();
                          localOrders.forEach(o => ordersMap.set(String(o.id), o));
                          remoteOrders.forEach(o => ordersMap.set(String(o.id), o));
                          const merged = _sortOrders(Array.from(ordersMap.values()));
                          localStorage.setItem('orders', JSON.stringify(merged));
                      }
                  } catch (e) {}
              }, 3000);
          }
          return localOrders;
      }
      // First time (empty local) — wait for Firebase
      if (DataManager.useFirebase() && navigator.onLine) {
          try {
              const remoteOrders = await window.FirestoreService.getAllOrders();
              if (remoteOrders && remoteOrders.length > 0) {
                  const sorted = _sortOrders([...remoteOrders]);
                  localStorage.setItem('orders', JSON.stringify(sorted));
                  return sorted;
              }
          } catch (e) { console.warn('Orders sync failed:', e); }
      }
      return localOrders;
  },
  
  saveOrder: async (order) => {
    try {
      const currentSession = await DataManager.getTodayCashSession();
      if (currentSession && currentSession.id) order.shift_id = currentSession.id;
    } catch (error) {}
    
    const localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    order._localId = localId;
    order._synced = false;
    
    const now = new Date();
    order.isoDate = now.toISOString().split('T')[0];
    order.timestamp = now.getTime();
    
    const orders = JSON.parse(localStorage.getItem('orders') || '[]');
    const id = order.id ? String(order.id) : '';
    
    if (id) {
      const idx = orders.findIndex(o => String(o?.id ?? '') === id);
      if (idx >= 0) orders[idx] = { ...orders[idx], ...order };
      else orders.push(order);
    } else {
      orders.push(order);
    }
    
    localStorage.setItem('orders', JSON.stringify(orders));
    
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('orderUpdated', { detail: { orderId: order.id, order: order } }));
    }
    
    if (DataManager.useFirebase() && window.SyncManager) {
      window.SyncManager.addToSyncQueue('orders', 'add', order, localId);
    }
    return true;
  },

  getOrdersOnHold: async () => {
    return JSON.parse(localStorage.getItem('ordersOnHold') || '[]');
  },

  saveOrderOnHold: async (order) => {
    const orders = JSON.parse(localStorage.getItem('ordersOnHold') || '[]');
    orders.push(order);
    localStorage.setItem('ordersOnHold', JSON.stringify(orders));
    return true;
  },

  removeOrderOnHold: async (orderId) => {
    const orders = JSON.parse(localStorage.getItem('ordersOnHold') || '[]');
    const filtered = orders.filter(o => o.id !== orderId);
    localStorage.setItem('ordersOnHold', JSON.stringify(filtered));
    return true;
  },

  // ======================
  // Sales & Cash
  // ======================
  getSalesHistory: async () => {
    return JSON.parse(localStorage.getItem('salesHistory') || '[]');
  },
  
  saveSale: async (sale) => {
    const sales = JSON.parse(localStorage.getItem('salesHistory') || '[]');
    sales.push(sale);
    localStorage.setItem('salesHistory', JSON.stringify(sales));
    
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('orderUpdated', { detail: { saleId: sale.id, sale: sale } }));
    }
    
    // Fire-and-forget the cloud sync
    if (DataManager.useFirebase() && window.SyncManager) {
      const localId = `local_sale_${Date.now()}`;
      // DO NOT AWAIT. Let it run in the background.
      window.SyncManager.addToSyncQueue('salesHistory', 'add', sale, localId);
    }
    return true;
  },
  
  generateOrderId: async () => {
    const orders = JSON.parse(localStorage.getItem('orders') || '[]');
    const onHold = JSON.parse(localStorage.getItem('ordersOnHold') || '[]');
    const total = orders.length + onHold.length;
    return `ORD${String(total + 1).padStart(6, '0')}`;
  },

  // ======================
  // Cash Sessions (Shifts)
  // ======================
  getCashSessions: async () => {
    const localSessions = JSON.parse(localStorage.getItem('cashSessions') || '[]');

    const _normSession = (s) => {
        if (!s) return null;
        const id = s.id || s.shift_id;
        if (!id) return null;
        return { ...s, id, openingAmount: s.opening_balance || s.openingAmount || 0,
            cashier_name: s.cashier_name || s.cashierName || 'Admin', status: s.status || 'open' };
    };
    const _mergeSessions = (local, fbRaw) => {
        const fbSessions = (fbRaw || []).map(_normSession).filter(Boolean);
        const sessionMap = new Map();
        local.forEach(s => sessionMap.set(s.id, s));
        fbSessions.forEach(s => { if (!sessionMap.has(s.id)) sessionMap.set(s.id, s); });
        return Array.from(sessionMap.values());
    };

    // Offline-first: return local immediately, sync in background
    if (localSessions.length > 0) {
        if (DataManager.useFirebase() && navigator.onLine) {
            setTimeout(async () => {
                try {
                    const firebaseSessionsRaw = await window.FirestoreService.getShifts();
                    if (!firebaseSessionsRaw || firebaseSessionsRaw.length === 0) return;
                    const merged = _mergeSessions(localSessions, firebaseSessionsRaw);
                    if (merged.length !== localSessions.length) {
                        localStorage.setItem('cashSessions', JSON.stringify(merged));
                    }
                } catch (e) {}
            }, 5000);
        }
        return localSessions;
    }
    // First time
    if (DataManager.useFirebase() && navigator.onLine) {
        try {
            if (!window.firebaseDb) await new Promise(r => setTimeout(r, 500));
            const firebaseSessionsRaw = await window.FirestoreService.getShifts();
            if (!firebaseSessionsRaw || firebaseSessionsRaw.length === 0) return localSessions;
            const merged = _mergeSessions(localSessions, firebaseSessionsRaw);
            localStorage.setItem('cashSessions', JSON.stringify(merged));
            return merged;
        } catch (e) { return localSessions; }
    }
    return localSessions;
  },
  
  saveCashSession: async (session) => {
    const sessions = JSON.parse(localStorage.getItem('cashSessions') || '[]');
    
    if (session.id) {
      const index = sessions.findIndex(s => s.id === session.id);
      if (index !== -1) sessions[index] = { ...sessions[index], ...session };
      else sessions.push(session);
    } else {
      const businessDate = session.date || DataManager.getBusinessDate();
      session.id = 'SESSION-' + businessDate.replace(/-/g, '') + '-' + String(Date.now()).slice(-6);
      session.date = businessDate;
      session.createdAt = new Date().toISOString();
      if (!session.openedBy) session.openedBy = localStorage.getItem('username') || 'المستخدم';
      sessions.push(session);
    }
    
    const localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    session._localId = localId;
    session._synced = false;
    
    localStorage.setItem('cashSessions', JSON.stringify(sessions));
    
    if (DataManager.useFirebase() && window.SyncManager) {
      const isUpdate = session.id && sessions.findIndex(s => s.id === session.id) !== -1;
      const shiftData = {
        id: session.id,
        cashier_name: session.cashier_name || session.cashierName || 'Admin',
        opening_balance: session.openingAmount || session.opening_balance || 0,
        ...session
      };
      window.SyncManager.addToSyncQueue('shifts', isUpdate ? 'update' : 'add', shiftData, localId);
    }
    return true;
  },

  getTodayCashSession: async () => {
    const sessions = await DataManager.getCashSessions();

    // هيدور على أي شيفت مفتوح بغض النظر إحنا في أي تاريخ
    const open = (sessions || []).filter(s => s.status === 'open');
    if (open.length === 0) return null;
    if (open.length === 1) return open[0];

    // لو لقى أكتر من شيفت مفتوح (بالغلط)، هيجيب أحدث واحد فيهم
    open.sort((a, b) => {
      const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tB - tA;
    });
    return open[0];
  },

  updateCashSession: async (sessionId, updates) => {
    const sessions = JSON.parse(localStorage.getItem('cashSessions') || '[]');
    const index = sessions.findIndex(s => s.id === sessionId);
    
    if (index !== -1) {
      sessions[index] = { ...sessions[index], ...updates };
      if (updates.status === 'closed' && !sessions[index].closedAt) {
          sessions[index].closedAt = new Date().toISOString();
          sessions[index].closedBy = localStorage.getItem('username') || 'المستخدم';
      }
      
      const localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      sessions[index]._localId = localId;
      sessions[index]._synced = false;
      
      localStorage.setItem('cashSessions', JSON.stringify(sessions));
      
      if (DataManager.useFirebase() && window.SyncManager) {
        window.SyncManager.addToSyncQueue('shifts', 'update', { id: sessionId, ...sessions[index] }, localId);
      }
      return sessions[index];
    }
    return null;
  },

  // ======================
  // Expenses
  // ======================
  getExpenses: async () => {
    const localExpenses = JSON.parse(localStorage.getItem('expenses') || '[]');

    // Offline-first
    if (localExpenses.length > 0) {
        if (DataManager.useFirebase() && navigator.onLine) {
            setTimeout(async () => {
                try {
                    const firebaseExpenses = await window.FirestoreService.getAllExpenses();
                    if (firebaseExpenses && firebaseExpenses.length > 0) {
                        const merged = [...localExpenses, ...firebaseExpenses].filter((e, i, self) =>
                            i === self.findIndex(x => x.id === e.id)
                        );
                        localStorage.setItem('expenses', JSON.stringify(merged));
                    }
                } catch (e) {}
            }, 3000);
        }
        return localExpenses;
    }
    // First time
    if (DataManager.useFirebase() && navigator.onLine) {
        try {
            const firebaseExpenses = await window.FirestoreService.getAllExpenses();
            const merged = [...firebaseExpenses, ...localExpenses].filter((e, i, self) =>
                i === self.findIndex(x => x.id === e.id)
            );
            localStorage.setItem('expenses', JSON.stringify(merged));
            return merged;
        } catch (e) { console.warn('Expenses sync failed:', e); }
    }
    return localExpenses;
  },

  saveExpense: async (expense) => {
    try {
      const currentSession = await DataManager.getTodayCashSession();
      if (currentSession && currentSession.id) expense.shift_id = currentSession.id;
    } catch (e) {}

    const expenses = JSON.parse(localStorage.getItem('expenses') || '[]');
    
    if (expense.id) {
      const index = expenses.findIndex(e => e.id === expense.id);
      if (index !== -1) expenses[index] = expense;
      else expenses.push(expense);
    } else {
      const now = new Date();
      expense.date = expense.date || DataManager.getEgyptDate();
      expense.id = 'EXP-' + expense.date.replace(/-/g, '') + '-' + String(now.getTime()).slice(-6);
      expense.createdAt = now.toISOString();
      expenses.push(expense);
    }
    
    const localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    expense._localId = localId;
    expense._synced = false;
    
    localStorage.setItem('expenses', JSON.stringify(expenses));
    try { await DataManager.saveExpenseToHistory({ ...expense }); } catch (e) {}

    if (DataManager.useFirebase() && window.SyncManager) {
      const isUpdate = expense.id && expenses.findIndex(e => e.id === expense.id && e !== expense) !== -1;
      window.SyncManager.addToSyncQueue('expenses', isUpdate ? 'update' : 'add', expense, localId);
    }
    return true;
  },

  updateExpense: async (expenseId, updates) => {
    const expenses = JSON.parse(localStorage.getItem('expenses') || '[]');
    const index = expenses.findIndex(e => e.id === expenseId);
    if (index !== -1) {
      const localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      expenses[index] = { ...expenses[index], ...updates, _localId: localId, _synced: false };
      localStorage.setItem('expenses', JSON.stringify(expenses));
      if (DataManager.useFirebase() && window.SyncManager) {
        window.SyncManager.addToSyncQueue('expenses', 'update', { id: expenseId, ...expenses[index] }, localId);
      }
      return true;
    }
    return false;
  },

  removeExpense: async (expenseId) => {
    let expenses = JSON.parse(localStorage.getItem('expenses') || '[]');
    const expense = expenses.find(e => e.id === expenseId);
    const filtered = expenses.filter(e => e.id !== expenseId);
    localStorage.setItem('expenses', JSON.stringify(filtered));
    if (DataManager.useFirebase() && window.SyncManager && expense) {
      window.SyncManager.addToSyncQueue('expenses', 'delete', { id: expenseId, ...expense });
    }
    return true;
  },

  // ======================
  // Expenses History
  // ======================
  getExpensesHistory: async () => {
    const localHistory = JSON.parse(localStorage.getItem('expensesHistory') || '[]');
    if (DataManager.useFirebase() && navigator.onLine) {
      try {
        const remoteHistory = await window.FirestoreService.getAllExpensesHistory();
        const merged = [...remoteHistory, ...localHistory].filter((e, i, self) => 
            i === self.findIndex(x => x.id === e.id)
        );
        localStorage.setItem('expensesHistory', JSON.stringify(merged));
        return merged;
      } catch (e) { console.warn('Expense history sync failed:', e); }
    }
    return localHistory;
  },
  
  saveExpenseToHistory: async (expense) => {
    const history = JSON.parse(localStorage.getItem('expensesHistory') || '[]');
    history.push(expense);
    localStorage.setItem('expensesHistory', JSON.stringify(history));
    if (DataManager.useFirebase() && window.SyncManager) {
        const localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        window.SyncManager.addToSyncQueue('expensesHistory', 'add', expense, localId);
    }
    return true;
  },
  


  // ======================
  // General Utils
  // ======================
  loadData: async (key) => {
      return JSON.parse(localStorage.getItem(key) || '[]');
  },

  // جلب التاريخ بتوقيت مصر الدقيق (يقلب يوم جديد الساعة 12:00 منتصف الليل فوراً)
  getEgyptDate: () => {
      const d = new Date(new Date().toLocaleString("en-US", {timeZone: "Africa/Cairo"}));
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${d.getFullYear()}-${mm}-${dd}`;
  },

  // اليوم التجاري متطابق تماماً مع تاريخ اليوم في مصر
  getBusinessDate: () => {
      const d = new Date(new Date().toLocaleString("en-US", {timeZone: "Africa/Cairo"}));
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${d.getFullYear()}-${mm}-${dd}`;
  },

  generateIdFor: (collectionName) => {
    const prefix = collectionName.slice(0, 3).toUpperCase();
    return `${prefix}${Date.now()}`;
  },

  // Generic save and get functions
  save: async (collectionName, data) => {
    // 🔒 حقن restaurantId قبل الحفظ المحلي لضمان عزل البيانات
    if (collectionName !== 'settings') {
        const _uid = localStorage.getItem('userId') || localStorage.getItem('_saasUid');
        if (_uid && !data.restaurantId) data.restaurantId = _uid;
    }

    let collection = JSON.parse(localStorage.getItem(collectionName) || '[]');

    if (data.id) {
        const index = collection.findIndex(item => item.id === data.id);
        if (index !== -1) {
            collection[index] = { ...collection[index], ...data };
        } else {
            collection.push(data);
        }
    } else {
        data.id = DataManager.generateIdFor(collectionName);
        collection.push(data);
    }
    
    localStorage.setItem(collectionName, JSON.stringify(collection));
    
    if (DataManager.useFirebase() && window.SyncManager) {
        const localId = `local_${Date.now()}`;
        data._localId = localId;
        data._synced = false;
        window.SyncManager.addToSyncQueue(collectionName, data.id ? 'update' : 'add', data, localId);
    }
    return data;
  },

remove: async (collectionName, itemId) => {
    // 1. مسح من الذاكرة المحلية
    let collection = JSON.parse(localStorage.getItem(collectionName) || '[]');
    const filtered = collection.filter(i => String(i.id) !== String(itemId));
    localStorage.setItem(collectionName, JSON.stringify(filtered));
    
    // 2. تنظيف طابور المزامنة
    let syncQueue = JSON.parse(localStorage.getItem('_syncQueue') || '[]');
    syncQueue = syncQueue.filter(job => job.data && String(job.data.id) !== String(itemId));
    localStorage.setItem('_syncQueue', JSON.stringify(syncQueue));

    // 3. الضرب المباشر في سيرفرات جوجل
    if (DataManager.useFirebase() && typeof window.firebase !== 'undefined' && window.firebase.firestore) {
        try {
            console.log(`🔥 إبادة مباشرة لـ ${itemId} من ${collectionName}...`);
            await window.firebase.firestore().collection(collectionName).doc(String(itemId)).delete();
            console.log(`✅ تمت الإبادة بنجاح.`);
        } catch (error) {
            console.error(`❌ فشل المسح من السيرفر:`, error);
        }
    }
    return true;
  },
  get: async (collectionName, id) => {
    const collection = await DataManager.loadData(collectionName);
    return collection.find(item => item.id === id);
  }
};

if (typeof window !== 'undefined') {
    window.DataManager = DataManager;
}
