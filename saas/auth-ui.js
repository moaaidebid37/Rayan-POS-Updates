/**
 * Solo POS — SaaS Auth UI (Light Premium Edition)
 */
(function () {
  'use strict';

  function show() {
    _blockBody();
    const modal = _createModal();
    document.body.appendChild(modal);
    _injectStyles();
    _renderSplash(modal);
  }

  function _renderSplash(modal) {
    const decos = modal.querySelectorAll('.saas-deco-circle');
    modal.innerHTML = '';
    decos.forEach(d => modal.appendChild(d));

    const card = document.createElement('div');
    card.className = 'saas-card';
    card.innerHTML = `
      <div class="saas-header">
        <div class="saas-logo-wrap"><img src="images/logo.png" alt="Solo POS" style="width:40px;height:40px;object-fit:contain;border-radius:10px;"></div>
        <h1>Solo POS</h1>
        <p>نظام نقاط البيع</p>
      </div>

      <div class="saas-form-card">
        <h2>أهلاً بك 👋</h2>
        <p class="sub">هل لديك حساب مسبق مع Solo POS؟</p>

        <button id="saas-has-account" class="saas-btn-primary">
          <i class="fas fa-sign-in-alt"></i>
          <span>نعم، سجّل دخولك</span>
        </button>

        <div class="saas-divider"><span>أو</span></div>

        <button id="saas-no-account" class="saas-btn-google">
          <i class="fas fa-user-plus" style="margin-left:8px;color:#555;"></i>
          <span>لا، إنشاء حساب جديد</span>
        </button>
      </div>

      <div class="saas-footer">Solo System © 2026</div>
    `;
    modal.appendChild(card);

    document.getElementById('saas-has-account').onclick = () => {
      localStorage.setItem('_soloAuthMode', 'login');
      _renderPhoneStep(modal);
    };
    document.getElementById('saas-no-account').onclick = () => {
      localStorage.setItem('_soloAuthMode', 'register');
      modal.remove();
      document.body.style.overflow = '';
      if (window.SaaSOnboardingUI) {
        window.SaaSOnboardingUI.show(() => {
          window._saasInitRunning = false;
          window._saasInitDone = false;
          window.SaaS && window.SaaS.init();
        });
      }
    };
  }

  function _blockBody() {
    document.body.style.overflow = 'hidden';
    document.getElementById('saas-blocking-screen')?.remove();
    document.getElementById('activationModal')?.remove();
  }

  function _injectStyles() {
    if (document.getElementById('saas-auth-styles')) return;
    const style = document.createElement('style');
    style.id = 'saas-auth-styles';
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300&family=Cairo:wght@400;600;700&display=swap');

      #saas-blocking-screen {
        position:fixed;inset:0;z-index:99999;
        background:#f5f0e8;
        display:flex;align-items:center;justify-content:center;
        font-family:'DM Sans','Cairo',sans-serif;
        overflow:hidden;
      }

      /* نقاط خلفية ناعمة */
      #saas-blocking-screen::before {
        content:'';position:absolute;inset:0;
        background-image:radial-gradient(circle, #d4c9b0 1px, transparent 1px);
        background-size:28px 28px;
        opacity:.5;
      }

      /* شكل دائري زخرفي */
      .saas-deco-circle {
        position:absolute;
        border-radius:50%;
        pointer-events:none;
      }
      .saas-deco-1 {
        width:500px;height:500px;
        top:-120px;right:-120px;
        background:radial-gradient(circle, rgba(0,0,0,.04) 0%, transparent 70%);
      }
      .saas-deco-2 {
        width:300px;height:300px;
        bottom:-80px;left:-80px;
        background:radial-gradient(circle, rgba(0,0,0,.03) 0%, transparent 70%);
      }

      @keyframes saasFadeUp {
        from{opacity:0;transform:translateY(32px);}
        to{opacity:1;transform:translateY(0);}
      }
      @keyframes saasLogoIn {
        from{opacity:0;transform:scale(.8) rotate(-8deg);}
        to{opacity:1;transform:scale(1) rotate(0deg);}
      }

      .saas-card {
        position:relative;z-index:1;
        width:460px;max-width:92vw;
        animation:saasFadeUp .55s cubic-bezier(.16,1,.3,1) both;
        display:flex;flex-direction:column;gap:0;
      }

      /* الهيدر */
      .saas-header {
        text-align:center;
        margin-bottom:28px;
        animation:saasFadeUp .55s cubic-bezier(.16,1,.3,1) .05s both;
        opacity:0;
      }
      .saas-logo-wrap {
        width:90px;height:90px;
        background:transparent;
        border-radius:22px;
        display:flex;align-items:center;justify-content:center;
        margin:0 auto 18px;
        animation:saasLogoIn .6s cubic-bezier(.34,1.56,.64,1) .1s both;
        opacity:0;
      }
      .saas-logo-wrap img{width:90px;height:90px;object-fit:contain;border-radius:22px;}
      .saas-header h1 {
        font-family:'Syne',sans-serif;
        font-size:30px;font-weight:800;
        color:#111;margin:0 0 6px;
        letter-spacing:-1px;
      }
      .saas-header p {
        font-size:13px;color:#999;margin:0;
        letter-spacing:.5px;text-transform:uppercase;
      }

      /* البطاقة */
      .saas-form-card {
        background:#fff;
        border:1px solid #e8e0d0;
        border-radius:28px;
        padding:36px;
        box-shadow:0 2px 4px rgba(0,0,0,.04), 0 20px 60px rgba(0,0,0,.08);
        animation:saasFadeUp .55s cubic-bezier(.16,1,.3,1) .1s both;
        opacity:0;
      }
      .saas-form-card h2 {
        font-family:'Syne',sans-serif;
        font-size:22px;font-weight:700;
        color:#111;margin:0 0 4px;
        letter-spacing:-.5px;
      }
      .saas-form-card p.sub {
        font-size:14px;color:#aaa;margin:0 0 28px;
      }

      /* الحقل */
      .saas-field{margin-bottom:16px;}
      .saas-field label {
        display:block;font-size:11px;font-weight:700;
        color:#bbb;text-transform:uppercase;letter-spacing:1.2px;
        margin-bottom:8px;text-align:right;
      }
      .saas-input-wrap{display:flex;gap:8px;}
      .saas-prefix {
        flex-shrink:0;padding:0 16px;
        background:#f7f4ef;
        border:1.5px solid #e8e0d0;
        border-radius:14px;color:#999;
        font-size:14px;font-weight:600;
        display:flex;align-items:center;
      }
      .saas-input {
        flex:1;padding:14px 16px;
        background:#f7f4ef;
        border:1.5px solid #e8e0d0;
        border-radius:14px;
        color:#111;font-size:15px;
        font-family:inherit;
        transition:border-color .15s,box-shadow .15s,background .15s;
        outline:none;direction:ltr;
      }
      .saas-input::placeholder{color:#ccc;}
      .saas-input:focus{
        border-color:#111;
        background:#fff;
        box-shadow:0 0 0 3px rgba(0,0,0,.06);
      }

      /* OTP */
      .saas-otp-input {
        width:100%;padding:20px;box-sizing:border-box;
        background:#f7f4ef;
        border:1.5px solid #e8e0d0;
        border-radius:14px;
        color:#111;font-size:36px;font-weight:800;
        text-align:center;letter-spacing:12px;
        font-family:'Cairo',sans-serif;
        outline:none;
        transition:border-color .15s,box-shadow .15s;
        margin-bottom:4px;
      }
      .saas-otp-input:focus{
        border-color:#111;
        box-shadow:0 0 0 3px rgba(0,0,0,.06);
      }

      /* الأزرار */
      .saas-btn-primary {
        width:100%;padding:16px;
        background:#111;
        border:none;border-radius:14px;
        color:#f5f0e8;font-size:15px;font-weight:700;
        font-family:inherit;cursor:pointer;
        display:flex;align-items:center;justify-content:center;gap:10px;
        transition:background .2s,transform .15s,box-shadow .2s;
        box-shadow:0 4px 20px rgba(0,0,0,.15);
        margin-top:8px;letter-spacing:-.2px;
      }
      .saas-btn-primary:hover:not(:disabled){
        background:#222;
        transform:translateY(-1px);
        box-shadow:0 8px 28px rgba(0,0,0,.2);
      }
      .saas-btn-primary:active{transform:translateY(0);}
      .saas-btn-primary:disabled{opacity:.4;cursor:not-allowed;transform:none;}

      .saas-btn-google {
        width:100%;padding:14px;
        background:#fff;
        border:1.5px solid #e8e0d0;
        border-radius:14px;
        color:#555;font-size:14px;
        font-weight:500;font-family:inherit;cursor:pointer;
        display:flex;align-items:center;justify-content:center;gap:10px;
        transition:border-color .2s,box-shadow .2s,background .2s;
        margin-top:10px;
      }
      .saas-btn-google:hover{
        border-color:#ccc;
        background:#fafaf8;
        box-shadow:0 2px 10px rgba(0,0,0,.06);
      }

      .saas-btn-ghost {
        width:100%;padding:13px;
        background:transparent;
        border:1.5px solid #e8e0d0;
        border-radius:14px;
        color:#bbb;font-size:13px;
        font-family:inherit;cursor:pointer;
        transition:color .2s,border-color .2s,background .2s;
        margin-top:10px;
      }
      .saas-btn-ghost:hover{
        color:#666;border-color:#ccc;background:#fafaf8;
      }

      /* فاصل */
      .saas-divider {
        display:flex;align-items:center;gap:14px;
        margin:20px 0 4px;
      }
      .saas-divider::before,.saas-divider::after{
        content:'';flex:1;height:1px;background:#ece6d8;
      }
      .saas-divider span{color:#ccc;font-size:12px;white-space:nowrap;}

      /* رسائل */
      .saas-msg{
        min-height:20px;margin-top:14px;
        font-size:13px;font-weight:500;text-align:center;
      }

      /* chip الهاتف */
      .saas-phone-chip {
        background:#f7f4ef;
        border:1.5px solid #e8e0d0;
        border-radius:12px;padding:12px 16px;
        color:#111;font-size:18px;font-weight:800;
        text-align:center;letter-spacing:3px;
        direction:ltr;margin-bottom:20px;
        font-family:'Cairo',sans-serif;
      }

      /* فوتر */
      .saas-footer {
        text-align:center;margin-top:20px;
        font-size:12px;color:#ccc;
      }
    `;
    document.head.appendChild(style);
  }

  function _createModal() {
    const el = document.createElement('div');
    el.id = 'saas-blocking-screen';
    el.innerHTML = `<div class="saas-deco-circle saas-deco-1"></div><div class="saas-deco-circle saas-deco-2"></div>`;
    return el;
  }

  function _renderPhoneStep(modal) {
    // احتفظ بالديكور
    const decos = modal.querySelectorAll('.saas-deco-circle');
    modal.innerHTML = '';
    decos.forEach(d => modal.appendChild(d));

    const card = document.createElement('div');
    card.className = 'saas-card';
    card.innerHTML = `
      <div class="saas-header">
        <div class="saas-logo-wrap"><img src="images/logo.png" alt="Solo POS" style="width:40px;height:40px;object-fit:contain;border-radius:10px;"></div>
        <h1>Solo POS</h1>
        <p>نظام نقاط البيع</p>
      </div>

      <div class="saas-form-card">
        <h2>مرحباً بك 👋</h2>
        <p class="sub">أدخل رقم موبايلك للمتابعة</p>

        <div class="saas-field">
          <label>رقم الموبايل</label>
          <div class="saas-input-wrap">
            <input id="saas-phone" type="tel" class="saas-input"
              placeholder="01XXXXXXXXX" autocomplete="tel" />
            <div class="saas-prefix">+20</div>
          </div>
        </div>

        <button id="saas-send-otp" class="saas-btn-primary">
          <i class="fas fa-arrow-left"></i>
          <span>إرسال كود التحقق</span>
        </button>

        <div class="saas-divider"><span>أو</span></div>

        <button id="saas-google-btn" class="saas-btn-google">
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.7 33.1 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.5 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.3-.1-2.7-.1-4z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.5 29.4 4 24 4c-7.8 0-14.5 4.3-17.7 10.7z"/>
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.5-4.9L31 33.6C29.1 35 26.6 36 24 36c-5.3 0-9.7-2.9-11.3-7.1l-6.6 5.1C9.5 39.6 16.3 44 24 44z"/>
            <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.8 2.2-2.3 4.1-4.3 5.4l6.5 5.1C41.1 35.1 44 30 44 24c0-1.3-.1-2.7-.4-4z"/>
          </svg>
          الدخول بحساب Google
        </button>

        <div id="saas-auth-msg" class="saas-msg"></div>
        <div id="recaptcha-container"></div>

        <div style="text-align:center;margin-top:16px;display:flex;flex-direction:column;gap:8px;">
          <button id="saas-to-register" style="background:none;border:none;color:#555;font-size:13px;cursor:pointer;text-decoration:underline;font-family:inherit;padding:4px;">
            ليس لديك حساب؟ أنشئ حساباً الآن
          </button>
          <button id="saas-back-to-splash" style="background:none;border:none;color:#888;font-size:12px;cursor:pointer;font-family:inherit;padding:4px;">
            ← رجوع
          </button>
        </div>
      </div>

      <div class="saas-footer">Solo System © 2026</div>
    `;
    modal.appendChild(card);

    document.getElementById('saas-send-otp').onclick = () => _handleSendOTP(modal);
    document.getElementById('saas-google-btn').onclick = () => _handleGoogle(modal);
    document.getElementById('saas-phone').addEventListener('keypress', e => {
      if (e.key === 'Enter') _handleSendOTP(modal);
    });
    document.getElementById('saas-to-register').onclick = () => {
      localStorage.setItem('_soloAuthMode', 'register');
      modal.remove();
      document.body.style.overflow = '';
      if (window.SaaSOnboardingUI) {
        window.SaaSOnboardingUI.show(() => {
          window._saasInitRunning = false;
          window._saasInitDone = false;
          window.SaaS && window.SaaS.init();
        });
      }
    };
    document.getElementById('saas-back-to-splash').onclick = () => _renderSplash(modal);
    setTimeout(() => {
      document.getElementById('saas-phone')?.focus();
      // Google OAuth لا يعمل مع file:// في Electron — إخفاء الزرار
      if (window.require) {
        var divider = document.querySelector('.saas-divider');
        var googleBtn = document.getElementById('saas-google-btn');
        if (divider) divider.style.display = 'none';
        if (googleBtn) googleBtn.style.display = 'none';
      }
    }, 300);
  }

  function _renderOTPStep(modal, phone, confirmResult, isElectron, fallbackCode = null) {
    const decos = modal.querySelectorAll('.saas-deco-circle');
    modal.innerHTML = '';
    decos.forEach(d => modal.appendChild(d));

    const card = document.createElement('div');
    card.className = 'saas-card';
    card.innerHTML = `
      <div class="saas-header">
        <div class="saas-logo-wrap"><i class="fas fa-shield-alt"></i></div>
        <h1>تحقق من هويتك</h1>
        <p>Two-Factor Authentication</p>
      </div>

      <div class="saas-form-card">
        <h2>أدخل الكود 🔐</h2>
        <p class="sub">تم إرسال كود من 6 أرقام إلى</p>
        <div class="saas-phone-chip">+20 ${phone}</div>

        ${fallbackCode ? `<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:10px;padding:10px 14px;margin:10px 0;text-align:center;direction:rtl;">
          <div style="font-size:11px;color:#856404;margin-bottom:4px;">⚠️ الواتساب مش متصل — كود التجربة:</div>
          <div style="font-size:24px;font-weight:800;color:#1a1a1a;letter-spacing:4px;">${fallbackCode}</div>
        </div>` : ''}

        <input id="saas-otp" type="number" class="saas-otp-input"
          placeholder="——————" />

        <button id="saas-verify-otp" class="saas-btn-primary" style="margin-top:18px;">
          <i class="fas fa-check"></i>
          <span>تأكيد الكود</span>
        </button>

        <button id="saas-back-btn" class="saas-btn-ghost">
          ← تغيير الرقم
        </button>

        <div id="saas-auth-msg" class="saas-msg"></div>
      </div>

      <div class="saas-footer">Solo System © 2026</div>
    `;
    modal.appendChild(card);

    document.getElementById('saas-verify-otp').onclick = () => _handleVerifyOTP(modal, confirmResult, isElectron);
    document.getElementById('saas-back-btn').onclick = () => _renderPhoneStep(modal);
    document.getElementById('saas-otp').addEventListener('keypress', e => {
      if (e.key === 'Enter') _handleVerifyOTP(modal, confirmResult, isElectron);
    });
    setTimeout(() => document.getElementById('saas-otp')?.focus(), 300);
  }

  let _recaptchaVerifier = null;

  // ── Electron: عطّل reCAPTCHA verification ────────────────
  // Electron مش browser حقيقي فـ reCAPTCHA مش بيشتغل فيه
  // SMS هيفضل يتبعت عادي
  function _disableAppVerification() {
    try {
      if (window.require && firebase.auth) {
        firebase.auth().settings.appVerificationDisabledForTesting = true;
        console.log('✅ reCAPTCHA disabled for Electron');
      }
    } catch(e) {}
  }
  _disableAppVerification();

  async function _handleSendOTP(modal) {
    let phone = document.getElementById('saas-phone')?.value?.trim().replace(/[^0-9]/g, '');
    if (!phone || phone.length < 10) { _setMsg('يرجى إدخال رقم موبايل صحيح', 'error'); return; }
    if (phone.startsWith('0')) phone = phone.slice(1);

    const mode = localStorage.getItem('_soloAuthMode') || 'login';
    const fullPhone = '+20' + phone;

    // ── فحص وجود الحساب قبل إرسال الـ OTP ──────────────────────────────────
    // في Electron: الفحص بيتم server-side عبر Admin SDK (أدق وبيتخطى rules)
    // في Web: لازم نفحص client-side لأن مفيش IPC
    const isElectronEnv = !!window.require;
    if (!isElectronEnv) {
      _setBtnLoading('saas-send-otp', true, 'جاري الفحص...');
      try {
        const db = await window.firestoreReady;
        const snap = await db.collection('subscriptions').where('phone', '==', fullPhone).limit(1).get();
        const exists = !snap.empty;

        if (mode === 'register' && exists) {
          _setMsg('هذا الرقم مسجّل بالفعل. سجّل دخولك بدلاً من إنشاء حساب جديد.', 'error');
          const msgEl = document.getElementById('saas-auth-msg');
          if (msgEl) msgEl.innerHTML += `<br><button onclick="
            localStorage.setItem('_soloAuthMode','login');
            document.getElementById('saas-auth-msg').innerHTML='';
            document.getElementById('saas-phone').value='${phone}';
          " style="margin-top:8px;background:none;border:none;color:#c8a84b;font-size:13px;cursor:pointer;text-decoration:underline;font-family:inherit;">
            تسجيل الدخول بهذا الرقم ←
          </button>`;
          _setBtnLoading('saas-send-otp', false);
          return;
        }

        if (mode === 'login' && !exists) {
          _setMsg('هذا الرقم غير مسجّل. يرجى إنشاء حساب جديد أولاً.', 'error');
          const msgEl = document.getElementById('saas-auth-msg');
          if (msgEl) msgEl.innerHTML += `<br><button onclick="
            document.getElementById('saas-blocking-screen')?.remove();
            localStorage.setItem('_soloAuthMode','register');
            window._saasInitRunning=false; window._saasInitDone=false;
            if(window.SaaSOnboardingUI) window.SaaSOnboardingUI.show();
          " style="margin-top:8px;background:none;border:none;color:#c8a84b;font-size:13px;cursor:pointer;text-decoration:underline;font-family:inherit;">
            إنشاء حساب جديد ←
          </button>`;
          _setBtnLoading('saas-send-otp', false);
          return;
        }
      } catch(e) {
        console.warn('Phone check failed:', e);
        _setMsg('تعذر التحقق من الرقم. تأكد من اتصالك بالإنترنت وحاول مرة أخرى.', 'error');
        _setBtnLoading('saas-send-otp', false);
        return;
      }
    }

    _setBtnLoading('saas-send-otp', true, 'جاري الإرسال...');
    try {
      if (window.require) {
        const { ipcRenderer } = window.require('electron');
        const result = await ipcRenderer.invoke('send-otp', phone, mode);
        if (result.success) {
          _renderOTPStep(modal, phone, null, true, result.fallbackCode || null);
        } else {
          _setMsg(result.error || 'فشل الإرسال', 'error');
          // إضافة زر تحويل لو الخطأ متعلق بوجود/عدم وجود الحساب
          const msgEl = document.getElementById('saas-auth-msg');
          if (msgEl && result.error) {
            if (result.error.includes('غير مسجّل') && mode === 'login') {
              msgEl.innerHTML += `<br><button onclick="
                document.getElementById('saas-blocking-screen')?.remove();
                localStorage.setItem('_soloAuthMode','register');
                window._saasInitRunning=false; window._saasInitDone=false;
                if(window.SaaSOnboardingUI) window.SaaSOnboardingUI.show();
              " style="margin-top:8px;background:none;border:none;color:#c8a84b;font-size:13px;cursor:pointer;text-decoration:underline;font-family:inherit;">
                إنشاء حساب جديد ←
              </button>`;
            } else if (result.error.includes('مسجّل بالفعل') && mode === 'register') {
              msgEl.innerHTML += `<br><button onclick="
                localStorage.setItem('_soloAuthMode','login');
                document.getElementById('saas-auth-msg').innerHTML='';
                document.getElementById('saas-phone').value='${phone}';
              " style="margin-top:8px;background:none;border:none;color:#c8a84b;font-size:13px;cursor:pointer;text-decoration:underline;font-family:inherit;">
                تسجيل الدخول بهذا الرقم ←
              </button>`;
            }
          }
          _setBtnLoading('saas-send-otp', false);
        }
      } else {
        if (!_recaptchaVerifier)
          _recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', { size: 'invisible' });
        const res = await firebase.auth().signInWithPhoneNumber('+20' + phone, _recaptchaVerifier);
        _renderOTPStep(modal, phone, res, false);
      }
    } catch (err) {
      console.error('OTP Error:', err);
      _setMsg(_friendlyError(err.code || 'unknown'), 'error');
      _setBtnLoading('saas-send-otp', false);
    }
  }

  async function _handleVerifyOTP(modal, confirmResult, isElectron) {
    const code = document.getElementById('saas-otp')?.value?.trim();
    if (!code || code.length !== 6) { _setMsg('يرجى إدخال الكود المكون من 6 أرقام', 'error'); return; }
    _setBtnLoading('saas-verify-otp', true, 'جاري التحقق...');
    try {
      if (isElectron && window.require) {
        const { ipcRenderer } = window.require('electron');
        const phone = document.querySelector('.saas-phone-chip')?.textContent?.replace('+20 ', '').trim() || '';
        const currentMode = localStorage.getItem('_soloAuthMode') || 'login';
        const result = await ipcRenderer.invoke('verify-otp', phone, code, currentMode);
        if (result.success) {
          await firebase.auth().signInWithCustomToken(result.customToken);
          // خزّن الرقم بصيغة كاملة عشان _registerNewUser يقدر يعمل فحص التكرار
          const fullPhone = '+20' + phone.replace(/^0/, '');
          localStorage.setItem('solo_user_phone', fullPhone);
          // حط isLoggedIn
          localStorage.setItem('isLoggedIn', 'true');
          localStorage.setItem('userRole', 'owner');
          localStorage.setItem('userType', 'owner');
          localStorage.setItem('username', result.phone || 'المستخدم');
          // لا تمسح _soloAuthMode هنا — _registerNewUser محتاجه لفحص التكرار
          _setMsg('✅ تم! جاري التحميل...', 'success');
          // مش محتاج navigate — subscription-manager هيكتشف الـ user ويفتح البرنامج
          setTimeout(() => {
            window._saasInitRunning = false;
            window._saasInitDone = false;
            if (window.SaaS) {
              window.SaaS.init();
            }
          }, 500);
        } else {
          _setMsg(result.error || 'الكود غير صحيح', 'error');
          _setBtnLoading('saas-verify-otp', false);
        }
      } else {
        await confirmResult.confirm(code);
        // خزّن الرقم بصيغة موحدة عشان _registerNewUser يقدر يعمل فحص التكرار
        const webPhone = document.querySelector('.saas-phone-chip')?.textContent?.replace('+20 ', '').trim() || '';
        if (webPhone) localStorage.setItem('solo_user_phone', '+20' + webPhone.replace(/^0/, ''));
        // لا تمسح _soloAuthMode هنا — subscription-manager محتاجه
        _setMsg('✅ تم! جاري التحميل...', 'success');
        setTimeout(() => {
          window._saasInitRunning = false;
          window._saasInitDone = false;
          if (window.SaaS) { window.SaaS.init(); }
          else { window.location.replace('index.html'); }
        }, 1200);
      }
    } catch (err) {
      console.error('Verify error:', err);
      _setMsg(_friendlyError(err.code), 'error');
      _setBtnLoading('saas-verify-otp', false);
    }
  }

  async function _handleGoogle(modal) {
    _setBtnLoading('saas-google-btn', true, 'جاري الفتح...');
    try {
      // Electron: افتح نافذة منفصلة للـ Google auth
      if (window.require) {
        const { ipcRenderer } = window.require('electron');

        // اطلب فتح نافذة google-auth.html من الـ main process
        const data = await ipcRenderer.invoke('open-google-auth');

        // سجّل الدخول بالـ token اللي رجع
        const credential = firebase.auth.GoogleAuthProvider.credential(data.idToken);
        await firebase.auth().signInWithCredential(credential);

        _setMsg('✅ تم الدخول! جاري التحميل...', 'success');
        setTimeout(() => {
          window._saasInitRunning = false;
          window._saasInitDone = false;
          if (window.SaaS) { window.SaaS.init(); }
          else { window.location.replace('index.html'); }
        }, 1200);

      } else {
        // Browser عادي — popup يشتغل عادي
        await firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider());
        _setMsg('✅ تم الدخول! جاري التحميل...', 'success');
        setTimeout(() => {
          window._saasInitRunning = false;
          window._saasInitDone = false;
          if (window.SaaS) { window.SaaS.init(); }
          else { window.location.replace('index.html'); }
        }, 1200);
      }
    } catch (err) {
      if (err.message === 'window-closed') {
        _setMsg('تم إغلاق نافذة الدخول', 'error');
      } else {
        _setMsg(_friendlyError(err.code), 'error');
      }
      _setBtnLoading('saas-google-btn', false);
    }
  }

  function _setMsg(text, type) {
    const el = document.getElementById('saas-auth-msg');
    if (!el) return;
    el.textContent = text;
    el.style.color = type === 'success' ? '#27ae60' : '#e74c3c';
  }

  function _setBtnLoading(id, loading, text) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = loading;
    if (loading && text) btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${text}`;
  }

  function _friendlyError(code) {
    return ({
      'auth/invalid-phone-number':      'رقم الموبايل غير صحيح',
      'auth/too-many-requests':         'كتر الطلبات، حاول بعد شوية',
      'auth/invalid-verification-code': 'الكود غير صحيح',
      'auth/code-expired':              'انتهت صلاحية الكود، اطلب كود جديد',
      'auth/popup-closed-by-user':      'تم إغلاق نافذة الدخول',
      'auth/network-request-failed':    'تأكد من اتصالك بالإنترنت',
    })[code] || 'حدث خطأ، حاول مرة أخرى';
  }

  window.SaaSAuthUI = { show };
})();