
// بيانات نظام نقاط البيع - Solo POS SaaS
// ═══════════════════════════════════════════════════════════════════════════
// 🚀 الإصدار الجديد: 100% SQLite عبر window.DBService
// لا يعتمد على localStorage للبيانات التشغيلية أبداً
// البيانات التشغيلية: orders, menuItems, categories, ingredients, expenses,
//   expensesHistory, employees, suppliers, aggregators, customers, salesHistory,
//   ordersOnHold, cashSessions
// ═══════════════════════════════════════════════════════════════════════════


// ⏰ الوقت الآن بتوقيت مصر (مشترك مع dashboard.js)
function _egyptNow() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());
}
const menuData = {
  categories: [], // مصفوفة فارغة
  items: []       // مصفوفة فارغة
};

// Make menuData globally accessible
if (typeof window !== 'undefined') {
    window.menuData = menuData;
}
var globalMenuData = menuData;

// ═══════════════════════════════════════════════════════════════════════════
// localStorage مسموح فقط لـ: settings, users, auth, saas, UI preferences
// ═══════════════════════════════════════════════════════════════════════════
const _nonOperationalKeys = [
    'users', 'settings', 'attendance', 'notifications', 'performance',
    'daily_log', 'performance_snapshots'
];

try {
    _nonOperationalKeys.forEach(key => {
        if (localStorage.getItem(key) === null) {
            localStorage.setItem(key, JSON.stringify([]));
        }
    });

    // Clear all data on first run (for clean distribution)
    if (!localStorage.getItem('first_run_completed')) {
        const keysToRemove = [
            'orders', 'ordersOnHold', 'salesHistory', 'suppliers', 'cashSessions',
            'expenses', 'expensesHistory', 'menuItems', 'ingredients', 'categories',
            'employees', 'customers', 'aggregators',
            'isLoggedIn', 'username', 'userType',
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

  // ======================
  // 🛵 شركات التوصيل (Aggregators) — SQLite Only
  // ======================
  getAggregators: async () => {
    try {
        const sqlData = await window.DBService.getAggregators();
        // مزامنة Firebase في الخلفية
        if (DataManager.useFirebase() && navigator.onLine) {
            setTimeout(async () => {
                try {
                    const remoteData = await window.FirestoreService.getCollection('aggregators') || [];
                    if (remoteData && remoteData.length > 0) {
                        for (const agg of remoteData)
                            await window.DBService.saveAggregator(agg, { alreadySynced: true });
                    }
                } catch(e) {}
            }, 3000);
        }
        return sqlData;
    } catch(e) {
        console.warn('[DataManager] getAggregators SQLite err:', e.message);
        return [];
    }
  },

  // ======================
  // 👨‍💼 الموظفين (Employees) — SQLite Only
  // ======================
  getEmployees: async () => {
      try {
          const sqlData = await window.DBService.getEmployees();
          // مزامنة Firebase في الخلفية
          if (DataManager.useFirebase() && navigator.onLine) {
              setTimeout(async () => {
                  try {
                      const remoteData = await window.FirestoreService.getAllEmployees();
                      if (remoteData && remoteData.length > 0) {
                          // جيب الـ local أولاً عشان نحمي الراتب المحفوظ محلياً
                          const localMap = {};
                          try {
                              const localRows = await window.DBService.getEmployees();
                              for (const le of localRows) localMap[le.id] = le;
                          } catch(_) {}
                          for (const emp of remoteData) {
                              const local = localMap[emp.id];
                              // لو محلي عنده راتب وFire مش عندها، احتفظ بالمحلي
                              const safeSalary = emp.salary_amount || emp.salary || (local ? (local.salary_amount || local.salary || 0) : 0);
                              await window.DBService.saveEmployee(
                                  { ...emp, salary_amount: safeSalary, salary: safeSalary },
                                  { alreadySynced: true }
                              );
                          }
                      }
                  } catch(e) {}
              }, 3000);
          }
          return sqlData;
      } catch(e) {
          console.warn('[DataManager] getEmployees SQLite err:', e.message);
          return [];
      }
  },

  // ======================
  // 📦 الموردين (Suppliers) — SQLite Only
  // ======================
  getSuppliers: async () => {
    try {
        const sqlData = await window.DBService.getSuppliers();
        if (DataManager.useFirebase() && navigator.onLine) {
            setTimeout(async () => {
                try {
                    const remoteData = await window.FirestoreService.getAllSuppliers();
                    if (remoteData && remoteData.length > 0) {
                        for (const sup of remoteData)
                            await window.DBService.saveSupplier(sup, { alreadySynced: true });
                    }
                } catch(e) {}
            }, 3000);
        }
        return sqlData;
    } catch(e) {
        console.warn('[DataManager] getSuppliers SQLite err:', e.message);
        return [];
    }
  },

  // ======================
  // 🔥 المستخدمين (Users) — localStorage مسموح (ليست بيانات تشغيلية)
  // ======================
  getUsers: async () => {
    let localData = [];
    try {
        localData = JSON.parse(localStorage.getItem('users') || '[]');
    } catch (e) { localData = []; }

    if (DataManager.useFirebase() && navigator.onLine) {
        try {
            const db = window.firebaseDb;
            if (db && window.FirestoreModule && window.FirestoreModule.collection) {
                const usersRef = window.FirestoreModule.collection(db, "users");
                const safeGetDocs = window.FirestoreModule.getDocs;
                const snap = await safeGetDocs(usersRef);
                const remoteData = snap.docs.map(d => ({ id: d.id, ...d.data() }));

                if (remoteData && remoteData.length > 0) {
                    const dataMap = new Map();
                    localData.forEach(item => dataMap.set(item.id, item));
                    remoteData.forEach(item => dataMap.set(item.id, item));

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
  // 👥 العملاء (Customers) — SQLite Only
  // ======================
  getCustomers: async () => {
    try {
        const sqlData = await window.DBService.getCustomers();
        if (DataManager.useFirebase() && navigator.onLine) {
            setTimeout(async () => {
                try {
                    const remoteData = await window.FirestoreService.getAllCustomers();
                    if (remoteData && remoteData.length > 0) {
                        for (const c of remoteData)
                            await window.DBService.saveCustomer(c, { alreadySynced: true });
                    }
                } catch(e) {}
            }, 3000);
        }
        return sqlData;
    } catch(e) {
        console.warn('[DataManager] getCustomers SQLite err:', e.message);
        return [];
    }
  },

  // ======================
  // حفظ/حذف Suppliers — SQLite Only
  // ======================
  saveSupplier: async (supplier) => {
    const localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    supplier._localId = localId;
    supplier._synced = false;

    let isUpdate = false;
    try {
        if (supplier.id) {
            const existing = await window.DBService.getSuppliers();
            isUpdate = existing.some(s => s.id === supplier.id);
        }
        supplier.id = await window.DBService.saveSupplier(supplier);
    } catch(e) {
        console.error('[DataManager] saveSupplier SQLite err:', e.message);
        if (!supplier.id) supplier.id = 'SUP' + String(Date.now()).slice(-6);
    }

    if (DataManager.useFirebase() && window.SyncManager) {
      window.SyncManager.addToSyncQueue('suppliers', isUpdate ? 'update' : 'add', supplier, localId);
    }
    return true;
  },

  removeSupplier: async (supplierId) => {
    try {
        await window.DBService.removeSupplier(supplierId);
    } catch(e) { console.warn('[DataManager] removeSupplier SQLite err:', e.message); }

    if (window.SyncManager) {
      window.SyncManager.addToSyncQueue('suppliers', 'delete', { id: supplierId });
    }
    return true;
  },

  // ======================
  // حذف Employees — SQLite Only
  // ======================
  removeEmployee: async (employeeId) => {
    try {
        await window.DBService.removeEmployee(employeeId);
    } catch(e) { console.warn('[DataManager] removeEmployee SQLite err:', e.message); }

    if (window.SyncManager) {
      window.SyncManager.addToSyncQueue('employees', 'delete', { id: employeeId });
    }
    return true;
  },

  // ======================
  // حفظ/حذف Aggregators — SQLite Only
  // ======================
  saveAggregator: async (aggregator) => {
    const localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    aggregator._localId = localId;
    aggregator._synced = false;

    let isUpdate = false;
    try {
        const existing = await window.DBService.getAggregators();
        isUpdate = existing.some(a => (a.companyName || a.name) === (aggregator.companyName || aggregator.name));
        aggregator.id = await window.DBService.saveAggregator(aggregator);
    } catch(e) {
        console.error('[DataManager] saveAggregator SQLite err:', e.message);
        if (!aggregator.id) aggregator.id = 'AGG' + String(Date.now()).slice(-6);
    }

    if (DataManager.useFirebase() && window.SyncManager) {
        window.SyncManager.addToSyncQueue('aggregators', isUpdate ? 'update' : 'add', aggregator, localId);
    }
    return true;
  },

  removeAggregator: async (aggregatorId) => {
    try {
        await window.DBService.removeAggregator(aggregatorId);
    } catch(e) { console.warn('[DataManager] removeAggregator SQLite err:', e.message); }

    if (window.SyncManager) {
      window.SyncManager.addToSyncQueue('aggregators', 'delete', { id: aggregatorId });
    }
    return true;
  },

  // ======================
  // 🍔 المنيو (Menu) — SQLite Only
  // ======================
   getMenuItems: async () => {
       try {
           const sqlData = await window.DBService.getMenuItems();
           if (DataManager.useFirebase() && navigator.onLine) {
               setTimeout(async () => {
                   try {
                       const remoteItems = await window.FirestoreService.getAllMenuItems();
                       if (remoteItems && remoteItems.length > 0) {
                           for (const item of remoteItems)
                               await window.DBService.saveMenuItem(item, { alreadySynced: true });
                       }
                   } catch (e) {}
               }, 2000);
           }
           return sqlData;
       } catch(e) {
           console.warn('[DataManager] getMenuItems SQLite err:', e.message);
           return [];
       }
   },

   getCategories: async () => {
       try {
           const sqlData = await window.DBService.getCategories();
           if (DataManager.useFirebase() && navigator.onLine) {
               setTimeout(async () => {
                   try {
                       const remoteCats = await window.FirestoreService.getAllCategories() || [];
                       if (remoteCats.length > 0) {
                           for (const cat of remoteCats)
                               await window.DBService.saveCategory(cat, { alreadySynced: true });
                       }
                   } catch (e) {}
               }, 3000);
           }
           sqlData.sort((a, b) => new Date(a.createdAt || a.created_at || 0) - new Date(b.createdAt || b.created_at || 0));
           return sqlData;
       } catch(e) {
           console.warn('[DataManager] getCategories SQLite err:', e.message);
           return [];
       }
   },

   // ======================
   // 🧪 المواد الخام (Ingredients) — SQLite Only
   // ======================
   getIngredients: async () => {
       try {
           const sqlData = await window.DBService.getIngredients();
           if (DataManager.useFirebase() && navigator.onLine) {
               setTimeout(async () => {
                   try {
                       const remoteIngs = await window.FirestoreService.getAllIngredients();
                       if (remoteIngs && remoteIngs.length > 0) {
                           for (const ing of remoteIngs)
                               await window.DBService.saveIngredient(ing, { alreadySynced: true });
                       }
                   } catch (e) {}
               }, 2000);
           }
           return sqlData;
       } catch(e) {
           console.warn('[DataManager] getIngredients SQLite err:', e.message);
           return [];
       }
   },

  // ======================
  // 📋 Orders — SQLite Only
  // ======================
  getOrders: async (filters = {}) => {
      try {
          const localOrders = await window.DBService.getOrders(filters);

          // مزامنة Firebase في الخلفية (بدون تأخير الواجهة)
          if (DataManager.useFirebase() && navigator.onLine && !filters.session_id) {
              setTimeout(async () => {
                  try {
                      const remoteOrders = await window.FirestoreService.getAllOrders();
                      if (remoteOrders && remoteOrders.length > 0) {
                          for (const o of remoteOrders) {
                              await window.DBService.saveOrder(o, { alreadySynced: true });
                          }
                      }
                  } catch (e) {}
              }, 3000);
          }

          return localOrders;
      } catch (err) {
          console.warn('[DataManager] getOrders → SQLite failed:', err.message);
          return [];
      }
  },

  saveOrder: async (order) => {
      // ── ربط الشيفت الحالي ────────────────────────────────────────────────
      try {
          const currentSession = await DataManager.getTodayCashSession();
          if (currentSession?.id) {
              order.session_id = currentSession.id;
              order.shift_id   = currentSession.id;
          }
      } catch (_) {}

      const now     = new Date();
      const localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      order._localId  = localId;
      order._synced   = false;
      order.isoDate   = DataManager.getEgyptDate();
      order.timestamp = now.getTime();

      // ── حفظ في SQLite (المصدر الوحيد) ─────────────────────────────────────
      try {
          order.id = await window.DBService.saveOrder(order);
      } catch (err) {
          console.error('[DataManager] saveOrder → SQLite FAILED:', err.message);
          if (!order.id) order.id = `ORD-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
      }

      // ── تحديث إحصائيات العميل ────────────────────────────────────────────
      if (order.customer_id || order.customerId) {
          try {
              const cid = order.customer_id || order.customerId;
              const pts = Math.floor((order.total || 0) / 10);
              await window.DBService.updateCustomerStats(cid, order.total || 0, pts);
          } catch (_) {}
      }

      // ── إشعار UI ─────────────────────────────────────────────────────────
      window.dispatchEvent(new CustomEvent('orderUpdated', { detail: { orderId: order.id, order } }));

      // ── قائمة انتظار Firebase ─────────────────────────────────────────────
      if (DataManager.useFirebase() && window.SyncManager) {
          window.SyncManager.addToSyncQueue('orders', 'add', order, localId);
      }

      return true;
  },

  // ======================
  // 🛒 Orders On Hold — SQLite Only
  // ======================
  getOrdersOnHold: async () => {
    try {
        return await window.DBService.getOrdersOnHold();
    } catch(e) {
        console.warn('[DataManager] getOrdersOnHold SQLite err:', e.message);
        return [];
    }
  },

  saveOrderOnHold: async (order) => {
    try {
        order.id = await window.DBService.saveOrderOnHold(order);
    } catch(e) {
        console.error('[DataManager] saveOrderOnHold SQLite err:', e.message);
        if (!order.id) order.id = `HOLD-${Date.now()}`;
    }
    return true;
  },

  removeOrderOnHold: async (orderId) => {
    try {
        await window.DBService.removeOrderOnHold(orderId);
    } catch(e) {
        console.warn('[DataManager] removeOrderOnHold SQLite err:', e.message);
    }
    return true;
  },

  // ======================
  // 📜 Sales History — SQLite Only
  // ======================
  getSalesHistory: async () => {
    try {
        return await window.DBService.getSalesHistory();
    } catch(e) {
        console.warn('[DataManager] getSalesHistory SQLite err:', e.message);
        return [];
    }
  },

  saveSale: async (sale) => {
    try {
        sale.id = await window.DBService.saveSaleHistory(sale);
    } catch(e) {
        console.error('[DataManager] saveSale SQLite err:', e.message);
        if (!sale.id) sale.id = `SALE-${Date.now()}`;
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('orderUpdated', { detail: { saleId: sale.id, sale: sale } }));
    }

    if (DataManager.useFirebase() && window.SyncManager) {
      const localId = `local_sale_${Date.now()}`;
      window.SyncManager.addToSyncQueue('salesHistory', 'add', sale, localId);
    }
    return true;
  },

  generateOrderId: async () => {
    try {
        const orders = await window.DBService.getOrders({ limit: 1 });
        const onHold = await window.DBService.getOrdersOnHold();
        // استخدم timestamp-based ID بدلاً من count-based (أكثر أماناً)
        const seq = (orders.length || 0) + (onHold.length || 0) + 1;
        return `ORD${String(seq).padStart(6, '0')}`;
    } catch(e) {
        return `ORD${Date.now().toString().slice(-6)}`;
    }
  },

  // ======================
  // Cash Sessions (Shifts) — SQLite Only (already migrated)
  // ======================
  getCashSessions: async () => {
      try {
          const localSessions = await window.DBService.getCashSessions();

          // مزامنة Firebase في الخلفية
          if (DataManager.useFirebase() && navigator.onLine) {
              setTimeout(async () => {
                  try {
                      const fbRaw = await window.FirestoreService.getShifts();
                      if (!fbRaw || fbRaw.length === 0) return;

                      const localSessions = await window.DBService.getCashSessions().catch(() => []);
                      const localMap = new Map(localSessions.map(s => [s.id, s]));

                      const recentClose = window._shiftJustClosed ||
                          sessionStorage.getItem('_shiftJustClosed') === '1';

                      for (const s of fbRaw) {
                          const local = localMap.get(s.id);
                          const fbStatus    = (s.status || 'open').toLowerCase();
                          const localStatus = (local && local.status || '').toLowerCase();

                          // Guard 1: local=closed + FB=open → Firebase stale
                          if (local && localStatus === 'closed' && fbStatus === 'open') {
                              console.log(`[DataManager] ⛔ Skipping stale Firebase session ${s.id}`);
                              continue;
                          }

                          // Guard 2: recentClose flag
                          if (recentClose && fbStatus === 'open') {
                              console.log(`[DataManager] ⛔ Skipping Firebase session ${s.id} (recentClose)`);
                              try {
                                  const updShift = window.FirestoreService?.updateShift || window.updateShift;
                                  if (typeof updShift === 'function') {
                                      await updShift(String(s.id), { status: 'closed', closedAt: _egyptNow() });
                                  }
                              } catch(_) {}
                              continue;
                          }

                          // Guard 3: لو فيه شيفت محلي مفتوح بنفس التاريخ والكاشير → ده duplicate
                          if (!local && fbStatus === 'open') {
                              const fbDate = (s.date || s.businessDate || s.opened_at || s.createdAt || '').slice(0, 10);
                              const fbCashier = s.openedBy || s.opened_by || s.cashier_name || '';
                              const hasDuplicate = localSessions.some(ls => {
                                  const lsDate = (ls.date || ls.businessDate || ls.opened_at || ls.createdAt || '').slice(0, 10);
                                  const lsCashier = ls.openedBy || ls.opened_by || ls.cashier_name || '';
                                  return ls.status === 'open' && lsDate === fbDate && lsCashier === fbCashier;
                              });
                              if (hasDuplicate) {
                                  console.log(`[DataManager] ⛔ Skipping duplicate Firebase session ${s.id} (same date+cashier)`);
                                  continue;
                              }

                              // Guard 4: الـ ID مش بصيغة SHIFT-xxx → garbage doc من sync قديم → تجاهل
                              if (!String(s.id || '').startsWith('SHIFT-')) {
                                  console.log(`[DataManager] ⛔ Skipping malformed Firebase session ${s.id} (not SHIFT-xxx format)`);
                                  continue;
                              }

                              // Guard 5: لو فيه شيفت محلي مغلق في نفس اليوم → ما تفتحش شيفت جديد من Firebase
                              const hasClosedSameDay = localSessions.some(ls => {
                                  const lsDate = (ls.date || ls.businessDate || ls.opened_at || ls.createdAt || '').slice(0, 10);
                                  return ls.status === 'closed' && lsDate === fbDate;
                              });
                              if (hasClosedSameDay && !localSessions.some(ls => ls.status === 'open')) {
                                  console.log(`[DataManager] ⛔ Skipping Firebase open session ${s.id} — today already has a closed shift and no open shift locally`);
                                  continue;
                              }
                          }

                          await window.DBService.saveCashSession(s, { alreadySynced: true });
                      }
                  } catch (_) {}
              }, 5000);
          }

          return localSessions;
      } catch (err) {
          console.warn('[DataManager] getCashSessions → SQLite failed:', err.message);
          return [];
      }
  },

  saveCashSession: async (session) => {
      const localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      session._localId = localId;
      session._synced  = false;

      if (!session.openedBy && !session.opened_by) {
          session.openedBy = localStorage.getItem('username') || 'المستخدم';
      }

      try {
          session.id = await window.DBService.saveCashSession(session);
      } catch (err) {
          console.error('[DataManager] saveCashSession → SQLite FAILED:', err.message);
          if (!session.id) {
              session.id = `SESSION-${DataManager.getBusinessDate().replace(/-/g,'')}-${String(Date.now()).slice(-6)}`;
              session.createdAt = _egyptNow();
          }
      }

      if (DataManager.useFirebase() && window.SyncManager) {
          const shiftData = {
              id: session.id,
              cashier_name:    session.cashier_name || session.cashierName || session.openedBy || 'Admin',
              opening_balance: session.openingAmount || session.opening_balance || 0,
              ...session,
          };
          window.SyncManager.addToSyncQueue('shifts', 'add', shiftData, localId);
      }

      return true;
  },

  getTodayCashSession: async () => {
      try {
          return await window.DBService.getOpenSession();
      } catch (err) {
          console.warn('[DataManager] getTodayCashSession → SQLite failed:', err.message);
          return null;
      }
  },

  updateCashSession: async (sessionId, updates) => {
      const localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      if (updates.status === 'closed' && !updates.closed_at && !updates.closedAt) {
          updates.closed_at = _egyptNow();
          updates.closedAt  = updates.closed_at;
          updates.closedBy  = localStorage.getItem('username') || 'المستخدم';
      }

      try {
          await window.DBService.updateCashSession(sessionId, updates);
      } catch (err) {
          console.error('[DataManager] updateCashSession → SQLite FAILED:', err.message);
      }

      if (DataManager.useFirebase() && window.SyncManager) {
          window.SyncManager.addToSyncQueue('shifts', 'update', { id: sessionId, ...updates }, localId);
      }

      try { return await window.DBService.getOpenSession(); } catch { return null; }
  },

  // ======================
  // 💸 Expenses — SQLite Only
  // ======================
  getExpenses: async (filters = {}) => {
      try {
          const localExpenses = await window.DBService.getExpenses(filters);

          if (DataManager.useFirebase() && navigator.onLine && !filters.session_id) {
              setTimeout(async () => {
                  try {
                      const fb = await window.FirestoreService.getAllExpenses();
                      if (fb && fb.length > 0) {
                          for (const e of fb) {
                              await window.DBService.saveExpense(e, { alreadySynced: true });
                          }
                      }
                  } catch (_) {}
              }, 3000);
          }

          return localExpenses;
      } catch (err) {
          console.warn('[DataManager] getExpenses → SQLite failed:', err.message);
          return [];
      }
  },

  saveExpense: async (expense) => {
      try {
          const session = await DataManager.getTodayCashSession();
          if (session?.id) {
              expense.session_id = session.id;
              expense.shift_id   = session.id;
          }
      } catch (_) {}

      const localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      expense._localId = localId;
      expense._synced  = false;

      // حفظ في SQLite (يحفظ في expensesHistory تلقائياً عبر transaction في DBService)
      try {
          expense.id = await window.DBService.saveExpense(expense);
      } catch (err) {
          console.error('[DataManager] saveExpense → SQLite FAILED:', err.message);
          if (!expense.id) {
              expense.date      = expense.date || DataManager.getEgyptDate();
              expense.id        = 'EXP-' + expense.date.replace(/-/g, '') + '-' + String(Date.now()).slice(-6);
              expense.createdAt = _egyptNow();
          }
      }

      if (DataManager.useFirebase() && window.SyncManager) {
          window.SyncManager.addToSyncQueue('expenses', 'add', expense, localId);
      }

      return true;
  },

  updateExpense: async (expenseId, updates) => {
      const localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      try {
          await window.DBService.saveExpense({ id: expenseId, ...updates });
      } catch (err) {
          console.error('[DataManager] updateExpense → SQLite FAILED:', err.message);
      }
      if (DataManager.useFirebase() && window.SyncManager) {
          window.SyncManager.addToSyncQueue('expenses', 'update', { id: expenseId, ...updates }, localId);
      }
      return true;
  },

  removeExpense: async (expenseId) => {
      try {
          await window.DBService.removeExpense(expenseId);
      } catch (err) {
          console.warn('[DataManager] removeExpense → SQLite err:', err.message);
      }
      if (DataManager.useFirebase() && window.SyncManager) {
          window.SyncManager.addToSyncQueue('expenses', 'delete', { id: expenseId });
      }
      return true;
  },

  // ======================
  // 📊 Expenses History — SQLite Only
  // ======================
  getExpensesHistory: async () => {
    try {
        const sqlData = await window.DBService.getExpensesHistory();
        if (DataManager.useFirebase() && navigator.onLine) {
            setTimeout(async () => {
                try {
                    const remoteHistory = await window.FirestoreService.getAllExpensesHistory();
                    if (remoteHistory && remoteHistory.length > 0) {
                        // DBService.saveExpense already writes to expensesHistory via transaction
                        // so we only need to import remote-only records
                    }
                } catch(e) {}
            }, 3000);
        }
        return sqlData;
    } catch(e) {
        console.warn('[DataManager] getExpensesHistory SQLite err:', e.message);
        return [];
    }
  },

  saveExpenseToHistory: async (expense) => {
    // DBService.saveExpense already inserts into expensesHistory via transaction
    // This function is kept for backwards compatibility
    if (DataManager.useFirebase() && window.SyncManager) {
        const localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        window.SyncManager.addToSyncQueue('expensesHistory', 'add', expense, localId);
    }
    return true;
  },


  // ======================
  // General Utils
  // ======================

  /**
   * loadData — جلب بيانات من SQLite حسب اسم الجدول
   * يستبدل localStorage.getItem(key) القديم
   */
  loadData: async (key) => {
      // توجيه لـ DBService حسب المفتاح
      const dbMap = {
          orders:          () => window.DBService.getOrders(),
          menuItems:       () => window.DBService.getMenuItems(),
          categories:      () => window.DBService.getCategories(),
          ingredients:     () => window.DBService.getIngredients(),
          expenses:        () => window.DBService.getExpenses(),
          expensesHistory: () => window.DBService.getExpensesHistory(),
          employees:       () => window.DBService.getEmployees(),
          suppliers:       () => window.DBService.getSuppliers(),
          aggregators:     () => window.DBService.getAggregators(),
          customers:       () => window.DBService.getCustomers(),
          salesHistory:    () => window.DBService.getSalesHistory(),
          ordersOnHold:    () => window.DBService.getOrdersOnHold(),
          cashSessions:    () => window.DBService.getCashSessions(),
      };

      if (dbMap[key] && window.DBService) {
          try { return await dbMap[key](); }
          catch(e) { console.warn(`[DataManager] loadData(${key}) SQLite err:`, e.message); }
      }

      // للمفاتيح غير التشغيلية (settings, users, etc.)
      try { return JSON.parse(localStorage.getItem(key) || '[]'); }
      catch { return []; }
  },

  getEgyptDate: () => {
      const d = new Date(new Date().toLocaleString("en-US", {timeZone: "Africa/Cairo"}));
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${d.getFullYear()}-${mm}-${dd}`;
  },

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

  // ======================
  // Generic save — SQLite First
  // ======================
  save: async (collectionName, data) => {
    // 🔒 حقن restaurantId
    if (collectionName !== 'settings') {
        const _uid = localStorage.getItem('userId') || localStorage.getItem('_saasUid');
        if (_uid && !data.restaurantId) data.restaurantId = _uid;
    }

    // توجيه لـ DBService
    const dbServiceMap = {
        menuItems:    'saveMenuItem',
        categories:   'saveCategory',
        employees:    'saveEmployee',
        customers:    'saveCustomer',
        aggregators:  'saveAggregator',
        suppliers:    'saveSupplier',
        ingredients:  'saveIngredient',
        orders:       'saveOrder',
        expenses:     'saveExpense',
    };

    if (dbServiceMap[collectionName] && window.DBService) {
        try {
            const method = dbServiceMap[collectionName];
            if (typeof window.DBService[method] === 'function') {
                const savedId = await window.DBService[method](data);
                if (savedId && !data.id) data.id = savedId;
            }
        } catch(e) { console.warn(`[DataManager] save(${collectionName}) SQLite err:`, e.message); }
    }

    if (!data.id) data.id = DataManager.generateIdFor(collectionName);

    // للمفاتيح غير التشغيلية فقط → localStorage
    const nonOperational = ['settings', 'users', 'notifications', 'performance', 'daily_log', 'performance_snapshots'];
    if (nonOperational.includes(collectionName)) {
        try {
            let collection = JSON.parse(localStorage.getItem(collectionName) || '[]');
            if (data.id) {
                const index = collection.findIndex(item => item.id === data.id);
                if (index !== -1) collection[index] = { ...collection[index], ...data };
                else collection.push(data);
            } else {
                collection.push(data);
            }
            localStorage.setItem(collectionName, JSON.stringify(collection));
        } catch(e) {}
    }

    if (DataManager.useFirebase() && window.SyncManager) {
        const localId = `local_${Date.now()}`;
        data._localId = localId;
        data._synced = false;
        window.SyncManager.addToSyncQueue(collectionName, data.id ? 'update' : 'add', data, localId);
    }
    return data;
  },

  // ======================
  // Generic remove — SQLite First
  // ======================
  remove: async (collectionName, itemId) => {
    const dbServiceRemoveMap = {
        menuItems:    'removeMenuItem',
        employees:    'removeEmployee',
        categories:   'removeCategory',
        aggregators:  'removeAggregator',
        suppliers:    'removeSupplier',
        ingredients:  'removeIngredient',
        customers:    'removeCustomer',
        orders:       'updateOrder',  // soft delete via status
    };
    if (dbServiceRemoveMap[collectionName] && window.DBService) {
        try {
            const method = dbServiceRemoveMap[collectionName];
            if (typeof window.DBService[method] === 'function')
                await window.DBService[method](itemId);
        } catch(e) { console.warn(`[DataManager] remove(${collectionName}) SQLite err:`, e.message); }
    }

    // تنظيف طابور المزامنة
    if (window.SyncManager) {
        try {
            window.SyncManager.syncQueue = window.SyncManager.syncQueue.filter(
                job => !(job.data && String(job.data.id) === String(itemId))
            );
            window.SyncManager.saveSyncQueue();
        } catch(e) {}
    }

    // مسح من Firebase
    if (DataManager.useFirebase() && window.SyncManager) {
        window.SyncManager.addToSyncQueue(collectionName, 'delete', { id: itemId });
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
