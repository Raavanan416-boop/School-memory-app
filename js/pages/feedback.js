import { authManager } from '../auth.js';
import { db, collection, addDoc, serverTimestamp } from '../firebase-config.js';
import { showToast } from '../utils.js';
import { router } from '../router.js';

export async function renderFeedback(container) {
  container.innerHTML = `
    <header class="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-gray-100 p-4 flex items-center gap-3">
      <button id="back-btn" class="p-2 -ml-2 rounded-full hover:bg-gray-100 transition-colors">
        <svg class="w-6 h-6 text-navy-800" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
      </button>
      <h2 class="text-lg font-bold text-navy-800">Feedback</h2>
    </header>
    <main class="p-4 flex flex-col gap-4">
      <div class="card p-5">
        <h3 class="font-bold text-navy-800 mb-2">We value your thoughts!</h3>
        <p class="text-sm text-gray-600 mb-4">Have an idea, found a bug, or just want to tell us what you love? Let us know below.</p>
        <form id="feedback-form" class="space-y-4">
          <textarea id="feedback-text" rows="5" class="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-navy-500 outline-none resize-none" placeholder="Write your feedback here..." required></textarea>
          <button type="submit" id="feedback-submit" class="w-full bg-navy-600 text-white font-bold py-3 rounded-xl shadow-md hover:bg-navy-700 transition-colors">Submit Feedback</button>
        </form>
      </div>
    </main>
  `;

  container.querySelector('#back-btn').addEventListener('click', () => {
    router.navigate('home');
  });

  const form = container.querySelector('#feedback-form');
  const btn = container.querySelector('#feedback-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = container.querySelector('#feedback-text').value.trim();
    if (!text) return;

    btn.disabled = true;
    btn.textContent = 'Submitting...';

    try {
      const ua = navigator.userAgent;
      await addDoc(collection(db, 'feedback'), {
        uid: authManager.currentUser.uid,
        userName: authManager.userData?.fullName || authManager.currentUser.email,
        feedback: text,
        createdAt: serverTimestamp(),
        device: /Mobile|Android|iPhone/i.test(ua) ? 'Mobile' : 'Desktop',
        appVersion: '3.0' // Assuming version based on app details
      });
      showToast('Thank you for your feedback!', 'success');
      form.reset();
      router.navigate('home');
    } catch (err) {
      console.error('Feedback error:', err);
      showToast('Failed to submit feedback. Try again later.', 'error');
      btn.disabled = false;
      btn.textContent = 'Submit Feedback';
    }
  });
}
