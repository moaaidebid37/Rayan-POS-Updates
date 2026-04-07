// ====================================================================
// whatsapp-server.js
// شغّله من التيرمينال: node whatsapp-server.js
// ====================================================================

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const expressApp = express();
expressApp.use(cors());
expressApp.use(express.json({ limit: '20mb' })); // ✅ عشان الصور الكبيرة

const waServer = http.createServer(expressApp);
const io = new Server(waServer, { cors: { origin: '*' } });

let waIsReady = false;
let lastQrCode = null;
let manualDisconnect = false;

const waClient = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu'
        ]
    }
});

waClient.on('loading_screen', (percent, message) => {
    console.log(`⌛ تحميل: ${percent}% - ${message}`);
    io.emit('loading', `جاري تحميل المحرك: ${percent}%`);
});

waClient.on('qr', async (qr) => {
    try {
        console.log('✅ QR Code اتولد!');
        const qrImage = await qrcode.toDataURL(qr);
        lastQrCode = qrImage;
        io.emit('qr', qrImage);
    } catch (err) {
        console.error('⚠️ خطأ في رسم QR:', err.message);
    }
});

waClient.on('ready', () => {
    waIsReady = true;
    lastQrCode = null;
    io.emit('ready', 'Connected');
    console.log('✅ واتساب جاهز للعمل!');
});

waClient.on('auth_failure', (msg) => {
    console.error('❌ فشل المصادقة:', msg);
    io.emit('system_error', 'فشل المصادقة: ' + msg);
});

waClient.on('disconnected', (reason) => {
    waIsReady = false;
    lastQrCode = null;
    io.emit('disconnected', reason);
    console.log('⚠️ انفصل - بيحاول تاني بعد 5 ثواني...');
    if (!manualDisconnect) { 
        setTimeout(() => waClient.initialize(), 5000); 
    } 
    manualDisconnect = false;
});

io.on('connection', (socket) => { 
    console.log('🔌 Browser اتصل'); 
    socket.emit('status', waIsReady ? 'connected' : 'disconnected'); 
    if (!waIsReady && lastQrCode) { 
        socket.emit('qr', lastQrCode); 
    } 
 
    // ✅ ضيف ده عشان تسمع لطلب قطع الاتصال 
    socket.on('disconnect_wa', async () => { 
    manualDisconnect = true; 
    try { 
        await waClient.logout(); 
        await waClient.destroy(); 
        waIsReady = false; 
        lastQrCode = null; 
        io.emit('disconnected', 'manual'); 
        console.log('🔌 تم قطع الاتصال يدوياً'); 
 
        // ✅ ضيف السطرين دول عشان يولد QR جديد 
        setTimeout(() => { 
            manualDisconnect = false; 
            waClient.initialize().catch(err => console.error('خطأ في إعادة التشغيل:', err.message)); 
        }, 3000); 
 
    } catch (err) { 
        console.error('خطأ في قطع الاتصال:', err.message); 
        manualDisconnect = false; 
    } 
}); 
});

// ====== Send Message API (نص + صورة) ======
expressApp.post('/send-message', async (req, res) => {
    if (!waIsReady) {
        return res.status(400).json({ success: false, error: 'الواتساب غير متصل' });
    }

    const { phone, message, imageBase64 } = req.body;

    if (!phone || !message) {
        return res.status(400).json({ success: false, error: 'phone و message مطلوبين' });
    }

    try {
        let formattedPhone = String(phone).replace(/\D/g, '');
        if (formattedPhone.startsWith('0')) formattedPhone = '2' + formattedPhone;
        const chatId = `${formattedPhone}@c.us`;

        if (imageBase64) {
            // ✅ إرسال صورة مع نص
            const media = new MessageMedia('image/jpeg', imageBase64, 'promo.jpg');
            await waClient.sendMessage(chatId, media, { caption: message });
        } else {
            // إرسال نص فقط
            await waClient.sendMessage(chatId, message);
        }

        console.log(`✅ اتبعت لـ ${formattedPhone}`);
        res.json({ success: true });
    } catch (error) {
        console.error('❌ فشل الإرسال:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = 3005;
waServer.listen(PORT, () => {
    console.log(`🚀 السيرفر شغال على بورت ${PORT}`);
    console.log('⏳ بيحمل الواتساب... انتظر 30-60 ثانية للـ QR');
});

waClient.initialize().catch(err => {
    console.error('❌ خطأ في تشغيل الواتساب:', err.message);
    io.emit('system_error', err.message);
});