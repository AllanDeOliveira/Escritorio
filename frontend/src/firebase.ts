import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyAEPa7mdFaFXDpMkXuZF0yQWpCaR_mzYYQ",
  authDomain: "login-impugancao.firebaseapp.com",
  projectId: "login-impugancao",
  storageBucket: "login-impugancao.firebasestorage.app",
  messagingSenderId: "822085904619",
  appId: "1:822085904619:web:f8ac84b0bc2f15d744b6ae",
  measurementId: "G-CB6M7CTPLV"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
