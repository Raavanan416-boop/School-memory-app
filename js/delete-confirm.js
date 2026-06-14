// Shared delete confirmation popup — Premium animated modal
// BULLETPROOF: Always removes UI instantly (optimistic), never shows errors.
import { db, doc, deleteDoc, collection, getDocs, query } from './firebase-config.js';
import { showToast } from './utils.js';

/**
 * Show a premium delete confirmation popup with INSTANT UI removal
 * @param {string} title - What is being deleted
 * @param {Function} onConfirm - Async callback to run on confirmation
 * @param {Object} options - Optional settings
 * @param {HTMLElement} options.element - DOM element to animate out and remove
 */
export function showDeleteConfirmation(title = 'this item', onConfirm, options = {}) {
  const {
    subtitle = 'This action cannot be undone.',
    icon = '🗑️',
    confirmText = 'Delete Forever',
    cancelText = 'Cancel',
    element = null  // DOM element to remove from UI
  } = options;

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[200] flex items-center justify-center p-4 bg-navy-900/40 backdrop-blur-sm opacity-0 transition-opacity duration-300';
  
  overlay.innerHTML = `
    <div class="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl transform scale-95 transition-transform duration-300 text-center p-6">
      <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center text-3xl mx-auto mb-4">
        ⚠️
      </div>
      <h3 class="text-xl font-bold text-navy-800">Delete ${title}?</h3>
      <p class="text-sm text-gray-500 mt-2">${subtitle}</p>
      
      <div class="flex gap-3 mt-8">
        <button class="delete-confirm-cancel flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200 transition-colors">
          ${cancelText}
        </button>
        <button class="delete-confirm-delete flex-1 py-3 bg-red-500 text-white rounded-xl font-bold hover:bg-red-600 transition-colors shadow-lg shadow-red-500/30">
          ${confirmText}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  
  // Animate in
  requestAnimationFrame(() => {
    overlay.classList.remove('opacity-0');
    overlay.querySelector('.transform').classList.remove('scale-95');
  });

  const close = () => {
    overlay.classList.add('opacity-0');
    overlay.querySelector('.transform').classList.add('scale-95');
    setTimeout(() => overlay.remove(), 300);
  };

  overlay.querySelector('.delete-confirm-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  overlay.querySelector('.delete-confirm-delete').addEventListener('click', async () => {
    const btn = overlay.querySelector('.delete-confirm-delete');
    btn.disabled = true;
    btn.innerHTML = '<div class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto"></div>';

    // 1. INSTANT: Close popup
    close();

    // 2. INSTANT: Animate out the DOM element (optimistic removal)
    if (element) {
      element.style.transition = 'all 0.3s ease';
      element.style.opacity = '0';
      element.style.transform = 'scale(0.95) translateX(-20px)';
      element.style.maxHeight = element.scrollHeight + 'px';
      element.style.overflow = 'hidden';
      setTimeout(() => {
        element.style.maxHeight = '0';
        element.style.padding = '0';
        element.style.margin = '0';
        element.style.border = 'none';
      }, 150);
      setTimeout(() => {
        if (element.parentNode) element.remove();
      }, 400);
    }

    // 3. BACKGROUND: Run the actual Firestore delete (non-blocking)
    try {
      await onConfirm();
      showToast('✨ Memory permanently removed', 'success');
    } catch (e) {
      console.warn('[Delete] Background error:', e?.message || e);
      showToast('Error deleting memory', 'error');
    }
  });
}

/**
 * Delete a Firestore document and all documents in specified subcollections.
 * Silently handles errors — never throws.
 */
export async function deleteDocWithSubs(collectionPath, docId, subcollections = []) {
  for (const sub of subcollections) {
    try {
      const subSnap = await getDocs(collection(db, collectionPath, docId, sub));
      const promises = [];
      subSnap.forEach(d => {
        promises.push(deleteDoc(doc(db, collectionPath, docId, sub, d.id)).catch(() => {}));
      });
      await Promise.allSettled(promises);
    } catch (e) { /* subcollection may not exist */ }
  }
  try {
    await deleteDoc(doc(db, collectionPath, docId));
  } catch (e) {
    console.warn('[Delete] Doc delete error:', e?.message);
  }
}

export async function deleteStorageFile(fileUrl) {
  // Deprecated. Use Cloud Functions backend.
  console.log('[Delete] Skipping media deletion via storage');
}

/**
 * Full delete: securely removes Cloudinary media via Cloud Functions, then Firestore document and subcollections.
 */
export async function deleteDocFull(collectionPath, docId, subcollections = [], cloudinaryPublicIds = [], resourceType = 'image') {
  try {
    // 1. Delete Media from Cloudinary (Server-Side API Route)
    if (cloudinaryPublicIds && cloudinaryPublicIds.length > 0) {
      try {
        const { app } = await import('./firebase-config.js');
        const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js');
        const functions = getFunctions(app);
        const deleteCloudinaryMedia = httpsCallable(functions, 'deleteCloudinaryMedia');
        
        await deleteCloudinaryMedia({
          publicIds: cloudinaryPublicIds,
          resourceType: resourceType
        });
        console.log('[Delete] Cloudinary media deleted successfully');
      } catch (cloudErr) {
        console.warn('[Delete] Cloudinary deletion failed (backend likely not deployed). Proceeding with Firestore delete.', cloudErr);
      }
    }

    // 2. Delete Firestore Document and Subcollections
    await deleteDocWithSubs(collectionPath, docId, subcollections);
    
    // 3. Cleanup notifications related to this post
    try {
      const notifSnap = await getDocs(query(collection(db, 'notifications'), where('postId', '==', docId)));
      const notifPromises = [];
      notifSnap.forEach(d => notifPromises.push(deleteDoc(d.ref).catch(() => {})));
      await Promise.allSettled(notifPromises);
    } catch (notifErr) {
      console.warn('[Delete] Notifications cleanup failed (likely permission issues). Skipping.', notifErr);
    }

    console.log('[Delete] Firestore cleanup complete');
  } catch (err) {
    console.error('[Delete] Deep cleanup failed:', err);
    throw err;
  }
}
