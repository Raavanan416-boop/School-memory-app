// Birthday page — Birthday calendar with birthday points system
// Fixed: manual claim, birthday person gifts points to friends, view wishes
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

function filterUpcomingTenDays(users, maxDays = 10) {
  return users
    .filter(u => u.dateOfBirth && !isBirthdayToday(u.dateOfBirth))
    .map(u => ({ ...u, daysUntil: getDaysUntil(u.dateOfBirth) }))
    .filter(u => u.daysUntil <= maxDays)
    .sort((a, b) => a.daysUntil - b.daysUntil);
}

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

// ===== CHECK IF BIRTHDAY GIFT ALREADY CLAIMED =====

async function checkBirthdayClaimed(userId) {
  const currentYear = new Date().getFullYear();
  try {
    const q = query(
      collection(db, 'birthdayPoints'),
      where('targetUserId', '==', userId),
      where('year', '==', currentYear),
      where('type', '==', 'birthday_self')
    );
    const snap = await getDocs(q);
    return !snap.empty;
  } catch (e) {
    console.error('Check claim error:', e);
    return false;
  }
}

// ===== MANUAL CLAIM BIRTHDAY GIFT (+10 POINTS) =====

async function claimBirthdayGift(btnElement) {
  const currentUser = authManager.currentUser;
  const userData = authManager.userData;
  if (!currentUser || !userData?.dateOfBirth) return;

  if (!isBirthdayToday(userData.dateOfBirth)) {
    showToast('It\'s not your birthday today!', 'warning');
    return;
  }

  // Disable button immediately
  btnElement.disabled = true;
  btnElement.textContent = 'Claiming...';

  const currentYear = new Date().getFullYear();

  try {
    // Double-check not already claimed
    const alreadyClaimed = await checkBirthdayClaimed(currentUser.uid);
    if (alreadyClaimed) {
      btnElement.textContent = '✅ Birthday Gift Claimed';
      btnElement.classList.add('opacity-60');
      showToast('You already claimed your birthday gift!', 'info');
      return;
    }

    // Claim +10 birthday points
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

    btnElement.textContent = '✅ Birthday Gift Claimed';
    btnElement.classList.add('opacity-60');
    showToast('🎉 You claimed +10 Birthday Points!', 'success');
  } catch (e) {
    console.error('Claim birthday gift error:', e);
    btnElement.disabled = false;
    btnElement.textContent = '🎁 Claim Birthday Gift (+10 Points)';
    showToast('Failed to claim. Try again.', 'error');
  }
}

// ===== GIFT 5 POINTS TO A FRIEND (birthday person only) =====

function showGiftPointsModal(allUsers) {
  const currentUser = authManager.currentUser;
  const userData = authManager.userData;
  if (!currentUser || !userData) return;

  // Filter out self
  const friends = allUsers.filter(u => u.id !== currentUser.uid);

  const modal = router.openModal('', { title: '🎁 Gift Birthday Points' });
  modal.body.innerHTML = `
    <div class="p-4 space-y-4">
      <div class="text-center mb-2">
        <p class="text-sm text-navy-700">Select a friend to gift <strong>+5 points</strong></p>
        <p class="text-[10px] text-gray-400 mt-1">You will lose 5 points. You must have enough balance.</p>
      </div>

      <div class="space-y-2 max-h-[300px] overflow-y-auto" id="gift-friends-list">
        ${friends.map(u => `
          <button class="gift-friend-btn card p-3 flex items-center gap-3 w-full text-left hover:shadow-md transition-all active:scale-[0.98]" data-uid="${u.id}" data-name="${sanitizeHTML(u.fullName || 'Unknown')}">
            ${u.profilePic
              ? `<img src="${u.profilePic}" class="w-9 h-9 rounded-full object-cover border-2 border-white shadow-sm" alt=""/>`
              : `<div class="w-9 h-9 rounded-full bg-navy-500 text-white flex items-center justify-center text-xs font-bold shadow-sm">${(u.fullName || '?')[0]}</div>`}
            <div class="flex-1 min-w-0">
              <p class="text-sm font-semibold text-navy-800 truncate">${sanitizeHTML(u.fullName || 'Unknown')}</p>
            </div>
            <span class="text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-600 font-semibold whitespace-nowrap">🎁 +5 pts</span>
          </button>
        `).join('')}
      </div>

      <button id="cancel-gift" class="w-full py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-500 hover:bg-gray-50 transition-colors">Cancel</button>
    </div>
  `;

  modal.body.querySelector('#cancel-gift')?.addEventListener('click', () => modal.close());

  // Handle friend selection
  modal.body.querySelectorAll('.gift-friend-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const targetId = btn.dataset.uid;
      const targetName = btn.dataset.name;

      // Disable all buttons
      modal.body.querySelectorAll('.gift-friend-btn').forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });
      btn.style.opacity = '1';
      btn.querySelector('span').textContent = 'Sending...';

      const currentYear = new Date().getFullYear();

      try {
        // Check if already gifted this year
        const dupeQ = query(
          collection(db, 'birthdayPoints'),
          where('senderId', '==', currentUser.uid),
          where('year', '==', currentYear),
          where('type', '==', 'birthday_gift')
        );
        const dupeSnap = await getDocs(dupeQ);

        if (!dupeSnap.empty) {
          showToast('You already gifted points this birthday!', 'warning');
          modal.close();
          return;
        }

        // Check if birthday person has enough points
        const myDoc = await getDoc(doc(db, 'users', currentUser.uid));
        const myPoints = myDoc.data()?.points || 0;
        if (myPoints < 5) {
          showToast('Not enough points! You need at least 5.', 'warning');
          modal.close();
          return;
        }

        // Create birthday gift record
        await addDoc(collection(db, 'birthdayPoints'), {
          type: 'birthday_gift',
          targetUserId: targetId,
          senderId: currentUser.uid,
          senderName: userData.fullName || 'Unknown',
          points: 5,
          year: currentYear,
          createdAt: serverTimestamp()
        });

        // Deduct 5 from birthday person
        await updateDoc(doc(db, 'users', currentUser.uid), {
          points: increment(-5)
        });

        // Add 5 to friend
        await updateDoc(doc(db, 'users', targetId), {
          points: increment(5)
        });

        // Send notification to friend
        await createNotification('friend_bonus', targetId, {
          points: 5,
          message: `🎁 ${userData.fullName || 'Someone'} gifted you +5 Birthday Points!`
        });

        showToast(`🎉 Gifted +5 points to ${targetName}!`, 'success');
        modal.close();
      } catch (e) {
        console.error('Gift points error:', e);
        showToast('Failed to gift points. Try again.', 'error');
        modal.close();
      }
    });
  });
}

// ===== MAIN RENDER =====
let unsubBirthday = null;

export function destroyBirthday() {
  if (unsubBirthday) {
    unsubBirthday();
    unsubBirthday = null;
  }
  cleanupListeners();
}

export async function renderBirthday(container) {
  router.registerDestroy('birthday', destroyBirthday);
  destroyBirthday();
  cleanupListeners();

  let users = [];
  try {
    const snap = await getDocs(collection(db, 'users'));
    snap.forEach(d => users.push({ id: d.id, ...d.data() }));
  } catch (e) { }

  const currentUserId = authManager.currentUser?.uid;
  const todayBirthdays = users.filter(u => isBirthdayToday(u.dateOfBirth));
  const upcomingTen = filterUpcomingTenDays(users, 10);
  const iAmBirthdayPerson = todayBirthdays.some(u => u.id === currentUserId);

  // Check if already claimed (for birthday person)
  let alreadyClaimed = false;
  if (iAmBirthdayPerson) {
    alreadyClaimed = await checkBirthdayClaimed(currentUserId);
  }

  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const monthAbbr = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

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
                <div class="mt-4 flex flex-col items-center gap-2">
                  ${isMe ? `
                    <!-- Birthday Person: View Wishes -->
                    <button class="px-5 py-2.5 bg-gradient-to-r from-pink-500 to-rose-500 text-white rounded-full text-sm font-semibold shadow-lg view-wishes-btn" data-uid="${u.id}" data-name="${sanitizeHTML(u.fullName || '')}">
                      🎁 View Wishes
                    </button>
                    <!-- Birthday Person: Claim Gift -->
                    <button class="px-5 py-2.5 rounded-full text-sm font-semibold shadow-md claim-birthday-btn ${alreadyClaimed ? 'bg-gray-300 text-gray-500 opacity-60' : 'bg-gradient-to-r from-amber-500 to-orange-500 text-white'}" ${alreadyClaimed ? 'disabled' : ''}>
                      ${alreadyClaimed ? '✅ Birthday Gift Claimed' : '🎁 Claim Birthday Gift (+10 Points)'}
                    </button>
                    <!-- Birthday Person: Gift 5 Points to Friend -->
                    <button class="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-full text-sm font-semibold shadow-md gift-points-btn">
                      🎁 Gift 5 Birthday Points to a Friend
                    </button>
                  ` : `
                    <!-- Not Birthday Person: Send Wish only (no wish data shown) -->
                    <button class="px-5 py-2.5 bg-navy-500 text-white rounded-full text-sm font-semibold send-wish-btn" data-uid="${u.id}" data-name="${sanitizeHTML(u.fullName || '')}">
                      🎂 Send Wish
                    </button>
                  `}
                </div>
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

  // Claim birthday gift (birthday person only)
  container.querySelector('.claim-birthday-btn')?.addEventListener('click', (e) => {
    claimBirthdayGift(e.currentTarget);
  });

  // Gift 5 points to a friend (birthday person only)
  container.querySelector('.gift-points-btn')?.addEventListener('click', () => {
    showGiftPointsModal(users);
  });

  // Send wishes (for friends — NOT birthday person)
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

  // Confetti for today's birthdays
  todayBirthdays.forEach(u => {
    const confettiBox = container.querySelector(`#bday-confetti-${u.id}`);
    if (confettiBox) spawnConfetti(confettiBox);
  });

  // ===== MONTH GRID CLICK → MODAL =====
  const monthGrid = container.querySelector('#month-grid');
  let activeModal = null;

  monthGrid?.addEventListener('click', (e) => {
    const card = e.target.closest('.bday-month-card');
    if (!card || card.disabled) return;

    const monthIdx = parseInt(card.dataset.month, 10);
    if (isNaN(monthIdx)) return;

    if (activeModal) {
      closeBdayModal();
      if (selectedMonth === monthIdx) return;
    }

    selectedMonth = monthIdx;

    monthGrid.querySelectorAll('.bday-month-card').forEach(c => {
      c.classList.remove('ring-2', 'ring-navy-500', 'bg-navy-50');
    });
    card.classList.add('ring-2', 'ring-navy-500', 'bg-navy-50');

    const filtered = filterBySelectedMonth(users, monthIdx);

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

    requestAnimationFrame(() => overlay.classList.add('bday-modal-active'));

    overlay.querySelector('#bday-modal-close-btn')?.addEventListener('click', closeBdayModal);
    overlay.querySelector('.bday-modal-backdrop')?.addEventListener('click', closeBdayModal);

    const onEsc = (ev) => { if (ev.key === 'Escape') closeBdayModal(); };
    document.addEventListener('keydown', onEsc);
    overlay._escHandler = onEsc;
  });

  function closeBdayModal() {
    if (!activeModal) return;
    if (activeModal._escHandler) document.removeEventListener('keydown', activeModal._escHandler);
    activeModal.classList.add('bday-modal-closing');
    activeModal.classList.remove('bday-modal-active');
    setTimeout(() => {
      activeModal?.remove();
      activeModal = null;
    }, 250);
    selectedMonth = -1;
    const currentMonth = new Date().getMonth();
    monthGrid?.querySelectorAll('.bday-month-card').forEach(c => {
      c.classList.remove('ring-2', 'ring-navy-500', 'bg-navy-50');
      if (parseInt(c.dataset.month) === currentMonth) {
        c.classList.add('ring-2', 'ring-navy-300');
      }
    });
  }
}



// ===== REUSABLE BIRTHDAY CARD RENDERER =====

function renderBirthdayCard(u, showFullDate = false) {
  const dateStr = u.dateOfBirth
    ? new Date(u.dateOfBirth).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })
    : '';

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

// ===== WISH MODAL (for friends — message only, NO points) =====

function showWishModal(userId, userName) {
  const modal = router.openModal('', { title: `🎂 Wish ${userName}` });
  modal.body.innerHTML = `
    <div class="p-4 space-y-4">
      <div>
        <label class="text-xs font-semibold text-navy-600 mb-1.5 block">💌 Your Birthday Message</label>
        <textarea id="wish-text" rows="3" placeholder="Write your birthday wishes..."
          class="w-full px-4 py-3 border border-gray-200 rounded-2xl text-sm text-navy-800 placeholder:text-gray-400 focus:outline-none focus:border-navy-500 resize-none bg-white font-handwriting text-base"></textarea>
      </div>
      <div class="flex gap-2">
        <button id="cancel-wish" class="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-500 hover:bg-gray-50 transition-colors">Cancel</button>
        <button id="submit-wish" class="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-navy-500 to-navy-600 text-white text-sm font-semibold shadow-md hover:shadow-lg transition-all">Send Wish 🎂</button>
      </div>
    </div>
  `;

  modal.body.querySelector('#cancel-wish')?.addEventListener('click', () => modal.close());

  modal.body.querySelector('#submit-wish')?.addEventListener('click', async () => {
    const text = modal.body.querySelector('#wish-text')?.value.trim();
    if (!text) { showToast('Write something!', 'warning'); return; }

    const submitBtn = modal.body.querySelector('#submit-wish');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending...'; }

    try {
      const currentYear = new Date().getFullYear();

      // Check for duplicate wish from same user this year
      const dupeQ = query(
        collection(db, 'birthdays'),
        where('targetUserId', '==', userId),
        where('authorId', '==', authManager.currentUser.uid),
        where('year', '==', currentYear)
      );
      const dupeSnap = await getDocs(dupeQ);
      if (!dupeSnap.empty) {
        showToast('You already sent a wish!', 'info');
        modal.close();
        return;
      }

      // Save wish to birthdays collection
      await addDoc(collection(db, 'birthdays'), {
        targetUserId: userId,
        authorId: authManager.currentUser.uid,
        authorName: authManager.userData?.fullName || 'Unknown',
        authorPhoto: authManager.userData?.profilePic || '',
        message: text,
        year: currentYear,
        createdAt: serverTimestamp()
      });

      // Send notification
      await createNotification('birthday_wish', userId, {
        message: `❤️ New Birthday Wish from ${authManager.userData?.fullName || 'Someone'}`
      });

      showToast('🎉 Wishes sent!', 'success');
      modal.close();
    } catch (e) {
      console.error('Send wish error:', e);
      showToast('Failed to send', 'error');
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Send Wish 🎂'; }
    }
  });
}

// ===== VIEW WISHES MODAL (birthday person) =====

function showViewWishesModal(userId, userName) {
  const modal = router.openModal('', { title: '❤️ Birthday Wishes' });
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

  // Use getDocs instead of onSnapshot to avoid infinite loading from index issues
  (async () => {
    try {
      const q = query(
        collection(db, 'birthdays'),
        where('targetUserId', '==', userId),
        where('year', '==', currentYear)
      );
      const snap = await getDocs(q);

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

      // Sort by createdAt descending (manual sort since no orderBy to avoid index requirement)
      wishes.sort((a, b) => {
        const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
        const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
        return tb - ta;
      });

      listContainer.innerHTML = `
        <div class="text-center mb-3">
          <span class="text-xs px-3 py-1 rounded-full bg-pink-50 text-pink-600 font-semibold">
            ${wishes.length} wish${wishes.length !== 1 ? 'es' : ''} received 💕
          </span>
        </div>
        ${wishes.map((w, i) => {
          const time = w.createdAt?.toDate ? timeAgo(w.createdAt.toDate()) : 'just now';
          return `
            <div class="card p-4 border border-pink-100 hover:border-pink-200 transition-all" style="animation: msgSlideIn 0.3s ease-out ${i * 0.08}s both;">
              <div class="flex items-start gap-3">
                ${w.authorPhoto
                  ? `<img src="${w.authorPhoto}" class="w-10 h-10 rounded-full object-cover border-2 border-pink-200 shadow-sm flex-shrink-0" alt=""/>`
                  : `<div class="w-10 h-10 rounded-full bg-gradient-to-br from-pink-400 to-rose-500 text-white flex items-center justify-center text-sm font-bold shadow-sm flex-shrink-0">${(w.authorName || '?')[0]}</div>`}
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-semibold text-navy-800">${sanitizeHTML(w.authorName || 'Unknown')} ❤️</p>
                  <p class="text-sm text-navy-700 font-handwriting leading-relaxed mt-1">"${sanitizeHTML(w.message)}"</p>
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
    } catch (e) {
      console.error('View wishes error:', e);
      listContainer.innerHTML = `
        <div class="text-center py-6">
          <div class="text-3xl mb-2">😕</div>
          <p class="text-sm text-gray-500">Could not load wishes</p>
          <p class="text-[10px] text-gray-400 mt-1">Try again later</p>
        </div>
      `;
    }
  })();
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
