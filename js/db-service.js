/**
 * db-service.js — Solo POS SaaS
 * ==============================
 * طبقة الوصول إلى SQLite من الـ Renderer Process عبر IPC.
 * يعمل كوسيط نظيف بين DataManager وقاعدة البيانات.
 *
 * الاستخدام:
 *   await window.DBService.saveOrder(order)
 *   await window.DBService.getOrders({ date: '2026-04-09' })
 */

'use strict';

(function () {

  const { ipcRenderer } = require('electron');

  // ══════════════════════════════════════════════════════════════════════════
  // 🔌 IPC Helpers — التواصل الآمن مع الـ Main Process
  // ══════════════════════════════════════════════════════════════════════════
  async function _all(sql, params = []) {
    const res = await ipcRenderer.invoke('db:all', sql, params);
    if (!res.ok) throw new Error('[DB:all] ' + res.error);
    return res.data || [];
  }

  async function _get(sql, params = []) {
    const res = await ipcRenderer.invoke('db:get', sql, params);
    if (!res.ok) throw new Error('[DB:get] ' + res.error);
    return res.data || null;
  }

  async function _run(sql, params = []) {
    const res = await ipcRenderer.invoke('db:run', sql, params);
    if (!res.ok) throw new Error('[DB:run] ' + res.error);
    return res;
  }

  async function _tx(ops) {
    const res = await ipcRenderer.invoke('db:transaction', ops);
    if (!res.ok) throw new Error('[DB:transaction] ' + res.error);
    return res.results;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 🔐 Tenant Helper — عزل بيانات الأكونت الحالي
  // ══════════════════════════════════════════════════════════════════════════
  function _getUid() {
    try { return firebase?.auth?.()?.currentUser?.uid || null; } catch (_) { return null; }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 🔧 Helpers — تحويل البيانات
  // ══════════════════════════════════════════════════════════════════════════

  /** تحويل الأعمدة JSON إلى كائنات عند القراءة */
  function _parseJson(row, cols) {
    if (!row) return null;
    const out = { ...row };
    for (const col of cols) {
      if (typeof out[col] === 'string') {
        try { out[col] = JSON.parse(out[col]); }
        catch { out[col] = Array.isArray(out[col]) ? [] : {}; }
      }
    }
    return out;
  }

  /**
   * _normMenuItem — تحويل أسماء الأعمدة من snake_case (SQLite) إلى camelCase (UI)
   * يحافظ على الأسماء الأصلية + يضيف الأسماء البديلة
   */
  function _normMenuItem(row) {
    if (!row) return null;
    const out = { ...row };
    // category_id → categoryId
    if (out.category_id !== undefined && out.categoryId === undefined) out.categoryId = out.category_id;
    // stock_quantity → stock
    if (out.stock_quantity !== undefined && out.stock === undefined) out.stock = Number(out.stock_quantity) || 0;
    // min_stock → minStockLimit
    if (out.min_stock !== undefined && out.minStockLimit === undefined) out.minStockLimit = Number(out.min_stock) || 0;
    // critical_stock → criticalStockLimit
    if (out.critical_stock !== undefined && out.criticalStockLimit === undefined) out.criticalStockLimit = Number(out.critical_stock) || 0;
    // cost → costPrice
    if (out.cost !== undefined && out.costPrice === undefined) out.costPrice = Number(out.cost) || 0;
    // track_stock → trackStock
    if (out.track_stock !== undefined && out.trackStock === undefined) out.trackStock = !!out.track_stock;
    // sort_order → sortOrder
    if (out.sort_order !== undefined && out.sortOrder === undefined) out.sortOrder = out.sort_order;
    // aggregator_prices → aggregatorPrices
    if (out.aggregator_prices !== undefined && out.aggregatorPrices === undefined) out.aggregatorPrices = out.aggregator_prices;
    // is_active → isActive
    if (out.is_active !== undefined && out.isActive === undefined) out.isActive = !!out.is_active;
    // created_at → createdAt
    if (out.created_at !== undefined && out.createdAt === undefined) out.createdAt = out.created_at;
    // updated_at → updatedAt
    if (out.updated_at !== undefined && out.updatedAt === undefined) out.updatedAt = out.updated_at;
    // type default
    if (!out.type) out.type = 'physical';
    return out;
  }

  /**
   * _normCategory — تحويل أسماء الأعمدة للفئات
   */
  function _normCategory(row) {
    if (!row) return null;
    const out = { ...row };
    if (out.sort_order !== undefined && out.sortOrder === undefined) out.sortOrder = out.sort_order;
    if (out.sort_order !== undefined && out.order === undefined) out.order = out.sort_order;
    if (out.is_active !== undefined && out.isActive === undefined) out.isActive = !!out.is_active;
    if (out.created_at !== undefined && out.createdAt === undefined) out.createdAt = out.created_at;
    if (out.updated_at !== undefined && out.updatedAt === undefined) out.updatedAt = out.updated_at;
    return out;
  }

  /** توليد ID فريد */
  function _id(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  }

  /** الوقت الآن بتوقيت مصر — "YYYY-MM-DDTHH:MM:SS" */
  const _now = () => {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  /** تاريخ اليوم بتوقيت مصر */
  function _egyptDate() {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 🔄 Initialization — تهيئة عند فتح السيستم
  // ══════════════════════════════════════════════════════════════════════════
  const DBService = {

    /**
     * loadBootstrapData — سحب الداتا الأساسية دفعة واحدة عند فتح السيستم.
     * استدعِ هذه الدالة في app_logic.js عند DOMContentLoaded.
     * @returns {{ categories, menuItems, employees, aggregators, openSession }}
     */
    async loadBootstrapData() {
      try {
        const [categories, menuItems, employees, aggregators, openSession] = await Promise.all([
          this.getCategories(),
          this.getMenuItems(),
          this.getEmployees(),
          this.getAggregators(),
          this.getOpenSession(),
        ]);
        console.log(`[DBService] Bootstrap: ${menuItems.length} صنف | ${employees.length} موظف | ${categories.length} فئة`);
        return { categories, menuItems, employees, aggregators, openSession };
      } catch (err) {
        console.error('[DBService] loadBootstrapData خطأ:', err.message);
        return { categories: [], menuItems: [], employees: [], aggregators: [], openSession: null };
      }
    },

    // ════════════════════════════════════════════════════════════════════════
    // 📦 ORDERS — الطلبات
    // ════════════════════════════════════════════════════════════════════════

    /**
     * saveOrder — حفظ أو تحديث طلب
     * @param {Object} order - كائن الطلب
     * @param {Object} [opts] - { alreadySynced: bool } للطلبات القادمة من Firebase
     * @returns {string} id الطلب
     */
    async saveOrder(order, { alreadySynced = false } = {}) {
      const now = _now();
      const id = order.id || _id('ORD');

      // 🛠️ السحر هنا: التحديث التلقائي لجدول الطلبات (عشان لو الأعمدة مش موجودة تتضاف لوحدها)
      try { await _run(`ALTER TABLE orders ADD COLUMN order_source TEXT DEFAULT 'direct'`); } catch(e) {}
      try { await _run(`ALTER TABLE orders ADD COLUMN aggregator_markup REAL DEFAULT 0`); } catch(e) {}
      try { await _run(`ALTER TABLE orders ADD COLUMN total_cost REAL DEFAULT 0`); } catch(e) {}

      await _run(`
        INSERT OR REPLACE INTO orders
          (id, session_id, type, table_number, customer_id, aggregator_id,
           items, subtotal, discount, surcharge, delivery_fee, total,
           payment_method, status, notes, sync_status, created_at, updated_at,
           order_source, aggregator_markup, total_cost, tax, service_charge)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `, [
        id,
        order.session_id   || order.shift_id    || '',
        order.type         || order.orderType   || 'takeaway',
        order.table_number || order.tableNumber  || null,
        order.customer_id  || order.customerId   || null,
        order.aggregator_id|| order.aggregatorId || null,
        JSON.stringify(order.items || order.cartItems || []),
        order.subtotal     || 0,
        order.discount     || 0,
        order.surcharge    || 0,
        order.delivery_fee || order.deliveryFee  || 0,
        order.total        || 0,
        order.payment_method || order.paymentMethod || 'cash',
        order.status       || 'paid',
        order.notes        || null,
        alreadySynced ? 1 : 0,
        order.created_at   || order.createdAt    || order.isoDate || now,
        now,
        order.orderSource      || 'direct',
        order.aggregatorMarkup || 0,
        order.totalCost        || order.total_cost || 0,
        order.tax              || 0,
        order.serviceCharge    || order.service_charge || 0,
      ]);

      return id;
    },

    /**
     * getOrders — جلب الطلبات مع فلاتر اختيارية
     * @param {Object} filters - { date, session_id, status, limit, fromDate, toDate }
     */
    async getOrders(filters = {}) {
      let sql = 'SELECT * FROM orders WHERE 1=1';
      const p  = [];

      if (filters.date) {
        sql += ' AND DATE(created_at) = ?'; p.push(filters.date);
      } else if (filters.fromDate && filters.toDate) {
        sql += ' AND DATE(created_at) BETWEEN ? AND ?'; p.push(filters.fromDate, filters.toDate);
      }
      if (filters.session_id) { sql += ' AND session_id = ?'; p.push(filters.session_id); }
      if (filters.status)     { sql += ' AND status = ?';     p.push(filters.status); }
      if (filters.customer_id){ sql += ' AND customer_id = ?';p.push(filters.customer_id); }

      sql += ' ORDER BY created_at DESC';
      if (filters.limit) { sql += ' LIMIT ?'; p.push(filters.limit); }

      const rows = await _all(sql, p);
      return rows.map(r => { 
        const o = _parseJson(r, ['items']); 
        o.shiftId        = o.shiftId        || o.session_id; 
        o.paymentMethod  = o.paymentMethod  || o.payment_method; 
        o.createdAt      = o.createdAt      || o.created_at; 
        
        // 👈 إرجاع البيانات للداشبورد والتقارير 
        o.orderSource    = r.order_source   || 'direct';      
        o.aggregatorMarkup = r.aggregator_markup || 0;        
        o.totalCost      = r.total_cost     || 0;             
        
        o.tableNumber    = o.tableNumber    || o.table_number; 
        o.customerId     = o.customerId     || o.customer_id; 
        o.aggregatorId   = o.aggregatorId   || o.aggregator_id; 
        o.deliveryFee    = o.deliveryFee    || o.delivery_fee;
        o.tax            = r.tax           || 0;
        o.serviceCharge  = r.service_charge || 0;

        // 🚀 الحل الجذري لمشكلة أنواع الطلبات اللي بتظهر كلها تيك أواي 
        o.orderType      = o.orderType      || o.type || 'takeaway'; 
        o.type           = o.orderType; 

        // ✅ date aliases 
        const dateOnly   = o.created_at ? String(o.created_at).slice(0, 10) : null; 
        o.date           = o.date           || dateOnly; 
        o.businessDate   = o.businessDate   || o.date; 
        o.isoDate        = o.isoDate        || o.date; 
        return o; 
      });
    },

    async getOrderById(id) {
      const row = await _get('SELECT * FROM orders WHERE id = ?', [id]);
      if (!row) return null;
      const o = _parseJson(row, ['items']);
      o.shiftId       = o.shiftId       || o.session_id;
      o.paymentMethod = o.paymentMethod || o.payment_method;
      o.createdAt     = o.createdAt     || o.created_at;
      return o;
    },

    async updateOrder(id, updates) {
      const sets = ['sync_status = 0', 'updated_at = ?'];
      const vals = [_now()];
      const allowed = { status: 1, notes: 1, discount: 1, surcharge: 1, total: 1 };

      for (const [k, v] of Object.entries(updates)) {
        if (allowed[k]) { sets.unshift(`${k} = ?`); vals.unshift(v); }
      }
      if (updates.items) {
        sets.unshift('items = ?');
        vals.unshift(JSON.stringify(updates.items));
      }
      vals.push(id);
      await _run(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`, vals);
    },

    // ════════════════════════════════════════════════════════════════════════
    // 💰 CASH SESSIONS — الشيفتات النقدية
    // ════════════════════════════════════════════════════════════════════════

    async saveCashSession(session, { alreadySynced = false } = {}) {
      const now = _now();
      const id  = session.id || `SESSION-${_egyptDate().replace(/-/g, '')}-${Date.now().toString().slice(-6)}`;

      // 🛡️ حماية من الشيفتات المكررة (جذرية):
      // 1. لو الـ ID موجود بالفعل → UPDATE مش INSERT جديد
      // 2. لو جاي من Firebase → نتشيك بالتاريخ + الوقت (±5 دقائق) عشان نمنع التكرار بـ IDs مختلفة
      if (alreadySynced) {
          const existing = await _get('SELECT id FROM cashSessions WHERE id = ?', [id]);
          if (existing) {
              // نفس الـ ID — هيتحدث بالـ INSERT OR REPLACE
          } else {
              // ID مختلف — نشيك لو فيه شيفت بنفس الوقت تقريباً (±5 دقائق)
              const openedAt = session.opened_at || session.createdAt || '';
              if (openedAt) {
                  const ts = new Date(openedAt).getTime();
                  if (!isNaN(ts)) {
                      const fiveMin = 5 * 60 * 1000;
                      const lo = new Date(ts - fiveMin).toISOString();
                      const hi = new Date(ts + fiveMin).toISOString();
                      const dup = await _get(
                          'SELECT id FROM cashSessions WHERE opened_at BETWEEN ? AND ? AND id != ?',
                          [lo, hi, id]
                      );
                      if (dup) {
                          console.log(`[DB] ⛔ Blocked duplicate shift ${id} — already have shift ${dup.id} at same time`);
                          return dup.id;
                      }
                  }
              }
              // fallback: لو فيه شيفت مفتوح محلي بالفعل والجاي مفتوح كمان
              if ((session.status || 'open') === 'open') {
                  const openLocal = await _get('SELECT id FROM cashSessions WHERE status = ? LIMIT 1', ['open']);
                  if (openLocal) {
                      console.log(`[DB] ⛔ Blocked duplicate open shift ${id} — already have open shift ${openLocal.id}`);
                      return openLocal.id;
                  }
              }
          }
      }

      await _run(`
        INSERT OR REPLACE INTO cashSessions
          (id, opened_by, opening_balance, cash_sales, visa_sales,
           aggregator_sales, total_expenses, closing_balance, status,
           notes, sync_status, opened_at, closed_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      `, [
        id,
        session.opened_by      || session.cashier_name || session.openedBy || session.cashierName || 'Admin',
        session.opening_balance|| session.openingAmount || 0,
        session.cash_sales     || 0,
        session.visa_sales     || 0,
        session.aggregator_sales || 0,
        session.total_expenses || 0,
        session.closing_balance|| session.closingBalance || null,
        session.status         || 'open',
        session.notes          || null,
        alreadySynced ? 1 : 0,
        session.opened_at      || session.createdAt    || now,
        session.closed_at      || session.closedAt     || null,
      ]);

      return id;
    },

    async updateCashSession(id, updates) {
      const colMap = {
        cash_sales:       'cash_sales',
        visa_sales:       'visa_sales',
        aggregator_sales: 'aggregator_sales',
        total_expenses:   'total_expenses',
        closing_balance:  'closing_balance',
        closingBalance:   'closing_balance',
        closingAmount:    'closing_balance',
        status:           'status',
        notes:            'notes',
        closed_at:        'closed_at',
        closedAt:         'closed_at',
        openingAmount:    'opening_balance',
        opened_by:        'opened_by',
      };

      const sets = ['sync_status = 0'];
      const vals = [];
      for (const [k, col] of Object.entries(colMap)) {
        if (k in updates) { sets.push(`${col} = ?`); vals.push(updates[k]); }
      }
      vals.push(id);
      await _run(`UPDATE cashSessions SET ${sets.join(', ')} WHERE id = ?`, vals);
    },

    async getCashSessions() {
      const rows = await _all('SELECT * FROM cashSessions ORDER BY opened_at DESC');
      return rows.map(_normSession);
    },

    /** الشيفت المفتوح حالياً (أو null) */
    async getOpenSession() {
      const row = await _get(`
        SELECT * FROM cashSessions WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1
      `);
      return row ? _normSession(row) : null;
    },

    // ════════════════════════════════════════════════════════════════════════
    // 💸 EXPENSES — المصروفات
    // ════════════════════════════════════════════════════════════════════════

    async saveExpense(expense, { alreadySynced = false } = {}) {
      const now = _now();
      const id  = expense.id || ('EXP-' + _egyptDate().replace(/-/g, '') + '-' + Date.now().toString().slice(-6));
      // حفظ النوع بالإنجليزي والعربي عشان التقارير تشتغل صح
      const category = expense.category || 'أخرى';

      await _tx([
        // حفظ في expenses
        {
          sql: `INSERT OR REPLACE INTO expenses
                  (id, session_id, category, description, amount, payment_method,
                   employee_id, sync_status, created_at)
                VALUES (?,?,?,?,?,?,?,?,?)`,
          params: [
            id,
            expense.session_id || expense.shift_id || null,
            category,
            expense.description|| '',
            expense.amount     || 0,
            expense.payment_method || expense.paymentMethod || 'cash',
            expense.employee_id|| null,
            alreadySynced ? 1 : 0,
            expense.created_at || expense.createdAt || now,
          ],
        },
        // تسجيل نسخة في expensesHistory تلقائياً
        {
          sql: `INSERT OR IGNORE INTO expensesHistory
                  (id, expense_id, session_id, category, description, amount, date, created_at)
                VALUES (?,?,?,?,?,?,?,?)`,
          params: [
            'HIST-' + id,
            id,
            expense.session_id || expense.shift_id || null,
            category,
            expense.description|| '',
            expense.amount     || 0,
            expense.created_at || expense.createdAt || now, // التاريخ الكامل مع الوقت
            now,
          ],
        },
      ]);

      return id;
    },

    async getExpenses(filters = {}) {
      let sql = 'SELECT * FROM expenses WHERE 1=1';
      const p = [];
      if (filters.session_id) { sql += ' AND session_id = ?'; p.push(filters.session_id); }
      if (filters.date)       { sql += ' AND DATE(created_at) = ?'; p.push(filters.date); }
      else if (filters.fromDate && filters.toDate) {
        sql += ' AND DATE(created_at) BETWEEN ? AND ?'; p.push(filters.fromDate, filters.toDate);
      }
      sql += ' ORDER BY created_at DESC';
      const rows = await _all(sql, p);
      return rows.map(r => ({
        ...r,
        shiftId  : r.shiftId   || r.session_id,
        createdAt: r.createdAt || r.created_at,
      }));
    },

    async removeExpense(id) {
      await _run('DELETE FROM expenses WHERE id = ?', [id]);
    },

    async getExpensesHistory(filters = {}) {
      let sql = 'SELECT * FROM expensesHistory WHERE 1=1';
      const p = [];
      if (filters.date)       { sql += ' AND date = ?';       p.push(filters.date); }
      if (filters.session_id) { sql += ' AND session_id = ?'; p.push(filters.session_id); }
      sql += ' ORDER BY created_at DESC';
      return await _all(sql, p);
    },

    // ════════════════════════════════════════════════════════════════════════
    // 👥 CUSTOMERS — العملاء
    // ════════════════════════════════════════════════════════════════════════

    async saveCustomer(customer, { alreadySynced = false } = {}) {
      const now = _now();
      const uid = _getUid();
      const restaurantId = customer.restaurantId || customer.restaurant_id || uid;

      // 🔧 منع التكرار: لو في عميل بنفس الرقم وـ restaurant_id = NULL (قبل المايجريشن)
      // نمسحه عشان INSERT OR REPLACE يحل محله بالـ restaurant_id الصح
      if (customer.phone && restaurantId) {
        await _run(
          `DELETE FROM customers WHERE phone = ? AND restaurant_id IS NULL`,
          [customer.phone]
        ).catch(() => {});
        // كمان لو في نسخة قديمة بـ restaurant_id تاني (مختلف الـ id بس نفس الرقم)
        const existingId = customer.id || '';
        if (existingId) {
          await _run(
            `DELETE FROM customers WHERE phone = ? AND restaurant_id = ? AND id != ?`,
            [customer.phone, restaurantId, existingId]
          ).catch(() => {});
        }
      }

      const id = customer.id || _id('CUS');
      await _run(`
        INSERT OR REPLACE INTO customers
          (id, name, phone, restaurant_id, address, level, points, total_orders, total_spent,
           notes, sync_status, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      `, [
        id,
        customer.name        || '',
        customer.phone       || null,
        restaurantId,
        customer.address     || null,
        customer.level       || customer.tier || 'عادي',
        customer.points      || 0,
        customer.ordersCount ?? customer.total_orders ?? customer.totalOrders ?? 0,
        customer.total_spent || customer.totalSpent  || 0,
        customer.notes       || null,
        alreadySynced ? 1 : 0,
        customer.created_at  || customer.createdAt   || now,
        now,
      ]);

      return id;
    },

    async getCustomers() {
      const uid = _getUid();
      let sql = 'SELECT * FROM customers';
      const p = [];
      if (uid) { sql += ' WHERE restaurant_id = ?'; p.push(uid); }
      sql += ' ORDER BY name';
      const rows = await _all(sql, p);
      return rows.map(r => ({
        ...r,
        totalOrders: r.total_orders || 0,
        ordersCount: r.total_orders || 0,
        totalSpent: r.total_spent || 0,
        tier: r.level || 'regular',
        createdAt: r.created_at,
      }));
    },

    async getCustomerByPhone(phone) {
      const uid = _getUid();
      let sql = 'SELECT * FROM customers WHERE phone = ?';
      const p = [phone];
      if (uid) { sql += ' AND restaurant_id = ?'; p.push(uid); }
      const row = await _get(sql, p);
      if (!row) return null;
      return { ...row, totalOrders: row.total_orders, totalSpent: row.total_spent };
    },

    /** تحديث إحصائيات العميل عند تسجيل طلب جديد */
    async updateCustomerStats(customerId, orderTotal, pointsToAdd = 0) {
      await _run(`
        UPDATE customers SET
          total_orders = total_orders + 1,
          total_spent  = total_spent  + ?,
          points       = points       + ?,
          sync_status  = 0,
          updated_at   = ?
        WHERE id = ?
      `, [orderTotal, pointsToAdd, _now(), customerId]);
    },

    /** حذف عميل بالـ id أو الـ phone */
    async removeCustomer(idOrPhone) {
      const uid = _getUid();
      // نحاول بالـ id أولاً ثم بالـ phone
      if (uid) {
        await _run('DELETE FROM customers WHERE (id = ? OR phone = ?) AND restaurant_id = ?', [idOrPhone, idOrPhone, uid]);
      } else {
        await _run('DELETE FROM customers WHERE id = ? OR phone = ?', [idOrPhone, idOrPhone]);
      }
    },

    // ════════════════════════════════════════════════════════════════════════
    // 🍔 MENU — الفئات والأصناف
    // ════════════════════════════════════════════════════════════════════════

    async saveCategory(cat, { alreadySynced = false } = {}) {
      const id = cat.id || _id('CAT');
      await _run(`
        INSERT OR REPLACE INTO categories (id, name, icon, color, sort_order, is_active)
        VALUES (?,?,?,?,?,?)
      `, [
        id,
        cat.name       || '',
        cat.icon       || null,
        cat.color      || null,
        cat.sort_order || cat.sortOrder || 0,
        cat.is_active  !== undefined ? cat.is_active  :
        (cat.isActive  !== undefined ? (cat.isActive ? 1 : 0) : 1),
      ]);
      return id;
    },

    async getCategories() {
      const rows = await _all('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order, name');
      return rows.map(_normCategory);
    },

    async reorderCategories(orderedIds) {
      const ops = orderedIds.map((id, index) => ({
        sql: `UPDATE categories SET sort_order = ? WHERE id = ?`,
        params: [index, String(id)]
      }));
      await _tx(ops);
    },

    async removeCategory(id) {
      await _run('UPDATE categories SET is_active = 0 WHERE id = ?', [id]);
    },

    async saveMenuItem(item, { alreadySynced = false } = {}) {
      const now = _now();
      const id  = item.id || _id('ITEM');

      // تجهيز البيانات
      const aggPrices = item.aggregator_prices || item.aggregatorPrices || {};
      const aggJson = JSON.stringify(aggPrices);
      const hasAggPrices = Object.keys(aggPrices).length > 0;

      await _run(`
        INSERT INTO menuItems
          (id, category_id, name, description, price, cost, image,
           variants, addons, stock_quantity, min_stock, critical_stock,
           track_stock, recipe, aggregator_prices, is_active, sort_order,
           sync_status, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          category_id = excluded.category_id,
          name = excluded.name,
          description = excluded.description,
          price = excluded.price,
          cost = excluded.cost,
          image = excluded.image,
          variants = excluded.variants,
          addons = excluded.addons,
          stock_quantity = excluded.stock_quantity,
          min_stock = excluded.min_stock,
          critical_stock = excluded.critical_stock,
          track_stock = excluded.track_stock,
          recipe = excluded.recipe,
          aggregator_prices = CASE
            WHEN excluded.aggregator_prices != '{}' THEN excluded.aggregator_prices
            ELSE menuItems.aggregator_prices
          END,
          is_active = excluded.is_active,
          sort_order = excluded.sort_order,
          sync_status = excluded.sync_status,
          updated_at = excluded.updated_at
      `, [
        id,
        item.category_id    || item.categoryId    || null,
        item.name           || '',
        item.description    || null,
        item.price          || 0,
        item.cost || item.costPrice || item.buyingPrice || 0,
        item.image          || null,
        JSON.stringify(item.variants         || []),
        JSON.stringify(item.addons           || []),
        item.stock_quantity || item.stockQuantity || item.stock || 0,
        item.min_stock      || item.minStock      || item.alertStock || 0,
        item.critical_stock || item.criticalStock || 0,
        item.track_stock    !== undefined ? item.track_stock : (item.trackStock ? 1 : 0),
        JSON.stringify(item.recipe           || item.ingredients || []),
        aggJson,
        item.is_active      !== undefined ? item.is_active  :
        (item.isActive      !== undefined ? (item.isActive ? 1 : 0) : 1),
        item.sort_order     || item.sortOrder || 0,
        alreadySynced ? 1 : 0,
        item.created_at     || item.createdAt || now,
        now,
      ]);

      return id;
    },

    async getMenuItems() {
      const rows = await _all(`
        SELECT m.*, c.name AS category_name, c.icon AS category_icon
        FROM menuItems m
        LEFT JOIN categories c ON m.category_id = c.id
        WHERE m.is_active = 1
        ORDER BY m.sort_order, m.name
      `);
      return rows.map(r => _normMenuItem(_parseJson(r, ['variants', 'addons', 'recipe', 'aggregator_prices'])));
    },

    async removeMenuItem(id) {
      await _run('UPDATE menuItems SET is_active = 0, sync_status = 0 WHERE id = ?', [id]);
    },

    /** تحديث المخزون مباشرة بعد كل طلب */
    async deductStock(itemId, qty) {
      await _run(`
        UPDATE menuItems SET
          stock_quantity = MAX(0, stock_quantity - ?),
          updated_at     = ?
        WHERE id = ? AND track_stock = 1
      `, [qty, _now(), itemId]);
    },

    // ════════════════════════════════════════════════════════════════════════
    // 👨‍💼 EMPLOYEES — الموظفون
    // ════════════════════════════════════════════════════════════════════════

    async saveEmployee(emp, { alreadySynced = false } = {}) {
      const now = _now();
      const id  = emp.id || _id('EMP');

      await _run(`
        INSERT OR REPLACE INTO employees
          (id, name, phone, role, salary_type, salary_amount,
           start_date, is_active, notes, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `, [
        id,
        emp.name          || '',
        emp.phone         || null,
        emp.role          || 'كاشير',
        emp.salary_type   || emp.salaryType   || 'daily',
        emp.salary_amount || emp.salaryAmount || emp.dailyRate || emp.monthlySalary || emp.salary || 0,
        emp.start_date    || emp.startDate    || null,
        emp.is_active     !== undefined ? emp.is_active  :
        (emp.isActive     !== undefined ? (emp.isActive ? 1 : 0) : 1),
        emp.notes         || null,
        emp.created_at    || emp.createdAt    || now,
      ]);

      return id;
    },

    async getEmployees({ includeInactive = false } = {}) {
      const sql = includeInactive
        ? 'SELECT * FROM employees ORDER BY name'
        : 'SELECT * FROM employees WHERE is_active = 1 ORDER BY name';
      const rows = await _all(sql);
      return rows.map(r => ({
        ...r,
        salaryType:   r.salary_type,
        salaryAmount: r.salary_amount,
        salary:       r.salary_amount,          // ← alias موحّد للكود القديم
        startDate:    r.start_date,
        isActive:     !!r.is_active,
        createdAt:    r.created_at,
        // Aliases للتوافق مع الكود القديم
        dailyRate:    r.salary_type === 'daily' ? r.salary_amount : 0,
        monthlySalary:r.salary_type === 'monthly' ? r.salary_amount : 0,
      }));
    },

    async removeEmployee(id) {
      await _run('UPDATE employees SET is_active = 0 WHERE id = ?', [id]);
    },

    // ════════════════════════════════════════════════════════════════════════
    // 📅 ATTENDANCE — الحضور والانصراف
    // ════════════════════════════════════════════════════════════════════════

    async saveAttendance(record) {
      const now  = _now();
      const date = record.date || record.checkIn?.slice(0, 10) || _egyptDate();
      const id   = record.id  || _id('ATT');

      await _run(`
        INSERT OR REPLACE INTO attendance
          (id, employee_id, session_id, check_in, check_out, hours_worked,
           daily_wage, status, notes, date, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `, [
        id,
        record.employee_id || record.employeeId || '',
        record.session_id  || record.shift_id   || null,
        record.check_in    || record.checkIn    || now,
        record.check_out   || record.checkOut   || null,
        record.hours_worked|| record.hoursWorked|| null,
        record.daily_wage  || record.dailyWage  || record.dailyRate || 0,
        record.status      || 'present',
        record.notes       || null,
        date,
        now,
      ]);

      return id;
    },

    async getAttendance(filters = {}) {
      let sql = `
        SELECT a.*, e.name AS employee_name, e.salary_type, e.salary_amount
        FROM attendance a
        LEFT JOIN employees e ON a.employee_id = e.id
        WHERE 1=1
      `;
      const p = [];
      if (filters.date || filters.businessDate) { sql += ' AND a.date = ?'; p.push(filters.date || filters.businessDate); }
      if (filters.employee_id) { sql += ' AND a.employee_id = ?';  p.push(filters.employee_id); }
      if (filters.session_id)  { sql += ' AND a.session_id = ?';   p.push(filters.session_id); }
      sql += ' ORDER BY a.created_at DESC';
      return await _all(sql, p);
    },

    async checkoutAttendance(id, checkOutTime, hoursWorked) {
      await _run(`
        UPDATE attendance SET check_out = ?, hours_worked = ? WHERE id = ?
      `, [checkOutTime || _now(), hoursWorked || null, id]);
    },

    // ════════════════════════════════════════════════════════════════════════
    // 🛵 AGGREGATORS — شركات التوصيل
    // ════════════════════════════════════════════════════════════════════════

    async saveAggregator(agg, { alreadySynced = false } = {}) {
      const now = _now();
      const id  = agg.id || _id('AGG');

      await _run(`
        INSERT OR REPLACE INTO aggregators
          (id, name, commission_rate, markup_rate, is_active, color, logo, created_at)
        VALUES (?,?,?,?,?,?,?,?)
      `, [
        id,
        agg.name            || agg.companyName    || '',
        agg.commission_rate || agg.commissionRate || agg.commissionPercentage || 0,
        agg.markup_rate     || agg.markupRate     || 0,
        agg.is_active       !== undefined ? agg.is_active : 1,
        agg.color           || null,
        agg.logo            || null,
        agg.created_at      || agg.createdAt      || now,
      ]);

      return id;
    },

    async getAggregators({ includeInactive = false } = {}) {
      const sql = includeInactive
        ? 'SELECT * FROM aggregators ORDER BY name'
        : 'SELECT * FROM aggregators WHERE is_active = 1 ORDER BY name';
      const rows = await _all(sql);
      // alias: companyName + commissionPercentage للتوافق مع الكود القديم
      return rows.map(r => ({
        ...r,
        companyName: r.name,
        commissionPercentage: r.commission_rate || 0,
        commissionRate: r.commission_rate || 0,
        menuMarkupPercentage: r.markup_rate || 0,
        markupRate: r.markup_rate || 0,
      }));
    },

    async removeAggregator(id) {
      await _run('UPDATE aggregators SET is_active = 0 WHERE id = ?', [id]);
    },

    // ════════════════════════════════════════════════════════════════════════
    // 🧪 INGREDIENTS — المواد الخام
    // ════════════════════════════════════════════════════════════════════════

    async saveIngredient(ing, { alreadySynced = false } = {}) {
      const now = _now();
      const id  = ing.id || _id('ING');

      await _run(`
        INSERT OR REPLACE INTO ingredients
          (id, name, unit, quantity, min_quantity, warning_threshold, cost, supplier_id, category,
           notes, is_active, sync_status, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `, [
        id,
        ing.name          || '',
        ing.unit          || ing.الوحدة || 'كجم',
        ing.quantity      || ing.الكمية || 0,
        ing.min_quantity  || ing.minQuantity || ing.criticalStockLimit || ing.alertQuantity || 0,
        ing.warning_threshold || ing.warningThreshold || 0,
        ing.cost          || ing.costPrice || ing.price || ing.السعر || 0,
        ing.supplier_id   || ing.supplierId || null,
        ing.category      || null,
        ing.notes         || null,
        ing.is_active     !== undefined ? ing.is_active : 1,
        alreadySynced ? 1 : 0,
        ing.created_at    || ing.createdAt || now,
        now,
      ]);

      return id;
    },

    async getIngredients() {
      const rows = await _all('SELECT * FROM ingredients WHERE is_active = 1 ORDER BY name');
      return rows.map(r => ({
        ...r,
        minQuantity:       r.min_quantity,
        criticalStockLimit: r.min_quantity,
        warningThreshold:  r.warning_threshold || 0,
        costPrice:         Number(r.cost) || 0,
        createdAt:         r.created_at,
      }));
    },

    async removeIngredient(id) {
      await _run('UPDATE ingredients SET is_active = 0 WHERE id = ?', [id]);
    },

    // ════════════════════════════════════════════════════════════════════════
    // 📦 SUPPLIERS — الموردين
    // ════════════════════════════════════════════════════════════════════════

    async saveSupplier(sup, { alreadySynced = false } = {}) {
      const now = _now();
      const id  = sup.id || _id('SUP');

      await _run(`
        INSERT OR REPLACE INTO suppliers
          (id, name, phone, address, notes, is_active, sync_status, created_at)
        VALUES (?,?,?,?,?,?,?,?)
      `, [
        id,
        sup.name     || sup.companyName || '',
        sup.phone    || null,
        sup.address  || null,
        sup.notes    || null,
        sup.is_active !== undefined ? sup.is_active : 1,
        alreadySynced ? 1 : 0,
        sup.created_at || sup.createdAt || now,
      ]);

      return id;
    },

    async getSuppliers() {
      const rows = await _all('SELECT * FROM suppliers WHERE is_active = 1 ORDER BY name');
      return rows.map(r => ({ ...r, createdAt: r.created_at }));
    },

    async removeSupplier(id) {
      await _run('UPDATE suppliers SET is_active = 0 WHERE id = ?', [id]);
    },

    // ════════════════════════════════════════════════════════════════════════
    // 📜 SALES HISTORY — سجل المبيعات
    // ════════════════════════════════════════════════════════════════════════

    async saveSaleHistory(sale, { alreadySynced = false } = {}) {
      const now = _now();
      const id  = sale.id || _id('SALE');

      await _run(`
        INSERT OR REPLACE INTO salesHistory
          (id, order_id, session_id, total, payment_method, date, created_at, sync_status)
        VALUES (?,?,?,?,?,?,?,?)
      `, [
        id,
        sale.order_id  || sale.orderId || null,
        sale.session_id|| sale.shiftId || null,
        sale.total     || 0,
        sale.payment_method || sale.paymentMethod || 'cash',
        sale.date      || _egyptDate(),
        sale.created_at|| sale.createdAt || now,
        alreadySynced ? 1 : 0,
      ]);

      return id;
    },

    async getSalesHistory(filters = {}) {
      let sql = 'SELECT * FROM salesHistory WHERE 1=1';
      const p = [];
      if (filters.date) { sql += ' AND date = ?'; p.push(filters.date); }
      if (filters.session_id) { sql += ' AND session_id = ?'; p.push(filters.session_id); }
      sql += ' ORDER BY created_at DESC';
      const rows = await _all(sql, p);
      return rows.map(r => ({ ...r, createdAt: r.created_at, orderId: r.order_id, shiftId: r.session_id, paymentMethod: r.payment_method }));
    },

    // ════════════════════════════════════════════════════════════════════════
    // 🛒 ORDERS ON HOLD — الطلبات المعلقة
    // ════════════════════════════════════════════════════════════════════════

    async saveOrderOnHold(order) {
      const now = _now();
      const id  = order.id || _id('HOLD');

      await _run(`
        INSERT OR REPLACE INTO ordersOnHold
          (id, items, subtotal, discount, total, customer_id, table_number, notes, created_at)
        VALUES (?,?,?,?,?,?,?,?,?)
      `, [
        id,
        JSON.stringify(order.items || order.cartItems || []),
        order.subtotal    || 0,
        order.discount    || 0,
        order.total       || 0,
        order.customer_id || order.customerId || null,
        order.table_number|| order.tableNumber|| null,
        order.notes       || null,
        order.created_at  || now,
      ]);

      return id;
    },

    async getOrdersOnHold() {
      const rows = await _all('SELECT * FROM ordersOnHold ORDER BY created_at DESC');
      return rows.map(r => _parseJson(r, ['items']));
    },

    async removeOrderOnHold(id) {
      await _run('DELETE FROM ordersOnHold WHERE id = ?', [id]);
    },

    // ════════════════════════════════════════════════════════════════════════
    // 📊 REPORTS — تجميعات للتقارير
    // ════════════════════════════════════════════════════════════════════════

    /** ملخص شيفت كامل: الطلبات + المصروفات + الإجماليات */
    async getSessionSummary(sessionId) {
      const [session, orders, expenses] = await Promise.all([
        _get('SELECT * FROM cashSessions WHERE id = ?', [sessionId]),
        _all('SELECT * FROM orders WHERE session_id = ? AND status = "paid"', [sessionId]),
        _all('SELECT * FROM expenses WHERE session_id = ?', [sessionId]),
      ]);

      const totalSales    = orders.reduce((s, o) => s + (o.total || 0), 0);
      const cashSales     = orders.filter(o => o.payment_method === 'cash').reduce((s, o) => s + o.total, 0);
      const visaSales     = orders.filter(o => o.payment_method === 'visa').reduce((s, o) => s + o.total, 0);
      const aggSales      = orders.filter(o => o.payment_method === 'aggregator').reduce((s, o) => s + o.total, 0);
      const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);

      return {
        session:        session ? _normSession(session) : null,
        orders:         orders.map(r => _parseJson(r, ['items'])),
        expenses,
        totalSales,
        cashSales,
        visaSales,
        aggSales,
        totalExpenses,
        netProfit:      totalSales - totalExpenses,
        ordersCount:    orders.length,
      };
    },

    /** طلبات نطاق تاريخي للتقارير */
    async getOrdersByDateRange(fromDate, toDate) {
      const rows = await _all(`
        SELECT * FROM orders
        WHERE DATE(created_at) BETWEEN ? AND ?
          AND status = 'paid'
        ORDER BY created_at DESC
      `, [fromDate, toDate]);
      return rows.map(r => {
        const o = _parseJson(r, ['items']);
        o.shiftId      = o.shiftId      || o.session_id;
        o.paymentMethod= o.paymentMethod|| o.payment_method;
        o.createdAt    = o.createdAt    || o.created_at;
        o.aggregatorId = o.aggregatorId || o.aggregator_id;
        o.deliveryFee  = o.deliveryFee  || o.delivery_fee;
        const dateOnly = o.created_at ? String(o.created_at).slice(0, 10) : null;
        o.date         = o.date         || dateOnly;
        o.businessDate = o.businessDate || o.date;
        o.isoDate      = o.isoDate      || o.date;
        return o;
      });
    },

    /** مصروفات نطاق تاريخي */
    async getExpensesByDateRange(fromDate, toDate) {
      return await _all(`
        SELECT * FROM expensesHistory
        WHERE date BETWEEN ? AND ?
        ORDER BY date DESC
      `, [fromDate, toDate]);
    },

    // ════════════════════════════════════════════════════════════════════════
    // 🧹 OPERATIONAL WIPE — مسح البيانات التشغيلية من SQLite
    // ════════════════════════════════════════════════════════════════════════

    /**
     * clearOperationalData — يمسح جداول التشغيل (أوردرات، مصاريف، شيفتات، حضور).
     * يُستدعى من performOperationalWipe في app_logic.js.
     * لا يمس: menuItems, categories, employees, customers, aggregators.
     */
    async clearOperationalData() {
      const tables = ['orders', 'expenses', 'expensesHistory', 'cashSessions', 'attendance'];
      for (const table of tables) {
        try {
          await _run(`DELETE FROM "${table}"`);
          console.log(`[DBService] Cleared table: ${table}`);
        } catch(e) {
          console.warn(`[DBService] Could not clear ${table}:`, e.message);
        }
      }
      console.log('[DBService] ✅ Operational data cleared from SQLite.');
    },

    // ════════════════════════════════════════════════════════════════════════
    // 🔄 SYNC HELPERS — مساعدات المزامنة مع SyncManager
    // ════════════════════════════════════════════════════════════════════════

    /**
     * markSynced — يُستدعى من SyncManager بعد رفع ناجح لـ Firebase
     * @param {string} table - اسم الجدول
     * @param {string} id    - ID السجل
     */
    async markSynced(table, id) {
      try {
        await _run(`UPDATE "${table}" SET sync_status = 1 WHERE id = ?`, [id]);
      } catch (err) {
        console.warn(`[DBService] markSynced خطأ (${table}/${id}):`, err.message);
      }
    },

    /**
     * getUnsynced — يُستدعى من SyncManager للحصول على السجلات غير المرفوعة
     * @param {string} table
     * @returns {Array}
     */
    async getUnsynced(table) {
      try {
        const rows = await _all(`SELECT * FROM "${table}" WHERE sync_status = 0`);
        // parse JSON للجداول التي تحتوي على أعمدة JSON
        const jsonCols = { orders: ['items'], menuItems: ['variants','addons','recipe','aggregator_prices'] };
        return (jsonCols[table] ? rows.map(r => _parseJson(r, jsonCols[table])) : rows);
      } catch { return []; }
    },

    // ════════════════════════════════════════════════════════════════════════
    // 🛠️ UTILITIES
    // ════════════════════════════════════════════════════════════════════════

    /** معلومات قاعدة البيانات للـ debugging */
    async getInfo() {
      return await ipcRenderer.invoke('db:info');
    },

    /** نسخة احتياطية يدوية */
    async backup() {
      return await ipcRenderer.invoke('db:backup');
    },
  };

  // ══════════════════════════════════════════════════════════════════════════
  // 🔧 Private helpers
  // ══════════════════════════════════════════════════════════════════════════

  /** تطبيع كائن الشيفت ليكون متوافقاً مع الكود القديم */
  function _normSession(r) {
    if (!r) return null;
    return {
      ...r,
      // Aliases للتوافق مع DataManager القديم
      openingAmount:  r.opening_balance,
      closingAmount:  r.closing_balance,   // ← كان ناقص!
      cashSales:      r.cash_sales,
      visaSales:      r.visa_sales,
      aggregator_sales_total: r.aggregator_sales,
      totalExpenses:  r.total_expenses,
      cashier_name:   r.opened_by,
      cashierName:    r.opened_by,
      openedBy:       r.opened_by,
      createdAt:      r.opened_at,
      closedAt:       r.closed_at,
      date:           r.opened_at ? r.opened_at.slice(0, 10) : null,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 🌐 تصدير عام
  // ══════════════════════════════════════════════════════════════════════════
  window.DBService = DBService;
  console.log('✅ [DBService] جاهز.');

})();
