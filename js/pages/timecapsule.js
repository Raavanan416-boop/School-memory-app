// Time Capsule page — Enhanced with date+time, visibility selection, delete support
import { db, collection, addDoc, getDocs, query, orderBy, onSnapshot, doc, updateDoc,
  serverTimestamp, limit, deleteDoc, where } from '../firebase-config.js';
import { showToast, sanitizeHTML, formatDate } from '../utils.js';
import { authManager, awardPoints } from '../auth.js';
import { router } from '../router.js';
import { showDeleteConfirmation } from '../delete-confirm.js';
import { createNotification } from '../notifications.js';
let unsubCapsules = null;
let countdownInterval = null;

export function destroyTimecapsule() {
  if (unsubCapsules) {
    unsubCapsules();
    unsubCapsules = null;
  }
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

export async function renderTimeCapsule(container, data) {
  router.registerDestroy('timecapsule', destroyTimecapsule);
  destroyTimecapsule();

  // Store target capsuleId from navigation data (notification/celebration modal click)
  const targetCapsuleId = data?.capsuleId || null;
  if (targetCapsuleId) {
    console.log('Opening Capsule:', targetCapsuleId);
  }

  container.innerHTML = `
    <section class="px-4 pt-4">
      <div class="flex items-center gap-3 mb-5">
        <button id="tc-back-btn" class="inner-back-btn">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
        </button>
        <div class="flex-1">
          <h2 class="text-xl font-bold text-navy-800">Time Capsules</h2>
          <p class="text-xs text-gray-400">Lock memories for the future 🔒</p>
        </div>
        <button id="create-capsule-btn" class="px-4 py-2 bg-navy-500 text-white rounded-full text-xs font-semibold hover:bg-navy-600 transition-colors">
          + New Capsule
        </button>
      </div>
      <div id="capsules-container" class="space-y-4"></div>
    </section>
  `;

  container.querySelector('#create-capsule-btn')?.addEventListener('click', () => showCreateCapsuleModal());
  container.querySelector('#tc-back-btn')?.addEventListener('click', () => router.navigateBack());

  loadCapsules(container, targetCapsuleId);
  startCountdownTimer(container);
}

function startCountdownTimer(container) {
  if (countdownInterval) clearInterval(countdownInterval);
  
  countdownInterval = setInterval(() => {
    const lockCards = container.querySelectorAll('.capsule-locked');
    const now = Date.now();
    
    lockCards.forEach(card => {
      const unlockMillis = parseInt(card.dataset.unlockMillis || '0');
      const diff = Math.max(0, unlockMillis - now);
      
      if (diff > -5000 && diff < 5000) {
        console.log("Unlock Time:", unlockMillis);
        console.log("Current Time:", now);
        console.log("Difference:", unlockMillis - now);
      }
      
      const daysLeft = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hoursLeft = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minsLeft = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const secsLeft = Math.floor((diff % (1000 * 60)) / 1000);
      
      const dEl = card.querySelector('.days-left');
      const hEl = card.querySelector('.hours-left');
      const mEl = card.querySelector('.mins-left');
      const sEl = card.querySelector('.secs-left');
      
      if (dEl) dEl.textContent = daysLeft;
      if (hEl) hEl.textContent = hoursLeft;
      if (mEl) mEl.textContent = minsLeft;
      if (sEl) sEl.textContent = secsLeft;
    });
  }, 1000);
}

function loadCapsules(container, targetCapsuleId) {
  const capsuleEl = container.querySelector('#capsules-container');
  try {
    const q = query(collection(db, 'timeCapsules'), orderBy('createdAt', 'desc'), limit(30));
    unsubCapsules = onSnapshot(q, (snap) => {
      if (snap.empty) {
        capsuleEl.innerHTML = `
          <div class="card p-8 text-center">
            <div class="text-4xl mb-3">🔒</div>
            <h3 class="font-semibold text-navy-700 mb-1">No time capsules yet</h3>
            <p class="text-sm text-gray-400">Create one to lock a memory for the future!</p>
          </div>`;
        return;
      }
      capsuleEl.innerHTML = '';
      snap.forEach(d => {
        const capsule = { id: d.id, ...d.data() };
        const cardEl = createCapsuleCard(capsule);
        // Add data-capsule-id for scroll targeting
        cardEl.setAttribute('data-capsule-id', capsule.id);
        capsuleEl.appendChild(cardEl);
      });

      // Scroll to target capsule if navigated from notification/celebration
      if (targetCapsuleId) {
        requestAnimationFrame(() => {
          const targetCard = capsuleEl.querySelector(`[data-capsule-id="${targetCapsuleId}"]`);
          if (targetCard) {
            console.log('Scrolling to Capsule:', targetCapsuleId);
            targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Highlight animation
            targetCard.style.transition = 'box-shadow 0.3s, transform 0.3s';
            targetCard.style.boxShadow = '0 0 0 3px rgba(250, 204, 21, 0.6), 0 8px 25px rgba(250, 204, 21, 0.3)';
            targetCard.style.transform = 'scale(1.02)';
            setTimeout(() => {
              targetCard.style.boxShadow = '';
              targetCard.style.transform = '';
            }, 3000);
          }
        });
        // Only scroll on first load, not on subsequent snapshot updates
        targetCapsuleId = null;
      }
    });
  } catch (e) {
    capsuleEl.innerHTML = '<p class="text-center text-gray-400 py-8 text-sm">Configure Firebase</p>';
  }
}

function createCapsuleCard(capsule) {
  let unlockMillis = 0;
  if (capsule.unlockDate) {
    if (capsule.unlockDate.toMillis) unlockMillis = capsule.unlockDate.toMillis();
    else unlockMillis = new Date(capsule.unlockDate).getTime();
  }
  const unlockDate = unlockMillis ? new Date(unlockMillis) : null;
  const isUnlocked = capsule.isUnlocked || (unlockMillis && unlockMillis <= Date.now());
  const time = capsule.createdAt?.toDate ? formatDate(capsule.createdAt.toDate()) : '';
  const isOwner = capsule.authorId === authManager.currentUser?.uid;
  const visibilityIcon = capsule.visibility === 'close' ? '👥' : '🌍';
  const visibilityLabel = capsule.visibility === 'close' ? 'Close Friends' : 'All Friends';

  const card = document.createElement('div');
  card.className = 'card overflow-hidden animate-fadeIn';

  if (isUnlocked) {
    // Unlocked capsule — show content (entire card clickable)
    card.style.cursor = 'pointer';
    card.style.position = 'relative';
    card.style.zIndex = '1';
    card.style.pointerEvents = 'auto';
    card.innerHTML = `
      <div class="p-4">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <span class="text-xl">🔓</span>
            <div>
              <p class="font-semibold text-sm text-navy-800">${sanitizeHTML(capsule.authorName || 'A classmate')}'s Time Capsule</p>
              <p class="text-[10px] text-gray-400">Created ${time} · Unlocked! · ${visibilityIcon} ${visibilityLabel}</p>
            </div>
          </div>
          <div class="flex items-center gap-1">
            ${isOwner ? `
              <button class="capsule-delete-btn p-1 text-gray-300 hover:text-red-400 transition-colors" data-id="${capsule.id}" title="Delete">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>
              </button>
            ` : ''}
          </div>
        </div>
        ${capsule.imageUrl ? `
          <div class="rounded-xl overflow-hidden border-2 border-warm-300 mb-3">
            <img src="${capsule.imageUrl}" class="w-full aspect-video object-cover" alt="Time capsule memory" loading="lazy"/>
          </div>
        ` : ''}
        ${capsule.caption ? `
          <div class="p-3 bg-warm-50 rounded-xl border border-warm-200">
            <p class="font-handwriting text-lg text-navy-700">"${sanitizeHTML(capsule.caption)}"</p>
          </div>
        ` : ''}
        
        <!-- Open Capsule fallback button -->
        <button class="open-capsule-fallback-btn mt-3 w-full py-2.5 px-4 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-white font-bold rounded-xl text-sm shadow-md transition-all active:scale-95" data-capsule-id="${capsule.id}">
          🔓 Open Capsule
        </button>

        <div class="capsule-messages-container mt-4 border-t border-gray-100 pt-4 hidden">
          <!-- Messages will be injected here by loadCapsuleMessages -->
        </div>
      </div>
    `;

    // Make entire unlocked card clickable — navigate to this capsule with highlight
    card.addEventListener('click', (e) => {
      // Don't navigate if clicking delete btn, comments, input, or fallback button
      if (e.target.closest('.capsule-delete-btn') || 
          e.target.closest('.capsule-messages-container') ||
          e.target.closest('.open-capsule-fallback-btn')) return;
      console.log('Opening Capsule:', capsule.id);
      // Scroll to this card with highlight effect
      card.style.boxShadow = '0 0 0 3px rgba(250, 204, 21, 0.6), 0 8px 25px rgba(250, 204, 21, 0.3)';
      card.style.transform = 'scale(1.02)';
      setTimeout(() => {
        card.style.boxShadow = '';
        card.style.transform = '';
      }, 2000);
    });

    // Fallback "Open Capsule" button click
    card.querySelector('.open-capsule-fallback-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log('Opening Capsule (fallback button):', capsule.id);
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.style.boxShadow = '0 0 0 3px rgba(250, 204, 21, 0.6), 0 8px 25px rgba(250, 204, 21, 0.3)';
      card.style.transform = 'scale(1.02)';
      setTimeout(() => {
        card.style.boxShadow = '';
        card.style.transform = '';
      }, 2000);
    });
  } else {
    // Locked capsule — show countdown
    const now = Date.now();
    const diff = Math.max(0, unlockMillis - now);
    const daysLeft = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hoursLeft = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minsLeft = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const secsLeft = Math.floor((diff % (1000 * 60)) / 1000);

    card.innerHTML = `
      <div class="capsule-locked p-6 text-center" data-unlock-millis="${unlockMillis}">
        <div class="flex justify-end mb-2">
          ${isOwner ? `
            <button class="capsule-delete-btn p-1 text-gray-300 hover:text-red-400 transition-colors" data-id="${capsule.id}" title="Delete">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          ` : ''}
        </div>
        <div class="capsule-lock-icon mb-3">
          <div class="text-4xl capsule-shake">🔒</div>
        </div>
        <p class="font-semibold text-navy-800">${sanitizeHTML(capsule.authorName || 'A classmate')}'s Capsule</p>
        <p class="text-xs text-gray-400 mt-1">Created ${time} · ${visibilityIcon} ${visibilityLabel}</p>
        <div class="mt-4 flex items-center justify-center gap-2">
          <div class="text-center w-12">
            <p class="text-2xl font-bold text-navy-500 days-left">${daysLeft}</p>
            <p class="text-[10px] text-gray-400">days</p>
          </div>
          <span class="text-gray-300">:</span>
          <div class="text-center w-12">
            <p class="text-2xl font-bold text-navy-500 hours-left">${hoursLeft}</p>
            <p class="text-[10px] text-gray-400">hours</p>
          </div>
          <span class="text-gray-300">:</span>
          <div class="text-center w-12">
            <p class="text-2xl font-bold text-navy-500 mins-left">${minsLeft}</p>
            <p class="text-[10px] text-gray-400">mins</p>
          </div>
          <span class="text-gray-300">:</span>
          <div class="text-center w-12">
            <p class="text-2xl font-bold text-navy-500 secs-left">${secsLeft}</p>
            <p class="text-[10px] text-gray-400">secs</p>
          </div>
        </div>
        <p class="text-xs text-gray-400 mt-3">
          Opens on ${unlockDate ? unlockDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Unknown date'}
          ${unlockDate ? ' at ' + unlockDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
        </p>
        
        <div class="capsule-messages-container mt-4 border-t border-gray-100 pt-4 hidden">
          <!-- Messages will be injected here by loadCapsuleMessages -->
        </div>
      </div>
    `;
  }

  // Delete handler — instant UI removal
  card.querySelector('.capsule-delete-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    showDeleteConfirmation('this time capsule', async () => {
      await awardPoints(capsule.authorId || capsule.createdBy, -5, 'Time Capsule Deleted');
      await deleteDoc(doc(db, 'timeCapsules', capsule.id));
    }, { element: card });
  });

  // Load and render messages dynamically
  loadCapsuleMessages(capsule, card, isUnlocked, isOwner);

  return card;
}

function showCreateCapsuleModal() {
  const modal = router.openModal('', { title: '🔒 Create Time Capsule' });
  const now = new Date();
  const minDate = now.toISOString().split('T')[0];

  modal.body.innerHTML = `
    <div class="p-4 space-y-4">
      <div>
        <label class="text-xs font-semibold text-navy-600 mb-1 block">Your Message</label>
        <textarea id="capsule-message" rows="4" placeholder="Write a message for the future..."
          class="w-full px-4 py-3 border border-gray-200 rounded-2xl text-sm text-navy-800 placeholder:text-gray-400 focus:outline-none focus:border-navy-500 resize-none bg-white font-handwriting text-base"></textarea>
      </div>

      <!-- Date & Time -->
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-xs font-semibold text-navy-600 mb-1 block">📅 Unlock Date</label>
          <input type="date" id="capsule-date" min="${minDate}"
            class="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-navy-800 focus:outline-none focus:border-navy-500 bg-white"/>
        </div>
        <div>
          <label class="text-xs font-semibold text-navy-600 mb-1 block">⏰ Unlock Time</label>
          <input type="time" id="capsule-time" value="09:00"
            class="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-navy-800 focus:outline-none focus:border-navy-500 bg-white"/>
        </div>
      </div>
      <p class="text-xs text-gray-400">When should this capsule be opened?</p>

      <!-- Visibility -->
      <div>
        <label class="text-xs font-semibold text-navy-600 mb-2 block">Who can see this?</label>
        <div class="flex gap-2">
          <button class="privacy-btn active" data-visibility="all">🌍 All Friends</button>
          <button class="privacy-btn" data-visibility="close">👥 Close Friends</button>
        </div>
      </div>

      <button id="submit-capsule" class="btn-primary">LOCK CAPSULE 🔒</button>
    </div>
  `;

  // Visibility selection
  let selectedVisibility = 'all';
  modal.body.querySelectorAll('.privacy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.body.querySelectorAll('.privacy-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedVisibility = btn.dataset.visibility;
    });
  });

  modal.body.querySelector('#submit-capsule')?.addEventListener('click', async () => {
    const message = modal.body.querySelector('#capsule-message')?.value.trim();
    const date = modal.body.querySelector('#capsule-date')?.value;
    const time = modal.body.querySelector('#capsule-time')?.value || '09:00';

    if (!message) { showToast('Write a message', 'warning'); return; }
    if (!date) { showToast('Set an unlock date', 'warning'); return; }

    const unlockDateTime = new Date(`${date}T${time}`);
    if (unlockDateTime <= new Date()) {
      showToast('Unlock date must be in the future', 'warning');
      return;
    }

    const btn = modal.body.querySelector('#submit-capsule');
    btn.disabled = true;
    btn.textContent = 'LOCKING...';

    try {
      await addDoc(collection(db, 'timeCapsules'), {
        authorId: authManager.currentUser.uid,
        authorName: authManager.userData?.fullName || 'Unknown',
        authorPhoto: authManager.userData?.profilePic || '',
        caption: message,
        imageUrl: '',
        unlockDate: unlockDateTime.toISOString(),
        isUnlocked: false,
        visibility: selectedVisibility,
        createdAt: serverTimestamp()
      });
      showToast('Time capsule locked! +5 Points 🔒', 'success');
      await awardPoints(authManager.currentUser.uid, 5, 'Time Capsule Created');
      modal.close();
    } catch (e) {
      console.error(e);
      showToast('Failed to create capsule', 'error');
      btn.disabled = false;
      btn.textContent = 'LOCK CAPSULE 🔒';
    }
  });
}

// Cinematic reveal animation
function showCapsuleReveal(capsule) {
  const overlay = document.createElement('div');
  overlay.className = 'capsule-reveal-overlay';
  overlay.innerHTML = `
    <div class="capsule-reveal-particles" id="capsule-particles"></div>
    <div class="capsule-reveal-content">
      <div class="text-5xl mb-4">🔓</div>
      <h2 class="text-xl font-display font-bold text-white mb-2">Time Capsule Unlocked</h2>
      <p class="text-sm text-white/60 mb-6 font-handwriting text-lg">A memory from the past has returned ❤️</p>
    </div>
    ${capsule.imageUrl ? `<img src="${capsule.imageUrl}" class="capsule-reveal-img" alt=""/>` : ''}
    <div class="capsule-reveal-text mt-4 max-w-xs">
      ${capsule.caption ? `<p class="font-handwriting text-xl text-white/90 italic">"${sanitizeHTML(capsule.caption)}"</p>` : ''}
      <p class="text-xs text-white/40 mt-2">by ${sanitizeHTML(capsule.authorName || 'A classmate')}</p>
    </div>
    <button class="birthday-dismiss-btn mt-6" id="capsule-reveal-close" style="opacity:0;animation:birthdayTextPop 0.8s cubic-bezier(0.34,1.56,0.64,1) 1s forwards;">Continue ✨</button>
  `;
  document.body.appendChild(overlay);

  // Spawn golden particles
  const particleBox = overlay.querySelector('#capsule-particles');
  for (let i = 0; i < 30; i++) {
    const p = document.createElement('div');
    p.className = 'capsule-particle';
    const colors = ['#ffd700', '#ffaa00', '#fff4cc', '#ffcc33'];
    p.style.cssText = `left:${Math.random()*100}%;background:${colors[Math.floor(Math.random()*colors.length)]};animation-duration:${3+Math.random()*4}s;animation-delay:${Math.random()*2}s;width:${2+Math.random()*4}px;height:${2+Math.random()*4}px;`;
    particleBox.appendChild(p);
  }

  const dismiss = () => {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.5s';
    setTimeout(() => overlay.remove(), 500);
  };

  overlay.querySelector('#capsule-reveal-close')?.addEventListener('click', dismiss);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
  setTimeout(() => { if (document.body.contains(overlay)) dismiss(); }, 12000);
}

function loadCapsuleMessages(capsule, card, isUnlocked, isOwner) {
  const container = card.querySelector('.capsule-messages-container');
  if (!container) return;

  container.classList.remove('hidden');

  if (!isUnlocked) {
    container.innerHTML = `
      <div class="text-center p-4">
        <div class="text-3xl mb-2">🔒</div>
        <p class="font-bold text-navy-800 text-sm">Time Capsule Locked</p>
        <p class="text-xs text-gray-400 mt-1">Comments will be available after the capsule opens.</p>
      </div>
    `;
    return;
  }

  if (isOwner) {
    container.innerHTML = `
      <div class="flex items-center justify-between p-2 bg-gray-50 rounded-xl">
        <span class="text-sm font-bold text-navy-800 flex items-center gap-2">💬 Comments</span>
        <button class="view-comments-btn px-4 py-2 bg-navy-500 text-white rounded-full text-xs font-semibold hover:bg-navy-600 transition-colors">View Comments</button>
      </div>
    `;
    container.querySelector('.view-comments-btn')?.addEventListener('click', () => {
      openCommentsModal(capsule.id);
    });
    return;
  }

  // Friend View Unlocked
  container.innerHTML = `
    <div class="message-input-section mb-2">
      <h4 class="text-sm font-bold text-navy-800 mb-2 flex items-center gap-2">💬 Leave a Comment</h4>
      <div class="flex gap-2">
        <input type="text" class="tc-msg-input flex-1 bg-gray-50 border border-gray-200 rounded-full px-4 py-2 text-sm focus:outline-none focus:border-navy-400" placeholder="Type a message..." maxlength="200">
        <button class="tc-msg-send-btn p-2 bg-navy-500 text-white rounded-full hover:bg-navy-600 transition-colors">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/></svg>
        </button>
      </div>
    </div>
    <div class="tc-messages-list space-y-2"></div>
  `;

  const msgList = container.querySelector('.tc-messages-list');
  const inputEl = container.querySelector('.tc-msg-input');
  const sendBtn = container.querySelector('.tc-msg-send-btn');
  const inputSection = container.querySelector('.message-input-section');

  let editingMsgId = null;

  if (sendBtn && inputEl) {
    sendBtn.addEventListener('click', async () => {
      const text = inputEl.value.trim();
      if (!text) return;
      
      inputEl.disabled = true;
      sendBtn.disabled = true;

      try {
        if (editingMsgId) {
          await updateDoc(doc(db, 'timeCapsules', capsule.id, 'messages', editingMsgId), {
            text
          });
          editingMsgId = null;
          showToast('✅ Your comment has been updated.', 'success');
        } else {
          await addDoc(collection(db, 'timeCapsules', capsule.id, 'messages'), {
            text,
            authorId: authManager.currentUser.uid,
            authorName: authManager.userData?.fullName || 'Friend',
            authorPhoto: authManager.userData?.profilePic || '',
            createdAt: serverTimestamp()
          });
          showToast('✅ Your comment has been submitted.', 'success');
          
          // Leaderboard update instantly + Notification
          await awardPoints(authManager.currentUser.uid, 3, 'Time Capsule Comment');
          
          await createNotification('capsule_message', capsule.authorId || capsule.createdBy, {
            capsuleId: capsule.id,
            message: `💬 New Capsule Comment: ${authManager.userData?.fullName || 'A friend'} commented on your Time Capsule.`
          });
        }
        inputEl.value = '';
      } catch (err) {
        showToast('Failed to send comment.', 'error');
        console.error(err);
      } finally {
        inputEl.disabled = false;
        sendBtn.disabled = false;
      }
    });
  }

  const q = query(
    collection(db, 'timeCapsules', capsule.id, 'messages'), 
    where('authorId', '==', authManager.currentUser.uid),
    orderBy('createdAt', 'asc')
  );

  onSnapshot(q, (snap) => {
    if (!msgList) return;
    msgList.innerHTML = '';
    
    if (!snap.empty) {
      inputSection.classList.add('hidden'); // Hide input if they already commented
    } else {
      inputSection.classList.remove('hidden');
    }

    snap.forEach(d => {
      const msg = { id: d.id, ...d.data() };
      const timeStr = msg.createdAt?.toDate ? formatDate(msg.createdAt.toDate()) : 'Just now';
      
      const div = document.createElement('div');
      div.className = 'bg-gray-50 rounded-xl p-3 relative group';
      div.innerHTML = `
        <p class="text-sm text-gray-700">${sanitizeHTML(msg.text)}</p>
        <p class="text-[10px] text-gray-400 mt-1">${timeStr}</p>
        <div class="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button class="msg-edit-btn p-1 text-gray-400 hover:text-navy-500" title="Edit">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
          </button>
          <button class="msg-delete-btn p-1 text-gray-400 hover:text-red-500" title="Delete">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      `;
      
      div.querySelector('.msg-edit-btn')?.addEventListener('click', () => {
        inputSection.classList.remove('hidden');
        inputEl.value = msg.text;
        inputEl.focus();
        editingMsgId = msg.id;
      });

      div.querySelector('.msg-delete-btn')?.addEventListener('click', async () => {
        if (confirm('Delete your comment?')) {
          await awardPoints(authManager.currentUser.uid, -3, 'Time Capsule Comment Deleted');
          await deleteDoc(doc(db, 'timeCapsules', capsule.id, 'messages', msg.id));
          editingMsgId = null;
          inputEl.value = '';
        }
      });
      
      msgList.appendChild(div);
    });
  }, (error) => {});
}

let unsubModalComments = null;

function openCommentsModal(capsuleId) {
  const modalHtml = `
    <div id="tc-comments-modal" class="fixed inset-0 z-[9999] flex flex-col bg-white animate-slideUp">
      <div class="flex items-center justify-between p-4 border-b border-gray-100">
        <h2 class="text-lg font-bold text-navy-800 flex items-center gap-2">💬 Comments</h2>
        <button id="close-comments-modal" class="p-2 text-gray-400 hover:bg-gray-50 rounded-full transition-colors">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div id="tc-comments-list" class="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        <div class="flex justify-center p-8"><div class="w-6 h-6 border-2 border-navy-500 border-t-transparent rounded-full animate-spin"></div></div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  
  const modalEl = document.getElementById('tc-comments-modal');
  const listEl = document.getElementById('tc-comments-list');
  
  modalEl.querySelector('#close-comments-modal').addEventListener('click', () => {
    if (unsubModalComments) {
      unsubModalComments();
      unsubModalComments = null;
    }
    modalEl.classList.add('translate-y-full');
    setTimeout(() => modalEl.remove(), 300);
  });

  const q = query(collection(db, 'timeCapsules', capsuleId, 'messages'), orderBy('createdAt', 'asc'));
  unsubModalComments = onSnapshot(q, (snap) => {
    if (snap.empty) {
      listEl.innerHTML = `
        <div class="text-center p-8">
          <div class="text-4xl mb-3 opacity-50">💭</div>
          <h3 class="font-semibold text-gray-500">No comments yet</h3>
        </div>
      `;
      return;
    }
    listEl.innerHTML = '';
    snap.forEach(d => {
      const msg = { id: d.id, ...d.data() };
      const timeStr = msg.createdAt?.toDate ? formatDate(msg.createdAt.toDate()) : 'Just now';
      
      const div = document.createElement('div');
      div.className = 'bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex gap-3 relative group';
      div.innerHTML = `
        <img src="${msg.authorPhoto || 'default-avatar.png'}" class="w-10 h-10 rounded-full object-cover shrink-0 bg-gray-200" onerror="this.src='default-avatar.png'">
        <div class="flex-1">
          <div class="flex items-baseline justify-between mb-1">
            <p class="text-sm font-bold text-navy-800">${sanitizeHTML(msg.authorName || 'Friend')}</p>
            <p class="text-[10px] text-gray-400">${timeStr}</p>
          </div>
          <p class="text-sm text-gray-700">${sanitizeHTML(msg.text)}</p>
        </div>
        <button class="msg-delete-btn absolute top-2 right-2 p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" title="Delete">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        </button>
      `;
      
      div.querySelector('.msg-delete-btn')?.addEventListener('click', async () => {
        if (confirm('Delete this comment?')) {
          await deleteDoc(doc(db, 'timeCapsules', capsuleId, 'messages', msg.id));
        }
      });
      listEl.appendChild(div);
    });
  });
}
