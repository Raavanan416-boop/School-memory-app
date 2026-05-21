// Polls page — Full poll system with real-time voting
import { db, collection, addDoc, getDocs, query, orderBy, onSnapshot, doc, updateDoc,
  arrayUnion, serverTimestamp, limit, getDoc } from '../firebase-config.js';
import { showToast, sanitizeHTML, formatNumber } from '../utils.js';
import { authManager } from '../auth.js';
import { router } from '../router.js';
import { createNotification } from '../notifications.js';

let unsubPolls = null;

export async function renderPolls(container) {
  if (unsubPolls) unsubPolls();

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
  const time = poll.createdAt?.toDate ? new Date(poll.createdAt.toDate()).toLocaleDateString() : '';

  const card = document.createElement('div');
  card.className = 'card p-4 animate-fadeIn';
  card.innerHTML = `
    <div class="flex items-start justify-between mb-3">
      <div>
        <p class="font-semibold text-navy-800">${sanitizeHTML(poll.question)}</p>
        <p class="text-xs text-gray-400 mt-0.5">by ${sanitizeHTML(poll.authorName || 'Unknown')} · ${time}</p>
      </div>
      <div class="flex items-center gap-2">
        <span class="poll-live-badge">${formatNumber(totalVotes)} vote${totalVotes !== 1 ? 's' : ''}</span>
        ${isExpired ? '<span class="text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-500 font-medium">Ended</span>' : ''}
      </div>
    </div>
    <div class="space-y-3" id="poll-options-${poll.id}">
      ${poll.options.map((opt, i) => {
        const optVotes = opt.votes?.length || 0;
        const pct = totalVotes > 0 ? Math.round((optVotes / totalVotes) * 100) : 0;
        const isMyVote = myVoteIdx === i;
        const voterIds = opt.votes || [];

        if (hasVoted || isExpired) {
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
              ${optVotes > 0 ? `
                <div class="poll-voters-inline" id="voters-${poll.id}-${i}">
                  <div class="poll-voters-avatars">
                    ${voterIds.slice(0, 5).map(uid => `
                      <div class="poll-voter-chip" data-uid="${uid}">
                        <div class="poll-voter-avatar"></div>
                        <span class="poll-voter-name">Loading...</span>
                      </div>
                    `).join('')}
                    ${voterIds.length > 5 ? `<span class="poll-voters-more">+${voterIds.length - 5} more</span>` : ''}
                  </div>
                  ${voterIds.length > 5 ? `
                    <button class="poll-voters-expand" data-poll="${poll.id}" data-opt="${i}">
                      View all ${optVotes} voters
                    </button>
                    <div class="poll-voters-full hidden" id="voters-full-${poll.id}-${i}"></div>
                  ` : ''}
                </div>
              ` : ''}
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
  `;

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

  // Animate poll bars from 0 to target width
  requestAnimationFrame(() => {
    card.querySelectorAll('.poll-result-fill[data-target]').forEach(bar => {
      setTimeout(() => { bar.style.width = bar.dataset.target + '%'; }, 100);
    });
  });

  // Resolve voter names inline (auto-load visible voters)
  if (hasVoted || isExpired) {
    resolveVoterNames(card, poll);
  }

  // Expand full voter list
  card.querySelectorAll('.poll-voters-expand').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fullEl = card.querySelector(`#voters-full-${btn.dataset.poll}-${btn.dataset.opt}`);
      if (!fullEl) return;
      fullEl.classList.toggle('hidden');
      if (!fullEl.dataset.loaded) {
        fullEl.dataset.loaded = 'true';
        const optIdx = parseInt(btn.dataset.opt);
        const voterIds = poll.options[optIdx]?.votes || [];
        fullEl.innerHTML = '<div class="text-[10px] text-gray-400 py-1">Loading all voters...</div>';
        const names = [];
        for (const uid of voterIds) {
          try {
            const snap = await getDoc(doc(db, 'users', uid));
            names.push(snap.exists() ? snap.data().fullName || 'Unknown' : 'Unknown');
          } catch { names.push('Unknown'); }
        }
        fullEl.innerHTML = names.map(n => `
          <div class="poll-voter-chip">
            <div class="poll-voter-avatar-sm">${n[0]}</div>
            <span class="poll-voter-name">${sanitizeHTML(n)}</span>
          </div>
        `).join('');
      }
    });
  });

  return card;
}

// Resolve voter names for inline display
async function resolveVoterNames(card, poll) {
  for (let i = 0; i < poll.options.length; i++) {
    const voterIds = poll.options[i]?.votes || [];
    const chips = card.querySelectorAll(`#voters-${poll.id}-${i} .poll-voter-chip`);
    for (const chip of chips) {
      const uid = chip.dataset.uid;
      if (!uid) continue;
      try {
        const snap = await getDoc(doc(db, 'users', uid));
        const userData = snap.exists() ? snap.data() : {};
        const name = userData.fullName || 'Unknown';
        const initial = name[0] || '?';
        chip.querySelector('.poll-voter-avatar').textContent = initial;
        chip.querySelector('.poll-voter-avatar').style.background = `linear-gradient(135deg, #1e3a5f, #5c82b7)`;
        chip.querySelector('.poll-voter-avatar').style.color = '#fff';
        chip.querySelector('.poll-voter-name').textContent = name;
      } catch {
        chip.querySelector('.poll-voter-name').textContent = 'Unknown';
      }
    }
  }
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
      await addDoc(collection(db, 'polls'), {
        question,
        options: options.map(text => ({ text, votes: [] })),
        authorId: authManager.currentUser.uid,
        authorName: authManager.userData?.fullName || 'Unknown',
        createdAt: serverTimestamp()
      });
      showToast('Poll created! 📊', 'success');
      modal.close();
    } catch (e) {
      console.error('Create poll error:', e);
      showToast('Failed to create poll', 'error');
    }
  });
}
