// ═══════════════════════════════════════════════════════════════
// google-auth-ipc.js
// أضف require هذا الملف في app.js بعد سطر ipcMain
// ═══════════════════════════════════════════════════════════════
// في app.js أضف:
//   require('./google-auth-ipc');
// ═══════════════════════════════════════════════════════════════

const { ipcMain, BrowserWindow } = require('electron');
const path = require('path');

let googleAuthWindow = null;

ipcMain.handle('open-google-auth', (event) => {
  return new Promise((resolve, reject) => {

    // أغلق أي نافذة قديمة
    if (googleAuthWindow) {
      googleAuthWindow.close();
      googleAuthWindow = null;
    }

    googleAuthWindow = new BrowserWindow({
      width:  520,
      height: 620,
      title:  'تسجيل الدخول بـ Google',
      center: true,
      resizable: false,
      minimizable: false,
      webPreferences: {
        nodeIntegration:  true,
        contextIsolation: false,
        webSecurity:      false,
      },
    });

    googleAuthWindow.loadFile(path.join(__dirname, 'google-auth.html'));
    googleAuthWindow.webContents.openDevTools();
    googleAuthWindow.setMenuBarVisibility(false);

    // استقبل النجاح
    ipcMain.once('google-auth-success', (e, data) => {
      if (googleAuthWindow) { googleAuthWindow.close(); googleAuthWindow = null; }
      resolve(data);
    });

    // استقبل الخطأ
    ipcMain.once('google-auth-error', (e, code) => {
      if (googleAuthWindow) { googleAuthWindow.close(); googleAuthWindow = null; }
      reject(new Error(code));
    });

    // لو أغلق النافذة يدوياً
    googleAuthWindow.on('closed', () => {
      googleAuthWindow = null;
      reject(new Error('window-closed'));
    });
  });
});