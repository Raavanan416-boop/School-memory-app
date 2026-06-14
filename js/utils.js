// Utility helpers — Extended for all features
export function $(sel, ctx = document) { return ctx.querySelector(sel); }
export function $$(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; }

export function html(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') el.className = v;
    else if (k === 'innerHTML') el.innerHTML = v;
    else if (k === 'textContent') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v);
  }
  children.forEach(c => {
    if (typeof c === 'string') el.appendChild(document.createTextNode(c));
    else if (c) el.appendChild(c);
  });
  return el;
}

export function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const colors = {
    info: 'toast-info',
    success: 'toast-success',
    error: 'toast-error',
    warning: 'toast-warning'
  };
  const icons = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };
  const toast = document.createElement('div');
  toast.className = `toast ${colors[type] || 'toast-info'}`;
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${sanitizeHTML(msg)}</span>`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  setTimeout(() => {
    toast.classList.add('toast-removing');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

export function timeAgo(date) {
  if (!date) return '';
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function formatDate(date) {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

export function formatDateShort(date) {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(date);
}

// School end date — customize this
export const SCHOOL_END_DATE = new Date('2025-04-25T00:00:00');

export function getTimeSinceSchool() {
  const now = new Date();
  let years = now.getFullYear() - SCHOOL_END_DATE.getFullYear();
  let months = now.getMonth() - SCHOOL_END_DATE.getMonth();
  let days = now.getDate() - SCHOOL_END_DATE.getDate();
  let hours = now.getHours() - SCHOOL_END_DATE.getHours();
  let minutes = now.getMinutes() - SCHOOL_END_DATE.getMinutes();
  let seconds = now.getSeconds() - SCHOOL_END_DATE.getSeconds();
  if (seconds < 0) { seconds += 60; minutes--; }
  if (minutes < 0) { minutes += 60; hours--; }
  if (hours < 0) { hours += 24; days--; }
  if (days < 0) { const prev = new Date(now.getFullYear(), now.getMonth(), 0).getDate(); days += prev; months--; }
  if (months < 0) { months += 12; years--; }
  return { years, months, days, hours, minutes, seconds };
}

export const EMOTIONAL_QUOTES = [
  "Some memories never graduate.",
  "One classroom. One family.",
  "School ended. Friendship didn't.",
  "Those were the golden days.",
  "We didn't realize we were making memories.",
  "The bell rang, but the bond didn't break.",
  "Same bench. Same laughter. Forever.",
  "We grew up, but we never grew apart.",
  "Class dismissed, but friendship is forever.",
  "Every corner of school holds a memory."
];

export const MEMORY_CATEGORIES = ['Tour', 'Farewell', 'Sports Day', 'Classroom Fun', 'Group Selfie', 'Cultural Event', 'Random', 'Birthday', 'Exam Time', 'Last Day'];

// ===== New Utility Functions =====

export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function throttle(fn, ms = 300) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    }
  };
}

export function formatNumber(n) {
  if (!n && n !== 0) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

export function sanitizeHTML(str) {
  if (!str) return '';
  const temp = document.createElement('div');
  temp.textContent = str;
  return temp.innerHTML;
}

export function isBirthdayToday(dateStr) {
  if (!dateStr) return false;
  const today = new Date();
  const bd = new Date(dateStr);
  return bd.getMonth() === today.getMonth() && bd.getDate() === today.getDate();
}

export function isSameDay(d1, d2) {
  return d1.getDate() === d2.getDate() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getFullYear() === d2.getFullYear();
}

export function getDaysUntil(dateStr) {
  if (!dateStr) return Infinity;
  const today = new Date();
  const bd = new Date(dateStr);
  const thisYear = new Date(today.getFullYear(), bd.getMonth(), bd.getDate());
  if (thisYear < today) thisYear.setFullYear(thisYear.getFullYear() + 1);
  return Math.ceil((thisYear - today) / (1000 * 60 * 60 * 24));
}

export async function compressImage(file, maxWidth = 3000, quality = 1.0) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = (maxWidth / w) * h; w = maxWidth; }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        
        // Ensure the new filename has .webp extension
        const newName = file.name.replace(/\.[^/.]+$/, "") + ".webp";
        
        canvas.toBlob((blob) => {
          resolve(new File([blob], newName, { type: 'image/webp', lastModified: Date.now() }));
        }, 'image/webp', quality);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// Emoji mood options for diary
export function optimizeCloudinaryUrl(url, width = null) {
  if (!url || !url.includes('cloudinary.com')) return url;
  // Insert quality and format optimizations, optionally applying width
  return url.replace('/upload/', `/upload/q_auto:best,f_auto${width ? ',w_' + width : ''}/`);
}

export const MOOD_EMOJIS = ['😊', '😢', '😂', '🥰', '😎', '🤔', '😤', '🎉', '😴', '🤗'];

// Truth or Dare questions
export const TRUTH_QUESTIONS = [
  "What's the most embarrassing thing that happened to you in school?",
  "Who was your first school crush?",
  "What's the funniest thing a teacher ever said to you?",
  "Did you ever cheat on a test? Be honest!",
  "What's the craziest thing you did during break time?",
  "Who did you gossip about the most?",
  "What's your most embarrassing school uniform moment?",
  "Which teacher did you secretly dislike?",
  "What's the worst excuse you gave for not doing homework?",
  "Did you ever cry in school? Why?",
  "What's the biggest secret you kept from your parents about school?",
  "Who was your favorite bench partner and why?",
  "What's the most trouble you got into?",
  "Did you ever have a secret note passed in class?",
  "What's the funniest nickname someone had?"
];

export const DARE_CHALLENGES = [
  "Post your most embarrassing school photo right now!",
  "Call your old best friend and tell them you miss school.",
  "Send a voice message singing the school anthem.",
  "Change your profile pic to your school photo for 24 hours.",
  "Write a heartfelt message to someone you lost touch with.",
  "Post a childhood memory you've never shared before.",
  "Send a DM to the person you sat next to saying 'I miss our bench'.",
  "Record yourself doing your teacher's signature move.",
  "Share the last thing you'd want the class to know about you.",
  "Write a 'Sorry' message to someone you troubled in school."
];

// Never Have I Ever statements
export const NEVER_HAVE_I_EVER = [
  "Never have I ever copied homework from a friend",
  "Never have I ever fallen asleep in class",
  "Never have I ever had a crush on a teacher",
  "Never have I ever bunked a class",
  "Never have I ever been sent to the principal's office",
  "Never have I ever cried on the last day of school",
  "Never have I ever eaten someone else's lunch",
  "Never have I ever passed a note in class",
  "Never have I ever pretended to be sick to skip school",
  "Never have I ever been in a school play",
  "Never have I ever broken a school rule on purpose",
  "Never have I ever had a nickname you hated",
  "Never have I ever been the teacher's pet",
  "Never have I ever forgotten my books at home",
  "Never have I ever been late to school more than 5 times in a month"
];
