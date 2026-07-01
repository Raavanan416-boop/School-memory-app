// Firebase configuration — Complete imports for all features
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail,
  updatePassword, EmailAuthProvider, reauthenticateWithCredential }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, collectionGroup,
  query, where, orderBy, limit, limitToLast, onSnapshot, serverTimestamp, Timestamp,
  arrayUnion, arrayRemove, increment, startAfter, endAt, writeBatch, deleteField,
  startAt, endBefore, getCountFromServer, runTransaction }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getDatabase, ref, onDisconnect, set as rtdbSet, onValue, serverTimestamp as rtdbServerTimestamp, get as rtdbGet }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';


// ⚠️ REPLACE with your Firebase project config
const firebaseConfig = {
  apiKey: "AIzaSyDs9bqr8xcafukYgVLPg9Z9q5V50gI7i8g",
  authDomain: "school-memory-app.firebaseapp.com",
  databaseURL: "https://school-memory-app-default-rtdb.firebaseio.com",
  projectId: "school-memory-app",
  storageBucket: "school-memory-app.firebasestorage.app",
  messagingSenderId: "310068830991",
  appId: "1:310068830991:web:3c89f62e765843fd4c147a"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
});
const rtdb = getDatabase(app);


export {
  app, auth, db, rtdb,
  signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail,
  updatePassword, EmailAuthProvider, reauthenticateWithCredential,
  collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, collectionGroup,
  query, where, orderBy, limit, limitToLast, onSnapshot, serverTimestamp, Timestamp,
  arrayUnion, arrayRemove, increment, startAfter, endAt, writeBatch, deleteField,
  startAt, endBefore, getCountFromServer, runTransaction,
  ref, onDisconnect, rtdbSet, onValue, rtdbServerTimestamp, rtdbGet
};
