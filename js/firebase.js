(function() { 
   try { 
     // 1. التأكد إن إعدادات فايربيز موجودة 
     if (typeof window.firebaseConfig === 'undefined') { 
         console.error('Firebase config is missing!'); 
         return; 
     } 
 
     // 2. تشغيل فايربيز (نسخة Compat المتوافقة مع ملف index.html) 
     if (!firebase.apps.length) { 
         firebase.initializeApp(window.firebaseConfig); 
     } 
 
     // 3. تعريف قاعدة البيانات 
     const db = firebase.firestore(); 
 
     // 4. تفعيل الكاش (Offline Persistence) عشان السيستم يفضل شغال سريع ومن غير نت 
     db.enablePersistence({ synchronizeTabs: true }) 
       .catch((err) => { 
         if (err.code === 'failed-precondition') { 
           console.warn('⚠️ Multiple tabs open, persistence can only be enabled in one tab at a time.'); 
         } else if (err.code === 'unimplemented') { 
           console.warn('⚠️ The current browser doesn\'t support all of the features necessary to enable persistence'); 
         } else { 
           console.warn('⚠️ Firestore persistence error:', err.message); 
         } 
       }); 
 
     // 5. إتاحة المتغيرات للبرنامج كله 
     window.firebaseDb = db; 
     window.isFirestoreReady = true; 
     
     // إعطاء إشارة لباقي الملفات إن فايربيز جاهز وشغال عشان تبدأ المزامنة 
     window.dispatchEvent(new Event('firestore-ready')); 
     
     console.log('✅ Firebase initialized successfully!'); 
 
   } catch (e) { 
     console.error('❌ Firebase initialization error:', e); 
   } 
 })();