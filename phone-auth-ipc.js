// phone-auth-ipc.js
// ══════════════════════════════════════════════════════════════════
// نظام OTP — الإرسال عبر Solo_OTP_Sender Microservice (Firestore)
// أضف في app.js: require('./phone-auth-ipc');
// ══════════════════════════════════════════════════════════════════

// ── Fix: Electron main process مش عنده fetch — نضيفه يدوياً ──────
const nodeFetch = require('node-fetch');
if (!global.fetch)    global.fetch    = nodeFetch;
if (!global.Headers)  global.Headers  = nodeFetch.Headers;
if (!global.Request)  global.Request  = nodeFetch.Request;
if (!global.Response) global.Response = nodeFetch.Response;
if (!global.Blob)     global.Blob     = require('buffer').Blob;
if (!global.FormData) global.FormData = require('form-data');

const { ipcMain } = require('electron');

const otpStore = new Map(); // { phone: { code, expiresAt, attempts } }

let _adminAuth = null;
let _adminDb   = null;
function getAdminAuth() {
  if (_adminAuth) return _adminAuth;
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccountKey.json')) });
    }
    _adminAuth = admin.auth();
    _adminDb   = admin.firestore();
    console.log('✅ Firebase Admin ready');
    return _adminAuth;
  } catch (e) { console.error('❌ Firebase Admin:', e.message); return null; }
}

function getAdminDb() {
  if (_adminDb) return _adminDb;
  getAdminAuth(); // يشغّل الـ init
  return _adminDb;
}

async function _saveOtpToFirestore(fullPhone, code) {
  const db = getAdminDb();
  if (!db) throw new Error('Firebase Admin DB not initialized — check serviceAccountKey.json');
  const docId = fullPhone.replace('+', '').replace(/\s/g, '');
  await db.collection('pending_otps').doc(docId).set({
    phone:     fullPhone,
    code,
    createdAt: new Date().toISOString(),
    status:    'pending',
    expiresAt: new Date(Date.now() + 600000).toISOString(),
  });
}

async function _clearOtpFromFirestore(fullPhone) {
  try {
    const db = getAdminDb();
    if (!db) return;
    const docId = fullPhone.replace('+', '').replace(/\s/g, '');
    await db.collection('pending_otps').doc(docId).delete();
  } catch (e) { /* مش مشكلة */ }
}

ipcMain.handle('send-otp', async (event, phoneNumber) => {
  let phone = String(phoneNumber).replace(/\D/g, '');
  if (phone.startsWith('0')) phone = phone.slice(1);
  const fullPhone = '+20' + phone;
  const code = String(Math.floor(100000 + Math.random() * 900000));
  otpStore.set(fullPhone, { code, expiresAt: Date.now() + 600000, attempts: 0 });
  console.log(`📱 OTP for ${fullPhone}: ${code}`);

  // ─ حفظ في Firestore (await) — الـ Microservice هيبعته عبر واتساب ─────────
  try {
    await _saveOtpToFirestore(fullPhone, code);
    console.log(`✅ OTP saved to Firestore for ${fullPhone}`);
    return { success: true, via: 'firestore' };
  } catch (e) {
    console.error('❌ Failed to save OTP to Firestore:', e.message);
    // الكود لسه موجود في الـ otpStore — رجّع الكود عشان الـ UI يعرضه
    return { success: true, via: 'memory', fallbackCode: code, warning: e.message };
  }
});

ipcMain.handle('verify-otp', async (event, phoneNumber, code) => {
  let phone = String(phoneNumber).replace(/\D/g, '');
  if (phone.startsWith('0')) phone = phone.slice(1);
  const fullPhone = '+20' + phone;
  const stored = otpStore.get(fullPhone);
  if (!stored) return { success: false, error: 'اطلب كود جديد' };
  if (Date.now() > stored.expiresAt) { otpStore.delete(fullPhone); return { success: false, error: 'انتهت صلاحية الكود' }; }
  stored.attempts++;
  if (stored.attempts > 5) { otpStore.delete(fullPhone); return { success: false, error: 'تجاوزت المحاولات' }; }
  if (stored.code !== String(code).trim()) return { success: false, error: `الكود غير صحيح — تبقى ${5 - stored.attempts} محاولة` };
  otpStore.delete(fullPhone);
  _clearOtpFromFirestore(fullPhone); // امسح من Firestore بعد التحقق
  const auth = getAdminAuth();
  if (!auth) return { success: false, error: 'Firebase Admin غير متاح' };
  let uid;
  try { uid = (await auth.getUserByPhoneNumber(fullPhone)).uid; }
  catch (e) { uid = (await auth.createUser({ phoneNumber: fullPhone })).uid; }
  const customToken = await auth.createCustomToken(uid);
  return { success: true, customToken, uid, phone: fullPhone };
});

console.log('✅ Phone Auth IPC (WhatsApp OTP) ready');