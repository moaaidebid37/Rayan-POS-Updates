/**
 * database.js — Solo POS SaaS
 * ============================
 * البنية التحتية لقاعدة بيانات SQLite باستخدام better-sqlite3
 * يُستدعى مرة واحدة فقط من app.js عند بدء التشغيل
 */

'use strict';

const { app, ipcMain } = require('electron');
const path             = require('path');
const fs               = require('fs');
const Database         = require('better-sqlite3');

// ══════════════════════════════════════════════════════════════════════════════
// 📁 مسار آمن لملف قاعدة البيانات داخل userData (لن يُحذف أبداً بالتحديث)
// ══════════════════════════════════════════════════════════════════════════════
const DB_DIR  = app.getPath('userData');
const DB_PATH = path.join(DB_DIR, 'solo_pos.db');

// تأكد من وجود المجلد
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

// ── فتح/إنشاء قاعدة البيانات ─────────────────────────────────────────────
const db = new Database(DB_PATH, {
  // verbose: console.log,  // فعّلها للـ debugging فقط
});

// تحسينات الأداء — مهمة جداً
db.pragma('journal_mode = WAL');   // أسرع للكتابة المتزامنة
db.pragma('foreign_keys = ON');    // تطبيق العلاقات
db.pragma('synchronous = NORMAL'); // توازن بين الأمان والسرعة
db.pragma('cache_size = -16000');  // 16MB cache في الذاكرة

console.log(`✅ [DB] قاعدة البيانات جاهزة على: ${DB_PATH}`);

// ══════════════════════════════════════════════════════════════════════════════
// 🏗️ إنشاء الجداول (CREATE TABLE IF NOT EXISTS)
// ══════════════════════════════════════════════════════════════════════════════
function initializeTables() {
  db.exec(`

    -- ── الشيفتات النقدية ──────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS cashSessions (
      id                TEXT PRIMARY KEY,
      opened_by         TEXT NOT NULL,
      opening_balance   REAL NOT NULL DEFAULT 0,
      cash_sales        REAL NOT NULL DEFAULT 0,
      visa_sales        REAL NOT NULL DEFAULT 0,
      aggregator_sales  REAL NOT NULL DEFAULT 0,
      total_expenses    REAL NOT NULL DEFAULT 0,
      closing_balance   REAL,
      status            TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
      notes             TEXT,
      sync_status       INTEGER NOT NULL DEFAULT 0,  -- 0=pending | 1=synced
      opened_at         TEXT NOT NULL,
      closed_at         TEXT
    );

    -- ── الطلبات ───────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS orders (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL,
      type            TEXT NOT NULL DEFAULT 'takeaway',
      table_number    TEXT,
      customer_id     TEXT,
      aggregator_id   TEXT,
      items           TEXT NOT NULL DEFAULT '[]',   -- JSON: [{id, name, qty, price, variant, addons}]
      subtotal        REAL NOT NULL DEFAULT 0,
      discount        REAL NOT NULL DEFAULT 0,
      surcharge       REAL NOT NULL DEFAULT 0,
      delivery_fee    REAL NOT NULL DEFAULT 0,
      total           REAL NOT NULL DEFAULT 0,
      payment_method  TEXT NOT NULL DEFAULT 'cash',
      status          TEXT NOT NULL DEFAULT 'paid',
      notes           TEXT,
      sync_status     INTEGER NOT NULL DEFAULT 0,   -- 0=pending | 1=synced
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      order_source TEXT DEFAULT 'direct', 
      aggregator_markup REAL DEFAULT 0, 
      total_cost REAL DEFAULT 0 
    );
    CREATE INDEX IF NOT EXISTS idx_orders_session   ON orders(session_id);
    CREATE INDEX IF NOT EXISTS idx_orders_date      ON orders(created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_customer  ON orders(customer_id);

    -- ── المصروفات ─────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS expenses (
      id              TEXT PRIMARY KEY,
      session_id      TEXT,
      category        TEXT NOT NULL,
      description     TEXT NOT NULL,
      amount          REAL NOT NULL DEFAULT 0,
      payment_method  TEXT NOT NULL DEFAULT 'cash',
      employee_id     TEXT,
      sync_status     INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_expenses_session ON expenses(session_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_date    ON expenses(created_at);

    -- ── سجل المصروفات التاريخي (لا يُحذف عند إغلاق الشيفت) ──────────────────
    CREATE TABLE IF NOT EXISTS expensesHistory (
      id          TEXT PRIMARY KEY,
      expense_id  TEXT NOT NULL,
      session_id  TEXT,
      category    TEXT NOT NULL,
      description TEXT NOT NULL,
      amount      REAL NOT NULL DEFAULT 0,
      date        TEXT NOT NULL,          -- YYYY-MM-DD
      created_at  TEXT NOT NULL
    );

    -- ── سجل اليومية ──────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS daily_log (
      id            TEXT PRIMARY KEY,
      session_id    TEXT REFERENCES cashSessions(id),
      type          TEXT NOT NULL,  -- sale | expense | session_open | session_close | attendance | refund
      reference_id  TEXT,           -- order_id أو expense_id أو attendance_id
      description   TEXT NOT NULL,
      amount        REAL NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_log_session ON daily_log(session_id);
    CREATE INDEX IF NOT EXISTS idx_log_date    ON daily_log(created_at);

    -- ── العملاء ──────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS customers (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      phone         TEXT,
      restaurant_id TEXT,
      address       TEXT,
      level         TEXT NOT NULL DEFAULT 'عادي',
      points        REAL NOT NULL DEFAULT 0,
      total_orders  INTEGER NOT NULL DEFAULT 0,
      total_spent   REAL NOT NULL DEFAULT 0,
      notes         TEXT,
      sync_status   INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      UNIQUE(phone, restaurant_id)
    );
    CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

    -- ── الفئات ───────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS categories (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      icon       TEXT,
      color      TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active  INTEGER NOT NULL DEFAULT 1
    );

    -- ── المنيو ───────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS menuItems (
      id                TEXT PRIMARY KEY,
      category_id       TEXT,
      name              TEXT NOT NULL,
      description       TEXT,
      price             REAL NOT NULL DEFAULT 0,
      cost              REAL NOT NULL DEFAULT 0,
      image             TEXT,
      variants          TEXT DEFAULT '[]',
      addons            TEXT DEFAULT '[]',
      stock_quantity    REAL NOT NULL DEFAULT 0,
      min_stock         REAL NOT NULL DEFAULT 0,
      critical_stock    REAL NOT NULL DEFAULT 0,
      track_stock       INTEGER NOT NULL DEFAULT 0,
      recipe            TEXT DEFAULT '[]',
      aggregator_prices TEXT DEFAULT '{}',
      is_active         INTEGER NOT NULL DEFAULT 1,
      sort_order        INTEGER NOT NULL DEFAULT 0,
      sync_status       INTEGER NOT NULL DEFAULT 0,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_menu_category ON menuItems(category_id);
    CREATE INDEX IF NOT EXISTS idx_menu_active   ON menuItems(is_active);

    -- ── الموظفون ─────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS employees (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      phone         TEXT,
      role          TEXT NOT NULL DEFAULT 'كاشير',  -- كاشير | طباخ | ويتر | مدير
      salary_type   TEXT NOT NULL DEFAULT 'daily' CHECK(salary_type IN ('daily','monthly')),
      salary_amount REAL NOT NULL DEFAULT 0,
      start_date    TEXT,
      is_active     INTEGER NOT NULL DEFAULT 1,
      notes         TEXT,
      created_at    TEXT NOT NULL
    );

    -- ── الحضور والانصراف ──────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS attendance (
      id           TEXT PRIMARY KEY,
      employee_id  TEXT NOT NULL REFERENCES employees(id),
      session_id   TEXT REFERENCES cashSessions(id),
      check_in     TEXT NOT NULL,
      check_out    TEXT,
      hours_worked REAL,
      daily_wage   REAL NOT NULL DEFAULT 0,
      status       TEXT NOT NULL DEFAULT 'present' CHECK(status IN ('present','absent','late')),
      notes        TEXT,
      date         TEXT NOT NULL,   -- YYYY-MM-DD (للبحث السريع)
      sync_status  INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_attendance_emp     ON attendance(employee_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance(session_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_date    ON attendance(date);

    -- ── شركات التوصيل ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS aggregators (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL UNIQUE,
      commission_rate REAL NOT NULL DEFAULT 0,   -- نسبة العمولة المخصومة %
      markup_rate     REAL NOT NULL DEFAULT 0,   -- نسبة الزيادة على أسعار المنيو %
      is_active       INTEGER NOT NULL DEFAULT 1,
      color           TEXT,
      logo            TEXT,
      created_at      TEXT NOT NULL
    );

    -- ── المواد الخام ──────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS ingredients (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      unit          TEXT DEFAULT 'كجم',
      quantity      REAL NOT NULL DEFAULT 0,
      min_quantity  REAL NOT NULL DEFAULT 0,
      cost          REAL NOT NULL DEFAULT 0,
      supplier_id   TEXT,
      category      TEXT,
      notes         TEXT,
      is_active     INTEGER NOT NULL DEFAULT 1,
      sync_status   INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    -- ── الموردين ──────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS suppliers (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      phone         TEXT,
      address       TEXT,
      notes         TEXT,
      is_active     INTEGER NOT NULL DEFAULT 1,
      sync_status   INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL
    );

    -- ── سجل المبيعات ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS salesHistory (
      id            TEXT PRIMARY KEY,
      order_id      TEXT,
      session_id    TEXT,
      total         REAL NOT NULL DEFAULT 0,
      payment_method TEXT DEFAULT 'cash',
      date          TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      sync_status   INTEGER NOT NULL DEFAULT 0
    );

    -- ── الطلبات المعلقة ───────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS ordersOnHold (
      id            TEXT PRIMARY KEY,
      items         TEXT NOT NULL DEFAULT '[]',
      subtotal      REAL NOT NULL DEFAULT 0,
      discount      REAL NOT NULL DEFAULT 0,
      total         REAL NOT NULL DEFAULT 0,
      customer_id   TEXT,
      table_number  TEXT,
      notes         TEXT,
      created_at    TEXT NOT NULL
    );

  `);

  console.log('✅ [DB] تم تهيئة كافة الجداول بنجاح.');
}

// ══════════════════════════════════════════════════════════════════════════════
// 🔄 Migrations — إضافة أعمدة جديدة لقواعد بيانات قديمة بأمان
// ══════════════════════════════════════════════════════════════════════════════
function runMigrations() {
  // كل migration: { table, column, definition }
  const migrations = [
    { table: 'orders',        column: 'sync_status',  def: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'cashSessions',  column: 'sync_status',  def: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'expenses',      column: 'sync_status',  def: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'customers',     column: 'sync_status',  def: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'menuItems',     column: 'sync_status',  def: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'employees',     column: 'sync_status',  def: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'aggregators',   column: 'sync_status',  def: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'attendance',       column: 'sync_status',  def: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'expensesHistory',  column: 'sync_status',  def: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'customers',        column: 'restaurant_id', def: 'TEXT' },
    { table: 'ingredients',   column: 'warning_threshold', def: 'REAL NOT NULL DEFAULT 0' },
    { table: 'orders',        column: 'tax',               def: 'REAL DEFAULT 0' },
    { table: 'orders',        column: 'service_charge',    def: 'REAL DEFAULT 0' },
    // إزالة قيود CHECK من orders لقبول بيانات المنيجريشن القديمة
    // (SQLite لا يدعم DROP CONSTRAINT — سنتجاهل هذا ونتكل على OR REPLACE)
  ];

  for (const { table, column, def } of migrations) {
    try {
      // تحقق إذا العمود موجود مسبقاً
      const cols = db.pragma(`table_info(${table})`);
      const exists = cols.some(c => c.name === column);
      if (!exists) {
        db.exec(`ALTER TABLE "${table}" ADD COLUMN ${column} ${def}`);
        console.log(`✅ [DB Migration] أضفت عمود ${column} لجدول ${table}`);
      }
    } catch (err) {
      // لو الجدول غير موجود بعد (سيُنشأ لاحقاً) — تجاهل
      if (!err.message.includes('no such table')) {
        console.warn(`⚠️ [DB Migration] ${table}.${column}:`, err.message);
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 📡 IPC Handlers — واجهة التواصل مع الـ Renderer
// ══════════════════════════════════════════════════════════════════════════════
/**
 * نمط الاستخدام من الـ Renderer (عبر preload أو nodeIntegration):
 *
 *   const { ipcRenderer } = require('electron');
 *
 *   // SELECT (يُرجع مصفوفة)
 *   const rows = await ipcRenderer.invoke('db:all', 'SELECT * FROM orders WHERE session_id = ?', [sessionId]);
 *
 *   // SELECT (صف واحد)
 *   const row = await ipcRenderer.invoke('db:get', 'SELECT * FROM customers WHERE phone = ?', [phone]);
 *
 *   // INSERT / UPDATE / DELETE (يُرجع { changes, lastInsertRowid })
 *   const result = await ipcRenderer.invoke('db:run',
 *     'INSERT INTO customers (id, name, phone, ...) VALUES (?, ?, ?, ...)',
 *     [id, name, phone, ...]
 *   );
 *
 *   // Transaction (مجموعة عمليات atomically)
 *   const result = await ipcRenderer.invoke('db:transaction', [
 *     { sql: 'INSERT INTO orders ...', params: [...] },
 *     { sql: 'UPDATE cashSessions ...', params: [...] },
 *   ]);
 */

function registerIpcHandlers() {

  // ── db:all — SELECT متعدد الصفوف ─────────────────────────────────────────
  ipcMain.handle('db:all', (_event, sql, params = []) => {
    try {
      return { ok: true, data: db.prepare(sql).all(...params) };
    } catch (err) {
      console.error('[DB:all] خطأ:', err.message, '| SQL:', sql);
      return { ok: false, error: err.message };
    }
  });

  // ── db:get — SELECT صف واحد ───────────────────────────────────────────────
  ipcMain.handle('db:get', (_event, sql, params = []) => {
    try {
      return { ok: true, data: db.prepare(sql).get(...params) };
    } catch (err) {
      console.error('[DB:get] خطأ:', err.message, '| SQL:', sql);
      return { ok: false, error: err.message };
    }
  });

  // ── db:run — INSERT / UPDATE / DELETE ────────────────────────────────────
  ipcMain.handle('db:run', (_event, sql, params = []) => {
    try {
      const info = db.prepare(sql).run(...params);
      return { ok: true, changes: info.changes, lastId: info.lastInsertRowid };
    } catch (err) {
      console.error('[DB:run] خطأ:', err.message, '| SQL:', sql);
      return { ok: false, error: err.message };
    }
  });

  // ── db:transaction — عمليات متعددة atomically ───────────────────────────
  // operations: [{ sql, params }, ...]
  ipcMain.handle('db:transaction', (_event, operations) => {
    try {
      const results = db.transaction((ops) => {
        return ops.map(({ sql, params = [] }) => {
          const info = db.prepare(sql).run(...params);
          return { changes: info.changes, lastId: info.lastInsertRowid };
        });
      })(operations);
      return { ok: true, results };
    } catch (err) {
      console.error('[DB:transaction] خطأ:', err.message);
      return { ok: false, error: err.message };
    }
  });

  // ── db:backup — نسخة احتياطية عند الطلب ─────────────────────────────────
  ipcMain.handle('db:backup', async (_event) => {
    try {
      const backupDir  = path.join(DB_DIR, 'backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      const timestamp  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backupPath = path.join(backupDir, `solo_pos_backup_${timestamp}.db`);
      await db.backup(backupPath);
      return { ok: true, path: backupPath };
    } catch (err) {
      console.error('[DB:backup] خطأ:', err.message);
      return { ok: false, error: err.message };
    }
  });

  // ── db:migrate — تشغيل الـ migrations يدوياً من الـ Renderer ──────────────
  ipcMain.handle('db:migrate', () => {
    try {
      runMigrations();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── db:info — معلومات عامة عن قاعدة البيانات ────────────────────────────
  ipcMain.handle('db:info', (_event) => {
    try {
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      ).all().map(r => r.name);

      const counts = {};
      for (const t of tables) {
        try { counts[t] = db.prepare(`SELECT COUNT(*) as c FROM "${t}"`).get().c; }
        catch { counts[t] = 0; }
      }

      const stats = fs.statSync(DB_PATH);
      return {
        ok:     true,
        path:   DB_PATH,
        size:   (stats.size / 1024 / 1024).toFixed(2) + ' MB',
        tables: counts,
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  console.log('✅ [DB] تم تسجيل جميع IPC Handlers بنجاح.');
}

// ══════════════════════════════════════════════════════════════════════════════
// 🚀 تهيئة وتصدير
// ══════════════════════════════════════════════════════════════════════════════
function initDatabase() {
  initializeTables();
  runMigrations();       // آمن — يُضيف فقط ما ينقص
  registerIpcHandlers();
  return db;
}

module.exports = { initDatabase, db };
