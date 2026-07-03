// Birthday page — Birthday calendar with birthday points system
// Fixed: manual claim, birthday person gifts points to friends, view wishes
import { db, collection, getDocs, addDoc, doc, getDoc, updateDoc, setDoc, deleteDoc, query, where, orderBy, onSnapshot, serverTimestamp, increment } from '../firebase-config.js';
import { showToast, sanitizeHTML, isBirthdayToday, getDaysUntil, formatDate, timeAgo } from '../utils.js';
import { authManager, awardPoints, transferPoints } from '../auth.js';
import { router } from '../router.js';
import { createNotification, notificationManager } from '../notifications.js';

// Track active listeners for cleanup
let _activeListeners = [];

function cleanupListeners() {
  _activeListeners.forEach(unsub => { if (typeof unsub === 'function') unsub(); });
  _activeListeners = [];
}

// ===== AVATAR HELPER =====
function renderAvatar(u, imgClass, fallbackBgClass, fallbackTextClass) {
  const dpUrl = u.profileImage || u.photoURL || u.profilePic || u.avatar;
  const validUrl = dpUrl && dpUrl !== 'undefined' && dpUrl !== 'null' ? dpUrl : null;
  const initialChar = (u.fullName || u.authorName || '?')[0].toUpperCase();
  const fallbackHtml = `<div class="${imgClass} ${fallbackBgClass} ${fallbackTextClass} flex items-center justify-center font-bold">${initialChar}</div>`;
  if (validUrl) {
    const safeFallback = fallbackHtml.replace(/'/g, "\\'").replace(/"/g, "&quot;");
    return `<img src="${validUrl}" loading="lazy" class="${imgClass} object-cover bg-gray-50" alt="${initialChar}" onerror="this.outerHTML='${safeFallback}'" />`;
  }
  return fallbackHtml;
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

// ===== CHECK IF ALREADY GIFTED TO FRIEND =====

async function checkBirthdayGifted(userId) {
  const currentYear = new Date().getFullYear();
  try {
    const q = query(
      collection(db, 'birthdayPoints'),
      where('senderId', '==', userId),
      where('year', '==', currentYear),
      where('type', '==', 'birthday_gift')
    );
    const snap = await getDocs(q);
    return !snap.empty;
  } catch (e) {
    console.error('Check gifted error:', e);
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
    awardPoints(currentUser.uid, 10, 'Birthday Claim');

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
      </div>

      <div class="relative">
        <svg class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
        <input type="text" id="gift-friend-search" placeholder="Search friends by name or roll..." class="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-navy-500 bg-gray-50/50 transition-colors" />
      </div>

      <div class="space-y-2 max-h-[300px] overflow-y-auto" id="gift-friends-list">
        ${friends.map(u => `
          <button class="gift-friend-btn card p-3 flex items-center gap-3 w-full text-left hover:shadow-md transition-all active:scale-[0.98]" data-uid="${u.id}" data-name="${sanitizeHTML(u.fullName || 'Unknown')}">
            ${renderAvatar(u, 'w-10 h-10 rounded-full border-2 border-white shadow-sm', 'bg-navy-500', 'text-white text-sm')}
            <div class="flex-1 min-w-0">
              <p class="text-sm font-semibold text-navy-800 truncate bday-friend-name">${sanitizeHTML(u.fullName || 'Unknown')}</p>
              ${u.rollNumber ? `<p class="text-[11px] text-gray-500 font-medium mt-0.5 truncate bday-friend-roll">Roll: ${sanitizeHTML(u.rollNumber)}</p>` : ''}
            </div>
            <span class="text-xs px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-600 font-bold whitespace-nowrap">🎁 +5</span>
          </button>
        `).join('')}
      </div>

      <button id="cancel-gift" class="w-full py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-500 hover:bg-gray-50 transition-colors">Cancel</button>
    </div>
  `;

  modal.body.querySelector('#cancel-gift')?.addEventListener('click', () => modal.close());

  // Search filtering
  modal.body.querySelector('#gift-friend-search')?.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    modal.body.querySelectorAll('.gift-friend-btn').forEach(btn => {
      const name = btn.querySelector('.bday-friend-name')?.textContent.toLowerCase() || '';
      const roll = btn.querySelector('.bday-friend-roll')?.textContent.toLowerCase() || '';
      if (name.includes(term) || roll.includes(term)) {
        btn.style.display = 'flex';
      } else {
        btn.style.display = 'none';
      }
    });
  });

  // Handle friend selection
  modal.body.querySelectorAll('.gift-friend-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.uid;
      const targetName = btn.dataset.name;

      // Show confirmation modal
      const confirmOverlay = document.createElement('div');
      confirmOverlay.className = 'fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4 transition-opacity';
      confirmOverlay.innerHTML = `
        <div class="bg-white rounded-2xl p-6 w-full max-w-sm text-center shadow-xl transform transition-transform scale-95">
          <h3 class="text-lg font-bold text-navy-800 mb-6">Send 5 Birthday Points to ${sanitizeHTML(targetName)}?</h3>
          <div class="flex gap-3">
            <button id="confirm-cancel" class="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-500 hover:bg-gray-50">Cancel</button>
            <button id="confirm-send" class="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-sm font-semibold shadow-md hover:shadow-lg transition-all flex items-center justify-center">Send</button>
          </div>
        </div>
      `;
      document.body.appendChild(confirmOverlay);

      requestAnimationFrame(() => {
        confirmOverlay.querySelector('.bg-white').classList.remove('scale-95');
        confirmOverlay.querySelector('.bg-white').classList.add('scale-100');
      });

      confirmOverlay.querySelector('#confirm-cancel').addEventListener('click', () => {
        confirmOverlay.remove();
      });

      confirmOverlay.querySelector('#confirm-send').addEventListener('click', async (e) => {
        const sendBtn = e.currentTarget;
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<div class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>';

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
            confirmOverlay.remove();
            modal.close();
            return;
          }

          // Single point award (free gift, sender doesn't lose points)
          await awardPoints(targetId, 5, 'Birthday Gift Received');

          // Create birthday gift record
          await addDoc(collection(db, 'birthdayPoints'), {
            type: 'birthday_gift',
            receiverId: targetId,
            targetUserId: targetId, // Kept for safety
            senderId: currentUser.uid,
            senderName: userData.fullName || 'Unknown',
            points: 5,
            year: currentYear,
            createdAt: serverTimestamp(),
            timestamp: serverTimestamp()
          });

          // Send notification to friend
          await createNotification('friend_bonus', targetId, {
            points: 5,
            message: `🎂 ${userData.fullName || 'Someone'} sent you a Birthday Gift!\n🎁 +5 Points Added`
          });

          showToast(`🎉 Gifted +5 points to ${targetName}!`, 'success');
          
          // Update UI Button
          const mainBtn = document.querySelector('.gift-points-btn');
          if (mainBtn) {
            mainBtn.disabled = true;
            mainBtn.className = 'px-5 py-2.5 rounded-full text-sm font-semibold shadow-md gift-points-btn bg-emerald-500 text-white opacity-60';
            mainBtn.textContent = '✅ Birthday Gift Sent';
          }

          confirmOverlay.remove();
          modal.close();
        } catch (err) {
          console.error('Gift points error:', err);
          showToast('Failed to gift points. Try again.', 'error');
          sendBtn.disabled = false;
          sendBtn.textContent = 'Send';
        }
      });
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

async function archiveExpiredBirthdays() {
  if (!authManager.currentUser) return;
  const uid = authManager.currentUser.uid;
  const currentYear = new Date().getFullYear();
  
  try {
    // Check if we have active wishes
    const wishesSnap = await getDocs(collection(db, 'birthdayConversations', uid, 'wishes'));
    if (wishesSnap.empty) return;
    
    // Check the year of the first wish to see if it's from a past birthday
    const firstWish = wishesSnap.docs[0].data();
    const wishYear = firstWish.year || (currentYear - 1);
    
    // Check if birthday is today
    const birthdayToday = authManager.userData?.dateOfBirth ? isBirthdayToday(authManager.userData.dateOfBirth) : false;
    
    // Archive if it's not their birthday today OR if the wishes are explicitly from a past year
    if (!birthdayToday || wishYear < currentYear) {
      console.log('Archiving expired birthday conversation for year:', wishYear);
      
      let totalWishes = 0;
      let totalReplies = 0;
      let totalReactions = 0;
      
      const historyDocRef = doc(db, 'birthdayWishHistory', `${uid}_${wishYear}`);
      await setDoc(historyDocRef, {
        userId: uid,
        year: wishYear,
        archivedAt: serverTimestamp(),
      });
      
      for (const wishDoc of wishesSnap.docs) {
        totalWishes++;
        const wData = wishDoc.data();
        if (wData.reactions) totalReactions += wData.reactions.length;
        
        // Move wish to history
        await setDoc(doc(db, 'birthdayWishHistory', `${uid}_${wishYear}`, 'wishes', wishDoc.id), wData);
        
        // Move replies
        const repliesSnap = await getDocs(collection(db, 'birthdayConversations', uid, 'wishes', wishDoc.id, 'replies'));
        for (const repDoc of repliesSnap.docs) {
          totalReplies++;
          await setDoc(doc(db, 'birthdayWishHistory', `${uid}_${wishYear}`, 'wishes', wishDoc.id, 'replies', repDoc.id), repDoc.data());
          await deleteDoc(repDoc.ref);
        }
        
        await deleteDoc(wishDoc.ref);
      }
      
      // Update summary stats
      await setDoc(historyDocRef, {
        wishesCount: totalWishes,
        repliesCount: totalReplies,
        reactionsCount: totalReactions
      }, { merge: true });
      
      console.log('Archive complete');
    }
  } catch (err) {
    console.error('Error archiving birthdays:', err);
  }
}

export async function renderBirthday(container, data = {}) {
  // Run archiving in the background
  archiveExpiredBirthdays();
  router.registerDestroy('birthday', destroyBirthday);
  
  // Mark general birthday notifications as read when page opens
  notificationManager.markRelatedAsRead({ type: 'birthday' });

  destroyBirthday();
  cleanupListeners();

  let users = [];
  try {
    const snap = await getDocs(collection(db, 'users'));
    snap.forEach(d => users.push({ id: d.id, ...d.data() }));
  } catch (e) { }

  const renderUI = async (birthdayEnabled) => {
    if (!birthdayEnabled && !authManager.isOwner) {
      container.innerHTML = `
        <section class="px-4 pt-16 pb-24 h-full flex flex-col items-center justify-center min-h-[60vh] relative">
          <div class="flex w-full items-center gap-3 absolute top-4 left-4">
            <button id="bday-back-btn-cs" class="p-2 -ml-2 rounded-full hover:bg-gray-100 transition-colors">
              <svg class="w-6 h-6 text-navy-800" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
            </button>
            <h2 class="text-xl font-bold text-navy-800 flex-1">🎂 Birthdays</h2>
          </div>
          <div class="text-6xl mb-4 opacity-50 mt-10">🎂</div>
          <h2 class="text-2xl font-bold text-navy-800 text-center mb-2">Coming Soon</h2>
          <p class="text-gray-500 text-center text-sm px-4 max-w-xs">We are preparing something special for birthdays. Stay tuned!</p>
        </section>
      `;
      container.querySelector('#bday-back-btn-cs')?.addEventListener('click', () => router.navigateBack());
      return;
    }

  const currentUserId = authManager.currentUser?.uid;
  const todayBirthdays = users.filter(u => isBirthdayToday(u.dateOfBirth));
  const upcomingTen = filterUpcomingTenDays(users, 10);
  const iAmBirthdayPerson = todayBirthdays.some(u => u.id === currentUserId);

  // Check if already claimed (for birthday person)
  let alreadyClaimed = false;
  let alreadyGifted = false;
  if (iAmBirthdayPerson) {
    alreadyClaimed = await checkBirthdayClaimed(currentUserId);
    alreadyGifted = await checkBirthdayGifted(currentUserId);
  }

  const wishedUserIds = new Set();
  if (currentUserId) {
    const allDisplayedUsers = [...todayBirthdays, ...upcomingTen];
    await Promise.all(allDisplayedUsers.map(async (u) => {
      if (u.id === currentUserId) return;
      try {
        const snap = await getDoc(doc(db, 'birthdayConversations', u.id, 'wishes', currentUserId));
        if (snap.exists()) wishedUserIds.add(u.id);
      } catch (e) { console.error(e); }
    }));
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
                    <button class="px-5 py-2.5 rounded-full text-sm font-semibold shadow-md gift-points-btn ${alreadyGifted ? 'bg-emerald-500 text-white opacity-60' : 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white'}" ${alreadyGifted ? 'disabled' : ''}>
                      ${alreadyGifted ? '✅ Birthday Gift Sent' : '🎁 Gift 5 Birthday Points to a Friend'}
                    </button>
                  ` : `
                    <!-- Not Birthday Person: Send Wish or View Conversation -->
                    ${wishedUserIds.has(u.id) ? `
                      <button class="px-5 py-2.5 bg-pink-500 text-white rounded-full text-sm font-semibold view-conversation-btn shadow-md hover:bg-pink-600 transition-colors" data-uid="${u.id}" data-name="${sanitizeHTML(u.fullName || '')}">
                        💌 View Conversation
                      </button>
                    ` : `
                      <button class="px-5 py-2.5 bg-navy-500 text-white rounded-full text-sm font-semibold shadow-md hover:bg-navy-600 transition-colors send-wish-btn" data-uid="${u.id}" data-name="${sanitizeHTML(u.fullName || '')}">
                        🎂 Send Wish
                      </button>
                    `}
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
          ${upcomingTen.length > 0 ? upcomingTen.map(u => renderBirthdayCard(u, false, wishedUserIds)).join('') : `
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
                  ${monthUsers.slice(0, 4).map(u => renderAvatar(u, 'w-5 h-5 rounded-full border border-white', 'bg-navy-100', 'text-navy-600 text-[8px]')).join('')}
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
    btn.addEventListener('click', async (e) => {
      const targetBtn = e.currentTarget;
      const originalText = targetBtn.textContent;
      targetBtn.disabled = true;
      targetBtn.textContent = 'Wait...';

      const userId = targetBtn.dataset.uid;
      const userName = targetBtn.dataset.name;
      const currentYear = new Date().getFullYear();

      try {
        const dupeQ = query(
          collection(db, 'birthdayConversations', userId, 'wishes'),
          where('senderId', '==', authManager.currentUser.uid),
          where('year', '==', currentYear)
        );
        const dupeSnap = await getDocs(dupeQ);
        if (!dupeSnap.empty) {
          // Already sent a wish, open conversation view
          const wishDoc = dupeSnap.docs[0];
          showConversationModal(userId, userName, wishDoc.id, wishDoc.data());
        } else {
          // Open normal wish modal
          showWishModal(userId, userName);
        }
      } catch (err) {
        console.error('Check wish error:', err);
        showToast('Error checking wishes', 'error');
      }
      
      targetBtn.disabled = false;
      targetBtn.innerHTML = originalText; // original text had HTML like 🎂 Send Wish
    });
  });

  // View Conversation (for sender)
  container.querySelectorAll('.view-conversation-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const targetBtn = e.currentTarget;
      const originalText = targetBtn.innerHTML;
      targetBtn.disabled = true;
      targetBtn.textContent = 'Wait...';
      const userId = targetBtn.dataset.uid;
      const userName = targetBtn.dataset.name;
      try {
        const snap = await getDoc(doc(db, 'birthdayConversations', userId, 'wishes', authManager.currentUser.uid));
        if (snap.exists()) {
          showConversationModal(userId, { id: userId, fullName: userName }, snap.id, snap.data());
        } else {
          showToast('Wish not found', 'error');
        }
      } catch (err) {
        console.error(err);
        showToast('Error loading conversation', 'error');
      }
      targetBtn.disabled = false;
      targetBtn.innerHTML = originalText;
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
              ${filtered.map(u => renderBirthdayCard(u, true, wishedUserIds)).join('')}
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
  }; // end renderUI

  const unsubSettings = onSnapshot(doc(db, 'settings', 'features'), (docSnap) => {
    let isEnabled = false;
    if (docSnap.exists()) {
      isEnabled = docSnap.data().birthdayEnabled ?? false;
    }
    renderUI(isEnabled);
  }, (err) => {
    console.error('Settings snapshot error:', err);
    renderUI(false);
  });

  _activeListeners.push(unsubSettings);

  // Deep Link Handling for Birthday Wishes
  if (data?.action === 'open_wish' && data.wishId && data.birthdayUserId) {
    setTimeout(async () => {
      try {
        const userSnap = await getDoc(doc(db, 'users', data.birthdayUserId));
        if (userSnap.exists()) {
          const wishSnap = await getDoc(doc(db, 'birthdayConversations', data.birthdayUserId, 'wishes', data.wishId));
          const wishData = wishSnap.exists() ? wishSnap.data() : null;
          if (wishData) {
            showConversationModal(data.birthdayUserId, { id: userSnap.id, ...userSnap.data() }, data.wishId, wishData);
          } else {
            showToast('Conversation not found', 'error');
          }
        }
      } catch (err) { console.error('Deep link error:', err); }
    }, 300);
  }
}



// ===== REUSABLE BIRTHDAY CARD RENDERER =====

function renderBirthdayCard(u, showFullDate = false, wishedUserIds = new Set()) {
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
    <div class="card p-3 flex items-center gap-3 hover:shadow-sm transition-shadow ${wishedUserIds.has(u.id) ? 'border-2 border-pink-100 bg-pink-50/30' : ''}">
      ${renderAvatar(u, 'w-10 h-10 rounded-full border-2 border-white shadow-sm', 'bg-navy-500', 'text-white text-sm')}
      <div class="flex-1 min-w-0">
        <p class="text-sm font-semibold text-navy-800">${sanitizeHTML(u.fullName || 'Unknown')}</p>
        <p class="text-xs text-gray-400">${dateStr}</p>
      </div>
      <div class="flex flex-col items-end gap-1">
        <span class="text-xs px-2.5 py-1 rounded-full ${badgeClass} whitespace-nowrap">
          ${badgeText}
        </span>
        ${u.id !== authManager.currentUser?.uid && u.dateOfBirth && isBirthdayToday(u.dateOfBirth) ? (
          wishedUserIds.has(u.id) ? `
            <button class="text-[10px] font-semibold text-pink-600 bg-pink-100 px-2 py-1 rounded-full hover:bg-pink-200 view-conversation-btn" data-uid="${u.id}" data-name="${sanitizeHTML(u.fullName || '')}">
              💌 View Conversation
            </button>
          ` : `
            <button class="text-[10px] font-semibold text-navy-600 bg-navy-100 px-2 py-1 rounded-full hover:bg-navy-200 send-wish-btn" data-uid="${u.id}" data-name="${sanitizeHTML(u.fullName || '')}">
              🎂 Send Wish
            </button>
          `
        ) : ''}
      </div>
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

      // Save wish to birthdayWishes collection structure
      const wishId = authManager.currentUser.uid;
      await setDoc(doc(db, 'birthdayConversations', userId, 'wishes', wishId), {
        senderId: authManager.currentUser.uid,
        senderName: authManager.userData?.fullName || 'Unknown',
        senderPhoto: authManager.userData?.photoURL || authManager.userData?.profilePic || '',
        message: text,
        year: currentYear,
        createdAt: serverTimestamp(),
        seen: false,
        reactions: []
      });

      // Send notification with deep-link metadata
      await createNotification('birthday_wish', userId, {
        message: `❤️ New Birthday Wish from ${authManager.userData?.fullName || 'Someone'}`,
        wishId: wishId,
        birthdayUserId: userId,
        notificationType: 'birthday_wish'
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

export function showViewWishesModal(userId, userName, isHistory = false, historyYear = null) {
  const modal = router.openModal('', { title: isHistory ? `❤️ ${historyYear} Birthday Wishes` : '❤️ Birthday Wishes' });
  modal.body.innerHTML = `
    <div class="p-4">
      <div class="text-center mb-4">
        <div class="text-3xl mb-1">🎂</div>
        <h3 class="text-base font-bold text-navy-800">${sanitizeHTML(userName)}'s Wishes ${isHistory ? `(${historyYear})` : ''}</h3>
        <p class="text-xs text-gray-400">${isHistory ? 'Archived birthday conversation' : 'All the love from your classmates'}</p>
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

  let unsubWishes = null;

  try {
    let q;
    if (isHistory) {
      q = query(collection(db, 'birthdayWishHistory', `${userId}_${historyYear}`, 'wishes'));
    } else {
      q = query(
        collection(db, 'birthdayConversations', userId, 'wishes'),
        where('year', '==', currentYear)
      );
    }
    
    unsubWishes = onSnapshot(q, (snap) => {
      if (snap.empty) {
        listContainer.innerHTML = `
          <div class="text-center py-8">
            <div class="text-4xl mb-3">💌</div>
            <p class="text-sm font-medium text-navy-700">No wishes found</p>
          </div>
        `;
        return;
      }

      const wishes = [];
      snap.forEach(d => wishes.push({ id: d.id, ...d.data() }));

      // Sort by createdAt descending
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
          const isSeen = w.seen;
          
          // Only mark as seen if active
          if (!isHistory && !isSeen && userId === authManager.currentUser?.uid) {
            updateDoc(doc(db, 'birthdayConversations', userId, 'wishes', w.id), { seen: true }).catch(console.error);
          }
          
          return `
            <div class="card p-4 border border-pink-100 hover:border-pink-200 transition-all" style="animation: msgSlideIn 0.3s ease-out ${i * 0.08}s both;">
              <div class="flex items-start gap-3">
                ${renderAvatar({ photoURL: w.senderPhoto, fullName: w.senderName }, 'w-10 h-10 rounded-full border-2 border-pink-200 shadow-sm flex-shrink-0', 'bg-gradient-to-br from-pink-400 to-rose-500', 'text-white text-sm')}
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-semibold text-navy-800">${sanitizeHTML(w.senderName || 'Unknown')} ❤️</p>
                  <p class="text-sm text-navy-700 font-handwriting leading-relaxed mt-1">"${sanitizeHTML(w.message)}"</p>
                  <div class="mt-3 flex items-center justify-between">
                    <p class="text-[10px] text-gray-400 flex items-center gap-1">
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                      ${time}
                    </p>
                    <button class="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold hover:bg-blue-100 transition-colors flex items-center gap-1 reply-btn" data-wish-id="${w.id}" data-sender-name="${sanitizeHTML(w.senderName || '')}">
                      ${isHistory ? '💙 View Replies' : '💙 Reply / Thanks'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      `;
      
      // Bind reply buttons
      listContainer.querySelectorAll('.reply-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const wishId = btn.dataset.wishId;
          const wish = wishes.find(ww => ww.id === wishId);
          if (wish) {
            showConversationModal(userId, { id: userId, fullName: userName }, wishId, wish, isHistory, historyYear);
          }
        });
      });
      
    }, (err) => {
      console.error('View wishes error:', err);
      listContainer.innerHTML = `
        <div class="text-center py-6">
          <div class="text-3xl mb-2">😕</div>
          <p class="text-sm text-gray-500">Could not load wishes</p>
          <p class="text-[10px] text-gray-400 mt-1">Try again later</p>
        </div>
      `;
    });
    
    // Add cleanup to modal
    const origClose = modal.close;
    modal.close = function() {
      if (unsubWishes) unsubWishes();
      origClose.call(this);
    };
    
  } catch (e) {
    console.error('Setup wishes listener error:', e);
  }
}

// ===== CONVERSATION & REPLY MODAL (Thread View) =====

function showConversationModal(birthdayUserId, birthdayUserObjOrName, wishId, wishData, isHistory = false, historyYear = null) {
  const isMeBirthdayPerson = authManager.currentUser?.uid === birthdayUserId;
  const birthdayUserName = typeof birthdayUserObjOrName === 'string' ? birthdayUserObjOrName : birthdayUserObjOrName.fullName;
  const otherName = isMeBirthdayPerson ? wishData.senderName : birthdayUserName;
  
  const modal = router.openModal('', { title: `🎂 Chat with ${sanitizeHTML(otherName)} ${isHistory ? `(${historyYear})` : ''}` });
  
  modal.body.innerHTML = `
    <div class="flex flex-col h-[70vh] bg-gray-50 relative">
      <!-- Chat Header (Wish Details) -->
      <div class="bg-white p-4 border-b border-gray-100 flex-shrink-0 shadow-sm z-10">
        <div class="flex items-start gap-3">
          ${renderAvatar({ photoURL: wishData.senderPhoto, fullName: wishData.senderName }, 'w-10 h-10 rounded-full border-2 border-pink-200 shadow-sm flex-shrink-0', 'bg-gradient-to-br from-pink-400 to-rose-500', 'text-white text-sm')}
          <div class="flex-1 min-w-0">
            <p class="text-sm font-bold text-navy-800">${sanitizeHTML(wishData.senderName || 'Unknown')}</p>
            <p class="text-sm text-navy-700 font-handwriting leading-relaxed mt-1 p-3 bg-pink-50 rounded-2xl rounded-tl-sm inline-block">"${sanitizeHTML(wishData.message)}"</p>
            <div class="mt-2 flex items-center justify-between">
              <div class="flex items-center gap-1 text-[10px] text-gray-400">
                <span>${wishData.createdAt?.toDate ? formatDate(wishData.createdAt.toDate()) : 'just now'}</span>
                <span>•</span>
                <span id="wish-seen-status" class="${wishData.seen ? 'text-blue-500' : 'text-gray-400'} font-semibold">
                  ${wishData.seen ? '✓✓ Seen' : '✓ Sent'}
                </span>
              </div>
              <div class="flex items-center gap-2">
                <div id="reactions-container" class="flex items-center gap-1"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Chat Thread (Replies) -->
      <div id="replies-container" class="flex-1 overflow-y-auto p-4 space-y-3 pb-24">
        <div class="flex justify-center py-6">
          <div class="w-6 h-6 border-2 border-navy-300 border-t-transparent rounded-full animate-spin"></div>
        </div>
      </div>

      <!-- Reply Input Area -->
      ${!isHistory ? `
      <div class="absolute bottom-0 left-0 right-0 bg-white p-3 border-t border-gray-100 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <!-- Quick Replies -->
        <div class="flex gap-2 overflow-x-auto pb-2 scrollbar-hide snap-x">
          ${(isMeBirthdayPerson ? 
            ['❤️ Thank You!', '🥰 Thanks a lot!', '🎉 Thank you for your wishes!', '😊 Really appreciate it!', '🎂 Thanks for making my day special!'] : 
            ["You're welcome! ❤️", 'Have a blast! 🎉', 'Happy Birthday again! 🎂', 'Birthday ku party kudu! 😊', 'Enjoy your day! 🎁']
          ).map(opt => `
            <button class="quick-reply-btn snap-start whitespace-nowrap px-3 py-1.5 bg-blue-50 text-blue-600 rounded-full text-xs font-semibold border border-blue-100 hover:bg-blue-100 transition-colors flex-shrink-0">${opt}</button>
          `).join('')}
        </div>
        <!-- Custom Reply -->
        <div class="flex items-center gap-2 mt-2">
          <input type="text" id="custom-reply-input" maxlength="200" placeholder="Write a reply..." class="flex-1 px-4 py-2 border border-gray-200 rounded-full text-sm focus:outline-none focus:border-blue-500 bg-gray-50" />
          <button id="send-reply-btn" class="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 transition-colors shadow-md disabled:opacity-50 flex-shrink-0">
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"></path></svg>
          </button>
        </div>
      </div>
      ` : ''}
    </div>
  `;

  // Real-time Wish Updates (for reactions & seen status)
  const wishRef = isHistory 
    ? doc(db, 'birthdayWishHistory', `${birthdayUserId}_${historyYear}`, 'wishes', wishId)
    : doc(db, 'birthdayConversations', birthdayUserId, 'wishes', wishId);
    
  const unsubWish = onSnapshot(wishRef, (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    
    // Mark related notifications as read when opening conversation
    if (!isHistory) {
      notificationManager.markRelatedAsRead({ type: 'birthday_wish', wishId: wishId });
      notificationManager.markRelatedAsRead({ type: 'birthday_reply', wishId: wishId });
      notificationManager.markRelatedAsRead({ type: 'birthday_reaction', wishId: wishId });
    }

    // Update seen status
    const seenEl = modal.body.querySelector('#wish-seen-status');
    if (seenEl) {
      seenEl.className = data.seen ? 'text-blue-500 font-semibold' : 'text-gray-400 font-semibold';
      seenEl.textContent = data.seen ? '✓✓ Seen' : '✓ Sent';
    }

    // Update reactions
    const rxContainer = modal.body.querySelector('#reactions-container');
    if (rxContainer) {
      if (isMeBirthdayPerson && !isHistory) {
        // Birthday person can add reactions
        const availableReactions = ['❤️', '🎉', '🥳', '😊', '🙏'];
        const currentRx = data.reactions || [];
        rxContainer.innerHTML = availableReactions.map(r => {
          const isSelected = currentRx.includes(r);
          return `<button class="rx-btn w-6 h-6 rounded-full flex items-center justify-center text-sm ${isSelected ? 'bg-pink-100 border border-pink-300' : 'bg-gray-100 hover:bg-gray-200'} transition-colors" data-rx="${r}">${r}</button>`;
        }).join('');
        
        rxContainer.querySelectorAll('.rx-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const rx = btn.dataset.rx;
            let newRx = [...currentRx];
            if (newRx.includes(rx)) newRx = newRx.filter(x => x !== rx);
            else newRx.push(rx);
            
            try {
              await updateDoc(wishRef, { reactions: newRx });
              if (newRx.includes(rx)) {
                await createNotification('birthday_reaction', wishData.senderId, {
                  message: `${authManager.userData?.fullName} reacted ${rx} to your birthday wish.`,
                  wishId: wishId,
                  birthdayUserId: birthdayUserId,
                  notificationType: 'birthday_reaction'
                });
              }
            } catch (err) { console.error('Reaction error', err); }
          });
        });
      } else {
        // Sender or history mode only sees reactions
        const currentRx = data.reactions || [];
        rxContainer.innerHTML = currentRx.map(r => `<span class="w-6 h-6 rounded-full bg-pink-50 flex items-center justify-center text-sm">${r}</span>`).join('');
      }
    }
  });

  // Real-time Replies Listener
  const repliesContainer = modal.body.querySelector('#replies-container');
  const repliesRef = isHistory 
    ? collection(db, 'birthdayWishHistory', `${birthdayUserId}_${historyYear}`, 'wishes', wishId, 'replies')
    : collection(db, 'birthdayConversations', birthdayUserId, 'wishes', wishId, 'replies');
    
  const unsubReplies = onSnapshot(query(repliesRef, orderBy('createdAt', 'asc')), (snap) => {
    if (snap.empty) {
      repliesContainer.innerHTML = `<div class="text-center py-6 text-gray-400 text-xs">No replies yet.</div>`;
      return;
    }
    
    let html = '';
    snap.forEach(docSnap => {
      const rep = { id: docSnap.id, ...docSnap.data() };
      const isMine = rep.senderId === authManager.currentUser?.uid;
      const timeStr = rep.createdAt?.toDate ? formatDate(rep.createdAt.toDate()) : 'now';
      
      // Auto mark as seen if it's not mine and hasn't been seen
      if (!isHistory && !isMine && rep.status !== 'seen') {
        updateDoc(doc(db, 'birthdayConversations', birthdayUserId, 'wishes', wishId, 'replies', rep.id), { status: 'seen' }).catch(console.error);
      }

      let statusHtml = '';
      if (isMine) {
        if (rep.status === 'seen') statusHtml = '<span class="text-blue-200 font-semibold ml-1">✓✓ Seen</span>';
        else statusHtml = '<span class="text-white/70 font-semibold ml-1">✓✓ Delivered</span>';
      }
      
      html += `
        <div class="flex w-full ${isMine ? 'justify-end' : 'justify-start'} group">
          <div class="max-w-[85%] ${isMine ? 'bg-blue-600 text-white' : 'bg-white border border-gray-100 text-navy-800'} rounded-2xl p-3 shadow-sm relative">
            <p class="text-sm font-medium">${sanitizeHTML(rep.message)}</p>
            <p class="text-[9px] mt-1 flex items-center justify-${isMine ? 'end' : 'start'} gap-1 ${isMine ? 'text-blue-200' : 'text-gray-400'}">
              ${timeStr} ${statusHtml}
            </p>
          </div>
        </div>
      `;
    });
    repliesContainer.innerHTML = html;
    
    // Auto scroll to bottom
    setTimeout(() => { repliesContainer.scrollTop = repliesContainer.scrollHeight; }, 100);
  });

  // Sending Replies (For Both Users)
  const input = modal.body.querySelector('#custom-reply-input');
  const sendBtn = modal.body.querySelector('#send-reply-btn');
  
  if (input && sendBtn) {
    const sendReply = async (text) => {
      if (!text || !text.trim()) return;
      if (text.length > 200) { showToast('Reply max 200 chars', 'warning'); return; }
      
      sendBtn.disabled = true;
      input.value = '';
      
      try {
        await addDoc(collection(db, 'birthdayConversations', birthdayUserId, 'wishes', wishId, 'replies'), {
          senderId: authManager.currentUser.uid,
          senderName: authManager.userData?.fullName || 'Unknown',
          message: text.trim(),
          status: 'sent',
          createdAt: serverTimestamp()
        });
        
        // Notify the other user
        const targetUserId = isMeBirthdayPerson ? wishData.senderId : birthdayUserId;
        await createNotification('birthday_reply', targetUserId, {
          message: `🎂 ${authManager.userData?.fullName} replied: "${text.trim().substring(0, 50)}${text.length > 50 ? '...' : ''}"`,
          wishId: wishId,
          birthdayUserId: birthdayUserId,
          notificationType: 'birthday_reply'
        });
      } catch (err) {
        console.error('Send reply error', err);
        showToast('Failed to send', 'error');
      }
      sendBtn.disabled = false;
    };
    
    sendBtn.addEventListener('click', () => sendReply(input.value));
    input.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendReply(input.value); });
    
    modal.body.querySelectorAll('.quick-reply-btn').forEach(btn => {
      btn.addEventListener('click', () => sendReply(btn.textContent));
    });
  }

  // Cleanup listeners on close
  const origClose = modal.close;
  modal.close = function() {
    if (unsubWish) unsubWish();
    if (unsubReplies) unsubReplies();
    origClose.call(this);
  };
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
