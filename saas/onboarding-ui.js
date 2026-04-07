/**
 * Solo POS — Onboarding UI v2
 * ════════════════════════════
 * Flow: مميزات → الباقات → رقم الهاتف → OTP → إعداد المطعم
 */

(function () {
  'use strict';

  // ── Colors ──────────────────────────────────────────────────────
  const GOLD    = '#b8961e';
  const BG      = '#ffffff';
  const CARD_BG = '#f5f4f0';
  const BORDER  = '#e0ddd5';
  const GREEN   = '#27ae60';
  const RED     = '#e74c3c';

  // ── Features ────────────────────────────────────────────────────
  const FEATURES = [
    { icon: 'fa-cash-register', title: 'نقطة بيع متكاملة',   desc: 'إدارة الطلبات والكاشير بسرعة وسهولة' },
    { icon: 'fa-utensils',      title: 'شاشة المطبخ KDS',     desc: 'تتبع الطلبات للمطبخ لحظةً بلحظة' },
    { icon: 'fa-chart-line',    title: 'تقارير المبيعات',      desc: 'تحليل أداء مطعمك يومياً وشهرياً' },
    { icon: 'fa-boxes-stacked', title: 'إدارة المخزون',        desc: 'تتبع المكونات وتنبيهات النقص' },
    { icon: 'fa-users',         title: 'إدارة العملاء',        desc: 'قاعدة بيانات ونقاط ولاء متكاملة' },
    { icon: 'fa-bullhorn',      title: 'تسويق واتساب',         desc: 'إرسال عروض ورسائل جماعية للعملاء' },
  ];

  // ── Plans ───────────────────────────────────────────────────────
  const PLANS = [
    { id: 'basic', label: 'Basic',    price: '499', period: '/شهر', color: GOLD,      trialDays: 30,
      features: ['الرئيسية (POS كامل)', 'المطبخ والطلبات', 'العملاء', 'دعم فني'],
      cta: 'ابدأ مجاناً ← Basic' },
    { id: 'pro',   label: 'Pro',      price: '799', period: '/شهر', color: '#9b59b6', trialDays: 14,
      features: ['كل صفحات Basic', 'التقارير والإحصائيات', 'المخزون', 'دعم أولوية'],
      cta: 'ابدأ مجاناً ← Pro', recommended: true },
    { id: 'mega',  label: 'Mega 🚀',  price: '999', period: '/شهر', color: '#e74c3c', trialDays: 7,
      features: ['كل صفحات Pro', 'الموظفين والموردين', 'التسويق والواتساب', 'فروع متعددة'],
      cta: 'ابدأ مجاناً ← Mega', recommended: true },
  ];

  // ── State ────────────────────────────────────────────────────────
  let _callback     = null;
  let _step         = 0;       // 0=features 1=plans 2=phone 3=otp 4=setup
  let _selectedPlan = 'basic';
  let _phone        = '';      // رقم الهاتف بعد التنظيف
  let _otpSent      = false;   // هل تم إرسال الـ OTP؟
  let _otpVerified  = false;   // هل تم التحقق؟
  let _extraPhones  = [''];    // أرقام هواتف (الأول إجباري)

  const TOTAL_STEPS = 5; // 0..4

  // ── IPC Helper ───────────────────────────────────────────────────
  function _ipc(channel, ...args) {
    if (window.require) {
      try {
        const { ipcRenderer } = window.require('electron');
        return ipcRenderer.invoke(channel, ...args);
      } catch (e) { return Promise.reject(e); }
    }
    return Promise.reject(new Error('Not in Electron'));
  }

  // ════════════════════════════════════════════════════════════════
  // Public: show(callback)
  // ════════════════════════════════════════════════════════════════
  function show(callback) {
    localStorage.setItem('_soloAuthMode', 'register');
    _callback     = callback;
    _step         = 0;
    _selectedPlan = 'basic';
    _phone        = '';
    _otpSent      = false;
    _otpVerified  = false;
    _extraPhones  = [''];

    document.body.style.overflow = 'hidden';
    document.getElementById('saas-onboarding')?.remove();

    const style = document.createElement('style');
    style.id = 'saas-ob-styles';
    style.textContent = `
      @keyframes ob-fadeUp { from{opacity:0;transform:translateY(20px);}to{opacity:1;transform:translateY(0);} }
      @keyframes ob-scale  { from{transform:scale(0);}to{transform:scale(1);} }
      @keyframes ob-pulse  { 0%,100%{box-shadow:0 0 0 0 ${GOLD}44;}70%{box-shadow:0 0 0 10px transparent;} }
      @keyframes ob-spin   { to{transform:rotate(360deg);} }
      .ob-card-hover{transition:transform .2s,box-shadow .2s!important;}
      .ob-card-hover:hover{transform:translateY(-4px)!important;box-shadow:0 12px 32px rgba(0,0,0,.12)!important;}
      .ob-btn{transition:all .2s!important;}
      .ob-btn:hover{transform:translateY(-2px)!important;opacity:.9!important;}
      .ob-plan-card{transition:border-color .2s,box-shadow .2s,transform .2s!important;cursor:pointer!important;}
      .ob-plan-card.selected{transform:scale(1.03)!important;}
      .ob-input{width:100%;padding:12px 14px;background:#fff;border:1.5px solid ${BORDER};
        border-radius:11px;color:#1a1a1a;font-size:14px;font-family:'Cairo',sans-serif;
        outline:none;box-sizing:border-box;transition:border-color .2s;}
      .ob-input:focus{border-color:${GOLD}!important;}
      .ob-agg-card{border:1.5px solid ${BORDER};border-radius:12px;padding:12px 14px;
        cursor:pointer;transition:all .2s;display:flex;align-items:center;gap:10px;}
      .ob-agg-card.active{border-color:${GOLD};background:${GOLD}0d;}
      .ob-agg-card:hover{border-color:${GOLD}88;}
    `;
    document.head.appendChild(style);

    const wrap = document.createElement('div');
    wrap.id = 'saas-onboarding';
    wrap.style.cssText = `
      position:fixed;top:0;left:0;width:100%;height:100%;
      background:${BG};z-index:99999;overflow-y:auto;
      font-family:'Cairo',sans-serif;box-sizing:border-box;direction:rtl;
    `;
    document.body.appendChild(wrap);
    _render();
  }

  // ── Router ───────────────────────────────────────────────────────
  function _render() {
    const wrap = document.getElementById('saas-onboarding');
    if (!wrap) return;
    const map = [_step0_features, _step1_plans, _step2_phone, _step3_otp, _step4_setup];
    (map[_step] || _step0_features)(wrap);
    wrap.scrollTop = 0;
  }

  // ── Progress Dots ────────────────────────────────────────────────
  function _dots() {
    return `
      <div style="display:flex;gap:7px;justify-content:center;margin-bottom:32px;">
        ${Array.from({ length: TOTAL_STEPS }, (_, i) => `
          <div style="
            width:${i === _step ? 22 : 7}px;height:7px;border-radius:4px;transition:all .3s;
            background:${i === _step ? GOLD : i < _step ? GOLD + '55' : '#ddd'};
          "></div>
        `).join('')}
      </div>`;
  }

  // ════════════════════════════════════════════════════════════════
  // Step 0 — مميزات البرنامج
  // ════════════════════════════════════════════════════════════════
  function _step0_features(wrap) {
    wrap.innerHTML = `
      <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;">
        ${_dots()}
        <div style="text-align:center;margin-bottom:40px;animation:ob-fadeUp .5s ease;">
          <div style="margin:0 auto 18px;width:72px;height:72px;">
            <img src="../images/logo.png" style="width:72px;height:72px;object-fit:contain;border-radius:18px;" alt="Solo POS">
          </div>
          <h1 style="color:#1a1a1a;font-size:28px;font-weight:800;margin:0 0 8px;">
            مرحباً في <span style="color:${GOLD};">Solo POS</span>
          </h1>
          <p style="color:#666;font-size:14px;margin:0;">مطعمك.. أسهل، أسرع، وأذكى مع Solo POS</p>
        </div>

        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;max-width:780px;width:100%;margin-bottom:44px;">
          ${FEATURES.map((f, i) => `
            <div class="ob-card-hover" style="
              background:${CARD_BG};border:1px solid ${BORDER};border-radius:14px;
              padding:22px;text-align:center;animation:ob-fadeUp .5s ease ${i * .07}s both;">
              <div style="width:42px;height:42px;background:${GOLD}18;border-radius:10px;
                display:flex;align-items:center;justify-content:center;margin:0 auto 12px;">
                <i class="fas ${f.icon}" style="color:${GOLD};font-size:17px;"></i>
              </div>
              <div style="color:#1a1a1a;font-size:13px;font-weight:700;margin-bottom:4px;">${f.title}</div>
              <div style="color:#888;font-size:11px;line-height:1.5;">${f.desc}</div>
            </div>
          `).join('')}
        </div>

        <button class="ob-btn" onclick="window.SaaSOnboardingUI._next()" style="
          padding:15px 52px;background:${GOLD};border:none;border-radius:13px;
          color:#000;font-size:15px;font-weight:800;cursor:pointer;
          box-shadow:0 4px 24px ${GOLD}44;">
          اختر باقتك <i class="fas fa-arrow-left" style="margin-right:10px;"></i>
        </button>
        <p style="color:#999;font-size:11px;margin-top:12px;">يشتغل على Windows · Mac · Linux</p>
      </div>
    `;
  }

  // ════════════════════════════════════════════════════════════════
  // Step 1 — الباقات
  // ════════════════════════════════════════════════════════════════
  function _step1_plans(wrap) {
    wrap.innerHTML = `
      <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:40px 20px;">
        ${_dots()}
        <div style="text-align:center;margin-bottom:32px;animation:ob-fadeUp .4s ease;">
          <h1 style="color:#1a1a1a;font-size:24px;font-weight:800;margin:0 0 7px;">اختر باقتك</h1>
          <p style="color:#666;font-size:13px;margin:0;">
            كل باقة بتبدأ بتجربة مجانية — <span style="color:${GOLD};font-weight:700;">بدون كارت بنكي</span>
          </p>
        </div>

        <div id="ob-plans-wrap" style="display:flex;gap:16px;flex-wrap:wrap;justify-content:center;max-width:1100px;width:100%;margin-bottom:32px;">
          ${PLANS.map(p => `
            <div class="ob-plan-card${p.id === _selectedPlan ? ' selected' : ''}" data-plan="${p.id}"
              onclick="window.SaaSOnboardingUI._selectPlan('${p.id}')"
              style="background:${CARD_BG};border:2px solid ${p.id === _selectedPlan ? p.color : BORDER};
                border-radius:20px;padding:28px 22px;width:280px;text-align:center;position:relative;
                box-shadow:${p.id === _selectedPlan ? '0 8px 32px ' + p.color + '44' : '0 2px 12px rgba(0,0,0,.06)'};
                cursor:pointer;">

              <!-- شارة الأكثر مبيعاً -->
              ${p.recommended ? `<div style="position:absolute;top:-13px;left:50%;transform:translateX(-50%);
                background:${p.color};color:#fff;padding:4px 16px;border-radius:20px;
                font-size:11px;font-weight:800;white-space:nowrap;letter-spacing:.3px;">⭐ الأكثر مبيعاً</div>` : ''}

              <!-- شارة التجربة المجانية -->
              <div style="background:${GREEN}18;border:1px solid ${GREEN}44;border-radius:8px;
                padding:5px 10px;margin-bottom:14px;display:inline-block;">
                <i class="fas fa-gift" style="color:${GREEN};font-size:10px;margin-left:4px;"></i>
                <span style="color:${GREEN};font-size:11px;font-weight:800;">${p.trialDays} يوم مجاناً</span>
              </div>

              <div style="color:${p.color};font-size:18px;font-weight:800;margin-bottom:10px;">${p.label}</div>

              <div style="margin-bottom:6px;">
                <span style="color:#1a1a1a;font-size:36px;font-weight:800;line-height:1;">${p.price}</span>
                <span style="color:#999;font-size:13px;"> ج${p.period}</span>
              </div>
              <div style="color:#bbb;font-size:11px;margin-bottom:18px;">بعد انتهاء التجربة</div>

              <ul style="list-style:none;padding:0;margin:0 0 20px;text-align:right;">
                ${p.features.map(f => `
                  <li style="color:#555;font-size:12px;padding:5px 0;border-bottom:1px solid ${BORDER};">
                    <i class="fas fa-check" style="color:${GREEN};margin-left:6px;font-size:10px;"></i>${f}
                  </li>`).join('')}
              </ul>

              <div data-role="select-btn" style="padding:10px 0;background:${p.id === _selectedPlan ? p.color : 'transparent'};
                border:2px solid ${p.color};border-radius:12px;
                color:${p.id === _selectedPlan ? '#fff' : p.color};
                font-size:13px;font-weight:800;transition:all .2s;">
                ${p.id === _selectedPlan ? '✓ محدد' : 'اختر'}
              </div>
            </div>
          `).join('')}
        </div>

        <div style="display:flex;gap:10px;">
          <button onclick="window.SaaSOnboardingUI._prev()" style="
            padding:12px 24px;background:transparent;border:1px solid #ccc;border-radius:11px;
            color:#666;font-size:13px;cursor:pointer;">رجوع</button>
          <button class="ob-btn" onclick="window.SaaSOnboardingUI._next()" style="
            padding:14px 48px;background:${GOLD};border:none;border-radius:12px;
            color:#000;font-size:15px;font-weight:800;cursor:pointer;
            box-shadow:0 4px 20px ${GOLD}44;">
            التالي <i class="fas fa-arrow-left" style="margin-right:8px;"></i>
          </button>
        </div>
        <p style="color:#bbb;font-size:11px;margin-top:10px;">لا حاجة لأي بيانات بنكية الآن</p>
      </div>
    `;
  }

  function _selectPlan(id) {
    _selectedPlan = id;
    document.querySelectorAll('.ob-plan-card').forEach(el => {
      const p = PLANS.find(x => x.id === el.dataset.plan);
      if (!p) return;
      const sel = el.dataset.plan === id;
      el.style.borderColor = sel ? p.color : BORDER;
      el.style.boxShadow   = sel ? `0 8px 32px ${p.color}44` : '0 2px 12px rgba(0,0,0,.06)';
      el.classList.toggle('selected', sel);
      // حدّث زر الاختيار
      const btn = el.querySelector('[data-role="select-btn"]');
      if (btn) {
        btn.style.background = sel ? p.color : 'transparent';
        btn.style.color      = sel ? '#fff' : p.color;
        btn.textContent      = sel ? '✓ محدد' : 'اختر';
      }
    });
  }

  // ════════════════════════════════════════════════════════════════
  // Step 2 — رقم الهاتف
  // ════════════════════════════════════════════════════════════════
  function _step2_phone(wrap) {
    wrap.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px 20px;">
        <div style="background:${CARD_BG};border:1px solid ${BORDER};border-radius:22px;
          padding:38px;max-width:440px;width:100%;animation:ob-fadeUp .4s ease;">
          ${_dots()}

          <div style="text-align:center;margin-bottom:28px;">
            <div style="width:52px;height:52px;background:#25D36622;border-radius:50%;
              display:flex;align-items:center;justify-content:center;margin:0 auto 14px;">
              <i class="fab fa-whatsapp" style="font-size:24px;color:#25D366;"></i>
            </div>
            <h2 style="color:#1a1a1a;font-size:21px;font-weight:800;margin:0 0 6px;">رقم واتساب</h2>
            <p style="color:#777;font-size:13px;margin:0;">سيصلك كود التفعيل على هذا الرقم</p>
          </div>

          <div style="margin-bottom:20px;">
            <label style="display:block;color:#555;font-size:11px;font-weight:700;
              letter-spacing:1px;margin-bottom:7px;">رقم الهاتف</label>
            <div style="display:flex;gap:8px;">
              <div style="padding:12px 14px;background:#fff;border:1.5px solid ${BORDER};
                border-radius:11px;color:#444;font-size:13px;font-weight:700;white-space:nowrap;">
                🇪🇬 +20
              </div>
              <input id="ob-phone" class="ob-input" type="tel" placeholder="01XXXXXXXXX"
                dir="ltr" value="${_phone ? _phone.replace(/^\+?20/, '') : ''}"
                style="flex:1;font-family:monospace;font-size:16px;font-weight:700;letter-spacing:2px;">
            </div>
          </div>

          <div id="ob-err" style="display:none;color:${RED};font-size:12px;
            padding:10px 14px;background:${RED}18;border-radius:8px;margin-bottom:14px;"></div>

          <button class="ob-btn" onclick="window.SaaSOnboardingUI._validatePhone()" style="
            width:100%;padding:14px;background:${GOLD};border:none;border-radius:12px;
            color:#000;font-size:15px;font-weight:800;cursor:pointer;
            box-shadow:0 4px 20px ${GOLD}44;">
            <i class="fas fa-arrow-left" style="margin-right:8px;"></i> التالي
          </button>

          <div id="ob-google-wrap" style="margin-top:14px;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
              <div style="flex:1;height:1px;background:#e8e8e8;"></div>
              <span style="color:#bbb;font-size:11px;">أو</span>
              <div style="flex:1;height:1px;background:#e8e8e8;"></div>
            </div>
            <button id="ob-google-btn" onclick="window.SaaSOnboardingUI._handleGoogleRegister()" style="
              width:100%;padding:12px;background:#fff;border:1.5px solid #e8e8e8;border-radius:12px;
              color:#555;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;
              justify-content:center;gap:8px;font-family:'Cairo',sans-serif;">
              <svg width="16" height="16" viewBox="0 0 48 48">
                <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.7 33.1 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.5 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.3-.1-2.7-.1-4z"/>
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.5 29.4 4 24 4c-7.8 0-14.5 4.3-17.7 10.7z"/>
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.5-4.9L31 33.6C29.1 35 26.6 36 24 36c-5.3 0-9.7-2.9-11.3-7.1l-6.6 5.1C9.5 39.6 16.3 44 24 44z"/>
                <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.8 2.2-2.3 4.1-4.3 5.4l6.5 5.1C41.1 35.1 44 30 44 24c0-1.3-.1-2.7-.4-4z"/>
              </svg>
              التسجيل بحساب Google
            </button>
          </div>

          <div style="text-align:center;margin-top:14px;">
            <button onclick="window.SaaSOnboardingUI._prev()" style="
              background:none;border:none;color:#aaa;font-size:12px;cursor:pointer;text-decoration:underline;">
              رجوع
            </button>
            &nbsp;·&nbsp;
            <button onclick="window.SaaSOnboardingUI._switchToLogin()" style="
              background:none;border:none;color:${GOLD};font-size:12px;cursor:pointer;text-decoration:underline;font-weight:700;">
              لديك حساب؟ سجّل دخولك
            </button>
          </div>
        </div>
      </div>
    `;

    // Focus on phone input + hide Google in Electron
    setTimeout(() => {
      const inp = document.getElementById('ob-phone');
      if (inp) inp.focus();
      // Electron مش بيدعم Google popup — إخفاء القسم
      if (window.require) {
        const gw = document.getElementById('ob-google-wrap');
        if (gw) gw.style.display = 'none';
      }
    }, 100);
  }

  function _switchToLogin() {
    // تحويل لمسار تسجيل الدخول
    localStorage.setItem('_soloAuthMode', 'login');
    document.getElementById('saas-onboarding')?.remove();
    document.getElementById('saas-ob-styles')?.remove();
    document.body.style.overflow = '';
    if (window.SaaSAuthUI) {
      window.SaaSAuthUI.show();
    }
  }

  async function _handleGoogleRegister() {
    const btn = document.getElementById('ob-google-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner" style="animation:ob-spin 1s linear infinite;margin-left:8px;"></i> جاري الفتح...'; }
    try {
      if (window.require) {
        // Electron
        const { ipcRenderer } = window.require('electron');
        const data = await ipcRenderer.invoke('open-google-auth');
        const credential = firebase.auth.GoogleAuthProvider.credential(data.idToken);
        await firebase.auth().signInWithCredential(credential);
      } else {
        await firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider());
      }
      // ── فحص التكرار: هل الإيميل/الـ uid مسجل بالفعل؟ ────────────────────
      if (window.firestoreReady) {
        try {
          const db = await window.firestoreReady;
          const gUser = firebase.auth().currentUser;
          const uid   = gUser?.uid;
          const email = gUser?.email || null;
          // فحص بالـ uid أولاً
          const byUid = await db.collection('subscriptions').doc(uid).get();
          if (byUid.exists) {
            await firebase.auth().signOut().catch(() => {});
            _err('هذا الحساب مسجّل بالفعل. يرجى تسجيل الدخول.');
            if (btn) { btn.disabled = false; btn.innerHTML = 'التسجيل بحساب Google'; }
            setTimeout(() => _switchToLogin(), 1500);
            return;
          }
          // فحص بالإيميل لو موجود
          if (email) {
            const byEmail = await db.collection('subscriptions')
              .where('email', '==', email).limit(1).get();
            if (!byEmail.empty) {
              await firebase.auth().signOut().catch(() => {});
              _err('هذا الحساب مسجّل بالفعل. يرجى تسجيل الدخول.');
              if (btn) { btn.disabled = false; btn.innerHTML = 'التسجيل بحساب Google'; }
              setTimeout(() => _switchToLogin(), 1500);
              return;
            }
          }
        } catch (e) {
          await firebase.auth().signOut().catch(() => {});
          _err('تعذّر التحقق من قاعدة البيانات. حاول مرة أخرى.');
          if (btn) { btn.disabled = false; btn.innerHTML = 'التسجيل بحساب Google'; }
          return;
        }
      }

      // انتقل مباشرة لخطوة إعداد المطعم
      _step = 4;
      _render();
    } catch (e) {
      if (btn) { btn.disabled = false; btn.innerHTML = 'التسجيل بحساب Google'; }
      _err('فشل الدخول بـ Google: ' + (e.message || ''));
    }
  }

  async function _validatePhone() {
    const raw = (document.getElementById('ob-phone')?.value || '').trim();
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 11) {
      _err('أدخل رقم هاتف صحيح (01XXXXXXXXX)');
      return;
    }
    if (!digits.startsWith('01') && !digits.startsWith('1')) {
      _err('الرقم لازم يبدأ بـ 01');
      return;
    }
    const normalized = digits.startsWith('0') ? digits : '0' + digits;
    _phone = '+20' + normalized.slice(1); // +201XXXXXXXXX

    const btn = document.querySelector('#saas-onboarding .ob-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-left:8px;"></i> جاري الفحص...'; }

    // ── فحص التكرار قبل الانتقال لخطوة الـ OTP ──────────────────────────
    try {
      const db = await window.firestoreReady;
      const snap = await db.collection('subscriptions').where('phone', '==', _phone).limit(1).get();
      if (!snap.empty) {
        _err('هذا الرقم مسجّل بالفعل. يرجى تسجيل الدخول.');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-arrow-left" style="margin-right:8px;"></i> التالي'; }
        setTimeout(() => _switchToLogin(), 2000);
        return;
      }
    } catch(e) {
      console.warn('Phone check failed, proceeding:', e);
    }

    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-arrow-left" style="margin-right:8px;"></i> التالي'; }
    localStorage.setItem('solo_user_phone', _phone);
    _otpSent = false;
    _step = 3;
    _render();
  }

  // ════════════════════════════════════════════════════════════════
  // Step 3 — OTP (إرسال + إدخال)
  // ════════════════════════════════════════════════════════════════
  function _step3_otp(wrap) {
    if (!_otpSent) {
      _step3a_confirm(wrap);
    } else {
      _step3b_enter(wrap);
    }
  }

  function _step3a_confirm(wrap) {
    const displayPhone = _phone; // +201XXXXXXXXX
    wrap.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px 20px;">
        <div style="background:${CARD_BG};border:1px solid ${BORDER};border-radius:22px;
          padding:38px;max-width:440px;width:100%;animation:ob-fadeUp .4s ease;text-align:center;">
          ${_dots()}

          <div style="width:64px;height:64px;background:#25D36618;border:2px solid #25D36644;
            border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;">
            <i class="fab fa-whatsapp" style="font-size:28px;color:#25D366;"></i>
          </div>

          <h2 style="color:#1a1a1a;font-size:21px;font-weight:800;margin:0 0 10px;">تأكيد الإرسال</h2>
          <p style="color:#666;font-size:13px;margin:0 0 20px;line-height:1.7;">
            سيتم إرسال كود التفعيل (6 أرقام) عبر واتساب إلى:
          </p>

          <div style="background:#fff;border:1.5px solid ${BORDER};border-radius:12px;
            padding:14px 20px;margin-bottom:24px;display:inline-flex;align-items:center;gap:10px;">
            <i class="fas fa-phone" style="color:${GOLD};font-size:14px;"></i>
            <span style="font-family:monospace;font-size:18px;font-weight:800;color:#1a1a1a;
              letter-spacing:2px;direction:ltr;">${displayPhone}</span>
          </div>

          <div id="ob-err" style="display:none;color:${RED};font-size:12px;
            padding:10px 14px;background:${RED}18;border-radius:8px;margin-bottom:14px;"></div>

          <button id="ob-send-btn" class="ob-btn" onclick="window.SaaSOnboardingUI._sendOtp()" style="
            width:100%;padding:14px;background:#25D366;border:none;border-radius:12px;
            color:#fff;font-size:15px;font-weight:800;cursor:pointer;
            box-shadow:0 4px 20px #25D36644;margin-bottom:10px;">
            <i class="fas fa-paper-plane" style="margin-left:8px;"></i> إرسال الكود
          </button>

          <button onclick="window.SaaSOnboardingUI._changePhone()" style="
            width:100%;padding:12px;background:transparent;border:1.5px solid ${BORDER};
            border-radius:12px;color:#666;font-size:14px;cursor:pointer;">
            <i class="fas fa-edit" style="margin-left:6px;"></i> تغيير الرقم
          </button>
        </div>
      </div>
    `;
  }

  function _step3b_enter(wrap) {
    wrap.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px 20px;">
        <div style="background:${CARD_BG};border:1px solid ${BORDER};border-radius:22px;
          padding:38px;max-width:440px;width:100%;animation:ob-fadeUp .4s ease;text-align:center;">
          ${_dots()}

          <div style="width:64px;height:64px;background:${GOLD}18;border:2px solid ${GOLD}44;
            border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;">
            <i class="fas fa-key" style="font-size:26px;color:${GOLD};"></i>
          </div>

          <h2 style="color:#1a1a1a;font-size:21px;font-weight:800;margin:0 0 6px;">أدخل الكود</h2>
          <p style="color:#777;font-size:13px;margin:0 0 24px;">
            تم إرسال كود لـ <span style="color:#1a1a1a;font-weight:700;">${_phone}</span>
          </p>

          <input id="ob-otp" class="ob-input" type="tel" placeholder="000000"
            maxlength="6" dir="ltr"
            style="font-size:32px;font-weight:800;letter-spacing:12px;
              text-align:center;padding:16px;font-family:monospace;margin-bottom:10px;">

          <div id="ob-err" style="display:none;color:${RED};font-size:12px;
            padding:10px 14px;background:${RED}18;border-radius:8px;margin-bottom:14px;"></div>

          <button id="ob-verify-btn" class="ob-btn" onclick="window.SaaSOnboardingUI._verifyOtp()" style="
            width:100%;padding:14px;background:#1a1a1a;border:none;border-radius:12px;
            color:#fff;font-size:15px;font-weight:800;cursor:pointer;margin-bottom:10px;">
            <i class="fas fa-check" style="margin-left:8px;"></i> تأكيد الكود
          </button>

          <button onclick="window.SaaSOnboardingUI._resendOtp()" style="
            background:none;border:none;color:#25D366;font-size:13px;cursor:pointer;
            text-decoration:underline;font-family:'Cairo',sans-serif;">
            <i class="fab fa-whatsapp" style="margin-left:4px;"></i> إعادة إرسال الكود
          </button>
        </div>
      </div>
    `;

    setTimeout(() => {
      const inp = document.getElementById('ob-otp');
      if (inp) { inp.focus(); }
    }, 100);
  }

  async function _sendOtp() {
    const btn = document.getElementById('ob-send-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner" style="animation:ob-spin 1s linear infinite;margin-left:8px;"></i> جاري الإرسال...'; }

    try {
      const result = await _ipc('send-otp', _phone.replace('+20', ''));
      if (result && result.success) {
        _otpSent = true;
        _render(); // go to OTP entry
      } else {
        _err('فشل إرسال الكود. حاول مرة أخرى.');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane" style="margin-left:8px;"></i> إرسال الكود'; }
      }
    } catch (e) {
      _err('خطأ: ' + (e.message || 'تأكد من تشغيل التطبيق'));
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane" style="margin-left:8px;"></i> إرسال الكود'; }
    }
  }

  async function _verifyOtp() {
    const code = (document.getElementById('ob-otp')?.value || '').trim();
    if (code.length !== 6 || !/^\d{6}$/.test(code)) {
      _err('أدخل الكود المكوّن من 6 أرقام');
      return;
    }

    const btn = document.getElementById('ob-verify-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'جاري التحقق...'; }

    try {
      const phoneRaw = _phone.replace('+20', '');
      const result = await _ipc('verify-otp', phoneRaw, code);

      if (!result || !result.success) {
        _err(result?.error || 'كود خاطئ، حاول مجدداً');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check" style="margin-left:8px;"></i> تأكيد الكود'; }
        return;
      }

      // Firebase sign-in بالـ customToken
      if (result.customToken && window.firebase) {
        await firebase.auth().signInWithCustomToken(result.customToken);
      }

      // ── فحص التكرار: هل الرقم مسجل بالفعل في Firestore؟ ──────────────────
      if (window.firestoreReady) {
        try {
          const db = await window.firestoreReady;
          const uid = firebase.auth().currentUser?.uid;
          const snap = await db.collection('subscriptions')
            .where('phone', '==', _phone)
            .limit(2)
            .get();
          const conflict = snap.docs.find(d => d.id !== uid);
          if (conflict) {
            await firebase.auth().signOut().catch(() => {});
            _err('هذا الرقم مسجّل بالفعل. يرجى تسجيل الدخول.');
            setTimeout(() => _switchToLogin(), 1500);
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check" style="margin-left:8px;"></i> تأكيد الكود'; }
            return;
          }
        } catch (e) {
          // فشل الفحص (network أو permissions) — نكمّل عشان _registerNewUser هو الحاجز الحقيقي
          console.warn('[Onboarding] Duplicate phone check failed, proceeding:', e.message);
        }
      }

      // انتقل لخطوة إعداد المطعم
      _step = 4;
      _render();

    } catch (e) {
      _err('خطأ في التحقق: ' + (e.message || ''));
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check" style="margin-left:8px;"></i> تأكيد الكود'; }
    }
  }

  async function _resendOtp() {
    _otpSent = false;
    try {
      const result = await _ipc('send-otp', _phone.replace('+20', ''));
      if (result?.success) {
        _otpSent = true;
        _render();
        // show success briefly
        setTimeout(() => {
          const wrap = document.getElementById('saas-onboarding');
          if (wrap) {
            const toast = document.createElement('div');
            toast.style.cssText = `position:fixed;bottom:30px;left:50%;transform:translateX(-50%);
              background:#25D366;color:#fff;padding:12px 24px;border-radius:40px;
              font-weight:700;z-index:999999;font-size:14px;font-family:'Cairo',sans-serif;`;
            toast.textContent = '✅ تم إعادة إرسال الكود';
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
          }
        }, 100);
      }
    } catch (e) { /* مش مشكلة */ }
  }

  function _changePhone() {
    _otpSent = false;
    _step = 2;
    _render();
  }

  // ════════════════════════════════════════════════════════════════
  // Step 4 — إعداد المطعم
  // ════════════════════════════════════════════════════════════════
  function _step4_setup(wrap) {
    wrap.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px 20px;">
        <div style="background:${CARD_BG};border:1px solid ${BORDER};border-radius:22px;
          padding:38px;max-width:560px;width:100%;animation:ob-fadeUp .4s ease;">
          ${_dots()}

          <div style="text-align:center;margin-bottom:26px;">
            <div style="width:52px;height:52px;background:${GOLD}18;border-radius:50%;
              display:flex;align-items:center;justify-content:center;margin:0 auto 14px;">
              <i class="fas fa-store" style="font-size:22px;color:${GOLD};"></i>
            </div>
            <h2 style="color:#1a1a1a;font-size:21px;font-weight:800;margin:0 0 6px;">إعداد مطعمك</h2>
            <div style="background:#fffbeb;border:1px solid #f0c040;border-radius:10px;
              padding:10px 14px;margin-top:10px;text-align:right;">
              <i class="fas fa-receipt" style="color:${GOLD};margin-left:6px;"></i>
              <span style="color:#7a5a00;font-size:12px;font-weight:600;">
                هذه البيانات ستظهر على الفاتورة المطبوعة
              </span>
            </div>
          </div>

          <!-- ── الحقول الإجبارية ────────────────────────────────── -->
          <div style="margin-bottom:14px;">
            <label style="display:block;color:#555;font-size:11px;font-weight:700;letter-spacing:.8px;margin-bottom:6px;">
              اسم المطعم <span style="color:${RED};">*</span>
            </label>
            <input id="ob-restaurant" class="ob-input" type="text" placeholder="مثال: مطعم النيل">
          </div>

          <div style="margin-bottom:20px;">
            <label style="display:block;color:#555;font-size:11px;font-weight:700;letter-spacing:.8px;margin-bottom:6px;">
              العنوان <span style="color:${RED};">*</span>
            </label>
            <input id="ob-address" class="ob-input" type="text" placeholder="مثال: 15 شارع التحرير، القاهرة">
          </div>

          <!-- ── أرقام هواتف المطعم (الأول إجباري) ─────────────── -->
          <div style="margin-bottom:20px;">
            <label style="display:block;color:#555;font-size:11px;font-weight:700;letter-spacing:.8px;margin-bottom:8px;">
              <i class="fas fa-phone" style="color:${GOLD};margin-left:5px;"></i>
              أرقام هواتف المطعم
              <span style="color:${RED};font-weight:600;">*</span>
              <span style="color:#aaa;font-weight:400;"> (رقم واحد على الأقل)</span>
            </label>
            <div id="ob-phones-list">
              ${_extraPhones.map((p, i) => _phoneRow(p, i)).join('')}
            </div>
            <button onclick="window.SaaSOnboardingUI._addPhone()" style="
              margin-top:8px;background:none;border:1.5px dashed ${BORDER};border-radius:10px;
              padding:8px 16px;color:${GOLD};font-size:12px;font-weight:700;cursor:pointer;width:100%;
              font-family:'Cairo',sans-serif;">
              <i class="fas fa-plus" style="margin-left:5px;"></i> إضافة رقم آخر
            </button>
          </div>

          <!-- ── رقم PIN للدخول السريع ──────────────────────────── -->
          <div style="margin-bottom:20px;">
            <label style="display:block;color:#555;font-size:11px;font-weight:700;letter-spacing:.8px;margin-bottom:6px;">
              <i class="fas fa-lock" style="color:${GOLD};margin-left:5px;"></i>
              رقم PIN للدخول السريع <span style="color:${RED};">*</span>
            </label>
            <div style="background:#fffbeb;border:1px solid #f0c040;border-radius:10px;
              padding:9px 13px;margin-bottom:8px;font-size:11px;color:#7a5a00;line-height:1.5;">
              <i class="fas fa-info-circle" style="margin-left:5px;"></i>
              بعد تسجيل الخروج، استخدم هذا الرقم للدخول السريع بدلاً من إعادة إدخال رقم هاتفك
            </div>
            <input id="ob-pin" class="ob-input" type="password" inputmode="numeric"
              maxlength="4" pattern="[0-9]{4}" placeholder="أدخل 4 أرقام" dir="ltr"
              style="letter-spacing:8px;font-size:22px;text-align:center;font-weight:800;">
          </div>

          <!-- ── رسالة خطأ ────────────────────────────────────────── -->
          <div id="ob-err" style="display:none;color:${RED};font-size:12px;
            padding:10px 14px;background:${RED}18;border-radius:8px;margin-bottom:14px;"></div>

          <!-- ── زر الإنهاء ───────────────────────────────────────── -->
          <button class="ob-btn" onclick="window.SaaSOnboardingUI._submitSetup()" style="
            width:100%;padding:15px;background:${GOLD};border:none;border-radius:13px;
            color:#000;font-size:15px;font-weight:800;cursor:pointer;
            box-shadow:0 4px 24px ${GOLD}44;">
            <i class="fas fa-rocket" style="margin-left:10px;"></i> ابدأ رحلتك مع Solo POS
          </button>
        </div>
      </div>
    `;
  }

  function _phoneRow(val, idx) {
    return `
      <div style="display:flex;gap:8px;margin-bottom:8px;" id="ob-phone-row-${idx}">
        <input class="ob-input" type="tel" placeholder="01XXXXXXXXX" dir="ltr"
          value="${val}"
          style="flex:1;font-family:monospace;"
          oninput="window.SaaSOnboardingUI._setPhone(${idx}, this.value)">
        ${idx > 0 ? `<button onclick="window.SaaSOnboardingUI._removePhone(${idx})"
          style="padding:0 14px;background:#f5f5f5;border:1.5px solid #ddd;border-radius:10px;
            color:#e74c3c;cursor:pointer;font-size:16px;">×</button>` : ''}
      </div>
    `;
  }

  function _setPhone(idx, val) { _extraPhones[idx] = val; }
  function _addPhone() {
    _extraPhones.push('');
    const list = document.getElementById('ob-phones-list');
    if (list) {
      const row = document.createElement('div');
      row.innerHTML = _phoneRow('', _extraPhones.length - 1);
      list.appendChild(row.firstElementChild);
    }
  }
  function _removePhone(idx) {
    _extraPhones.splice(idx, 1);
    const row = document.getElementById(`ob-phone-row-${idx}`);
    if (row) row.remove();
  }

  function _submitSetup() {
    const restaurant = (document.getElementById('ob-restaurant')?.value || '').trim();
    const address    = (document.getElementById('ob-address')?.value    || '').trim();

    if (!restaurant) { _err('أدخل اسم المطعم'); return; }
    if (!address)    { _err('أدخل عنوان المطعم'); return; }

    // التحقق من رقم هاتف واحد على الأقل
    const phones = _extraPhones.map(p => p.trim()).filter(p => p.length > 7);
    if (phones.length === 0) { _err('أدخل رقم هاتف واحد على الأقل للمطعم'); return; }

    // التحقق من رقم الـ PIN
    const pin = (document.getElementById('ob-pin')?.value || '').trim();
    if (!/^\d{4}$/.test(pin)) { _err('أدخل رقم PIN مكوّن من 4 أرقام فقط'); return; }

    // حفظ في localStorage
    localStorage.setItem('solo_user_restaurant',  restaurant);
    localStorage.setItem('solo_user_address',     address);
    localStorage.setItem('solo_user_extra_phones',JSON.stringify(phones));
    localStorage.setItem('solo_onboarding_plan',  _selectedPlan);
    localStorage.setItem('solo_onboarding_done',  'true');
    localStorage.setItem('solo_user_pin',         pin);

    // ── حفظ البيانات بتنسيق السيستم (Settings + DataManager) ────────────────
    localStorage.setItem('solo_store_name', restaurant);
    localStorage.setItem('storeSettings', JSON.stringify({
      address: address,
      phone:   phones[0] || '',
    }));

    // ── حفظ الـ PIN والـ restaurant في users doc فقط (backup) ──────────────
    // ⚠️ لا نكتب في subscriptions هنا — _registerNewUser() هو اللي يعملها بالكامل.
    //    لو كتبنا subscriptions هنا (حتى merge:true) هيلاقيها موجودة ويـskip التسجيل!
    try {
      const uid = window.firebase?.auth?.()?.currentUser?.uid;
      if (uid && window.firestoreReady) {
        window.firestoreReady.then(db => {
          db.collection('users').doc(uid).set({
            restaurant,
            pin,
          }, { merge: true }).catch(() => {});
        }).catch(() => {});
        // حفظ الباقة في localStorage عشان subscription-manager يشوفها
        localStorage.setItem('saas_plan', _selectedPlan);
      }
    } catch (e) {}

    // ── حفظ بيانات المطعم في Firestore settings ────────────────────────────
    // بنأخر شوية عشان Firebase auth يكون ready (subscription-manager بيشغله)
    setTimeout(() => {
      try {
        if (window.FirestoreService?.updateSettings) {
          window.FirestoreService.updateSettings({
            storeName: restaurant,
            address:   address,
            phone:     phones[0] || '',
          }).catch(() => {});
        }
        // تحديث localStorage settings بنفس الـ keys اللي بيقراها settings.html
        const existingSettings = JSON.parse(localStorage.getItem('settings') || '{}');
        localStorage.setItem('settings', JSON.stringify({
          ...existingSettings,
          storeName: restaurant,
          address:   address,
          phone:     phones[0] || '',
        }));
      } catch (e) {}
    }, 2500);

    // شاشة النجاح
    _showSuccess(restaurant);

    // تشغيل البرنامج بعد ثانيتين
    setTimeout(() => {
      document.body.style.overflow = '';
      document.getElementById('saas-onboarding')?.remove();
      document.getElementById('saas-ob-styles')?.remove();
      if (typeof _callback === 'function') _callback();
    }, 2200);
  }

  // ── Success Screen ────────────────────────────────────────────────
  function _showSuccess(name) {
    const wrap = document.getElementById('saas-onboarding');
    if (!wrap) return;
    wrap.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;
        justify-content:center;flex-direction:column;text-align:center;padding:40px;">
        <div style="width:88px;height:88px;background:${GREEN}18;border:2px solid ${GREEN}44;
          border-radius:50%;display:flex;align-items:center;justify-content:center;
          margin:0 auto 22px;animation:ob-scale .5s cubic-bezier(.175,.885,.32,1.275);">
          <i class="fas fa-check" style="font-size:36px;color:${GREEN};"></i>
        </div>
        <h2 style="color:#1a1a1a;font-size:26px;font-weight:800;margin:0 0 10px;">
          أهلاً وسهلاً ${name}! 🎉
        </h2>
        <p style="color:#888;font-size:14px;margin:0 0 24px;">جاري تجهيز حسابك...</p>
        <div style="width:220px;height:4px;background:#e8e8e8;border-radius:2px;overflow:hidden;">
          <div style="height:100%;background:${GOLD};border-radius:2px;
            animation:ob-load 2s linear forwards;"></div>
        </div>
      </div>
      <style>@keyframes ob-load{from{width:0}to{width:100%}}</style>
    `;
  }

  // ── Helpers ───────────────────────────────────────────────────────
  function _err(msg) {
    const el = document.getElementById('ob-err');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => { if (el) el.style.display = 'none'; }, 3500);
  }

  function _next() {
    if (_step === 2) { _validatePhone(); return; }
    _step = Math.min(_step + 1, 4);
    _render();
  }

  function _prev() {
    if (_step === 3) { _otpSent = false; _step = 2; _render(); return; }
    _step = Math.max(_step - 1, 0);
    _render();
  }

  // ════════════════════════════════════════════════════════════════
  // Public API
  // ════════════════════════════════════════════════════════════════
  window.SaaSOnboardingUI = {
    show,
    _next,
    _prev,
    _selectPlan,
    _validatePhone,
    _sendOtp,
    _verifyOtp,
    _resendOtp,
    _changePhone,
    _submitSetup,
    _addPhone,
    _removePhone,
    _setPhone,
    _switchToLogin,
    _handleGoogleRegister,
  };

})();
