// Birthday page — Birthday calendar, today's birthdays, wishes
import { db, collection, getDocs, addDoc, query, where, orderBy, onSnapshot, serverTimestamp } from '../firebase-config.js';
import { showToast, sanitizeHTML, isBirthdayToday, getDaysUntil, formatDate } from '../utils.js';
import { authManager } from '../auth.js';
import { router } from '../router.js';

export async function renderBirthday(container) {
  let users = [];
  try {
    const snap = await getDocs(collection(db, 'users'));
    snap.forEach(d => users.push({ id: d.id, ...d.data() }));
  } catch (e) { }

  const todayBirthdays = users.filter(u => isBirthdayToday(u.dateOfBirth));
  const upcoming = users
    .filter(u => u.dateOfBirth && !isBirthdayToday(u.dateOfBirth))
    .map(u => ({ ...u, daysUntil: getDaysUntil(u.dateOfBirth) }))
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, 10);

  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  container.innerHTML = `
    <section class="px-4 pt-4">
      <div class="flex items-center gap-3 mb-5">
        <button id="bday-back-btn" class="inner-back-btn">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
        </button>
        <h2 class="text-xl font-bold text-navy-800 flex-1">🎂 Birthdays</h2>
      </div>

      ${todayBirthdays.length > 0 ? `
        <div class="mb-6">
          ${todayBirthdays.map(u => `
            <div class="birthday-banner mb-3">
              <div class="confetti-container" id="bday-confetti-${u.id}"></div>
              <div class="relative z-10 text-center p-6">
                <div class="text-5xl mb-2">🎂</div>
                <h3 class="text-xl font-bold text-navy-800">Happy Birthday, ${sanitizeHTML(u.fullName || 'Classmate')}! 🎉</h3>
                <p class="text-sm text-navy-600 mt-1">${u.dateOfBirth ? new Date(u.dateOfBirth).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }) : ''}</p>
                <div class="mt-4 flex items-center justify-center gap-3">
                  <button class="px-5 py-2.5 bg-navy-500 text-white rounded-full text-sm font-semibold send-wish-btn" data-uid="${u.id}" data-name="${sanitizeHTML(u.fullName || '')}">
                    Send Wishes 🎈
                  </button>
                </div>
                <div class="mt-3 wishes-preview" id="wishes-${u.id}"></div>
              </div>
            </div>
          `).join('')}
        </div>
      ` : `
        <div class="card p-6 text-center mb-6">
          <div class="text-3xl mb-2">🎂</div>
          <p class="text-sm text-gray-400">No birthdays today</p>
        </div>
      `}

      <!-- Upcoming -->
      <div class="mb-6">
        <h3 class="section-title mb-3">Upcoming Birthdays</h3>
        <div class="space-y-2">
          ${upcoming.length > 0 ? upcoming.map(u => `
            <div class="card p-3 flex items-center gap-3">
              ${u.profilePic
                ? `<img src="${u.profilePic}" class="w-10 h-10 rounded-full object-cover" alt=""/>`
                : `<div class="w-10 h-10 rounded-full bg-navy-500 text-white flex items-center justify-center text-sm font-bold">${(u.fullName || '?')[0]}</div>`}
              <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-navy-800">${sanitizeHTML(u.fullName || 'Unknown')}</p>
                <p class="text-xs text-gray-400">${u.dateOfBirth ? new Date(u.dateOfBirth).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }) : ''}</p>
              </div>
              <span class="text-xs px-2 py-1 rounded-full ${u.daysUntil <= 7 ? 'bg-warm-100 text-warm-600 font-semibold' : 'bg-cream-100 text-gray-500'}">
                ${u.daysUntil === 0 ? 'Today!' : u.daysUntil === 1 ? 'Tomorrow!' : `${u.daysUntil} days`}
              </span>
            </div>
          `).join('') : '<p class="text-center text-gray-400 text-sm py-4">No upcoming birthdays found. Ask classmates to set their birthday!</p>'}
        </div>
      </div>

      <!-- Calendar grid -->
      <div>
        <h3 class="section-title mb-3">Birthday Calendar</h3>
        <div class="grid grid-cols-3 gap-2">
          ${months.map((month, idx) => {
            const monthUsers = users.filter(u => {
              if (!u.dateOfBirth) return false;
              return new Date(u.dateOfBirth).getMonth() === idx;
            });
            return `
              <div class="card p-3 text-center ${monthUsers.length > 0 ? 'border-warm-200' : ''}">
                <p class="text-[10px] text-gray-400 uppercase tracking-wider">${month.slice(0, 3)}</p>
                <p class="text-lg font-bold text-navy-500">${monthUsers.length}</p>
                <div class="flex justify-center gap-0.5 mt-1">
                  ${monthUsers.slice(0, 4).map(u =>
                    `<div class="w-5 h-5 rounded-full bg-navy-100 text-navy-600 flex items-center justify-center text-[8px] font-bold">${(u.fullName || '?')[0]}</div>`
                  ).join('')}
                  ${monthUsers.length > 4 ? `<div class="w-5 h-5 rounded-full bg-cream-200 text-gray-500 flex items-center justify-center text-[8px]">+${monthUsers.length - 4}</div>` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </section>
  `;

  // Back button
  container.querySelector('#bday-back-btn')?.addEventListener('click', () => router.navigateBack());

  // Send wishes
  container.querySelectorAll('.send-wish-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showWishModal(btn.dataset.uid, btn.dataset.name);
    });
  });

  // Load wishes for today's birthdays
  todayBirthdays.forEach(u => {
    loadWishes(container, u.id);
    // Spawn confetti
    const confettiBox = container.querySelector(`#bday-confetti-${u.id}`);
    if (confettiBox) spawnConfetti(confettiBox);
  });
}

function showWishModal(userId, userName) {
  const modal = router.openModal('', { title: `🎈 Wish ${userName}` });
  modal.body.innerHTML = `
    <div class="p-4 space-y-4">
      <textarea id="wish-text" rows="3" placeholder="Write your birthday wishes..."
        class="w-full px-4 py-3 border border-gray-200 rounded-2xl text-sm text-navy-800 placeholder:text-gray-400 focus:outline-none focus:border-navy-500 resize-none bg-white font-handwriting text-base"></textarea>
      <button id="submit-wish" class="btn-primary">Send Wishes 🎂</button>
    </div>
  `;

  modal.body.querySelector('#submit-wish')?.addEventListener('click', async () => {
    const text = modal.body.querySelector('#wish-text')?.value.trim();
    if (!text) { showToast('Write something!', 'warning'); return; }

    try {
      await addDoc(collection(db, 'birthdays'), {
        targetUserId: userId,
        authorId: authManager.currentUser.uid,
        authorName: authManager.userData?.fullName || 'Unknown',
        authorPhoto: authManager.userData?.profilePic || '',
        message: text,
        year: new Date().getFullYear(),
        createdAt: serverTimestamp()
      });
      showToast('Wishes sent! 🎈', 'success');
      modal.close();
    } catch (e) {
      console.error(e);
      showToast('Failed to send', 'error');
    }
  });
}

async function loadWishes(container, userId) {
  const wishesEl = container.querySelector(`#wishes-${userId}`);
  if (!wishesEl) return;

  try {
    const q = query(
      collection(db, 'birthdays'),
      where('targetUserId', '==', userId),
      where('year', '==', new Date().getFullYear()),
      orderBy('createdAt', 'desc')
    );
    onSnapshot(q, (snap) => {
      if (snap.empty) {
        wishesEl.innerHTML = '<p class="text-xs text-gray-400">Be the first to wish!</p>';
        return;
      }
      wishesEl.innerHTML = `<p class="text-xs text-gray-500 mb-2">${snap.size} wishes received!</p>` +
        [...snap.docs].slice(0, 3).map(d => {
          const w = d.data();
          return `<p class="text-xs text-gray-600"><span class="font-semibold">${sanitizeHTML(w.authorName)}</span>: ${sanitizeHTML(w.message)}</p>`;
        }).join('');
    });
  } catch (e) { }
}

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
