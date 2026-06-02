import { db, doc, getDoc, getDocs, collection, query, where, orderBy, addDoc, onSnapshot, serverTimestamp, updateDoc, deleteDoc, limit } from '../firebase-config.js';
import { authManager, awardPoints } from '../auth.js';
import { router } from '../router.js';
import { showToast, sanitizeHTML, timeAgo } from '../utils.js';
import { showDeleteConfirmation } from '../delete-confirm.js';

let unsubSlam = null;
let unsubBooks = null;

export function destroySlamBook() {
  if (unsubSlam) { unsubSlam(); unsubSlam = null; }
  if (unsubBooks) { unsubBooks(); unsubBooks = null; }
}

export async function renderSlamBookTab(el, user, viewingOther) {
  destroySlamBook();

  const q = query(collection(db, 'slambooks'), where('ownerId', '==', user.id));

  el.innerHTML = '<div class="p-8 text-center text-gray-400">Loading Slam Books...</div>';

  unsubBooks = onSnapshot(q, (snap) => {
    const books = [];
    snap.forEach(d => books.push({ id: d.id, ...d.data() }));

    // Sort descending client-side to avoid requiring composite index
    books.sort((a, b) => {
      const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });

    if (!viewingOther) {
      renderOwnerBooksList(el, user, books);
    } else {
      renderGuestBooksList(el, user, books);
    }
  });
}

// -----------------------------------------
// OWNER VIEW: LIST BOOKS
// -----------------------------------------
function renderOwnerBooksList(el, user, books) {
  if (books.length === 0) {
    el.innerHTML = `
      <div class="px-4 py-10 text-center animate-fadeIn">
        <div class="text-5xl mb-4">📚</div>
        <h3 class="text-xl font-bold text-navy-800 mb-2 font-handwriting">Create Your First Slam Book</h3>
        <p class="text-sm text-gray-500 mb-6">Ask your friends anything! Add custom questions, emojis, and more.</p>
        <button id="btn-create-slambook" class="px-6 py-3 bg-navy-600 hover:bg-navy-700 text-white font-bold rounded-xl shadow-lg transition-all transform hover:scale-105">+ Build My Slam Book (+5 Pts)</button>
      </div>
    `;
    el.querySelector('#btn-create-slambook')?.addEventListener('click', () => showSlamBookConfigurator());
    return;
  }

  el.innerHTML = `
    <div class="px-4 py-4 animate-fadeIn">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-bold text-navy-800 font-handwriting">📚 My Slam Books</h3>
        <button id="btn-create-slambook" class="text-xs px-3 py-1.5 bg-navy-600 text-white font-bold rounded-lg shadow hover:bg-navy-700">+ Create</button>
      </div>
      
      <div class="space-y-4">
        ${books.map(b => `
          <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden cursor-pointer hover:shadow-md transition-shadow slambook-card" data-id="${b.id}">
            <div class="h-20 bg-gradient-to-r from-indigo-500 to-purple-600 relative">
              <div class="absolute inset-0 opacity-20 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjIiIGZpbGw9IiNmZmYiLz48L3N2Zz4=')]"></div>
            </div>
            <div class="p-4 relative">
              <div class="absolute -top-10 right-4 w-16 h-20 bg-white rounded shadow border-l-4 border-indigo-500 flex items-center justify-center">
                <span class="text-3xl">📖</span>
              </div>
              <h4 class="font-bold text-navy-800 text-lg mb-1">${sanitizeHTML(b.title || 'Untitled Book')}</h4>
              <p class="text-xs text-gray-500 mb-3">${b.questions?.length || 0} Questions • ${b.visibility === 'public' ? '🌍 Public' : '👥 Friends Only'}</p>
              
              <div class="flex items-center gap-2">
                <button class="flex-1 text-xs py-2 bg-indigo-50 text-indigo-700 font-bold rounded-lg btn-dashboard" data-id="${b.id}">View Dashboard</button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  el.querySelector('#btn-create-slambook')?.addEventListener('click', () => showSlamBookConfigurator());

  el.querySelectorAll('.btn-dashboard').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const book = books.find(b => b.id === btn.dataset.id);
      if (book) openOwnerDashboard(book);
    });
  });



  el.querySelectorAll('.slambook-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const book = books.find(b => b.id === card.dataset.id);
      if (book) showSlamBookConfigurator(book);
    });
  });
}

// -----------------------------------------
// GUEST VIEW: LIST BOOKS
// -----------------------------------------
function renderGuestBooksList(el, user, books) {
  // Simple check for friendship could be added here. For now assume if they can see the profile, they can see 'public'.
  // If visibility is 'close', we'd normally check friends list. 

  if (books.length === 0) {
    el.innerHTML = `
      <div class="px-4 py-16 text-center animate-fadeIn">
        <div class="text-5xl mb-4">📘</div>
        <h3 class="text-xl font-bold text-navy-800 mb-2 font-handwriting">${user.fullName}'s Slam Books</h3>
        <p class="text-sm text-gray-500">They haven't created any Slam Books yet!</p>
      </div>
    `;
    return;
  }

  el.innerHTML = `
    <div class="px-4 py-6 animate-fadeIn">
      <h3 class="text-lg font-bold text-navy-800 font-handwriting mb-4">📘 Write in ${sanitizeHTML(user.fullName)}'s Books</h3>
      <div class="grid grid-cols-2 gap-4">
        ${books.map(b => `
          <div class="cursor-pointer relative aspect-[3/4] bg-gradient-to-br from-indigo-500 to-purple-600 rounded-r-2xl rounded-l shadow-lg overflow-hidden transform hover:-translate-y-1 transition-all guest-book-card" data-id="${b.id}">
            <div class="absolute left-0 top-0 bottom-0 w-4 bg-black/20 z-10"></div>
            <div class="absolute inset-0 p-4 flex flex-col justify-center items-center text-center">
              <p class="font-handwriting text-xl text-white font-bold leading-tight mb-2">${sanitizeHTML(b.title || 'Slam Book')}</p>
              <p class="text-white/80 text-[10px] uppercase tracking-widest bg-white/20 px-2 py-1 rounded">${b.questions?.length || 0} Qs</p>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  el.querySelectorAll('.guest-book-card').forEach(card => {
    card.addEventListener('click', () => {
      const book = books.find(b => b.id === card.dataset.id);
      if (book) openGuestWriter(user, book);
    });
  });
}

// -----------------------------------------
// CONFIGURATOR (OWNER)
// -----------------------------------------
function showSlamBookConfigurator(existingBook = null) {
  let title = existingBook?.title || 'My School Memories';
  let description = existingBook?.description || '';
  let visibility = existingBook?.visibility || 'public';
  let allowAnonymous = existingBook?.allowAnonymous ?? true;

  let questions = existingBook?.questions ? JSON.parse(JSON.stringify(existingBook.questions)) : [
    { id: 'q1', type: 'memory', text: 'What is your favorite memory with me?', isRequired: true },
    { id: 'q2', type: 'text', text: 'Describe me in 3 words!', isRequired: true }
  ];

  const modal = router.openModal('slambook-config', { title: existingBook ? '⚙️ Edit Book' : '➕ New Book', fullScreen: true });

  const renderQuestions = () => {
    const listEl = modal.body.querySelector('#sb-question-list');
    if (!listEl) return;

    listEl.innerHTML = questions.map((q, index) => {
      const isChoice = q.type === 'radio' || q.type === 'checkbox' || q.type === 'emoji';

      return `
      <div class="bg-white border border-gray-200 p-4 rounded-2xl shadow-sm mb-4 relative group">
        <div class="flex items-center justify-between mb-3">
          <span class="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded uppercase tracking-wider">Question ${index + 1}</span>
          <div class="flex items-center gap-1">
            ${index > 0 ? `<button class="p-1.5 text-gray-400 hover:text-navy-600 bg-gray-50 rounded" onclick="window.sbMoveQ(${index}, -1)"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7"/></svg></button>` : ''}
            ${index < questions.length - 1 ? `<button class="p-1.5 text-gray-400 hover:text-navy-600 bg-gray-50 rounded" onclick="window.sbMoveQ(${index}, 1)"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg></button>` : ''}
            <button class="p-1.5 text-blue-400 hover:text-blue-600 bg-blue-50 rounded ml-2" onclick="window.sbDupQ(${index})"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"/></svg></button>
            <button class="p-1.5 text-red-400 hover:text-red-600 bg-red-50 rounded" onclick="window.sbRemoveQ(${index})"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
          </div>
        </div>
        
        <input type="text" value="${sanitizeHTML(q.text)}" onchange="window.sbUpdateQ(${index}, 'text', this.value)" class="w-full px-3 py-2 border-b-2 border-gray-100 focus:border-indigo-500 focus:outline-none text-sm font-bold text-navy-800 bg-transparent mb-3" placeholder="What do you want to ask?"/>
        
        <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
          <select onchange="window.sbUpdateQ(${index}, 'type', this.value)" class="text-xs px-3 py-2 border border-gray-200 rounded-lg text-gray-700 bg-gray-50 focus:outline-none font-semibold flex-1 min-w-[120px]">
            <option value="text" ${q.type === 'text' ? 'selected' : ''}>Text (Short)</option>
            <option value="paragraph" ${q.type === 'paragraph' ? 'selected' : ''}>Paragraph (Long)</option>
            <option value="radio" ${q.type === 'radio' ? 'selected' : ''}>Single Choice</option>
            <option value="checkbox" ${q.type === 'checkbox' ? 'selected' : ''}>Multiple Choice</option>
            <option value="emoji" ${q.type === 'emoji' ? 'selected' : ''}>Emoji Choice</option>
            <option value="rating_5" ${q.type === 'rating_5' ? 'selected' : ''}>Rating (1-5 Stars)</option>
            <option value="rating_10" ${q.type === 'rating_10' ? 'selected' : ''}>Rating (1-10 Scale)</option>
            <option value="yes_no" ${q.type === 'yes_no' ? 'selected' : ''}>Yes / No</option>
            <option value="date" ${q.type === 'date' ? 'selected' : ''}>Date</option>
            <option value="memory" ${q.type === 'memory' ? 'selected' : ''}>Favorite Memory (Special)</option>
          </select>
          <label class="flex items-center gap-2 text-xs font-bold text-gray-600 bg-gray-50 px-3 py-2 rounded-lg cursor-pointer">
            <input type="checkbox" ${q.isRequired ? 'checked' : ''} onchange="window.sbUpdateQ(${index}, 'isRequired', this.checked)" class="w-4 h-4 text-indigo-600 rounded"/>
            Required
          </label>
        </div>

        ${isChoice ? `
          <div class="pl-2 border-l-2 border-indigo-100 space-y-2 mt-2">
            ${(q.options || ['Option 1']).map((opt, oIdx) => `
              <div class="flex items-center gap-2">
                <span class="text-xs text-gray-300">○</span>
                <input type="text" value="${sanitizeHTML(opt)}" onchange="window.sbUpdateOpt(${index}, ${oIdx}, this.value)" class="text-xs flex-1 px-2 py-1.5 border border-gray-100 rounded focus:border-indigo-300 focus:outline-none" placeholder="Option..."/>
                <button onclick="window.sbRemoveOpt(${index}, ${oIdx})" class="text-gray-400 hover:text-red-500">×</button>
              </div>
            `).join('')}
            <button onclick="window.sbAddOpt(${index})" class="text-xs text-indigo-600 font-bold hover:underline mt-1">+ Add Option</button>
          </div>
        ` : ''}
      </div>
      `;
    }).join('');
  };

  window.sbRemoveQ = (i) => { questions.splice(i, 1); renderQuestions(); };
  window.sbUpdateQ = (i, field, val) => {
    questions[i][field] = val;
    if (field === 'type' && (val === 'radio' || val === 'checkbox' || val === 'emoji') && !questions[i].options) {
      questions[i].options = ['Option 1', 'Option 2'];
    }
    if (field === 'type') renderQuestions();
  };
  window.sbMoveQ = (i, dir) => {
    const temp = questions[i];
    questions[i] = questions[i + dir];
    questions[i + dir] = temp;
    renderQuestions();
  };
  window.sbDupQ = (i) => {
    const dup = JSON.parse(JSON.stringify(questions[i]));
    dup.id = 'q' + Date.now();
    questions.splice(i + 1, 0, dup);
    renderQuestions();
  };
  window.sbAddQ = () => { questions.push({ id: 'q' + Date.now(), type: 'text', text: '', isRequired: false }); renderQuestions(); };

  window.sbUpdateOpt = (qIdx, oIdx, val) => { questions[qIdx].options[oIdx] = val; };
  window.sbRemoveOpt = (qIdx, oIdx) => { questions[qIdx].options.splice(oIdx, 1); renderQuestions(); };
  window.sbAddOpt = (qIdx) => { questions[qIdx].options.push('New Option'); renderQuestions(); };

  modal.body.innerHTML = `
    <div class="bg-gray-50 min-h-full pb-20">
      <div class="bg-indigo-600 pt-6 pb-12 px-4 rounded-b-[40px] shadow-sm mb-[-24px]">
        <input type="text" id="sb-title" value="${sanitizeHTML(title)}" class="w-full text-center text-2xl font-bold text-white bg-transparent border-b border-indigo-400 focus:border-white focus:outline-none placeholder-indigo-300 mb-4" placeholder="Book Title"/>
        
        <div class="flex gap-4 max-w-sm mx-auto">
          <div class="flex-1 bg-white/10 p-3 rounded-xl border border-white/20">
            <label class="block text-[10px] uppercase text-indigo-200 font-bold mb-1">Visibility</label>
            <select id="sb-priv" class="w-full text-xs font-bold bg-transparent text-white focus:outline-none">
              <option value="public" class="text-navy-800" ${visibility === 'public' ? 'selected' : ''}>🌍 Public</option>
              <option value="friends" class="text-navy-800" ${visibility === 'friends' ? 'selected' : ''}>👥 Friends Only</option>
            </select>
          </div>
          <div class="flex-1 bg-white/10 p-3 rounded-xl border border-white/20 flex flex-col justify-center items-center cursor-pointer">
            <label class="block text-[10px] uppercase text-indigo-200 font-bold mb-1 text-center cursor-pointer">Allow Anonymous</label>
            <input type="checkbox" id="sb-anon" ${allowAnonymous ? 'checked' : ''} class="w-5 h-5 cursor-pointer"/>
          </div>
        </div>
      </div>

      <div class="px-4 pt-10">
        <div class="flex items-center justify-between mb-4">
          <h4 class="text-xs font-bold text-gray-500 uppercase tracking-wider">Questions (${questions.length})</h4>
          <button onclick="window.sbAddQ()" class="text-xs bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-lg font-bold hover:bg-indigo-200 shadow-sm">+ Add New</button>
        </div>
        
        <div id="sb-question-list" class="space-y-4"></div>
      </div>
    </div>

    <div class="sticky bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-100 z-10">
      <button id="sb-save-config" class="w-full py-4 bg-navy-800 hover:bg-navy-900 text-white font-bold rounded-xl shadow-xl transition-all transform active:scale-95 text-lg">Save Slam Book 📖</button>
      ${existingBook ? `<button id="sb-delete-book" class="w-full py-3 text-red-500 font-bold text-sm bg-red-50 rounded-xl mt-3 hover:bg-red-100 transition-colors">Delete Book</button>` : ''}
    </div>
  `;

  renderQuestions();

  modal.body.querySelector('#sb-save-config').addEventListener('click', async () => {
    const validQuestions = questions.filter(q => q.text.trim().length > 0);
    if (validQuestions.length === 0) { showToast('Add at least 1 question!', 'warning'); return; }

    const finalConfig = {
      ownerId: authManager.currentUser.uid,
      title: modal.body.querySelector('#sb-title').value.trim() || 'My Slam Book',
      visibility: modal.body.querySelector('#sb-priv').value,
      allowAnonymous: modal.body.querySelector('#sb-anon').checked,
      questions: validQuestions,
      updatedAt: serverTimestamp(),
      createdAt: existingBook ? existingBook.createdAt : serverTimestamp()
    };

    const btn = modal.body.querySelector('#sb-save-config');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      if (existingBook) {
        await updateDoc(doc(db, 'slambooks', existingBook.id), finalConfig);
        showToast('Book updated!', 'success');
      } else {
        await addDoc(collection(db, 'slambooks'), finalConfig);
        showToast('Slam Book Created! +5 Points Earned 🌟', 'success');
        await awardPoints(authManager.currentUser.uid, 5, 'Slam Book Created');
      }
      modal.close();
    } catch (e) {
      console.error(e);
      showToast('Failed to save', 'error');
      btn.disabled = false;
      btn.textContent = 'Save Slam Book 📖';
    }
  });

  if (existingBook) {
    modal.body.querySelector('#sb-delete-book')?.addEventListener('click', () => {
      showDeleteConfirmation('this Slam Book', async () => {
        try {
          // Delete all responses first
          const rQ = query(collection(db, 'slambookResponses'), where('slambookId', '==', existingBook.id));
          const snap = await getDocs(rQ);
          const deletePromises = [];
          snap.forEach(d => deletePromises.push(deleteDoc(doc(db, 'slambookResponses', d.id))));
          await Promise.all(deletePromises);

          // Deduct points and delete book
          await awardPoints(existingBook.ownerId, -5, 'Slam Book Deleted');
          await deleteDoc(doc(db, 'slambooks', existingBook.id));
          modal.close();
        } catch (err) {
          console.error(err);
        }
      }, { subtitle: 'ALL responses will be lost forever!' });
    });
  }
}

// -----------------------------------------
// OWNER DASHBOARD & READER
// -----------------------------------------
function openOwnerDashboard(book) {
  const modal = router.openModal('slambook-dash', { title: sanitizeHTML(book.title), fullScreen: true });

  modal.body.innerHTML = `
    <div class="bg-gray-50 min-h-full pb-20">
      <div class="bg-navy-800 pt-6 pb-12 px-4 rounded-b-[40px] text-center shadow-md">
        <h2 class="text-2xl font-bold text-white font-handwriting mb-4">${sanitizeHTML(book.title)}</h2>
        <div class="flex justify-center gap-3">
          <div class="bg-white/10 border border-white/20 p-3 rounded-xl min-w-[100px]">
            <p class="text-3xl font-bold text-white" id="db-stat-total">-</p>
            <p class="text-[10px] text-indigo-200 uppercase font-bold mt-1">Responses</p>
          </div>
          <div class="bg-white/10 border border-white/20 p-3 rounded-xl min-w-[100px]">
            <p class="text-3xl font-bold text-white" id="db-stat-pinned">-</p>
            <p class="text-[10px] text-pink-200 uppercase font-bold mt-1">Pinned</p>
          </div>
        </div>
      </div>
      
      <div class="px-4 mt-6 flex gap-3">
        <button id="db-btn-edit" class="w-full py-3 bg-white border border-gray-200 rounded-xl font-bold text-sm text-navy-700 shadow-sm hover:bg-gray-50">⚙️ Edit Settings</button>
      </div>

      <div class="px-4 mt-8">
        <h3 class="text-sm font-bold text-navy-800 uppercase tracking-wider mb-4 border-b border-gray-200 pb-2">Inbox</h3>
        <div id="db-responses-list" class="space-y-3">
          <p class="text-center text-sm text-gray-400 py-6">Loading responses...</p>
        </div>
      </div>
    </div>
  `;

  modal.body.querySelector('#db-btn-edit').addEventListener('click', () => {
    modal.close();
    showSlamBookConfigurator(book);
  });



  const q = query(collection(db, 'slambookResponses'), where('slambookId', '==', book.id));
  const unsub = onSnapshot(q, (snap) => {
    const listEl = modal.body.querySelector('#db-responses-list');
    if (!listEl) { unsub(); return; } // Modal closed

    if (snap.empty) {
      listEl.innerHTML = `
        <div class="text-center py-10 bg-white rounded-2xl border border-dashed border-gray-300">
          <p class="text-4xl mb-2">📭</p>
          <p class="text-sm text-gray-500 font-semibold">No responses yet</p>
          <p class="text-xs text-gray-400 mt-1">Share your book to get answers!</p>
        </div>
      `;
      modal.body.querySelector('#db-stat-total').textContent = '0';
      modal.body.querySelector('#db-stat-pinned').textContent = '0';
      return;
    }

    let pinnedCount = 0;
    const responses = [];
    snap.forEach(d => {
      const data = { id: d.id, ...d.data() };
      responses.push(data);
      if (data.isPinned) pinnedCount++;
    });

    // Sort descending client-side
    responses.sort((a, b) => {
      const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });

    modal.body.querySelector('#db-stat-total').textContent = responses.length;
    modal.body.querySelector('#db-stat-pinned').textContent = pinnedCount;

    listEl.innerHTML = responses.map(r => {
      const name = r.authorName || 'Anonymous';
      const time = r.createdAt?.toDate ? timeAgo(r.createdAt.toDate()) : 'Just now';
      // Find first text answer for preview
      let preview = 'View answers...';
      for (const key in r.answers) {
        if (typeof r.answers[key] === 'string' && r.answers[key].length > 0) {
          preview = r.answers[key];
          break;
        }
      }

      return `
        <div class="bg-white border border-gray-100 p-4 rounded-2xl shadow-sm cursor-pointer hover:shadow-md transition-all slambook-response-card" data-id="${r.id}">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center text-lg font-bold text-indigo-600">${name.charAt(0).toUpperCase()}</div>
              <div>
                <p class="text-sm font-bold text-navy-800">${sanitizeHTML(name)}</p>
                <p class="text-[10px] text-gray-400 uppercase">${time}</p>
              </div>
            </div>
            ${r.isPinned ? '<span class="text-2xl bg-yellow-50 w-8 h-8 flex items-center justify-center rounded-full">📌</span>' : ''}
          </div>
          <div class="bg-gray-50 p-3 rounded-xl border border-gray-100">
            <p class="text-xs text-gray-600 line-clamp-2 italic font-handwriting text-lg leading-tight">"${sanitizeHTML(preview)}"</p>
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.slambook-response-card').forEach(card => {
      card.addEventListener('click', () => {
        const r = responses.find(res => res.id === card.dataset.id);
        if (r) openResponseReader(r, book);
      });
    });
  });
}

function openResponseReader(response, book) {
  const modal = router.openModal('slambook-reader', { title: '📖 Friend\'s Response' });
  const name = response.authorName || 'Anonymous';

  const renderAnswer = (q, ans) => {
    if (!ans && ans !== 0 && ans !== false) return '<span class="text-gray-400 italic">Skipped</span>';

    switch (q.type) {
      case 'rating_5':
        return '<span class="text-xl text-yellow-400">' + '★'.repeat(parseInt(ans)) + '☆'.repeat(5 - parseInt(ans)) + '</span>';
      case 'rating_10':
        return `<span class="font-bold text-indigo-600 text-xl">${ans}/10</span>`;
      case 'yes_no':
        return `<span class="px-3 py-1 bg-white rounded-lg font-bold text-sm shadow-sm border border-gray-200">${ans === 'yes' ? '👍 Yes' : '👎 No'}</span>`;
      case 'checkbox':
        if (Array.isArray(ans)) return ans.map(a => `<span class="px-2 py-1 bg-indigo-50 text-indigo-700 text-xs font-bold rounded m-1 inline-block">✓ ${sanitizeHTML(a)}</span>`).join('');
        return sanitizeHTML(ans);
      default:
        return `<p class="font-handwriting text-2xl text-navy-900 leading-tight">${sanitizeHTML(ans.toString())}</p>`;
    }
  };

  const contentHtml = book.questions.map((q, idx) => {
    const answer = response.answers[q.id];
    return `
      <div class="mb-6 relative">
        <span class="absolute -left-2 -top-2 text-[40px] text-gray-200 font-bold opacity-30 z-0">${idx + 1}</span>
        <div class="relative z-10">
          <p class="text-xs font-bold text-navy-500 uppercase mb-2 ml-4">${sanitizeHTML(q.text)}</p>
          <div class="bg-[#f9f5eb] p-4 rounded-xl border-b-[3px] border-[#e8d5b5] transform rotate-[0.5deg]">
            ${renderAnswer(q, answer)}
          </div>
        </div>
      </div>
    `;
  }).join('');

  modal.body.innerHTML = `
    <div class="bg-[#fcf8f2] min-h-full p-6" style="background-image: repeating-linear-gradient(transparent, transparent 29px, #e8d5b5 29px, #e8d5b5 30px); background-attachment: local;">
      <div class="mb-8 flex justify-between items-start bg-white/60 p-4 rounded-2xl border border-gray-200 backdrop-blur-sm shadow-sm">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xl font-bold text-white shadow-inner">${name.charAt(0).toUpperCase()}</div>
          <div>
            <h2 class="font-bold text-lg text-navy-800">${sanitizeHTML(name)}</h2>
            <p class="text-[10px] text-gray-500 font-sans uppercase font-bold tracking-wider">${new Date(response.createdAt?.toDate()).toLocaleString()}</p>
          </div>
        </div>
        <button id="sb-pin-btn" class="w-10 h-10 rounded-full flex items-center justify-center text-xl bg-white shadow hover:scale-110 transition-transform ${response.isPinned ? 'ring-2 ring-yellow-400' : 'opacity-50 grayscale'}">📌</button>
      </div>
      
      <div class="pt-2 pb-10">
        ${contentHtml}
      </div>
      
      <button id="sb-delete-btn" class="w-full py-4 text-red-500 font-bold text-sm bg-red-50 rounded-2xl border border-red-100 hover:bg-red-100 transition-colors shadow-sm">🗑️ Delete Response</button>
    </div>
  `;

  modal.body.querySelector('#sb-pin-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const newStatus = !response.isPinned;
    btn.className = `w-10 h-10 rounded-full flex items-center justify-center text-xl bg-white shadow hover:scale-110 transition-transform ${newStatus ? 'ring-2 ring-yellow-400' : 'opacity-50 grayscale'}`;
    try {
      await updateDoc(doc(db, 'slambookResponses', response.id), { isPinned: newStatus });
      response.isPinned = newStatus;
      showToast(newStatus ? 'Pinned to top!' : 'Unpinned', 'success');

      if (newStatus && response.authorId) {
        const { createNotification } = await import('../notifications.js');
        await createNotification('slambook_pinned', response.authorId, { fromName: authManager.userData?.fullName });
      }
    } catch (err) { showToast('Error pinning', 'error'); }
  });

  modal.body.querySelector('#sb-delete-btn').addEventListener('click', () => {
    showDeleteConfirmation('this response permanently', async () => {
      try {
        await awardPoints(response.authorId, -3, 'Slam Book Response Deleted');
        await deleteDoc(doc(db, 'slambookResponses', response.id));
        modal.close();
      } catch (err) { console.error('Failed to delete', err); }
    });
  });
}

// -----------------------------------------
// GUEST WRITER (DYNAMIC FORM)
// -----------------------------------------
async function openGuestWriter(targetUser, book) {
  const myUid = authManager.currentUser?.uid;
  if (!myUid) return showToast('Please login to write!', 'warning');

  const modal = router.openModal('slambook-writer', { title: '✍️ Writing in Slam Book', fullScreen: true });

  const renderInput = (q) => {
    const req = q.isRequired ? 'required' : '';
    switch (q.type) {
      case 'paragraph':
      case 'memory':
        return `<textarea id="sb-ans-${q.id}" rows="${q.type === 'memory' ? 4 : 3}" class="w-full bg-transparent border-none focus:ring-0 focus:outline-none font-handwriting text-2xl text-navy-900 resize-none leading-[30px] placeholder-gray-400/50" placeholder="Write here..." ${req}></textarea>`;
      case 'radio':
        return `<div class="space-y-2 mt-2" id="sb-ans-${q.id}">
          ${(q.options || []).map((opt, i) => `
            <label class="flex items-center gap-3 p-3 bg-white/50 rounded-xl cursor-pointer hover:bg-white transition-colors border border-transparent hover:border-gray-200">
              <input type="radio" name="radio_${q.id}" value="${sanitizeHTML(opt)}" class="w-5 h-5 text-indigo-600 focus:ring-indigo-500" ${req}/>
              <span class="text-sm font-bold text-navy-800">${sanitizeHTML(opt)}</span>
            </label>
          `).join('')}
        </div>`;
      case 'checkbox':
        return `<div class="space-y-2 mt-2" id="sb-ans-${q.id}">
          ${(q.options || []).map((opt, i) => `
            <label class="flex items-center gap-3 p-3 bg-white/50 rounded-xl cursor-pointer hover:bg-white transition-colors border border-transparent hover:border-gray-200">
              <input type="checkbox" name="chk_${q.id}" value="${sanitizeHTML(opt)}" class="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500"/>
              <span class="text-sm font-bold text-navy-800">${sanitizeHTML(opt)}</span>
            </label>
          `).join('')}
        </div>`;
      case 'emoji':
        return `<div class="flex flex-wrap gap-2 mt-2" id="sb-ans-${q.id}">
          ${(q.options || ['😀', '😎', '🤓', '😴', '👽']).map((opt, i) => `
            <label class="cursor-pointer group relative">
              <input type="radio" name="emoji_${q.id}" value="${sanitizeHTML(opt)}" class="peer sr-only" ${req}/>
              <div class="text-3xl p-2 bg-white/50 rounded-full border-2 border-transparent peer-checked:border-indigo-500 peer-checked:bg-white peer-checked:scale-110 transition-all filter grayscale peer-checked:grayscale-0">${sanitizeHTML(opt)}</div>
            </label>
          `).join('')}
        </div>`;
      case 'rating_5':
        return `<div class="flex gap-2 mt-2" id="sb-ans-${q.id}">
          ${[1, 2, 3, 4, 5].map(v => `
            <label class="cursor-pointer">
              <input type="radio" name="star_${q.id}" value="${v}" class="peer sr-only" ${req}/>
              <div class="text-4xl text-gray-300 peer-checked:text-yellow-400 hover:text-yellow-200 transition-colors">★</div>
            </label>
          `).join('')}
        </div>`;
      case 'rating_10':
        return `<input type="range" id="sb-ans-${q.id}" min="1" max="10" value="5" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 mt-4" oninput="this.nextElementSibling.innerText = this.value + '/10'"/>
                <div class="text-center font-bold text-indigo-600 text-xl mt-2">5/10</div>`;
      case 'yes_no':
        return `<div class="flex gap-3 mt-2" id="sb-ans-${q.id}">
          <label class="flex-1"><input type="radio" name="yn_${q.id}" value="yes" class="peer sr-only" ${req}/><div class="text-center py-3 bg-white/50 rounded-xl border-2 border-transparent peer-checked:border-green-500 peer-checked:bg-green-50 font-bold text-green-700 cursor-pointer transition-all">👍 YES</div></label>
          <label class="flex-1"><input type="radio" name="yn_${q.id}" value="no" class="peer sr-only" ${req}/><div class="text-center py-3 bg-white/50 rounded-xl border-2 border-transparent peer-checked:border-red-500 peer-checked:bg-red-50 font-bold text-red-700 cursor-pointer transition-all">👎 NO</div></label>
        </div>`;
      case 'date':
        return `<input type="date" id="sb-ans-${q.id}" class="w-full bg-white/60 border border-gray-200 p-3 rounded-xl focus:outline-none focus:border-indigo-500 font-bold text-navy-800 mt-2" ${req}/>`;
      default:
        return `<input type="text" id="sb-ans-${q.id}" class="w-full bg-transparent border-none focus:ring-0 focus:outline-none font-handwriting text-2xl text-navy-900 placeholder-gray-400/50" placeholder="Short answer..." ${req}/>`;
    }
  };

  modal.body.innerHTML = `
    <div class="bg-[#fcf8f2] min-h-full p-4 md:p-8" style="background-image: repeating-linear-gradient(transparent, transparent 29px, #e8d5b5 29px, #e8d5b5 30px); background-attachment: local;">
      <h2 class="font-handwriting text-3xl text-navy-800 mb-2 text-center">${sanitizeHTML(book.title)}</h2>
      <p class="text-center text-xs text-gray-500 uppercase tracking-wider font-bold mb-8">For ${sanitizeHTML(targetUser.fullName)}</p>
      
      <div id="sb-guest-form" class="space-y-8">
        ${book.questions.map((q, i) => `
          <div class="sb-q-block relative">
            <span class="absolute -left-2 -top-4 text-[40px] text-gray-200 font-bold opacity-40 z-0">${i + 1}</span>
            <div class="relative z-10">
              <p class="text-sm font-bold text-navy-800 font-sans uppercase mb-1 bg-white/50 inline-block px-2 py-0.5 rounded shadow-sm">${sanitizeHTML(q.text)} ${q.isRequired ? '<span class="text-red-500">*</span>' : ''}</p>
              ${renderInput(q)}
            </div>
          </div>
        `).join('')}

        ${book.allowAnonymous ? `
          <div class="mt-8 bg-white/80 p-4 rounded-xl border border-gray-200 backdrop-blur-md shadow-sm">
            <label class="flex items-center justify-between cursor-pointer">
              <span class="text-sm font-bold text-navy-800">Stay Anonymous 👻</span>
              <input type="checkbox" id="sb-anon-check" class="w-5 h-5 text-indigo-600 rounded cursor-pointer"/>
            </label>
            <p class="text-[10px] text-gray-500 mt-1">They won't know who wrote this, but you still get +5 points!</p>
          </div>
        ` : ''}
      </div>
    </div>

    <div class="sticky bottom-0 left-0 right-0 p-4 bg-[#fcf8f2] border-t border-[#e8d5b5] z-10 shadow-[0_-4px_15px_rgba(0,0,0,0.05)]">
      <button id="sb-submit-btn" class="w-full py-4 bg-navy-800 hover:bg-navy-900 text-white font-bold rounded-2xl shadow-xl transition-all transform active:scale-95 text-lg font-handwriting tracking-wider">Sign & Save ( Pts) 📖</button>
    </div>
  `;

  // Fix radio/checkbox logic to only allow 1 star/emoji to be selected visually by standard HTML radio behavior.
  // Note: rating stars are all same name per question so standard radio behavior applies.

  modal.body.querySelector('#sb-submit-btn').addEventListener('click', async () => {
    const answers = {};
    let missingRequired = false;

    book.questions.forEach(q => {
      let val = null;
      const el = modal.body.querySelector(`#sb-ans-${q.id}`);

      if (q.type === 'radio' || q.type === 'emoji' || q.type === 'rating_5' || q.type === 'yes_no') {
        const checked = el.querySelector('input:checked');
        if (checked) val = checked.value;
      } else if (q.type === 'checkbox') {
        const checked = Array.from(el.querySelectorAll('input:checked')).map(cb => cb.value);
        if (checked.length > 0) val = checked;
      } else {
        // text, paragraph, memory, date, rating_10
        if (el.value !== undefined) val = el.value.trim();
        else val = el.querySelector('input, textarea')?.value?.trim(); // fallback
      }

      if (q.isRequired && (!val || (Array.isArray(val) && val.length === 0))) missingRequired = true;
      if (val !== null && val !== '') answers[q.id] = val;
    });

    if (missingRequired) return showToast('Please answer all required questions!', 'warning');

    const isAnon = book.allowAnonymous ? modal.body.querySelector('#sb-anon-check').checked : false;

    const btn = modal.body.querySelector('#sb-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      await addDoc(collection(db, 'slambookResponses'), {
        slambookId: book.id,
        targetUserId: targetUser.id,
        authorId: myUid,
        authorName: isAnon ? 'Anonymous' : (authManager.userData.fullName || 'A Friend'),
        answers,
        isPinned: false,
        createdAt: serverTimestamp()
      });

      // Send notification
      const { createNotification } = await import('../notifications.js');
      await createNotification('slambook_response', targetUser.id, {
        fromName: isAnon ? 'Someone' : authManager.userData.fullName,
        fromId: isAnon ? null : myUid
      });

      showToast('Slam Book signed! +3 Points earned 🌟', 'success');
      awardPoints(authManager.currentUser.uid, 3, 'Slam Book Answer Submit');
      modal.close();
    } catch (e) {
      console.error(e);
      showToast('Failed to save', 'error');
      btn.disabled = false;
      btn.textContent = 'Try Again';
    }
  });
}

// -----------------------------------------
// SHARE MODAL
// -----------------------------------------
async function shareSlamBook(book) {
  const modal = router.openModal('slambook-share', { title: '📤 Share Slam Book' });

  modal.body.innerHTML = `
    <div class="p-6 text-center animate-fadeIn">
      <div class="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-2xl mx-auto mb-4 shadow-inner">📖</div>
      <h3 class="text-xl font-bold text-navy-800 mb-2">${sanitizeHTML(book.title)}</h3>
      <p class="text-sm text-gray-500 mb-6">Send this to your friends so they can fill it out!</p>
      
      <div id="sb-friends-list" class="space-y-3 max-h-60 overflow-y-auto text-left mb-6 px-1">
        <p class="text-center text-sm text-gray-400 py-4">Loading friends...</p>
      </div>

      <button id="sb-send-btn" class="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg transition-colors flex items-center justify-center gap-2" disabled>
        Send Invites <span class="bg-white/20 px-2 py-0.5 rounded text-xs" id="sb-sel-cnt">0</span>
      </button>
    </div>
  `;

  // Fetch users (assuming all users are friends for this MVP, similar to how other parts work)
  try {
    const q = query(collection(db, 'users'), limit(50));
    const snap = await getDocs(q);
    const users = [];
    snap.forEach(d => {
      if (d.id !== authManager.currentUser.uid) users.push({ id: d.id, ...d.data() });
    });

    const listEl = modal.body.querySelector('#sb-friends-list');
    if (users.length === 0) {
      listEl.innerHTML = '<p class="text-center text-sm text-gray-400">No friends found to share with.</p>';
      return;
    }

    listEl.innerHTML = users.map(u => `
      <label class="flex items-center gap-3 p-3 border border-gray-100 rounded-xl cursor-pointer hover:bg-gray-50 transition-colors has-[:checked]:bg-indigo-50 has-[:checked]:border-indigo-200">
        <input type="checkbox" value="${u.id}" class="sb-friend-cb w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500 border-gray-300"/>
        <div class="w-8 h-8 bg-gray-200 rounded-full overflow-hidden">
          ${u.profilePic ? `<img src="${sanitizeHTML(u.profilePic)}" class="w-full h-full object-cover"/>` : '<div class="w-full h-full flex items-center justify-center font-bold text-gray-500 text-xs">' + sanitizeHTML(u.fullName.charAt(0)) + '</div>'}
        </div>
        <span class="text-sm font-bold text-navy-800">${sanitizeHTML(u.fullName)}</span>
      </label>
    `).join('');

    const checkboxes = Array.from(listEl.querySelectorAll('.sb-friend-cb'));
    const btn = modal.body.querySelector('#sb-send-btn');
    const cnt = modal.body.querySelector('#sb-sel-cnt');

    checkboxes.forEach(cb => {
      cb.addEventListener('change', () => {
        const selected = checkboxes.filter(c => c.checked).length;
        cnt.textContent = selected;
        btn.disabled = selected === 0;
      });
    });

    btn.addEventListener('click', async () => {
      const selectedIds = checkboxes.filter(c => c.checked).map(c => c.value);
      if (selectedIds.length === 0) return;

      btn.disabled = true;
      btn.innerHTML = '<svg class="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> Sending...';

      const { createNotification } = await import('../notifications.js');

      try {
        await Promise.all(selectedIds.map(id =>
          createNotification('slambook_share', id, { fromName: authManager.userData.fullName })
        ));

        showToast(`Sent to ${selectedIds.length} friends!`, 'success');
        modal.close();
      } catch (err) {
        showToast('Error sending invites', 'error');
        btn.disabled = false;
        btn.innerHTML = `Send Invites <span class="bg-white/20 px-2 py-0.5 rounded text-xs" id="sb-sel-cnt">${selectedIds.length}</span>`;
      }
    });

  } catch (err) {
    modal.body.querySelector('#sb-friends-list').innerHTML = '<p class="text-center text-sm text-red-500">Failed to load friends.</p>';
  }
}
