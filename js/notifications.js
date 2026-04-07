// Notification System

const Notification = {
    show: (message, type = 'success', duration = 3000) => {
        // Remove existing notifications
        const existing = document.querySelectorAll('.notification');
        existing.forEach(n => n.remove());
        
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        
        const icons = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'ℹ'
        };
        
        notification.innerHTML = `
            <div class="notification-icon">${icons[type] || icons.success}</div>
            <div class="notification-content">
                <div class="notification-title">${type === 'success' ? 'نجح!' : type === 'error' ? 'خطأ!' : type === 'warning' ? 'تحذير!' : 'معلومة!'}</div>
                <div class="notification-message">${message}</div>
            </div>
            <button class="notification-close" onclick="this.parentElement.remove()">×</button>
        `;
        
        document.body.appendChild(notification);
        
        // Auto remove
        setTimeout(() => {
            if (notification.parentElement) {
                notification.style.animation = 'notificationSlide 0.3s ease-out reverse';
                setTimeout(() => notification.remove(), 300);
            }
        }, duration);
        
        return notification;
    },
    
    success: (message, duration) => Notification.show(message, 'success', duration),
    error: (message, duration) => Notification.show(message, 'error', duration),
    warning: (message, duration) => Notification.show(message, 'warning', duration),
    info: (message, duration) => Notification.show(message, 'info', duration)
};
