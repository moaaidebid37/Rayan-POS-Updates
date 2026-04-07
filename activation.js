window.validateLicense = async function(licenseCode) {
    if (!licenseCode) {
        return { success: false, message: "برجاء ادخال كود التفعيل" };
    }

    try {
        const firestore = firebase.firestore();
        const docRef = firestore.collection('valid_license_codes').doc(licenseCode);
        const doc = await docRef.get();

        if (doc.exists) {
            const data = doc.data();

            if (data.status === 'new' || data.status === 'available') {
                const durationInDays = data.duration;
                if (typeof durationInDays !== 'number' || durationInDays <= 0) {
                    return { success: false, message: "كود التفعيل هذا لا يحتوي على مدة صلاحية." };
                }

                // حساب تاريخ الانتهاء الجديد
                const now = new Date();
                const newExpiryDate = new Date(now.setDate(now.getDate() + durationInDays));

                // إنشاء وحفظ معلومات الترخيص الكاملة في الجهاز
                const licenseInfo = {
                    isActivated: true,
                    licenseCode: licenseCode,
                    licenseType: data.type || 'standard',
                    activatedAt: new Date().toISOString(),
                    expiryDate: newExpiryDate.toISOString() // حفظ التاريخ بصيغة ISO القياسية
                };
                localStorage.setItem('solo_license_info', JSON.stringify(licenseInfo));

                // تحديث حالة الكود في فايربيز لمنع إعادة استخدامه
                await docRef.update({
                    status: 'activated',
                    activatedAt: new Date().toISOString()
                    // يمكنك إضافة hardwareId هنا لاحقاً لربط الكود بجهاز معين
                });

                return { success: true, message: `تم تفعيل الاشتراك لمدة ${durationInDays} يوم بنجاح!` };
            } else {
                return { success: false, message: "هذا الكود مستخدم مسبقاً!" };
            }
        } else {
            return { success: false, message: "كود التفعيل غير صحيح" };
        }
    } catch (error) {
        console.error("Firebase Error:", error);
        return { success: false, message: "خطأ في الاتصال بالسيرفر" };
    }
};