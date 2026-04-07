window.PinCrypto = {
    secretKey: "Solo-System-Safe-Key-2026",
    storePin: function(pin) {
        try {
            const encrypted = CryptoJS.AES.encrypt(String(pin), this.secretKey).toString();
            localStorage.setItem('encryptedPin', encrypted);
            console.log("✅ PIN Encrypted & Stored");
            return true;
        } catch (e) {
            console.error("❌ Encryption failed:", e);
            return false;
        }
    }
};
