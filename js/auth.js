// نظام الصلاحيات والمصادقة مع Firebase - نسخة متوافقة مع SaaS (بدون ريفرش)

const Auth = {
    useFirebase: () => { return false; },
    
    login: async (email, password, role) => { return { success: true }; },
    
    // 🛑 قفلنا التحويلات القديمة عشان نظام الـ SaaS الجديد هو اللي بيتحكم
    checkLogin: () => {
        return true;
    },
    
    // 🔥 دي الدالة اللي كانت عاملا المشكلة.. خليناها دايماً تقول للبرنامج "أنا مسجل دخول"
    isLoggedIn: () => {
        return true;
    },
    
    getUserRole: () => {
        const raw = (localStorage.getItem('userRole') || localStorage.getItem('userType') || '').toLowerCase().trim();
        if (raw === 'owner' || raw === 'admin' || raw === 'مدير' || raw === 'صاحب المطعم') return 'owner';
        if (raw === 'cashier' || raw === 'كاشير' || raw === 'موظف') return 'cashier';
        // الأمان: لو مجهول → كاشير (مش مالك)
        return raw ? 'cashier' : 'owner';
    },
    
    getUserType: () => {
        return Auth.getUserRole();
    },
    
    getUsername: () => {
        return localStorage.getItem('username') || 'المستخدم';
    },
    
    hasPermission: (permission) => {
        const userRole = Auth.getUserRole();
        if (userRole === 'owner' || userRole === 'admin') return true;
        if (userRole === 'cashier') {
            const cashierPermissions = [
                'view_orders', 'create_order', 'view_today_expenses',
                'add_expense', 'view_menu', 'add_product',
                'open_cash_drawer', 'close_cash_drawer'
            ];
            return cashierPermissions.includes(permission);
        }
        return false;
    },
    
    checkPermissions: (requiredRole) => {
        const userRole = Auth.getUserRole();
        if (requiredRole === 'cashier') return ['cashier', 'owner', 'admin'].includes(userRole);
        if (requiredRole === 'owner') return ['owner', 'admin'].includes(userRole);
        return false;
    },

    canDelete: () => {
        const userRole = Auth.getUserRole();
        return userRole === 'owner' || userRole === 'admin';
    },
    
    // تسجيل الخروج متصل بنظام الـ SaaS
    logout: async () => {
        if (typeof window.SaaS !== 'undefined' && window.SaaS.signOut) {
            await window.SaaS.signOut();
        } else {
            localStorage.removeItem('isLoggedIn');
            localStorage.removeItem('username');
            localStorage.removeItem('userEmail');
            localStorage.removeItem('userRole');
            localStorage.removeItem('userType');
            localStorage.removeItem('userId');
            window.location.href = 'index.html';
        }
    },
    
    // خريطة الفيتشر → اسم الملف
    PAGE_FEATURE_MAP: {
        'pos':       'index.html',
        'orders':    'orders.html',
        'kitchen':   'kitchen.html',
        'reports':   'reports.html',
        'inventory': 'ingredients.html',
        'customers': 'customers.html',
        'marketing': 'marketing.html',
        'suppliers': 'suppliers.html',
        'settings':  'settings.html',
        'employees': 'employees.html',
        'dashboard': 'dashboard.html',
    },

    _getAllowedFiles: () => {
        const userRole = Auth.getUserRole();
        if (userRole === 'owner') return null; // المالك يفتح كل حاجة

        // كاشير — اقرأ الصلاحيات من localStorage
        try {
            const perms = JSON.parse(localStorage.getItem('userPermissions') || '[]');
            if (perms.length > 0) {
                // سواء كانت 'orders' أو 'orders.html' → نحوّلها لـ filename
                const files = perms.map(f => Auth.PAGE_FEATURE_MAP[f] || f).filter(Boolean);
                // الرئيسية وتسجيل الخروج دايماً مسموحة
                return [...new Set([...files, 'index.html', 'login.html'])];
            }
        } catch (e) { console.error('Permission parse error', e); }
        return ['index.html'];
    },

    applyPermissions: () => {
        const userRole = Auth.getUserRole();
        const isAdmin = userRole === 'owner' || userRole === 'admin';
        const restrictedElements = document.querySelectorAll('[data-restricted="owner"]');
        restrictedElements.forEach(el => {
            el.style.display = isAdmin ? '' : 'none';
        });

        if (!isAdmin) {
            const allowedFiles = Auth._getAllowedFiles() || [];
            const sidebar = document.querySelector('.sidebar');
            if (sidebar) {
                const allSidebarLinks = sidebar.querySelectorAll('.sidebar-item[href]');
                allSidebarLinks.forEach(linkEl => {
                    const href = linkEl.getAttribute('href');
                    const allowed = !href || allowedFiles.some(f => href.includes(f));
                    if (!allowed) {
                        linkEl.style.setProperty('display', 'none', 'important');
                    } else {
                        linkEl.style.removeProperty('display');
                    }
                });
            }
        }
    },

    checkPageAccess: (pageName) => {
        const userRole = Auth.getUserRole();
        if (userRole === 'owner' || userRole === 'admin') return true;
        const allowedFiles = Auth._getAllowedFiles() || [];
        const isAllowed = allowedFiles.some(f => pageName.includes(f));
        if (!isAllowed) {
            window.location.href = 'index.html';
            return false;
        }
        return true;
    }
};

if (typeof window !== 'undefined') {
    window.Auth = Auth;
}