// Additional Enhancements and Features

// Keyboard Shortcuts
document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + K for search
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const searchInput = document.querySelector('.header-search input');
        if (searchInput) {
            searchInput.focus();
            searchInput.select();
        }
    }
    
    // Escape to close modals
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal.active').forEach(modal => {
            modal.classList.remove('active');
        });
    }
});

// Auto-save cart to localStorage
function autoSaveCart(cart) {
    localStorage.setItem('autoSavedCart', JSON.stringify(cart));
}

function loadAutoSavedCart() {
    const saved = localStorage.getItem('autoSavedCart');
    if (saved) {
        return JSON.parse(saved);
    }
    return null;
}

// Smooth scroll to top
function scrollToTop() {
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
}

// Add scroll to top button
function addScrollToTopButton() {
    const button = document.createElement('button');
    button.innerHTML = '↑';
    button.style.cssText = `
        position: fixed;
        bottom: 30px;
        left: calc(var(--sidebar-width) + 30px);
        width: 50px;
        height: 50px;
        border-radius: 50%;
        background: var(--color-accent);
        color: white;
        border: none;
        font-size: 24px;
        cursor: pointer;
        box-shadow: var(--shadow-lg);
        z-index: 1000;
        display: none;
        align-items: center;
        justify-content: center;
        transition: all 0.3s ease;
    `;
    button.addEventListener('click', scrollToTop);
    button.addEventListener('mouseenter', () => {
        button.style.transform = 'translateY(-5px)';
        button.style.boxShadow = '0 10px 20px rgba(0,0,0,0.2)';
    });
    button.addEventListener('mouseleave', () => {
        button.style.transform = 'translateY(0)';
        button.style.boxShadow = 'var(--shadow-lg)';
    });
    
    window.addEventListener('scroll', () => {
        if (window.scrollY > 300) {
            button.style.display = 'flex';
        } else {
            button.style.display = 'none';
        }
    });
    
    document.body.appendChild(button);
}

// Initialize enhancements
document.addEventListener('DOMContentLoaded', () => {
    // Add scroll to top button on pages with scrollable content
    if (document.querySelector('.main-content')) {
        addScrollToTopButton();
    }
});

// Format numbers with Arabic-Indic digits
function formatArabicNumber(num) {
    const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    return num.toString().replace(/\d/g, (digit) => arabicDigits[digit]);
}

// Add tooltips
function addTooltip(element, text) {
    element.setAttribute('title', text);
    element.style.position = 'relative';
    
    const tooltip = document.createElement('div');
    tooltip.textContent = text;
    tooltip.style.cssText = `
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        background: var(--color-text-dark);
        color: white;
        padding: 8px 12px;
        border-radius: 4px;
        font-size: 12px;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s;
        z-index: 10000;
        margin-bottom: 5px;
    `;
    
    element.addEventListener('mouseenter', () => {
        tooltip.style.opacity = '1';
    });
    
    element.addEventListener('mouseleave', () => {
        tooltip.style.opacity = '0';
    });
    
    element.appendChild(tooltip);
}

// Debounce function for search
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Copy to clipboard
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        Notification.success('تم النسخ!');
    }).catch(() => {
        Notification.error('فشل النسخ');
    });
}

// Print page with animation
function printWithAnimation() {
    const printButton = event.target;
    printButton.style.animation = 'pulse 0.3s ease';
    setTimeout(() => {
        window.print();
        printButton.style.animation = '';
    }, 300);
}
