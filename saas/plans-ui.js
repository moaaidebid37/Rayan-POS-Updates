/**
 * Solo POS — SaaS Plans UI
 * =========================
 * كل شاشات الحجب: منتهي، أوفلاين، ترقية، جهاز خاطئ
 */

(function () {
  'use strict';

  const GOLD   = '#d4af37';
  const BG     = '#000000';
  const CARD   = '#1a1a1a';
  const BORDER = '#2a2a2a';
  const RED    = '#e74c3c';
  const GREEN  = '#27ae60';

  // ── الباقات ──────────────────────────────────────────────────────────────────
  // كل باقة تحتوي على قائمة المميزات الكاملة مع تحديد المفتوح/المقفول
  const ALL_FEATURES = [
    { text: 'الرئيسية (POS كامل)'       },
    { text: 'الأصناف والمنيو'            },
    { text: 'إدارة الطلبات'              },
    { text: 'تحليل المنيو بالـ AI 🤖'    },
    { text: 'التقارير والإحصائيات'       },
    { text: 'إدارة المخزون'              },
    { text: 'الموردين'                   },
    { text: 'إدارة الموظفين'             },
    { text: 'إدارة العملاء'              },
    { text: 'التسويق والواتساب'          },
    { text: 'شركات التوصيل'             },
  ];

  function _planFeatures(unlockedCount) {
    return ALL_FEATURES.map((f, i) => ({ text: f.text, locked: i >= unlockedCount }));
  }

  const PLANS = [
    {
      id:    'trial',
      label: 'تجربة مجانية',
      price: 'مجاني',
      days:  '30 يوم',
      color: '#4a9eff',
      features: _planFeatures(11),   // كل المميزات مفتوحة في التجربة
      cta:   'جرّب مجاناً',
    },
    {
      id:    'basic',
      label: 'Basic',
      price: '499 ج',
      period: '/شهر',
      color: GOLD,
      features: _planFeatures(4),    // أول 4 مميزات مفتوحة
      cta:   'ابدأ بـ Basic',
    },
    {
      id:    'pro',
      label: 'Pro',
      price: '799 ج',
      period: '/شهر',
      color: '#9b59b6',
      features: _planFeatures(8),    // أول 8 مميزات مفتوحة
      cta:   'ترقية لـ Pro',
    },
    {
      id:    'mega',
      label: 'Mega 🚀',
      price: '999 ج',
      period: '/شهر',
      color: '#e74c3c',
      badge: 'الأكثر مبيعاً',
      features: _planFeatures(11),   // كل المميزات مفتوحة
      cta:   'احصل على Mega 🚀',
    },
  ];

  // ══════════════════════════════════════════════════════════════════════════════
  // Shared helpers
  // ══════════════════════════════════════════════════════════════════════════════
  function _block() {
    document.body.style.overflow = 'hidden';
    document.getElementById('saas-blocking-screen')?.remove();
    document.getElementById('activationModal')?.remove();
  }

  function _modal(content) {
    const el = document.createElement('div');
    el.id = 'saas-blocking-screen';
    el.style.cssText = `
      position:fixed; top:0; left:0; width:100%; height:100%;
      background:${BG}; z-index:99999; overflow-y:auto;
      display:flex; align-items:center; justify-content:center;
      font-family:'Poppins','Cairo',-apple-system,sans-serif; padding:20px; box-sizing:border-box;
    `;
    el.innerHTML = content;
    document.body.appendChild(el);
    return el;
  }

  function _icon(name, color = GOLD) {
    return `<div style="
      width:72px;height:72px;background:${color}22;border:2px solid ${color}55;
      border-radius:50%;display:flex;align-items:center;justify-content:center;
      margin:0 auto 20px;
    "><i class="fas fa-${name}" style="font-size:30px;color:${color};"></i></div>`;
  }

  function _logoutBtn() {
    return `<button onclick="window.SaaS?.signOut()" style="
      background:transparent;border:none;color:#555;font-size:12px;
      cursor:pointer;margin-top:16px;text-decoration:underline;
    ">تسجيل الخروج</button>`;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 1. شاشة الاشتراك المنتهي + عرض الباقات
  // ══════════════════════════════════════════════════════════════════════════════
  function showExpired(currentPlan) {
    _block();

    const plansHTML = PLANS.filter(p => p.id !== 'trial').map(p => `
      <div style="
        background:${CARD}; border:2px solid ${p.color}44;
        border-radius:20px; padding:28px 24px; flex:1; min-width:240px;
        position:relative; text-align:center;
        transition:border-color .2s;
      " onmouseenter="this.style.borderColor='${p.color}'"
         onmouseleave="this.style.borderColor='${p.color}44'">

        ${p.badge ? `<div style="
          position:absolute;top:-12px;left:50%;transform:translateX(-50%);
          background:${p.color};color:#000;padding:4px 16px;border-radius:20px;
          font-size:12px;font-weight:700;white-space:nowrap;
        ">${p.badge}</div>` : ''}

        <h3 style="color:${p.color};font-size:18px;font-weight:700;margin:0 0 8px;">${p.label}</h3>
        <div style="margin-bottom:20px;">
          <span style="color:#fff;font-size:36px;font-weight:800;">${p.price}</span>
          ${p.period ? `<span style="color:#888;font-size:14px;">${p.period}</span>` : ''}
        </div>

        <ul style="list-style:none;padding:0;margin:0 0 24px;text-align:right;">
          ${p.features.map(f => `
            <li style="font-size:13px;padding:6px 0;border-bottom:1px solid ${BORDER};
              color:${f.locked ? '#444' : '#ccc'};
              ${f.locked ? 'text-decoration:line-through;opacity:0.5;' : ''}">
              <i class="fas fa-${f.locked ? 'times' : 'check'}"
                 style="color:${f.locked ? '#444' : GREEN};margin-left:8px;"></i>${f.text}
            </li>
          `).join('')}
        </ul>

        <button onclick="window.SaaSPlansUI._handleUpgrade('${p.id}')" style="
          width:100%;padding:14px;background:${p.color};
          border:none;border-radius:12px;color:#000;
          font-size:15px;font-weight:700;cursor:pointer;
        ">${p.cta}</button>
      </div>
    `).join('');

    _modal(`
      <div style="max-width:800px;width:100%;text-align:center;">
        ${_icon('clock', RED)}
        <h1 style="color:#fff;font-size:28px;font-weight:800;margin:0 0 8px;">
          انتهت صلاحية اشتراكك
        </h1>
        <p style="color:#888;font-size:15px;margin:0 0 40px;">
          اختر الباقة المناسبة لمتابعة العمل
        </p>

        <div style="display:flex;gap:20px;flex-wrap:wrap;justify-content:center;margin-bottom:20px;">
          ${plansHTML}
        </div>

        ${_logoutBtn()}
      </div>
    `);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 2. شاشة الترقية (من داخل البرنامج)
  // ══════════════════════════════════════════════════════════════════════════════
 
  function showUpgradeOptions(msg) {
    document.getElementById('saas-upgrade-popup')?.remove();

    const PLAN_ORDER = { trial: 0, basic: 1, pro: 2, mega: 3 };
    const currentPlan  = (window.SaaS && window.SaaS.getState && window.SaaS.getState().plan) || 'trial';
    const promo        = (window.SaaS && window.SaaS.getState && window.SaaS.getState().promo) || null;
    const currentData  = PLANS.find(p => p.id === currentPlan);

    // حساب السعر بعد الخصم
    function _applyPromo(priceStr) {
      if (!promo || !promo.value) return { finalStr: priceStr, origStr: null, badge: null };
      const price = parseInt(priceStr);
      const final = promo.type === 'percent'
        ? Math.round(price * (1 - promo.value / 100))
        : Math.max(0, price - promo.value);
      const badge = promo.type === 'percent' ? promo.value + '% خصم 🎉' : 'خصم ' + promo.value + ' ج';
      return { finalStr: final + ' ج', origStr: priceStr, badge };
    }

    // كل الباقات المدفوعة الـ 3 دايماً
    const allPaidPlans = PLANS.filter(p => p.id !== 'trial');
    if (!allPaidPlans.length) return;

    const cardsHtml = allPaidPlans.map(p => {
      const isCurrent = p.id === currentPlan;
      const pricing   = _applyPromo(p.price);

      // لابل فوق الكارت: "باقتك الحالية" للباقة الحالية، "الأكثر مبيعاً 🔥" للـ Mega
      const topLabel = isCurrent
        ? `<div style="position:absolute;top:-13px;left:50%;transform:translateX(-50%);
            background:${p.color};color:#fff;
            padding:4px 14px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;
            box-shadow:0 2px 8px ${p.color}55;">باقتك الحالية</div>`
        : (p.id === 'mega'
            ? `<div style="position:absolute;top:-13px;left:50%;transform:translateX(-50%);
                background:linear-gradient(135deg,#e74c3c,#c0392b);color:#fff;
                padding:4px 16px;border-radius:20px;font-size:11px;font-weight:800;white-space:nowrap;
                box-shadow:0 3px 12px rgba(231,76,60,0.5);
                animation:megaPulse 2s ease-in-out infinite;">🔥 الأكثر مبيعاً</div>`
            : '');

      const priceSectionHtml = pricing.origStr ? `
        <div style="margin-bottom:16px;">
          ${pricing.badge ? `<div style="background:${p.color};color:#fff;font-size:10px;font-weight:700;
            padding:2px 10px;border-radius:20px;display:inline-block;margin-bottom:5px;">${pricing.badge}</div>` : ''}
          <div style="font-size:13px;color:#bbb;text-decoration:line-through;line-height:1.3;">${pricing.origStr}</div>
          <div>
            <span style="font-size:32px;font-weight:800;color:#111;line-height:1.1;">${pricing.finalStr}</span>
            <span style="font-size:12px;color:#999;">${p.period || ''}</span>
          </div>
        </div>` : `
        <div style="margin-bottom:16px;">
          <span style="font-size:32px;font-weight:800;color:#111;line-height:1;">${p.price}</span>
          <span style="font-size:12px;color:#999;font-weight:500;">${p.period || ''}</span>
        </div>`;

      return `
        <div
          onmouseenter="this.style.boxShadow='0 8px 32px ${p.color}44';this.style.border='2px solid ${p.color}';this.style.transform='translateY(-6px)';"
          onmouseleave="this.style.boxShadow='0 2px 12px rgba(0,0,0,0.07)';this.style.border='2px solid #f0f0f0';this.style.transform='none';"
          style="
            background:#fff;border-radius:20px;
            padding:24px 18px 20px;
            flex:1;min-width:160px;max-width:220px;
            text-align:center;position:relative;
            box-shadow:0 2px 12px rgba(0,0,0,0.07);
            border:2px solid #f0f0f0;
            display:flex;flex-direction:column;
            transition:box-shadow .2s,border .2s,transform .2s;
          ">
          ${topLabel}
          <div style="width:44px;height:44px;border-radius:12px;margin:0 auto 12px;
            background:${p.color}18;display:flex;align-items:center;justify-content:center;">
            <i class="fas fa-${p.id==='basic'?'store':p.id==='pro'?'chart-line':'rocket'}"
               style="font-size:20px;color:${p.color};"></i>
          </div>
          <div style="color:${p.color};font-size:13px;font-weight:700;margin-bottom:4px;">${p.label}</div>
          ${priceSectionHtml}
          <ul style="list-style:none;padding:0;margin:0 0 18px;text-align:right;flex:1;">
            ${p.features.map(f => `
              <li style="font-size:12px;padding:5px 0;border-bottom:1px solid #f5f5f5;
                display:flex;align-items:center;gap:7px;
                color:${f.locked ? '#ccc' : '#555'};
                ${f.locked ? 'opacity:0.55;text-decoration:line-through;' : ''}">
                <i class="fas fa-${f.locked ? 'times-circle' : 'check-circle'}"
                   style="color:${f.locked ? '#ddd' : p.color};font-size:11px;flex-shrink:0;"></i>
                <span>${f.text}</span>
              </li>`).join('')}
          </ul>
          <button onclick="window.SaaSPlansUI._handleUpgrade('${p.id}')" style="
            width:100%;padding:11px;
            background:transparent;
            border:2px solid ${p.color};border-radius:12px;
            color:${p.color};
            font-size:13px;font-weight:700;cursor:pointer;
            font-family:'Cairo',sans-serif;transition:all .2s;
          " onmouseenter="this.style.background='${p.color}';this.style.color='#fff';"
             onmouseleave="this.style.background='transparent';this.style.color='${p.color}';">
            ${p.cta}
          </button>
        </div>`;
    }).join('');

    const currentPill = '';

    const promoBanner = promo ? `
      <div style="background:linear-gradient(135deg,#27ae60,#1e8449);color:#fff;
        border-radius:10px;padding:8px 16px;margin-bottom:16px;font-size:12px;font-weight:700;">
        🎉 لديك خصم خاص! وفّر على أي ترقية
      </div>` : '';

    // أنيميشن badge الـ Mega
    if (!document.getElementById('_mega_pulse_style')) {
      const s = document.createElement('style');
      s.id = '_mega_pulse_style';
      s.textContent = '@keyframes megaPulse{0%,100%{box-shadow:0 3px 12px rgba(231,76,60,0.5)}50%{box-shadow:0 3px 20px rgba(231,76,60,0.9)}}';
      document.head.appendChild(s);
    }

    const overlay = document.createElement('div');
    overlay.id = 'saas-upgrade-popup';
    overlay.style.cssText = `
      position:fixed;top:0;left:0;width:100%;height:100%;
      background:rgba(15,15,25,0.75);
      z-index:99999;
      display:flex;align-items:center;justify-content:center;
      padding:20px;box-sizing:border-box;
      font-family:'Cairo','Poppins',sans-serif;
    `;
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) { overlay.remove(); document.body.style.overflow = ''; }
    });
    overlay.innerHTML = `
      <div style="
        background:#f8f8fc;border-radius:24px;padding:32px 28px 28px;
        max-width:740px;width:100%;
        box-shadow:0 32px 80px rgba(0,0,0,0.3);position:relative;text-align:center;
      ">
        <button onclick="document.getElementById('saas-upgrade-popup').remove();document.body.style.overflow='';" style="
          position:absolute;top:14px;left:16px;
          background:#ececec;border:none;width:32px;height:32px;
          border-radius:50%;font-size:18px;cursor:pointer;color:#666;
          display:flex;align-items:center;justify-content:center;transition:background .2s;
        " onmouseenter="this.style.background='#ddd'" onmouseleave="this.style.background='#ececec'">&times;</button>

        <div style="display:inline-flex;align-items:center;justify-content:center;
          width:56px;height:56px;border-radius:16px;
          background:linear-gradient(135deg,#9b59b6,#6c3483);margin-bottom:14px;">
          <i class="fas fa-crown" style="font-size:24px;color:#fff;"></i>
        </div>

        <h2 style="color:#111;font-size:20px;font-weight:800;margin:0 0 6px;">ارتقِ بمطعمك للمستوى التالي</h2>
        <p style="color:#888;font-size:13px;margin:0 0 14px;">
          ${msg || 'اختر الباقة المناسبة لحجم أعمالك'}
        </p>

        ${currentPill}
        ${promoBanner}

        <div style="display:flex;gap:14px;justify-content:center;flex-wrap:wrap;align-items:flex-end;padding:10px 0;">
          ${cardsHtml}
        </div>

        <p style="color:#bbb;font-size:11px;margin:18px 0 0;">
          الدفع عبر واتساب · لا يلزم بطاقة بنكية
        </p>
      </div>
    `;
    document.body.style.overflow = 'hidden';
    document.body.appendChild(overlay);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 3. شاشة انتهاء الـ Grace Period أوفلاين
  // ══════════════════════════════════════════════════════════════════════════════
  function showOfflineExpired() {
    _block();
    _modal(`
      <div style="max-width:460px;width:100%;text-align:center;">
        ${_icon('wifi-slash', RED)}
        <h1 style="color:#fff;font-size:26px;font-weight:800;margin:0 0 12px;">
          انتهت فترة العمل بدون إنترنت
        </h1>
        <p style="color:#888;font-size:15px;margin:0 0 8px;">
          مرت 7 أيام بدون اتصال بالخادم
        </p>
        <p style="color:#aaa;font-size:14px;margin:0 0 32px;">
          اتصل بالإنترنت مرة واحدة لتجديد التحقق ومتابعة العمل
        </p>
        <button onclick="window.location.reload()" style="
          padding:16px 40px;background:${GOLD};border:none;
          border-radius:12px;color:#000;font-size:16px;font-weight:700;cursor:pointer;
        ">
          <i class="fas fa-redo"></i> إعادة المحاولة
        </button>
        ${_logoutBtn()}
      </div>
    `);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 4. شاشة غياب الإنترنت عند أول تشغيل
  // ══════════════════════════════════════════════════════════════════════════════
  function showNoConnection() {
    _block();
    _modal(`
      <div style="max-width:460px;width:100%;text-align:center;">
        ${_icon('signal', '#e67e22')}
        <h1 style="color:#fff;font-size:26px;font-weight:800;margin:0 0 12px;">
          يلزم اتصال بالإنترنت
        </h1>
        <p style="color:#888;font-size:15px;margin:0 0 32px;">
          عشان تقدر تستخدم البرنامج لأول مرة لازم تتصل بالنت مرة واحدة
        </p>
        <button onclick="window.location.reload()" style="
          padding:16px 40px;background:${GOLD};border:none;
          border-radius:12px;color:#000;font-size:16px;font-weight:700;cursor:pointer;
        ">
          <i class="fas fa-redo"></i> إعادة المحاولة
        </button>
        ${_logoutBtn()}
      </div>
    `);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 5. شاشة الاشتراك المعلّق (admin suspend)
  // ══════════════════════════════════════════════════════════════════════════════
  function showSuspended() {
    _block();
    _modal(`
      <div style="max-width:460px;width:100%;text-align:center;">
        ${_icon('ban', RED)}
        <h1 style="color:#fff;font-size:26px;font-weight:800;margin:0 0 12px;">
          الحساب موقوف مؤقتاً
        </h1>
        <p style="color:#888;font-size:15px;margin:0 0 32px;">
          تواصل مع الدعم الفني لمعرفة السبب وإعادة التفعيل
        </p>
        <a href="https://wa.me/15514263488" target="_blank" style="
          display:inline-block;padding:16px 40px;background:${GREEN};
          border-radius:12px;color:#fff;text-decoration:none;
          font-size:16px;font-weight:700;
        ">
          <i class="fab fa-whatsapp"></i> تواصل مع الدعم
        </a>
        ${_logoutBtn()}
      </div>
    `);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 6. شاشة الجهاز غير المسجّل
  // ══════════════════════════════════════════════════════════════════════════════
  function showWrongDevice(hwId) {
    _block();
    _modal(`
      <div style="max-width:480px;width:100%;text-align:center;">
        ${_icon('laptop', '#e67e22')}
        <h1 style="color:#fff;font-size:24px;font-weight:800;margin:0 0 12px;">
          جهاز غير مسجّل
        </h1>
        <p style="color:#888;font-size:14px;margin:0 0 20px;">
          هذا الجهاز لم يُسجَّل في اشتراكك.<br>
          تواصل مع الدعم لإضافة الجهاز أو ترقية الباقة.
        </p>
        <div style="
          background:#0a0a0a;border:1px solid ${BORDER};border-radius:10px;
          padding:14px;font-family:monospace;font-size:13px;
          color:${GOLD};word-break:break-all;margin-bottom:24px;
        ">
          <div style="color:#666;font-size:11px;margin-bottom:6px;">Hardware ID</div>
          ${hwId}
        </div>
        <a href="https://wa.me/15514263488" target="_blank" style="
          display:inline-block;padding:16px 40px;background:${GREEN};
          border-radius:12px;color:#fff;text-decoration:none;
          font-size:15px;font-weight:700;
        ">
          <i class="fab fa-whatsapp"></i> إضافة الجهاز
        </a>
        ${_logoutBtn()}
      </div>
    `);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 7. شاشة القفل عن بُعد (Remote Lock by Admin)
  // ══════════════════════════════════════════════════════════════════════════════
  function showLocked() {
    _block();
    _modal(`
      <div style="max-width:460px;width:100%;text-align:center;">
        ${_icon('lock', RED)}
        <h1 style="color:#fff;font-size:26px;font-weight:800;margin:0 0 12px;">
          الحساب مقفل مؤقتاً
        </h1>
        <p style="color:#888;font-size:15px;margin:0 0 32px;">
          تم تعليق الوصول من قِبل الإدارة.<br>
          تواصل معنا لإعادة فتح الحساب.
        </p>
        <a href="https://wa.me/15514263488" target="_blank" style="
          display:inline-block;padding:16px 40px;background:${GREEN};
          border-radius:12px;color:#fff;text-decoration:none;
          font-size:16px;font-weight:700;
        ">
          <i class="fab fa-whatsapp"></i> تواصل مع الإدارة
        </a>
        ${_logoutBtn()}
      </div>
    `);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Upgrade Handler (مؤقت — هيتوصّل بـ Paymob في المرحلة 2)
  // ══════════════════════════════════════════════════════════════════════════════
  function _handleUpgrade(planId) {
    const labels = { basic: 'Basic 499ج', pro: 'Pro 799ج', mega: 'Mega 999ج' };
    const msg = encodeURIComponent(
      'أريد الاشتراك في باقة Solo POS (' + (labels[planId] || planId) + ').' +
      '\nرقم حسابي: ' + (firebase.auth().currentUser?.phoneNumber || firebase.auth().currentUser?.email || '—')
    );
    const waUrl = 'https://wa.me/15514263488?text=' + msg;
    if (window.require) {
      try { window.require('electron').shell.openExternal(waUrl); return; } catch(e) {}
    }
    window.open(waUrl, '_blank');
  }

  function _injectStyles() {
    const style = document.createElement('style');
    style.innerHTML = `
      /* From uiverse.io by @namecho */
      .ui-card {
        max-width: 320px;
        width: 100%;
        display: flex;
        flex-direction: column;
        border-radius: 1.5rem;
        background-color: #ffffff;
        padding: 1.5rem;
        box-shadow: 0px 10px 30px rgba(0, 0, 0, 0.1);
        text-align: right;
        position: relative;
        overflow: hidden;
        border: 1px solid #eee;
      }

      .ui-card .price {
        font-size: 2.5rem;
        line-height: 1;
        font-weight: 700;
        color: #1a1a1a;
        margin: 0;
      }

      .ui-card .period {
        font-size: 1rem;
        color: #888;
        font-weight: 500;
      }

      .ui-card .card-title {
        font-size: 1.2rem;
        font-weight: 800;
        margin-bottom: 10px;
      }

      .ui-card .lists {
        margin-top: 2rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        font-size: 0.95rem;
        color: #444;
        padding: 0;
        list-style: none;
        font-weight: 500;
      }

      .ui-card .list {
        display: flex;
        align-items: center;
      }

      .ui-card .list svg {
        height: 1.2rem;
        width: 1.2rem;
        margin-left: 10px;
        flex-shrink: 0;
      }

      .ui-card .action {
        margin-top: auto;
        width: 100%;
        border: 2px solid;
        border-radius: 9999px;
        background-color: #fff;
        padding: 0.8rem 1.5rem;
        font-weight: 700;
        text-align: center;
        font-size: 1rem;
        color: #1a1a1a;
        cursor: pointer;
        font-family: 'Cairo', sans-serif;
        transition: all 0.3s ease;
        margin-top: 30px;
      }

      .ui-card .action:hover {
        color: #000 !important;
      }
 
    `;
    document.head.appendChild(style);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Public API
  // ══════════════════════════════════════════════════════════════════════════════
  window.SaaSPlansUI = {
    showExpired,
    showUpgradeOptions,
    showOfflineExpired,
    showNoConnection,
    showSuspended,
    showWrongDevice,
    showLocked,
    _handleUpgrade,   // exposed for inline onclick
  };

})();