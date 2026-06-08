// Upload page — Premium Instagram + Apple inspired social media design (v2)
import { db, storage, collection, addDoc, serverTimestamp, Timestamp, storageRef, uploadBytesResumable, getDownloadURL, getDocs } from '../firebase-config.js';
import { showToast, MEMORY_CATEGORIES, compressImage, sanitizeHTML } from '../utils.js';
import { authManager, awardPoints } from '../auth.js';
import { createNotification } from '../notifications.js';
import { router } from '../router.js';

const CATEGORY_ICONS = {
  'Tour': '🚌', 'Farewell': '🎓', 'Sports Day': '🏆', 'Classroom Fun': '😂',
  'Group Selfie': '🤳', 'Cultural Event': '🎭', 'Random': '🎲', 'Birthday': '🎂',
  'Exam Time': '📝', 'Last Day': '🏫'
};

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
    allUsers.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
  } catch (e) { }

  const userName = authManager.userData?.fullName?.split(' ')[0] || 'there';

  container.innerHTML = `
    <section class="cm-upload-page" id="upload-page">

      <!-- ===== PREMIUM FLOATING HEADER ===== -->
      <div class="cm-upload-header">
        <button id="upload-back-btn" class="cm-upload-back-btn" aria-label="Go back">
          <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
        </button>
        <div class="cm-upload-header-title">
          <h2>Create Memory</h2>
          <p>Hey ${sanitizeHTML(userName)}, share a moment ✨</p>
        </div>
        <div class="cm-upload-header-icon">
          <svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"/><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z"/></svg>
        </div>
      </div>

      <form id="upload-form" class="cm-upload-form" autocomplete="off">

        <!-- ===== HERO UPLOAD ZONE ===== -->
        <div class="cm-upload-zone" id="drop-zone">
          <input type="file" id="file-input" accept="image/*,video/*" multiple class="cm-upload-zone-input"/>
          <!-- Animated corner accents -->
          <div class="cm-upload-zone-corner cm-upload-zone-corner-tl"></div>
          <div class="cm-upload-zone-corner cm-upload-zone-corner-tr"></div>
          <div class="cm-upload-zone-corner cm-upload-zone-corner-bl"></div>
          <div class="cm-upload-zone-corner cm-upload-zone-corner-br"></div>
          <div id="upload-placeholder" class="cm-upload-zone-content">
            <div class="cm-upload-zone-icon-ring">
              <div class="cm-upload-zone-icon">
                <svg width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
                </svg>
              </div>
            </div>
            <h3 class="cm-upload-zone-title">Drop your memories here</h3>
            <p class="cm-upload-zone-subtitle">or tap to browse photos & videos</p>
            <div class="cm-upload-zone-actions">
              <span class="cm-upload-zone-chip">
                <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"/><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z"/></svg>
                Camera
              </span>
              <span class="cm-upload-zone-divider"></span>
              <span class="cm-upload-zone-chip">
                <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"/></svg>
                Gallery
              </span>
            </div>
            <p class="cm-upload-zone-hint">
              <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"/></svg>
              Auto-compressed · Max 10MB each
            </p>
          </div>
        </div>

        <!-- ===== IMAGE PREVIEW GRID ===== -->
        <div id="preview-section" class="cm-preview-section hidden">
          <div class="cm-preview-header">
            <div class="cm-preview-count">
              <span class="cm-preview-count-num" id="file-count">0</span>
              <span>selected</span>
            </div>
            <button type="button" id="add-more-btn" class="cm-preview-add-btn">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
              Add More
            </button>
          </div>
          <div class="cm-preview-grid" id="preview-carousel"></div>
        </div>

        <!-- ===== UPLOAD PROGRESS ===== -->
        <div id="upload-progress" class="cm-progress-card hidden">
          <div class="cm-progress-info">
            <div class="cm-progress-pulse"></div>
            <span class="cm-progress-label">Uploading your memory...</span>
            <span class="cm-progress-percent" id="progress-percent">0%</span>
          </div>
          <div class="cm-progress-track">
            <div class="cm-progress-bar" id="progress-bar"></div>
          </div>
        </div>

        <!-- ===== CAPTION ===== -->
        <div class="cm-form-card cm-form-card--caption">
          <div class="cm-form-card-header">
            <div class="cm-form-card-icon-bubble cm-form-card-icon-bubble--blue">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125"/></svg>
            </div>
            <span>Caption</span>
            <span class="cm-form-char-count" id="caption-counter-wrap">
              <span id="caption-count">0</span><span class="cm-form-char-sep">/</span><span>500</span>
            </span>
          </div>
          <textarea id="caption-input" rows="1" maxlength="500"
            placeholder="What makes this moment special?&#10;Tell the story behind this memory..."
            class="cm-caption-input"></textarea>
        </div>

        <!-- ===== CATEGORY ===== -->
        <div class="cm-form-card">
          <div class="cm-form-card-header">
            <div class="cm-form-card-icon-bubble cm-form-card-icon-bubble--purple">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z"/><path stroke-linecap="round" stroke-linejoin="round" d="M6 6h.008v.008H6V6z"/></svg>
            </div>
            <span>Category</span>
            <span class="cm-form-card-hint" id="cat-selected-label"></span>
          </div>
          <div class="cm-category-scroll" id="category-pills"></div>
        </div>

        <!-- ===== LOCATION ===== -->
        <div class="cm-form-card">
          <div class="cm-form-card-header">
            <div class="cm-form-card-icon-bubble cm-form-card-icon-bubble--green">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"/></svg>
            </div>
            <span>Location</span>
          </div>
          <div class="cm-location-input-wrap">
            <svg class="cm-location-icon" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"/></svg>
            <input type="text" id="location-input" placeholder="Add a location..." class="cm-location-input"/>
            <svg class="cm-location-search-icon" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/></svg>
          </div>
          <div class="cm-location-suggestions">
            <button type="button" class="cm-loc-chip" data-loc="School Playground">
              <span class="cm-loc-chip-emoji">🏫</span>
              <span>Playground</span>
            </button>
            <button type="button" class="cm-loc-chip" data-loc="Classroom">
              <span class="cm-loc-chip-emoji">📚</span>
              <span>Classroom</span>
            </button>
            <button type="button" class="cm-loc-chip" data-loc="Library">
              <span class="cm-loc-chip-emoji">📖</span>
              <span>Library</span>
            </button>
            <button type="button" class="cm-loc-chip" data-loc="Auditorium">
              <span class="cm-loc-chip-emoji">🎭</span>
              <span>Auditorium</span>
            </button>
            <button type="button" class="cm-loc-chip" data-loc="Canteen">
              <span class="cm-loc-chip-emoji">🍕</span>
              <span>Canteen</span>
            </button>
            <button type="button" class="cm-loc-chip" data-loc="Sports Ground">
              <span class="cm-loc-chip-emoji">⚽</span>
              <span>Sports</span>
            </button>
          </div>
        </div>

        <!-- ===== TAG FRIENDS ===== -->
        <div class="cm-form-card">
          <div class="cm-form-card-header">
            <div class="cm-form-card-icon-bubble cm-form-card-icon-bubble--orange">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z"/></svg>
            </div>
            <span>Tag Friends</span>
            <span class="cm-form-card-hint" id="tagged-count-label"></span>
          </div>
          <div id="tagged-avatars" class="cm-tagged-avatars"></div>
          <button type="button" id="tag-friends-btn" class="cm-tag-btn">
            <div class="cm-tag-btn-icon">
              <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
            </div>
            <div class="cm-tag-btn-content">
              <span class="cm-tag-btn-title">Tag classmates in this memory</span>
              <span class="cm-tag-btn-subtitle">They'll be notified when you post</span>
            </div>
            <svg class="cm-tag-btn-arrow" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
          </button>
        </div>

        <!-- ===== TIME CAPSULE ===== -->
        <div class="cm-capsule-card" id="capsule-card">
          <div class="cm-capsule-glow"></div>
          <div class="cm-capsule-header" id="capsule-toggle-area">
            <div class="cm-capsule-icon-wrap">
              <span class="cm-capsule-lock-icon" id="capsule-lock-icon">🔒</span>
            </div>
            <div class="cm-capsule-info">
              <h4>Time Capsule Mode</h4>
              <p>Lock this memory until a future date</p>
            </div>
            <button type="button" class="toggle-switch" id="timecapsule-toggle"></button>
          </div>
          <div id="timecapsule-options" class="cm-capsule-body hidden">
            <div class="cm-capsule-date-wrap">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/></svg>
              <input type="datetime-local" id="unlock-date" class="cm-capsule-date-input"/>
            </div>
            <div class="cm-capsule-quick-dates">
              <button type="button" class="cm-quick-date" data-days="30">
                <span class="cm-quick-date-val">1</span>
                <span class="cm-quick-date-unit">Month</span>
              </button>
              <button type="button" class="cm-quick-date" data-days="90">
                <span class="cm-quick-date-val">3</span>
                <span class="cm-quick-date-unit">Months</span>
              </button>
              <button type="button" class="cm-quick-date" data-days="365">
                <span class="cm-quick-date-val">1</span>
                <span class="cm-quick-date-unit">Year</span>
              </button>
              <button type="button" class="cm-quick-date" data-days="1825">
                <span class="cm-quick-date-val">5</span>
                <span class="cm-quick-date-unit">Years</span>
              </button>
            </div>
            <div class="cm-capsule-reveal-hint" id="capsule-countdown"></div>
          </div>
        </div>

        <!-- Spacer for sticky button -->
        <div style="height:88px"></div>

        <!-- ===== STICKY SUBMIT ===== -->
        <div class="cm-submit-bar">
          <button type="submit" id="upload-submit" class="cm-submit-btn" disabled>
            <span class="cm-submit-btn-icon">
              <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/></svg>
            </span>
            <span class="cm-submit-btn-text">Post Memory</span>
            <div class="cm-submit-btn-loader hidden" id="submit-loader">
              <div class="cm-spinner"></div>
            </div>
          </button>
        </div>
      </form>
    </section>
  `;

  // Page entrance animation with staggered children
  const page = container.querySelector('.cm-upload-page');
  requestAnimationFrame(() => {
    page?.classList.add('cm-page-enter');
    // Stagger card animations
    container.querySelectorAll('.cm-form-card, .cm-capsule-card').forEach((card, i) => {
      card.style.opacity = '0';
      card.style.transform = 'translateY(16px)';
      setTimeout(() => {
        card.style.transition = 'opacity 0.5s cubic-bezier(0.25,0.46,0.45,0.94), transform 0.5s cubic-bezier(0.25,0.46,0.45,0.94)';
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
      }, 150 + i * 80);
    });
  });

  // ---- Back button ----
  container.querySelector('#upload-back-btn')?.addEventListener('click', () => router.navigateBack());

  // ---- Category pills with icons ----
  const pillsEl = container.querySelector('#category-pills');
  const catLabel = container.querySelector('#cat-selected-label');
  let selectedCat = '';
  MEMORY_CATEGORIES.forEach((cat, i) => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'cm-cat-pill';
    pill.style.animationDelay = `${i * 40}ms`;
    pill.innerHTML = `<span class="cm-cat-pill-icon">${CATEGORY_ICONS[cat] || '📎'}</span><span class="cm-cat-pill-label">${cat}</span>`;
    pill.addEventListener('click', () => {
      pillsEl.querySelectorAll('.cm-cat-pill').forEach(c => c.classList.remove('active'));
      pill.classList.add('active');
      selectedCat = cat;
      if (catLabel) catLabel.textContent = `• ${cat}`;
      // Haptic
      if (navigator.vibrate) navigator.vibrate(10);
    });
    pillsEl.appendChild(pill);
  });

  // ---- Auto-growing caption ----
  const captionInput = container.querySelector('#caption-input');
  const captionCount = container.querySelector('#caption-count');
  const captionCounterWrap = container.querySelector('#caption-counter-wrap');
  captionInput?.addEventListener('input', () => {
    const len = captionInput.value.length;
    captionCount.textContent = len;
    // Color feedback on char count
    if (captionCounterWrap) {
      captionCounterWrap.classList.toggle('cm-char-warn', len > 400 && len <= 480);
      captionCounterWrap.classList.toggle('cm-char-danger', len > 480);
    }
    // Auto-grow
    captionInput.style.height = 'auto';
    captionInput.style.height = Math.min(captionInput.scrollHeight, 200) + 'px';
  });

  // ---- Location suggestions ----
  const locInput = container.querySelector('#location-input');
  container.querySelectorAll('.cm-loc-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      locInput.value = chip.dataset.loc;
      container.querySelectorAll('.cm-loc-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      if (navigator.vibrate) navigator.vibrate(8);
    });
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
      if (navigator.vibrate) navigator.vibrate(15);
    }
  });

  fileInput?.addEventListener('change', (e) => {
    const files = [...e.target.files];
    if (files.length) {
      selectedFiles = [...selectedFiles, ...files];
      updatePreview();
      if (navigator.vibrate) navigator.vibrate(15);
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
      const sizeMB = (f.size / 1024 / 1024).toFixed(1);
      return `
        <div class="cm-preview-item" style="animation-delay:${i * 60}ms">
          ${f.type.startsWith('video') ? `
            <video src="${url}" class="cm-preview-media"></video>
            <div class="cm-preview-video-badge">
              <svg width="10" height="10" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              Video
            </div>
          ` : `<img src="${url}" alt="Preview" class="cm-preview-media"/>`}
          <button type="button" class="cm-preview-remove" data-idx="${i}" aria-label="Remove">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
          ${i === 0 ? '<div class="cm-preview-cover-badge"><svg width="8" height="8" fill="currentColor" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg> Cover</div>' : ''}
          <div class="cm-preview-size-badge">${sizeMB}MB</div>
        </div>
      `;
    }).join('');
    submitBtn.disabled = false;

    // Remove buttons
    previewCarousel.querySelectorAll('.cm-preview-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        // Animate out
        const item = btn.closest('.cm-preview-item');
        if (item) {
          item.style.transition = 'opacity 0.25s, transform 0.25s';
          item.style.opacity = '0';
          item.style.transform = 'scale(0.7)';
          setTimeout(() => {
            selectedFiles.splice(idx, 1);
            updatePreview();
          }, 250);
        } else {
          selectedFiles.splice(idx, 1);
          updatePreview();
        }
      });
    });
  }

  // ---- Tag friends (modal approach) ----
  const tagBtn = container.querySelector('#tag-friends-btn');
  const taggedAvatars = container.querySelector('#tagged-avatars');
  const taggedCountLabel = container.querySelector('#tagged-count-label');
  let taggedFriends = [];

  tagBtn?.addEventListener('click', () => showTagFriendsModal());

  function showTagFriendsModal() {
    const modal = router.openModal('', { title: '👥 Tag Classmates' });
    modal.body.innerHTML = `
      <div class="p-4">
        <div class="cm-tag-search-wrap">
          <svg class="cm-tag-search-icon" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/></svg>
          <input type="text" id="tag-search" placeholder="Search classmates..." class="cm-tag-search"/>
        </div>
        <div class="cm-tag-list" id="tag-list">
          ${allUsers.map(u => {
            const isTagged = taggedFriends.some(f => f.id === u.id);
            return `
              <label class="cm-tag-user ${isTagged ? 'selected' : ''}" data-uid="${u.id}" data-name="${sanitizeHTML(u.fullName || '')}">
                <div class="cm-tag-user-avatar">
                  ${u.profilePic
                    ? `<img src="${u.profilePic}" alt="" class="cm-tag-user-pic"/>`
                    : `<div class="cm-tag-user-placeholder">${(u.fullName || '?')[0]}</div>`}
                </div>
                <div class="cm-tag-user-info">
                  <p class="cm-tag-user-name">${sanitizeHTML(u.fullName || 'Unknown')}</p>
                  <p class="cm-tag-user-detail">${u.nickname ? `"${sanitizeHTML(u.nickname)}"` : u.rollNumber || ''}</p>
                </div>
                <div class="cm-tag-check ${isTagged ? 'active' : ''}">
                  <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
                </div>
              </label>
            `;
          }).join('')}
        </div>
        <button type="button" id="tag-done-btn" class="cm-tag-done-btn">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
          Done · ${taggedFriends.length} selected
        </button>
      </div>
    `;

    // Search filter
    modal.body.querySelector('#tag-search')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      modal.body.querySelectorAll('.cm-tag-user').forEach(el => {
        const name = el.dataset.name.toLowerCase();
        el.style.display = name.includes(q) ? '' : 'none';
      });
    });

    // Toggle selection
    modal.body.querySelectorAll('.cm-tag-user').forEach(el => {
      el.addEventListener('click', () => {
        const uid = el.dataset.uid;
        const name = el.dataset.name;
        const idx = taggedFriends.findIndex(f => f.id === uid);
        if (idx >= 0) {
          taggedFriends.splice(idx, 1);
          el.classList.remove('selected');
          el.querySelector('.cm-tag-check').classList.remove('active');
        } else {
          const user = allUsers.find(u => u.id === uid);
          taggedFriends.push({ id: uid, name, pic: user?.profilePic || '' });
          el.classList.add('selected');
          el.querySelector('.cm-tag-check').classList.add('active');
        }
        modal.body.querySelector('#tag-done-btn').innerHTML = `
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
          Done · ${taggedFriends.length} selected
        `;
        if (navigator.vibrate) navigator.vibrate(10);
      });
    });

    // Done button
    modal.body.querySelector('#tag-done-btn')?.addEventListener('click', () => {
      modal.close();
      renderTaggedAvatars();
    });
  }

  function renderTaggedAvatars() {
    if (taggedCountLabel) {
      taggedCountLabel.textContent = taggedFriends.length > 0 ? `• ${taggedFriends.length} tagged` : '';
    }
    if (taggedFriends.length === 0) {
      taggedAvatars.innerHTML = '';
      return;
    }
    taggedAvatars.innerHTML = taggedFriends.map(f => `
      <div class="cm-tagged-chip">
        <div class="cm-tagged-chip-avatar">
          ${f.pic ? `<img src="${f.pic}" alt=""/>` : `<span>${(f.name || '?')[0]}</span>`}
        </div>
        <span class="cm-tagged-chip-name">@${sanitizeHTML(f.name)}</span>
        <button type="button" class="cm-tagged-chip-remove" data-id="${f.id}">
          <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
    `).join('');
    taggedAvatars.querySelectorAll('.cm-tagged-chip-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        taggedFriends = taggedFriends.filter(f => f.id !== btn.dataset.id);
        renderTaggedAvatars();
      });
    });
  }

  // ---- Time capsule toggle ----
  const capsuleToggle = container.querySelector('#timecapsule-toggle');
  const capsuleOptions = container.querySelector('#timecapsule-options');
  const capsuleCard = container.querySelector('#capsule-card');
  const capsuleLock = container.querySelector('#capsule-lock-icon');
  let isCapsule = false;

  capsuleToggle?.addEventListener('click', () => {
    isCapsule = !isCapsule;
    capsuleToggle.classList.toggle('active', isCapsule);
    capsuleOptions.classList.toggle('hidden', !isCapsule);
    capsuleCard.classList.toggle('cm-capsule-active', isCapsule);
    capsuleLock.textContent = isCapsule ? '🔓' : '🔒';
    const btnText = container.querySelector('.cm-submit-btn-text');
    if (btnText) btnText.textContent = isCapsule ? 'Lock Time Capsule' : 'Post Memory';
    const btnIcon = container.querySelector('.cm-submit-btn-icon');
    if (btnIcon) btnIcon.innerHTML = isCapsule
      ? '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/></svg>'
      : '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/></svg>';
    if (navigator.vibrate) navigator.vibrate([15, 30, 15]);
  });

  // Quick date buttons
  const unlockDateInput = container.querySelector('#unlock-date');
  container.querySelectorAll('.cm-quick-date').forEach(btn => {
    btn.addEventListener('click', () => {
      const days = parseInt(btn.dataset.days);
      const future = new Date();
      future.setDate(future.getDate() + days);
      if (unlockDateInput) {
        unlockDateInput.value = future.toISOString().slice(0, 16);
      }
      container.querySelectorAll('.cm-quick-date').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Show countdown
      updateCapsuleCountdown(future);
      if (navigator.vibrate) navigator.vibrate(10);
    });
  });

  unlockDateInput?.addEventListener('change', () => {
    if (unlockDateInput.value) {
      updateCapsuleCountdown(new Date(unlockDateInput.value));
      container.querySelectorAll('.cm-quick-date').forEach(b => b.classList.remove('active'));
    }
  });

  function updateCapsuleCountdown(targetDate) {
    const el = container.querySelector('#capsule-countdown');
    if (!el) return;
    const now = new Date();
    const diff = targetDate.getTime() - now.getTime();
    if (diff <= 0) {
      el.innerHTML = '<p class="cm-countdown-text">⚠️ Please select a future date</p>';
      return;
    }
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);
    let timeText = `${days} day${days !== 1 ? 's' : ''} from now`;
    if (years >= 1) timeText = `${years} year${years !== 1 ? 's' : ''} and ${days % 365} days`;
    else if (months >= 1) timeText = `${months} month${months !== 1 ? 's' : ''} and ${days % 30} days`;
    el.innerHTML = `
      <div class="cm-countdown-reveal">
        <div class="cm-countdown-header">
          <span class="cm-countdown-gift">🎁</span>
          <span class="cm-countdown-label">Reveals in</span>
        </div>
        <div class="cm-countdown-timer">
          <div class="cm-countdown-block">
            <span class="cm-countdown-num">${days}</span>
            <span class="cm-countdown-unit">days</span>
          </div>
          <span class="cm-countdown-sep">:</span>
          <div class="cm-countdown-block">
            <span class="cm-countdown-num">${hours}</span>
            <span class="cm-countdown-unit">hours</span>
          </div>
        </div>
        <span class="cm-countdown-date">
          <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/></svg>
          ${targetDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
        </span>
      </div>
    `;
  }

  // ---- Submit ----
  container.querySelector('#upload-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedFiles.length || !authManager.currentUser) return;
    submitBtn.disabled = true;
    const btnText = container.querySelector('.cm-submit-btn-text');
    const btnLoader = container.querySelector('#submit-loader');
    const btnIcon = container.querySelector('.cm-submit-btn-icon');
    btnText.classList.add('hidden');
    if (btnIcon) btnIcon.classList.add('hidden');
    btnLoader.classList.remove('hidden');
    if (navigator.vibrate) navigator.vibrate(20);

    const progressContainer = container.querySelector('#upload-progress');
    const progressBar = container.querySelector('#progress-bar');
    const progressPercent = container.querySelector('#progress-percent');

    try {
      const file = selectedFiles[0];
      const unlockDate = container.querySelector('#unlock-date')?.value;

      // Compress image
      let processedFile = file;
      if (file.type.startsWith('image')) {
        processedFile = await compressImage(file);
      }

      // Upload with progress
      progressContainer.classList.remove('hidden');

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
          unlockDate: Timestamp.fromDate(new Date(unlockDate)),
          isUnlocked: false,
          createdAt: serverTimestamp()
        });
        showToast('Time capsule locked! +5 Points 🔒', 'success');
        await awardPoints(authManager.currentUser.uid, 5, 'Time Capsule Created');
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
        showToast('Memory posted! +20 Points 📸', 'success');
        await awardPoints(authManager.currentUser.uid, 20, 'Post Created');

        // Notify tagged friends
        for (const friend of taggedFriends) {
          createNotification('tag', friend.id, { postId: 'latest', message: 'tagged you in a memory' });
        }
      }

      // Success animation
      btnLoader.classList.add('hidden');
      if (btnIcon) btnIcon.classList.remove('hidden');
      btnText.classList.remove('hidden');
      btnText.textContent = 'Posted!';
      if (btnIcon) btnIcon.innerHTML = '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>';
      submitBtn.classList.add('cm-submit-success');
      if (navigator.vibrate) navigator.vibrate([50, 50, 50]);

      setTimeout(() => {
        submitBtn.classList.remove('cm-submit-success');
        btnText.textContent = isCapsule ? 'Lock Time Capsule' : 'Post Memory';
        if (btnIcon) btnIcon.innerHTML = isCapsule
          ? '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/></svg>'
          : '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/></svg>';
        submitBtn.disabled = false;
        container.querySelector('#upload-form').reset();
        selectedFiles = [];
        updatePreview();
        progressContainer.classList.add('hidden');
        if (progressBar) progressBar.style.width = '0%';
        if (progressPercent) progressPercent.textContent = '0%';
        if (captionCount) captionCount.textContent = '0';
        if (captionInput) captionInput.style.height = 'auto';
        taggedFriends = [];
        renderTaggedAvatars();
        pillsEl.querySelectorAll('.cm-cat-pill').forEach(c => c.classList.remove('active'));
        selectedCat = '';
        if (catLabel) catLabel.textContent = '';
        container.querySelectorAll('.cm-loc-chip').forEach(c => c.classList.remove('active'));
      }, 3000);

    } catch (err) {
      console.error('Upload error:', err);
      showToast('Upload failed. Try again.', 'error');
      progressContainer.classList.add('hidden');
      btnLoader.classList.add('hidden');
      if (btnIcon) btnIcon.classList.remove('hidden');
      btnText.classList.remove('hidden');
      submitBtn.disabled = false;
      btnText.textContent = isCapsule ? 'Lock Time Capsule' : 'Post Memory';
    }
  });
}
