// Time Capsule page — Enhanced with date+time, visibility selection, delete support
import { db, collection, addDoc, getDocs, query, orderBy, onSnapshot, doc, updateDoc,
  serverTimestamp, limit, deleteDoc } from '../firebase-config.js';
import { showToast, sanitizeHTML, formatDate } from '../utils.js';
import { authManager, awardPoints } from '../auth.js';
import { router } from '../router.js';
import { showDeleteConfirmation } from '../delete-confirm.js';

let unsubCapsules = null;

export function destroyTimecapsule() {
  if (unsubCapsules) {
    unsubCapsules();
    unsubCapsules = null;
  }
}

export async function renderTimeCapsule(container) {
  router.registerDestroy('timecapsule', destroyTimecapsule);
  destroyTimecapsule();

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

  loadCapsules(container);
}

function loadCapsules(container) {
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
        capsuleEl.appendChild(createCapsuleCard(capsule));
      });
    });
  } catch (e) {
    capsuleEl.innerHTML = '<p class="text-center text-gray-400 py-8 text-sm">Configure Firebase</p>';
  }
}

function createCapsuleCard(capsule) {
  const unlockDate = capsule.unlockDate ? new Date(capsule.unlockDate) : null;
  const isUnlocked = capsule.isUnlocked || (unlockDate && unlockDate <= new Date());
  const time = capsule.createdAt?.toDate ? formatDate(capsule.createdAt.toDate()) : '';
  const isOwner = capsule.authorId === authManager.currentUser?.uid;
  const visibilityIcon = capsule.visibility === 'close' ? '👥' : '🌍';
  const visibilityLabel = capsule.visibility === 'close' ? 'Close Friends' : 'All Friends';

  const card = document.createElement('div');
  card.className = 'card overflow-hidden animate-fadeIn';

  if (isUnlocked) {
    // Unlocked capsule — show content
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
          ${isOwner ? `
            <button class="capsule-delete-btn p-1 text-gray-300 hover:text-red-400 transition-colors" data-id="${capsule.id}" title="Delete">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>
            </button>
          ` : ''}
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
      </div>
    `;

    // Auto-update if was locked but time has passed
    if (!capsule.isUnlocked && unlockDate && unlockDate <= new Date()) {
      updateDoc(doc(db, 'timeCapsules', capsule.id), { isUnlocked: true }).catch(() => {});
      setTimeout(() => showCapsuleReveal(capsule), 500);
    }
  } else {
    // Locked capsule — show countdown
    const now = new Date();
    const diff = unlockDate ? unlockDate - now : 0;
    const daysLeft = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
    const hoursLeft = Math.max(0, Math.ceil((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)));
    const minsLeft = Math.max(0, Math.ceil((diff % (1000 * 60 * 60)) / (1000 * 60)));

    card.innerHTML = `
      <div class="capsule-locked p-6 text-center">
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
        <div class="mt-4 flex items-center justify-center gap-3">
          <div class="text-center">
            <p class="text-2xl font-bold text-navy-500">${daysLeft}</p>
            <p class="text-[10px] text-gray-400">days</p>
          </div>
          <span class="text-gray-300">:</span>
          <div class="text-center">
            <p class="text-2xl font-bold text-navy-500">${hoursLeft}</p>
            <p class="text-[10px] text-gray-400">hours</p>
          </div>
          <span class="text-gray-300">:</span>
          <div class="text-center">
            <p class="text-2xl font-bold text-navy-500">${minsLeft}</p>
            <p class="text-[10px] text-gray-400">mins</p>
          </div>
        </div>
        <p class="text-xs text-gray-400 mt-3">
          Opens on ${unlockDate ? unlockDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Unknown date'}
          ${unlockDate ? ' at ' + unlockDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
        </p>
      </div>
    `;
  }

  // Delete handler — instant UI removal
  card.querySelector('.capsule-delete-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    showDeleteConfirmation('this time capsule', async () => {
      await awardPoints(capsule.authorId || capsule.createdBy, -1, 'Time Capsule Deleted');
      await deleteDoc(doc(db, 'timeCapsules', capsule.id));
    }, { element: card });
  });

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
      showToast('Time capsule locked! +1 Point 🔒', 'success');
      awardPoints(authManager.currentUser.uid, 1, 'Time Capsule Created');
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
