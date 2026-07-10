import { db, collection, addDoc, updateDoc, doc, getDoc, onSnapshot, query, where, orderBy, deleteDoc, serverTimestamp, setDoc, increment, deleteField } from '../firebase-config.js';
import { authManager } from '../auth.js';
import { showToast, sanitizeHTML, timeAgo } from '../utils.js';
import { router } from '../router.js';
import { userCache } from '../services/userCache.js';

const globalCommentsCache = {};
let draftInterval = null;
let currentStoryId = null;

const THEMES = [
  { id: 'theme-school-notebook', name: 'School Notebook', icon: '📒' },
  { id: 'theme-old-diary', name: 'Old Diary', icon: '📓' },
  { id: 'theme-vintage-journal', name: 'Vintage Journal', icon: '📕' },
  { id: 'theme-blue-class-note', name: 'Blue Class Note', icon: '📘' },
  { id: 'theme-brown-leather', name: 'Brown Leather Diary', icon: '📔' }
];

export function openStoryEditor(existingStory = null) {
  const modal = router.openModal({
    id: 'story-editor-modal',
    fullScreen: true,
    onClose: () => {
      if (draftInterval) clearInterval(draftInterval);
      draftInterval = null;
    }
  });

  const isEdit = !!existingStory;
  currentStoryId = existingStory?.id || null;
  let currentTheme = existingStory?.theme || THEMES[0].id;
  let currentMood = existingStory?.mood || '😊 Happy';
  let isDraft = existingStory ? (existingStory.status === 'draft') : true;
  
  let currentVisibility = existingStory?.visibility || 'allFriends';
  // Handle legacy
  if (currentVisibility === 'public' || currentVisibility === 'friends') currentVisibility = 'allFriends';
  if (currentVisibility === 'close_friends') currentVisibility = 'closeFriends';
  
  let selectedFriends = existingStory?.selectedFriends || [];

  modal.body.innerHTML = `
    <div class="h-full bg-cream-100 overflow-y-auto pb-24">
      <div class="sticky top-0 bg-white/95 backdrop-blur z-50 px-4 py-3 border-b flex items-center justify-between shadow-sm">
        <button id="sb-close-editor" class="text-navy-500 font-bold p-2">✕ Cancel</button>
        <span id="sb-save-status" class="text-xs text-gray-400 opacity-0 transition-opacity">Draft Saved ✓</span>
        <button id="sb-publish-btn" class="px-5 py-2 bg-navy-600 text-white rounded-full text-sm font-bold shadow-lg shadow-navy-200">
          ${isEdit && !isDraft ? 'Update Story' : 'Publish'}
        </button>
      </div>

      <div class="max-w-2xl mx-auto p-4 space-y-6 animate-slide-up-fade">
        
        <!-- Story Metadata Settings -->
        <div class="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-4">
          <input type="text" id="sb-title" placeholder="Give your story a title..." value="${sanitizeHTML(existingStory?.title || '')}" class="w-full text-2xl font-bold border-none outline-none text-navy-800 placeholder-gray-300 bg-transparent" />
          
          <div class="flex flex-col gap-2 w-full mb-3">
            <div class="flex gap-2 overflow-x-auto pb-2 no-scrollbar" id="sb-visibility-container">
              <button data-val="allFriends" class="vis-chip whitespace-nowrap px-4 py-2 rounded-full text-sm font-bold border transition-all ${currentVisibility === 'allFriends' ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-200' : 'bg-gray-50 text-navy-700 border-gray-200 hover:bg-gray-100'}">🌍 All Friends</button>
              <button data-val="closeFriends" class="vis-chip whitespace-nowrap px-4 py-2 rounded-full text-sm font-bold border transition-all ${currentVisibility === 'closeFriends' ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-200' : 'bg-gray-50 text-navy-700 border-gray-200 hover:bg-gray-100'}">⭐ Close Friends</button>
              <button data-val="private" class="vis-chip whitespace-nowrap px-4 py-2 rounded-full text-sm font-bold border transition-all ${currentVisibility === 'private' ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-200' : 'bg-gray-50 text-navy-700 border-gray-200 hover:bg-gray-100'}">🔒 Private</button>
            </div>
            <div id="sb-close-friends-info" class="text-xs text-indigo-600 font-bold flex items-center gap-2 px-2 ${currentVisibility === 'closeFriends' ? '' : 'hidden'}">
              <span id="sb-cf-count">⭐ ${selectedFriends.length} Selected</span>
              <button id="sb-edit-cf" class="underline hover:text-indigo-800">Edit Selected Friends</button>
            </div>
          </div>
          <div class="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
            <select id="sb-mood" class="bg-gray-50 border-none rounded-lg text-sm px-3 py-2 text-navy-700 outline-none">
              <option value="😊 Happy" ${currentMood === '😊 Happy' ? 'selected' : ''}>😊 Happy</option>
              <option value="🥹 Nostalgic" ${currentMood === '🥹 Nostalgic' ? 'selected' : ''}>🥹 Nostalgic</option>
              <option value="😂 Funny" ${currentMood === '😂 Funny' ? 'selected' : ''}>😂 Funny</option>
              <option value="😢 Sad" ${currentMood === '😢 Sad' ? 'selected' : ''}>😢 Sad</option>
              <option value="🔥 Excited" ${currentMood === '🔥 Excited' ? 'selected' : ''}>🔥 Excited</option>
              <option value="💭 Reflective" ${currentMood === '💭 Reflective' ? 'selected' : ''}>💭 Reflective</option>
            </select>
            
            <select id="sb-theme-selector" class="bg-gray-50 border-none rounded-lg text-sm px-3 py-2 text-navy-700 outline-none">
              ${THEMES.map(t => `<option value="${t.id}" ${currentTheme === t.id ? 'selected' : ''}>${t.icon} ${t.name}</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- The Notebook Editor -->
        <div id="notebook-preview" class="notebook-container ${currentTheme} transition-colors duration-500">
          <textarea id="sb-content" class="story-textarea" placeholder="Start writing your story here...">${sanitizeHTML(existingStory?.content || '')}</textarea>
        </div>
      </div>
    </div>
  `;

  // UI elements
  const titleEl = modal.body.querySelector('#sb-title');
  const contentEl = modal.body.querySelector('#sb-content');
  const moodEl = modal.body.querySelector('#sb-mood');
  const themeEl = modal.body.querySelector('#sb-theme-selector');
  const notebookPreview = modal.body.querySelector('#notebook-preview');
  const saveStatus = modal.body.querySelector('#sb-save-status');

  const visibilityContainer = modal.body.querySelector('#sb-visibility-container');
  const cfInfo = modal.body.querySelector('#sb-close-friends-info');
  const cfCount = modal.body.querySelector('#sb-cf-count');
  const editCfBtn = modal.body.querySelector('#sb-edit-cf');

  const updateVisUI = () => {
    visibilityContainer.querySelectorAll('.vis-chip').forEach(chip => {
      if (chip.dataset.val === currentVisibility) {
        chip.className = 'vis-chip whitespace-nowrap px-4 py-2 rounded-full text-sm font-bold border transition-all bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-200';
      } else {
        chip.className = 'vis-chip whitespace-nowrap px-4 py-2 rounded-full text-sm font-bold border transition-all bg-gray-50 text-navy-700 border-gray-200 hover:bg-gray-100';
      }
    });
    
    if (currentVisibility === 'closeFriends') {
      cfInfo.classList.remove('hidden');
      cfCount.textContent = `⭐ ${selectedFriends.length} Selected`;
    } else {
      cfInfo.classList.add('hidden');
    }
  };
  updateVisUI();

  visibilityContainer.addEventListener('click', (e) => {
    const chip = e.target.closest('.vis-chip');
    if (!chip) return;
    const newVal = chip.dataset.val;
    if (newVal === 'closeFriends' && currentVisibility !== 'closeFriends') {
      openCloseFriendsSelector(selectedFriends, (newSelection) => {
        if (newSelection) {
          selectedFriends = newSelection;
          currentVisibility = 'closeFriends';
          updateVisUI();
          triggerSave(false);
        }
      });
    } else {
      currentVisibility = newVal;
      updateVisUI();
      triggerSave(false);
    }
  });

  editCfBtn.addEventListener('click', () => {
    openCloseFriendsSelector(selectedFriends, (newSelection) => {
      if (newSelection) {
        selectedFriends = newSelection;
        updateVisUI();
        triggerSave(false);
      }
    });
  });

  themeEl.addEventListener('change', (e) => {
    currentTheme = e.target.value;
    notebookPreview.className = `notebook-container ${currentTheme} transition-colors duration-500`;
  });

  modal.body.querySelector('#sb-close-editor').addEventListener('click', () => {
    modal.close();
  });

  // Auto-save logic for Drafts
  const triggerSave = async (isPublish = false) => {
    const title = titleEl.value.trim();
    const content = contentEl.value.trim();
    
    if (isPublish && (!title || !content)) {
      showToast('Title and content are required to publish.', 'error');
      return false;
    }

    if (!title && !content) return false;
    
    if (existingStory?.status === 'published' && !isPublish) {
      return false; // Skip draft autosave completely for published stories
    }

    const data = {
      title: title || 'Untitled Draft',
      content,
      visibility: currentVisibility,
      selectedFriends: currentVisibility === 'closeFriends' ? selectedFriends : [],
      mood: moodEl.value,
      theme: currentTheme,
      authorId: authManager.currentUser.uid,
      authorName: authManager.userData.fullName,
      updatedAt: serverTimestamp(),
      status: isPublish ? 'published' : 'draft',
      wordCount: content.split(/\s+/).filter(Boolean).length
    };
    
    if (isPublish) {
      data.publishedAt = serverTimestamp();
      if (existingStory) existingStory.status = 'published';
      else existingStory = { status: 'published' };
    }

    try {
      const savePromise = async () => {
        let storyRef;
        if (!currentStoryId) {
          data.createdAt = serverTimestamp();
          data.likesCount = 0;
          data.commentsCount = 0;
          data.viewsCount = 0;
          storyRef = doc(collection(db, 'stories'));
          currentStoryId = storyRef.id;
        } else {
          storyRef = doc(db, 'stories', currentStoryId);
        }

        if (isPublish) {
          await setDoc(storyRef, data, { merge: true });
          deleteDoc(doc(db, 'drafts', currentStoryId)).catch(() => {}); // Fire and forget
        } else {
          await setDoc(storyRef, data, { merge: true });
        }
      };

      await savePromise();
      
      if (!isPublish) {
        saveStatus.style.opacity = '1';
        setTimeout(() => saveStatus.style.opacity = '0', 2000);
      }
      return true;
    } catch (e) {
      console.error("Auto-save failed", e);
      if (e.message === 'Operation timed out') showToast('Something went wrong. Please try again.', 'error');
      return false;
    }
  };

  // Auto save every 10 seconds if typing
  contentEl.addEventListener('input', () => {
    if (!draftInterval) {
      draftInterval = setInterval(() => triggerSave(false), 10000);
    }
  });

  modal.body.querySelector('#sb-publish-btn').addEventListener('click', () => {
    const title = titleEl.value.trim();
    const content = contentEl.value.trim();
    if (!title || !content) {
      showToast('Title and content are required to publish.', 'error');
      return;
    }

    // Capture all values before closing modal
    const mood = moodEl.value;
    const theme = currentTheme;
    const vis = currentVisibility;
    const friends = vis === 'closeFriends' ? [...selectedFriends] : [];
    const uid = authManager.currentUser.uid;
    const authorName = authManager.userData.fullName;
    const storyId = currentStoryId;
    const isNew = !storyId;

    // Close modal instantly & show optimistic toast
    modal.close();
    showToast('Story published successfully! 🎉', 'success');

    // Background Firestore save (fire-and-forget)
    (async () => {
      try {
        const publishData = {
          title, content, visibility: vis, selectedFriends: friends,
          mood, theme, authorId: uid, authorName,
          updatedAt: serverTimestamp(), status: 'published',
          publishedAt: serverTimestamp(),
          wordCount: content.split(/\s+/).filter(Boolean).length
        };

        let storyRef;
        if (isNew) {
          publishData.createdAt = serverTimestamp();
          publishData.likesCount = 0;
          publishData.commentsCount = 0;
          publishData.viewsCount = 0;
          storyRef = doc(collection(db, 'stories'));
          currentStoryId = storyRef.id;
        } else {
          storyRef = doc(db, 'stories', storyId);
        }

        await setDoc(storyRef, publishData, { merge: true });
        deleteDoc(doc(db, 'drafts', currentStoryId)).catch(() => {});
      } catch (e) {
        console.error('Publish failed:', e);
        showToast('Publish may have failed. Please check.', 'error');
      }
    })();
  });
}

// ------------------------------------------------------------------
// READER UI
// ------------------------------------------------------------------
export async function openStoryReader(story) {
  const modal = router.openModal({
    id: 'story-reader-modal',
    fullScreen: true
  });

  const isOwner = story.authorId === authManager.currentUser.uid;
  const wordCount = story.content.split(/\\s+/).filter(Boolean).length;
  const readTime = Math.max(1, Math.ceil(wordCount / 200));

  modal.body.innerHTML = `
    <div class="h-full bg-cream-50 overflow-y-auto">
      <div class="sticky top-0 bg-white/90 backdrop-blur z-50 px-4 py-3 border-b flex items-center justify-between">
        <button id="sr-close" class="text-navy-500 font-bold p-2">✕ Close</button>
        <span class="text-xs font-semibold text-gray-500">${readTime} min read</span>
        ${isOwner ? `
          <div class="flex items-center gap-2">
            <button id="sr-views-counter" class="text-[11px] font-bold text-indigo-700 bg-indigo-50 px-3 py-1 rounded-full hover:bg-indigo-100 transition-colors shadow-sm cursor-pointer hidden">
              👀 <span id="sr-views-count">0</span> Views
            </button>
            <div class="relative group">
              <button class="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z"/></svg>
              </button>
              <div class="absolute right-0 mt-1 w-36 bg-white rounded-xl shadow-xl border border-gray-100 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 overflow-hidden transform origin-top-right scale-95 group-hover:scale-100">

                <button id="sr-edit" class="w-full text-left px-4 py-2.5 text-sm font-semibold text-navy-700 hover:bg-gray-50 flex items-center gap-2">
                  <svg class="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"/></svg>
                  Edit
                </button>

                <button id="sr-delete" class="w-full text-left px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 flex items-center gap-2 border-t border-gray-50">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>
                  Delete
                </button>
              </div>
            </div>
          </div>
        ` : '<div></div>'}
      </div>

      <div class="max-w-2xl mx-auto p-4 md:p-8 animate-slide-up-fade">
        <div class="notebook-container ${story.theme} reader-page shadow-2xl">
          <h1 class="text-4xl font-bold mb-2">${sanitizeHTML(story.title)}</h1>
          <div class="flex items-center gap-2 mb-8 text-sm opacity-70 border-b pb-4 border-current">
            <span>${story.mood}</span>
            <span>•</span>
            <span class="font-bold">${sanitizeHTML(story.authorName)}</span>
            <span>•</span>
            <span>${story.createdAt?.toDate ? timeAgo(story.createdAt.toDate()) : 'Just now'}</span>
          </div>
          
          <div class="whitespace-pre-wrap leading-relaxed">${sanitizeHTML(story.content)}</div>
        </div>
        
        <!-- Social Interactions -->
        <div class="mt-8 bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
          <div class="flex items-center justify-between border-b pb-4 mb-4 flex-wrap gap-4">
            <h3 class="font-bold text-navy-800 text-lg">Reactions & Comments</h3>
            <div class="flex gap-2 items-center flex-wrap" id="reaction-bar">
              <!-- Rendered via onSnapshot -->
            </div>
          </div>
          
          <!-- Comments List -->
          <div id="story-comments" class="space-y-4 mb-4"></div>

          <!-- Add Comment -->
          <div class="flex flex-col relative bg-gray-50 rounded-xl overflow-hidden shadow-inner">
            <!-- Reply Preview Container -->
            <div id="sr-reply-preview" class="hidden mx-2 mt-2 p-2 bg-white rounded-lg border-l-4 border-indigo-500 shadow-sm relative text-xs flex-col items-start text-left">
              <div class="font-bold text-indigo-700 w-full pr-6 truncate" id="sr-reply-preview-name"></div>
              <div class="text-gray-600 w-full truncate opacity-80" id="sr-reply-preview-text"></div>
              <button id="sr-reply-preview-close" class="absolute top-1 right-1 p-1 text-gray-400 hover:text-gray-700 transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            
            <div class="flex gap-2 relative w-full p-1 items-center">
              <input type="text" id="sr-comment-input" class="flex-1 bg-transparent border-none px-3 py-2 text-sm outline-none focus:ring-0" placeholder="Add a comment..." />
              <button id="sr-comment-submit" class="px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold m-1">Post</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  modal.body.querySelector('#sr-close').addEventListener('click', () => modal.close());
  
  // View Tracking & UI
  let unsubViews = null;
  if (isOwner) {
    const viewsBtn = modal.body.querySelector('#sr-views-counter');
    const viewsCountSpan = modal.body.querySelector('#sr-views-count');
    
    // Listen for realtime views count
    const vQ = query(collection(db, `stories/${story.id}/views`), orderBy('openedAt', 'desc'));
    unsubViews = onSnapshot(vQ, (snap) => {
      if (viewsBtn && viewsCountSpan) {
        viewsCountSpan.innerText = snap.size;
        viewsBtn.classList.remove('hidden');
      }
    });

    const openViewsModal = () => openSeenStatusModal(story.id);
    if (viewsBtn) viewsBtn.addEventListener('click', openViewsModal);


    modal.body.querySelector('#sr-edit').addEventListener('click', () => {
      modal.close();
      openStoryEditor(story);
    });



    const delBtn = modal.body.querySelector('#sr-delete');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        const { showDeleteConfirmation } = await import('../delete-confirm.js');
        const cardEl = document.querySelector(`[data-story-id="${story.id}"]`);
        
        showDeleteConfirmation('this Story', async () => {
          const { getDocs } = await import('../firebase-config.js');
          
          let retryCount = 0;
          const maxRetries = 1;
          
          const executeDelete = async () => {
            // Delete Story First so it instantly removes from the DB and UI
            await deleteDoc(doc(db, 'stories', story.id));
            
            // Background cleanup of subcollections using Promise.allSettled
            // to ignore permission errors caused by firestore rules.
            const deletePromises = [];
            
            // Comments & Replies
            const commentsQ = query(collection(db, 'storyComments'), where('storyId', '==', story.id));
            const commentsSnap = await getDocs(commentsQ).catch(() => ({ docs: [] }));
            for (const cDoc of commentsSnap.docs) {
              const repliesQ = query(collection(db, `storyComments/${cDoc.id}/replies`));
              const repliesSnap = await getDocs(repliesQ).catch(() => ({ docs: [] }));
              for (const rDoc of repliesSnap.docs) {
                deletePromises.push(deleteDoc(doc(db, `storyComments/${cDoc.id}/replies`, rDoc.id)));
              }
              deletePromises.push(deleteDoc(cDoc.ref));
            }

            // Likes
            const likesQ = query(collection(db, 'storyLikes'), where('storyId', '==', story.id));
            const likesSnap = await getDocs(likesQ).catch(() => ({ docs: [] }));
            for (const lDoc of likesSnap.docs) {
              deletePromises.push(deleteDoc(lDoc.ref));
            }

            // Notifications
            const notifQ = query(collection(db, 'notifications'), where('storyId', '==', story.id));
            const notifSnap = await getDocs(notifQ).catch(() => ({ docs: [] }));
            for (const nDoc of notifSnap.docs) {
              deletePromises.push(deleteDoc(nDoc.ref));
            }

            const results = await Promise.allSettled(deletePromises);
            const errors = results.filter(r => r.status === 'rejected');
            if (errors.length > 0) {
              console.warn('[Cleanup] Some related documents could not be deleted due to permissions or rules:', errors);
            }
          };

          while (retryCount <= maxRetries) {
            try {
              await executeDelete();
              break; // Success
            } catch (error) {
              retryCount++;
              if (retryCount > maxRetries) {
                console.error('[Story Delete] Final failure:', error);
                throw error;
              }
              console.warn(`[Story Delete] Retrying... (${retryCount}/${maxRetries})`);
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
        }, { element: cardEl });
        
        modal.close();
      });
    }
  }

  // Record View (Analytics & Seen Status)
  if (!isOwner && story.id && authManager.currentUser) {
    // Fire-and-forget view tracking (no await blocking UI)
    (async () => {
      try {
        const viewRef = doc(db, 'storyViews', `${story.id}_${authManager.currentUser.uid}`);
        const vRef = doc(db, `stories/${story.id}/views`, authManager.currentUser.uid);

        // Run view check and detailed tracking in parallel
        const [viewSnap] = await Promise.all([
          getDoc(viewRef),
          setDoc(vRef, {
            userId: authManager.currentUser.uid,
            userName: authManager.userData?.fullName || authManager.currentUser.displayName || 'Unknown',
            photoURL: authManager.userData?.profilePic || authManager.currentUser.photoURL || '',
            openedAt: serverTimestamp()
          }, { merge: true })
        ]);

        if (!viewSnap.exists()) {
          await Promise.all([
            setDoc(viewRef, { viewedAt: serverTimestamp() }),
            updateDoc(doc(db, 'stories', story.id), { viewsCount: increment(1) })
          ]);
        }
      } catch (e) {}
    })();
  }

  // Reactions Logic (Real-Time)
  let unsubReactions = null;
  const loadReactions = () => {
    if (unsubReactions) unsubReactions();
    const reactionBar = modal.body.querySelector('#reaction-bar');
    const q = query(collection(db, `stories/${story.id}/reactions`));
    
    unsubReactions = onSnapshot(q, (snap) => {
      const reactions = [];
      snap.forEach(d => reactions.push(d.data()));
      
      const counts = {};
      let myReaction = null;
      reactions.forEach(r => {
        counts[r.emoji] = (counts[r.emoji] || 0) + 1;
        if (r.userId === authManager.currentUser.uid) myReaction = r.emoji;
      });
      
      const ALL_EMOJIS = ['❤️', '😂', '😮', '😢', '👏', '🔥'];
      
      let html = '';
      const isOwner = story.authorId === authManager.currentUser?.uid;
      
      ALL_EMOJIS.forEach(emoji => {
        const count = counts[emoji] || 0;
        const isSelected = myReaction === emoji;
        html += `
          <button class="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold transition-all reaction-btn ${isSelected ? 'bg-indigo-100 text-indigo-700 shadow-inner' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}" data-emoji="${emoji}">
            <span class="text-lg">${emoji}</span>
            ${count > 0 ? `<span class="reaction-count" data-emoji="${emoji}">${count}</span>` : ''}
          </button>
        `;
      });
      
      reactionBar.innerHTML = html;
      
      // Bind click listener for reacting
      reactionBar.querySelectorAll('.reaction-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          if (e.target.classList.contains('reaction-count')) {
            e.stopPropagation();
            openWhoReactedModal(reactions, e.target.dataset.emoji);
            return;
          }
          if (isOwner) {
            showToast("You cannot react to your own story.", 'error');
            return;
          }
          const emoji = btn.dataset.emoji;
          const ref = doc(db, `stories/${story.id}/reactions/${authManager.currentUser.uid}`);
          
          btn.classList.add('animate-bounce');
          setTimeout(() => btn.classList.remove('animate-bounce'), 1000);
          
          try {
            if (myReaction === emoji) {
              await Promise.all([
                deleteDoc(ref),
                updateDoc(doc(db, 'stories', story.id), { likesCount: increment(-1) })
              ]);
            } else {
              const isNew = !myReaction;
              const promises = [setDoc(ref, {
                userId: authManager.currentUser.uid,
                userName: authManager.userData?.fullName || authManager.currentUser?.displayName || 'Unknown',
                photoURL: authManager.userData?.profilePic || authManager.currentUser?.photoURL || '',
                emoji,
                createdAt: serverTimestamp()
              })];
              if (isNew) {
                promises.push(updateDoc(doc(db, 'stories', story.id), { likesCount: increment(1) }));
              }
              await Promise.all(promises);
            }
          } catch (err) {
            showToast('Error updating reaction', 'error');
            console.error(err);
          }
        });
      });
    });
  };
  loadReactions();

  // Comments Real-time
  let unsubComments = null;
  const commentReactionUnsubs = {};
  const commentReactionsCache = {};
  let replyingToCommentId = null;
  let replyingToUserId = null;
  let replyingToUserName = null;
  let replyingToText = null;
  
  const REACTION_EMOJIS = ['❤️', '😂', '😍', '😮', '😢', '👏', '🔥', '👍'];

  const updateCommentReactionsDOM = (commentId) => {
    const container = modal.body.querySelector(`#reactions-${commentId}`);
    if (!container) return;
    const reacts = commentReactionsCache[commentId] || [];
    
    const reactionCounts = {};
    let myReaction = null;
    reacts.forEach(r => {
      reactionCounts[r.emoji] = (reactionCounts[r.emoji] || 0) + 1;
      if (r.userId === authManager.currentUser?.uid) myReaction = r.emoji;
    });
    
    let html = '';
    if (Object.keys(reactionCounts).length > 0) {
      Object.entries(reactionCounts).forEach(([emoji, count]) => {
        html += `<button class="bg-white rounded-full shadow-sm border border-gray-100 px-1.5 py-0.5 text-[10px] font-bold flex items-center hover:bg-gray-50 transition-colors btn-view-reactions animate-emoji-pop" data-comment-id="${commentId}" data-emoji="${emoji}">${emoji} ${count}</button>`;
      });
    }
    container.innerHTML = html;
    
    const reactBtn = modal.body.querySelector(`#react-btn-${commentId}`);
    if (reactBtn) {
      reactBtn.innerHTML = myReaction ? `${myReaction} React` : '❤️ React';
      if (myReaction) reactBtn.classList.add('text-indigo-600', 'font-bold');
      else reactBtn.classList.remove('text-indigo-600', 'font-bold');
    }
  };

  let currentCommentsCache = [];

  const showContextMenu = (commentId, isCommentOwner, userName, x, y) => {
    document.querySelector('.context-menu-overlay')?.remove();
    
    const overlay = document.createElement('div');
    overlay.className = 'context-menu-overlay';
    
    const cData = currentCommentsCache.find(c => c.id === commentId);
    let canEditDelete = false;
    if (isCommentOwner && cData && cData.createdAt) {
      const createdTime = cData.createdAt.toMillis ? cData.createdAt.toMillis() : Date.now();
      canEditDelete = (Date.now() - createdTime) <= 3 * 60 * 1000; // 3 minutes
    }
    
    let html = `<div class="context-menu-box" style="position:absolute; top: ${y}px; left: ${x}px;">`;
    html += `<button class="context-menu-item ctx-reply">Reply</button>`;
    html += `<button class="context-menu-item ctx-copy">Copy</button>`;
    if (isCommentOwner) {
      if (canEditDelete) {
        html += `<button class="context-menu-item ctx-edit">Edit</button>`;
        html += `<button class="context-menu-item ctx-delete danger">Delete</button>`;
      }
    } else {
      html += `<button class="context-menu-item ctx-report danger">Report</button>`;
    }
    html += `</div>`;
    
    overlay.innerHTML = html;
    document.body.appendChild(overlay);

    const box = overlay.querySelector('.context-menu-box');
    const rect = box.getBoundingClientRect();
    if (rect.right > window.innerWidth) box.style.left = `${window.innerWidth - rect.width - 10}px`;
    if (rect.bottom > window.innerHeight) box.style.top = `${window.innerHeight - rect.height - 10}px`;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    overlay.querySelector('.ctx-reply')?.addEventListener('click', () => {
      overlay.remove();
      const cData = currentCommentsCache.find(c => c.id === commentId);
      if (!cData) return;
      
      replyingToCommentId = commentId;
      replyingToUserId = cData.userId;
      replyingToUserName = cData.userName || 'Unknown';
      replyingToText = cData.text || cData.comment || '';
      
      const preview = modal.body.querySelector('#sr-reply-preview');
      const previewName = modal.body.querySelector('#sr-reply-preview-name');
      const previewText = modal.body.querySelector('#sr-reply-preview-text');
      const commentInput = modal.body.querySelector('#sr-comment-input');
      
      if (preview && commentInput) {
        previewName.innerText = replyingToUserName;
        previewText.innerText = replyingToText;
        preview.classList.remove('hidden');
        preview.classList.add('flex');
        
        commentInput.placeholder = `Reply to ${replyingToUserName}...`;
        commentInput.focus();
      }
    });

    overlay.querySelector('.ctx-copy')?.addEventListener('click', () => {
      overlay.remove();
      const cData = currentCommentsCache.find(c => c.id === commentId);
      if (cData && (cData.text || cData.comment)) {
        navigator.clipboard.writeText(cData.text || cData.comment);
        showToast('Comment copied', 'success');
      }
    });

    overlay.querySelector('.ctx-edit')?.addEventListener('click', () => {
      overlay.remove();
      const container = modal.body.querySelector('#story-comments');
      const editContainer = container.querySelector(`#edit-${commentId}`);
      if (editContainer) {
        editContainer.classList.remove('hidden');
        editContainer.classList.add('flex');
        const cData = currentCommentsCache.find(c => c.id === commentId);
        const editInput = editContainer.querySelector('.edit-input');
        editInput.value = cData?.text || cData?.comment || '';
        editInput.focus();
      }
    });

    overlay.querySelector('.ctx-delete')?.addEventListener('click', async () => {
      overlay.remove();
      if (!confirm('Delete this comment?')) return;
      try {
        await deleteDoc(doc(db, `stories/${story.id}/comments`, commentId));
        await updateDoc(doc(db, 'stories', story.id), { commentsCount: increment(-1) });
      } catch(e) { showToast('Failed to delete', 'error'); }
    });

    overlay.querySelector('.ctx-report')?.addEventListener('click', () => {
      overlay.remove();
      showToast('Comment reported', 'success');
    });
  };

  const loadComments = () => {
    if (unsubComments) unsubComments();
    
    const container = modal.body.querySelector('#story-comments');
    
    let isLoaded = false;
    setTimeout(() => {
      if (!isLoaded && container.innerHTML === '') {
        container.innerHTML = '<div class="text-center text-sm text-gray-400 p-4">Loading comments...</div>';
      }
    }, 300);

    const renderSnapshot = (comments) => {
      isLoaded = true;
      if (comments.length === 0) {
        container.innerHTML = '<div class="text-center text-sm text-gray-400 p-4">No comments yet.<br>Be the first to comment.</div>';
        return;
      }
      currentCommentsCache = comments;
      
      const topLevelComments = comments.filter(c => !c.parentCommentId);
      const repliesMap = {};
      comments.filter(c => c.parentCommentId).forEach(c => {
        if (!repliesMap[c.parentCommentId]) repliesMap[c.parentCommentId] = [];
        repliesMap[c.parentCommentId].push(c);
      });
      
      const renderComment = (c, depth = 0) => {
        const u = userCache.getUser(c.userId);
        const isCommentOwner = c.userId === authManager.currentUser?.uid;
        const isStoryOwner = story.authorId === c.userId;
        const isMeStoryOwner = story.authorId === authManager.currentUser?.uid;
        
        const isReply = depth > 0;
        const avatarHtml = u?.photoURL || c.photoURL || c.userPhoto 
          ? `<img src="${u?.photoURL || c.photoURL || c.userPhoto}" class="${isReply ? 'w-6 h-6' : 'w-8 h-8'} rounded-full object-cover flex-shrink-0"/>` 
          : `<div class="${isReply ? 'w-6 h-6 text-[10px]' : 'w-8 h-8 text-xs'} rounded-full bg-indigo-100 flex items-center justify-center font-bold text-indigo-700 flex-shrink-0">${c.userName?.[0] || '?'}</div>`;

        const bubbleClass = isCommentOwner 
          ? 'bg-gradient-to-br from-indigo-600 to-purple-600 text-white rounded-[22px] rounded-tr-[4px] shadow-sm' 
          : 'bg-white border border-gray-100 shadow-sm text-navy-800 rounded-[22px] rounded-tl-[4px]';

        const nameClass = isCommentOwner ? 'hidden' : 'text-indigo-600';
        const editedClass = isCommentOwner ? 'text-indigo-200' : 'text-gray-400';
        
        let quoteHtml = '';
        if (c.parentCommentId && c.parentUserName) {
          const quoteBg = isCommentOwner ? 'bg-white/20 hover:bg-white/30 border-white text-indigo-50' : 'bg-gray-50 hover:bg-gray-100 border-indigo-500 text-navy-800';
          const quoteNameColor = isCommentOwner ? 'text-white' : 'text-indigo-700';
          quoteHtml = `
            <div class="cursor-pointer transition-colors border-l-4 rounded-lg p-2 mb-2 text-xs text-left w-full quote-block ${quoteBg}" data-target-id="${c.parentCommentId}">
              <div class="font-bold ${quoteNameColor}">${sanitizeHTML(c.parentUserName)}</div>
              <div class="truncate opacity-90">${sanitizeHTML(c.parentText || '')}</div>
            </div>
          `;
        }
        
        const animationClass = isCommentOwner ? 'animate-slide-right' : 'animate-slide-left';

        return `
        <div class="flex gap-3 comment-block group ${isCommentOwner ? 'flex-row-reverse' : ''} ${animationClass} mb-2" data-id="${c.id}" data-user-id="${c.userId}">
          ${avatarHtml}
          
          <div class="flex-1 min-w-0 flex flex-col ${isCommentOwner ? 'items-end' : 'items-start'} relative">
            <div class="${bubbleClass} p-1.5 inline-block max-w-[90%] sm:max-w-[75%] relative text-left transition-all comment-bubble" data-comment-id="${c.id}">
              ${quoteHtml}
              <div class="px-3 pb-1 pt-1">
                <span class="font-bold text-sm ${nameClass} mr-2 ${isCommentOwner ? 'hidden' : ''}">${sanitizeHTML(c.userName || 'Unknown')}</span>
                <span class="text-[15px] whitespace-pre-wrap break-words block mt-0.5 leading-snug">${sanitizeHTML(c.text || c.comment || '')}</span>
                ${c.edited ? `<span class="text-[10px] ${editedClass} italic block mt-1">(edited)</span>` : ''}
              </div>
              <div id="reactions-${c.id}" class="flex flex-wrap gap-1 mt-1 justify-end absolute -bottom-3 ${isCommentOwner ? '-left-2' : '-right-2'}"></div>
            </div>
            
            <div class="flex items-center gap-3 text-[11px] text-gray-400 mt-1 mx-2 font-medium">
              <span>${c.createdAt?.toDate ? timeAgo(c.createdAt.toDate()) : 'Just now'}</span>
              ${!c.createdAt ? '<span class="optimistic-clock">⏳</span>' : ''}
              
              <div class="relative flex items-center justify-center">
                <button type="button" id="react-btn-${c.id}" class="hover:text-navy-600 transition-colors btn-toggle-react flex items-center gap-1 font-semibold" data-comment-id="${c.id}">
                  ❤️ React
                </button>
                <div id="react-picker-${c.id}" class="absolute bottom-full mb-1 hidden bg-white shadow-lg rounded-full px-2 py-1 gap-1 border border-gray-100 z-10 animate-emoji-pop react-picker-menu">
                  ${REACTION_EMOJIS.map(e => `<button type="button" class="hover:scale-125 transition-transform text-sm btn-react" data-comment-id="${c.id}" data-emoji="${e}">${e}</button>`).join('')}
                </div>
              </div>
            </div>

            <!-- Edit Box -->
            <div class="mt-2 hidden flex-col gap-2 bg-gray-50 p-2 rounded-xl border border-gray-100 w-full edit-input-container" id="edit-${c.id}">
              <textarea class="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none resize-none edit-input" rows="2"></textarea>
              <div class="flex justify-end gap-2">
                <button type="button" class="px-3 py-1 bg-gray-200 text-gray-700 rounded-lg text-xs font-bold btn-cancel-edit" data-comment-id="${c.id}">Cancel</button>
                <button type="button" class="px-3 py-1 bg-indigo-600 text-white rounded-lg text-xs font-bold btn-save-edit" data-comment-id="${c.id}">Save</button>
              </div>
            </div>
          </div>
        </div>
        `;
      };
      
      const buildCommentTree = (parentId, depth = 0) => {
        let html = '';
        const children = parentId === null ? topLevelComments : (repliesMap[parentId] || []);
        if (children.length === 0) return html;
        
        let lastDateString = null;
        
        children.forEach(c => {
          if (parentId === null && c.createdAt) {
            const date = c.createdAt.toDate ? c.createdAt.toDate() : new Date();
            const dateString = date.toLocaleDateString();
            if (dateString !== lastDateString) {
              const today = new Date().toLocaleDateString();
              const yesterday = new Date(Date.now() - 86400000).toLocaleDateString();
              let displayDate = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
              if (dateString === today) displayDate = 'Today';
              else if (dateString === yesterday) displayDate = 'Yesterday';
              
              html += `<div class="flex justify-center my-4"><span class="bg-gray-100/80 text-gray-500 text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider">${displayDate}</span></div>`;
              lastDateString = dateString;
            }
          }
          
          html += renderComment(c, depth);
          const childRepliesHtml = buildCommentTree(c.id, depth + 1);
          if (childRepliesHtml) {
            html += `<div class="ml-${Math.min(depth * 4 + 6, 10)} mt-2 space-y-3 border-l-2 border-indigo-50/50 pl-3">${childRepliesHtml}</div>`;
          }
        });
        
        return html;
      };
      
      container.innerHTML = buildCommentTree(null, 0);
      
      // Cleanup unused reaction unsubs
      const currentIds = comments.map(c => c.id);
      Object.keys(commentReactionUnsubs).forEach(id => {
        if (!currentIds.includes(id)) {
          commentReactionUnsubs[id]();
          delete commentReactionUnsubs[id];
          delete commentReactionsCache[id];
        }
      });

      // Attach reaction listeners and update DOM synchronously
      comments.forEach(c => {
        if (!commentReactionUnsubs[c.id]) {
          const rq = collection(db, `stories/${story.id}/comments/${c.id}/reactions`);
          commentReactionUnsubs[c.id] = onSnapshot(rq, (rsnap) => {
            const reacts = [];
            rsnap.forEach(d => reacts.push(d.data()));
            commentReactionsCache[c.id] = reacts;
            updateCommentReactionsDOM(c.id);
          });
        } else {
          updateCommentReactionsDOM(c.id); // Re-render from cache
        }
      });

      // Bind interactions
      container.querySelectorAll('.btn-toggle-react').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const cid = btn.dataset.commentId;
          const picker = container.querySelector(`#react-picker-${cid}`);
          if (picker) {
            const isHidden = picker.classList.contains('hidden');
            container.querySelectorAll('.react-picker-menu').forEach(p => p.classList.add('hidden', 'flex'));
            container.querySelectorAll('.react-picker-menu').forEach(p => p.classList.remove('flex'));
            
            if (isHidden) {
              picker.classList.remove('hidden');
              picker.classList.add('flex');
            }
          }
        });
      });

      // Close pickers when clicking outside
      const closePickers = () => {
        container.querySelectorAll('.react-picker-menu').forEach(p => {
          p.classList.add('hidden');
          p.classList.remove('flex');
        });
      };
      document.addEventListener('click', closePickers, { once: true });
      modal.onCloseHooks = modal.onCloseHooks || [];
      modal.onCloseHooks.push(() => document.removeEventListener('click', closePickers));

      container.querySelectorAll('.btn-react').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const cid = btn.dataset.commentId;
          const emoji = btn.dataset.emoji;
          try {
            const reacts = commentReactionsCache[cid] || [];
            const myReact = reacts.find(r => r.userId === authManager.currentUser.uid);
            const ref = doc(db, `stories/${story.id}/comments/${cid}/reactions/${authManager.currentUser.uid}`);
            
            if (myReact && myReact.emoji === emoji) {
              await deleteDoc(ref);
            } else {
              await setDoc(ref, {
                userId: authManager.currentUser.uid,
                userName: authManager.userData?.fullName || authManager.currentUser?.displayName || 'Unknown',
                profilePhoto: authManager.userData?.profilePic || authManager.currentUser?.photoURL || '',
                emoji,
                createdAt: serverTimestamp()
              });
              // Animation logic
              const icon = btn.cloneNode(true);
              icon.classList.add('fixed', 'pointer-events-none', 'z-50', 'text-4xl', 'animate-bounce-fade-up');
              const rect = btn.getBoundingClientRect();
              icon.style.left = `${rect.left}px`;
              icon.style.top = `${rect.top}px`;
              document.body.appendChild(icon);
              setTimeout(() => icon.remove(), 1000);
            }
            
            // Close picker
            const picker = container.querySelector(`#react-picker-${cid}`);
            if (picker) {
              picker.classList.add('hidden');
              picker.classList.remove('flex');
            }
          } catch(err) { console.error(err); showToast('Failed to react', 'error'); }
        });
      });

      container.querySelectorAll('.comment-bubble').forEach(bubble => {
        let pressTimer;
        
        const showMenu = (e) => {
          e.preventDefault();
          const block = bubble.closest('.comment-block');
          const isCommentOwner = block.dataset.userId === authManager.currentUser?.uid;
          const userName = block.querySelector('.font-bold')?.innerText || 'Unknown';
          const x = e.clientX || e.touches?.[0]?.clientX || window.innerWidth / 2;
          const y = e.clientY || e.touches?.[0]?.clientY || window.innerHeight / 2;
          showContextMenu(bubble.dataset.commentId, isCommentOwner, userName, x, y);
        };

        bubble.addEventListener('contextmenu', showMenu);
        bubble.addEventListener('touchstart', (e) => {
          pressTimer = setTimeout(() => showMenu(e), 500);
        }, {passive: true});
        bubble.addEventListener('touchend', () => clearTimeout(pressTimer));
        bubble.addEventListener('touchmove', () => clearTimeout(pressTimer));
      });

      container.querySelectorAll('.btn-view-reactions').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const cid = btn.dataset.commentId;
          const emojiFilter = btn.dataset.emoji;
          const reacts = commentReactionsCache[cid] || [];
          const filteredReacts = emojiFilter ? reacts.filter(r => r.emoji === emojiFilter) : reacts;
          openWhoReactedModal(filteredReacts, null);
        });
      });

      const closePreviewBtn = modal.body.querySelector('#sr-reply-preview-close');
      if (closePreviewBtn) {
        closePreviewBtn.addEventListener('click', () => {
          replyingToCommentId = null;
          replyingToUserId = null;
          replyingToUserName = null;
          replyingToText = null;
          
          const preview = modal.body.querySelector('#sr-reply-preview');
          const commentInput = modal.body.querySelector('#sr-comment-input');
          
          if (preview) {
            preview.classList.add('hidden');
            preview.classList.remove('flex');
          }
          if (commentInput) commentInput.placeholder = 'Add a comment...';
        });
      }

      container.querySelectorAll('.quote-block').forEach(block => {
        block.addEventListener('click', () => {
          const targetId = block.dataset.targetId;
          const targetComment = container.querySelector(`[data-id="${targetId}"]`);
          if (targetComment) {
            targetComment.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const bubble = targetComment.querySelector('div[class*="rounded-2xl"]');
            if (bubble) {
              bubble.classList.remove('animate-highlight');
              void bubble.offsetWidth;
              bubble.classList.add('animate-highlight');
            }
          }
        });
      });

      container.querySelectorAll('.btn-delete-comment').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this comment?')) return;
          try {
            await deleteDoc(doc(db, `stories/${story.id}/comments`, btn.dataset.commentId));
            await updateDoc(doc(db, 'stories', story.id), { commentsCount: increment(-1) });
          } catch(e) { showToast('Failed to delete', 'error'); }
        });
      });

      container.querySelectorAll('.btn-edit-comment').forEach(btn => {
        btn.addEventListener('click', () => {
          const cid = btn.dataset.commentId;
          const editContainer = container.querySelector(`#edit-${cid}`);
          if (editContainer) {
            editContainer.classList.remove('hidden');
            editContainer.classList.add('flex');
            const cData = comments.find(c => c.id === cid);
            const editInput = editContainer.querySelector('.edit-input');
            editInput.value = cData.text || cData.comment || '';
            editInput.focus();
          }
        });
      });

      container.querySelectorAll('.btn-cancel-edit').forEach(btn => {
        btn.addEventListener('click', () => {
          const editContainer = container.querySelector(`#edit-${btn.dataset.commentId}`);
          if (editContainer) {
            editContainer.classList.add('hidden');
            editContainer.classList.remove('flex');
          }
        });
      });

      container.querySelectorAll('.btn-save-edit').forEach(btn => {
        btn.addEventListener('click', async () => {
          const cid = btn.dataset.commentId;
          const editContainer = container.querySelector(`#edit-${cid}`);
          const editInput = editContainer.querySelector('.edit-input');
          const newText = editInput.value.trim();
          if (!newText) return;
          try {
            await updateDoc(doc(db, `stories/${story.id}/comments`, cid), { 
              text: newText,
              edited: true,
              updatedAt: serverTimestamp()
            });
            editContainer.classList.add('hidden');
            editContainer.classList.remove('flex');
          } catch(e) { showToast('Failed to edit', 'error'); }
        });
      });
    }; // End of renderSnapshot
    
    if (globalCommentsCache[story.id]) {
      renderSnapshot(globalCommentsCache[story.id]);
    }
    
    const q = query(collection(db, `stories/${story.id}/comments`), orderBy('createdAt', 'asc'));
    unsubComments = onSnapshot(q, (snap) => {
      const comments = [];
      snap.forEach(d => comments.push({ id: d.id, ...d.data() }));
      globalCommentsCache[story.id] = comments;
      renderSnapshot(comments);
    }, (error) => {
      console.error("[Comments] onSnapshot error:", error);
      container.innerHTML = '<div class="text-center text-sm text-red-500 p-4">Failed to load comments.</div>';
    });
  };
  loadComments();
  
  const originalClose = modal.close;
  modal.close = () => {
    if (unsubComments) unsubComments(); 
    if (unsubReactions) unsubReactions();
    Object.values(commentReactionUnsubs).forEach(unsub => unsub());
    if (originalClose) originalClose();
  };

  // Post Comment
  const commentInput = modal.body.querySelector('#sr-comment-input');
  const commentSubmit = modal.body.querySelector('#sr-comment-submit');
  
  const executePostComment = async () => {
    console.log("Post button clicked");
    
    if (!commentInput || !commentSubmit) return;
    
    const text = commentInput.value.trim();
    console.log("Comment text:", text);
    
    if (!text) {
      showToast('Comment cannot be empty.', 'error');
      return;
    }
    if (text.length > 500) {
      showToast('Comment is too long. Max 500 characters.', 'error');
      return;
    }
    
    const origText = commentSubmit.innerHTML;
    
    // Optimistic UI: Clear input immediately
    commentInput.value = '';
    commentInput.blur();
    
    // Capture state for rollback if needed
    const savedReplyingToCommentId = replyingToCommentId;
    const savedReplyingToUserId = replyingToUserId;
    const savedReplyingToUserName = replyingToUserName;
    const savedReplyingToText = replyingToText;
    
    // Reset reply state UI
    replyingToCommentId = null;
    replyingToUserId = null;
    replyingToUserName = null;
    replyingToText = null;
    
    const preview = modal.body.querySelector('#sr-reply-preview');
    if (preview) {
      preview.classList.add('hidden');
      preview.classList.remove('flex');
    }
    commentInput.placeholder = 'Add a comment...';
    
    // Scroll to bottom optimistically
    setTimeout(() => {
      const container = modal.body.querySelector('#story-comments');
      if (container) container.scrollTop = container.scrollHeight;
    }, 50);

    try {
      const commentRef = doc(collection(db, `stories/${story.id}/comments`));
      await Promise.all([
        setDoc(commentRef, {
          commentId: commentRef.id,
          storyId: story.id,
          parentCommentId: savedReplyingToCommentId || null,
          parentUserId: savedReplyingToUserId || null,
          parentUserName: savedReplyingToUserName || null,
          parentText: savedReplyingToText || null,
          userId: authManager.currentUser?.uid || 'unknown',
          userName: authManager.userData?.fullName || authManager.currentUser?.displayName || 'Unknown',
          photoURL: authManager.userData?.profilePic || authManager.currentUser?.photoURL || '',
          text: text,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          edited: false
        }),
        updateDoc(doc(db, 'stories', story.id), { commentsCount: increment(1) })
      ]);
      
    } catch (e) {
      console.error("Firebase Comment Error:", e);
      showToast("Unable to post comment. Please try again.", 'error');
      // Rollback UI state (optional, but good UX)
      commentInput.value = text;
      if (savedReplyingToCommentId) {
        replyingToCommentId = savedReplyingToCommentId;
        replyingToUserId = savedReplyingToUserId;
        replyingToUserName = savedReplyingToUserName;
        replyingToText = savedReplyingToText;
        if (preview) {
          modal.body.querySelector('#sr-reply-preview-name').innerText = replyingToUserName;
          modal.body.querySelector('#sr-reply-preview-text').innerText = replyingToText;
          preview.classList.remove('hidden');
          preview.classList.add('flex');
        }
        commentInput.placeholder = `Reply to ${replyingToUserName}...`;
      }
    }
  };
  
  commentSubmit.addEventListener('click', executePostComment);
  commentInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') executePostComment();
  });
}

// ------------------------------------------------------------------
// CLOSE FRIENDS SELECTOR
// ------------------------------------------------------------------
export function openCloseFriendsSelector(currentSelection, onComplete) {
  const modal = router.openModal({
    id: 'close-friends-selector',
    bottomSheet: true
  });
  
  let tempSelection = [...currentSelection];
  const friends = Array.from(userCache.users.values())
    .filter(u => u.id !== authManager.currentUser.uid)
    .sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0) || (a.fullName || '').localeCompare(b.fullName || ''));

  const renderList = (filterText = '') => {
    const listEl = modal.body.querySelector('#cf-list');
    if (!listEl) return;
    
    const filtered = friends.filter(f => (f.fullName || '').toLowerCase().includes(filterText.toLowerCase()));
    
    if (filtered.length === 0) {
      listEl.innerHTML = '<p class="text-center text-sm text-gray-400 py-4">No friends found.</p>';
      return;
    }
    
    listEl.innerHTML = filtered.map(f => {
      const isSelected = tempSelection.includes(f.id);
      return `
        <div class="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-xl cursor-pointer cf-row transition-colors border border-transparent ${isSelected ? 'bg-blue-50/50 border-blue-100' : ''}" data-id="${f.id}">
          <div class="relative">
            ${f.profilePic ? `<img src="${f.profilePic}" class="w-10 h-10 rounded-full object-cover shadow-sm"/>` : `<div class="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center font-bold text-indigo-700 shadow-sm">${(f.fullName || '?')[0]}</div>`}
            <div class="absolute bottom-0 right-0 w-3 h-3 border-2 border-white rounded-full ${f.online ? 'bg-green-500' : 'bg-gray-300'}"></div>
          </div>
          <div class="flex-1">
            <p class="font-bold text-sm text-navy-800">${sanitizeHTML(f.fullName || 'Unknown')}</p>
            <p class="text-[10px] text-gray-400 font-semibold">${f.online ? '🟢 Online' : 'Offline'}</p>
          </div>
          <div class="w-6 h-6 rounded-md border-2 flex items-center justify-center transition-colors shadow-sm ${isSelected ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-300 bg-white'}">
            ${isSelected ? '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>' : ''}
          </div>
        </div>
      `;
    }).join('');
    
    listEl.querySelectorAll('.cf-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.dataset.id;
        if (tempSelection.includes(id)) {
          tempSelection = tempSelection.filter(x => x !== id);
        } else {
          tempSelection.push(id);
        }
        renderList(modal.body.querySelector('#cf-search').value);
      });
    });
  };

  modal.body.innerHTML = `
    <div class="p-4 md:p-6 h-[80vh] flex flex-col bg-white rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.1)]">
      <div class="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-4"></div>
      <div class="flex justify-between items-center mb-4 px-2">
        <div>
          <h3 class="text-xl font-bold text-navy-800">Select Close Friends</h3>
          <p class="text-xs text-gray-500 mt-1">Only they will see this story</p>
        </div>
        <button id="cf-close" class="text-gray-400 hover:text-navy-600 bg-gray-50 hover:bg-gray-100 rounded-full p-2 transition-colors">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      
      <div class="px-2 mb-4">
        <div class="relative">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
          <input type="text" id="cf-search" placeholder="Search friends..." class="w-full bg-gray-50 border border-gray-200 rounded-xl pl-9 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all shadow-inner" />
        </div>
      </div>
      
      <div class="flex justify-between mb-2 px-3">
        <button id="cf-select-all" class="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors">Select All</button>
        <button id="cf-unselect-all" class="text-xs font-bold text-gray-500 hover:text-gray-700 transition-colors">Unselect All</button>
      </div>
      
      <div id="cf-list" class="flex-1 overflow-y-auto space-y-1 mb-4 no-scrollbar border-t border-gray-100 pt-2 px-1"></div>
      
      <div class="pt-2 pb-4 px-2">
        <button id="cf-continue" class="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-200 transition-all transform active:scale-95 text-base flex justify-center items-center gap-2">
          Continue
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
        </button>
      </div>
    </div>
  `;
  
  modal.body.querySelector('#cf-close').addEventListener('click', () => {
    modal.close();
    onComplete(null);
  });
  
  modal.body.querySelector('#cf-search').addEventListener('input', (e) => renderList(e.target.value));
  
  modal.body.querySelector('#cf-select-all').addEventListener('click', () => {
    tempSelection = friends.map(f => f.id);
    renderList(modal.body.querySelector('#cf-search').value);
  });
  
  modal.body.querySelector('#cf-unselect-all').addEventListener('click', () => {
    tempSelection = [];
    renderList(modal.body.querySelector('#cf-search').value);
  });
  
  modal.body.querySelector('#cf-continue').addEventListener('click', () => {
    modal.close();
    onComplete(tempSelection);
  });
  
  renderList();
}

// ------------------------------------------------------------------
// WHO REACTED MODAL
// ------------------------------------------------------------------
export function openWhoReactedModal(reactions, selectedEmoji) {
  const modal = router.openModal({
    id: 'who-reacted-modal',
    bottomSheet: true
  });
  
  // Group by emoji
  const grouped = {};
  reactions.forEach(r => {
    if (!grouped[r.emoji]) grouped[r.emoji] = [];
    grouped[r.emoji].push(r);
  });
  
  // If a specific emoji was tapped, we can bring it to the top or just show all
  const sortedEmojis = Object.keys(grouped).sort((a,b) => b === selectedEmoji ? 1 : a === selectedEmoji ? -1 : 0);
  
  let html = `
    <div class="p-4 md:p-6 h-[70vh] flex flex-col bg-white rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.1)]">
      <div class="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-4"></div>
      <div class="flex justify-between items-center mb-4 px-2 border-b border-gray-100 pb-3">
        <h3 class="text-xl font-bold text-navy-800">People who reacted</h3>
        <button id="wr-close" class="text-gray-400 hover:text-navy-600 bg-gray-50 hover:bg-gray-100 rounded-full p-2 transition-colors">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      
      <div class="flex-1 overflow-y-auto space-y-6 no-scrollbar px-2 pb-6">
  `;
  
  sortedEmojis.forEach(emoji => {
    const reacts = grouped[emoji];
    // Sort by most recent
    reacts.sort((a,b) => (b.createdAt?.toMillis ? b.createdAt.toMillis() : 0) - (a.createdAt?.toMillis ? a.createdAt.toMillis() : 0));
    
    html += `
      <div>
        <h4 class="text-lg font-bold text-navy-800 mb-3 border-b border-gray-50 pb-2">${emoji} <span class="text-gray-400 text-sm font-semibold">(${reacts.length})</span></h4>
        <div class="space-y-3">
          ${reacts.map(r => {
            return `
              <div class="flex items-center gap-3">
                ${r.userPhoto ? `<img src="${r.userPhoto}" class="w-10 h-10 rounded-full object-cover shadow-sm"/>` : `<div class="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center font-bold text-indigo-700 shadow-sm">${(r.userName || '?')[0]}</div>`}
                <div class="flex-1">
                  <p class="font-bold text-sm text-navy-800">${sanitizeHTML(r.userName || 'Unknown')}</p>
                  <p class="text-[11px] text-gray-400 font-medium mt-0.5">Reacted:<br>${r.createdAt?.toDate ? timeAgo(r.createdAt.toDate()) : 'Just now'}</p>
                </div>
                <div class="text-2xl">${r.emoji}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  });
  
  if (reactions.length === 0) {
    html += '<div class="text-center text-gray-400 py-10">No reactions yet.</div>';
  }
  
  html += `
      </div>
    </div>
  `;
  
  modal.body.innerHTML = html;
  
  modal.body.querySelector('#wr-close').addEventListener('click', () => modal.close());
}

// ------------------------------------------------------------------
// SEEN STATUS MODAL
// ------------------------------------------------------------------
export function openSeenStatusModal(storyId) {
  const modal = router.openModal({
    id: 'seen-status-modal',
    bottomSheet: true
  });
  
  modal.body.innerHTML = `
    <div class="p-4 md:p-6 h-[70vh] flex flex-col bg-white rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.1)]">
      <div class="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-4"></div>
      <div class="flex justify-between items-center mb-4 px-2 border-b border-gray-100 pb-3">
        <h3 class="text-xl font-bold text-navy-800">👀 Seen by (<span id="ss-count">0</span>)</h3>
        <button id="ss-close" class="text-gray-400 hover:text-navy-600 bg-gray-50 hover:bg-gray-100 rounded-full p-2 transition-colors">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      
      <div id="ss-list" class="flex-1 overflow-y-auto space-y-4 no-scrollbar px-2 pb-6">
        <div class="text-center text-gray-400 py-10">Loading...</div>
      </div>
    </div>
  `;
  
  modal.body.querySelector('#ss-close').addEventListener('click', () => modal.close());

  const q = query(collection(db, `stories/${storyId}/views`), orderBy('openedAt', 'desc'));
  const unsub = onSnapshot(q, (snap) => {
    modal.body.querySelector('#ss-count').innerText = snap.size;
    const listEl = modal.body.querySelector('#ss-list');
    
    if (snap.empty) {
      listEl.innerHTML = '<div class="text-center text-gray-400 py-10">No views yet.</div>';
      return;
    }
    
    let html = '';
    snap.forEach(d => {
      const v = d.data();
      const dateStr = v.openedAt?.toDate ? v.openedAt.toDate().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Today';
      const timeStr = v.openedAt?.toDate ? v.openedAt.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
      
      html += `
        <div class="flex items-center gap-3 py-2 border-b border-gray-50">
          ${v.photoURL ? `<img src="${v.photoURL}" class="w-10 h-10 rounded-full object-cover shadow-sm"/>` : `<div class="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center font-bold text-indigo-700 shadow-sm">${(v.userName || '?')[0]}</div>`}
          <div class="flex-1">
            <p class="font-bold text-sm text-navy-800 flex items-center gap-1">🟢 ${sanitizeHTML(v.userName || 'Unknown')}</p>
            <p class="text-[11px] text-gray-400 font-medium mt-0.5">Opened:<br>${dateStr} ${timeStr}</p>
          </div>
        </div>
      `;
    });
    listEl.innerHTML = html;
  });

  modal.onCloseHooks = modal.onCloseHooks || [];
  modal.onCloseHooks.push(() => unsub());
}
