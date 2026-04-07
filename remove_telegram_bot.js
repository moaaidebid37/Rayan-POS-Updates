// Script to remove all Telegram Bot related code and files
console.log('🗑️ Starting Telegram Bot removal process...');

// 1. Remove Telegram Bot directory and all its contents
function removeTelegramBotFiles() {
    console.log('📁 Removing telegram-bot directory...');
    
    // List of files to remove (if we can't remove the whole directory)
    const telegramFiles = [
        './telegram-bot/index.js',
        './telegram-bot/config.js',
        './telegram-bot/firebase-service.js',
        './telegram-bot/keyboards.js',
        './telegram-bot/utils.js',
        './telegram-bot/package.json',
        './telegram-bot/package-lock.json',
        './telegram-bot/.env',
        './telegram-bot/serviceAccountKey.json',
        './telegram-bot/README.md',
        './telegram-bot/SETUP_FIREBASE.md',
        './telegram-bot/render.yaml',
        './telegram-bot/.gitignore'
    ];
    
    // Remove commands directory
    const commandsDir = './telegram-bot/commands/';
    const listenersDir = './telegram-bot/listeners/';
    
    telegramFiles.forEach(file => {
        try {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
                console.log(`✓ Removed ${file}`);
            }
        } catch (error) {
            console.warn(`⚠️ Could not remove ${file}:`, error.message);
        }
    });
    
    // Remove directories
    try {
        if (fs.existsSync(commandsDir)) {
            fs.rmSync(commandsDir, { recursive: true, force: true });
            console.log(`✓ Removed ${commandsDir}`);
        }
        if (fs.existsSync(listenersDir)) {
            fs.rmSync(listenersDir, { recursive: true, force: true });
            console.log(`✓ Removed ${listenersDir}`);
        }
        if (fs.existsSync('./telegram-bot/')) {
            fs.rmSync('./telegram-bot/', { recursive: true, force: true });
            console.log('✓ Removed telegram-bot directory');
        }
    } catch (error) {
        console.warn('⚠️ Could not remove telegram-bot directory:', error.message);
    }
}

// 2. Remove Telegram references from JavaScript files
function removeTelegramFromJS() {
    console.log('📝 Removing Telegram references from JavaScript files...');
    
    const jsFiles = [
        './js/app_logic.js',
        './js/firestore_service.js',
        './js/data.js'
    ];
    
    jsFiles.forEach(filePath => {
        try {
            if (fs.existsSync(filePath)) {
                let content = fs.readFileSync(filePath, 'utf8');
                
                // Remove Telegram bot functions and references
                content = content.replace(/\/\/ ========== TELEGRAM BOT SETTINGS ==========[\s\S]*?\/\/ ========== END TELEGRAM BOT SETTINGS ==========/g, '');
                content = content.replace(/window\.loadTelegramSettings[\s\S]*?}/g, '');
                content = content.replace(/window\.saveTelegramSettings[\s\S]*?}/g, '');
                content = content.replace(/handleSaveTelegramId[\s\S]*?}/g, '');
                content = content.replace(/\/\/ Telegram Bot Configuration[\s\S]*?}/g, '');
                
                // Remove specific Telegram references
                content = content.replace(/getBotConfig|saveBotConfig|markValidLicenseCodeUsed/g, '');
                content = content.replace(/bot_config/g, '');
                
                fs.writeFileSync(filePath, content);
                console.log(`✓ Cleaned ${filePath}`);
            }
        } catch (error) {
            console.warn(`⚠️ Could not clean ${filePath}:`, error.message);
        }
    });
}

// 3. Remove Telegram references from HTML files
function removeTelegramFromHTML() {
    console.log('🌐 Removing Telegram references from HTML files...');
    
    const htmlFiles = [
        './settings.html'
    ];
    
    htmlFiles.forEach(filePath => {
        try {
            if (fs.existsSync(filePath)) {
                let content = fs.readFileSync(filePath, 'utf8');
                
                // Remove Telegram section
                content = content.replace(/<!-- Telegram Bot Section -->[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g, '');
                
                // Remove Telegram navigation item
                content = content.replace(/<a href="#"[^>]*>ربط التليجرام<\/a>/g, '');
                
                // Remove Telegram-related script calls
                content = content.replace(/loadTelegramSettings\(\);?/g, '');
                content = content.replace(/handleSaveTelegramId\(\);?/g, '');
                
                // Remove Telegram status elements
                content = content.replace(/id="telegram-[^"]*"/g, '');
                content = content.replace(/telegram-status-[^\s>]*/g, '');
                
                fs.writeFileSync(filePath, content);
                console.log(`✓ Cleaned ${filePath}`);
            }
        } catch (error) {
            console.warn(`⚠️ Could not clean ${filePath}:`, error.message);
        }
    });
}

// 4. Remove Telegram from localStorage
function removeTelegramFromLocalStorage() {
    console.log('💾 Removing Telegram data from localStorage...');
    
    if (typeof localStorage !== 'undefined') {
        const telegramKeys = [
            'telegram_bot_token',
            'telegram_owner_id',
            'telegram_connected',
            'bot_config'
        ];
        
        telegramKeys.forEach(key => {
            localStorage.removeItem(key);
            console.log(`✓ Removed ${key} from localStorage`);
        });
    }
}

// 5. Remove Telegram from package.json dependencies
function removeTelegramFromPackageJson() {
    console.log('📦 Removing Telegram from package.json...');
    
    try {
        const packageJsonPath = './package.json';
        if (fs.existsSync(packageJsonPath)) {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            
            if (packageJson.dependencies) {
                delete packageJson.dependencies['node-telegram-bot-api'];
            }
            
            fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
            console.log('✓ Removed node-telegram-bot-api from package.json');
        }
    } catch (error) {
        console.warn('⚠️ Could not update package.json:', error.message);
    }
}

// Execute all removal functions
try {
    removeTelegramBotFiles();
    removeTelegramFromJS();
    removeTelegramFromHTML();
    removeTelegramFromLocalStorage();
    removeTelegramFromPackageJson();
    
    console.log('✅ Telegram Bot removal completed successfully!');
    console.log('🔄 Please restart your application to see all changes.');
} catch (error) {
    console.error('❌ Error during Telegram Bot removal:', error);
}

// For browser execution
if (typeof window !== 'undefined') {
    // Browser-specific cleanup
    removeTelegramFromLocalStorage();
    
    // Show success message
    if (typeof Notification !== 'undefined') {
        Notification.success('تم حذف بوت التلجرام وجميع البيانات المرتبطة به بنجاح');
    } else {
        alert('تم حذف بوت التلجرام وجميع البيانات المرتبطة به بنجاح\n\nيرجى تحديث الصفحة لرؤية التغييرات');
    }
    
    // Reload page after 2 seconds
    setTimeout(() => {
        window.location.reload();
    }, 2000);
}
