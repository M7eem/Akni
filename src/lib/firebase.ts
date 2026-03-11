/// <reference types="vite/client" />
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const getEnv = (key: string) => {
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return import.meta.env[key];
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key];
  }
  return undefined;
};

const firebaseConfig = {
  apiKey: "AIzaSyCmo6wRW7fj30Xof7RUJxgODEbHVYIGZ-M",
  authDomain: "gen-lang-client-0026810726.firebaseapp.com",
  projectId: "gen-lang-client-0026810726",
  storageBucket: "gen-lang-client-0026810726.firebasestorage.app",
  messagingSenderId: "52437703629",
  appId: "1:52437703629:web:ebc7d25fd5ca4485864284"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account'
});
