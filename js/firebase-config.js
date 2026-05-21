// Firebase configuration — Complete imports for all features
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail,
  updatePassword, EmailAuthProvider, reauthenticateWithCredential }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc,
  query, where, orderBy, limit, limitToLast, onSnapshot, serverTimestamp, Timestamp,
  arrayUnion, arrayRemove, increment, startAfter, endAt, writeBatch, deleteField,
  startAt, endBefore, getCountFromServer }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getStorage, ref as storageRef, uploadBytes, uploadBytesResumable, getDownloadURL, deleteObject }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

// ⚠️ REPLACE with your Firebase project config
const firebaseConfig = {
  apiKey: "AIzaSyDs9bqr8xcafukYgVLPg9Z9q5V50gI7i8g",
  authDomain: "school-memory-app.firebaseapp.com",
  projectId: "school-memory-app",
  storageBucket: "school-memory-app.firebasestorage.app",
  messagingSenderId: "310068830991",
  appId: "1:310068830991:web:3c89f62e765843fd4c147a"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

export {
  app, auth, db, storage,
  signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail,
  updatePassword, EmailAuthProvider, reauthenticateWithCredential,
  collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc,
  query, where, orderBy, limit, limitToLast, onSnapshot, serverTimestamp, Timestamp,
  arrayUnion, arrayRemove, increment, startAfter, endAt, writeBatch, deleteField,
  startAt, endBefore, getCountFromServer,
  storageRef, uploadBytes, uploadBytesResumable, getDownloadURL, deleteObject
};
