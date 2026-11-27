import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getFirestore, collection } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB9Ciai00q1Gj3wLQTmEnMTX37UVJAkhbg",
  authDomain: "the-elderly-exercise-web.firebaseapp.com",
  projectId: "the-elderly-exercise-web",
  storageBucket: "the-elderly-exercise-web.firebasestorage.app",
  messagingSenderId: "168007642323",
  appId: "1:168007642323:web:21a2ba1ded75f76bacb826",
  measurementId: "G-CWY4VZPWH8"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export const postsCollection = collection(db, "posts");
export const profilesCollection = collection(db, "profiles");
export const rosterCollection = collection(db, "public_roster");
export const vaultCollection = collection(db, "recovery_vault");

let authPromise = null;

/** 確保目前瀏覽器已取得無法偽造的 Firebase Anonymous Auth UID */
export async function ensureAnonymousAuth() {
  if (auth.currentUser) return auth.currentUser;
  if (!authPromise) {
    authPromise = signInAnonymously(auth)
      .then((cred) => cred.user)
      .catch((err) => {
        authPromise = null;
        throw err;
      });
  }
  return authPromise;
}