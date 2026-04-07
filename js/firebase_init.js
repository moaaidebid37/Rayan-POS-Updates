
// js/firebase_init.js
// This file is the single source of truth for Firebase initialization.

// Make sure this code runs only once.
if (!window.firestoreReady) {
    console.log("🔥 Initializing Firebase...");

    // These imports are exposed globally by the firebase-app and firebase-firestore SDKs loaded in the HTML.
    const { initializeApp } = window.firebase;
    const { getFirestore } = window.firebase.firestore;

    // Create a global promise that resolves when Firestore is ready.
    // Other modules can `await window.firestoreReady;` to safely get the db instance.
    window.firestoreReady = new Promise((resolve, reject) => {
        try {
            const app = initializeApp(window.firebaseConfig);
            const db = getFirestore(app);
            
            // Expose the db instance globally for all services to use.
            window.firebaseDb = db;
            
            console.log("✅ Firebase Initialized and DB instance is globally available.");
            
            // Resolve the promise with the db instance, making it available to awaiting functions.
            resolve(db);

        } catch (error) {
            console.error("❌ Firebase initialization failed:", error);
            reject(error);
        }
    });
} else {
    console.log("✅ Firebase already initializing/initialized.");
}
