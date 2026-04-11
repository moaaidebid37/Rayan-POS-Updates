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

ipcMain.handle('send-otp', async (event, phoneNumber, mode) => {
  let phone = String(phoneNumber).replace(/\D/g, '');
  if (phone.startsWith('0')) phone = phone.slice(1);
  const fullPhone = '+20' + phone;

  // ── فحص وجود الحساب عبر Admin SDK (أدق من client-side) ──────────────────
  const authMode = mode || 'register'; // default to register for backwards compat
  try {
    const db = getAdminDb();
    if (db) {
      const snap = await db.collection('subscriptions')
        .where('phone', '==', fullPhone).limit(1).get();
      const exists = !snap.empty;

      if (authMode === 'login' && !exists) {
        console.log(`🚫 Login attempt for non-existent account: ${fullPhone}`);
        return { success: false, error: 'هذا الرقم غير مسجّل في Solo POS. يرجى إنشاء حساب جديد أولاً.' };
      }
      if (authMode === 'register' && exists) {
        console.log(`🚫 Register attempt for existing account: ${fullPhone}`);
        return { success: false, error: 'هذا الرقم مسجّل بالفعل. سجّل دخولك بدلاً من إنشاء حساب جديد.' };
      }
    }
  } catch (e) {
    console.warn('⚠️ Account check via Admin SDK failed:', e.message);
    // 🔧 لو الفحص فشل — لا تكمل بدون تحقق
    return { success: false, error: 'تعذر التحقق من الرقم. تأكد من اتصالك بالإنترنت وحاول مرة أخرى.' };
  }

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

ipcMain.handle('verify-otp', async (event, phoneNumber, code, mode) => {
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
  const authMode = mode || 'register';
  let uid;
  try {
    uid = (await auth.getUserByPhoneNumber(fullPhone)).uid;
  } catch (e) {
    // لو وضع تسجيل الدخول ومفيش يوزر → خطأ بدل ما نعمل يوزر جديد
    if (authMode === 'login') {
      return { success: false, error: 'الحساب غير موجود. يرجى إنشاء حساب جديد أولاً.' };
    }
    uid = (await auth.createUser({ phoneNumber: fullPhone })).uid;
  }
  const customToken = await auth.createCustomToken(uid);
  return { success: true, customToken, uid, phone: fullPhone };
});

// ══════════════════════════════════════════════════════════════════
// 🗑️ حذف الحساب بالكامل — يمسح كل حاجة من Firebase
// ══════════════════════════════════════════════════════════════════

const TENANT_COLLECTIONS = [
  'categories', 'menuItems', 'orders', 'expenses', 'expensesHistory',
  'ingredients', 'employees', 'suppliers', 'customers', 'shifts',
  'salesHistory', 'aggregators', 'attendance', 'daily_log',
  'performance', 'performance_snapshots', 'notifications', 'users',
  'settings', 'tables'
];

// مسح subcollections جوه document (زي login_events جوه subscriptions)
async function _deleteSubcollections(db, docRef) {
  try {
    const collections = await docRef.listCollections();
    for (const col of collections) {
      const snap = await col.get();
      if (!snap.empty) {
        const batch = db.batch();
        snap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        console.log(`      ✓ subcollection ${col.id}: ${snap.size} docs deleted`);
      }
    }
  } catch (e) { /* مش كل environments بتدعم listCollections */ }
}

async function _deleteCollectionDocs(db, collectionName, uid) {
  let totalDeleted = 0;

  // 1. مسح بالـ restaurantId query (الطريقة الأساسية)
  try {
    const snap = await db.collection(collectionName)
      .where('restaurantId', '==', uid).get();
    if (!snap.empty) {
      const batch = db.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      totalDeleted += snap.size;
    }
  } catch (e) {
    console.warn(`⚠️ Query delete ${collectionName}:`, e.message);
  }

  // 2. مسح بالـ document ID مباشرة (للـ docs القديمة اللي مفيهاش restaurantId)
  try {
    const docRef = db.collection(collectionName).doc(uid);
    const docSnap = await docRef.get();
    if (docSnap.exists) {
      await _deleteSubcollections(db, docRef);
      await docRef.delete();
      totalDeleted += 1;
      console.log(`      ✓ ${collectionName}/${uid} deleted by ID`);
    }
  } catch (e) { /* مش مشكلة */ }

  // 3. مسح بالـ uid field (بعض الـ docs بتخزن uid كـ field)
  try {
    const snap = await db.collection(collectionName)
      .where('uid', '==', uid).get();
    if (!snap.empty) {
      const batch = db.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      totalDeleted += snap.size;
    }
  } catch (e) { /* مش كل الـ collections عندها uid field */ }

  return totalDeleted;
}

ipcMain.handle('delete-account-completely', async (event, uid) => {
  if (!uid) return { success: false, error: 'لم يتم تحديد الحساب' };

  const db = getAdminDb();
  const auth = getAdminAuth();
  if (!db || !auth) return { success: false, error: 'Firebase Admin غير متاح' };

  console.log(`🗑️ Starting complete account deletion for UID: ${uid}`);
  const results = {};

  // 1. مسح كل الـ tenant collections (بيانات المطعم)
  for (const col of TENANT_COLLECTIONS) {
    const count = await _deleteCollectionDocs(db, col, uid);
    if (count > 0) results[col] = count;
    console.log(`   ✓ ${col}: ${count} docs deleted`);
  }

  // 2. مسح document الإعدادات (بالـ ID + بالـ query)
  try {
    const settingsRef = db.collection('settings').doc(uid);
    await _deleteSubcollections(db, settingsRef);
    await settingsRef.delete();
    console.log('   ✓ settings doc deleted');
  } catch (e) { console.warn('   ⚠️ settings doc:', e.message); }

  // مسح أي settings docs تانية فيها restaurantId
  try {
    const setSnap = await db.collection('settings')
      .where('restaurantId', '==', uid).get();
    if (!setSnap.empty) {
      const batch = db.batch();
      setSnap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
  } catch (e) {}

  // 2.5. مسح document المستخدم الرئيسي (users/{uid}) صراحةً
  try {
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    if (userSnap.exists) {
      await _deleteSubcollections(db, userRef);
      await userRef.delete();
      console.log('   ✓ users doc deleted explicitly by ID');
    }
  } catch (e) { console.warn('   ⚠️ users doc:', e.message); }

  // 3. مسح الـ subscription (بكل الطرق الممكنة)
  try {
    // بالـ document ID مباشرة
    const subRef = db.collection('subscriptions').doc(uid);
    await _deleteSubcollections(db, subRef);
    await subRef.delete();
    console.log('   ✓ subscriptions doc deleted by ID');

    // بالـ uid field
    const subSnap = await db.collection('subscriptions')
      .where('uid', '==', uid).get();
    if (!subSnap.empty) {
      for (const doc of subSnap.docs) {
        await _deleteSubcollections(db, doc.ref);
      }
      const batch = db.batch();
      subSnap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      console.log(`   ✓ subscriptions: ${subSnap.size} docs deleted by uid`);
    }

    // بالـ restaurantId
    const subSnap2 = await db.collection('subscriptions')
      .where('restaurantId', '==', uid).get();
    if (!subSnap2.empty) {
      for (const doc of subSnap2.docs) {
        await _deleteSubcollections(db, doc.ref);
      }
      const batch = db.batch();
      subSnap2.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      console.log(`   ✓ subscriptions: ${subSnap2.size} docs deleted by restaurantId`);
    }
  } catch (e) { console.warn('   ⚠️ subscriptions:', e.message); }

  // 4. مسح أي pending OTPs للرقم ده
  try {
    // جيب الرقم من الـ auth user قبل ما نمسحه
    let userPhone = null;
    try {
      const userRecord = await auth.getUser(uid);
      userPhone = userRecord.phoneNumber;
    } catch(e) {}

    if (userPhone) {
      const phoneId = userPhone.replace('+', '').replace(/\s/g, '');
      await db.collection('pending_otps').doc(phoneId).delete();
      console.log(`   ✓ pending_otps for ${userPhone} deleted`);
    }
  } catch (e) { /* مش مشكلة */ }

  // 5. مسح اليوزر من Firebase Authentication
  try {
    await auth.deleteUser(uid);
    console.log('   ✓ Firebase Auth user deleted');
  } catch (e) {
    console.warn('   ⚠️ Firebase Auth user:', e.message);
  }

  console.log(`✅ Account ${uid} deleted completely. Summary:`, results);
  return { success: true, deletedCollections: results };
});

console.log('✅ Phone Auth IPC (WhatsApp OTP + Account Deletion) ready');