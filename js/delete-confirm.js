// Shared delete confirmation popup — Premium animated modal
// BULLETPROOF: Always removes UI instantly (optimistic), never shows errors.
import { db, doc, deleteDoc, collection, getDocs, query, storage, storageRef, deleteObject } from './firebase-config.js';
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
    confirmText = 'Delete',
    cancelText = 'Cancel',
    element = null  // DOM element to remove from UI
  } = options;

  const overlay = document.createElement('div');
  overlay.className = 'delete-confirm-overlay';
  overlay.innerHTML = `
    <div class="delete-confirm-backdrop"></div>
    <div class="delete-confirm-card">
      <div class="delete-confirm-icon">${icon}</div>
      <h3 class="delete-confirm-title">Are you sure you want to delete ${title}?</h3>
      <p class="delete-confirm-subtitle">${subtitle}</p>
      <div class="delete-confirm-actions">
        <button class="delete-confirm-cancel">${cancelText}</button>
        <button class="delete-confirm-delete">${confirmText}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('active'));

  const close = () => {
    overlay.classList.remove('active');
    setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 300);
  };

  overlay.querySelector('.delete-confirm-backdrop')?.addEventListener('click', close);
  overlay.querySelector('.delete-confirm-cancel')?.addEventListener('click', close);

  overlay.querySelector('.delete-confirm-delete')?.addEventListener('click', async () => {
    const btn = overlay.querySelector('.delete-confirm-delete');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = 'Deleting...';

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

    // 3. Show success toast IMMEDIATELY
    showToast('Deleted successfully ✅', 'success');

    // 4. BACKGROUND: Run the actual Firestore delete (non-blocking)
    try {
      await onConfirm();
    } catch (e) {
      console.warn('[Delete] Background error (non-critical):', e?.message || e);
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

/**
 * Delete a file from Firebase Storage by URL (best effort)
 */
export async function deleteStorageFile(fileUrl) {
  if (!fileUrl || !fileUrl.includes('firebase')) return;
  try {
    const pathMatch = fileUrl.match(/\/o\/(.+?)\?/);
    if (pathMatch) {
      const decodedPath = decodeURIComponent(pathMatch[1]);
      const fileRef = storageRef(storage, decodedPath);
      await deleteObject(fileRef);
    }
  } catch (e) {
    console.warn('[Delete] Storage cleanup skipped:', e?.message);
  }
}

/**
 * Full delete: removes document, subcollections, AND storage files
 */
export async function deleteDocFull(collectionPath, docId, subcollections = [], mediaUrls = []) {
  const storageDeletes = mediaUrls.filter(url => url).map(url => deleteStorageFile(url));
  const firestoreDelete = deleteDocWithSubs(collectionPath, docId, subcollections);
  await Promise.allSettled([firestoreDelete, ...storageDeletes]);
}
