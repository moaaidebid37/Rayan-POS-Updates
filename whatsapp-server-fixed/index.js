'use strict';
/**
 * Solo POS — Standalone OTP Service
 * Cloud Edition — Render.com Ready ✅
 * ══════════════════════════════════════════
 */
const admin   = require('firebase-admin');
const { Client, LocalAuth, RemoteAuth } = require('whatsapp-web.js');
const path    = require('path');
const http    = require('http');

// ══════════════════════════════════════════════════════════════
// 1. Firebase Admin Initialization
//    — بيشتغل من ENV على Render، ومن الفايل locally
// ══════════════════════════════════════════════════════════════
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  // ✅ على Render: من Environment Variable
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log('✅ Firebase credentials loaded from ENV');
  } catch (e) {
    console.error('❌ FIREBASE_SERVICE_ACCOUNT env var is not valid JSON:', e.message);
    process.exit(1);
  }
} else {
  // ✅ محلياً: من الفايل
  try {
    serviceAccount = require('./serviceAccountKey.json');
    console.log('✅ Firebase credentials loaded from serviceAccountKey.json');
  } catch (e) {
    console.error('❌ serviceAccountKey.json not found and FIREBASE_SERVICE_ACCOUNT env not set.');
    process.exit(1);
  }
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();
console.log('✅ Firebase Admin connected\n');

// ══════════════════════════════════════════════════════════════
// 2. WhatsApp Client — Optimized for Render.com
// ══════════════════════════════════════════════════════════════
const sessionPath = process.env.SESSION_PATH || path.join(__dirname, '.wwebjs_auth');

const waClient = new Client({
  authStrategy: new LocalAuth({
    dataPath: sessionPath,
  }),
  puppeteer: {
    headless: true,
    // Render بيحط Chrome في PATH تلقائياً
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
    ],
  },
});

// QR Code — رابط صورة بدل الرسم المشوه
waClient.on('qr', (qr) => {
  console.log('\n═══════════════════════════════════════════');
  console.log('  📱  Solo POS — جاهز لربط الواتساب  ');
  console.log('═══════════════════════════════════════════\n');
  const qrImageUrl = `https://quickchart.io/qr?size=400&text=${encodeURIComponent(qr)}`;
  console.log('🔗 افتح الرابط ده عشان تمسح الكود:');
  console.log(qrImageUrl);
  console.log('\n⏳ الرابط بيتحدث كل 20 ثانية...\n');
});

waClient.on('loading_screen', (percent, message) => {
  console.log(`⏳ تحميل WhatsApp: ${percent}% — ${message}`);
});

waClient.on('authenticated', () => {
  console.log('🔐 WhatsApp — تم تسجيل الدخول بنجاح');
});

waClient.on('auth_failure', (msg) => {
  console.error('❌ فشل تسجيل الدخول:', msg);
  console.log('🔄 جاري إعادة التشغيل...');
  setTimeout(() => waClient.initialize(), 5000);
});

waClient.on('ready', () => {
  console.log('✅ WhatsApp متصل وشغال 100%\n');
  _listenForOTPs();
});

waClient.on('disconnected', (reason) => {
  console.error('⚠️ الواتساب انقطع:', reason);
  console.log('🔄 إعادة الاتصال بعد 10 ثواني...');
  setTimeout(() => waClient.initialize(), 10000);
});

// ══════════════════════════════════════════════════════════════
// 3. Firestore OTP Logic
// ══════════════════════════════════════════════════════════════
function _listenForOTPs() {
  console.log('👂 مستني طلبات OTP من Firestore...\n');

  db.collection('pending_otps')
    .where('status', '==', 'pending')
    .onSnapshot(async (snap) => {
      for (const change of snap.docChanges()) {
        if (change.type !== 'added') continue;
        const docRef = change.doc.ref;
        const data   = change.doc.data();
        const phone  = data.phone;
        const code   = data.code;

        // تجاهل لو الكود منتهي
        if (data.expiresAt && new Date(data.expiresAt) < new Date()) {
          console.log(`⏰ كود منتهي للرقم ${phone} — تم التجاهل`);
          await docRef.update({ status: 'expired' }).catch(() => {});
          continue;
        }

        console.log(`📨 جاري إرسال كود ${code} إلى ${phone}...`);
        try {
          await docRef.update({ status: 'sending' });

          const waNumber = phone.replace('+', '') + '@c.us';
          const message  = [
            `مرحباً بك في Solo POS 👋`,
            ``,
            `كود التفعيل الخاص بك هو:`,
            `*${code}*`,
            ``,
            `🔒 لا تشارك هذا الكود مع أحد.`,
          ].join('\n');

          await waClient.sendMessage(waNumber, message);
          console.log(`✅ تم الإرسال بنجاح للرقم ${phone}`);
          await docRef.delete();
          console.log(`🗑️ تم مسح الطلب من Firestore`);
        } catch (err) {
          console.error(`❌ فشل الإرسال لـ ${phone}:`, err.message);
          await docRef.update({ status: 'error', errorMsg: err.message }).catch(() => {});
        }
      }
    }, (err) => {
      // لو انقطع الاتصال بـ Firestore
      console.error('❌ Firestore listener error:', err.message);
      setTimeout(_listenForOTPs, 5000);
    });
}

// ══════════════════════════════════════════════════════════════
// 4. Health Check Web Server — مطلوب عشان Render ميزعلش
// ══════════════════════════════════════════════════════════════
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  const isReady = waClient.info ? true : false;
  const status  = {
    status:   isReady ? 'connected' : 'connecting',
    whatsapp: isReady ? '✅ متصل' : '⏳ جاري الاتصال...',
    uptime:   Math.floor(process.uptime()) + 's',
  };
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(status, null, 2));
}).listen(port, () => {
  console.log(`🌐 Health check server running on port ${port}`);
});

// ══════════════════════════════════════════════════════════════
// Start
// ══════════════════════════════════════════════════════════════
console.log('🚀 جاري تشغيل بوت الواتساب...');
waClient.initialize();
