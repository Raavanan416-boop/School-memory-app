// Shared Diary page — Enhanced with privacy modes, reactions, photos, thread replies
import { db, collection, addDoc, query, orderBy, onSnapshot, doc, updateDoc,
  serverTimestamp, limit, arrayUnion, arrayRemove, getDocs, where, storage,
  storageRef, uploadBytes, getDownloadURL } from '../firebase-config.js';
import { showToast, sanitizeHTML, formatDate, MOOD_EMOJIS, timeAgo } from '../utils.js';
import { authManager } from '../auth.js';
import { router } from '../router.js';

let unsubDiary = null;

export function destroyDiary() {
  if (unsubDiary) unsubDiary();
  unsubDiary = null;
}

export async function renderDiary(container) {
  destroyDiary();

  container.innerHTML = `
    <section class="diary-page">
      <!-- Back + Header -->
      <div class="diary-header">
        <button id="diary-back-btn" class="inner-back-btn">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
        </button>
        <div class="flex-1 text-center">
          <h2 class="text-lg font-bold text-navy-800">Class Diary</h2>
          <p class="text-xs text-gray-400">Our shared memories, written together</p>
        </div>
        <button id="add-diary-btn" class="inner-action-btn">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
        </button>
      </div>

      <!-- Privacy Filter Tabs -->
      <div class="diary-filter-bar">
        <button class="diary-filter active" data-filter="all">🌍 All</button>
        <button class="diary-filter" data-filter="close">👥 Close Friends</button>
        <button class="diary-filter" data-filter="private">🔒 My Private</button>
      </div>

      <div id="diary-container" class="diary-entries-list"></div>
    </section>
  `;

  container.querySelector('#diary-back-btn')?.addEventListener('click', () => router.navigateBack());
  container.querySelector('#add-diary-btn')?.addEventListener('click', () => showDiaryEntryModal());

  let activeFilter = 'all';
  container.querySelectorAll('.diary-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.diary-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      loadDiary(container, activeFilter);
    });
  });

  loadDiary(container, activeFilter);
}

function loadDiary(container, filter = 'all') {
  const diaryEl = container.querySelector('#diary-container');
  if (unsubDiary) unsubDiary();

  try {
    const q = query(collection(db, 'diary'), orderBy('createdAt', 'desc'), limit(30));
    unsubDiary = onSnapshot(q, (snap) => {
      if (snap.empty) {
        diaryEl.innerHTML = `
          <div class="diary-empty">
            <div class="diary-empty-icon">📖</div>
            <h3 class="font-handwriting text-2xl text-navy-700 mb-1">The diary awaits...</h3>
            <p class="text-sm text-gray-400">Be the first to pen your thoughts</p>
          </div>`;
        return;
      }

      diaryEl.innerHTML = '';
      const uid = authManager.currentUser?.uid;
      let hasEntries = false;

      snap.forEach(d => {
        const entry = { id: d.id, ...d.data() };

        // Apply privacy filter
        if (filter === 'private') {
          if (entry.authorId !== uid) return;
          if (entry.privacy !== 'private') return;
        } else if (filter === 'close') {
          if (entry.privacy === 'private' && entry.authorId !== uid) return;
          if (entry.privacy !== 'close' && entry.privacy !== 'all' && entry.authorId !== uid) return;
        } else {
          // "all" filter — show public + close friends + own private
          if (entry.privacy === 'private' && entry.authorId !== uid) return;
          if (entry.privacy === 'close') {
            const closeFriends = entry.closeFriendsList || [];
            if (entry.authorId !== uid && !closeFriends.includes(uid)) return;
          }
        }

        hasEntries = true;
        diaryEl.appendChild(createDiaryEntry(entry));
      });

      if (!hasEntries) {
        diaryEl.innerHTML = `
          <div class="diary-empty">
            <div class="diary-empty-icon">${filter === 'private' ? '🔒' : '👥'}</div>
            <h3 class="font-handwriting text-xl text-navy-700 mb-1">Nothing here yet</h3>
            <p class="text-sm text-gray-400">${filter === 'private' ? 'Your private entries will appear here' : 'No entries in this category'}</p>
          </div>`;
      }
    });
  } catch (e) {
    diaryEl.innerHTML = '<p class="text-center text-gray-400 py-8 text-sm">Configure Firebase</p>';
  }
}

function createDiaryEntry(entry) {
  const date = entry.createdAt?.toDate ? formatDate(entry.createdAt.toDate()) : '';
  const time = entry.createdAt?.toDate ? timeAgo(entry.createdAt.toDate()) : '';
  const uid = authManager.currentUser?.uid;
  const myReaction = entry.reactions?.find(r => r.userId === uid);
  const reactionCounts = {};
  (entry.reactions || []).forEach(r => {
    reactionCounts[r.emoji] = (reactionCounts[r.emoji] || 0) + 1;
  });
  const replyCount = entry.replyCount || 0;

  const privacyIcons = { all: '🌍', close: '👥', private: '🔒' };
  const privacyLabel = { all: 'All Friends', close: 'Close Friends', private: 'Private' };

  const card = document.createElement('div');
  card.className = 'diary-entry-card animate-fadeIn';
  card.innerHTML = `
    <div class="diary-entry-paper">
      <!-- Header -->
      <div class="flex items-start justify-between mb-3">
        <div class="flex items-center gap-2.5">
          ${entry.authorPhoto
            ? `<img src="${entry.authorPhoto}" class="w-9 h-9 rounded-full object-cover border border-cream-300" alt=""/>`
            : `<div class="w-9 h-9 rounded-full bg-navy-500 text-white flex items-center justify-center text-xs font-bold">${(entry.authorName || '?')[0]}</div>`}
          <div>
            <p class="text-sm font-semibold text-navy-800">${sanitizeHTML(entry.authorName || 'Anonymous')}</p>
            <p class="text-[10px] text-gray-400">${time} · ${privacyIcons[entry.privacy] || '🌍'} ${privacyLabel[entry.privacy] || 'All'}</p>
          </div>
        </div>
        <span class="text-2xl">${entry.mood || '📝'}</span>
      </div>

      <!-- Title -->
      ${entry.title ? `<h4 class="font-semibold text-navy-700 mb-2 text-base">${sanitizeHTML(entry.title)}</h4>` : ''}

      <!-- Content -->
      <div class="diary-entry-text">
        <p class="font-handwriting text-xl text-gray-600 leading-relaxed">${sanitizeHTML(entry.content)}</p>
      </div>

      <!-- Photo -->
      ${entry.imageUrl ? `
        <div class="mt-3 rounded-xl overflow-hidden border border-cream-300">
          <img src="${entry.imageUrl}" class="w-full max-h-60 object-cover" alt="" loading="lazy"/>
        </div>
      ` : ''}

      <!-- Date stamp -->
      <p class="text-[10px] text-gray-400 mt-3 font-handwriting text-sm">${date}</p>

      <!-- Reactions Bar -->
      <div class="diary-reactions-bar">
        <div class="flex items-center gap-1 flex-wrap flex-1">
          ${Object.entries(reactionCounts).map(([emoji, count]) => `
            <span class="diary-reaction-chip ${myReaction?.emoji === emoji ? 'diary-reaction-mine' : ''}">${emoji} ${count}</span>
          `).join('')}
          <button class="diary-react-btn" data-entry-id="${entry.id}">
            ${myReaction ? '😊' : '+'} React
          </button>
        </div>
        <button class="diary-reply-btn" data-entry-id="${entry.id}">
          💬 ${replyCount > 0 ? replyCount : ''} ${replyCount > 0 ? 'replies' : 'Reply'}
        </button>
      </div>

      <!-- Replies (hidden by default) -->
      <div class="diary-replies hidden" id="replies-${entry.id}">
        <div class="diary-replies-list" id="replies-list-${entry.id}"></div>
        <div class="diary-reply-input-row">
          <input type="text" placeholder="Continue the thread..." class="diary-reply-input" id="reply-input-${entry.id}"/>
          <button class="diary-reply-send" data-entry-id="${entry.id}">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/></svg>
          </button>
        </div>
      </div>
    </div>
  `;

  // React button
  card.querySelector('.diary-react-btn')?.addEventListener('click', () => {
    showReactionPicker(entry.id);
  });

  // Reply toggle
  card.querySelector('.diary-reply-btn')?.addEventListener('click', () => {
    const repliesSection = card.querySelector(`#replies-${entry.id}`);
    repliesSection?.classList.toggle('hidden');
    if (!repliesSection?.classList.contains('hidden')) {
      loadReplies(entry.id);
    }
  });

  // Reply send
  card.querySelector('.diary-reply-send')?.addEventListener('click', () => {
    submitReply(entry.id);
  });

  const replyInput = card.querySelector(`#reply-input-${entry.id}`);
  replyInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitReply(entry.id);
  });

  return card;
}

function showReactionPicker(entryId) {
  const reactions = ['❤️', '😂', '😢', '😍', '🔥', '👏', '💭', '🥺', '✨', '🫂'];
  const modal = router.openModal('', { title: 'React' });
  modal.body.innerHTML = `
    <div class="p-4">
      <div class="grid grid-cols-5 gap-3">
        ${reactions.map(emoji => `
          <button class="reaction-pick-btn" data-emoji="${emoji}">${emoji}</button>
        `).join('')}
      </div>
    </div>
  `;

  modal.body.querySelectorAll('.reaction-pick-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const emoji = btn.dataset.emoji;
      if (!authManager.currentUser) return;

      try {
        const entryRef = doc(db, 'diary', entryId);
        // Remove old reaction first
        const entrySnap = await import('../firebase-config.js').then(m => m.getDoc(entryRef));
        if (entrySnap.exists()) {
          const data = entrySnap.data();
          const oldReactions = (data.reactions || []).filter(r => r.userId !== authManager.currentUser.uid);
          oldReactions.push({
            userId: authManager.currentUser.uid,
            userName: authManager.userData?.fullName || 'Unknown',
            emoji
          });
          await updateDoc(entryRef, { reactions: oldReactions });
        }
        modal.close();
        showToast(`Reacted ${emoji}`, 'success');
      } catch (e) {
        console.error(e);
        showToast('Could not react', 'error');
      }
    });
  });
}

async function loadReplies(entryId) {
  const list = document.querySelector(`#replies-list-${entryId}`);
  if (!list) return;

  try {
    const q = query(collection(db, 'diary', entryId, 'replies'), orderBy('createdAt', 'asc'), limit(20));
    onSnapshot(q, (snap) => {
      list.innerHTML = '';
      if (snap.empty) {
        list.innerHTML = '<p class="text-xs text-gray-400 text-center py-2 font-handwriting">No replies yet. Continue the thread!</p>';
        return;
      }
      snap.forEach(d => {
        const r = d.data();
        const time = r.createdAt?.toDate ? timeAgo(r.createdAt.toDate()) : '';
        const div = document.createElement('div');
        div.className = 'diary-reply-item animate-fadeIn';
        div.innerHTML = `
          ${r.authorPhoto
            ? `<img src="${r.authorPhoto}" class="w-6 h-6 rounded-full object-cover flex-shrink-0" alt=""/>`
            : `<div class="w-6 h-6 rounded-full bg-navy-500 text-white flex items-center justify-center text-[9px] font-bold flex-shrink-0">${(r.authorName || '?')[0]}</div>`}
          <div class="flex-1 min-w-0">
            <p class="text-xs"><span class="font-semibold text-navy-800">${sanitizeHTML(r.authorName || 'Unknown')}</span> <span class="text-gray-600 font-handwriting text-sm">${sanitizeHTML(r.text)}</span></p>
            ${r.imageUrl ? `<img src="${r.imageUrl}" class="mt-1 max-h-32 rounded-lg" alt="" loading="lazy"/>` : ''}
            <p class="text-[9px] text-gray-400 mt-0.5">${time}</p>
          </div>
        `;
        list.appendChild(div);
      });
    });
  } catch (e) { console.error(e); }
}

async function submitReply(entryId) {
  const input = document.querySelector(`#reply-input-${entryId}`);
  if (!input || !authManager.currentUser) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  try {
    await addDoc(collection(db, 'diary', entryId, 'replies'), {
      text,
      authorId: authManager.currentUser.uid,
      authorName: authManager.userData?.fullName || 'Unknown',
      authorPhoto: authManager.userData?.profilePic || '',
      createdAt: serverTimestamp()
    });
    // Increment reply count
    const { increment } = await import('../firebase-config.js');
    await updateDoc(doc(db, 'diary', entryId), { replyCount: increment(1) });
  } catch (e) {
    console.error(e);
    showToast('Could not send reply', 'error');
  }
}

function showDiaryEntryModal() {
  const modal = router.openModal('', { title: '📖 Write in the Diary' });
  let selectedImage = null;

  modal.body.innerHTML = `
    <div class="p-4 space-y-4">
      <!-- Mood picker -->
      <div>
        <label class="text-xs font-semibold text-navy-600 mb-2 block">How are you feeling?</label>
        <div class="flex flex-wrap gap-2" id="mood-picker">
          ${MOOD_EMOJIS.map(e => `
            <button type="button" class="mood-btn w-10 h-10 rounded-full border-2 border-gray-200 flex items-center justify-center text-xl hover:border-navy-500 transition-colors active:scale-90" data-mood="${e}">
              ${e}
            </button>
          `).join('')}
        </div>
      </div>

      <!-- Privacy -->
      <div>
        <label class="text-xs font-semibold text-navy-600 mb-2 block">Who can see this?</label>
        <div class="flex gap-2">
          <button class="privacy-btn active" data-privacy="all">🌍 All Friends</button>
          <button class="privacy-btn" data-privacy="close">👥 Close Friends</button>
          <button class="privacy-btn" data-privacy="private">🔒 Private</button>
        </div>
      </div>

      <!-- Close friends selector (hidden by default) -->
      <div id="close-friends-selector" class="hidden">
        <label class="text-xs font-semibold text-navy-600 mb-2 block">Select close friends</label>
        <div id="close-friends-list" class="max-h-32 overflow-y-auto bg-cream-50 rounded-xl p-2 space-y-1"></div>
      </div>

      <!-- Title -->
      <div>
        <input type="text" id="diary-title" placeholder="Give this entry a title (optional)..."
          class="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-navy-800 placeholder:text-gray-400 focus:outline-none focus:border-navy-500 bg-white"/>
      </div>

      <!-- Content -->
      <div>
        <textarea id="diary-content" rows="6" placeholder="Dear diary, today..."
          class="w-full px-4 py-3 border border-gray-200 rounded-2xl text-sm text-navy-800 placeholder:text-gray-400 focus:outline-none focus:border-navy-500 resize-none bg-white font-handwriting text-lg"></textarea>
      </div>

      <!-- Photo attachment -->
      <div class="flex items-center gap-3">
        <button type="button" id="diary-photo-btn" class="flex items-center gap-2 text-sm text-gray-500 hover:text-navy-500 transition-colors px-3 py-2 rounded-xl bg-cream-50">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"/></svg>
          Add Photo
        </button>
        <input type="file" id="diary-file-input" accept="image/*" class="hidden"/>
        <div id="diary-photo-preview" class="hidden">
          <div class="relative">
            <img id="diary-preview-img" class="w-16 h-16 rounded-lg object-cover" alt=""/>
            <button id="remove-diary-photo" class="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs">✕</button>
          </div>
        </div>
      </div>

      <button id="submit-diary" class="btn-primary">WRITE IN DIARY ✍️</button>
    </div>
  `;

  // Mood selection
  let selectedMood = '📝';
  modal.body.querySelectorAll('.mood-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.body.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('border-navy-500', 'bg-navy-50'));
      btn.classList.add('border-navy-500', 'bg-navy-50');
      selectedMood = btn.dataset.mood;
    });
  });

  // Privacy selection
  let selectedPrivacy = 'all';
  let selectedCloseFriends = [];

  modal.body.querySelectorAll('.privacy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.body.querySelectorAll('.privacy-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedPrivacy = btn.dataset.privacy;

      const closeSel = modal.body.querySelector('#close-friends-selector');
      if (selectedPrivacy === 'close') {
        closeSel?.classList.remove('hidden');
        loadCloseFriendsSelector(modal.body);
      } else {
        closeSel?.classList.add('hidden');
      }
    });
  });

  // Photo
  modal.body.querySelector('#diary-photo-btn')?.addEventListener('click', () => {
    modal.body.querySelector('#diary-file-input')?.click();
  });

  modal.body.querySelector('#diary-file-input')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    selectedImage = file;
    const url = URL.createObjectURL(file);
    const preview = modal.body.querySelector('#diary-photo-preview');
    const img = modal.body.querySelector('#diary-preview-img');
    preview?.classList.remove('hidden');
    if (img) img.src = url;
  });

  modal.body.querySelector('#remove-diary-photo')?.addEventListener('click', () => {
    selectedImage = null;
    modal.body.querySelector('#diary-photo-preview')?.classList.add('hidden');
    modal.body.querySelector('#diary-file-input').value = '';
  });

  // Submit
  modal.body.querySelector('#submit-diary')?.addEventListener('click', async () => {
    const content = modal.body.querySelector('#diary-content')?.value.trim();
    const title = modal.body.querySelector('#diary-title')?.value.trim();

    if (!content) { showToast('Write something!', 'warning'); return; }

    const submitBtn = modal.body.querySelector('#submit-diary');
    submitBtn.disabled = true;
    submitBtn.textContent = 'SAVING...';

    try {
      let imageUrl = '';
      if (selectedImage) {
        const path = `diary/${authManager.currentUser.uid}/${Date.now()}_${selectedImage.name}`;
        const sRef = storageRef(storage, path);
        await uploadBytes(sRef, selectedImage);
        imageUrl = await getDownloadURL(sRef);
      }

      await addDoc(collection(db, 'diary'), {
        authorId: authManager.currentUser.uid,
        authorName: authManager.userData?.fullName || 'Unknown',
        authorPhoto: authManager.userData?.profilePic || '',
        title,
        content,
        mood: selectedMood,
        privacy: selectedPrivacy,
        closeFriendsList: selectedPrivacy === 'close' ? selectedCloseFriends : [],
        imageUrl,
        reactions: [],
        replyCount: 0,
        createdAt: serverTimestamp()
      });
      showToast('Diary entry added! 📖', 'success');
      modal.close();
    } catch (e) {
      console.error(e);
      showToast('Failed to write entry', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'WRITE IN DIARY ✍️';
    }
  });
}

async function loadCloseFriendsSelector(body) {
  const listEl = body.querySelector('#close-friends-list');
  if (!listEl) return;

  try {
    const snap = await getDocs(collection(db, 'users'));
    listEl.innerHTML = '';
    snap.forEach(d => {
      if (d.id === authManager.currentUser?.uid) return;
      const u = d.data();
      const label = document.createElement('label');
      label.className = 'flex items-center gap-2 p-1.5 rounded-lg hover:bg-cream-100 cursor-pointer';
      label.innerHTML = `
        <input type="checkbox" class="close-friend-cb rounded" value="${d.id}"/>
        <span class="text-sm text-navy-800">${sanitizeHTML(u.fullName || 'Unknown')}</span>
      `;
      listEl.appendChild(label);
    });
  } catch (e) { }
}
