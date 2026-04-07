


// --- Blocking Initialization Promise ---
// This strategy uses the Firebase Compat libraries, which provide a familiar global `firebase` object.
// This avoids module loading issues between different scripts.
if (!window.firestoreReady) {
    console.log("🔥 Initializing Firebase (Compat Mode)...");
    window.firestoreReady = new Promise((resolve, reject) => {
        // This relies on the firebase-app-compat.js and firebase-firestore-compat.js
        // scripts being loaded in the HTML before this script.
        if (!window.firebase || !window.firebase.initializeApp) {
            console.error("❌ Firebase Compat SDK not found. Please load it in your HTML.");
            return reject("Firebase Compat SDK not found.");
        }

        try {
            // Initialize app only if it's not already initialized
            if (!firebase.apps.length) {
                firebase.initializeApp(window.firebaseConfig);
            }

            const db = firebase.firestore();

            if (db && typeof db === 'object') {
                console.log("✅ Firebase Initialized and DB instance is valid (Compat Mode).");
                resolve(db);
            } else {
                console.error("❌ Firestore DB initialization returned an invalid instance.");
                reject(new Error("Firestore DB initialization failed."));
            }
        } catch (error) {
            console.error("❌ Firebase initialization failed:", error);
            reject(error);
        }
    });
} else {
    console.log("✅ Firebase (Compat Mode) already initializing.");
}


// ============================================================
// 🔒 Multi-Tenancy Helpers
// ============================================================

/**
 * يجيب uid المطعم الحالي من Firebase Auth أو من localStorage كـ fallback.
 * كل عمليات الكتابة والقراءة محتاجة اليوزر ده عشان عزل بيانات كل مطعم.
 */
function _getCurrentUid() {
    try {
        const uid = window.firebase?.auth?.()?.currentUser?.uid;
        if (uid) return uid;
    } catch (_) {}
    // fallback: الـ UID اللي حفظه subscription-manager عند تسجيل الدخول
    return localStorage.getItem('userId') || localStorage.getItem('_saasUid') || null;
}

/**
 * الـ collections اللي بياناتها خاصة بكل مطعم (مش مشتركة بين المطاعم).
 * أي collection مش موجودة هنا (زي licenses و subscriptions) بتبقى global.
 */
const TENANT_COLLECTIONS = new Set([
    'categories', 'menuItems', 'orders', 'expenses', 'expensesHistory',
    'ingredients', 'employees', 'suppliers', 'customers', 'shifts',
    'salesHistory', 'aggregators', 'attendance', 'daily_log',
    'performance', 'performance_snapshots', 'notifications', 'users',
    'settings', 'tables'
]);

// ============================================================
// 🔥 Generic `set` function
// ============================================================
async function set(collectionName, id, data) {
    const db = await window.firestoreReady;
    try {
        // 🔒 ختم restaurantId تلقائياً على كل document خاص بمطعم
        let enrichedData = data;
        if (TENANT_COLLECTIONS.has(collectionName)) {
            const uid = _getCurrentUid();
            if (uid) {
                enrichedData = { restaurantId: uid, ...data };
            }
        }
        const cleanData = JSON.parse(JSON.stringify(enrichedData));
        const ref = db.collection(collectionName).doc(id);
        await ref.set(cleanData, { merge: true });
        return { id, ...cleanData };
    } catch (e) {
        console.error(`Error in set for ${collectionName} with id ${id}:`, e);
        throw e;
    }
}

async function getCollection(collectionName) {
    const localKey = collectionName;

    // 1. Instant Offline Return
    if (!navigator.onLine) {
        console.log(`💤 Offline: Returning ${localKey} from local storage instantly.`);
        return JSON.parse(localStorage.getItem(localKey) || '[]');
    }

    try {
        const db = await window.firestoreReady;
        // 🔒 فلترة بيانات المطعم الحالي فقط
        let query = db.collection(collectionName);
        if (TENANT_COLLECTIONS.has(collectionName)) {
            const uid = _getCurrentUid();
            if (uid) query = query.where('restaurantId', '==', uid);
        }
        const snap = await query.get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (error) {
        // 2. Fallback if Firebase is unreachable
        console.warn(`⚠️ Firebase fetch failed for ${localKey}, falling back to local storage.`, error);
        return JSON.parse(localStorage.getItem(localKey) || '[]');
    }
}

// ============================================================
// 🔥 Generic CRUD Functions
// ============================================================
async function addDocument(collectionName, data) {
    const id = data.id || `${collectionName}_${Date.now()}`;
    return await set(collectionName, id, data);
}

async function updateDocument(collectionName, id, data) {
    return await set(collectionName, id, data);
}

async function deleteDocument(collectionName, id) {
    const db = await window.firestoreReady;
    await db.collection(collectionName).doc(id).delete();
    return true;
}

// ============================================================
// 🔥 Menu Item Functions
// ============================================================
async function getAllMenuItems() {
    const localKey = 'menuItems';
    
    // 1. Instant Offline Return
    if (!navigator.onLine) {
        console.log(`💤 Offline: Returning ${localKey} from local storage instantly.`);
        return JSON.parse(localStorage.getItem(localKey) || '[]');
    }
    
    try {
        const db = await window.firestoreReady;
        const snap = await db.collection("menuItems").get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (error) {
        // 2. Fallback if Firebase is unreachable
        console.warn(`⚠️ Firebase fetch failed for ${localKey}, falling back to local storage.`, error);
        return JSON.parse(localStorage.getItem(localKey) || '[]');
    }
}

async function addMenuItem(item) {
    const id = item.id || `menu_${Date.now()}`;
    return await set('menuItems', id, item);
}

async function updateMenuItem(id, data) {
    return await set('menuItems', id, data);
}

async function deleteMenuItem(id) {
    const db = await window.firestoreReady;
    await db.collection("menuItems").doc(id).delete();
    return true;
}

// ============================================================
// 🔥 Category Functions
// ============================================================
async function getAllCategories() {
    const localKey = 'categories';
    
    // 1. Instant Offline Return
    if (!navigator.onLine) {
        console.log(`💤 Offline: Returning ${localKey} from local storage instantly.`);
        return JSON.parse(localStorage.getItem(localKey) || '[]');
    }
    
    try {
        const db = await window.firestoreReady;
        const snap = await db.collection("categories").get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (error) {
        // 2. Fallback if Firebase is unreachable
        console.warn(`⚠️ Firebase fetch failed for ${localKey}, falling back to local storage.`, error);
        return JSON.parse(localStorage.getItem(localKey) || '[]');
    }
}

async function addCategory(cat) {
    const id = cat.id || `cat_${Date.now()}`;
    return await set('categories', id, cat);
}

async function updateCategory(id, data) {
    return await set('categories', id, data);
}

async function deleteCategory(id) {
    const db = await window.firestoreReady;
    await db.collection("categories").doc(id).delete();
    return true;
}

// ============================================================
// 🔥 Order Functions
// ============================================================
async function addOrder(order) {
    const id = order.id || `ord_${Date.now()}`;
    if (String(id).startsWith('SALE-')) {
        console.warn(`⚠️ Blocked attempt to save SALE ${id} to orders collection. Redirecting to salesHistory.`);
        return await set('salesHistory', id, order);
    }
    return await set('orders', id, order);
}

async function updateOrder(id, data) {
    return await set('orders', id, data);
}

async function deleteOrder(id) {
    const db = await window.firestoreReady;
    await db.collection("orders").doc(id).delete();
    return true;
}

async function getAllOrders() {
    const localKey = 'orders';
    
    // 1. Instant Offline Return
    if (!navigator.onLine) {
        console.log(`💤 Offline: Returning ${localKey} from local storage instantly.`);
        return JSON.parse(localStorage.getItem(localKey) || '[]');
    }
    
    try {
        const db = await window.firestoreReady;
        const snap = await db.collection("orders").get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (error) {
        // 2. Fallback if Firebase is unreachable
        console.warn(`⚠️ Firebase fetch failed for ${localKey}, falling back to local storage.`, error);
        return JSON.parse(localStorage.getItem(localKey) || '[]');
    }
}

async function getOrdersByShift(shiftId) {
    if (!shiftId) return [];
    const db = await window.firestoreReady;
    const uid = _getCurrentUid();
    let q = db.collection("orders").where("shift_id", "==", shiftId);
    if (uid) q = q.where("restaurantId", "==", uid);
    const snap = await q.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ============================================================
// 🔥 Expense Functions
// ============================================================
async function addExpense(exp) {
    const id = exp.id || `exp_${Date.now()}`;
    return await set('expenses', id, exp);
}

async function updateExpense(id, data) {
    return await set('expenses', id, data);
}

async function deleteExpense(id) {
    const db = await window.firestoreReady;
    await db.collection("expenses").doc(id).delete();
    return true;
}

async function getAllExpenses() {
    const localKey = 'expenses';
    
    // 1. Instant Offline Return
    if (!navigator.onLine) {
        console.log(`💤 Offline: Returning ${localKey} from local storage instantly.`);
        return JSON.parse(localStorage.getItem(localKey) || '[]');
    }
    
    try {
        const db = await window.firestoreReady;
        const snap = await db.collection("expenses").get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (error) {
        // 2. Fallback if Firebase is unreachable
        console.warn(`⚠️ Firebase fetch failed for ${localKey}, falling back to local storage.`, error);
        return JSON.parse(localStorage.getItem(localKey) || '[]');
    }
}

async function getExpensesByShift(shiftId) {
    if (!shiftId) return [];
    const db = await window.firestoreReady;
    const uid = _getCurrentUid();
    let q = db.collection("expenses").where("shift_id", "==", shiftId);
    if (uid) q = q.where("restaurantId", "==", uid);
    const snap = await q.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ============================================================
// 🔥 Expenses History Functions
// ============================================================
async function addExpenseHistory(exp) {
    const id = exp.id || `exp_hist_${Date.now()}`;
    return await set('expensesHistory', id, exp);
}

async function updateExpenseHistory(id, data) {
    return await set('expensesHistory', id, data);
}

async function deleteExpenseHistory(id) {
    const db = await window.firestoreReady;
    await db.collection("expensesHistory").doc(id).delete();
    return true;
}

async function getAllExpensesHistory() {
    const localKey = 'expensesHistory';
    
    // 1. Instant Offline Return
    if (!navigator.onLine) {
        console.log(`💤 Offline: Returning ${localKey} from local storage instantly.`);
        return JSON.parse(localStorage.getItem(localKey) || '[]');
    }
    
    try {
        const db = await window.firestoreReady;
        const snap = await db.collection("expensesHistory").get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (error) {
        // 2. Fallback if Firebase is unreachable
        console.warn(`⚠️ Firebase fetch failed for ${localKey}, falling back to local storage.`, error);
        return JSON.parse(localStorage.getItem(localKey) || '[]');
    }
}


// ============================================================
// 🔥 Ingredient Functions
// ============================================================
async function getAllIngredients() {
    const localKey = 'ingredients';
    
    // 1. Instant Offline Return
    if (!navigator.onLine) {
        console.log(`💤 Offline: Returning ${localKey} from local storage instantly.`);
        return JSON.parse(localStorage.getItem(localKey) || '[]');
    }
    
    try {
        const db = await window.firestoreReady;
        const snap = await db.collection("ingredients").get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (error) {
        // 2. Fallback if Firebase is unreachable
        console.warn(`⚠️ Firebase fetch failed for ${localKey}, falling back to local storage.`, error);
        return JSON.parse(localStorage.getItem(localKey) || '[]');
    }
}

async function updateIngredient(id, data) {
    return await set('ingredients', id, data);
}

async function deleteIngredient(id) {
    const db = await window.firestoreReady;
    await db.collection("ingredients").doc(id).delete();
    return true;
}

async function updateStock(id, qty) { return true; } // Placeholder

// ============================================================
// 🔥 Notification Functions
// ============================================================

async function getAllNotifications() {
    const localKey = 'notifications';
    
    // 1. Instant Offline Return
    if (!navigator.onLine) {
        console.log(`💤 Offline: Returning ${localKey} from local storage instantly.`);
        return JSON.parse(localStorage.getItem(localKey) || '[]');
    }
    
    try {
        const db = await window.firestoreReady;
        const snap = await db.collection("notifications").get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (error) {
        // 2. Fallback if Firebase is unreachable
        console.warn(`⚠️ Firebase fetch failed for ${localKey}, falling back to local storage.`, error);
        return JSON.parse(localStorage.getItem(localKey) || '[]');
    }
}

async function updateNotificationsCollection(item, type) { return true; } // Placeholder

// ============================================================
// 🔥 User, Employee & Supplier Functions
// ============================================================
async function getAllUsers() {
    const localKey = 'users';
    
    // 1. Instant Offline Return
    if (!navigator.onLine) {
        console.log(`💤 Offline: Returning ${localKey} from local storage instantly.`);
        return JSON.parse(localStorage.getItem(localKey) || '[]');
    }
    
    try {
        const db = await window.firestoreReady;
        const snap = await db.collection("users").get();
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (error) {
        // 2. Fallback if Firebase is unreachable
        console.warn(`⚠️ Firebase fetch failed for ${localKey}, falling back to local storage.`, error);
        return JSON.parse(localStorage.getItem(localKey) || '[]');
    }
}

async function addUser({ name, pin, role, permissions, displayName, username }) {
    const db = await window.firestoreReady;
    if (!name || !pin || !role) {
        throw new Error("Name, PIN, and role are required");
    }
    const uid = _getCurrentUid();
    // 🔒 فحص تكرار الـ PIN داخل نفس المطعم فقط
    let pinQuery = db.collection("users").where("pin", "==", String(pin));
    if (uid) pinQuery = pinQuery.where("restaurantId", "==", uid);
    const existing = await pinQuery.get();
    if (!existing.empty) {
        throw new Error("هذا الـ PIN مستخدم بالفعل");
    }
    const resolvedName = String(displayName || name);
    const ref = await db.collection("users").add({
        name: resolvedName,
        displayName: resolvedName,
        username: String(username || name),
        pin: String(pin),
        role: role === "admin" || role === "owner" ? "admin" : "cashier",
        // 👈 حفظ مصفوفة الصلاحيات المخصصة (فارغة إذا مش محدد)
        permissions: Array.isArray(permissions) ? permissions : [],
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        active: true,
        // 🔒 ربط المستخدم بالمطعم
        ...(uid ? { restaurantId: uid } : {}),
    });
    // Get the created document
    const userDocSnap = await ref.get();
    return { id: ref.id, ...userDocSnap.data() };
}

async function updateUser(userId, data) {
    return await set('users', userId, data);
}

async function updateUserPin(userId, newPin) {
    const db = await window.firestoreReady;
    if (!userId || !newPin) {
        throw new Error("User ID and PIN are required");
    }
    // 🔒 فحص تكرار الـ PIN داخل نفس المطعم فقط
    const uid = _getCurrentUid();
    let pinCheckQuery = db.collection("users").where("pin", "==", String(newPin));
    if (uid) pinCheckQuery = pinCheckQuery.where("restaurantId", "==", uid);
    const existing = await pinCheckQuery.get();
    const pinTaken = existing.docs.some(d => d.id !== userId);
    if (pinTaken) {
        throw new Error("هذا الـ PIN مستخدم بالفعل");
    }
    const userRef = db.collection("users").doc(userId);
    await userRef.update({
        pin: String(newPin),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    // Get updated document
    const userDocSnap = await userRef.get();
    return { id: userId, ...userDocSnap.data() };
}

async function updateUserRole(userId, role) {
    if (!userId || !role) {
        throw new Error("User ID and role are required");
    }
    const userRef = db.collection("users").doc(userId);
    await userRef.update({
        role: role === "admin" || role === "owner" ? "admin" : "cashier",
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    // Get updated document
    const userDocSnap = await userRef.get();
    return { id: userId, ...userDocSnap.data() };
}

async function deleteUser(userId) {
    const db = await window.firestoreReady;
    const userRef = db.collection("users").doc(userId);
    await userRef.delete();
    return true;
}


async function getAllEmployees() {
    const localKey = 'employees';
    
    // 1. Instant Offline Return
    if (!navigator.onLine) {
        console.log(`💤 Offline: Returning ${localKey} from local storage instantly.`);
        return JSON.parse(localStorage.getItem(localKey) || '[]');
    }
    
    try {
        const db = await window.firestoreReady;
        const snap = await db.collection("employees").get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (error) {
        // 2. Fallback if Firebase is unreachable
        console.warn(`⚠️ Firebase fetch failed for ${localKey}, falling back to local storage.`, error);
        return JSON.parse(localStorage.getItem(localKey) || '[]');
    }
}

async function getAllSuppliers() {
    const localKey = 'suppliers';
    
    // 1. Instant Offline Return
    if (!navigator.onLine) {
        console.log(`💤 Offline: Returning ${localKey} from local storage instantly.`);
        return JSON.parse(localStorage.getItem(localKey) || '[]');
    }
    
    try {
        const db = await window.firestoreReady;
        const snap = await db.collection("suppliers").get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (error) {
        // 2. Fallback if Firebase is unreachable
        console.warn(`⚠️ Firebase fetch failed for ${localKey}, falling back to local storage.`, error);
        return JSON.parse(localStorage.getItem(localKey) || '[]');
    }
}

// ====== دوال الموردين (Suppliers) ======
async function addSupplier(supplier) {
    return await set('suppliers', supplier.id, supplier);
}
async function updateSupplier(id, supplier) {
    return await set('suppliers', id, supplier);
}
async function deleteSupplier(id) {
    const db = await window.firestoreReady;
    try {
        await db.collection('suppliers').doc(id).delete();
        return true;
    } catch (e) {
        console.error("Error deleting supplier:", e);
        throw e;
    }
}

// للموظفين (Employees)
async function addEmployee(data) {
    return await set('employees', data.id, data);
}
async function updateEmployee(id, data) {
    return await set('employees', id, data);
}
async function deleteEmployee(id) {
    const db = await window.firestoreReady;
    try {
        await db.collection('employees').doc(id).delete();
        return true;
    } catch (e) {
        console.error("Error deleting employee:", e);
        throw e;
    }
}
 

// ============================================================
// 🔥 Settings Functions
// ============================================================
async function getSettings() {
    const localKey = 'settings';
    
    // 1. Instant Offline Return
    if (!navigator.onLine) {
        console.log(`💤 Offline: Returning ${localKey} from local storage instantly.`);
        return JSON.parse(localStorage.getItem(localKey) || '{}');
    }

    try {
        const db = await window.firestoreReady;
        const settingsRef = db.collection("settings").doc("main");
        const docSnap = await settingsRef.get();
        if (docSnap.exists) {
            return docSnap.data();
        } else {
            await set('settings', 'main', {});
            return {};
        }
    } catch (error) {
        console.warn(`⚠️ Firebase fetch failed for ${localKey}, falling back to local storage.`, error);
        return JSON.parse(localStorage.getItem(localKey) || '{}');
    }
}

async function updateSettings(data) {
    // 🔒 كل مطعم له document إعداداته الخاصة (uid كـ key)
    const uid = _getCurrentUid();
    return await set('settings', uid || 'main', data);
}



// ============================================================
// 🔥 License, Shift & PIN Functions
// ============================================================
async function markValidLicenseCodeUsed(code, hardwareId) {
    const db = await window.firestoreReady;
    try {
        const licenseRef = db.collection("licenses").doc(code);
        await db.runTransaction(async (transaction) => {
            const sfDoc = await transaction.get(licenseRef);
            if (!sfDoc.exists) throw "الكود غير موجود";
            const data = sfDoc.data();
            if (data.status === 'used' && data.hardwareId !== hardwareId) throw "الكود مستخدم";
            transaction.update(licenseRef, {
                status: 'used',
                hardwareId: hardwareId,
                activatedAt: new Date().toISOString()
            });
        });
        return { success: true };
    } catch (e) {
        return { success: false, message: e.toString() };
    }
}

async function startShift(shift) { return true; }
async function endShift(id, data) { return true; }
async function updateShift(id, data) { return true; }
async function getCurrentShift() { return null; }

async function getShifts() {
    const localKey = 'cashSessions'; // Note: Mapped to 'cashSessions' in localStorage
    
    // 1. Instant Offline Return
    if (!navigator.onLine) {
        console.log(`💤 Offline: Returning ${localKey} from local storage instantly.`);
        return JSON.parse(localStorage.getItem(localKey) || '[]');
    }
    
    try {
        const db = await window.firestoreReady;
        const snap = await db.collection("shifts").get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (error) {
        // 2. Fallback if Firebase is unreachable
        console.warn(`⚠️ Firebase fetch failed for shifts, falling back to local storage (${localKey}).`, error);
        return JSON.parse(localStorage.getItem(localKey) || '[]');
    }
}

async function verifyPin(pin) {
    const db = await window.firestoreReady;
    try {
        const pinString = String(pin).trim();
        const uid = _getCurrentUid();
        // 🔒 البحث عن الـ PIN داخل موظفي نفس المطعم فقط
        let q = db.collection("users").where("pin", "==", pinString).where("active", "==", true);
        if (uid) q = q.where("restaurantId", "==", uid);
        let snap = await q.get();

        // 🔄 Fallback للبيانات القديمة اللي مالهاش restaurantId بعد
        // (يحصل مع أول تسجيل دخول بعد تفعيل نظام المالتي تينانسي)
        if (snap.empty && uid) {
            const fallbackSnap = await db.collection("users")
                .where("pin", "==", pinString)
                .where("active", "==", true)
                .get();
            if (!fallbackSnap.empty) {
                snap = fallbackSnap;
                // Migrate: ختّم restaurantId على الـ docs القديمة بشكل صامت
                fallbackSnap.docs.forEach(doc => {
                    if (!doc.data().restaurantId) {
                        doc.ref.update({ restaurantId: uid }).catch(() => {});
                    }
                });
            }
        }

        if (snap.empty) return null;

        const user = { id: snap.docs[0].id, ...snap.docs[0].data() };

        if (window.PinCrypto && typeof window.PinCrypto.storePin === 'function') {
            window.PinCrypto.storePin(pinString);
        }
        return user;
    } catch (e) {
        console.error("Login Error:", e);
        return null;
    }
}

// ============================================================
// 🔥 Attendance & Daily Log Functions
// ============================================================
async function upsertAttendance(data) {
    const id = data.id || `att_${Date.now()}`;
    return await set('attendance', id, data);
}

async function setDailyLogRow(id, data) {
    return await set('daily_log', id, data);
}

// ============================================================
// 🔥 `clearCollection` Function
// ============================================================
async function clearCollection(collectionName) {
    const db = await window.firestoreReady;
    // 🔒 مسح بيانات المطعم الحالي فقط (مش كل المطاعم!)
    let query = db.collection(collectionName);
    if (TENANT_COLLECTIONS.has(collectionName)) {
        const uid = _getCurrentUid();
        if (uid) query = query.where('restaurantId', '==', uid);
    }
    const snapshot = await query.get();
    const batch = db.batch();
    snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
    });
    await batch.commit();
    console.log(`✅ Collection '${collectionName}' cleared for restaurantId: ${_getCurrentUid() || 'all'}.`);
    return true;
}


// ============================================================
// 🔥 Batch Write Function
// ============================================================
async function batchWrite(operations) {
    const db = await window.firestoreReady;
    const batch = db.batch();
    operations.forEach(op => {
        // op is expected to be { collection: string, id: string, data: object }
        const docRef = db.collection(op.collection).doc(op.id);
        const cleanData = JSON.parse(JSON.stringify(op.data));
        batch.set(docRef, cleanData, { merge: true });
    });
    return await batch.commit();
}


// ============================================================
// 🔥 Notification Listener (Real-time)
// ============================================================
async function listenToNotifications(callback) {
    if (!navigator.onLine) return;
    try {
        const db = await window.firestoreReady;
        // 🔒 كل مطعم يسمع إشعاراته بس
        const uid = _getCurrentUid();
        let query = db.collection("notifications");
        if (uid) query = query.where("restaurantId", "==", uid);
        query.onSnapshot(snap => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            localStorage.setItem('notifications', JSON.stringify(data));
            if (typeof callback === 'function') callback(data);
        }, error => {
            console.warn("⚠️ Listener error:", error);
        });
    } catch (e) {
        console.error("Listener failed:", e);
    }
}

// ============================================================
// ============================================================
// 👥 Customers Functions (دوال العملاء)
// ============================================================
async function getAllCustomers() {
    return await getCollection("customers");
}

async function saveCustomer(customerData) {
    if (!customerData.phone) throw new Error("رقم الهاتف مطلوب");
    const uid = _getCurrentUid();
    const docId = uid ? `${uid}_${customerData.phone}` : customerData.phone;
    const dataToSave = { ...customerData, updatedAt: new Date().toISOString() };
    if (uid) dataToSave.restaurantId = uid;
    // حدّث localStorage بنفس الـ object عشان getCustomerByPhone يلقاه فوراً
    try {
        const local = JSON.parse(localStorage.getItem('customers') || '[]');
        const idx = local.findIndex(c => c.phone === customerData.phone);
        if (idx >= 0) local[idx] = { ...local[idx], ...dataToSave };
        else local.push({ ...dataToSave, id: docId });
        localStorage.setItem('customers', JSON.stringify(local));
    } catch(_) {}
    return await set('customers', docId, dataToSave);
}

async function getCustomerByPhone(phone) {
    // 1. ابحث في localStorage أولاً (أسرع + يشتغل أوفلاين)
    try {
        const local = JSON.parse(localStorage.getItem('customers') || '[]');
        const localMatch = local.find(c => c.phone === phone || c.phone === phone.replace(/^0/, '+2'));
        if (localMatch) return localMatch;
    } catch(_) {}

    // 2. بحث في Firestore
    try {
        const db = await window.firestoreReady;
        const uid = _getCurrentUid();
        if (uid) {
            // جرّب الـ composite key
            const docId = `${uid}_${phone}`;
            const doc = await db.collection("customers").doc(docId).get();
            if (doc.exists) return { id: doc.id, ...doc.data() };
            // query مع restaurantId
            const q1 = await db.collection("customers")
                .where("phone", "==", phone)
                .where("restaurantId", "==", uid)
                .limit(1).get();
            if (!q1.empty) return { id: q1.docs[0].id, ...q1.docs[0].data() };
            // fallback: بدون restaurantId (بيانات قديمة)
            const q2 = await db.collection("customers")
                .where("phone", "==", phone)
                .limit(1).get();
            if (!q2.empty) {
                // حدّث restaurantId في الخلفية
                q2.docs[0].ref.update({ restaurantId: uid }).catch(() => {});
                return { id: q2.docs[0].id, ...q2.docs[0].data() };
            }
            return null;
        }
        const doc = await db.collection("customers").doc(phone).get();
        return doc.exists ? { id: doc.id, ...doc.data() } : null;
    } catch(e) { return null; }
}

async function deleteCustomer(phone) {
    const uid = _getCurrentUid();
    const docId = uid ? `${uid}_${phone}` : phone;
    return await deleteDocument("customers", docId);
}

// ============================================================
// 🚀🚀 المحرك الصاروخي الشامل (Offline-First Turbo Engine) 🚀🚀
// الكود ده هيعمل تخطي (Override) لكل الدوال البطيئة ويسرع السيستم 100%
// ============================================================

// 1. دالة الجلب الذكية (بتقرا من الكاش في 0 ثانية وتحدث في الخلفية)
window.getCollectionWithCache = async function(collectionName, localKey) {
    localKey = localKey || collectionName;
    const cachedData = localStorage.getItem(localKey);
    const hasCache = cachedData && cachedData !== '[]' && cachedData !== '{}' && cachedData !== 'null';

    const fetchFromServer = async () => {
        if (!navigator.onLine) return null;
        try {
            const db = await window.firestoreReady;
            // 🔒 فلترة: كل مطعم يشوف بياناته بس
            let query = db.collection(collectionName);
            if (TENANT_COLLECTIONS.has(collectionName)) {
                const uid = _getCurrentUid();
                // 🛡️ لو مفيش uid، مش بنجري query محمية (تمنع مسح الكاش بنتيجة فاضية)
                if (!uid) return null;
                query = query.where('restaurantId', '==', uid);
            }
            const snap = await query.get();
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            // 🛡️ بنحفظ في localStorage فقط لو البيانات فيها حاجة (منع مسح الكاش بـ [])
            if (data.length > 0) {
                localStorage.setItem(localKey, JSON.stringify(data));
            }
            return data;
        } catch (error) { return null; }
    };

    if (hasCache) {
        fetchFromServer(); // تحديث صامت في الخلفية
        return JSON.parse(cachedData); // عرض فوري للكاشير
    } else {
        const data = await fetchFromServer();
        return data || [];
    }
};

// 2. توجيه كل دوال الجلب في السيستم للمحرك السريع
getAllMenuItems = async () => await window.getCollectionWithCache('menuItems');
getAllCategories = async () => await window.getCollectionWithCache('categories');
getAllOrders = async () => await window.getCollectionWithCache('orders');
getAllExpenses = async () => await window.getCollectionWithCache('expenses');
getAllExpensesHistory = async () => await window.getCollectionWithCache('expensesHistory');
getAllIngredients = async () => await window.getCollectionWithCache('ingredients');
getAllUsers = async () => await window.getCollectionWithCache('users');
getAllEmployees = async () => await window.getCollectionWithCache('employees');
getAllSuppliers = async () => await window.getCollectionWithCache('suppliers');
getShifts = async () => await window.getCollectionWithCache('shifts', 'cashSessions');
getAllCustomers = async () => await window.getCollectionWithCache('customers', 'offline_customers');
getCollection = async (col) => await window.getCollectionWithCache(col);

getSettings = async () => {
    const localKey = 'settings';
    const cachedData = localStorage.getItem(localKey);
    const hasCache = cachedData && cachedData !== '{}' && cachedData !== 'null';

    const fetchFromServer = async () => {
        if (!navigator.onLine) return null;
        try {
            const db = await window.firestoreReady;
            // 🔒 إعدادات كل مطعم في document خاص بيه (uid كـ key)
            // مع fallback لـ 'main' للتوافق مع النسخ القديمة
            const uid = _getCurrentUid();
            let docSnap = uid ? await db.collection("settings").doc(uid).get() : null;
            if (!docSnap || !docSnap.exists) {
                docSnap = await db.collection("settings").doc("main").get();
            }
            const data = (docSnap && docSnap.exists) ? docSnap.data() : {};
            localStorage.setItem(localKey, JSON.stringify(data));
            return data;
        } catch (error) { return null; }
    };

    if (hasCache) { fetchFromServer(); return JSON.parse(cachedData); }
    else { return (await fetchFromServer()) || {}; }
};

// 3. ذكاء المزامنة: تحديث الكاش فوراً مع أي حفظ عشان يظهر للعميل في نفس اللحظة
 const originalSet = set;
 set = async function(collectionName, id, data) {
     const result = await originalSet(collectionName, id, data);

     const localKey = (collectionName === 'customers') ? 'offline_customers' :
                      (collectionName === 'shifts' || collectionName === 'cashSessions') ? 'cashSessions' :
                      collectionName;

     // 🔒 نضيف restaurantId في الكاش المحلي كمان (زي ما بنضيفه في Firestore)
     let dataWithRid = data;
     if (TENANT_COLLECTIONS.has(collectionName)) {
         const uid = _getCurrentUid();
         if (uid) dataWithRid = { restaurantId: uid, ...data };
     }

     // 🔥 التعديل هنا: لو الذاكرة فاضية بيعملها إنشاء بدل ما يتجاهلها
     let cachedStr = localStorage.getItem(localKey) || '[]';
     try {
         let cachedData = JSON.parse(cachedStr);
         if (Array.isArray(cachedData)) {
             const index = cachedData.findIndex(item => item.id === id);
             if (index > -1) cachedData[index] = { ...cachedData[index], ...dataWithRid };
             else cachedData.unshift({ id, ...dataWithRid });
             localStorage.setItem(localKey, JSON.stringify(cachedData));
         } else if (typeof cachedData === 'object') {
             localStorage.setItem(localKey, JSON.stringify({ ...cachedData, ...dataWithRid }));
         }
     } catch(e) {}

     return result;
 }; 
 
 // 🔥 المحرك الصاروخي للشيفتات (عشان الشيفت ميطيرش مع الريفريش) 
 window.startShift = async (shiftData) => await set('shifts', shiftData.id, shiftData); 
 window.updateShift = async (id, data) => await set('shifts', id, data); 
 window.endShift = async (id, data) => await set('shifts', id, data); 
 window.getCurrentShift = async () => { 
     const sessions = await window.getCollectionWithCache('shifts', 'cashSessions'); 
     return sessions.find(s => s.status === 'open') || null; 
 }; 
 startShift = window.startShift; 
 updateShift = window.updateShift; 
 endShift = window.endShift; 
 getCurrentShift = window.getCurrentShift;

// 4. تحديث الكاش فوراً مع أي مسح (Delete)
const originalDelete = deleteDocument;
deleteDocument = async function(collectionName, id) {
    const result = await originalDelete(collectionName, id);
    const localKey = collectionName === 'customers' ? 'offline_customers' :
                     collectionName === 'shifts' ? 'cashSessions' : collectionName;
    const cachedStr = localStorage.getItem(localKey);
    if (cachedStr) {
        try {
            let cachedData = JSON.parse(cachedStr);
            if (Array.isArray(cachedData)) {
                cachedData = cachedData.filter(item => item.id !== id);
                localStorage.setItem(localKey, JSON.stringify(cachedData));
            }
        } catch(e) {}
    }
    return result;
};
// ============================================================

// --- Final Export to Window Object ---
// ============================================================
if (typeof window !== 'undefined') {
    if (typeof window.firebase === 'undefined') {
        console.error("CRITICAL: Cannot expose FirestoreService because window.firebase is not defined. Check script loading order.");
    } else {
        window.FirestoreService = {
            // Core
            set,
            getCollection, // Added generic getCollection
            clearCollection,
            batchWrite,
            addDocument,
            updateDocument,
            deleteDocument,

            // 🌟 العملاء (السطر ده اللي هنضيفه هنا) 
            getAllCustomers, saveCustomer, getCustomerByPhone, deleteCustomer,

            // Menu
            getAllMenuItems, addMenuItem, updateMenuItem, deleteMenuItem,
            // Categories
            getAllCategories, addCategory, updateCategory, deleteCategory,
            // Orders
            getAllOrders, addOrder, updateOrder, deleteOrder, getOrdersByShift,
            // Expenses
            getAllExpenses, addExpense, updateExpense, deleteExpense, getExpensesByShift,
            // Expenses History
            getAllExpensesHistory, addExpenseHistory, updateExpenseHistory, deleteExpenseHistory,
            // Ingredients
            getAllIngredients, updateIngredient, deleteIngredient, updateStock,
            // Notifications
            getAllNotifications, listenToNotifications, updateNotificationsCollection,
            // Users, Employees & Suppliers
            getAllUsers, addUser, updateUser, updateUserPin, updateUserRole, deleteUser,
            getAllEmployees, getAllSuppliers,
            addSupplier, updateSupplier, deleteSupplier,
            addEmployee, updateEmployee, deleteEmployee,
            // Settings
            getSettings, updateSettings,
            // License & Shifts
            markValidLicenseCodeUsed, startShift, endShift, updateShift, getCurrentShift, getShifts, verifyPin,
            // Attendance & Daily Log
            upsertAttendance, setDailyLogRow
        };
        console.log("✅ Firestore Service (V5 - Compat) is exposing its functions.");
    }
}
