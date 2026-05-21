// Time Capsule page — Create, view, and unlock time capsules
import { db, collection, addDoc, getDocs, query, orderBy, onSnapshot, doc, updateDoc,
  serverTimestamp, limit } from '../firebase-config.js';
import { showToast, sanitizeHTML, formatDate } from '../utils.js';
import { authManager } from '../auth.js';
import { router } from '../router.js';

let unsubCapsules = null;

export async function renderTimeCapsule(container) {
  if (unsubCapsules) unsubCapsules();

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

  const card = document.createElement('div');
  card.className = 'card overflow-hidden animate-fadeIn';

  if (isUnlocked) {
    // Unlocked capsule — show content
    card.innerHTML = `
      <div class="p-4">
        <div class="flex items-center gap-2 mb-3">
          <span class="text-xl">🔓</span>
          <div>
            <p class="font-semibold text-sm text-navy-800">${sanitizeHTML(capsule.authorName || 'A classmate')}'s Time Capsule</p>
            <p class="text-[10px] text-gray-400">Created ${time} · Unlocked!</p>
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
      </div>
    `;

    // Auto-update + cinematic reveal if was locked but time has passed
    if (!capsule.isUnlocked && unlockDate && unlockDate <= new Date()) {
      updateDoc(doc(db, 'timeCapsules', capsule.id), { isUnlocked: true }).catch(() => {});
      // Show cinematic reveal
      setTimeout(() => showCapsuleReveal(capsule), 500);
    }
  } else {
    // Locked capsule — show countdown
    const now = new Date();
    const diff = unlockDate ? unlockDate - now : 0;
    const daysLeft = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
    const hoursLeft = Math.max(0, Math.ceil((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)));

    card.innerHTML = `
      <div class="capsule-locked p-6 text-center">
        <div class="capsule-lock-icon mb-3">
          <div class="text-4xl capsule-shake">🔒</div>
        </div>
        <p class="font-semibold text-navy-800">${sanitizeHTML(capsule.authorName || 'A classmate')}'s Capsule</p>
        <p class="text-xs text-gray-400 mt-1">Created ${time}</p>
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
        </div>
        <p class="text-xs text-gray-400 mt-3">
          Opens on ${unlockDate ? formatDate(unlockDate) : 'Unknown date'}
        </p>
      </div>
    `;
  }

  return card;
}

function showCreateCapsuleModal() {
  const modal = router.openModal('', { title: '🔒 Create Time Capsule' });
  modal.body.innerHTML = `
    <div class="p-4 space-y-4">
      <div>
        <label class="text-xs font-semibold text-navy-600 mb-1 block">Your Message</label>
        <textarea id="capsule-message" rows="4" placeholder="Write a message for the future..."
          class="w-full px-4 py-3 border border-gray-200 rounded-2xl text-sm text-navy-800 placeholder:text-gray-400 focus:outline-none focus:border-navy-500 resize-none bg-white font-handwriting text-base"></textarea>
      </div>

      <div>
        <label class="text-xs font-semibold text-navy-600 mb-1 block">Unlock Date</label>
        <input type="date" id="capsule-date" min="${new Date().toISOString().split('T')[0]}"
          class="w-full px-4 py-3 border border-gray-200 rounded-2xl text-sm text-navy-800 focus:outline-none focus:border-navy-500 bg-white"/>
        <p class="text-xs text-gray-400 mt-1">When should this capsule be opened?</p>
      </div>

      <button id="submit-capsule" class="btn-primary">LOCK CAPSULE 🔒</button>
    </div>
  `;

  modal.body.querySelector('#submit-capsule')?.addEventListener('click', async () => {
    const message = modal.body.querySelector('#capsule-message')?.value.trim();
    const date = modal.body.querySelector('#capsule-date')?.value;

    if (!message) { showToast('Write a message', 'warning'); return; }
    if (!date) { showToast('Set an unlock date', 'warning'); return; }

    try {
      await addDoc(collection(db, 'timeCapsules'), {
        authorId: authManager.currentUser.uid,
        authorName: authManager.userData?.fullName || 'Unknown',
        authorPhoto: authManager.userData?.profilePic || '',
        caption: message,
        imageUrl: '',
        unlockDate: new Date(date).toISOString(),
        isUnlocked: false,
        createdAt: serverTimestamp()
      });
      showToast('Time capsule locked! 🔒', 'success');
      modal.close();
    } catch (e) {
      console.error(e);
      showToast('Failed to create capsule', 'error');
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

  // Auto-dismiss after 12 seconds
  setTimeout(() => { if (document.body.contains(overlay)) dismiss(); }, 12000);
}
