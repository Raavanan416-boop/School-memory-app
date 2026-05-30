// Birthday page — Birthday calendar with 10-day upcoming filter + month grid click filter
// Enhanced with birthday points system, wish viewing, and gift points
import { db, collection, getDocs, addDoc, doc, getDoc, updateDoc, query, where, orderBy, onSnapshot, serverTimestamp, increment } from '../firebase-config.js';
import { showToast, sanitizeHTML, isBirthdayToday, getDaysUntil, formatDate, timeAgo } from '../utils.js';
import { authManager } from '../auth.js';
import { router } from '../router.js';
import { createNotification } from '../notifications.js';

// Track active listeners for cleanup
let _activeListeners = [];

function cleanupListeners() {
  _activeListeners.forEach(unsub => { if (typeof unsub === 'function') unsub(); });
  _activeListeners = [];
}

// ===== CORE FILTER FUNCTIONS =====

/**
 * Filter users whose next birthday is within the next N days (default 10).
 * Returns sorted array with `daysUntil` field attached.
 */
function filterUpcomingTenDays(users, maxDays = 10) {
  return users
    .filter(u => u.dateOfBirth && !isBirthdayToday(u.dateOfBirth))
    .map(u => ({ ...u, daysUntil: getDaysUntil(u.dateOfBirth) }))
    .filter(u => u.daysUntil <= maxDays)
    .sort((a, b) => a.daysUntil - b.daysUntil);
}

/**
 * Filter users whose birthday falls in a specific month (0-indexed).
 * Returns sorted by day-of-month.
 */
function filterBySelectedMonth(users, monthIndex) {
  return users
    .filter(u => {
      if (!u.dateOfBirth) return false;
      return new Date(u.dateOfBirth).getMonth() === monthIndex;
    })
    .map(u => {
      const bd = new Date(u.dateOfBirth);
      return { ...u, birthDay: bd.getDate(), daysUntil: getDaysUntil(u.dateOfBirth) };
    })
    .sort((a, b) => a.birthDay - b.birthDay);
}

// ===== BIRTHDAY POINTS — AUTO CLAIM =====

/**
 * Auto-claim +10 birthday points for the current user if today is their birthday.
 * Only once per year, prevents duplicates via birthdayPoints collection.
 */
async function autoClaimBirthdayPoints() {
  const currentUser = authManager.currentUser;
  const userData = authManager.userData;
  if (!currentUser || !userData?.dateOfBirth) return;

  // Check if today is the user's birthday
  if (!isBirthdayToday(userData.dateOfBirth)) return;

  const currentYear = new Date().getFullYear();

  try {
    // Check if already claimed this year
    const q = query(
      collection(db, 'birthdayPoints'),
      where('targetUserId', '==', currentUser.uid),
      where('year', '==', currentYear),
      where('type', '==', 'birthday_self')
    );
    const snap = await getDocs(q);

    if (!snap.empty) return; // Already claimed

    // Award +10 birthday points
    await addDoc(collection(db, 'birthdayPoints'), {
      type: 'birthday_self',
      targetUserId: currentUser.uid,
      senderId: currentUser.uid,
      senderName: userData.fullName || 'Unknown',
      points: 10,
      year: currentYear,
      createdAt: serverTimestamp()
    });

    // Increment user's total points
    await updateDoc(doc(db, 'users', currentUser.uid), {
      points: increment(10)
    });

    showToast('🎉 Happy Birthday! You received +10 Birthday Points.', 'success');
  } catch (e) {
    console.error('Auto-claim birthday points error:', e);
  }
}

// ===== MAIN RENDER =====

export async function renderBirthday(container) {
  // Cleanup previous listeners
  cleanupListeners();

  let users = [];
  try {
    const snap = await getDocs(collection(db, 'users'));
    snap.forEach(d => users.push({ id: d.id, ...d.data() }));
  } catch (e) { }

  const currentUserId = authManager.currentUser?.uid;
  const todayBirthdays = users.filter(u => isBirthdayToday(u.dateOfBirth));
  const upcomingTen = filterUpcomingTenDays(users, 10);

  // Auto-claim birthday points for current user
  autoClaimBirthdayPoints();

  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const monthAbbr = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  // Track which month is currently selected
  let selectedMonth = -1;

  container.innerHTML = `
    <section class="px-4 pt-4 pb-24">
      <div class="flex items-center gap-3 mb-5">
        <button id="bday-back-btn" class="inner-back-btn">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
        </button>
        <h2 class="text-xl font-bold text-navy-800 flex-1">🎂 Birthdays</h2>
      </div>

      <!-- ====== TODAY'S BIRTHDAYS ====== -->
      ${todayBirthdays.length > 0 ? `
        <div class="mb-6">
          ${todayBirthdays.map(u => {
            const isMe = u.id === currentUserId;
            return `
            <div class="birthday-banner mb-3">
              <div class="confetti-container" id="bday-confetti-${u.id}"></div>
              <div class="relative z-10 text-center p-6">
                <div class="text-5xl mb-2">🎂</div>
                <h3 class="text-xl font-bold text-navy-800">Happy Birthday, ${sanitizeHTML(u.fullName || 'Classmate')}! 🎉</h3>
                <p class="text-sm text-navy-600 mt-1">${u.dateOfBirth ? new Date(u.dateOfBirth).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }) : ''}</p>
                <div class="mt-4 flex items-center justify-center gap-3">
                  ${isMe ? `
                    <button class="px-5 py-2.5 bg-gradient-to-r from-pink-500 to-rose-500 text-white rounded-full text-sm font-semibold shadow-lg view-wishes-btn" data-uid="${u.id}" data-name="${sanitizeHTML(u.fullName || '')}">
                      View Wishes ❤️
                    </button>
                  ` : `
                    <button class="px-5 py-2.5 bg-navy-500 text-white rounded-full text-sm font-semibold send-wish-btn" data-uid="${u.id}" data-name="${sanitizeHTML(u.fullName || '')}">
                      🎂 Wish Birthday
                    </button>
                  `}
                </div>
                <div class="mt-3 wishes-preview" id="wishes-${u.id}"></div>
              </div>
            </div>
          `}).join('')}
        </div>
      ` : `
        <div class="card p-6 text-center mb-6">
          <div class="text-3xl mb-2">🎂</div>
          <p class="text-sm text-gray-400">No birthdays today</p>
        </div>
      `}

      <!-- ====== UPCOMING (NEXT 10 DAYS ONLY) ====== -->
      <div class="mb-6">
        <div class="flex items-center gap-2 mb-3">
          <h3 class="section-title">Upcoming Birthdays</h3>
          <span class="text-[10px] px-2 py-0.5 rounded-full bg-warm-100 text-warm-600 font-semibold">Next 10 days</span>
        </div>
        <div class="space-y-2" id="upcoming-list">
          ${upcomingTen.length > 0 ? upcomingTen.map(u => renderBirthdayCard(u)).join('') : `
            <div class="card p-5 text-center">
              <div class="text-2xl mb-2">🗓️</div>
              <p class="text-sm font-medium text-navy-700">No birthdays in the next 10 days</p>
              <p class="text-xs text-gray-400 mt-1">Check the calendar below to find your classmates' birthdays</p>
            </div>
          `}
        </div>
      </div>

      <!-- ====== BIRTHDAY CALENDAR GRID ====== -->
      <div class="mb-4">
        <h3 class="section-title mb-3">Birthday Calendar</h3>
        <div class="grid grid-cols-3 gap-2" id="month-grid">
          ${months.map((month, idx) => {
            const monthUsers = users.filter(u => u.dateOfBirth && new Date(u.dateOfBirth).getMonth() === idx);
            const currentMonth = new Date().getMonth();
            const isCurrentMonth = idx === currentMonth;
            return `
              <button class="bday-month-card card p-3 text-center transition-all duration-200 ${isCurrentMonth ? 'ring-2 ring-navy-300' : ''} ${monthUsers.length > 0 ? 'cursor-pointer hover:shadow-md active:scale-[0.97]' : 'opacity-50 cursor-default'}" data-month="${idx}" ${monthUsers.length === 0 ? 'disabled' : ''}>
                <p class="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">${monthAbbr[idx]}</p>
                <p class="text-lg font-bold text-navy-500">${monthUsers.length}</p>
                <div class="flex justify-center gap-0.5 mt-1">
                  ${monthUsers.slice(0, 4).map(u =>
                    u.profilePic
                      ? `<img src="${u.profilePic}" class="w-5 h-5 rounded-full object-cover border border-white" alt=""/>`
                      : `<div class="w-5 h-5 rounded-full bg-navy-100 text-navy-600 flex items-center justify-center text-[8px] font-bold">${(u.fullName || '?')[0]}</div>`
                  ).join('')}
                  ${monthUsers.length > 4 ? `<div class="w-5 h-5 rounded-full bg-cream-200 text-gray-500 flex items-center justify-center text-[8px]">+${monthUsers.length - 4}</div>` : ''}
                </div>
              </button>
            `;
          }).join('')}
        </div>
      </div>
    </section>
  `;

  // ===== EVENT HANDLERS =====

  // Back button
  container.querySelector('#bday-back-btn')?.addEventListener('click', () => router.navigateBack());

  // Send wishes (for friends)
  container.querySelectorAll('.send-wish-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showWishModal(btn.dataset.uid, btn.dataset.name);
    });
  });

  // View wishes (for birthday person)
  container.querySelectorAll('.view-wishes-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showViewWishesModal(btn.dataset.uid, btn.dataset.name);
    });
  });

  // Load wishes preview for today's birthdays
  todayBirthdays.forEach(u => {
    loadWishesPreview(container, u.id);
    const confettiBox = container.querySelector(`#bday-confetti-${u.id}`);
    if (confettiBox) spawnConfetti(confettiBox);
  });

  // ===== MONTH GRID CLICK → MODAL =====
  const monthGrid = container.querySelector('#month-grid');
  let activeModal = null; // track current open modal

  monthGrid?.addEventListener('click', (e) => {
    const card = e.target.closest('.bday-month-card');
    if (!card || card.disabled) return;

    const monthIdx = parseInt(card.dataset.month, 10);
    if (isNaN(monthIdx)) return;

    // Close existing modal if open
    if (activeModal) {
      closeBdayModal();
      if (selectedMonth === monthIdx) return; // toggle off same month
    }

    selectedMonth = monthIdx;

    // Highlight the clicked card
    monthGrid.querySelectorAll('.bday-month-card').forEach(c => {
      c.classList.remove('ring-2', 'ring-navy-500', 'bg-navy-50');
    });
    card.classList.add('ring-2', 'ring-navy-500', 'bg-navy-50');

    // Filter data
    const filtered = filterBySelectedMonth(users, monthIdx);

    // Build modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'bday-modal-overlay';
    overlay.innerHTML = `
      <div class="bday-modal-backdrop"></div>
      <div class="bday-modal-card">
        <div class="bday-modal-header">
          <div class="bday-modal-header-left">
            <span class="bday-modal-emoji">🎂</span>
            <div>
              <h3 class="bday-modal-title">${months[monthIdx]} Birthdays</h3>
              <p class="bday-modal-subtitle">${filtered.length} classmate${filtered.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <button class="bday-modal-close" id="bday-modal-close-btn" aria-label="Close">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="bday-modal-body">
          ${filtered.length > 0 ? `
            <div class="bday-modal-list">
              ${filtered.map(u => renderBirthdayCard(u, true)).join('')}
            </div>
          ` : `
            <div class="bday-modal-empty">
              <div class="text-3xl mb-2">📭</div>
              <p class="text-sm font-medium text-navy-700">No birthdays in ${months[monthIdx]}</p>
              <p class="text-xs text-gray-400 mt-1">Try another month!</p>
            </div>
          `}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    activeModal = overlay;

    // Trigger entrance animation
    requestAnimationFrame(() => overlay.classList.add('bday-modal-active'));

    // Close handlers
    overlay.querySelector('#bday-modal-close-btn')?.addEventListener('click', closeBdayModal);
    overlay.querySelector('.bday-modal-backdrop')?.addEventListener('click', closeBdayModal);

    // Close on Escape key
    const onEsc = (ev) => { if (ev.key === 'Escape') closeBdayModal(); };
    document.addEventListener('keydown', onEsc);
    overlay._escHandler = onEsc;
  });

  function closeBdayModal() {
    if (!activeModal) return;

    // Remove ESC listener
    if (activeModal._escHandler) document.removeEventListener('keydown', activeModal._escHandler);

    // Exit animation
    activeModal.classList.add('bday-modal-closing');
    activeModal.classList.remove('bday-modal-active');
    setTimeout(() => {
      activeModal?.remove();
      activeModal = null;
    }, 250);

    selectedMonth = -1;

    // Reset grid highlights
    const currentMonth = new Date().getMonth();
    monthGrid?.querySelectorAll('.bday-month-card').forEach(c => {
      c.classList.remove('ring-2', 'ring-navy-500', 'bg-navy-50');
      if (parseInt(c.dataset.month) === currentMonth) {
        c.classList.add('ring-2', 'ring-navy-300');
      }
    });
  }
}

// Cleanup function for router
export function destroyBirthday() {
  cleanupListeners();
}

// ===== REUSABLE BIRTHDAY CARD RENDERER =====

function renderBirthdayCard(u, showFullDate = false) {
  const dateStr = u.dateOfBirth
    ? new Date(u.dateOfBirth).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })
    : '';

  // Badge logic
  let badgeClass = 'bg-cream-100 text-gray-500';
  let badgeText = `${u.daysUntil} days`;

  if (u.daysUntil === 0) {
    badgeClass = 'bg-green-100 text-green-600 font-bold';
    badgeText = '🎂 Today!';
  } else if (u.daysUntil === 1) {
    badgeClass = 'bg-warm-100 text-warm-600 font-bold';
    badgeText = '⏰ Tomorrow!';
  } else if (u.daysUntil <= 3) {
    badgeClass = 'bg-warm-100 text-warm-600 font-semibold';
    badgeText = `${u.daysUntil} days`;
  } else if (u.daysUntil <= 7) {
    badgeClass = 'bg-amber-50 text-amber-600 font-semibold';
    badgeText = `${u.daysUntil} days`;
  }

  return `
    <div class="card p-3 flex items-center gap-3 hover:shadow-sm transition-shadow">
      ${u.profilePic
        ? `<img src="${u.profilePic}" class="w-10 h-10 rounded-full object-cover border-2 border-white shadow-sm" alt=""/>`
        : `<div class="w-10 h-10 rounded-full bg-navy-500 text-white flex items-center justify-center text-sm font-bold shadow-sm">${(u.fullName || '?')[0]}</div>`}
      <div class="flex-1 min-w-0">
        <p class="text-sm font-semibold text-navy-800">${sanitizeHTML(u.fullName || 'Unknown')}</p>
        <p class="text-xs text-gray-400">${dateStr}</p>
      </div>
      <span class="text-xs px-2.5 py-1 rounded-full ${badgeClass} whitespace-nowrap">
        ${badgeText}
      </span>
    </div>
  `;
}

// ===== ENHANCED WISH MODAL (for friends) =====

function showWishModal(userId, userName) {
  const modal = router.openModal('', { title: `🎂 Wish ${userName}` });
  modal.body.innerHTML = `
    <div class="p-4 space-y-4">
      <div>
        <label class="text-xs font-semibold text-navy-600 mb-1.5 block">💌 Your Birthday Message</label>
        <textarea id="wish-text" rows="3" placeholder="Write your birthday wishes..."
          class="w-full px-4 py-3 border border-gray-200 rounded-2xl text-sm text-navy-800 placeholder:text-gray-400 focus:outline-none focus:border-navy-500 resize-none bg-white font-handwriting text-base"></textarea>
      </div>

      <!-- Points Toggle -->
      <div class="flex items-center justify-between p-3 rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200">
        <div class="flex items-center gap-2">
          <span class="text-lg">🎁</span>
          <div>
            <p class="text-sm font-semibold text-navy-800">Send +5 Birthday Points</p>
            <p class="text-[10px] text-gray-400">Gift points to ${sanitizeHTML(userName)}</p>
          </div>
        </div>
        <label class="bday-toggle-switch">
          <input type="checkbox" id="send-points-toggle" checked>
          <span class="bday-toggle-slider"></span>
        </label>
      </div>

      <div class="flex gap-2">
        <button id="cancel-wish" class="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-500 hover:bg-gray-50 transition-colors">Cancel</button>
        <button id="submit-wish" class="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-navy-500 to-navy-600 text-white text-sm font-semibold shadow-md hover:shadow-lg transition-all">Send Wish 🎂</button>
      </div>
    </div>
  `;

  // Cancel button
  modal.body.querySelector('#cancel-wish')?.addEventListener('click', () => modal.close());

  // Submit wish
  modal.body.querySelector('#submit-wish')?.addEventListener('click', async () => {
    const text = modal.body.querySelector('#wish-text')?.value.trim();
    const sendPoints = modal.body.querySelector('#send-points-toggle')?.checked;

    if (!text) { showToast('Write something!', 'warning'); return; }

    const submitBtn = modal.body.querySelector('#submit-wish');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending...'; }

    try {
      const currentYear = new Date().getFullYear();

      // Save wish to birthdays collection
      await addDoc(collection(db, 'birthdays'), {
        targetUserId: userId,
        authorId: authManager.currentUser.uid,
        authorName: authManager.userData?.fullName || 'Unknown',
        authorPhoto: authManager.userData?.profilePic || '',
        message: text,
        pointsSent: sendPoints ? 5 : 0,
        year: currentYear,
        createdAt: serverTimestamp()
      });

      // Send notification — birthday wish
      await createNotification('birthday_wish', userId, {
        message: `❤️ New Birthday Wish from ${authManager.userData?.fullName || 'Someone'}`
      });

      // Handle gift points
      if (sendPoints) {
        // Check for duplicate gift points
        const dupeQ = query(
          collection(db, 'birthdayPoints'),
          where('senderId', '==', authManager.currentUser.uid),
          where('targetUserId', '==', userId),
          where('year', '==', currentYear),
          where('type', '==', 'birthday_gift')
        );
        const dupeSnap = await getDocs(dupeQ);

        if (dupeSnap.empty) {
          // Award +5 gift points
          await addDoc(collection(db, 'birthdayPoints'), {
            type: 'birthday_gift',
            targetUserId: userId,
            senderId: authManager.currentUser.uid,
            senderName: authManager.userData?.fullName || 'Unknown',
            points: 5,
            year: currentYear,
            createdAt: serverTimestamp()
          });

          // Increment target user's total points
          await updateDoc(doc(db, 'users', userId), {
            points: increment(5)
          });

          // Send notification — gift points
          await createNotification('friend_bonus', userId, {
            message: `🎁 ${authManager.userData?.fullName || 'Someone'} sent you +5 Birthday Points`
          });

          showToast('🎉 Birthday points sent successfully!', 'success');
        } else {
          showToast('Wishes sent! 🎈 (Points already gifted earlier)', 'success');
        }
      } else {
        showToast('Wishes sent! 🎈', 'success');
      }

      modal.close();
    } catch (e) {
      console.error('Send wish error:', e);
      showToast('Failed to send', 'error');
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Send Wish 🎂'; }
    }
  });
}

// ===== VIEW WISHES MODAL (for birthday person) =====

function showViewWishesModal(userId, userName) {
  const modal = router.openModal('', { title: `❤️ Birthday Wishes` });
  modal.body.innerHTML = `
    <div class="p-4">
      <div class="text-center mb-4">
        <div class="text-3xl mb-1">🎂</div>
        <h3 class="text-base font-bold text-navy-800">${sanitizeHTML(userName)}'s Wishes</h3>
        <p class="text-xs text-gray-400">All the love from your classmates</p>
      </div>
      <div id="wishes-list-container" class="space-y-3">
        <div class="flex justify-center py-6">
          <div class="w-6 h-6 border-2 border-navy-300 border-t-transparent rounded-full animate-spin"></div>
        </div>
      </div>
    </div>
  `;

  const listContainer = modal.body.querySelector('#wishes-list-container');
  const currentYear = new Date().getFullYear();

  // Real-time listener for wishes
  try {
    const q = query(
      collection(db, 'birthdays'),
      where('targetUserId', '==', userId),
      where('year', '==', currentYear),
      orderBy('createdAt', 'desc')
    );

    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) {
        listContainer.innerHTML = `
          <div class="text-center py-8">
            <div class="text-4xl mb-3">💌</div>
            <p class="text-sm font-medium text-navy-700">No wishes yet</p>
            <p class="text-xs text-gray-400 mt-1">Your classmates will send wishes soon!</p>
          </div>
        `;
        return;
      }

      const wishes = [];
      snap.forEach(d => wishes.push({ id: d.id, ...d.data() }));

      listContainer.innerHTML = `
        <div class="text-center mb-3">
          <span class="text-xs px-3 py-1 rounded-full bg-pink-50 text-pink-600 font-semibold">
            ${wishes.length} wish${wishes.length !== 1 ? 'es' : ''} received 💕
          </span>
        </div>
        ${wishes.map((w, i) => {
          const time = w.createdAt?.toDate ? timeAgo(w.createdAt.toDate()) : 'just now';
          const pointsBadge = w.pointsSent ? `<span class="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 font-semibold">🎁 +${w.pointsSent} pts</span>` : '';
          return `
            <div class="card p-4 border border-pink-100 hover:border-pink-200 transition-all" style="animation: msgSlideIn 0.3s ease-out ${i * 0.08}s both;">
              <div class="flex items-start gap-3">
                ${w.authorPhoto
                  ? `<img src="${w.authorPhoto}" class="w-10 h-10 rounded-full object-cover border-2 border-pink-200 shadow-sm flex-shrink-0" alt=""/>`
                  : `<div class="w-10 h-10 rounded-full bg-gradient-to-br from-pink-400 to-rose-500 text-white flex items-center justify-center text-sm font-bold shadow-sm flex-shrink-0">${(w.authorName || '?')[0]}</div>`}
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <p class="text-sm font-semibold text-navy-800">${sanitizeHTML(w.authorName || 'Unknown')} ❤️</p>
                    ${pointsBadge}
                  </div>
                  <p class="text-sm text-navy-700 font-handwriting leading-relaxed">"${sanitizeHTML(w.message)}"</p>
                  <p class="text-[10px] text-gray-400 mt-2 flex items-center gap-1">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    ${time}
                  </p>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      `;
    });

    _activeListeners.push(unsub);
  } catch (e) {
    console.error('View wishes error:', e);
    listContainer.innerHTML = `
      <div class="text-center py-6">
        <p class="text-sm text-red-400">Failed to load wishes</p>
      </div>
    `;
  }
}

// ===== LOAD WISHES PREVIEW (shown below birthday banner) =====

async function loadWishesPreview(container, userId) {
  const wishesEl = container.querySelector(`#wishes-${userId}`);
  if (!wishesEl) return;

  try {
    const q = query(
      collection(db, 'birthdays'),
      where('targetUserId', '==', userId),
      where('year', '==', new Date().getFullYear()),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) {
        wishesEl.innerHTML = '<p class="text-xs text-gray-400">Be the first to wish!</p>';
        return;
      }
      wishesEl.innerHTML = `<p class="text-xs text-gray-500 mb-2">💕 ${snap.size} wish${snap.size !== 1 ? 'es' : ''} received!</p>` +
        [...snap.docs].slice(0, 3).map(d => {
          const w = d.data();
          return `<p class="text-xs text-gray-600"><span class="font-semibold">${sanitizeHTML(w.authorName)}</span>: ${sanitizeHTML(w.message)}</p>`;
        }).join('');
    });
    _activeListeners.push(unsub);
  } catch (e) { }
}

// ===== CONFETTI =====

function spawnConfetti(container) {
  if (!container) return;
  const colors = ['#ff6b6b', '#feca57', '#48dbfb', '#ff9ff3', '#54a0ff', '#5f27cd'];
  for (let i = 0; i < 20; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.cssText = `
      left: ${Math.random() * 100}%;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      animation-delay: ${Math.random() * 2}s;
      animation-duration: ${2 + Math.random() * 2}s;
    `;
    container.appendChild(piece);
  }
}
