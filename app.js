/**
 * app.js — Solo POS SaaS Edition
 * =================================
 * نفس الملف الأصلي + إضافات SaaS:
 *   1. IPC handler لـ Hardware ID
 *   2. حماية Dev Tools في Production
 *
 * ✏️  الفرق عن النسخة القديمة: أضف الكود ده بعد سطر:
 *     const { autoUpdater } = require('electron-updater');
 */

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path    = require('path');
const os      = require('os');
const crypto  = require('crypto');
const { execSync } = require('child_process');
const { autoUpdater } = require('electron-updater');
require('./phone-auth-ipc');

app.disableHardwareAcceleration();

let mainWindow;

// ══════════════════════════════════════════════════════════════════════════════
// 🔑 Hardware ID — مشتق من بيانات الجهاز الفعلية
// ══════════════════════════════════════════════════════════════════════════════
// ── قراءة Serial من أمر النظام ─────────────────────────────────────────────
function _readSerial(cmd) {
  try {
    const out = execSync(cmd, { timeout: 4000, windowsHide: true })
      .toString().trim();
    // نظّف المخرجات من أسطر فارغة وكلمات "SerialNumber" غير المطلوبة
    const lines = out.split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && l !== 'SerialNumber' && l !== 'To Be Filled By O.E.M.'
                    && l !== 'Default string' && l.length > 2);
    return lines[0] || '';
  } catch { return ''; }
}

function generateHardwareId() {
  try {
    const platform = os.platform(); // 'win32' | 'darwin' | 'linux'
    let mbSerial  = '';
    let diskSerial = '';
    let cpuId      = '';

    if (platform === 'win32') {
      // ── Windows: wmic — أقوى مصدر للـ serial حقيقي ──────────────────────
      mbSerial   = _readSerial('wmic baseboard get serialnumber');
      diskSerial = _readSerial('wmic diskdrive where "Index=0" get serialnumber');
      cpuId      = _readSerial('wmic cpu get processorid');
    } else if (platform === 'darwin') {
      // ── macOS: ioreg — Serial Number للجهاز ──────────────────────────────
      mbSerial   = _readSerial(
        "ioreg -r -d 1 -c IOPlatformExpertDevice | awk '/IOPlatformSerialNumber/{print $NF}' | tr -d '\"'"
      );
      cpuId      = _readSerial(
        "sysctl -n machdep.cpu.brand_string"
      );
    } else {
      // ── Linux ──────────────────────────────────────────────────────────────
      mbSerial   = _readSerial('cat /sys/class/dmi/id/board_serial 2>/dev/null');
      diskSerial = _readSerial('lsblk -d -o SERIAL 2>/dev/null | tail -1');
    }

    // Fallback على MAC + hostname لو فشلنا نجيب سيريال حقيقي
    const interfaces = os.networkInterfaces();
    const macs = [];
    Object.values(interfaces).forEach(iface => {
      iface?.forEach(i => {
        if (!i.internal && i.mac && i.mac !== '00:00:00:00:00:00')
          macs.push(i.mac.toUpperCase());
      });
    });

    // ادمج كل المصادر: Hardware serials أولاً + MAC كـ fallback ثانوي
    const raw = [
      mbSerial   || 'NO-MB',
      diskSerial || 'NO-DISK',
      cpuId      || os.cpus()?.[0]?.model || 'NO-CPU',
      macs.sort().join(',') || 'NO-MAC',
      os.platform(),
      os.arch(),
    ].join('|');

    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    // نوضح في الـ prefix إيه المصدر الرئيسي
    const prefix = (mbSerial || diskSerial) ? 'SOLO-HW' : 'SOLO-MAC';
    return prefix + '-' + hash.substring(0, 12).toUpperCase();

  } catch (e) {
    // Last resort: fallback ثابت مبني على hostname + arch
    const stable = crypto.createHash('sha256')
      .update(os.hostname() + os.arch() + os.platform())
      .digest('hex');
    return 'SOLO-FB-' + stable.substring(0, 12).toUpperCase();
  }
}

// Cache the HW ID (مش هيتغير طول وقت التشغيل)
const HARDWARE_ID = generateHardwareId();

// ── IPC Handler ─────────────────────────────────────────────────────────────
ipcMain.handle('get-hardware-id', () => HARDWARE_ID);

// إعادة تشغيل التطبيق (بعد حذف الحساب مثلاً)
ipcMain.on('restart-app', () => {
  app.relaunch();
  app.exit(0);
});

// ══════════════════════════════════════════════════════════════════════════════
// Window
// ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
// 🌐 Local Server — عشان Firebase Phone Auth يشتغل (مش هيشتغل على file://)
// ══════════════════════════════════════════════════════════════════════════════
const express = require('express');
const localServer = express();
localServer.use(express.static(__dirname));

// ── /api/subscription/:uid — Admin impersonation, uses Admin SDK ──────────
localServer.get('/api/subscription/:uid', async (req, res) => {
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccountKey.json')) });
    }
    const snap = await admin.firestore().collection('subscriptions').doc(req.params.uid).get();
    if (!snap.exists) return res.status(404).json({ error: 'not found' });
    res.json({ uid: req.params.uid, ...snap.data() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ابدأ السيرفر المحلي على بورت 3001
let localServerPort = 3001;
function startLocalServer(callback) {
  const server = localServer.listen(localServerPort, '127.0.0.1', () => {
    console.log(`✅ Local server running on http://localhost:${localServerPort}`);
    callback(localServerPort);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      localServerPort++;
      startLocalServer(callback);
    } else {
      console.error('Local server error:', err);
      callback(null);
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 🍳 KDS Server — سيرفر المطبخ على الشبكة المحلية (port 3002)
// ══════════════════════════════════════════════════════════════════════════════
const http = require('http');
const { Server: SocketServer } = require('socket.io');

const kdsApp = express();
const kdsHttpServer = http.createServer(kdsApp);
const kdsIO = new SocketServer(kdsHttpServer, { cors: { origin: '*' } });

// Middleware
kdsApp.use(require('cors')());
kdsApp.use(express.json());

// خدمة ملف KDS الثابت (no-cache عشان التحديثات تظهر فوراً)
kdsApp.get('/kds', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(__dirname, 'kds.html'));
});
// خدمة الملفات الثابتة (CSS, JS, sounds, images)
kdsApp.use('/sounds', express.static(path.join(__dirname, 'sounds')));
kdsApp.use('/css', express.static(path.join(__dirname, 'css')));
kdsApp.use('/js', express.static(path.join(__dirname, 'js')));
kdsApp.use('/img', express.static(path.join(__dirname, 'img')));
kdsApp.use('/assets', express.static(path.join(__dirname, 'assets')));

// ══════════════════════════════════════════════════════════════════════════════
// استخراج IP الشبكة المحلية — ذكي ومتوافق مع Windows + Mac + Linux
// ══════════════════════════════════════════════════════════════════════════════
function getLocalIP() {
  const interfaces = os.networkInterfaces();

  // ─── Step 1: قائمة الواجهات الوهمية (تخطيها نهائياً) ───
  const SKIP = new RegExp([
    // Windows virtual
    'vEthernet', 'WSL', 'Hyper-V', 'Virtual', 'VMware', 'VirtualBox',
    // Docker / Containers
    'docker', 'veth', 'br-', 'virbr', 'cni', 'flannel', 'cali',
    // Mac internal
    'utun', 'awdl', 'llw', 'anpi', 'gif', 'stf', 'ap\\d',
    // VPN / Tunnels
    'ipsec', 'ppp', 'tun\\d', 'tap\\d', 'ZeroTier', 'Tailscale',
    // P2P / AirDrop
    'p2p', 'bridge\\d',
    // VBox
    'vbox',
  ].join('|'), 'i');

  const all = []; // كل الواجهات الصالحة

  for (const name of Object.keys(interfaces)) {
    if (SKIP.test(name)) continue;
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        all.push({ addr: iface.address, name });
      }
    }
  }

  console.log('KDS all valid interfaces:', all.map(c => `${c.name}=${c.addr}`).join(', ') || 'NONE');

  if (all.length === 0) return '127.0.0.1';
  if (all.length === 1) { console.log('KDS selected IP:', all[0].addr); return all[0].addr; }

  // ─── Step 2: أولوية 1 — Windows Wi-Fi ───
  const winWifi = all.find(c => /wi-?fi|wireless|wlan/i.test(c.name));
  if (winWifi) { console.log('KDS selected IP (Win Wi-Fi):', winWifi.addr, winWifi.name); return winWifi.addr; }

  // ─── Step 3: أولوية 2 — Mac Wi-Fi (en0) أو iPhone Hotspot (172.20.10.x) ───
  const macWifi = all.find(c => c.name === 'en0');
  if (macWifi) { console.log('KDS selected IP (Mac en0):', macWifi.addr); return macWifi.addr; }
  const iphoneHotspot = all.find(c => c.addr.startsWith('172.20.10.'));
  if (iphoneHotspot) { console.log('KDS selected IP (iPhone Hotspot):', iphoneHotspot.addr, iphoneHotspot.name); return iphoneHotspot.addr; }

  // ─── Step 4: أولوية 3 — أي شبكة محلية معروفة ───
  const localNet = all.find(c =>
    c.addr.startsWith('192.168.') || c.addr.startsWith('10.') || c.addr.startsWith('172.16.') ||
    c.addr.startsWith('172.17.') || c.addr.startsWith('172.18.') || c.addr.startsWith('172.19.') ||
    c.addr.startsWith('172.2') || c.addr.startsWith('172.3')
  );
  if (localNet) { console.log('KDS selected IP (Local Net):', localNet.addr, localNet.name); return localNet.addr; }

  // ─── Step 5: آخر حل — أول واجهة متاحة ───
  console.log('KDS selected IP (fallback):', all[0].addr, all[0].name);
  return all[0].addr;
}

// ── KDS State — الأوردرات النشطة في المطبخ ──
let kdsOrders = [];        // [{id, items, orderType, tableNumber, total, createdAt, status:'preparing'|'ready'}]
let kdsConnectedDevices = 0;

// مدة التحضير — محفوظة في ملف عشان تفضل بعد الريستارت
let kdsPrepTimeLimit = 15;
const kdsPrepTimeFile = path.join(__dirname, '.kds-prep-time');
try {
  const fs = require('fs');
  if (fs.existsSync(kdsPrepTimeFile)) {
    kdsPrepTimeLimit = parseInt(fs.readFileSync(kdsPrepTimeFile, 'utf8')) || 15;
  }
} catch(e) {}

// API: جلب الأوردرات النشطة
kdsApp.get('/api/kds/orders', (req, res) => {
  res.json(kdsOrders);
});

// API: تحديث حالة أوردر
kdsApp.post('/api/kds/order/:id/status', (req, res) => {
  const { status } = req.body;
  const order = kdsOrders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  order.status = status;
  order.readyAt = status === 'ready' ? new Date().toISOString() : null;
  // إبلاغ كل الأجهزة المتصلة
  kdsIO.emit('order-updated', order);
  // إبلاغ الكاشير عبر IPC
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('kds-order-status-changed', order);
  }
  res.json(order);
});

// API: حذف أوردر (بعد التسليم)
kdsApp.post('/api/kds/order/:id/delivered', (req, res) => {
  const idx = kdsOrders.findIndex(o => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Order not found' });
  const order = kdsOrders[idx];
  order.status = 'delivered';
  kdsOrders.splice(idx, 1);
  kdsIO.emit('order-delivered', order);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('kds-order-delivered', order);
  }
  res.json({ success: true });
});

// WebSocket للتواصل اللحظي
kdsIO.on('connection', (socket) => {
  kdsConnectedDevices++;
  console.log(`🍳 KDS device connected (${kdsConnectedDevices} devices)`);
  // أرسل الأوردرات الحالية + الإعدادات للجهاز الجديد
  socket.emit('all-orders', kdsOrders);
  socket.emit('connected-devices', kdsConnectedDevices);
  socket.emit('kds-settings', { prepTimeLimit: kdsPrepTimeLimit });

  // تم الاستلام من المطبخ
  socket.on('mark-received', (orderId) => {
    const order = kdsOrders.find(o => o.id === orderId);
    if (order) {
      order._received = true;
      order.receivedAt = new Date().toISOString();
      kdsIO.emit('order-updated', order);
    }
  });

  socket.on('mark-ready', (orderId) => {
    const order = kdsOrders.find(o => o.id === orderId);
    if (order) {
      order.status = 'ready';
      order.readyAt = new Date().toISOString();
      kdsIO.emit('order-updated', order);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('kds-order-status-changed', order);
      }
    }
  });

  socket.on('mark-delivered', (orderId) => {
    const idx = kdsOrders.findIndex(o => o.id === orderId);
    if (idx !== -1) {
      const order = kdsOrders[idx];
      order.status = 'delivered';
      kdsOrders.splice(idx, 1);
      kdsIO.emit('order-delivered', order);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('kds-order-delivered', order);
      }
    }
  });

  socket.on('disconnect', () => {
    kdsConnectedDevices--;
    console.log(`🍳 KDS device disconnected (${kdsConnectedDevices} devices)`);
    kdsIO.emit('connected-devices', kdsConnectedDevices);
  });
});

// بدء سيرفر KDS على 0.0.0.0:3002 (يقبل اتصالات من الشبكة)
let kdsPort = 3002;
function startKDSServer() {
  kdsHttpServer.listen(kdsPort, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log(`🍳 KDS Server running on http://${ip}:${kdsPort}/kds`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') { kdsPort++; startKDSServer(); }
    else console.error('KDS server error:', err);
  });
}

// ── IPC Handlers للـ KDS ──
// إرسال أوردر للمطبخ
ipcMain.handle('kds-send-order', (event, order) => {
  const kdsOrder = {
    id: order.id,
    items: order.items || [],
    orderType: order.orderType || order.type || 'takeaway',
    orderSource: order.orderSource || 'direct',
    tableNumber: order.tableNumber || order.table_number || null,
    total: order.total || 0,
    customerName: order.customerName || null,
    notes: order.notes || '',
    createdAt: new Date().toISOString(),
    status: 'preparing',
    readyAt: null,
  };
  kdsOrders.push(kdsOrder);
  kdsIO.emit('new-order', kdsOrder);
  return { success: true, order: kdsOrder };
});

// جلب حالة الأوردرات
ipcMain.handle('kds-get-orders', () => kdsOrders);

// جلب معلومات KDS (IP, port, connected devices)
ipcMain.handle('kds-get-info', async () => {
  const ip = getLocalIP();
  const url = `http://${ip}:${kdsPort}/kds`;
  let qrDataUrl = null;
  try {
    const qrcode = require('qrcode');
    qrDataUrl = await qrcode.toDataURL(url, { width: 280, margin: 2, color: { dark: '#000', light: '#fff' } });
  } catch (e) { console.error('QR generation error:', e); }
  return { ip, port: kdsPort, url, qrCode: qrDataUrl, connectedDevices: kdsConnectedDevices, prepTimeLimit: kdsPrepTimeLimit };
});

// حفظ إعدادات KDS (مدة التحضير)
ipcMain.handle('kds-set-prep-time', (event, minutes) => {
  kdsPrepTimeLimit = Math.max(1, Math.min(60, parseInt(minutes) || 15));
  // حفظ في ملف عشان يفضل بعد الريستارت
  try { require('fs').writeFileSync(kdsPrepTimeFile, String(kdsPrepTimeLimit)); } catch(e) {}
  // أبلغ كل الأجهزة المتصلة بالإعدادات الجديدة
  kdsIO.emit('kds-settings', { prepTimeLimit: kdsPrepTimeLimit });
  return { success: true, prepTimeLimit: kdsPrepTimeLimit };
});

// تسليم أوردر من الكاشير
ipcMain.handle('kds-mark-delivered', (event, orderId) => {
  const idx = kdsOrders.findIndex(o => o.id === orderId);
  if (idx !== -1) {
    const order = kdsOrders[idx];
    order.status = 'delivered';
    kdsOrders.splice(idx, 1);
    kdsIO.emit('order-delivered', order);
    return { success: true };
  }
  return { success: false, error: 'Order not found' };
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1920,
    height: 1080,
    fullscreen:       true,
    autoHideMenuBar:  true,
    title:            'Solo System',
    webPreferences: {
      nodeIntegration:  true,
      contextIsolation: false,
      webSecurity:      false,
      devTools: process.env.NODE_ENV !== 'production',
      offscreen:  false,
      spellcheck: false,
    },
  });

  mainWindow.setTitle('Solo System');

  // شغّل على localhost عشان Firebase Phone Auth يشتغل
  startLocalServer((port) => {
    if (port) {
      mainWindow.loadURL(`http://localhost:${port}/index.html`);
    } else {
      // fallback لو السيرفر فشل
      mainWindow.loadFile('index.html');
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setZoomFactor(0.85);
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.log('خطأ في تحميل الصفحة:', errorDescription);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  // ── تهيئة قاعدة البيانات أولاً قبل أي شيء آخر ──────────────────────────
  const { initDatabase } = require('./database');
  initDatabase();

  createWindow();
  startKDSServer();
  startWhatsAppServer();
  autoUpdater.autoDownload = false;
  autoUpdater.checkForUpdates();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ══════════════════════════════════════════════════════════════════════════════
// الطباعة (بدون تغيير)
// ══════════════════════════════════════════════════════════════════════════════
ipcMain.on('silent-print', (event) => {
  event.sender.print({ silent: true, printBackground: true, margins: { marginType: 'none' } });
});

ipcMain.on('print-receipt-hidden', (event, receiptHtml) => {
  let printWin = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(receiptHtml)}`);
  printWin.webContents.on('did-finish-load', () => {
    printWin.webContents.print(
      { silent: true, printBackground: true, margins: { marginType: 'none' } },
      () => { printWin.close(); }
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// التحديث التلقائي (بدون تغيير)
// ══════════════════════════════════════════════════════════════════════════════
autoUpdater.on('checking-for-update', () => {
  // صامت — لا نزعج المستخدم عند كل فحص
  console.log('[Updater] Checking for updates...');
});

autoUpdater.on('update-available', (info) => {
  const version      = info.version || 'الجديد';
  const releaseNotes = info.releaseNotes
    ? info.releaseNotes.replace(/<[^>]*>?/gm, '')
    : 'تحسينات جديدة وإصلاح أخطاء سابقة.';
  // أرسل للـ renderer عشان يعرض الإشعار في الواجهة بدل native dialog
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.webContents.send('show-update-modal', { version, notes: releaseNotes });
});

autoUpdater.on('update-not-available', (info) => {
  // صامت — المستخدم مش محتاج يعرف إنه محدث في كل مرة
  console.log('[Updater] Already up to date:', info.version);
});

autoUpdater.on('update-downloaded', () => {
  dialog.showMessageBox({
    type: 'question', title: 'اكتمل التحميل ✅',
    message: 'تم تحميل التحديث. إعادة التشغيل الآن؟',
    buttons: ['إعادة التشغيل الآن', 'لاحقاً'], defaultId: 0, cancelId: 1,
  }).then((result) => { if (result.response === 0) autoUpdater.quitAndInstall(); });
});

autoUpdater.on('error', (err) => {
  console.error('خطأ في التحديث:', err);
  dialog.showMessageBox({ type: 'error', title: 'إيرور ❌', message: err.message });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🚀 سيرفر الواتساب (بدون تغيير — من الملف الأصلي)
// ══════════════════════════════════════════════════════════════════════════════
function startWhatsAppServer() {
  try {
    const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
    const qrcode   = require('qrcode');
    const express  = require('express');
    const cors     = require('cors');
    const http     = require('http');
    const { Server } = require('socket.io');
    const fs       = require('fs');

    const expressApp = express();
    expressApp.use(cors());
    expressApp.use(express.json({ limit: '20mb' }));

    const waServer = http.createServer(expressApp);
    const io = new Server(waServer, { cors: { origin: '*' } });

        const sessionPath = path.join(app.getPath('userData'), 'whatsapp_session_' + Date.now());

    let browserPath = '';
    if (process.platform === 'win32') {
      const winPaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      ];
      for (let p of winPaths) { if (fs.existsSync(p)) { browserPath = p; break; } }
    } else if (process.platform === 'darwin') {
      browserPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    }

    const puppeteerOptions = {
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
             '--disable-accelerated-2d-canvas','--disable-gpu'],
    };
    if (browserPath && fs.existsSync(browserPath)) {
      puppeteerOptions.executablePath = browserPath;
    }

    const waClient = new Client({
      authStrategy: new LocalAuth({ dataPath: sessionPath }),
      puppeteer: puppeteerOptions,
    });

    let waIsReady = false;
    let lastQrCode = null;

    waClient.on('loading_screen', (percent, msg) => {
      console.log(`⌛ ${percent}% - ${msg}`);
      io.emit('loading', `جاري تحميل المحرك: ${percent}%`);
    });

    waClient.on('qr', async (qr) => {
      try {
        const qrImage = await qrcode.toDataURL(qr);
        lastQrCode = qrImage;
        io.emit('qr', qrImage);
        console.log('✅ QR Code جاهز!');
      } catch (err) { console.error('⚠️ خطأ في QR:', err.message); }
    });

    waClient.on('ready', () => {
      waIsReady = true; lastQrCode = null;
      io.emit('ready', 'Connected');
      console.log('✅ واتساب جاهز!');
    });

    waClient.on('auth_failure', (msg) => {
      console.error('❌ فشل المصادقة:', msg);
      io.emit('system_error', 'فشل المصادقة: ' + msg);
    });

    waClient.on('disconnected', () => {
      waIsReady = false; lastQrCode = null;
      io.emit('disconnected', 'Disconnected');
      setTimeout(() => waClient.initialize(), 5000);
    });

    io.on('connection', (socket) => {
      socket.emit('status', waIsReady ? 'connected' : 'disconnected');
      if (!waIsReady && lastQrCode) socket.emit('qr', lastQrCode);
    });

    expressApp.post('/send-message', async (req, res) => {
      if (!waIsReady) return res.status(400).json({ success: false, error: 'الواتساب غير متصل' });
      const { phone, message, imageBase64 } = req.body;
      if (!phone || !message) return res.status(400).json({ success: false, error: 'بيانات ناقصة' });
      try {
        let formattedPhone = String(phone).replace(/\D/g, '');
        if (formattedPhone.startsWith('0')) formattedPhone = '2' + formattedPhone;
        const chatId = `${formattedPhone}@c.us`;
        if (imageBase64) {
          const media = new MessageMedia('image/jpeg', imageBase64, 'promo.jpg');
          await waClient.sendMessage(chatId, media, { caption: message });
        } else {
          await waClient.sendMessage(chatId, message);
        }
        res.json({ success: true });
      } catch (error) {
        console.error('❌ فشل الإرسال:', error.message);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    const PORT = 3005;
    waServer.listen(PORT, () => {
      console.log(`🚀 سيرفر الواتساب شغال على بورت ${PORT}`);
    }).on('error', (err) => { console.error('⚠️ خطأ في البورت:', err.message); });

    waClient.initialize().catch(err => {
      console.error('⚠️ خطأ في الواتساب:', err.message);
      io.emit('system_error', err.message);
    });

    console.log('🚀 محرك الواتساب اشتغل أوتوماتيك!');

  } catch (error) {
    console.error('❌ whatsapp-web.js مش موجود:', error.message);
  }
}