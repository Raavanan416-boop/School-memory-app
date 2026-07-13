// Auth module — Full featured with presence, password change, profile updates
import { auth, db, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail,
  updatePassword, EmailAuthProvider, reauthenticateWithCredential,
  doc, getDoc, updateDoc, setDoc, serverTimestamp, Timestamp, increment,
  runTransaction } from './firebase-config.js';
import { uploadMedia } from './services/cloudinary.js';
import { presenceManager } from './presence.js';

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
      // Mark offline on page unload — best effort via SDK
      // Primary reliability comes from: visibilitychange (tab switch) + heartbeat (every 60s)
      // If heartbeat stops, the client-side getLastSeenText() will show "offline" after staleness
      window.addEventListener('beforeunload', () => {
        if (this.currentUser) {
          // Fire-and-forget SDK calls — may or may not complete before page closes
          // But visibilitychange (fires before beforeunload) + heartbeat handle most cases
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
        // (Legacy leaderboard sync removed)

        // Fetch new savedPosts subcollection and migrate if old array exists
        this.userData.savedPosts = [];
        try {
          const { getDocs, collection } = await import('./firebase-config.js');
          const savedSnap = await getDocs(collection(db, 'users', uid, 'savedPosts'));
          savedSnap.forEach(d => this.userData.savedPosts.push(d.id));

          // Quick migration from old array
          if (this.userData.savedPosts && Array.isArray(this.userData.savedPosts) && this.userData.savedPosts.length > 0 && this.userData.savedPosts.length === 0) {
            const { setDoc, doc } = await import('./firebase-config.js');
            for (const pid of this.userData.savedPosts) {
              await setDoc(doc(db, 'users', uid, 'savedPosts', pid), { savedAt: serverTimestamp() });
              this.userData.savedPosts.push(pid);
            }
          }
        } catch (e) { console.error('Error loading saved posts:', e); }
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
          points: 0,
          createdAt: serverTimestamp()
        };
        await setDoc(doc(db, 'users', uid), defaultData);
        // Create presence entries for new user
        await setDoc(doc(db, 'presence', uid), { online: true, lastSeen: serverTimestamp() });
        this.userData = { id: uid, ...defaultData };
      }
    } catch (e) { console.error('Error loading user data:', e); }
  }

  async _setOnline(status) {
    if (!this.currentUser) return;
    if (status) {
      await presenceManager.setOnline();
    } else {
      await presenceManager.setOffline();
    }
    if (this.userData) this.userData.online = status;
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this._presenceInterval = setInterval(() => {
      presenceManager.setOnline();
    }, 30000); // Every 30 seconds
  }

  _stopHeartbeat() {
    if (this._presenceInterval) {
      clearInterval(this._presenceInterval);
      this._presenceInterval = null;
    }
  }

  async login(email, password, isManual = false) {
    sessionStorage.setItem("loginSession", "true");
    sessionStorage.setItem("isFreshLogin", "true");
    if (isManual) {
      sessionStorage.setItem("isExplicitLoginEvent", "true");
    } else {
      sessionStorage.removeItem("isExplicitLoginEvent");
    }
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      this.currentUser = cred.user;
      await this._loadUserData(cred.user.uid);
      await this._setOnline(true);
      this._startHeartbeat();
      return cred.user;
    } catch (err) {
      sessionStorage.removeItem("loginSession");
      sessionStorage.removeItem("isFreshLogin");
      sessionStorage.removeItem("isExplicitLoginEvent");
      throw err;
    }
  }

  async logout() {
    sessionStorage.removeItem("birthdayIntroShownThisLogin");
    sessionStorage.removeItem("playlistStartedThisLogin");
    localStorage.removeItem("birthdayIntroLastShown");

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
    const res = await uploadMedia(file, 'image');
    const url = res.url;
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
    const { setDoc, doc, serverTimestamp } = await import('./firebase-config.js');
    await setDoc(doc(db, 'users', this.currentUser.uid, 'savedPosts', postId), {
      userId: this.currentUser.uid,
      postId: postId,
      savedAt: serverTimestamp()
    });
    if (this.userData) {
      if (!this.userData.savedPosts) this.userData.savedPosts = [];
      if (!this.userData.savedPosts.includes(postId)) this.userData.savedPosts.push(postId);
    }
  }

  async unsavePost(postId) {
    if (!this.currentUser) return;
    const { deleteDoc, doc } = await import('./firebase-config.js');
    await deleteDoc(doc(db, 'users', this.currentUser.uid, 'savedPosts', postId));
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
  console.log(`[Points] ${reason}: ${points > 0 ? '+' : ''}${points} → ${userId}`);
  if (!userId || !points) return;

  try {
    const userRef = doc(db, 'users', userId);

    await runTransaction(db, async (transaction) => {
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists()) throw "User document does not exist!";

      const userData = userDoc.data();
      const currentPoints = userData.points || 0;
      const newPoints = Math.max(0, currentPoints + points);

      // Update users collection
      transaction.update(userRef, { points: newPoints });
    });

    // Update local cache so UI updates instantly
    if (userId === authManager.currentUser?.uid && authManager.userData) {
      authManager.userData.points = Math.max(0, (authManager.userData.points || 0) + points);
      authManager._notify();
    }

    console.log(`[Points] ✓ ${reason} complete`);
  } catch(e) {
    console.error(`[Points] Error awarding points:`, e);
  }
}

export async function transferPoints(senderId, receiverId, points, reason) {
  console.log(`[Points Transfer] ${reason}: ${points} pts from ${senderId} to ${receiverId}`);
  if (!senderId || !receiverId || !points || points <= 0) return false;

  try {
    const senderRef = doc(db, 'users', senderId);
    const receiverRef = doc(db, 'users', receiverId);

    await runTransaction(db, async (transaction) => {
      const senderDoc = await transaction.get(senderRef);
      const receiverDoc = await transaction.get(receiverRef);

      if (!senderDoc.exists() || !receiverDoc.exists()) {
        throw new Error("One or both user documents do not exist.");
      }

      const senderData = senderDoc.data();
      const receiverData = receiverDoc.data();
      const currentSenderPoints = senderData.points || 0;
      const currentReceiverPoints = receiverData.points || 0;

      if (currentSenderPoints < points) {
        throw new Error("Insufficient points");
      }

      const newSenderPoints = currentSenderPoints - points;
      const newReceiverPoints = currentReceiverPoints + points;

      transaction.update(senderRef, { points: newSenderPoints });
      transaction.update(receiverRef, { points: newReceiverPoints });
    });

    // Instantly update the local cache for the current user (sender)
    if (senderId === authManager.currentUser?.uid && authManager.userData) {
      authManager.userData.points = Math.max(0, (authManager.userData.points || 0) - points);
      authManager._notify();
    }

    console.log(`[Points Transfer] ✓ Complete`);
    return true;
  } catch (e) {
    console.error(`[Points Transfer] Error:`, e);
    throw e;
  }
}

