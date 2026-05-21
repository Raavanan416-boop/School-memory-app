// Games page — All 6 games fully playable with Firebase scoring
import { db, collection, addDoc, getDocs, query, where, orderBy, limit, doc, updateDoc, serverTimestamp, onSnapshot, arrayUnion } from '../firebase-config.js';
import { showToast, sanitizeHTML, TRUTH_QUESTIONS, DARE_CHALLENGES, NEVER_HAVE_I_EVER } from '../utils.js';
import { authManager } from '../auth.js';
import { router } from '../router.js';
import { createNotification } from '../notifications.js';

export async function renderGames(container) {
  const games = [
    { id: 'truth-or-dare', icon: '🎯', name: 'Truth or Dare', desc: 'Classic party game with school twists', bg: 'bg-red-50', border: 'border-red-100' },
    { id: 'spin-the-bottle', icon: '🍾', name: 'Spin the Bottle', desc: 'Let fate decide!', bg: 'bg-purple-50', border: 'border-purple-100' },
    { id: 'guess-the-memory', icon: '🧠', name: 'Guess The Memory', desc: 'Whose memory is this?', bg: 'bg-blue-50', border: 'border-blue-100' },
    { id: 'quiz-friends', icon: '📝', name: 'Quiz About Friends', desc: 'How well do you know them?', bg: 'bg-green-50', border: 'border-green-100' },
    { id: 'who-said-this', icon: '💬', name: 'Who Said This?', desc: 'Match quotes to classmates', bg: 'bg-yellow-50', border: 'border-yellow-100' },
    { id: 'never-have-i-ever', icon: '🙅', name: 'Never Have I Ever', desc: 'Find out who did what!', bg: 'bg-orange-50', border: 'border-orange-100' }
  ];

  container.innerHTML = `
    <section class="px-4 pt-4">
      <div class="flex items-center gap-3 mb-1">
        <button id="games-back-btn" class="inner-back-btn">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
        </button>
        <h2 class="text-xl font-bold text-navy-800 flex-1">Games</h2>
      </div>
      <p class="text-sm text-gray-400 mb-5 font-handwriting text-base">Fun never ends with friends 🎮</p>

      <div class="space-y-3" id="games-list">
        ${games.map(g => `
          <div class="game-card border ${g.border}" data-game="${g.id}">
            <div class="w-12 h-12 rounded-xl ${g.bg} flex items-center justify-center text-xl flex-shrink-0">${g.icon}</div>
            <div class="flex-1 min-w-0">
              <p class="font-semibold text-sm text-navy-800">${g.name}</p>
              <p class="text-xs text-gray-400">${g.desc}</p>
            </div>
            <svg class="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
          </div>
        `).join('')}
      </div>

      <!-- Polls shortcut -->
      <div class="mt-6 mb-4">
        <button id="go-polls-btn" class="w-full card p-4 flex items-center gap-3 hover:shadow-lg transition-shadow">
          <div class="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center text-xl flex-shrink-0">📊</div>
          <div class="flex-1 text-left">
            <p class="font-semibold text-sm text-navy-800">Polls & Voting</p>
            <p class="text-xs text-gray-400">Create polls and vote with classmates</p>
          </div>
          <svg class="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
        </button>
      </div>
    </section>
  `;

  container.querySelector('#go-polls-btn')?.addEventListener('click', () => router.navigate('polls'));
  container.querySelector('#games-back-btn')?.addEventListener('click', () => router.navigateBack());

  container.querySelectorAll('.game-card').forEach(card => {
    card.addEventListener('click', () => {
      const gameId = card.dataset.game;
      launchGame(gameId);
    });
  });
}

async function launchGame(gameId) {
  const handlers = {
    'truth-or-dare': launchTruthOrDare,
    'spin-the-bottle': launchSpinTheBottle,
    'guess-the-memory': launchGuessTheMemory,
    'quiz-friends': launchQuizFriends,
    'who-said-this': launchWhoSaidThis,
    'never-have-i-ever': launchNeverHaveIEver
  };
  if (handlers[gameId]) handlers[gameId]();
}

// ===== TRUTH OR DARE =====
function launchTruthOrDare() {
  const modal = router.openModal('', { title: '🎯 Truth or Dare', fullscreen: true });
  showTruthOrDareScreen(modal.body);
}

function showTruthOrDareScreen(body) {
  body.innerHTML = `
    <div class="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
      <div class="text-6xl mb-6 animate-float">🎯</div>
      <h3 class="text-xl font-bold text-navy-800 mb-2">Truth or Dare?</h3>
      <p class="text-sm text-gray-400 mb-8">Choose wisely, classmate!</p>
      <div class="flex gap-4 w-full max-w-xs">
        <button class="flex-1 py-4 rounded-2xl bg-blue-500 text-white font-bold text-lg active:scale-95 transition-transform" id="pick-truth">
          TRUTH
        </button>
        <button class="flex-1 py-4 rounded-2xl bg-red-500 text-white font-bold text-lg active:scale-95 transition-transform" id="pick-dare">
          DARE
        </button>
      </div>
    </div>
    <div id="tod-result" class="hidden"></div>
  `;

  body.querySelector('#pick-truth')?.addEventListener('click', () => {
    const q = TRUTH_QUESTIONS[Math.floor(Math.random() * TRUTH_QUESTIONS.length)];
    showTODResult(body, 'TRUTH', q, '💭');
  });

  body.querySelector('#pick-dare')?.addEventListener('click', () => {
    const d = DARE_CHALLENGES[Math.floor(Math.random() * DARE_CHALLENGES.length)];
    showTODResult(body, 'DARE', d, '🔥');
  });
}

function showTODResult(body, type, text, emoji) {
  const resultEl = body.querySelector('#tod-result');
  resultEl.classList.remove('hidden');
  resultEl.innerHTML = `
    <div class="p-6 text-center animate-slideUp">
      <div class="card p-6 max-w-sm mx-auto">
        <div class="text-4xl mb-3">${emoji}</div>
        <span class="text-xs font-bold uppercase tracking-widest ${type === 'TRUTH' ? 'text-blue-500' : 'text-red-500'}">${type}</span>
        <p class="text-lg font-semibold text-navy-800 mt-3 mb-4">${text}</p>
        <button class="btn-primary" id="tod-again">SPIN AGAIN</button>
      </div>
    </div>
  `;
  resultEl.querySelector('#tod-again')?.addEventListener('click', () => {
    resultEl.classList.add('hidden');
    showTruthOrDareScreen(body);
  });
}

// ===== SPIN THE BOTTLE =====
async function launchSpinTheBottle() {
  let users = [];
  try {
    const snap = await getDocs(collection(db, 'users'));
    snap.forEach(d => users.push({ id: d.id, ...d.data() }));
  } catch (e) { }

  const modal = router.openModal('', { title: '🍾 Spin the Bottle', fullscreen: true });
  modal.body.innerHTML = `
    <div class="flex flex-col items-center justify-center min-h-[60vh] p-6">
      <div class="relative w-48 h-48 mb-6">
        <div class="absolute inset-0 rounded-full border-4 border-dashed border-navy-200"></div>
        <div id="bottle" class="absolute inset-0 flex items-center justify-center transition-transform" style="transform: rotate(0deg)">
          <div class="text-6xl">🍾</div>
        </div>
      </div>
      <p id="spin-result" class="text-lg font-bold text-navy-800 mb-4 h-8"></p>
      <button id="spin-btn" class="btn-primary max-w-xs">SPIN!</button>
    </div>
  `;

  const bottle = modal.body.querySelector('#bottle');
  const resultEl = modal.body.querySelector('#spin-result');
  let spinning = false;

  modal.body.querySelector('#spin-btn')?.addEventListener('click', () => {
    if (spinning || users.length === 0) return;
    spinning = true;
    resultEl.textContent = '';

    const randomUser = users[Math.floor(Math.random() * users.length)];
    const rotations = 5 + Math.random() * 5;
    const degrees = rotations * 360 + Math.random() * 360;

    bottle.style.transition = 'transform 3s cubic-bezier(0.17, 0.67, 0.12, 0.99)';
    bottle.style.transform = `rotate(${degrees}deg)`;

    setTimeout(() => {
      spinning = false;
      resultEl.innerHTML = `🎉 <span class="text-navy-500">${sanitizeHTML(randomUser.fullName || 'Someone')}</span>!`;
    }, 3200);
  });
}

// ===== GUESS THE MEMORY =====
async function launchGuessTheMemory() {
  let posts = [];
  let users = [];
  try {
    const postSnap = await getDocs(query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(30)));
    postSnap.forEach(d => posts.push({ id: d.id, ...d.data() }));
    const userSnap = await getDocs(collection(db, 'users'));
    userSnap.forEach(d => users.push({ id: d.id, ...d.data() }));
  } catch (e) { }

  if (posts.length < 2) {
    showToast('Need more posts to play this game!', 'warning');
    return;
  }

  const modal = router.openModal('', { title: '🧠 Guess The Memory', fullscreen: true });
  let score = 0;
  let round = 0;
  const maxRounds = Math.min(5, posts.length);

  function nextRound() {
    if (round >= maxRounds) {
      modal.body.innerHTML = `
        <div class="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
          <div class="text-6xl mb-4">🏆</div>
          <h3 class="text-2xl font-bold text-navy-800">Game Over!</h3>
          <p class="text-lg text-gray-500 mt-2">Score: <span class="font-bold text-navy-500">${score}/${maxRounds}</span></p>
          <button class="btn-primary max-w-xs mt-6" id="play-again">Play Again</button>
        </div>
      `;
      modal.body.querySelector('#play-again')?.addEventListener('click', () => {
        score = 0; round = 0; nextRound();
      });
      // Save score
      saveGameScore('guess-the-memory', score);
      return;
    }

    const post = posts[round];
    const correctUser = users.find(u => u.id === post.authorId);
    const wrongUsers = users.filter(u => u.id !== post.authorId).sort(() => Math.random() - 0.5).slice(0, 3);
    const options = [...wrongUsers, correctUser].sort(() => Math.random() - 0.5);

    modal.body.innerHTML = `
      <div class="p-4">
        <div class="flex items-center justify-between mb-4">
          <span class="text-xs text-gray-400">Round ${round + 1}/${maxRounds}</span>
          <span class="text-xs font-bold text-navy-500">Score: ${score}</span>
        </div>
        <h3 class="text-sm font-semibold text-navy-800 text-center mb-3">Who posted this memory?</h3>
        ${post.imageUrl ? `<img src="${post.imageUrl}" class="w-full aspect-video object-cover rounded-2xl mb-4 border-2 border-cream-300" alt=""/>` : ''}
        ${post.caption ? `<p class="text-sm text-gray-600 text-center mb-4 italic">"${sanitizeHTML(post.caption)}"</p>` : ''}
        <div class="space-y-2" id="answer-options">
          ${options.map(u => `
            <button class="w-full p-3 rounded-xl border border-gray-200 text-sm font-medium text-navy-800 hover:bg-cream-50 transition-colors answer-btn" data-uid="${u.id}">
              ${sanitizeHTML(u.fullName || 'Unknown')}
            </button>
          `).join('')}
        </div>
      </div>
    `;

    modal.body.querySelectorAll('.answer-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const isCorrect = btn.dataset.uid === post.authorId;
        if (isCorrect) {
          score++;
          btn.classList.add('bg-green-100', 'border-green-400', 'text-green-700');
          showToast('Correct! 🎉', 'success');
        } else {
          btn.classList.add('bg-red-100', 'border-red-400', 'text-red-700');
          // Highlight correct answer
          modal.body.querySelector(`[data-uid="${post.authorId}"]`)?.classList.add('bg-green-100', 'border-green-400', 'text-green-700');
          showToast(`It was ${correctUser?.fullName || 'Unknown'}!`, 'info');
        }
        modal.body.querySelectorAll('.answer-btn').forEach(b => b.disabled = true);
        round++;
        setTimeout(() => nextRound(), 1500);
      });
    });
  }

  nextRound();
}

// ===== QUIZ ABOUT FRIENDS =====
async function launchQuizFriends() {
  let users = [];
  try {
    const snap = await getDocs(collection(db, 'users'));
    snap.forEach(d => users.push({ id: d.id, ...d.data() }));
  } catch (e) { }

  if (users.length < 3) {
    showToast('Need more users to play!', 'warning');
    return;
  }

  const modal = router.openModal('', { title: '📝 Quiz About Friends', fullscreen: true });
  let score = 0;
  let round = 0;
  const maxRounds = 5;

  const questionTypes = [
    { q: (u) => `What is ${u.fullName}'s nickname?`, a: (u) => u.nickname, field: 'nickname' },
    { q: (u) => `When is ${u.fullName}'s birthday?`, a: (u) => u.dateOfBirth, field: 'dateOfBirth' },
    { q: (u) => `What is ${u.fullName}'s favorite school memory?`, a: (u) => u.slamBook?.favoriteMemory, field: 'slamBook.favoriteMemory' },
    { q: (u) => `Who is ${u.fullName}'s best friend in class?`, a: (u) => u.slamBook?.bestFriend, field: 'slamBook.bestFriend' },
  ];

  function nextRound() {
    if (round >= maxRounds) {
      modal.body.innerHTML = `
        <div class="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
          <div class="text-6xl mb-4">📝</div>
          <h3 class="text-2xl font-bold text-navy-800">Quiz Complete!</h3>
          <p class="text-lg text-gray-500 mt-2">Score: <span class="font-bold text-navy-500">${score}/${maxRounds}</span></p>
          <button class="btn-primary max-w-xs mt-6" id="play-again">Play Again</button>
        </div>
      `;
      modal.body.querySelector('#play-again')?.addEventListener('click', () => {
        score = 0; round = 0; nextRound();
      });
      saveGameScore('quiz-friends', score);
      return;
    }

    const qt = questionTypes[Math.floor(Math.random() * questionTypes.length)];
    const eligibleUsers = users.filter(u => qt.a(u));
    if (eligibleUsers.length === 0) { round++; nextRound(); return; }

    const targetUser = eligibleUsers[Math.floor(Math.random() * eligibleUsers.length)];
    const correctAnswer = qt.a(targetUser);
    const wrongAnswers = users.filter(u => u.id !== targetUser.id && qt.a(u)).map(u => qt.a(u)).sort(() => Math.random() - 0.5).slice(0, 2);
    wrongAnswers.push('I don\'t know 🤷');
    const options = [correctAnswer, ...wrongAnswers].sort(() => Math.random() - 0.5);

    modal.body.innerHTML = `
      <div class="p-6 text-center">
        <div class="flex items-center justify-between mb-4">
          <span class="text-xs text-gray-400">Q${round + 1}/${maxRounds}</span>
          <span class="text-xs font-bold text-navy-500">Score: ${score}</span>
        </div>
        <p class="text-lg font-semibold text-navy-800 mb-6">${qt.q(targetUser)}</p>
        <div class="space-y-3" id="quiz-options">
          ${options.map(opt => `
            <button class="w-full p-3 rounded-xl border border-gray-200 text-sm text-navy-800 hover:bg-cream-50 transition-colors quiz-btn" data-answer="${sanitizeHTML(opt)}">
              ${sanitizeHTML(opt)}
            </button>
          `).join('')}
        </div>
      </div>
    `;

    modal.body.querySelectorAll('.quiz-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const isCorrect = btn.dataset.answer === correctAnswer;
        if (isCorrect) { score++; btn.classList.add('bg-green-100', 'border-green-400'); }
        else {
          btn.classList.add('bg-red-100', 'border-red-400');
          modal.body.querySelector(`[data-answer="${sanitizeHTML(correctAnswer)}"]`)?.classList.add('bg-green-100', 'border-green-400');
        }
        modal.body.querySelectorAll('.quiz-btn').forEach(b => b.disabled = true);
        round++;
        setTimeout(() => nextRound(), 1500);
      });
    });
  }

  nextRound();
}

// ===== WHO SAID THIS? =====
async function launchWhoSaidThis() {
  let posts = [];
  let users = [];
  try {
    const postSnap = await getDocs(query(collection(db, 'posts'), where('caption', '!=', ''), orderBy('caption'), limit(30)));
    postSnap.forEach(d => posts.push({ id: d.id, ...d.data() }));
    const userSnap = await getDocs(collection(db, 'users'));
    userSnap.forEach(d => users.push({ id: d.id, ...d.data() }));
  } catch (e) {
    // Fallback - get all posts
    try {
      const postSnap = await getDocs(query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(30)));
      postSnap.forEach(d => {
        const p = d.data();
        if (p.caption) posts.push({ id: d.id, ...p });
      });
      const userSnap = await getDocs(collection(db, 'users'));
      userSnap.forEach(d => users.push({ id: d.id, ...d.data() }));
    } catch (e2) { }
  }

  if (posts.length < 2) {
    showToast('Need more posts with captions to play!', 'warning');
    return;
  }

  const modal = router.openModal('', { title: '💬 Who Said This?', fullscreen: true });
  let score = 0;
  let round = 0;
  const maxRounds = Math.min(5, posts.length);

  function nextRound() {
    if (round >= maxRounds) {
      modal.body.innerHTML = `
        <div class="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
          <div class="text-6xl mb-4">💬</div>
          <h3 class="text-2xl font-bold text-navy-800">Game Over!</h3>
          <p class="text-lg text-gray-500 mt-2">Score: <span class="font-bold text-navy-500">${score}/${maxRounds}</span></p>
          <button class="btn-primary max-w-xs mt-6" id="play-again">Play Again</button>
        </div>
      `;
      modal.body.querySelector('#play-again')?.addEventListener('click', () => {
        score = 0; round = 0; nextRound();
      });
      saveGameScore('who-said-this', score);
      return;
    }

    const post = posts[round];
    const correctUser = users.find(u => u.id === post.authorId);
    const wrongUsers = users.filter(u => u.id !== post.authorId).sort(() => Math.random() - 0.5).slice(0, 3);
    const options = [...wrongUsers, correctUser].filter(Boolean).sort(() => Math.random() - 0.5);

    modal.body.innerHTML = `
      <div class="p-6 text-center">
        <div class="flex items-center justify-between mb-4">
          <span class="text-xs text-gray-400">Round ${round + 1}/${maxRounds}</span>
          <span class="text-xs font-bold text-navy-500">Score: ${score}</span>
        </div>
        <div class="card p-6 mb-6 notebook-bg">
          <p class="font-handwriting text-xl text-navy-700">"${sanitizeHTML(post.caption)}"</p>
        </div>
        <p class="text-sm text-gray-400 mb-4">Who wrote this?</p>
        <div class="space-y-2">
          ${options.map(u => `
            <button class="w-full p-3 rounded-xl border border-gray-200 text-sm font-medium text-navy-800 hover:bg-cream-50 transition-colors answer-btn" data-uid="${u.id}">
              ${sanitizeHTML(u.fullName || 'Unknown')}
            </button>
          `).join('')}
        </div>
      </div>
    `;

    modal.body.querySelectorAll('.answer-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const isCorrect = btn.dataset.uid === post.authorId;
        if (isCorrect) { score++; btn.classList.add('bg-green-100', 'border-green-400', 'text-green-700'); }
        else {
          btn.classList.add('bg-red-100', 'border-red-400', 'text-red-700');
          modal.body.querySelector(`[data-uid="${post.authorId}"]`)?.classList.add('bg-green-100', 'border-green-400', 'text-green-700');
        }
        modal.body.querySelectorAll('.answer-btn').forEach(b => b.disabled = true);
        round++;
        setTimeout(() => nextRound(), 1500);
      });
    });
  }

  nextRound();
}

// ===== NEVER HAVE I EVER =====
async function launchNeverHaveIEver() {
  const modal = router.openModal('', { title: '🙅 Never Have I Ever', fullscreen: true });
  let currentIdx = 0;

  async function showStatement() {
    if (currentIdx >= NEVER_HAVE_I_EVER.length) currentIdx = 0;
    const statement = NEVER_HAVE_I_EVER[currentIdx];
    const statementId = `nhie_${currentIdx}`;

    // Get current votes
    let haveCount = 0, haventCount = 0, myVote = null;
    try {
      const voteSnap = await getDocs(query(collection(db, 'games'), where('type', '==', 'nhie'), where('statementId', '==', statementId)));
      voteSnap.forEach(d => {
        const v = d.data();
        if (v.vote === 'have') haveCount++;
        else haventCount++;
        if (v.userId === authManager.currentUser?.uid) myVote = v.vote;
      });
    } catch (e) { }

    const total = haveCount + haventCount;
    const havePct = total > 0 ? Math.round((haveCount / total) * 100) : 50;

    modal.body.innerHTML = `
      <div class="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
        <div class="text-5xl mb-6">🙅</div>
        <div class="card p-6 w-full max-w-sm mb-6">
          <p class="text-lg font-semibold text-navy-800">${statement}</p>
        </div>

        ${myVote ? `
          <div class="w-full max-w-sm mb-6">
            <div class="flex items-center justify-between text-xs text-gray-400 mb-2">
              <span>I have (${haveCount})</span>
              <span>I haven't (${haventCount})</span>
            </div>
            <div class="w-full h-3 bg-gray-100 rounded-full overflow-hidden flex">
              <div class="h-full bg-green-400 transition-all duration-500" style="width:${havePct}%"></div>
              <div class="h-full bg-red-400 transition-all duration-500" style="width:${100 - havePct}%"></div>
            </div>
            <p class="text-xs text-gray-400 mt-2">${total} classmates answered</p>
          </div>
        ` : `
          <div class="flex gap-4 w-full max-w-xs mb-6">
            <button class="flex-1 py-3 rounded-2xl bg-green-500 text-white font-bold active:scale-95 transition-transform nhie-vote" data-vote="have">
              I HAVE ✋
            </button>
            <button class="flex-1 py-3 rounded-2xl bg-red-500 text-white font-bold active:scale-95 transition-transform nhie-vote" data-vote="havent">
              I HAVEN'T 🙅
            </button>
          </div>
        `}

        <button class="text-sm text-navy-500 font-semibold" id="next-statement">Next Statement →</button>
      </div>
    `;

    // Vote handlers
    modal.body.querySelectorAll('.nhie-vote').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!authManager.currentUser) return;
        try {
          await addDoc(collection(db, 'games'), {
            type: 'nhie',
            statementId,
            userId: authManager.currentUser.uid,
            userName: authManager.userData?.fullName || 'Unknown',
            vote: btn.dataset.vote,
            createdAt: serverTimestamp()
          });
          showStatement(); // Refresh to show results
        } catch (e) { console.error(e); }
      });
    });

    modal.body.querySelector('#next-statement')?.addEventListener('click', () => {
      currentIdx++;
      showStatement();
    });
  }

  showStatement();
}

// ===== SAVE GAME SCORE =====
async function saveGameScore(gameType, score) {
  if (!authManager.currentUser) return;
  try {
    await addDoc(collection(db, 'games'), {
      type: 'score',
      gameType,
      userId: authManager.currentUser.uid,
      userName: authManager.userData?.fullName || 'Unknown',
      score,
      createdAt: serverTimestamp()
    });
  } catch (e) { console.error('Save score error:', e); }
}
