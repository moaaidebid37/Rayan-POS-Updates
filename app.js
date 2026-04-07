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
const { autoUpdater } = require('electron-updater');
require('./phone-auth-ipc');

app.disableHardwareAcceleration();

let mainWindow;

// ══════════════════════════════════════════════════════════════════════════════
// 🔑 Hardware ID — مشتق من بيانات الجهاز الفعلية
// ══════════════════════════════════════════════════════════════════════════════
function generateHardwareId() {
  try {
    // جمّع بيانات فريدة للجهاز
    const interfaces = os.networkInterfaces();
    const macs = [];

    Object.values(interfaces).forEach(iface => {
      iface?.forEach(i => {
        if (!i.internal && i.mac && i.mac !== '00:00:00:00:00:00') {
          macs.push(i.mac.toUpperCase());
        }
      });
    });

    const raw = [
      macs.sort().join(','),    // MAC addresses
      os.hostname(),            // اسم الجهاز
      os.platform(),            // Windows / macOS / Linux
      os.arch(),                // x64 / arm64
      os.cpus()?.[0]?.model || '',  // موديل المعالج
    ].join('|');

    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    return 'SOLO-' + hash.substring(0, 16).toUpperCase();

  } catch (e) {
    // fallback لو أي حاجة فشلت
    const fallback = crypto.randomBytes(8).toString('hex').toUpperCase();
    return 'SOLO-FB-' + fallback;
  }
}

// Cache the HW ID (مش هيتغير طول وقت التشغيل)
const HARDWARE_ID = generateHardwareId();

// ── IPC Handler ─────────────────────────────────────────────────────────────
ipcMain.handle('get-hardware-id', () => HARDWARE_ID);

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
  createWindow();
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
  dialog.showMessageBox({ type: 'info', title: 'فحص التحديثات 🔍', message: 'السيستم بيبحث عن تحديثات...' });
});

autoUpdater.on('update-available', (info) => {
  const version      = info.version || 'الجديد';
  const releaseNotes = info.releaseNotes
    ? info.releaseNotes.replace(/<[^>]*>?/gm, '')
    : 'تحسينات جديدة وإصلاح أخطاء سابقة.';
  dialog.showMessageBox({
    type: 'info', title: 'تحديث جديد متاح 🚀',
    message: `إصدار ${version}\n\n${releaseNotes}\n\nهل تريد تحميل التحديث؟`,
    buttons: ['نعم، قم بالتحميل', 'لاحقاً'], defaultId: 0, cancelId: 1,
  }).then((result) => {
    if (result.response === 0) {
      autoUpdater.downloadUpdate();
      dialog.showMessageBox({ type: 'info', title: 'جاري التحميل... ⏳', message: 'التحديث يتحمل في الخلفية.', buttons: ['حسناً'] });
    }
  });
});

autoUpdater.on('update-not-available', (info) => {
  dialog.showMessageBox({ type: 'info', title: 'النتيجة ✅', message: `البرنامج محدث. النسخة الحالية: ${info.version}` });
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