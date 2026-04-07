const fs = require('fs');
const path = require('path');

const projectDir = process.cwd();
const files = fs.readdirSync(projectDir).filter(file => file.endsWith('.html'));

const scriptsToInject = `
    <script src="saas/plans-ui.js"></script>
    <script src="saas/auth-ui.js"></script>
    <script src="saas/subscription-manager.js"></script>
    <script>
    // ═══════════════════════════════════════════════════════
    // SaaS Feature Gates — إخفاء الصفحات حسب الباقة
    // ═══════════════════════════════════════════════════════
    window.addEventListener('saas-ready', function () {

        // ── الصفحات المقفولة على Basic فأكثر ──────────────
        if (!window.SaaS.canUse('reports')) {
            document.querySelector('a[href="reports.html"]')
                ?.style.setProperty('display', 'none', 'important');
        }
        if (!window.SaaS.canUse('customers')) {
            document.querySelector('a[href="customers.html"]')
                ?.style.setProperty('display', 'none', 'important');
        }

        // ── الصفحات المقفولة على Pro فقط ───────────────────
        if (!window.SaaS.canUse('whatsapp')) { // 'whatsapp' is a Pro feature
            document.querySelector('a[href="marketing.html"]')
                ?.style.setProperty('display', 'none', 'important');
        }
        
        // ── Badge ──────────────────────────────────────────
        const plan = window.SaaS.getPlan();
        const planLabel = window.SaaS.getPlanLabel();
        const endDate = window.SaaS.getEndDate();

        const sidebar = document.querySelector('.sidebar');
        if (sidebar && !document.getElementById('saas-plan-badge')) {
            const badge = document.createElement('div');
            badge.id = 'saas-plan-badge';

            const colors = { trial: '#4a9eff', basic: '#d4af37', pro: '#9b59b6' };
            const color  = colors[plan] || '#d4af37';

            const daysLeft = endDate
                ? Math.max(0, Math.ceil((new Date(endDate) - new Date()) / 86400000))
                : null;

            badge.style.cssText = 'margin: 12px; padding: 12px 14px; background: ' + color + '15; border: 1px solid ' + color + '44; border-radius: 10px; font-size: 12px; text-align: center;';
            
            let badgeHTML = '<div style="color:' + color + '; font-weight:700; margin-bottom:4px;">' + (plan === 'pro' ? '👑' : plan === 'basic' ? '⭐' : '🕐') + ' ' + planLabel + '</div>';

            if (daysLeft !== null) {
                badgeHTML += '<div style="color:#888; font-size:11px;">' + daysLeft + ' يوم متبقي</div>';
            }

            if (plan !== 'pro') {
                badgeHTML += '<button onclick="window.SaaS.requireFeature(\'dashboard\')" style="margin-top:8px; width:100%; padding:6px; background:' + color + '; border:none; border-radius:6px; color:#000; font-size:11px; font-weight:700; cursor:pointer;">ترقية الباقة ↑</button>';
            }

            badge.innerHTML = badgeHTML;
            sidebar.appendChild(badge);
        }

    });
    </script>
`;

for (const file of files) {
    const filePath = path.join(projectDir, file);
    
    fs.copyFileSync(filePath, filePath + '.bak');

    let content = fs.readFileSync(filePath, 'utf-8');

    content = content.replace(
        /<script src="js\/activation.js"><\/script>/g,
        '<!-- <script src="js/activation.js"><\/script> -->'
    );

    content = content.replace(/<script src="saas\/plans-ui.js"><\/script>/g, '');
    content = content.replace(/<script src="saas\/auth-ui.js"><\/script>/g, '');
    content = content.replace(/<script src="saas\/subscription-manager.js"><\/script>/g, '');
    
    const oldGateRegex = /<script>\s*\/\/\s*═══════════════════════════════════════════════════════[\s\S]*?<\/script>/g;
    content = content.replace(oldGateRegex, '');

    content = content.replace(/\s*<\/body>/, '\n</body>');

    content = content.replace('</body>', `${scriptsToInject}\n</body>`);

    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`🔧 تم تعديل: ${file}`);
}

console.log('✅ خلص! كل الصفحات اتعدّلت.');
console.log('💾 نسخ احتياطية محفوظة بامتداد .bak');