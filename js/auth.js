// Auth module — Full featured with presence, password change, profile updates
import { auth, db, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail,
  updatePassword, EmailAuthProvider, reauthenticateWithCredential,
  doc, getDoc, updateDoc, setDoc, serverTimestamp, Timestamp, increment,
  storage, storageRef, uploadBytes, getDownloadURL } from './firebase-config.js';

const OWNER_EMAIL = 'kaviraj@school.com';

class AuthManager {
  constructor() {
    this.currentUser = null;
    this.userData = null;
    this.listeners = [];
    this._presenceInterval = null;
    this._isOwner = false;
  }

  get isOwner() { return this._isOwner; }

  onChange(cb) { this.listeners.push(cb); }
  _notify() { this.listeners.forEach(cb => cb(this.currentUser, this.userData)); }

  init() {
    return new Promise((resolve) => {
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          this.currentUser = user;
          await this._loadUserData(user.uid);
          await this._setOnline(true);
          this._startHeartbeat();
        } else {
          if (this.currentUser) await this._setOnline(false);
          this._stopHeartbeat();
          this.currentUser = null;
          this.userData = null;
        }
        this._notify();
        resolve(this.currentUser);
      });

      // Mark offline on page unload
      window.addEventListener('beforeunload', () => {
        if (this.currentUser) {
          const data = JSON.stringify({ online: false, lastSeen: new Date().toISOString() });
          navigator.sendBeacon && navigator.sendBeacon('/api/presence', data);
          // Also try direct Firestore update
          this._setOnline(false);
        }
      });

      // Handle visibility changes
      document.addEventListener('visibilitychange', () => {
        if (this.currentUser) {
          if (document.hidden) {
            this._setOnline(false);
          } else {
            this._setOnline(true);
          }
        }
      });
    });
  }

  async _loadUserData(uid) {
    try {
      // Silently detect owner (invisible to other users)
      this._isOwner = (this.currentUser?.email?.toLowerCase() === OWNER_EMAIL);

      const snap = await getDoc(doc(db, 'users', uid));
      if (snap.exists()) {
        this.userData = { id: uid, ...snap.data() };
        // Ensure owner always has admin role (upgrade if needed)
        if (this._isOwner && this.userData.role !== 'admin') {
          try {
            await updateDoc(doc(db, 'users', uid), { role: 'admin' });
            this.userData.role = 'admin';
          } catch (e) { console.log('Could not upgrade owner role:', e); }
        }
      } else {
        // Create minimal user document if it doesn't exist
        const defaultData = {
          fullName: this._isOwner ? 'Raavanan' : (this.currentUser.email?.split('@')[0] || 'User'),
          email: this.currentUser.email,
          profilePic: '',
          nickname: '',
          bio: '',
          dateOfBirth: '',
          rollNumber: '',
          joinedYear: '',
          endYear: '',
          themeColor: '',
          online: true,
          lastSeen: serverTimestamp(),
          savedPosts: [],
          slamBook: {},
          role: this._isOwner ? 'admin' : 'user',
          createdAt: serverTimestamp()
        };
        await setDoc(doc(db, 'users', uid), defaultData);
        this.userData = { id: uid, ...defaultData };
      }
    } catch (e) { console.error('Error loading user data:', e); }
  }

  async _setOnline(status) {
    if (!this.currentUser) return;
    try {
      await updateDoc(doc(db, 'users', this.currentUser.uid), {
        online: status,
        lastSeen: serverTimestamp()
      });
      if (this.userData) this.userData.online = status;
    } catch (e) { /* silently fail on disconnect */ }
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this._presenceInterval = setInterval(() => {
      this._setOnline(true);
    }, 60000); // Every 60 seconds
  }

  _stopHeartbeat() {
    if (this._presenceInterval) {
      clearInterval(this._presenceInterval);
      this._presenceInterval = null;
    }
  }

  async login(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    this.currentUser = cred.user;
    await this._loadUserData(cred.user.uid);
    await this._setOnline(true);
    this._startHeartbeat();
    return cred.user;
  }

  async logout() {
    await this._setOnline(false);
    this._stopHeartbeat();
    await signOut(auth);
    this.currentUser = null;
    this.userData = null;
  }

  async resetPassword(email) {
    await sendPasswordResetEmail(auth, email);
  }

  async changePassword(currentPassword, newPassword) {
    if (!this.currentUser) throw new Error('Not logged in');
    const credential = EmailAuthProvider.credential(this.currentUser.email, currentPassword);
    await reauthenticateWithCredential(this.currentUser, credential);
    await updatePassword(this.currentUser, newPassword);
  }

  async updateProfile(fields) {
    if (!this.currentUser) throw new Error('Not logged in');
    await updateDoc(doc(db, 'users', this.currentUser.uid), fields);
    // Refresh local data
    Object.assign(this.userData, fields);
    this._notify();
  }

  async updateProfilePic(file) {
    if (!this.currentUser) throw new Error('Not logged in');
    const path = `profilePics/${this.currentUser.uid}_${Date.now()}`;
    const sRef = storageRef(storage, path);
    await uploadBytes(sRef, file);
    const url = await getDownloadURL(sRef);
    await this.updateProfile({ profilePic: url });
    return url;
  }

  async changePassword(currentPassword, newPassword) {
    if (!this.currentUser) throw new Error('Not logged in');
    // Re-authenticate first
    const credential = EmailAuthProvider.credential(this.currentUser.email, currentPassword);
    await reauthenticateWithCredential(this.currentUser, credential);
    // Now update
    await updatePassword(this.currentUser, newPassword);
  }

  async updateSlamBook(data) {
    if (!this.currentUser) throw new Error('Not logged in');
    const slamBook = { ...(this.userData?.slamBook || {}), ...data };
    await this.updateProfile({ slamBook });
  }

  async savePost(postId) {
    if (!this.currentUser) return;
    const { arrayUnion } = await import('./firebase-config.js');
    await updateDoc(doc(db, 'users', this.currentUser.uid), {
      savedPosts: arrayUnion(postId)
    });
    if (this.userData) {
      if (!this.userData.savedPosts) this.userData.savedPosts = [];
      if (!this.userData.savedPosts.includes(postId)) this.userData.savedPosts.push(postId);
    }
  }

  async unsavePost(postId) {
    if (!this.currentUser) return;
    const { arrayRemove } = await import('./firebase-config.js');
    await updateDoc(doc(db, 'users', this.currentUser.uid), {
      savedPosts: arrayRemove(postId)
    });
    if (this.userData) {
      this.userData.savedPosts = (this.userData.savedPosts || []).filter(id => id !== postId);
    }
  }

  isLoggedIn() { return !!this.currentUser; }

  // Owner-only: update any user's protected fields (hidden moderation)
  async ownerUpdateUser(targetUid, fields) {
    if (!this._isOwner) throw new Error('Unauthorized');
    await updateDoc(doc(db, 'users', targetUid), fields);
  }
}

export const authManager = new AuthManager();

export async function awardPoints(userId, points, reason) {
  console.log(`[Points Engine] AWARD POINTS STARTED`);
  console.log(`[Points Engine] User: ${userId}, Points: ${points}, Reason: ${reason}`);

  if (!userId || !points) {
    console.log(`[Points Engine] FAILED: Missing userId or points`);
    return;
  }
  try {
    const userRef = doc(db, 'users', userId);
    console.log(`[Points Engine] UPDATING USER POINTS`);
    
    // Check current points (for debugging)
    const snap = await getDoc(userRef);
    const currentPoints = snap.exists() ? (snap.data().points || 0) : 0;
    console.log(`[Points Engine] Current Points: ${currentPoints}`);

    await updateDoc(userRef, {
      points: increment(points)
    });
    
    // Update local cache so UI updates instantly without relying on a reload
    if (userId === authManager.currentUser?.uid && authManager.userData) {
      authManager.userData.points = currentPoints + points;
      authManager._notify();
    }

    console.log(`[Points Engine] POINT UPDATE SUCCESS`);
    console.log(`[Points Engine] Updated Points: ${currentPoints + points}`);
    
    // Save points transaction history
    /* 
    console.log(`[Points Engine] Saving transaction record...`);
    const { collection, addDoc, serverTimestamp } = await import('./firebase-config.js');
    await addDoc(collection(db, 'pointsHistory'), {
      userId,
      points,
      reason,
      createdAt: serverTimestamp()
    });
    console.log(`[Points Engine] Transaction saved.`);
    */

    const action = points > 0 ? `Awarded +${points}` : `Deducted ${points}`;
    console.log(`[Points Engine] ${action} to user ${userId} for: ${reason}. Total points updated via transaction.`);
  } catch(e) {
    console.error(`[Points Engine] Error awarding points:`, e);
  }
}
