// Script to remove all categories and associated data
function removeAllCategories() {
    console.log('Starting category removal process...');
    
    // 1. Remove from localStorage
    localStorage.removeItem('categories');
    console.log('✓ Removed categories from localStorage');
    
    // 2. Clear menuData categories if it exists
    if (typeof menuData !== 'undefined' && menuData.categories) {
        menuData.categories = [];
        console.log('✓ Cleared menuData categories');
    }
    
    // 3. Clear window.menuData if it exists
    if (typeof window !== 'undefined' && window.menuData && window.menuData.categories) {
        window.menuData.categories = [];
        console.log('✓ Cleared window.menuData categories');
    }
    
    // 4. Remove menu items that belong to the deleted categories
    const categoriesToRemove = [
        'علب المكرونة',
        'ركن الساندوتشات', 
        'الطواجن',
        'ساندوتشات مكرونة',
        'الفراخ',
        'المشروبات',
        'الحلو',
        'الاضافات'
    ];
    
    // Remove menu items from localStorage
    let menuItems = [];
    try {
        menuItems = JSON.parse(localStorage.getItem('menuItems') || '[]');
        const originalCount = menuItems.length;
        
        menuItems = menuItems.filter(item => {
            return !categoriesToRemove.includes(item.category);
        });
        
        localStorage.setItem('menuItems', JSON.stringify(menuItems));
        console.log(`✓ Removed ${originalCount - menuItems.length} menu items from deleted categories`);
    } catch (e) {
        console.warn('Error removing menu items:', e);
    }
    
    // 5. Clear sync queue for categories
    try {
        const syncQueue = JSON.parse(localStorage.getItem('syncQueue') || '[]');
        const filteredQueue = syncQueue.filter(item => item.collection !== 'categories');
        localStorage.setItem('syncQueue', JSON.stringify(filteredQueue));
        console.log('✓ Cleared category sync operations from queue');
    } catch (e) {
        console.warn('Error clearing sync queue:', e);
    }
    
    // 6. Clear any cached data
    try {
        localStorage.removeItem('first_run_completed');
        console.log('✓ Removed first run flag to force fresh initialization');
    } catch (e) {
        console.warn('Error clearing first run flag:', e);
    }
    
    console.log('✅ All categories and associated data have been removed successfully!');
    console.log('🔄 Please refresh the page to see the changes.');
    
    // Show success message
    if (typeof Notification !== 'undefined') {
        Notification.success('تم حذف جميع الفئات والمنتجات المرتبطة بها بنجاح');
    } else {
        alert('تم حذف جميع الفئات والمنتجات المرتبطة بها بنجاح\n\nيرجى تحديث الصفحة لرؤية التغييرات');
    }
    
    // Force page reload after a short delay
    setTimeout(() => {
        window.location.reload();
    }, 2000);
}

// Auto-execute the function
removeAllCategories();
