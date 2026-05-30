// Polls page — Fixed: no auto-show voters, view votes popup, delete support
import { db, collection, addDoc, getDocs, query, orderBy, onSnapshot, doc, updateDoc,
  arrayUnion, serverTimestamp, limit, getDoc, deleteDoc } from '../firebase-config.js';
import { showToast, sanitizeHTML, formatNumber } from '../utils.js';
import { authManager } from '../auth.js';
import { router } from '../router.js';
import { createNotification } from '../notifications.js';
import { showDeleteConfirmation } from '../delete-confirm.js';

let unsubPolls = null;
const deletedPollIds = new Set();

export function destroyPolls() {
  if (unsubPolls) unsubPolls();
  unsubPolls = null;
}

export async function renderPolls(container) {
  destroyPolls();

  container.innerHTML = `
    <section class="px-4 pt-4">
      <div class="flex items-center gap-3 mb-5">
        <button id="polls-back-btn" class="inner-back-btn">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
        </button>
        <div class="flex-1">
          <h2 class="text-xl font-bold text-navy-800">Polls</h2>
          <p class="text-xs text-gray-400">Vote and see what the class thinks!</p>
        </div>
        <button id="create-poll-btn" class="px-4 py-2 bg-navy-500 text-white rounded-full text-xs font-semibold hover:bg-navy-600 transition-colors">
          + Create Poll
        </button>
      </div>
      <div id="polls-container" class="space-y-4">
        <div class="card p-6 text-center">
          <div class="skeleton w-full h-4 mb-2"></div>
          <div class="skeleton w-3/4 h-4 mx-auto"></div>
        </div>
      </div>
    </section>
  `;

  container.querySelector('#create-poll-btn')?.addEventListener('click', () => showCreatePollModal());
  container.querySelector('#polls-back-btn')?.addEventListener('click', () => router.navigateBack());

  loadPolls(container);
}

function loadPolls(container) {
  const pollsEl = container.querySelector('#polls-container');
  try {
    const q = query(collection(db, 'polls'), orderBy('createdAt', 'desc'), limit(20));
    unsubPolls = onSnapshot(q, (snap) => {
      if (snap.empty) {
        pollsEl.innerHTML = `
          <div class="card p-8 text-center">
            <div class="text-4xl mb-3">📊</div>
            <h3 class="font-semibold text-navy-700 mb-1">No polls yet</h3>
            <p class="text-sm text-gray-400">Create the first poll for your class!</p>
          </div>`;
        return;
      }
      pollsEl.innerHTML = '';
      snap.forEach(d => {
        if (deletedPollIds.has(d.id)) return;
        pollsEl.appendChild(createPollCard({ id: d.id, ...d.data() }));
      });
    });
  } catch (e) {
    pollsEl.innerHTML = '<p class="text-center text-gray-400 py-8 text-sm">Configure Firebase for polls</p>';
  }
}

function createPollCard(poll) {
  const totalVotes = poll.options?.reduce((sum, opt) => sum + (opt.votes?.length || 0), 0) || 0;
  const myVoteIdx = poll.options?.findIndex(opt => opt.votes?.includes(authManager.currentUser?.uid));
  const hasVoted = myVoteIdx >= 0;
  const isExpired = poll.expiresAt && new Date(poll.expiresAt) < new Date();
  const isOwner = poll.authorId === authManager.currentUser?.uid;
  const time = poll.createdAt?.toDate ? new Date(poll.createdAt.toDate()).toLocaleDateString() : '';

  const card = document.createElement('div');
  card.className = 'card p-4 animate-fadeIn';
  card.innerHTML = `
    <div class="flex items-start justify-between mb-3">
      <div class="flex-1">
        <p class="font-semibold text-navy-800">${sanitizeHTML(poll.question)}</p>
        <p class="text-xs text-gray-400 mt-0.5">by ${sanitizeHTML(poll.authorName || 'Unknown')} · ${time}</p>
      </div>
      <div class="flex items-center gap-2">
        <span class="poll-live-badge">${formatNumber(totalVotes)} vote${totalVotes !== 1 ? 's' : ''}</span>
        ${isExpired ? '<span class="text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-500 font-medium">Ended</span>' : ''}
        ${isOwner ? `
          <button class="poll-delete-btn p-1 text-gray-300 hover:text-red-400 transition-colors" data-poll-id="${poll.id}" title="Delete poll">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>
          </button>
        ` : ''}
      </div>
    </div>
    <div class="space-y-3" id="poll-options-${poll.id}">
      ${poll.options.map((opt, i) => {
        const optVotes = opt.votes?.length || 0;
        const pct = totalVotes > 0 ? Math.round((optVotes / totalVotes) * 100) : 0;
        const isMyVote = myVoteIdx === i;

        if (hasVoted || isExpired) {
          // SHOW ONLY percentage + vote count — NO voter list
          return `
            <div class="poll-option-result">
              <div class="poll-result-bar ${isMyVote ? 'poll-my-vote' : ''}">
                <div class="poll-result-fill" style="width:0%" data-target="${pct}"></div>
                <div class="poll-result-text">
                  <span>${sanitizeHTML(opt.text)}</span>
                  <span class="poll-vote-count">
                    <span class="font-bold">${pct}%</span>
                    <span class="poll-vote-number">${optVotes}</span>
                  </span>
                </div>
              </div>
            </div>
          `;
        } else {
          return `
            <button class="poll-option-btn" data-poll-id="${poll.id}" data-option-idx="${i}">
              ${sanitizeHTML(opt.text)}
            </button>
          `;
        }
      }).join('')}
    </div>

    <!-- View Votes button — only shown after voting -->
    ${hasVoted || isExpired ? `
      <button class="poll-view-votes-btn" data-poll-id="${poll.id}">
        👀 View Votes
      </button>
    ` : ''}
  `;

  // Delete handler — instant UI removal
  card.querySelector('.poll-delete-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    showDeleteConfirmation('this poll', async () => {
      deletedPollIds.add(poll.id);
      await deleteDoc(doc(db, 'polls', poll.id));
    }, { element: card });
  });

  // Vote handlers
  card.querySelectorAll('.poll-option-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!authManager.currentUser || hasVoted || isExpired) return;
      btn.disabled = true;
      btn.innerHTML = '<span class="poll-voting-anim">Voting...</span>';
      const optIdx = parseInt(btn.dataset.optionIdx);
      try {
        const updatedOptions = [...poll.options];
        if (!updatedOptions[optIdx].votes) updatedOptions[optIdx].votes = [];
        updatedOptions[optIdx].votes.push(authManager.currentUser.uid);
        await updateDoc(doc(db, 'polls', poll.id), { options: updatedOptions });
        showToast('Vote recorded! 🗳️', 'success');
      } catch (e) {
        console.error('Vote error:', e);
        showToast('Could not vote. Try again.', 'error');
        btn.disabled = false;
        btn.textContent = poll.options[optIdx].text;
      }
    });
  });

  // Animate poll bars
  requestAnimationFrame(() => {
    card.querySelectorAll('.poll-result-fill[data-target]').forEach(bar => {
      setTimeout(() => { bar.style.width = bar.dataset.target + '%'; }, 100);
    });
  });

  // View Votes popup
  card.querySelector('.poll-view-votes-btn')?.addEventListener('click', () => {
    showVotersPopup(poll);
  });

  return card;
}

// Smooth popup showing who voted for what
async function showVotersPopup(poll) {
  const modal = router.openModal('', { title: '👀 Who Voted' });
  modal.body.innerHTML = '<div class="p-6 text-center"><div class="text-2xl mb-2">⏳</div><p class="text-sm text-gray-400">Loading voters...</p></div>';

  const totalVotes = poll.options?.reduce((sum, opt) => sum + (opt.votes?.length || 0), 0) || 0;

  // Resolve all voter names
  const voterCache = {};
  const allUids = new Set();
  poll.options.forEach(opt => (opt.votes || []).forEach(uid => allUids.add(uid)));

  for (const uid of allUids) {
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      voterCache[uid] = snap.exists() ? snap.data() : { fullName: 'Unknown' };
    } catch { voterCache[uid] = { fullName: 'Unknown' }; }
  }

  modal.body.innerHTML = `
    <div class="p-4 space-y-4">
      <p class="text-center text-sm text-gray-400 mb-3">${totalVotes} total vote${totalVotes !== 1 ? 's' : ''}</p>
      ${poll.options.map((opt, i) => {
        const optVotes = opt.votes || [];
        const pct = totalVotes > 0 ? Math.round((optVotes.length / totalVotes) * 100) : 0;
        return `
          <div class="voters-option-group">
            <div class="flex items-center justify-between mb-2">
              <span class="text-sm font-semibold text-navy-800">${sanitizeHTML(opt.text)}</span>
              <span class="text-xs text-gray-400">${pct}% · ${optVotes.length}</span>
            </div>
            ${optVotes.length > 0 ? `
              <div class="space-y-1.5">
                ${optVotes.map(uid => {
                  const u = voterCache[uid] || {};
                  const name = u.fullName || 'Unknown';
                  return `
                    <div class="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-cream-50">
                      ${u.profilePic
                        ? `<img src="${u.profilePic}" class="w-6 h-6 rounded-full object-cover" alt=""/>`
                        : `<div class="w-6 h-6 rounded-full bg-navy-500 text-white flex items-center justify-center text-[9px] font-bold">${name[0]}</div>`}
                      <span class="text-sm text-navy-800">${sanitizeHTML(name)}</span>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : '<p class="text-xs text-gray-300 italic">No votes</p>'}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function showCreatePollModal() {
  const modal = router.openModal('', { title: 'Create Poll' });
  let optionCount = 2;

  modal.body.innerHTML = `
    <div class="p-4">
      <div class="space-y-4">
        <div>
          <label class="text-xs font-semibold text-navy-600 mb-1 block">Question</label>
          <input type="text" id="poll-question" placeholder="What do you want to ask?" class="w-full px-4 py-3 border border-gray-200 rounded-2xl text-sm text-navy-800 placeholder:text-gray-400 focus:outline-none focus:border-navy-500 bg-white"/>
        </div>

        <div id="poll-options-form">
          <label class="text-xs font-semibold text-navy-600 mb-1 block">Options</label>
          <div class="space-y-2" id="options-list">
            <input type="text" class="poll-opt-input w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-navy-800 placeholder:text-gray-400 focus:outline-none focus:border-navy-300 bg-white" placeholder="Option 1"/>
            <input type="text" class="poll-opt-input w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-navy-800 placeholder:text-gray-400 focus:outline-none focus:border-navy-300 bg-white" placeholder="Option 2"/>
          </div>
          <button type="button" id="add-option-btn" class="mt-2 text-xs text-navy-500 font-semibold hover:underline">+ Add Option</button>
        </div>

        <button id="submit-poll" class="btn-primary">CREATE POLL 📊</button>
      </div>
    </div>
  `;

  modal.body.querySelector('#add-option-btn')?.addEventListener('click', () => {
    if (optionCount >= 6) { showToast('Maximum 6 options', 'warning'); return; }
    optionCount++;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'poll-opt-input w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-navy-800 placeholder:text-gray-400 focus:outline-none focus:border-navy-300 bg-white';
    input.placeholder = `Option ${optionCount}`;
    modal.body.querySelector('#options-list').appendChild(input);
  });

  modal.body.querySelector('#submit-poll')?.addEventListener('click', async () => {
    const question = modal.body.querySelector('#poll-question')?.value.trim();
    const optInputs = modal.body.querySelectorAll('.poll-opt-input');
    const options = [...optInputs].map(i => i.value.trim()).filter(v => v);

    if (!question) { showToast('Enter a question', 'warning'); return; }
    if (options.length < 2) { showToast('Need at least 2 options', 'warning'); return; }

    try {
      const pollRef = await addDoc(collection(db, 'polls'), {
        question,
        options: options.map(text => ({ text, votes: [] })),
        authorId: authManager.currentUser.uid,
        authorName: authManager.userData?.fullName || 'Unknown',
        createdAt: serverTimestamp()
      });
      showToast('Poll created! 📊', 'success');

      // Notify all classmates about the new poll
      try {
        const usersSnap = await getDocs(collection(db, 'users'));
        usersSnap.forEach(d => {
          if (d.id !== authManager.currentUser.uid) {
            createNotification('poll_created', d.id, { pollId: pollRef.id });
          }
        });
      } catch (e) { console.log('Poll notification error:', e); }

      modal.close();
    } catch (e) {
      console.error('Create poll error:', e);
      showToast('Failed to create poll', 'error');
    }
  });
}
