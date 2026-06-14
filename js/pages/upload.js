// Upload page — Premium Instagram + Apple inspired Multi-Step flow
import { db, collection, addDoc, serverTimestamp, Timestamp, getDocs } from '../firebase-config.js';
import { uploadMedia } from '../services/cloudinary.js';
import { showToast, compressImage, sanitizeHTML } from '../utils.js';
import { authManager, awardPoints } from '../auth.js';
import { createNotification } from '../notifications.js';
import { router } from '../router.js';

export async function renderUpload(container) {
  // Load users for tagging/mentioning
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
    <section class="cm-upload-wizard relative overflow-x-hidden min-h-screen pb-32" id="upload-wizard">
      
      <!-- HEADER -->
      <div class="cm-upload-header sticky top-0 bg-white/95 backdrop-blur-sm z-50 border-b border-gray-100 flex items-center justify-between px-4 py-3">
        <button type="button" id="wizard-back-btn" class="text-navy-500 p-2">
          <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
        </button>
        <div class="text-center flex-1">
          <h2 class="text-base font-bold text-navy-800" id="wizard-title">New Memory</h2>
          <p class="text-[10px] text-gray-400">Step <span id="wizard-step-num">1</span> of 7</p>
        </div>
        <div class="w-8"></div>
      </div>

      <!-- PROGRESS -->
      <div class="cm-wizard-progress" id="wizard-progress">
        <div class="cm-wizard-dot active"></div>
        <div class="cm-wizard-dot"></div>
        <div class="cm-wizard-dot"></div>
        <div class="cm-wizard-dot"></div>
        <div class="cm-wizard-dot"></div>
        <div class="cm-wizard-dot"></div>
        <div class="cm-wizard-dot"></div>
      </div>

      <form id="wizard-form" autocomplete="off" class="relative">
        <div class="cm-wizard-steps w-full flex flex-nowrap transition-transform duration-500 ease-in-out" id="wizard-track">
          
          <!-- STEP 1: MEDIA -->
          <div class="cm-wizard-step w-full flex-shrink-0 px-4 pt-4" id="step-1">
            <div class="cm-step-action-card border-2 border-dashed border-navy-200 bg-cream-50 rounded-2xl text-center py-10 cursor-pointer" id="media-dropzone">
              <input type="file" id="media-input" accept="image/*,video/*" multiple class="hidden"/>
              <div class="text-4xl mb-2 text-navy-400 flex justify-center">
                <svg width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"/></svg>
              </div>
              <h3 class="font-bold text-navy-800">Select Photos / Videos</h3>
              <p class="text-xs text-gray-400 mt-1">Tap to browse</p>
            </div>
            <div id="media-preview-container" class="hidden">
              <div class="flex items-center justify-between mb-2">
                <span class="text-sm font-semibold text-navy-800"><span id="media-count">0</span> Selected</span>
                <button type="button" class="text-xs text-navy-500 font-bold" onclick="document.getElementById('media-input').click()">+ Add More</button>
              </div>
              <div class="relative rounded-xl overflow-hidden shadow-sm bg-gray-100 w-full aspect-[4/3]">
                <div class="absolute inset-0 swipeable-gallery" id="media-gallery"></div>
                <div class="absolute bottom-2 left-0 right-0 gallery-dots" id="media-gallery-dots"></div>
              </div>
            </div>
          </div>

          <!-- STEP 2: CAPTION -->
          <div class="cm-wizard-step w-full flex-shrink-0 px-4 pt-4" id="step-2">
            <div class="cm-step-action-card bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
              <h3 class="font-bold text-navy-800 mb-2">Write a Caption</h3>
              <textarea id="caption-input" class="w-full bg-cream-50 rounded-xl p-3 text-sm text-navy-800 border border-gray-100 focus:border-navy-300 focus:outline-none resize-none min-h-[120px]" placeholder="What's the story behind this? 💭"></textarea>
              <div class="flex justify-between items-center mt-2">
                <div class="flex gap-2 text-xl">
                  <button type="button" class="emoji-btn" data-emoji="❤️">❤️</button>
                  <button type="button" class="emoji-btn" data-emoji="😂">😂</button>
                  <button type="button" class="emoji-btn" data-emoji="🔥">🔥</button>
                  <button type="button" class="emoji-btn" data-emoji="🎓">🎓</button>
                </div>
                <span class="text-xs text-gray-400 font-medium"><span id="caption-char-count">0</span> / 500</span>
              </div>
            </div>
          </div>

          <!-- STEP 3: TAG FRIENDS -->
          <div class="cm-wizard-step w-full flex-shrink-0 px-4 pt-4" id="step-3">
            <div class="cm-step-action-card bg-white rounded-2xl shadow-sm border border-gray-100 p-0 overflow-hidden flex flex-col h-full max-h-[50vh]">
              <div class="p-3 border-b border-gray-100 bg-cream-50">
                <h3 class="font-bold text-navy-800 mb-1">Tag Classmates</h3>
                <p class="text-xs text-gray-500 mb-3">Tagged friends will be notified and can accept to show this post on their profile.</p>
                <div class="relative">
                  <input type="text" id="tag-search" class="w-full bg-white rounded-lg py-2 pl-8 pr-3 text-sm border border-gray-200 focus:outline-none" placeholder="Search to tag..."/>
                  <svg class="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/></svg>
                </div>
              </div>
              <div class="overflow-y-auto flex-1 p-2 space-y-1" id="tag-list">
                ${allUsers.map(u => `
                  <label class="flex items-center gap-3 p-2 rounded-lg hover:bg-cream-50 cursor-pointer user-tag-item" data-uid="${u.id}" data-name="${sanitizeHTML(u.fullName || '')}">
                    ${u.profilePic ? `<img src="${u.profilePic}" class="w-8 h-8 rounded-full object-cover"/>` : `<div class="w-8 h-8 rounded-full bg-navy-500 text-white flex items-center justify-center text-xs">${(u.fullName||'?')[0]}</div>`}
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-semibold text-navy-800 truncate">${sanitizeHTML(u.fullName || 'Unknown')}</p>
                    </div>
                    <input type="checkbox" class="tag-checkbox w-4 h-4 rounded border-gray-300 text-navy-600 focus:ring-navy-500" value="${u.id}"/>
                  </label>
                `).join('')}
              </div>
            </div>
            <div id="tagged-preview" class="flex flex-wrap gap-2 mt-3"></div>
          </div>

          <!-- STEP 4: MENTION FRIENDS -->
          <div class="cm-wizard-step w-full flex-shrink-0 px-4 pt-4" id="step-4">
            <div class="cm-step-action-card bg-white rounded-2xl shadow-sm border border-gray-100 p-0 overflow-hidden flex flex-col h-full max-h-[50vh]">
              <div class="p-3 border-b border-gray-100 bg-cream-50">
                <h3 class="font-bold text-navy-800 mb-1">Mention Classmates</h3>
                <p class="text-xs text-gray-500 mb-3">Mentions appear below the caption. No approval required.</p>
                <div class="relative">
                  <input type="text" id="mention-search" class="w-full bg-white rounded-lg py-2 pl-8 pr-3 text-sm border border-gray-200 focus:outline-none" placeholder="Search to mention..."/>
                  <svg class="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/></svg>
                </div>
              </div>
              <div class="overflow-y-auto flex-1 p-2 space-y-1" id="mention-list">
                ${allUsers.map(u => `
                  <label class="flex items-center gap-3 p-2 rounded-lg hover:bg-cream-50 cursor-pointer user-mention-item" data-uid="${u.id}" data-name="${sanitizeHTML(u.fullName || '')}">
                    ${u.profilePic ? `<img src="${u.profilePic}" class="w-8 h-8 rounded-full object-cover"/>` : `<div class="w-8 h-8 rounded-full bg-navy-500 text-white flex items-center justify-center text-xs">${(u.fullName||'?')[0]}</div>`}
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-semibold text-navy-800 truncate">${sanitizeHTML(u.fullName || 'Unknown')}</p>
                    </div>
                    <input type="checkbox" class="mention-checkbox w-4 h-4 rounded border-gray-300 text-navy-600 focus:ring-navy-500" value="${u.id}"/>
                  </label>
                `).join('')}
              </div>
            </div>
            <div id="mentioned-preview" class="flex flex-wrap gap-2 mt-3"></div>
          </div>

          <!-- STEP 5: LOCATION -->
          <div class="cm-wizard-step w-full flex-shrink-0 px-4 pt-4" id="step-5">
            <div class="cm-step-action-card bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
              <h3 class="font-bold text-navy-800 mb-2">Add Location</h3>
              <div class="relative mb-4">
                <input type="text" id="location-input" class="w-full bg-cream-50 rounded-xl py-3 pl-10 pr-3 text-sm text-navy-800 border border-gray-100 focus:border-navy-300 focus:outline-none" placeholder="Where was this?"/>
                <svg class="absolute left-3 top-3.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"/></svg>
              </div>
              <p class="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wider">Suggested Places</p>
              <div class="flex flex-wrap gap-2">
                <button type="button" class="loc-chip px-3 py-1.5 rounded-full border border-gray-200 text-xs font-semibold text-navy-700 bg-white" data-loc="School Playground">🏫 Playground</button>
                <button type="button" class="loc-chip px-3 py-1.5 rounded-full border border-gray-200 text-xs font-semibold text-navy-700 bg-white" data-loc="Classroom">📚 Classroom</button>
                <button type="button" class="loc-chip px-3 py-1.5 rounded-full border border-gray-200 text-xs font-semibold text-navy-700 bg-white" data-loc="Library">📖 Library</button>
                <button type="button" class="loc-chip px-3 py-1.5 rounded-full border border-gray-200 text-xs font-semibold text-navy-700 bg-white" data-loc="Canteen">🍕 Canteen</button>
                <button type="button" class="loc-chip px-3 py-1.5 rounded-full border border-gray-200 text-xs font-semibold text-navy-700 bg-white" data-loc="Auditorium">🎭 Auditorium</button>
              </div>
            </div>
          </div>

          <!-- STEP 6: BACKGROUND MUSIC -->
          <div class="cm-wizard-step w-full flex-shrink-0 px-4 pt-4" id="step-6">
            <div class="cm-step-action-card bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
              <h3 class="font-bold text-navy-800 mb-1">Background Music</h3>
              <p class="text-xs text-gray-500 mb-4">Set the mood! Music will play when someone opens this post.</p>
              
              <div id="music-upload-btn" class="border-2 border-dashed border-navy-200 bg-cream-50 rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer mb-3 hover:bg-cream-100 transition-colors">
                <input type="file" id="music-input" accept="audio/mp3,audio/mpeg" class="hidden"/>
                <svg class="w-8 h-8 text-navy-400 mb-1" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 19.5V15m6 4.5v-4.5M9 15l3-3m0 0l3 3m-3-3v9"/></svg>
                <span class="text-sm font-semibold text-navy-800">Upload MP3</span>
              </div>
              
              <div id="music-preview" class="hidden flex items-center justify-between bg-navy-50 p-3 rounded-xl border border-navy-100">
                <div class="flex items-center gap-2 min-w-0">
                  <div class="w-8 h-8 rounded-full bg-navy-500 flex items-center justify-center text-white shrink-0">🎵</div>
                  <div class="min-w-0">
                    <p class="text-xs font-bold text-navy-800 truncate" id="music-filename">song.mp3</p>
                    <p class="text-[10px] text-gray-500">Audio Preview</p>
                  </div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <button type="button" id="music-play-btn" class="w-8 h-8 rounded-full bg-white shadow-sm flex items-center justify-center text-navy-600">
                    <svg class="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                  </button>
                  <button type="button" id="music-remove-btn" class="w-8 h-8 rounded-full bg-white shadow-sm flex items-center justify-center text-red-500">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                  </button>
                </div>
                <audio id="audio-preview-element" class="hidden"></audio>
              </div>

            </div>
          </div>

          <!-- STEP 7: PRIVACY -->
          <div class="cm-wizard-step w-full flex-shrink-0 px-4 pt-4" id="step-7">
            <div class="cm-step-action-card bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
              <h3 class="font-bold text-navy-800 mb-4">Who can see this?</h3>
              <div class="space-y-3">
                <label class="flex items-center justify-between p-3 border border-navy-200 rounded-xl bg-navy-50 cursor-pointer">
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-sm text-navy-500">🌍</div>
                    <div>
                      <p class="text-sm font-bold text-navy-800">All Friends</p>
                      <p class="text-[10px] text-gray-500">Anyone in the class can see this</p>
                    </div>
                  </div>
                  <input type="radio" name="privacy" value="all" class="w-5 h-5 text-navy-600" checked/>
                </label>

                <label class="flex items-center justify-between p-3 border border-gray-100 rounded-xl bg-white cursor-pointer hover:bg-cream-50">
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-cream-100 flex items-center justify-center text-orange-500">⭐</div>
                    <div>
                      <p class="text-sm font-bold text-navy-800">Close Friends</p>
                      <p class="text-[10px] text-gray-500">Only your designated close circle</p>
                    </div>
                  </div>
                  <input type="radio" name="privacy" value="close_friends" class="w-5 h-5 text-navy-600"/>
                </label>

                <label class="flex items-center justify-between p-3 border border-gray-100 rounded-xl bg-white cursor-pointer hover:bg-cream-50">
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-600">🔒</div>
                    <div>
                      <p class="text-sm font-bold text-navy-800">Only Me</p>
                      <p class="text-[10px] text-gray-500">Keep this memory private</p>
                    </div>
                  </div>
                  <input type="radio" name="privacy" value="private" class="w-5 h-5 text-navy-600"/>
                </label>
              </div>
            </div>
          </div>

        </div>

        <!-- STICKY BOTTOM BUTTON -->
        <div class="fixed bottom-4 left-1/2 -translate-x-1/2 w-full max-w-md px-4 z-50 safe-area-bottom">
          <button type="button" id="wizard-next-btn" class="w-full bg-navy-600 text-white font-bold py-4 rounded-xl shadow-[0_8px_30px_rgba(30,58,95,0.2)] hover:bg-navy-700 transition-colors disabled:opacity-50">
            Next
          </button>
        </div>
        <div class="h-24"></div> <!-- Spacer -->

      </form>

      <!-- FULL SCREEN LOADING OVERLAY -->
      <div class="upload-fullscreen-overlay" id="upload-overlay">
        <!-- Particles will be injected here -->
        <div class="upload-card-glass">
          <div class="upload-progress-circle">
            <svg viewBox="0 0 100 100">
              <circle class="upload-progress-bg" cx="50" cy="50" r="45"></circle>
              <circle class="upload-progress-bar" cx="50" cy="50" r="45" id="progress-circle-bar"></circle>
            </svg>
            <div class="upload-percentage" id="upload-percentage">0%</div>
            <div class="upload-success-icon">
              <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
            </div>
          </div>
          <h3 class="font-bold text-xl text-navy-800 mb-1" id="upload-status-title">Uploading Memory</h3>
          <p class="text-sm text-gray-500 font-medium" id="upload-status-desc">Preserving the magic...</p>
        </div>
      </div>

    </section>
  `;

  // UI Elements
  const track = container.querySelector('#wizard-track');
  const steps = container.querySelectorAll('.cm-wizard-step');
  const dots = container.querySelectorAll('.cm-wizard-dot');
  const titleEl = container.querySelector('#wizard-title');
  const stepNumEl = container.querySelector('#wizard-step-num');
  const nextBtn = container.querySelector('#wizard-next-btn');
  const backBtn = container.querySelector('#wizard-back-btn');

  let currentStep = 0;
  const totalSteps = steps.length;
  const stepTitles = [
    'Select Media', 'Caption', 'Tag Friends', 'Mentions', 'Location', 'Background Music', 'Privacy'
  ];

  // State
  let selectedMediaFiles = [];
  let selectedMusicFile = null;

  // INITIAL SETUP
  updateStepUI();

  // NAVIGATION
  function updateStepUI() {
    track.style.transform = `translateX(-${currentStep * 100}%)`;
    steps.forEach((el, i) => {
      if (i === currentStep) el.classList.add('active');
      else el.classList.remove('active');
    });
    dots.forEach((dot, i) => {
      dot.classList.toggle('active', i <= currentStep);
    });
    titleEl.textContent = stepTitles[currentStep];
    stepNumEl.textContent = currentStep + 1;

    // Validate current step
    validateStep();

    if (currentStep === totalSteps - 1) {
      nextBtn.textContent = 'Share Memory ✨';
      nextBtn.classList.remove('bg-navy-600');
      nextBtn.classList.add('bg-gradient-to-r', 'from-[#D4AF37]', 'to-[#B8860B]');
    } else {
      nextBtn.textContent = 'Next';
      nextBtn.classList.remove('bg-gradient-to-r', 'from-[#D4AF37]', 'to-[#B8860B]');
      nextBtn.classList.add('bg-navy-600');
    }
  }

  function validateStep() {
    if (currentStep === 0) {
      nextBtn.disabled = selectedMediaFiles.length === 0;
    } else {
      nextBtn.disabled = false;
    }
  }

  nextBtn.addEventListener('click', async () => {
    if (currentStep < totalSteps - 1) {
      currentStep++;
      updateStepUI();
      if (navigator.vibrate) navigator.vibrate(10);
    } else {
      await handlePostSubmission();
    }
  });

  backBtn.addEventListener('click', () => {
    if (currentStep > 0) {
      currentStep--;
      updateStepUI();
      if (navigator.vibrate) navigator.vibrate(10);
    } else {
      router.navigateBack();
    }
  });

  // STEP 1: MEDIA UPLOAD
  const mediaDropzone = container.querySelector('#media-dropzone');
  const mediaInput = container.querySelector('#media-input');
  const mediaPreviewContainer = container.querySelector('#media-preview-container');
  const mediaGallery = container.querySelector('#media-gallery');
  const mediaGalleryDots = container.querySelector('#media-gallery-dots');
  const mediaCountLabel = container.querySelector('#media-count');

  mediaDropzone.addEventListener('click', () => mediaInput.click());
  mediaInput.addEventListener('change', (e) => handleMediaSelection(e.target.files));

  function handleMediaSelection(files) {
    if (!files.length) return;
    const newFiles = [...files].filter(f => f.type.startsWith('image') || f.type.startsWith('video'));
    selectedMediaFiles = [...selectedMediaFiles, ...newFiles];
    mediaInput.value = '';
    renderMediaPreview();
    validateStep();
  }

  function renderMediaPreview() {
    if (selectedMediaFiles.length === 0) {
      mediaDropzone.classList.remove('hidden');
      mediaPreviewContainer.classList.add('hidden');
      return;
    }
    mediaDropzone.classList.add('hidden');
    mediaPreviewContainer.classList.remove('hidden');
    mediaCountLabel.textContent = selectedMediaFiles.length;

    mediaGallery.innerHTML = selectedMediaFiles.map((f, i) => {
      const url = URL.createObjectURL(f);
      return `
        <div class="swipeable-item w-full h-full relative flex-shrink-0">
          ${f.type.startsWith('video') 
            ? `<video src="${url}" class="absolute inset-0 w-full h-full object-cover" preload="metadata"></video>`
            : `<img src="${url}" class="absolute inset-0 w-full h-full object-cover"/>`}
          <button type="button" class="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-red-500 transition-colors z-10 remove-media-btn" data-idx="${i}">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      `;
    }).join('');

    mediaGalleryDots.innerHTML = selectedMediaFiles.map((_, i) => `
      <div class="gallery-dot ${i === 0 ? 'active' : ''}"></div>
    `).join('');

    // Handle dot scroll sync
    const items = mediaGallery.querySelectorAll('.swipeable-item');
    const dotsEls = mediaGalleryDots.querySelectorAll('.gallery-dot');
    mediaGallery.addEventListener('scroll', () => {
      const scrollPos = mediaGallery.scrollLeft;
      const itemWidth = mediaGallery.clientWidth;
      const activeIdx = Math.round(scrollPos / itemWidth);
      dotsEls.forEach((d, i) => d.classList.toggle('active', i === activeIdx));
    });

    mediaGallery.querySelectorAll('.remove-media-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.dataset.idx);
        selectedMediaFiles.splice(idx, 1);
        renderMediaPreview();
        validateStep();
      });
    });
  }

  // STEP 2: CAPTION
  const captionInput = container.querySelector('#caption-input');
  const captionCount = container.querySelector('#caption-char-count');
  captionInput.addEventListener('input', () => {
    captionCount.textContent = captionInput.value.length;
    captionInput.style.height = 'auto';
    captionInput.style.height = Math.min(captionInput.scrollHeight, 200) + 'px';
  });
  container.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      captionInput.value += btn.dataset.emoji;
      captionInput.dispatchEvent(new Event('input'));
    });
  });

  // STEP 3: TAG FRIENDS
  const tagSearch = container.querySelector('#tag-search');
  const tagList = container.querySelector('#tag-list');
  const taggedPreview = container.querySelector('#tagged-preview');

  tagSearch.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    tagList.querySelectorAll('.user-tag-item').forEach(el => {
      const name = el.dataset.name.toLowerCase();
      el.style.display = name.includes(q) ? '' : 'none';
    });
  });
  tagList.addEventListener('change', () => {
    const checked = Array.from(tagList.querySelectorAll('.tag-checkbox:checked')).map(cb => {
      const item = cb.closest('.user-tag-item');
      return { id: cb.value, name: item.dataset.name };
    });
    taggedPreview.innerHTML = checked.map(c => `
      <span class="px-2 py-1 rounded-md bg-navy-100 text-navy-800 text-xs font-semibold">@${c.name}</span>
    `).join('');
  });

  // STEP 4: MENTIONS
  const mentionSearch = container.querySelector('#mention-search');
  const mentionList = container.querySelector('#mention-list');
  const mentionedPreview = container.querySelector('#mentioned-preview');

  mentionSearch.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    mentionList.querySelectorAll('.user-mention-item').forEach(el => {
      const name = el.dataset.name.toLowerCase();
      el.style.display = name.includes(q) ? '' : 'none';
    });
  });
  mentionList.addEventListener('change', () => {
    const checked = Array.from(mentionList.querySelectorAll('.mention-checkbox:checked')).map(cb => {
      const item = cb.closest('.user-mention-item');
      return { id: cb.value, name: item.dataset.name };
    });
    mentionedPreview.innerHTML = checked.map(c => `
      <span class="px-2 py-1 rounded-md bg-blue-100 text-blue-800 text-xs font-semibold">@${c.name}</span>
    `).join('');
  });

  // STEP 5: LOCATION
  const locInput = container.querySelector('#location-input');
  container.querySelectorAll('.loc-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      locInput.value = chip.dataset.loc;
      container.querySelectorAll('.loc-chip').forEach(c => c.classList.replace('bg-navy-50', 'bg-white'));
      chip.classList.replace('bg-white', 'bg-navy-50');
    });
  });

  // STEP 6: MUSIC
  const musicInput = container.querySelector('#music-input');
  const musicUploadBtn = container.querySelector('#music-upload-btn');
  const musicPreview = container.querySelector('#music-preview');
  const musicFilename = container.querySelector('#music-filename');
  const musicPlayBtn = container.querySelector('#music-play-btn');
  const musicRemoveBtn = container.querySelector('#music-remove-btn');
  const audioEl = container.querySelector('#audio-preview-element');

  musicUploadBtn.addEventListener('click', () => musicInput.click());
  musicInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      selectedMusicFile = file;
      musicFilename.textContent = file.name;
      audioEl.src = URL.createObjectURL(file);
      musicUploadBtn.classList.add('hidden');
      musicPreview.classList.remove('hidden');
      musicPreview.classList.add('flex');
    }
  });
  musicRemoveBtn.addEventListener('click', () => {
    selectedMusicFile = null;
    audioEl.pause();
    audioEl.src = '';
    musicInput.value = '';
    musicPreview.classList.add('hidden');
    musicPreview.classList.remove('flex');
    musicUploadBtn.classList.remove('hidden');
  });
  musicPlayBtn.addEventListener('click', () => {
    if (audioEl.paused) {
      audioEl.play();
      musicPlayBtn.innerHTML = '<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
    } else {
      audioEl.pause();
      musicPlayBtn.innerHTML = '<svg class="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
    }
  });

  // STEP 7: PRIVACY
  const privacyInputs = container.querySelectorAll('input[name="privacy"]');
  privacyInputs.forEach(input => {
    input.addEventListener('change', (e) => {
      container.querySelectorAll('input[name="privacy"]').forEach(inp => {
        const label = inp.closest('label');
        if (inp.checked) {
          label.classList.replace('border-gray-100', 'border-navy-200');
          label.classList.replace('bg-white', 'bg-navy-50');
        } else {
          label.classList.replace('border-navy-200', 'border-gray-100');
          label.classList.replace('bg-navy-50', 'bg-white');
        }
      });
    });
  });

  // SUBMIT HANDLER
  async function handlePostSubmission() {
    if (!authManager.currentUser || selectedMediaFiles.length === 0) return;

    const privacy = container.querySelector('input[name="privacy"]:checked').value;
    if (privacy === 'close_friends' && (!authManager.userData?.closeFriends || authManager.userData.closeFriends.length === 0)) {
      showToast('Please add Close Friends in your profile first!', 'error');
      return;
    }

    const overlay = container.querySelector('#upload-overlay');
    const circleBar = container.querySelector('#progress-circle-bar');
    const pctLabel = container.querySelector('#upload-percentage');
    const titleStatus = container.querySelector('#upload-status-title');
    const descStatus = container.querySelector('#upload-status-desc');

    overlay.classList.add('active');
    nextBtn.disabled = true;

    // Add particle effects
    for (let i = 0; i < 20; i++) {
      const p = document.createElement('div');
      p.className = 'upload-particle';
      const size = Math.random() * 8 + 4;
      p.style.width = size + 'px';
      p.style.height = size + 'px';
      p.style.left = (Math.random() * 100) + 'vw';
      p.style.top = (Math.random() * 100 + 100) + 'vh';
      p.style.animationDelay = (Math.random() * 1) + 's';
      overlay.appendChild(p);
    }

    try {
      const uid = authManager.currentUser.uid;
      const totalFiles = selectedMediaFiles.length + (selectedMusicFile ? 1 : 0);
      let uploadedCount = 0;
      
      const updateProgress = () => {
        // Simplified progress tracking based on completed files for multi-upload
        const pct = Math.round((uploadedCount / totalFiles) * 100);
        pctLabel.textContent = pct + '%';
        const offset = 314 - (pct / 100) * 314;
        circleBar.style.strokeDashoffset = offset;
      };

      // Upload Media Files
      const mediaUrls = [];
      const mediaTypes = [];
      const cloudinaryPublicIds = [];
      
      for (const file of selectedMediaFiles) {
        let processedFile = file;
        if (file.type.startsWith('image')) {
          processedFile = await compressImage(file);
        }
        
        const type = file.type.startsWith('video') ? 'video' : 'image';
        const { url, publicId } = await uploadMedia(processedFile, type);
        
        mediaUrls.push(url);
        mediaTypes.push(type);
        cloudinaryPublicIds.push(publicId);
        
        uploadedCount++;
        updateProgress();
      }

      // Upload Music if present
      let musicUrl = null;
      let musicPublicId = null;
      if (selectedMusicFile) {
        titleStatus.textContent = 'Uploading Soundtrack';
        const res = await uploadMedia(selectedMusicFile, 'raw');
        musicUrl = res.url;
        musicPublicId = res.publicId;
        
        uploadedCount++;
        updateProgress();
      }

      titleStatus.textContent = 'Finalizing...';
      
      // Gather Data
      const caption = captionInput.value;
      const location = locInput.value;
      
      const pendingTags = Array.from(tagList.querySelectorAll('.tag-checkbox:checked')).map(cb => cb.value);
      const mentions = Array.from(mentionList.querySelectorAll('.mention-checkbox:checked')).map(cb => {
        const item = cb.closest('.user-mention-item');
        return { id: cb.value, name: item.dataset.name };
      });

      // Construct payload
      const postData = {
        authorId: uid,
        authorName: authManager.userData?.fullName || 'Unknown',
        authorPhoto: authManager.userData?.profilePic || '',
        caption,
        location,
        privacy,
        closeFriends: privacy === 'close_friends' ? (authManager.userData?.closeFriends || []) : [],
        imageUrls: mediaUrls, // New array for multiple media
        mediaTypes, // Corresponds to imageUrls index
        cloudinaryPublicIds, // Array of Cloudinary Public IDs for images/videos
        musicUrl,
        musicPublicId, // Cloudinary Public ID for music
        pendingTags, // Await acceptance
        taggedFriends: [], // Accepted tags go here
        mentions, // Instant mentions
        likes: [],
        commentCount: 0,
        createdAt: Timestamp.now()
      };

      // Add single `imageUrl` and `mediaType` for backwards compatibility with parts of the app not updated yet
      if (mediaUrls.length > 0) {
        postData.imageUrl = mediaUrls[0];
        postData.mediaType = mediaTypes[0];
      }

      const docRef = await addDoc(collection(db, 'posts'), postData);

      // Send Mention Notifications
      for (const m of mentions) {
        if (m.id !== uid) {
          createNotification('comment', m.id, { postId: docRef.id, commentText: 'mentioned you in a post!' });
        }
      }

      // Send Tag Request Notifications
      for (const tagUid of pendingTags) {
        if (tagUid !== uid) {
          createNotification('tag_request', tagUid, { postId: docRef.id });
        }
      }

      await awardPoints(uid, 20, 'Memory Created');

      // Success state
      overlay.classList.add('upload-success');
      titleStatus.textContent = 'Memory Shared!';
      descStatus.textContent = 'Taking you home...';

      setTimeout(() => {
        overlay.classList.remove('active');
        router.navigate('home');
      }, 2500);

    } catch (err) {
      console.error('Upload Error:', err);
      showToast('Failed to upload memory. Please try again.', 'error');
      overlay.classList.remove('active');
      nextBtn.disabled = false;
    }
  }

}
