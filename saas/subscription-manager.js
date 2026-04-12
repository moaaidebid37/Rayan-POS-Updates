/**
 * Solo POS — SaaS Subscription Manager
 * ======================================
 * يتحكم في كل حاجة: Auth، الباقات، الأوفلاين، وصلاحيات الفيتشرز.
 * 
 * طريقة الاستخدام في أي ملف:
 *   await window.SaaS.init();
 *   window.SaaS.canUse('whatsapp')   → true/false
 *   window.SaaS.getPlan()            → 'trial' | 'basic' | 'pro'
 */

(function () {
  'use strict';

  // ─── ثوابت ─────────────────────────────────────────────────────────────────
  const CACHE_KEY        = 'solo_saas_subscription';
  const HW_KEY           = 'solo_saas_hw_id';
  const OFFLINE_MAX_DAYS = 30;         // أقصى وقت أوفلاين مسموح
  const TRIAL_DAYS       = 30;

   // ─── خريطة الفيتشرز لكل باقة ───────────────────────────────────────────────
   const PLAN_FEATURES = {
     // التريال واخد مميزات البرو (الأساسيات + التقارير والمخزون + الموردين + الموظفين + العملاء)
     trial: ['pos', 'orders', 'kitchen', 'settings', 'kds', 'reports', 'inventory', 'suppliers', 'employees', 'customers'],

     // البيزك (الأساسيات + المطبخ KDS)
     basic: ['pos', 'orders', 'kitchen', 'settings', 'kds'],

     // البرو (البيزك + التقارير والمخزون + الموردين + الموظفين + العملاء)
     pro:   ['pos', 'orders', 'kitchen', 'settings', 'kds', 'reports', 'inventory', 'suppliers', 'employees', 'customers'],

     // الميجا (كل حاجة حرفياً + Solo AI)
     mega:  ['pos', 'orders', 'kitchen', 'settings', 'kds', 'reports', 'inventory',
             'customers', 'marketing', 'suppliers', 'employees', 'aggregators',
             'whatsapp', 'dashboard', 'bulk_messages', 'advanced_reports', 'multi_branch', 'solo_ai'],
   }; 

  const PLAN_LABELS = {
    trial: 'تجربة مجانية — 30 يوم',
    basic: 'Basic — 499 ج/شهر',
    pro:   'Pro — 799 ج/شهر',
    mega:  'Mega — 999 ج/شهر',
  };

  // ─── الحالة الداخلية ────────────────────────────────────────────────────────
  let _state = {
    isReady:       false,
    isLoggedIn:    false,
    uid:           null,
    plan:          null,       // 'trial' | 'basic' | 'pro'
    status:        null,       // 'active' | 'expired' | 'suspended'
    endDate:       null,
    hardwareId:    null,
    lastOnlineAt:  null,
    offlineDaysLeft: 0,
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // 1. الـ Hardware ID
  // ══════════════════════════════════════════════════════════════════════════════
  async function getHardwareId() {
    let hw = localStorage.getItem(HW_KEY);
    if (hw) return hw;

    // لو في Electron اطلب الـ HW ID من الـ Main Process عن طريق IPC
    if (window.require) {
      try {
        const { ipcRenderer } = window.require('electron');
        hw = await ipcRenderer.invoke('get-hardware-id');
      } catch (e) { /* fallback below */ }
    }

    // Fallback: اعمل ID من بيانات المتصفح
    if (!hw) {
      const raw = [
        navigator.userAgent,
        navigator.language,
        screen.width + 'x' + screen.height,
        new Date().getTimezoneOffset(),
        navigator.hardwareConcurrency || 0,
      ].join('|');
      hw = 'WEB-' + _simpleHash(raw).toString(16).toUpperCase().padStart(12, '0');
    }

    localStorage.setItem(HW_KEY, hw);
    return hw;
  }

  function _simpleHash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 2. الـ Local Cache — للأوفلاين
  // ══════════════════════════════════════════════════════════════════════════════
  function _saveCache(data) {
    const payload = { ...data, cachedAt: new Date().toISOString() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  }

  function _loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function _clearCache() {
    localStorage.removeItem(CACHE_KEY);
  }

  // مسح بيانات الـ POS المحلية مع الإبقاء على جلسة SaaS فقط
  function _clearPOSData() {
    const SAAS_KEYS = new Set([
      CACHE_KEY,            // saas_cache_v3
      'saas_plan',
      'solo_onboarding_done',
      HW_KEY,               // solo_saas_hw_id — لا تمسح الـ Hardware ID أبداً
      '_saasUid',
    ]);
    Object.keys(localStorage)
      .filter(k => !SAAS_KEYS.has(k))
      .forEach(k => localStorage.removeItem(k));
  }

  function _offlineDaysLeft(cache) {
    if (!cache || !cache.cachedAt) return 0;
    const cached   = new Date(cache.cachedAt);
    const now      = new Date();
    const diffDays = (now - cached) / (1000 * 60 * 60 * 24);
    return Math.max(0, OFFLINE_MAX_DAYS - diffDays);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 3. التحقق من Firestore
  // ══════════════════════════════════════════════════════════════════════════════
  async function _fetchSubscriptionFromFirestore(uid) {
    const db = await window.firestoreReady;
    const doc = await db.collection('subscriptions').doc(uid).get();
    if (!doc.exists) return null;
    return doc.data();
  }

  async function _registerNewUser(uid, hwId) {
    const db   = await window.firestoreReady;
    const user = firebase.auth().currentUser;

    // ── فحص التكرار: بس لو المستخدم في مسار register ──────────────────────
    const authMode = localStorage.getItem('_soloAuthMode');
    if (authMode === 'register') {
      const phone = localStorage.getItem('solo_user_phone') || user?.phoneNumber || null;
      if (phone) {
        try {
          const existing = await db.collection('subscriptions')
            .where('phone', '==', phone)
            .limit(2)
            .get();
          const conflict = existing.docs.find(d => d.id !== uid);
          if (conflict) {
            try { await firebase.auth().signOut(); } catch(e) {}
            localStorage.removeItem('_soloAuthMode');
            _showDuplicatePhoneScreen(phone);
            return null;
          }
        } catch (e) {
          console.warn('[SaaS] Duplicate phone check error:', e.message);
          // لو فشل الفحص (permissions أو network) نوقف التسجيل احتياطاً
          try { await firebase.auth().signOut(); } catch(_) {}
          localStorage.removeItem('_soloAuthMode');
          _showDuplicatePhoneScreen(phone || '');
          return null;
        }
      }
    }

    // ── اقرأ كل البيانات قبل _clearPOSData عشان ميتمسحوش ──────────────────
    const _phone      = localStorage.getItem('solo_user_phone') || user?.phoneNumber || null;
    const _name       = localStorage.getItem('solo_user_name')  || user?.displayName || null;
    const _restaurant = localStorage.getItem('solo_user_restaurant') || null;
    const _pin        = localStorage.getItem('solo_user_pin') || null;
    const _plan       = localStorage.getItem('solo_onboarding_plan') || 'trial';

    // سجّل المستخدم الجديد
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);

    // مسح بيانات POS القديمة بعد حفظ القيم المهمة
    _clearPOSData();

    const sub = {
      uid,
      plan:        _plan,
      status:      'active',
      startDate:   new Date().toISOString(),
      endDate:     trialEnd.toISOString(),
      hardwareIds: [hwId],
      email:       user?.email || null,
      phone:       _phone,
      displayName: _name,
      restaurant:  _restaurant,
      createdAt:   new Date().toISOString(),
      lastVerified: new Date().toISOString(),
    };

    await db.collection('subscriptions').doc(uid).set(sub);

    // ضع isLoggedIn بعد التسجيل (أول مرة) وامسح authMode
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('userRole', 'owner');
    localStorage.setItem('username', _name || '');
    localStorage.setItem('saas_plan', _plan);
    // ← أعِد كتابة الـ PIN بعد _clearPOSData عشان login.html يقدر يتحقق منه
    if (_pin) localStorage.setItem('solo_user_pin', _pin);
    localStorage.removeItem('_soloAuthMode');
    // الجلسة دي هي جلسة التسجيل — مش محتاج PIN تاني
    sessionStorage.setItem('isPinVerified', 'true');

    // سجّل بيانات المستخدم مع الـ PIN والدور
    const ownerPin = _pin;
    const ownerUser = {
      uid,
      name:         sub.displayName || sub.restaurant || 'المالك',
      email:        sub.email,
      phone:        sub.phone,
      displayName:  sub.displayName || sub.restaurant || 'المالك',
      restaurant:   sub.restaurant,
      restaurantId: uid,   // ← مهم! عشان يظهر في queries الـ tenant-scoped
      createdAt:    sub.createdAt,
      role:         'owner',
      active:       true,
      permissions:  ['all'],  // المالك عنده صلاحية لكل حاجة
      ...(ownerPin ? { pin: ownerPin } : {}),
    };
    await db.collection('users').doc(uid).set(ownerUser, { merge: true });

    // حفظ في localStorage كمان عشان يظهر فوراً في الإعدادات
    try {
      const localUsers = JSON.parse(localStorage.getItem('users') || '[]');
      const existingIdx = localUsers.findIndex(u => u.id === uid);
      const userWithId = { ...ownerUser, id: uid };
      if (existingIdx >= 0) localUsers[existingIdx] = userWithId;
      else localUsers.push(userWithId);
      localStorage.setItem('users', JSON.stringify(localUsers));
    } catch(e) {}

    return sub;
  }

  async function _updateLastVerified(uid, hwId) {
    try {
      const db  = await window.firestoreReady;
      const now = new Date().toISOString();

      await db.collection('subscriptions').doc(uid).update({
        lastVerified: now,
        hardwareIds:  firebase.firestore.FieldValue.arrayUnion(hwId),
      });

      // ── Anti-Fraud: سجّل كل login بـ hwId + timestamp ─────────────────────
      if (hwId) {
        await db.collection('subscriptions').doc(uid)
          .collection('login_events').add({
            hwId,
            ts:        firebase.firestore.FieldValue.serverTimestamp(),
            platform:  navigator.platform || 'unknown',
          });

        // ── اكتشاف تلاعب: أكتر من 3 أجهزة مختلفة في آخر 24 ساعة ──────────
        await _checkFraud(db, uid, hwId);
      }
    } catch (e) { /* مش حرج لو فشل */ }
  }

  // ── Anti-Fraud: راقب التلاعب وأشعر الأدمن ─────────────────────────────────
  async function _checkFraud(db, uid, currentHwId) {
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // آخر 24 ساعة
      const snap  = await db.collection('subscriptions').doc(uid)
        .collection('login_events')
        .where('ts', '>=', since)
        .get();

      // الأجهزة المختلفة اللي سجّلت دخول في آخر 24 ساعة
      const uniqueHwIds = new Set(snap.docs.map(d => d.data().hwId).filter(Boolean));
      uniqueHwIds.add(currentHwId);

      if (uniqueHwIds.size >= 4) {
        // 🚨 أكتر من 3 أجهزة في 24h → احتمال مشاركة أو تلاعب
        await db.collection('subscriptions').doc(uid).update({
          fraudFlag:       true,
          fraudReason:    `${uniqueHwIds.size} devices in 24h`,
          fraudDetectedAt: firebase.firestore.FieldValue.serverTimestamp(),
          fraudDevices:    [...uniqueHwIds],
        });
        console.warn(`🚨 [Anti-Fraud] uid=${uid} — ${uniqueHwIds.size} different devices in 24h`);
      }
    } catch (e) { /* silent */ }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 3b. Heartbeat — بيكتب lastActiveAt كل 60 ثانية عشان الأدمن يشوف متصل/لأ
  // ══════════════════════════════════════════════════════════════════════════════
  async function _startHeartbeat(uid) {
    if (!uid || !navigator.onLine) return;
    try {
      const db = await window.firestoreReady;
      await db.collection('subscriptions').doc(uid).update({
        lastActiveAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) { /* silent — heartbeat best-effort */ }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 3c. Audit Event — الأدمن والسيستم يكتبوا إجراءاتهم هنا
  // ══════════════════════════════════════════════════════════════════════════════
  async function _writeAuditEvent(uid, action, detail) {
    if (!uid || !navigator.onLine) return;
    try {
      const db = await window.firestoreReady;
      await db.collection('subscriptions').doc(uid)
        .collection('audit_log').add({
          action, by: 'system', detail,
          ts: firebase.firestore.FieldValue.serverTimestamp(),
        });
    } catch (e) { /* silent */ }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 3d. شاشة القفل عن بُعد
  // ══════════════════════════════════════════════════════════════════════════════
  function _showLockedScreen() {
    if (window.SaaSPlansUI && window.SaaSPlansUI.showLocked) {
      window.SaaSPlansUI.showLocked();
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 3e. Broadcast Message — رسالة فورية من الأدمن
  // ══════════════════════════════════════════════════════════════════════════════
  async function _showBroadcastMessage(msg, uid) {
    if (!msg) return;
    // منع إعادة العرض لو نفس الرسالة
    if (window._lastBroadcastMsg === msg) return;
    window._lastBroadcastMsg = msg;

    const overlay = document.createElement('div');
    overlay.id = '_bc_overlay';
    overlay.style.cssText = [
      'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99999',
      'display:flex;align-items:center;justify-content:center',
      'font-family:Cairo,sans-serif;direction:rtl',
    ].join(';');
    overlay.innerHTML = `
      <div style="background:#1a1a1a;border:1px solid #d4af37;border-radius:18px;
                  padding:32px;max-width:440px;width:90%;text-align:center;
                  box-shadow:0 0 40px rgba(212,175,55,.25)">
        <div style="font-size:36px;margin-bottom:12px">📢</div>
        <div style="font-size:18px;font-weight:800;color:#d4af37;margin-bottom:8px">
          رسالة من الإدارة
        </div>
        <p style="color:#ccc;font-size:14px;line-height:1.8;margin-bottom:24px;
                  white-space:pre-wrap">${msg}</p>
        <button id="_bc_close" style="background:#d4af37;border:none;border-radius:10px;
                padding:12px 32px;font-family:Cairo,sans-serif;font-size:15px;
                font-weight:700;cursor:pointer;color:#000">
          حسناً ✓
        </button>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById('_bc_close').onclick = async () => {
      overlay.remove();
      // امسح الرسالة من Firestore بعد ما العميل يشوفها
      try {
        const db = await window.firestoreReady;
        await db.collection('subscriptions').doc(uid).update({ broadcastMessage: null });
      } catch(e) { /* silent */ }
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 3f. Impersonation Banner — شريط أحمر لما الأدمن يفتح بوضع المشاهدة
  // ══════════════════════════════════════════════════════════════════════════════
  function _showImpersonationBanner(uid, name) {
    if (document.getElementById('_imp_bar')) return;
    const bar = document.createElement('div');
    bar.id = '_imp_bar';
    bar.style.cssText = [
      'position:fixed;top:0;left:0;right:0;background:#c0392b;color:#fff',
      'font-family:Cairo,sans-serif;font-size:13px;font-weight:700',
      'padding:8px 16px;z-index:99998;text-align:center;direction:rtl',
    ].join(';');
    bar.textContent = `🔴 وضع المشاهدة — ${name} (${uid}) — للخروج أغلق هذه النافذة`;
    document.body.appendChild(bar);
    document.body.style.marginTop = '36px';
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 4. بناء الـ State من بيانات الاشتراك
  // ══════════════════════════════════════════════════════════════════════════════
  function _buildState(sub, hwId, offlineDaysLeft = OFFLINE_MAX_DAYS) {
    const now       = new Date();
    const endDate   = new Date(sub.endDate);
    const isExpired = now > endDate;
    const status    = isExpired ? 'expired' : (sub.status || 'active');

    // تحقق الـ HW ID
    const hwAllowed = !sub.hardwareIds || sub.hardwareIds.length === 0
      || sub.hardwareIds.includes(hwId);

    return {
      isReady:         true,
      isLoggedIn:      true,
      uid:             sub.uid,
      plan:            sub.plan || 'trial',
      status,
      isExpired,
      hwAllowed,
      hardwareId:      hwId,
      endDate:         sub.endDate,
      lastOnlineAt:    sub.lastVerified || sub.cachedAt,
      offlineDaysLeft: Math.round(offlineDaysLeft * 10) / 10,
      email:           sub.email,
      phone:           sub.phone,
      displayName:     sub.displayName,
      restaurant:      sub.restaurant || '',
      promo:           sub.promo || null,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 5. الـ Init الرئيسي
  // ══════════════════════════════════════════════════════════════════════════════
  async function _verifyInBackground(hwId) {
    try {
      if (!navigator.onLine) return;
      await _waitForFirebaseAuth(5000);
      const user = firebase.auth().currentUser;
      if (!user) {
        // 🔧 لو مفيش يوزر في Firebase بس isLoggedIn موجود → الحساب اتمسح
        // نمسح الفلاجز عشان المرة الجاية يروح لشاشة تسجيل الدخول
        console.warn('⚠️ No Firebase user found — account may have been deleted');
        localStorage.removeItem('isLoggedIn');
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem('saas_plan');
        localStorage.removeItem('_saasUid');
        return;
      }
      _state.uid = user.uid;
      localStorage.setItem('_saasUid', user.uid); // 🔒 fallback للـ firestore_service
      if (navigator.onLine) {
        let sub = await _fetchSubscriptionFromFirestore(user.uid);
        if (!sub) {
          // 🔧 الحساب اتمسح من الأدمن بانل — نمسح الفلاجز المحلية
          // بدل ما نعرض blocking screen ونعطل اليوزر
          console.warn('⚠️ No subscription found for user — account may have been deleted from admin panel');
          localStorage.removeItem('isLoggedIn');
          localStorage.removeItem(CACHE_KEY);
          localStorage.removeItem('saas_plan');
          // نعمل sign out من Firebase
          try { await firebase.auth().signOut(); } catch(_) {}
          // نعرض رسالة بسيطة بدل blocking screen
          if (typeof Notification !== 'undefined' && typeof Notification.error === 'function') {
            Notification.error('تم حذف حسابك. سيتم تحويلك لشاشة تسجيل الدخول عند إعادة تشغيل التطبيق.');
          }
          return;
        }

        await _updateLastVerified(user.uid, hwId);
        // أضف hwId للـ sub المحلي عشان _buildState يشوف الجهاز الحالي صحيح
        if (!sub.hardwareIds) sub.hardwareIds = [];
        if (hwId && !sub.hardwareIds.includes(hwId)) sub.hardwareIds.push(hwId);

        // ── فحص القفل عن بُعد (Remote Lock) ──────────────────────────────
        if (sub.locked === true) {
          console.warn('🔒 Account locked by admin');
          _showLockedScreen();
          return;
        }

        // ── Broadcast Message من الأدمن ───────────────────────────────────
        if (sub.broadcastMessage) {
          _showBroadcastMessage(sub.broadcastMessage, user.uid);
        }

        const oldPlan = _state.plan;
        _saveCache({ ...sub, uid: user.uid });
        const newState = _buildState(sub, hwId);
        _state = { ..._state, ...newState };
        localStorage.setItem('saas_plan', _state.plan || 'trial');
        console.log('✅ Background verify done — plan:', _state.plan);

        // ── لو الباقة اتغيرت (مثلاً من Admin Panel) → تحديث بدون ريلود ──
        if (oldPlan && _state.plan !== oldPlan) {
          console.log(`🔄 Plan changed: ${oldPlan} → ${_state.plan}`);
          _writeAuditEvent(user.uid, 'plan_changed',
            `تغيير الباقة من ${oldPlan} إلى ${_state.plan}`);
          // تحديث الـ feature gates بدل ريلود الصفحة عشان منقفلش أي مودال مفتوح
          _applyFeatureGates();
          if (typeof Notification !== 'undefined' && typeof Notification.success === 'function') {
            Notification.success(`تم تحديث باقتك إلى ${PLAN_LABELS[_state.plan] || _state.plan}`);
          }
        }
      }
    } catch(e) { console.warn('Background verify error:', e.message); }
  }

  async function init() {
    if (window._saasInitRunning) return _state.isLoggedIn;

    // على صفحة login.html — الـ PIN pad هو اللي يتحكم، مش subscription-manager
    if (window.location.pathname.includes('login')) {
      return false;
    }

    window._saasInitRunning = true;

    const hwId = await getHardwareId();
    _state.hardwareId = hwId;

    // ── Impersonation: الأدمن فتح الـ POS بـ ?impersonate=UID ─────────────
    const _impersonateUid = new URLSearchParams(location.search).get('impersonate');
    if (_impersonateUid) {
      localStorage.setItem('solo_onboarding_done', 'true');

      // ✅ مسح بيانات الـ POS القديمة قبل تحميل بيانات العميل
      _clearPOSData();

      let impData = null;

      // محاولة 1: API المحلي (Electron running)
      try {
        const resp = await fetch(`/api/subscription/${_impersonateUid}`);
        if (resp.ok) impData = await resp.json();
      } catch(e) { /* Electron not running — try client SDK */ }

      // محاولة 2: Firebase Anonymous Auth + Firestore مباشرة
      if (!impData) {
        try {
          if (!firebase.auth().currentUser) {
            await firebase.auth().signInAnonymously();
          }
          const db = await window.firestoreReady;
          const snap = await db.collection('subscriptions').doc(_impersonateUid).get();
          if (snap.exists) impData = { ...snap.data(), uid: _impersonateUid };
        } catch(e) { console.warn('Impersonation Firestore fallback failed:', e.message); }
      }

      if (impData) {
        const builtState = _buildState({ ...impData, uid: _impersonateUid }, hwId);
        _state = { ...builtState, uid: _impersonateUid, isImpersonating: true };
        _saveCache({ ...impData, uid: _impersonateUid });
        localStorage.setItem('saas_plan', _state.plan || 'trial');
        _removeBlockingScreen();
        _showImpersonationBanner(_impersonateUid, impData.displayName || impData.restaurant || impData.phone || _impersonateUid);
        _broadcastReady();
        window._saasInitRunning = false;
        window._saasInitDone    = true;
        return true;
      }

      // كل المحاولات فشلت — اعرض رسالة خطأ بدل شاشة login
      document.body.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
          min-height:100vh;background:#0f0f19;color:#fff;font-family:Cairo,sans-serif;text-align:center;padding:20px;">
          <div style="font-size:48px;margin-bottom:16px;">🔴</div>
          <h2 style="font-size:20px;font-weight:800;margin:0 0 10px;">فشل تحميل بيانات العميل</h2>
          <p style="color:#888;font-size:14px;margin:0 0 6px;">UID: <code style="color:#e74c3c">${_impersonateUid}</code></p>
          <p style="color:#666;font-size:13px;margin:0 0 24px;">تأكد أن تطبيق Electron يعمل أو أن الـ UID صحيح</p>
          <button onclick="window.close()" style="background:#e74c3c;color:#fff;border:none;border-radius:10px;
            padding:10px 24px;font-size:14px;font-weight:700;cursor:pointer;font-family:Cairo,sans-serif;">
            إغلاق
          </button>
        </div>`;
      window._saasInitRunning = false;
      return false;
    }

    // ── شاشة البداية: مستخدم جديد تماماً — اعرض Splash (تسجيل دخول أو إنشاء حساب) ──
    if (
      !localStorage.getItem('isLoggedIn') &&
      !localStorage.getItem(CACHE_KEY) &&
      !localStorage.getItem('solo_onboarding_done')
    ) {
      window._saasInitRunning = false;
      const _showSplash = () => {
        if (window.SaaSAuthUI) {
          window.SaaSAuthUI.show();
        } else if (window.SaaSOnboardingUI) {
          // fallback: show onboarding directly
          window.SaaSOnboardingUI.show(function () {
            window._saasInitRunning = false;
            SaaS.init();
          });
        }
      };
      if (window.SaaSAuthUI || window.SaaSOnboardingUI) {
        _showSplash();
      } else {
        setTimeout(() => {
          if (window.SaaSAuthUI || window.SaaSOnboardingUI) _showSplash();
          else { localStorage.setItem('solo_onboarding_done', 'true'); SaaS.init(); }
        }, 500);
      }
      return false;
    }

    // ── الحل الجذري: لو isLoggedIn موجود — افتح البرنامج فوراً ──────
    if (localStorage.getItem('isLoggedIn') === 'true') {
      // 🔧 تحقق سريع من وجود الحساب في Firebase قبل عرض PIN
      if (navigator.onLine) {
        try {
          await _waitForFirebaseAuth(3000);
          const fbUser = firebase.auth().currentUser;
          if (!fbUser) {
            console.warn('⚠️ Account deleted — clearing local auth flags');
            localStorage.removeItem('isLoggedIn');
            localStorage.removeItem(CACHE_KEY);
            localStorage.removeItem('saas_plan');
            localStorage.removeItem('_saasUid');
            _state = { ..._state, isReady: true, isLoggedIn: false };
            _showAuthScreen();
            return false;
          }
        } catch(e) {
          console.warn('Firebase quick check failed, proceeding to PIN:', e.message);
        }
      }
      // لو الـ PIN لم يُتحقق منه في هذه الجلسة → وجّه لشاشة الـ PIN
      if (!sessionStorage.getItem('isPinVerified') && !window.location.pathname.includes('login')) {
        window.location.href = 'login.html';
        return false;
      }
      _state = {
        ..._state,
        isReady:    true,
        isLoggedIn: true,
        plan:       localStorage.getItem('saas_plan') || 'trial',
        status:     'active',
        hwAllowed:  true,
        isExpired:  false,
        uid:        localStorage.getItem('userId') || 'local',
      };
      _removeBlockingScreen();
      _broadcastReady();
      // تحقق في الخلفية بدون حجب
      _verifyInBackground(hwId);
      return true;
    }

    // ── مستخدم جديد — انتظر Firebase ───────────────────────────────
    await _waitForFirebaseAuth();
    const user = firebase.auth().currentUser;
    if (!user) {
      _state = { ..._state, isReady: true, isLoggedIn: false };
      _showAuthScreen();
      return false;
    }

    _state.uid       = user.uid;
    _state.isLoggedIn = true;
    // 🔒 احفظ الـ uid في localStorage عشان firestore_service يقدر يستخدمه
    // كـ fallback حتى لو firebase.auth().currentUser لسه ما اتحملش
    localStorage.setItem('_saasUid', user.uid);

    // 🧹 امسح أي بيانات tenants تانية من الكاش المحلي فوراً عند اللوجين
    if (typeof window._sanitizeTenantCache === 'function') {
      window._sanitizeTenantCache(user.uid);
    }

    // 🔄 Migration: أضف restaurantId لكل الـ docs القديمة (مرة واحدة بس)
    _migrateRestaurantId(user.uid);

    // ─── محاولة أونلاين ───────────────────────────────────────────────────────
    if (navigator.onLine) {
      try {
        let sub = await _fetchSubscriptionFromFirestore(user.uid);

        if (!sub) {
          // لو المستخدم اختار "تسجيل دخول" ومعندوش حساب — اعرض خطأ
          if (localStorage.getItem('_soloAuthMode') === 'login') {
            _showAccountNotFoundScreen();
            return false;
          }
          // أول مرة يسجّل — ابدأ trial
          sub = await _registerNewUser(user.uid, hwId);
          if (!sub) return; // رقم مكرر — _registerNewUser عرض الشاشة وعمل signOut
        } else {
          await _updateLastVerified(user.uid, hwId);
          // أضف hwId للـ sub المحلي عشان _buildState يشوف الجهاز الحالي صحيح
          if (!sub.hardwareIds) sub.hardwareIds = [];
          if (hwId && !sub.hardwareIds.includes(hwId)) sub.hardwareIds.push(hwId);

          // 🔧 تأكد إن الـ owner user موجود في Firestore (حسابات قديمة ممكن يكون ناقصها)
          _ensureOwnerUser(user.uid, sub);
        }

        _saveCache({ ...sub, uid: user.uid });
        _state = _buildState(sub, hwId);

      } catch (err) {
        console.error('❌ SaaS Firestore error:', err.code, err.message);
        return _handleOffline(hwId);
      }
    } else {
      // ─── أوفلاين ────────────────────────────────────────────────────────────
      return _handleOffline(hwId);
    }

    // ─── قرار التفعيل ─────────────────────────────────────────────────────────
    return _applyDecision();
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Migration: أضف restaurantId لكل الـ docs القديمة اللي اتكتبت قبل المالتي تينانسي
  // بتشتغل مرة واحدة بس لكل UID، وبتشتغل في الخلفية بدون حجب
  // ══════════════════════════════════════════════════════════════════════════════
  async function _migrateRestaurantId(uid) {
    const migKey = `_ridMigrated_${uid}`;
    if (localStorage.getItem(migKey)) return; // اتعملت قبل كده
    if (!navigator.onLine) return;

    setTimeout(async () => {
      try {
        const db = await window.firestoreReady;
        const COLS = [
          'categories', 'menuItems', 'users', 'employees', 'suppliers',
          'ingredients', 'aggregators', 'orders', 'expenses', 'expensesHistory',
          'salesHistory', 'shifts'
        ];
        let totalMigrated = 0;
        for (const col of COLS) {
          try {
            const snap = await db.collection(col).get();
            const toMigrate = snap.docs.filter(d => !d.data().restaurantId);
            if (toMigrate.length === 0) continue;
            // Firestore batch limit = 500
            const chunks = [];
            for (let i = 0; i < toMigrate.length; i += 499)
              chunks.push(toMigrate.slice(i, i + 499));
            for (const chunk of chunks) {
              const batch = db.batch();
              chunk.forEach(d => batch.update(d.ref, { restaurantId: uid }));
              await batch.commit();
            }
            totalMigrated += toMigrate.length;
            console.log(`✅ Migration '${col}': ${toMigrate.length} docs`);
          } catch (e) { console.warn(`Migration skip '${col}':`, e.message); }
        }
        localStorage.setItem(migKey, '1');
        if (totalMigrated > 0)
          console.log(`✅ Migration done: ${totalMigrated} docs stamped with restaurantId`);
      } catch (e) { console.warn('Migration error:', e); }
    }, 3000); // 3 ثواني تأخير عشان مش تعطل الـ startup
  }

  // 🔧 تأكد إن يوزر المالك موجود في Firestore (للحسابات القديمة اللي اتعملت قبل الإصلاح)
  async function _ensureOwnerUser(uid, sub) {
    setTimeout(async () => {
      try {
        const db = await window.firestoreReady;
        const userDoc = await db.collection('users').doc(uid).get();
        if (!userDoc.exists || !userDoc.data().restaurantId) {
          const ownerPin = localStorage.getItem('solo_user_pin') || '';
          const ownerData = {
            uid,
            name:         sub.displayName || sub.restaurant || 'المالك',
            displayName:  sub.displayName || sub.restaurant || 'المالك',
            email:        sub.email || '',
            phone:        sub.phone || localStorage.getItem('solo_user_phone') || '',
            restaurant:   sub.restaurant || '',
            restaurantId: uid,
            createdAt:    sub.createdAt || new Date().toISOString(),
            role:         'owner',
            active:       true,
            permissions:  ['all'],
            ...(ownerPin ? { pin: ownerPin } : {}),
          };
          await db.collection('users').doc(uid).set(ownerData, { merge: true });
          console.log('✅ Owner user ensured in Firestore with restaurantId');

          // تحديث localStorage
          try {
            const localUsers = JSON.parse(localStorage.getItem('users') || '[]');
            const existingIdx = localUsers.findIndex(u => u.id === uid);
            const userWithId = { ...ownerData, id: uid };
            if (existingIdx >= 0) localUsers[existingIdx] = userWithId;
            else localUsers.push(userWithId);
            localStorage.setItem('users', JSON.stringify(localUsers));
          } catch(e) {}
        }
      } catch (e) { console.warn('⚠️ ensureOwnerUser:', e.message); }
    }, 2000); // تأخير خفيف عشان مش يحجب الـ startup
  }

  async function _waitForFirebaseAuth(timeout = 15000) {
    return new Promise((resolve) => {
      let resolved = false;
      const unsub = firebase.auth().onAuthStateChanged((user) => {
        if (!resolved) { resolved = true; unsub(); resolve(user); }
      });
      setTimeout(() => { if (!resolved) { resolved = true; unsub(); resolve(null); } }, timeout);
    });
  }

  function _handleOffline(hwId) {
    const cache = _loadCache();

    // مفيش cache خالص → لازم يتصل بالنت مرة
    if (!cache) {
      _state = { ..._state, isReady: true, isLoggedIn: false };
      _showNoConnectionScreen();
      return false;
    }

    // ── حساب الـ Grace Period من تاريخ انتهاء الاشتراك ────────────
    if (cache.endDate) {
      const now            = new Date();
      const expiryDate     = new Date(cache.endDate);
      const isSubExpired   = now > expiryDate;

      if (isSubExpired) {
        // الاشتراك منتهي + أوفلاين → grace period 30 يوم من تاريخ الانتهاء
        const daysSinceExpiry = (now - expiryDate) / (1000 * 60 * 60 * 24);

        if (daysSinceExpiry > OFFLINE_MAX_DAYS) {
          // انتهى الـ grace period كمان
          _state = _buildState(cache, hwId, 0);
          _state.status = 'expired_offline';
          _showExpiredOfflineScreen();
          return false;
        }

        // لسه في فترة السماح
        const graceDaysLeft = Math.ceil(OFFLINE_MAX_DAYS - daysSinceExpiry);
        _state = _buildState(cache, hwId, graceDaysLeft);
        _state.isExpired      = false;   // اسمح له يشتغل
        _state.status         = 'active';
        _state.offlineGrace   = true;
        _state.graceDaysLeft  = graceDaysLeft;
        console.log(`⚠️ Offline grace — ${graceDaysLeft} يوم متبقي (الاشتراك منتهي)`);
        return _applyDecision();
      }
    }

    // الاشتراك لسه شغال — تحقق من grace period من آخر اتصال
    const daysLeft = _offlineDaysLeft(cache);

    if (daysLeft <= 0) {
      _state = _buildState(cache, hwId, 0);
      _state.status = 'expired_offline';
      _showExpiredOfflineScreen();
      return false;
    }

    _state = _buildState(cache, hwId, daysLeft);
    console.log(`📴 Offline mode — ${daysLeft.toFixed(1)} يوم متبقي`);
    return _applyDecision();
  }

  function _applyDecision() {
    // اشتراك منتهي
    if (_state.isExpired || _state.status === 'expired') {
      _showExpiredScreen();
      return false;
    }

    // اشتراك موقوف
    if (_state.status === 'suspended') {
      _showSuspendedScreen();
      return false;
    }

    // جهاز غير مسجّل (تجاوز حد الأجهزة)
    if (!_state.hwAllowed) {
      _showWrongDeviceScreen();
      return false;
    }

    // ✅ كل حاجة تمام
    window._saasInitRunning = false;
    window._saasInitDone = true;
    _removeBlockingScreen();
    _broadcastReady();
    return true;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 6. Feature Gates
  // ══════════════════════════════════════════════════════════════════════════════
  function canUse(feature) {
    if (!_state.isReady || _state.isExpired) return false;
    const features = PLAN_FEATURES[_state.plan] || [];
    return features.includes(feature);
  }

  function requireFeature(feature, onDenied) {
    if (!canUse(feature)) {
      if (typeof onDenied === 'function') onDenied(feature);
      else _showUpgradePrompt(feature);
      return false;
    }
    return true;
  }

  function getPlan()           { return _state.plan; }
  function getPlanLabel()      { return PLAN_LABELS[_state.plan] || '—'; }
  function getState()          { return { ..._state }; }
  function getEndDate()        { return _state.endDate; }
  function getOfflineDays()    { return _state.offlineDaysLeft; }

  // ══════════════════════════════════════════════════════════════════════════════
  // 7. UI Helpers (بتشغّل ملفات الـ UI الخارجية)
  // ══════════════════════════════════════════════════════════════════════════════
  function _showAuthScreen() {
    if (window.SaaSAuthUI) window.SaaSAuthUI.show();
  }

  function _showExpiredScreen() {
    if (window.SaaSPlansUI) window.SaaSPlansUI.showExpired(_state.plan);
  }

  function _showExpiredOfflineScreen() {
    if (window.SaaSPlansUI)
      window.SaaSPlansUI.showOfflineExpired();
  }

  function _showNoConnectionScreen() {
    if (window.SaaSPlansUI) window.SaaSPlansUI.showNoConnection();
  }

  function _showSuspendedScreen() {
    if (window.SaaSPlansUI) window.SaaSPlansUI.showSuspended();
  }

  function _showAccountNotFoundScreen() {
    localStorage.removeItem('_soloAuthMode');
    firebase.auth().signOut().catch(() => {});
    const el = document.getElementById('saas-blocking-screen') || document.createElement('div');
    el.id = 'saas-blocking-screen';
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;display:flex;align-items:center;justify-content:center;font-family:Cairo,sans-serif;';
    el.innerHTML = `
      <div style="text-align:center;max-width:380px;padding:40px 30px;background:#fff;border-radius:24px;
        box-shadow:0 20px 60px rgba(0,0,0,0.12);border:1px solid #f0f0f0;">
        <div style="width:64px;height:64px;background:#ffe4e4;border-radius:50%;display:flex;
          align-items:center;justify-content:center;margin:0 auto 20px;">
          <i class="fas fa-user-times" style="font-size:26px;color:#e74c3c;"></i>
        </div>
        <h2 style="font-size:20px;font-weight:800;color:#111;margin:0 0 10px;">الحساب غير موجود</h2>
        <p style="font-size:14px;color:#888;margin:0 0 28px;line-height:1.6;">
          هذا الرقم غير مسجّل في Solo POS.<br>هل تريد إنشاء حساب جديد؟
        </p>
        <button onclick="
          document.getElementById('saas-blocking-screen')?.remove();
          localStorage.setItem('_soloAuthMode','register');
          window._saasInitRunning=false; window._saasInitDone=false;
          if(window.SaaSOnboardingUI) window.SaaSOnboardingUI.show();
          else if(window.SaaSAuthUI) window.SaaSAuthUI.show();
        " style="
          width:100%;padding:14px;background:#111;border:none;border-radius:13px;
          color:#fff;font-size:14px;font-weight:800;cursor:pointer;margin-bottom:10px;
          font-family:Cairo,sans-serif;">
          إنشاء حساب جديد
        </button>
        <button onclick="
          document.getElementById('saas-blocking-screen')?.remove();
          localStorage.setItem('_soloAuthMode','login');
          window._saasInitRunning=false; window._saasInitDone=false;
          if(window.SaaSAuthUI) window.SaaSAuthUI.show();
        " style="
          width:100%;padding:12px;background:transparent;border:1.5px solid #e8e8e8;
          border-radius:13px;color:#888;font-size:13px;cursor:pointer;font-family:Cairo,sans-serif;">
          المحاولة برقم آخر
        </button>
      </div>`;
    if (!document.getElementById('saas-blocking-screen')) document.body.appendChild(el);
    else { const old = document.getElementById('saas-blocking-screen'); old.innerHTML = el.innerHTML; }
  }

  function _showDuplicatePhoneScreen(phone) {
    const el = document.getElementById('saas-blocking-screen') || document.createElement('div');
    el.id = 'saas-blocking-screen';
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;display:flex;align-items:center;justify-content:center;font-family:Cairo,sans-serif;';
    el.innerHTML = `
      <div style="text-align:center;max-width:380px;padding:40px 30px;background:#fff;border-radius:24px;
        box-shadow:0 20px 60px rgba(0,0,0,0.12);border:1px solid #f0f0f0;">
        <div style="width:64px;height:64px;background:#fff3e0;border-radius:50%;display:flex;
          align-items:center;justify-content:center;margin:0 auto 20px;">
          <i class="fas fa-phone-slash" style="font-size:26px;color:#e67e22;"></i>
        </div>
        <h2 style="font-size:20px;font-weight:800;color:#111;margin:0 0 10px;">الرقم مسجّل بالفعل</h2>
        <p style="font-size:14px;color:#888;margin:0 0 6px;line-height:1.6;">
          الرقم <strong style="color:#111;direction:ltr;unicode-bidi:embed;">${phone}</strong>
        </p>
        <p style="font-size:14px;color:#888;margin:0 0 28px;line-height:1.6;">
          مسجّل بالفعل في Solo POS.<br>سجّل دخولك بدلاً من إنشاء حساب جديد.
        </p>
        <button onclick="
          document.getElementById('saas-blocking-screen')?.remove();
          localStorage.setItem('_soloAuthMode','login');
          window._saasInitRunning=false; window._saasInitDone=false;
          if(window.SaaSAuthUI) window.SaaSAuthUI.show();
        " style="
          width:100%;padding:14px;background:#111;border:none;border-radius:13px;
          color:#fff;font-size:14px;font-weight:800;cursor:pointer;margin-bottom:10px;
          font-family:Cairo,sans-serif;">
          تسجيل الدخول
        </button>
        <button onclick="
          document.getElementById('saas-blocking-screen')?.remove();
          localStorage.setItem('_soloAuthMode','login');
          window._saasInitRunning=false; window._saasInitDone=false;
          if(window.SaaSAuthUI) window.SaaSAuthUI.show();
        " style="
          width:100%;padding:12px;background:transparent;border:1.5px solid #e8e8e8;
          border-radius:13px;color:#888;font-size:13px;cursor:pointer;font-family:Cairo,sans-serif;">
          المحاولة برقم آخر
        </button>
      </div>`;
    if (!document.getElementById('saas-blocking-screen')) document.body.appendChild(el);
    else document.body.replaceChild(el, document.getElementById('saas-blocking-screen'));
  }

  function _showWrongDeviceScreen() {
    if (window.SaaSPlansUI) window.SaaSPlansUI.showWrongDevice(_state.hardwareId);
  }

  function _showUpgradePrompt(feature) {
    const featureLabels = {
      whatsapp:        'واتساب التلقائي',
      reports:         'تقارير المبيعات',
      inventory:       'إدارة المخزون',
      customers:       'إدارة العملاء',
      employees:       'إدارة الموظفين',
      suppliers:       'إدارة الموردين',
      marketing:       'التسويق',
      aggregators:     'شركات التوصيل',
      dashboard:       'لوحة التحكم المتقدمة',
      advanced_reports:'التقارير التحليلية',
      multi_branch:    'الفروع المتعددة',
      bulk_messages:   'الرسائل الجماعية',
      kds:             'شاشة المطبخ KDS',
    };
    // الباقة المطلوبة لكل ميزة
    const featureRequiredPlan = {
      reports:         'Pro',
      inventory:       'Pro',
      whatsapp:        'Mega',
      customers:       'Pro',
      employees:       'Pro',
      suppliers:       'Pro',
      marketing:       'Mega',
      aggregators:     'Mega',
      dashboard:       'Mega',
      advanced_reports:'Mega',
      multi_branch:    'Mega',
      bulk_messages:   'Mega',
      kds:             'Basic',
      solo_ai:         'Mega',
    };
    const label       = featureLabels[feature]       || feature;
    const planNeeded  = featureRequiredPlan[feature] || null;
    const planIcons   = { Pro: '👑', Mega: '🚀' };
    const planHint    = planNeeded
      ? ` — تحتاج باقة ${planIcons[planNeeded] || ''} ${planNeeded}`
      : '';
    const msg = `🔒 "${label}"${planHint}`;
    if (window.SaaSPlansUI) window.SaaSPlansUI.showUpgradeOptions(msg);
  }

  function _removeBlockingScreen() {
    const el = document.getElementById('saas-blocking-screen');
    if (el) { el.remove(); document.body.style.overflow = ''; }
  }

  function _broadcastReady() {
    // ── تحديد الرول: لو كاشير مسجل دخول بالـ PIN، منبطلش صلاحياته ────────────
    localStorage.setItem('isLoggedIn', 'true');
    const _currentRole = (localStorage.getItem('userRole') || '').toLowerCase().trim();
    const _isPinSession = sessionStorage.getItem('isPinVerified') === 'true';
    const _isCashier = (_currentRole === 'cashier' || _currentRole === 'كاشير' || _currentRole === 'موظف');

    if (_isPinSession && _isCashier) {
        // كاشير مسجل دخول بالـ PIN — نحافظ على صلاحياته ولا نغيرها
        if (window.applyRoleBasedAccess) window.applyRoleBasedAccess(_currentRole);
    } else {
        // المالك أو مفيش session نشطة — اضبط owner
        localStorage.setItem('userRole', 'owner');
        if (window.applyRoleBasedAccess) window.applyRoleBasedAccess('owner');
    }

    window._saasReady = true;
    window.dispatchEvent(new CustomEvent('saas-ready', { detail: _state }));
    _applyFeatureGates();
    console.log(`✅ SaaS Ready — Plan: ${_state.plan} | Status: ${_state.status}`);

    // ── Heartbeat: اكتب lastActiveAt الآن ثم كل 60 ثانية ─────────────────
    if (_state.uid && !_state.isImpersonating) {
      _startHeartbeat(_state.uid);
      setInterval(() => {
        if (_state.uid && navigator.onLine) _startHeartbeat(_state.uid);
      }, 60 * 1000);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Feature Gates — بيشيل الـ link ويضيف قفل على الصفحات المحجوبة تلقائياً
  // ══════════════════════════════════════════════════════════════════════════════
  const PAGE_FEATURE_MAP = {
    'reports.html':     'reports',
    'ingredients.html': 'inventory',
    'customers.html':   'customers',
    'employees.html':   'employees',
    'suppliers.html':   'suppliers',
    'marketing.html':   'marketing',
  };

  function _applyFeatureGates() {
    document.querySelectorAll('.sidebar-item[href]').forEach(function (item) {
      const href    = item.getAttribute('href') || '';
      const page    = href.split('/').pop().split('?')[0];
      const feature = PAGE_FEATURE_MAP[page];

      if (!feature) return;

      if (!canUse(feature)) {
        // تنسيق العنصر المقفول — أحمر واضح بدل التعتيم
        item.style.cssText += ';cursor:not-allowed;background:rgba(231,76,60,0.06);border-right:3px solid #e74c3c;color:#c0392b;';

        // أيقونة القفل الحمراء (مرة واحدة)
        if (!item.querySelector('.saas-lock')) {
          const lockIcon = document.createElement('i');
          lockIcon.className = 'fas fa-lock saas-lock';
          lockIcon.style.cssText = 'font-size:13px;color:#e74c3c;margin-right:auto;flex-shrink:0;filter:drop-shadow(0 0 2px rgba(231,76,60,0.4));';
          item.appendChild(lockIcon);
        }

        // إلغاء الـ href ومنع التنقل
        item.dataset.lockedHref = href;
        item.removeAttribute('href');

        item.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          _showUpgradePrompt(feature);
        });
      }
    });
  }

  // تسجيل الخروج (= قفل الشاشة فقط — مش مسح البيانات)
  async function signOut() {
    // بنمسح بس علامة الجلسة الحالية عشان شاشة PIN تظهر
    // ما نمسحش localStorage كلها — الـ PIN والبيانات لازم يفضلوا موجودين
    sessionStorage.removeItem('isPinVerified');
    window.location.href = 'login.html';
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 8. Public API
  // ══════════════════════════════════════════════════════════════════════════════
  window.SaaS = {
    init,
    canUse,
    requireFeature,
    getPlan,
    getPlanLabel,
    getState,
    getEndDate,
    getOfflineDays,
    getHardwareId,
    signOut,
    _applyFeatureGates,
    PLAN_FEATURES,
    PLAN_LABELS,
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // AUTO-INIT: يشتغل لما الصفحة تتحمّل
  // ══════════════════════════════════════════════════════════════════════════════
  function _autoInit() {
    // انتظر Firebase يتجهّز الأول
    if (window.isFirestoreReady) {
      SaaS.init();
    } else {
      window.addEventListener('firestore-ready', () => SaaS.init(), { once: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _autoInit);
  } else {
    _autoInit();
  }

})();