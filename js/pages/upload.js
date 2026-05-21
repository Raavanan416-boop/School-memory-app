// Upload page — Premium Instagram-style with drag & drop, carousel preview, time capsule
import { db, storage, collection, addDoc, serverTimestamp, storageRef, uploadBytesResumable, getDownloadURL, getDocs } from '../firebase-config.js';
import { showToast, MEMORY_CATEGORIES, compressImage, sanitizeHTML } from '../utils.js';
import { authManager } from '../auth.js';
import { createNotification } from '../notifications.js';
import { router } from '../router.js';

export async function renderUpload(container) {
  // Load users for tagging
  let allUsers = [];
  try {
    const snap = await getDocs(collection(db, 'users'));
    snap.forEach(d => {
      if (d.id !== authManager.currentUser?.uid) {
        allUsers.push({ id: d.id, ...d.data() });
      }
    });
  } catch (e) { }

  container.innerHTML = `
    <section class="px-4 pt-4 pb-8">
      <!-- Header -->
      <div class="flex items-center gap-3 mb-5">
        <button id="upload-back-btn" class="inner-back-btn">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
        </button>
        <h2 class="text-xl font-bold text-navy-800 flex-1">New Memory</h2>
        <div class="text-2xl">📸</div>
      </div>

      <form id="upload-form" class="space-y-5">
        <!-- Premium Drop Zone -->
        <div class="upload-drop-zone" id="drop-zone">
          <input type="file" id="file-input" accept="image/*,video/*" multiple class="absolute inset-0 opacity-0 cursor-pointer z-10"/>
          <div id="upload-placeholder" class="flex flex-col items-center justify-center text-center">
            <div class="w-16 h-16 rounded-full bg-gradient-to-br from-navy-100 to-cream-200 flex items-center justify-center mb-4 shadow-md">
              <svg class="w-8 h-8 text-navy-500" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
              </svg>
            </div>
            <p class="text-sm font-semibold text-navy-700 mb-1">Drop your memories here</p>
            <p class="text-xs text-gray-400">or tap to browse photos & videos</p>
            <p class="text-[10px] text-gray-300 mt-2">Auto-compressed for fast uploads</p>
          </div>
        </div>

        <!-- Preview Carousel -->
        <div id="preview-section" class="hidden">
          <div class="flex items-center justify-between mb-2">
            <p class="text-xs font-semibold text-navy-600"><span id="file-count">0</span> selected</p>
            <button type="button" id="add-more-btn" class="text-xs text-navy-500 font-semibold flex items-center gap-1">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
              Add More
            </button>
          </div>
          <div class="upload-preview-carousel" id="preview-carousel"></div>
        </div>

        <!-- Upload Progress -->
        <div id="upload-progress" class="hidden">
          <div class="card p-4">
            <div class="flex items-center justify-between text-xs mb-2">
              <span class="text-navy-600 font-semibold">Uploading your memory...</span>
              <span id="progress-percent" class="text-navy-500 font-bold">0%</span>
            </div>
            <div class="w-full h-2.5 bg-cream-200 rounded-full overflow-hidden">
              <div id="progress-bar" class="h-full bg-gradient-to-r from-navy-400 to-navy-600 rounded-full transition-all duration-300" style="width:0%"></div>
            </div>
          </div>
        </div>

        <!-- Caption -->
        <div>
          <label class="text-xs font-semibold text-navy-600 mb-2 block">Caption</label>
          <textarea id="caption-input" rows="3" maxlength="500"
            placeholder="What makes this moment special?&#10;Tell the story behind this memory..."
            class="w-full px-4 py-3 border border-gray-200 rounded-2xl text-sm text-navy-800 placeholder:text-gray-400 focus:outline-none focus:border-navy-400 focus:ring-1 focus:ring-navy-200 resize-none bg-white transition-all"></textarea>
          <p class="text-[10px] text-gray-300 text-right mt-1"><span id="caption-count">0</span>/500</p>
        </div>

        <!-- Category Pills -->
        <div>
          <label class="text-xs font-semibold text-navy-600 mb-2 block">Category</label>
          <div class="upload-category-pills" id="category-pills"></div>
        </div>

        <!-- Location -->
        <div>
          <label class="text-xs font-semibold text-navy-600 mb-2 block">Location</label>
          <div class="relative">
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"/></svg>
            <input type="text" id="location-input" placeholder="School Playground, Library..."
              class="w-full text-sm py-2.5 pl-9 pr-3 rounded-xl border border-gray-200 text-navy-800 placeholder:text-gray-400 focus:outline-none focus:border-navy-400 bg-white"/>
          </div>
        </div>

        <!-- Tag Friends -->
        <div>
          <label class="text-xs font-semibold text-navy-600 mb-2 block">Tag Friends</label>
          <div id="tagged-chips" class="flex flex-wrap gap-2 mb-2"></div>
          <button type="button" id="tag-friends-btn" class="flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-gray-300 text-sm text-gray-500 hover:border-navy-300 hover:text-navy-500 transition-all w-full justify-center">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z"/></svg>
            <span>+ Tag classmates</span>
          </button>
          <div id="friend-picker" class="hidden mt-2 max-h-40 overflow-y-auto bg-white border border-gray-100 rounded-xl shadow-card p-2 space-y-1">
            ${allUsers.length ? allUsers.map(u => `
              <label class="flex items-center gap-3 p-2.5 rounded-xl hover:bg-cream-50 cursor-pointer transition-colors">
                <input type="checkbox" class="friend-checkbox rounded border-gray-300 text-navy-500 focus:ring-navy-500" value="${u.id}" data-name="${sanitizeHTML(u.fullName || '')}"/>
                <div class="w-7 h-7 rounded-full bg-cream-200 flex items-center justify-center text-xs font-bold text-navy-500">${(u.fullName || '?')[0]}</div>
                <span class="text-sm text-navy-800">${sanitizeHTML(u.fullName || 'Unknown')}</span>
              </label>
            `).join('') : '<p class="text-xs text-gray-400 text-center py-3">No classmates found</p>'}
          </div>
        </div>

        <!-- Time Capsule Toggle -->
        <div class="upload-capsule-toggle" id="capsule-toggle-area">
          <span class="text-xl">🔒</span>
          <div class="flex-1">
            <p class="text-sm font-semibold text-navy-800">Time Capsule Mode</p>
            <p class="text-xs text-gray-400">Lock this memory until a future date</p>
          </div>
          <button type="button" class="toggle-switch" id="timecapsule-toggle"></button>
        </div>
        <div id="timecapsule-options" class="hidden ml-10 space-y-2">
          <input type="datetime-local" id="unlock-date"
            class="w-full text-sm py-2.5 px-3 rounded-xl border border-gray-200 text-navy-800 focus:outline-none focus:border-navy-400"/>
          <div class="flex gap-2 flex-wrap">
            <button type="button" class="quick-date-btn text-[11px] px-3 py-1.5 rounded-full bg-cream-100 text-navy-600 font-medium" data-days="30">1 Month</button>
            <button type="button" class="quick-date-btn text-[11px] px-3 py-1.5 rounded-full bg-cream-100 text-navy-600 font-medium" data-days="90">3 Months</button>
            <button type="button" class="quick-date-btn text-[11px] px-3 py-1.5 rounded-full bg-cream-100 text-navy-600 font-medium" data-days="365">1 Year</button>
            <button type="button" class="quick-date-btn text-[11px] px-3 py-1.5 rounded-full bg-cream-100 text-navy-600 font-medium" data-days="1825">5 Years</button>
          </div>
          <p class="text-[10px] text-gray-400">When should this memory be revealed?</p>
        </div>

        <!-- Submit Button -->
        <button type="submit" id="upload-submit" class="btn-primary btn-shimmer" disabled>
          ✨ POST MEMORY
        </button>
      </form>
    </section>
  `;

  // ---- Back button ----
  container.querySelector('#upload-back-btn')?.addEventListener('click', () => router.navigateBack());

  // ---- Category pills ----
  const pillsEl = container.querySelector('#category-pills');
  let selectedCat = '';
  MEMORY_CATEGORIES.forEach(cat => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'upload-category-pill';
    pill.textContent = cat;
    pill.addEventListener('click', () => {
      pillsEl.querySelectorAll('.upload-category-pill').forEach(c => c.classList.remove('active'));
      pill.classList.add('active');
      selectedCat = cat;
    });
    pillsEl.appendChild(pill);
  });

  // ---- Caption counter ----
  const captionInput = container.querySelector('#caption-input');
  const captionCount = container.querySelector('#caption-count');
  captionInput?.addEventListener('input', () => {
    captionCount.textContent = captionInput.value.length;
  });

  // ---- Drag & drop ----
  const dropZone = container.querySelector('#drop-zone');
  const fileInput = container.querySelector('#file-input');
  const previewSection = container.querySelector('#preview-section');
  const previewCarousel = container.querySelector('#preview-carousel');
  const submitBtn = container.querySelector('#upload-submit');
  let selectedFiles = [];

  ['dragenter', 'dragover'].forEach(evt => {
    dropZone?.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  });
  ['dragleave', 'drop'].forEach(evt => {
    dropZone?.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); });
  });
  dropZone?.addEventListener('drop', (e) => {
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image') || f.type.startsWith('video'));
    if (files.length) {
      selectedFiles = [...selectedFiles, ...files];
      updatePreview();
    }
  });

  fileInput?.addEventListener('change', (e) => {
    const files = [...e.target.files];
    if (files.length) {
      selectedFiles = [...selectedFiles, ...files];
      updatePreview();
    }
    fileInput.value = '';
  });

  container.querySelector('#add-more-btn')?.addEventListener('click', () => fileInput?.click());

  function updatePreview() {
    if (selectedFiles.length === 0) {
      previewSection.classList.add('hidden');
      dropZone.classList.remove('hidden');
      submitBtn.disabled = true;
      return;
    }
    dropZone.classList.add('hidden');
    previewSection.classList.remove('hidden');
    container.querySelector('#file-count').textContent = selectedFiles.length;
    previewCarousel.innerHTML = selectedFiles.map((f, i) => {
      const url = URL.createObjectURL(f);
      return `
        <div class="upload-preview-item">
          ${f.type.startsWith('video') ? `
            <video src="${url}" class="w-full h-full object-cover"></video>
            <div class="absolute inset-0 flex items-center justify-center bg-black/30"><span class="text-2xl">🎬</span></div>
          ` : `<img src="${url}" alt="Preview" class="w-full h-full object-cover"/>`}
          <button type="button" class="upload-preview-remove" data-idx="${i}">&times;</button>
        </div>
      `;
    }).join('');
    submitBtn.disabled = false;

    // Remove buttons
    previewCarousel.querySelectorAll('.upload-preview-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedFiles.splice(parseInt(btn.dataset.idx), 1);
        updatePreview();
      });
    });
  }

  // ---- Tag friends ----
  const tagBtn = container.querySelector('#tag-friends-btn');
  const friendPicker = container.querySelector('#friend-picker');
  const taggedChips = container.querySelector('#tagged-chips');
  let taggedFriends = [];

  tagBtn?.addEventListener('click', () => friendPicker.classList.toggle('hidden'));

  container.querySelectorAll('.friend-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      taggedFriends = [...container.querySelectorAll('.friend-checkbox:checked')].map(el => ({
        id: el.value, name: el.dataset.name
      }));
      taggedChips.innerHTML = taggedFriends.map(f =>
        `<div class="upload-tag-chip">@${sanitizeHTML(f.name)}<button type="button" class="remove" data-id="${f.id}">&times;</button></div>`
      ).join('');
      taggedChips.querySelectorAll('.remove').forEach(btn => {
        btn.addEventListener('click', () => {
          const cb = container.querySelector(`.friend-checkbox[value="${btn.dataset.id}"]`);
          if (cb) { cb.checked = false; cb.dispatchEvent(new Event('change')); }
        });
      });
    });
  });

  // ---- Time capsule toggle ----
  const capsuleToggle = container.querySelector('#timecapsule-toggle');
  const capsuleOptions = container.querySelector('#timecapsule-options');
  let isCapsule = false;

  capsuleToggle?.addEventListener('click', () => {
    isCapsule = !isCapsule;
    capsuleToggle.classList.toggle('active', isCapsule);
    capsuleOptions.classList.toggle('hidden', !isCapsule);
    submitBtn.innerHTML = isCapsule ? '🔒 LOCK TIME CAPSULE' : '✨ POST MEMORY';
  });

  // Quick date buttons
  container.querySelectorAll('.quick-date-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const days = parseInt(btn.dataset.days);
      const future = new Date();
      future.setDate(future.getDate() + days);
      const dateInput = container.querySelector('#unlock-date');
      if (dateInput) {
        dateInput.value = future.toISOString().slice(0, 16);
      }
      container.querySelectorAll('.quick-date-btn').forEach(b => b.classList.remove('bg-navy-500', 'text-white'));
      btn.classList.add('bg-navy-500', 'text-white');
    });
  });

  // ---- Submit ----
  container.querySelector('#upload-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedFiles.length || !authManager.currentUser) return;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '⏳ PREPARING...';

    const progressContainer = container.querySelector('#upload-progress');
    const progressBar = container.querySelector('#progress-bar');
    const progressPercent = container.querySelector('#progress-percent');

    try {
      const file = selectedFiles[0];
      const unlockDate = container.querySelector('#unlock-date')?.value;

      // Compress image
      let processedFile = file;
      if (file.type.startsWith('image')) {
        submitBtn.innerHTML = '🗜️ COMPRESSING...';
        processedFile = await compressImage(file);
      }

      // Upload with progress
      progressContainer.classList.remove('hidden');
      submitBtn.innerHTML = '📤 UPLOADING...';

      const path = `posts/${authManager.currentUser.uid}/${Date.now()}_${file.name}`;
      const sRef = storageRef(storage, path);
      const uploadTask = uploadBytesResumable(sRef, processedFile);

      await new Promise((resolve, reject) => {
        uploadTask.on('state_changed',
          (snapshot) => {
            const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            if (progressBar) progressBar.style.width = progress + '%';
            if (progressPercent) progressPercent.textContent = progress + '%';
          },
          reject, resolve
        );
      });

      const imageUrl = await getDownloadURL(sRef);

      if (isCapsule && unlockDate) {
        await addDoc(collection(db, 'timeCapsules'), {
          authorId: authManager.currentUser.uid,
          authorName: authManager.userData?.fullName || 'Unknown',
          authorPhoto: authManager.userData?.profilePic || '',
          caption: captionInput.value,
          imageUrl,
          mediaType: file.type.startsWith('video') ? 'video' : 'image',
          unlockDate: new Date(unlockDate).toISOString(),
          isUnlocked: false,
          createdAt: serverTimestamp()
        });
        showToast('Time capsule locked! 🔒', 'success');
      } else {
        const postData = {
          authorId: authManager.currentUser.uid,
          authorName: authManager.userData?.fullName || 'Unknown',
          authorPhoto: authManager.userData?.profilePic || '',
          caption: captionInput.value,
          category: selectedCat,
          location: container.querySelector('#location-input')?.value || '',
          taggedFriends: taggedFriends.map(f => f.id),
          imageUrl,
          mediaType: file.type.startsWith('video') ? 'video' : 'image',
          likes: [],
          commentCount: 0,
          createdAt: serverTimestamp()
        };
        await addDoc(collection(db, 'posts'), postData);
        showToast('Memory posted! 📸', 'success');

        // Notify tagged friends
        for (const friend of taggedFriends) {
          createNotification('tag', friend.id, { postId: 'latest', message: 'tagged you in a memory' });
        }
      }

      // Success animation then navigate home
      submitBtn.innerHTML = '✅ POSTED!';
      setTimeout(() => router.navigate('home'), 1000);

    } catch (err) {
      console.error('Upload error:', err);
      showToast('Upload failed. Try again.', 'error');
      progressContainer.classList.add('hidden');
      submitBtn.disabled = false;
      submitBtn.innerHTML = isCapsule ? '🔒 LOCK TIME CAPSULE' : '✨ POST MEMORY';
    }
  });
}
