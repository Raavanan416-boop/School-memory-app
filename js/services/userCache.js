import { db, collection, onSnapshot } from '../firebase-config.js';
import { sanitizeHTML } from '../utils.js';

class UserCacheManager {
  constructor() {
    this.users = new Map();
    this.initialized = false;
    this.listeners = [];
  }

  onChange(callback) {
    this.listeners.push(callback);
  }

  _notify() {
    this.listeners.forEach(cb => cb(this.users));
  }

  init() {
    if (this.initialized) return;

    onSnapshot(collection(db, 'users'), (snap) => {
      snap.docChanges().forEach(change => {
        const uid = change.doc.id;
        const data = change.doc.data();
        data.id = uid;
        this.users.set(uid, data);
        
        // Immediately patch the DOM for any visible elements bound to this user
        this.updateDOM(uid, data);
      });

      if (!this.initialized) {
        this.initialized = true;
      }
      
      this._notify();
    }, (err) => {
      console.error('[UserCache] Error:', err);
    });
  }

  getUser(uid) {
    const user = this.users.get(uid);
    if (user) {
      return {
        ...user,
        displayName: user.displayName || user.fullName || user.username || user.nickname || 'User',
        username: user.username || user.nickname || '',
        photoURL: (user.photoURL && user.photoURL !== 'undefined') ? user.photoURL : ((user.profilePic && user.profilePic !== 'undefined') ? user.profilePic : ''),
        profilePic: (user.photoURL && user.photoURL !== 'undefined') ? user.photoURL : ((user.profilePic && user.profilePic !== 'undefined') ? user.profilePic : ''),
        rollNumber: user.rollNumber || ''
      };
    }
    return { 
      displayName: 'User',
      fullName: 'User', 
      photoURL: '',
      profilePic: '', 
      username: 'Anonymous',
      nickname: 'Anonymous',
      points: 0,
      rollNumber: 'N/A'
    };
  }

  getAllUsers() {
    return Array.from(this.users.values()).map(u => ({ 
      ...u,
      id: u.id,
      displayName: u.displayName || u.fullName || u.username || u.nickname || 'User',
      username: u.username || u.nickname || '',
      photoURL: (u.photoURL && u.photoURL !== 'undefined') ? u.photoURL : ((u.profilePic && u.profilePic !== 'undefined') ? u.profilePic : ''),
      profilePic: (u.photoURL && u.photoURL !== 'undefined') ? u.photoURL : ((u.profilePic && u.profilePic !== 'undefined') ? u.profilePic : ''),
      rollNumber: u.rollNumber || ''
    }));
  }

  updateDOM(uid, user) {
    const name = user.displayName || user.fullName || user.username || user.nickname || 'User';
    const safeName = sanitizeHTML(name);
    let safePic = user.photoURL ? user.photoURL : (user.profilePic ? user.profilePic : '');
    if (safePic) safePic = safePic.replace(/&amp;/g, '&');
    const placeholderChar = name ? name[0].toUpperCase() : '?';

    // 1. Update Names
    document.querySelectorAll(`[data-user-name="${uid}"]`).forEach(el => {
      if (el.textContent !== safeName) el.textContent = safeName;
    });

    // 2. Update Profile Pics
    document.querySelectorAll(`[data-user-pic="${uid}"]`).forEach(el => {
      // If it's already an image and we have a new image URL
      if (el.tagName === 'IMG' && safePic) {
        if (el.src !== safePic) el.src = safePic;
      } 
      // If it's an image but the user deleted their photo -> convert to placeholder div
      else if (el.tagName === 'IMG' && !safePic) {
        const div = document.createElement('div');
        div.className = el.className.replace('object-cover', 'flex items-center justify-center font-bold bg-navy-100 text-navy-800');
        div.setAttribute('data-user-pic', uid);
        div.textContent = placeholderChar;
        el.replaceWith(div);
      }
      // If it's a placeholder div and the user uploaded a photo -> convert to img
      else if (el.tagName !== 'IMG' && safePic && safePic !== 'undefined' && safePic !== 'null') {
        const img = document.createElement('img');
        // Safely replace ALL possible placeholder classes with object-cover
        let newClasses = el.className
          .replace(/flex|items-center|justify-center|font-bold|text-[\w-]+|bg-[\w-]+/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        img.className = newClasses + ' object-cover';
        img.setAttribute('data-user-pic', uid);
        img.src = safePic;
        img.alt = "";
        img.loading = "lazy";
        el.replaceWith(img);
      }
      // If it remains a placeholder div, just update the letter if name changed
      else if (el.tagName !== 'IMG' && !safePic) {
        if (el.textContent !== placeholderChar) el.textContent = placeholderChar;
      }
    });

    // 3. Update Usernames/Nicknames (optional bind)
    document.querySelectorAll(`[data-user-nickname="${uid}"]`).forEach(el => {
      const safeNick = sanitizeHTML(user.nickname || 'No Nickname');
      if (el.textContent !== safeNick) el.textContent = safeNick;
    });
  }
}

export const userCache = new UserCacheManager();
