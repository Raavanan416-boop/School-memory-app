import { db, collection, getDocs, doc, updateDoc, writeBatch, deleteDoc, query, limit, getDoc, onSnapshot } from '../firebase-config.js';
import { authManager } from '../auth.js';
import { router } from '../router.js';
import { showToast, sanitizeHTML } from '../utils.js';

let allUsers = [];

export async function renderOwnerPanel(container) {
  try {
    if (!authManager.isOwner) {
      router.navigate('home');
      return;
    }

    // Force dark theme for owner panel
    const originalTheme = document.body.className;
    document.body.className = 'theme-dark';

    router.registerDestroy('owner', () => {
      document.body.className = originalTheme;
    });

    container.innerHTML = `
    <div class="min-h-screen bg-[#0f172a] text-gray-200 pb-20 relative">
      <div class="sticky top-0 z-50 bg-[#1e293b]/90 backdrop-blur-md border-b border-gray-700/50 px-4 py-3 flex items-center justify-between shadow-lg">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-red-500/20 text-red-500 flex items-center justify-center border border-red-500/30 shadow-[0_0_10px_rgba(239,68,68,0.2)]">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/></svg>
          </div>
          <div>
            <h1 class="font-bold text-white tracking-wide">OWNER SYSTEM</h1>
            <p class="text-[9px] text-red-400 font-mono tracking-widest uppercase">Class 37 Classified</p>
          </div>
        </div>
        <button id="exit-owner-btn" class="p-2 text-gray-400 hover:text-white transition-colors bg-gray-800/50 rounded-xl">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>

      <div class="p-4 space-y-6 max-w-lg mx-auto">
        <!-- Dashboard Stats -->
        <div class="grid grid-cols-2 gap-3" id="owner-stats">
          <div class="bg-[#1e293b] rounded-2xl p-4 border border-gray-700/50 shadow-md">
            <p class="text-xs text-gray-400 mb-1 font-semibold uppercase">Total Users</p>
            <p class="text-2xl font-bold text-white" id="stat-users">...</p>
          </div>
          <div class="bg-[#1e293b] rounded-2xl p-4 border border-gray-700/50 shadow-md">
            <p class="text-xs text-gray-400 mb-1 font-semibold uppercase">System Status</p>
            <p class="text-xl font-bold text-green-400 flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> SECURE</p>
          </div>
        </div>

        <!-- Navigation Tabs -->
        <div class="flex gap-2 p-1 bg-[#1e293b] rounded-xl border border-gray-700/50 overflow-x-auto hide-scrollbar shadow-inner">
          <button class="owner-tab-btn active" data-tab="users">👥 Users</button>
          <button class="owner-tab-btn" data-tab="leaderboard">🏆 Score</button>
          <button class="owner-tab-btn" data-tab="messages">💬 Chats</button>
          <button class="owner-tab-btn" data-tab="posts">📸 Posts</button>
          <button class="owner-tab-btn" data-tab="system">⚙️ System</button>
        </div>

        <!-- Tab Contents -->
        <div id="tab-users" class="owner-tab-content block space-y-4">
          <div class="relative">
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/></svg>
            <input type="text" id="owner-search-users" class="w-full pl-9 pr-4 py-3 bg-[#1e293b] border border-gray-700/50 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500 transition-colors shadow-inner" placeholder="Search by name, roll no..."/>
          </div>
          <div id="owner-user-list" class="space-y-2">
            <p class="text-center text-sm text-gray-500 py-8 font-mono animate-pulse">Fetching directory...</p>
          </div>
        </div>

        <div id="tab-leaderboard" class="owner-tab-content hidden space-y-4">
          <div class="bg-red-500/10 border border-red-500/30 rounded-2xl p-5 text-center shadow-[0_0_15px_rgba(239,68,68,0.1)]">
            <div class="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
            </div>
            <h3 class="text-white font-bold mb-2">Reset All Leaderboard Points</h3>
            <p class="text-xs text-gray-400 mb-5">This will instantly set all users' scores back to 0. This action cannot be undone.</p>
            <button id="btn-reset-leaderboard" class="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-[0_0_15px_rgba(220,38,38,0.4)] transition-all">
              EXECUTE RESET
            </button>
          </div>
        </div>

        <div id="tab-messages" class="owner-tab-content hidden space-y-4">
          <div class="bg-red-500/10 border border-red-500/30 rounded-2xl p-5 text-center shadow-[0_0_15px_rgba(239,68,68,0.1)]">
            <div class="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>
            </div>
            <h3 class="text-white font-bold mb-2">Nuclear Option: Clear All Messages</h3>
            <p class="text-xs text-gray-400 mb-5">This will permanently delete ALL chats and messages between ALL users. Extremely destructive.</p>
            <button id="btn-clear-messages" class="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-[0_0_15px_rgba(220,38,38,0.4)] transition-all">
              INITIATE WIPE
            </button>
          </div>
        </div>

        <div id="tab-posts" class="owner-tab-content hidden space-y-4">
          <div class="flex justify-between items-center mb-2">
            <h3 class="text-white font-bold">Manage Posts</h3>
            <button id="btn-refresh-posts" class="text-xs text-blue-400 hover:text-blue-300">Refresh</button>
          </div>
          <div id="owner-posts-list" class="space-y-3 max-h-[60vh] overflow-y-auto hide-scrollbar">
            <p class="text-center text-gray-500 py-4 font-mono text-sm">Loading posts...</p>
          </div>
        </div>

        <div id="tab-system" class="owner-tab-content hidden space-y-4">
          <div class="bg-[#1e293b] rounded-2xl p-4 border border-gray-700/50 shadow-md">
            <h3 class="text-white font-bold mb-3">Global Announcement</h3>
            <textarea id="announcement-text" class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 mb-3 text-sm" rows="3" placeholder="Type a message to send to all 37 users..."></textarea>
            <button id="btn-send-announcement" class="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all text-sm">BROADCAST MESSAGE</button>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <button id="btn-reset-notifs" class="py-3 bg-[#1e293b] hover:bg-gray-800 border border-gray-700/50 text-gray-300 font-semibold rounded-xl transition-all text-sm flex flex-col items-center justify-center gap-1">
              <span class="text-lg">🔕</span> Reset Notifications
            </button>
            <button id="btn-force-refresh" class="py-3 bg-[#1e293b] hover:bg-gray-800 border border-gray-700/50 text-gray-300 font-semibold rounded-xl transition-all text-sm flex flex-col items-center justify-center gap-1">
              <span class="text-lg">🔄</span> Force Refresh
            </button>
            <button id="btn-recalc-leaderboard" class="py-3 bg-[#1e293b] hover:bg-gray-800 border border-gray-700/50 text-gray-300 font-semibold rounded-xl transition-all text-sm flex flex-col items-center justify-center gap-1 col-span-2">
              <span class="text-lg">🧮</span> Recalculate Leaderboard
            </button>
          </div>
        </div>

      </div>
    </div>
  `;

  // Inline styles for tabs
  const style = document.createElement('style');
  style.textContent = `
    .owner-tab-btn { flex: 1; padding: 10px 12px; font-size: 13px; font-weight: 600; color: #94a3b8; border-radius: 8px; transition: all 0.2s; white-space: nowrap; }
    .owner-tab-btn.active { background: #3b82f6; color: white; shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
    .owner-tab-content.hidden { display: none; }
    .owner-tab-content.block { display: block; animation: fadeIn 0.3s ease-out; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
  `;
  container.appendChild(style);

  // Tab switching
  const tabs = container.querySelectorAll('.owner-tab-btn');
  const contents = container.querySelectorAll('.owner-tab-content');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => { c.classList.remove('block'); c.classList.add('hidden'); });
      tab.classList.add('active');
      const target = container.querySelector(`#tab-${tab.dataset.tab}`);
      target.classList.remove('hidden');
      target.classList.add('block');
    });
  });

  container.querySelector('#exit-owner-btn').addEventListener('click', () => {
    router.navigate('home');
  });

  await loadUsers(container);

  // Bind extreme actions
  container.querySelector('#btn-reset-leaderboard').addEventListener('click', () => executeResetLeaderboard(container));
  container.querySelector('#btn-clear-messages').addEventListener('click', () => executeClearMessages(container));
  
  // Bind system actions
  container.querySelector('#btn-refresh-posts').addEventListener('click', () => loadPosts(container));
  container.querySelector('#btn-send-announcement').addEventListener('click', () => executeSendAnnouncement(container));
  container.querySelector('#btn-reset-notifs').addEventListener('click', () => executeResetNotifications());
  container.querySelector('#btn-force-refresh').addEventListener('click', () => executeForceRefresh());
  container.querySelector('#btn-recalc-leaderboard').addEventListener('click', () => executeRecalcLeaderboard());

  // Load posts in background
  setTimeout(() => loadPosts(container), 500);

  } catch (err) {
    console.error('Owner Panel Error:', err);
    container.innerHTML = `
      <div class="min-h-screen bg-[#0f172a] p-6 text-gray-200">
        <div class="flex items-center gap-3 mb-6">
          <div class="w-10 h-10 rounded-xl bg-red-500/20 text-red-500 flex items-center justify-center">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          </div>
          <div>
            <h2 class="text-xl font-bold text-red-500">Owner Panel Error</h2>
            <p class="text-xs text-gray-400 uppercase tracking-widest">System Failure</p>
          </div>
        </div>
        <div class="bg-[#1e293b] p-4 rounded-xl border border-red-500/30 overflow-x-auto text-xs font-mono text-red-400 mb-6 shadow-inner whitespace-pre-wrap">
          ${err.message}\n\n${err.stack}
        </div>
        <button onclick="window.location.reload()" class="w-full py-3 bg-red-600 hover:bg-red-700 font-bold rounded-xl text-white shadow-lg transition-colors">RELOAD APPLICATION</button>
      </div>
    `;
  }
}

async function loadUsers(container) {
  try {
    const snap = await getDocs(collection(db, 'users'));
    allUsers = [];
    snap.forEach(d => allUsers.push({ id: d.id, ...d.data() }));
    
    // Sort alphabetically
    allUsers.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));

    const statEl = container.querySelector('#stat-users');
    if (statEl) statEl.textContent = allUsers.length;

    renderUserList(container, allUsers);

    // Search binding
    const searchInput = container.querySelector('#owner-search-users');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        const filtered = allUsers.filter(u => 
          (u.fullName || '').toLowerCase().includes(q) ||
          (u.rollNumber || '').toLowerCase().includes(q) ||
          (u.nickname || '').toLowerCase().includes(q)
        );
        renderUserList(container, filtered);
      });
    }

  } catch (e) {
    console.error('Failed to load users:', e);
    const listEl = container.querySelector('#owner-user-list');
    if (listEl) listEl.innerHTML = '<p class="text-center text-red-500 py-4">Database error</p>';
  }
}

function renderUserList(container, users) {
  const listEl = container.querySelector('#owner-user-list');
  if (!listEl) return;

  if (!users || users.length === 0) {
    listEl.innerHTML = '<p class="text-center text-gray-500 py-4">No users found</p>';
    return;
  }

  listEl.innerHTML = users?.map(u => `
    <button class="w-full flex items-center gap-3 p-3 bg-[#1e293b] hover:bg-[#334155] border border-gray-700/50 rounded-xl transition-colors text-left" onclick="window.openOwnerUserEdit('${u?.id || ''}')">
      <div class="relative flex-shrink-0">
        ${u?.profilePic 
          ? `<img src="${u.profilePic}" class="w-10 h-10 rounded-lg object-cover border border-gray-600"/>`
          : `<div class="w-10 h-10 rounded-lg bg-gray-700 flex items-center justify-center text-gray-300 font-bold">${(u?.fullName || '?')[0]?.toUpperCase() || '?'}</div>`}
        ${u?.flagged ? '<div class="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border border-[#1e293b]"></div>' : ''}
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-bold text-white truncate">${sanitizeHTML(u?.fullName || 'Unknown')}</p>
        <p class="text-xs text-gray-400 truncate">Roll: ${u?.rollNumber || 'N/A'} | ${sanitizeHTML(u?.nickname || 'No Nickname')}</p>
      </div>
      <svg class="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
    </button>
  `).join('') || '';
}

// Global binding for inline onclick
window.openOwnerUserEdit = async (uid) => {
  const modal = router.openModal('', { title: 'User Data System' });
  // Add dark theme class to the modal specifically
  modal.overlay.querySelector('.modal-content').classList.add('bg-[#1e293b]', 'text-gray-200', 'border', 'border-gray-700');
  modal.overlay.querySelector('.modal-header').classList.add('border-b', 'border-gray-700');
  modal.overlay.querySelector('.modal-header h3').classList.add('text-white');
  modal.overlay.querySelector('.modal-close-btn').classList.add('text-gray-400');

  modal.body.innerHTML = `<div class="p-8 text-center text-gray-400 font-mono animate-pulse">Establishing Live Secure Connection...</div>`;

  let totalPosts = 0;
  let totalLikes = 0;
  let totalComments = 0;
  let computedPoints = 0;

  // Pre-fetch stats
  try {
    const { getLeaderboardScores } = await import('./leaderboard.js');
    const allScores = await getLeaderboardScores();
    const userScore = allScores.find(s => s.id === uid);
    
    if (userScore) {
      totalPosts = userScore.postCount || 0;
      totalLikes = userScore.totalLikes || 0;
      totalComments = userScore.totalComments || 0;
      computedPoints = userScore.total || 0;
    }
  } catch (e) {
    console.warn("Failed fetching user stats", e);
  }

  // Set up real-time listener
  let editingField = null; 
  let currentUser = null;
  
  const renderDashboard = () => {
    if (!currentUser) return;
    const user = currentUser;

    // Helper to render an inline field
    const renderField = (key, label, value, type = 'text', readOnly = false, isStatus = false) => {
      const isEmpty = value == null || value === '';
      const displayValue = isEmpty ? 'Not Set' : value;
      const isEditing = editingField === key;
      
      let contentHtml = '';
      if (isEditing) {
        if (isStatus) {
          contentHtml = `
            <div class="mt-2 flex flex-col gap-2 w-full animate-fade-in">
              <select id="input-${key}" class="w-full px-3 py-1.5 bg-[#0f172a] border border-blue-500 rounded-lg text-white focus:outline-none text-sm">
                <option value="false" ${!user.flagged ? 'selected' : ''}>✅ Active (Normal)</option>
                <option value="true" ${user.flagged ? 'selected' : ''}>⚠️ Flagged (Restricted)</option>
              </select>
              <div class="flex gap-2 justify-end">
                <button onclick="saveInlineField('${key}', '${type}', true)" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">Save</button>
                <button onclick="cancelInlineEdit()" class="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">Cancel</button>
              </div>
            </div>
          `;
        } else if (type === 'textarea') {
          contentHtml = `
            <div class="mt-2 flex flex-col gap-2 w-full animate-fade-in">
              <textarea id="input-${key}" class="w-full px-3 py-1.5 bg-[#0f172a] border border-blue-500 rounded-lg text-white focus:outline-none text-sm" rows="3">${sanitizeHTML(value || '')}</textarea>
              <div class="flex gap-2 justify-end">
                <button onclick="saveInlineField('${key}', '${type}', false)" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg text-xs font-bold transition-colors">Save</button>
                <button onclick="cancelInlineEdit()" class="bg-gray-700 hover:bg-gray-600 text-white px-4 py-1.5 rounded-lg text-xs font-bold transition-colors">Cancel</button>
              </div>
            </div>
          `;
        } else {
          contentHtml = `
            <div class="mt-2 flex flex-col gap-2 w-full animate-fade-in">
              <input type="${type}" id="input-${key}" value="${sanitizeHTML(value || '')}" class="w-full px-3 py-1.5 bg-[#0f172a] border border-blue-500 rounded-lg text-white focus:outline-none text-sm"/>
              <div class="flex gap-2 justify-end">
                <button onclick="saveInlineField('${key}', '${type}', false)" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">Save</button>
                <button onclick="cancelInlineEdit()" class="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">Cancel</button>
              </div>
            </div>
          `;
        }
      } else {
        if (readOnly) {
          contentHtml = `<p class="text-sm text-gray-500 font-medium mt-1 truncate">${sanitizeHTML(displayValue)}</p>`;
        } else if (isEmpty) {
          contentHtml = `<button onclick="startInlineEdit('${key}')" class="mt-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 px-3 py-1 rounded text-xs font-bold transition-colors w-full text-left flex items-center gap-2"><svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg> Add ${label}</button>`;
        } else {
          let formattedVal = sanitizeHTML(displayValue);
          if (isStatus) formattedVal = user.flagged ? '<span class="text-red-400 font-bold">⚠️ Flagged</span>' : '<span class="text-green-400 font-bold">✅ Active</span>';
          
          contentHtml = `
            <div class="flex items-center justify-between group cursor-pointer mt-1" onclick="startInlineEdit('${key}')">
              <p class="text-sm text-gray-200 font-medium truncate ${type==='textarea'?'italic':''}">${formattedVal}</p>
              <button class="opacity-0 group-hover:opacity-100 text-blue-400 p-1 transition-opacity" title="Edit">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125"/></svg>
              </button>
            </div>
          `;
        }
      }

      return `
        <div class="bg-gray-800/80 p-3 rounded-lg border border-gray-700/50 transition-all ${isEditing ? 'ring-2 ring-blue-500/50' : 'hover:border-gray-600'}">
          <p class="text-[10px] text-gray-500 uppercase font-bold tracking-wider">${label}</p>
          ${contentHtml}
        </div>
      `;
    };

    modal.body.innerHTML = `
      <div class="p-5 space-y-4 max-h-[75vh] overflow-y-auto hide-scrollbar">
        
        <!-- Header Identity -->
        <div class="flex items-center gap-4 bg-[#0f172a] p-4 rounded-xl border border-gray-800 shadow-inner relative group">
          ${user.profilePic 
            ? `<img src="${user.profilePic}" class="w-16 h-16 rounded-xl object-cover border border-gray-600"/>`
            : `<div class="w-16 h-16 rounded-xl bg-gray-700 flex items-center justify-center text-xl text-gray-300 font-bold">${(user.fullName || '?')[0].toUpperCase()}</div>`}
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between">
              <h2 class="text-xl font-bold text-white truncate">${sanitizeHTML(user.fullName || 'Unknown')}</h2>
            </div>
            <p class="text-xs text-gray-400 font-mono truncate">${user.email || 'No email'}</p>
          </div>
          <button onclick="deleteProfilePic()" class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 bg-red-500/20 hover:bg-red-500/40 text-red-400 p-1.5 rounded-lg transition-all" title="Delete Profile Photo">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>
          </button>
        </div>

        <div class="flex items-center gap-2 mb-2">
           <div class="h-[1px] flex-1 bg-gray-800"></div>
           <span class="text-xs font-bold text-gray-500 uppercase tracking-widest px-2">Live Real-Time Editing</span>
           <div class="h-[1px] flex-1 bg-gray-800"></div>
        </div>

        <!-- Editable Details Grid -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          ${renderField('fullName', 'Full Name', user.fullName)}
          ${renderField('nickname', 'Nickname', user.nickname)}
          ${renderField('email', 'Email Address', user.email, 'email')}
          ${renderField('phoneNumber', 'Phone Number', user.phoneNumber)}
          ${renderField('rollNumber', 'Roll Number', user.rollNumber)}
          ${renderField('dateOfBirth', 'Date of Birth (YYYY-MM-DD)', user.dateOfBirth, 'date')}
          ${renderField('joinedYear', 'Join Year', user.joinedYear)}
          ${renderField('endYear', 'End Year', user.endYear)}
          <div class="sm:col-span-2">
            ${renderField('flagged', 'Account Status', user.flagged, 'select', false, true)}
          </div>
          <div class="sm:col-span-2">
            ${renderField('bio', 'Bio', user.bio, 'textarea')}
          </div>
        </div>

        <!-- Activity Stats -->
        <div class="bg-gradient-to-r from-gray-800/30 to-gray-800/10 p-4 rounded-xl border border-gray-700/30 mt-4">
          <h4 class="text-xs font-bold text-gray-400 uppercase border-b border-gray-700 pb-2 mt-4">Database Activity Metrics</h4>
          <div class="grid grid-cols-4 gap-2">
            <div class="bg-[#0f172a] p-2 rounded-lg text-center border border-gray-800 shadow-inner">
              <p class="text-lg font-bold text-blue-400">${totalPosts}</p>
              <p class="text-[9px] text-gray-500 uppercase">Posts</p>
            </div>
            <div class="bg-[#0f172a] p-2 rounded-lg text-center border border-gray-800 shadow-inner">
              <p class="text-lg font-bold text-red-400">${totalLikes}</p>
              <p class="text-[9px] text-gray-500 uppercase">Likes</p>
            </div>
            <div class="bg-[#0f172a] p-2 rounded-lg text-center border border-gray-800 shadow-inner">
              <p class="text-lg font-bold text-green-400">${totalComments}</p>
              <p class="text-[9px] text-gray-500 uppercase">Cmnts</p>
            </div>
            <div class="bg-[#0f172a] p-2 rounded-lg text-center border border-gray-800 shadow-inner">
              <p class="text-lg font-bold text-yellow-400">${computedPoints}</p>
              <p class="text-[9px] text-gray-500 uppercase">Points</p>
            </div>
          </div>
        </div>
      </div>
    `;
  };
  
  const unsubscribe = onSnapshot(doc(db, 'users', uid), (docSnap) => {
    if (!docSnap.exists()) {
      modal.body.innerHTML = '<div class="p-8 text-center text-red-400">User not found in database.</div>';
      return;
    }
    currentUser = docSnap.data();
    currentUser.id = docSnap.id;
    
    // Only clear editing state if a snapshot triggered from outside,
    // though generally, onSnapshot runs locally first, so this won't interrupt typing
    // Actually, to prevent interrupting typing, we don't clear editingField on snapshot.
    renderDashboard();
  });

  // Local controller functions attached to window for scope access
  window.startInlineEdit = (key) => {
    editingField = key;
    renderDashboard();
  };

  window.cancelInlineEdit = () => {
    editingField = null;
    renderDashboard();
  };

  window.deleteProfilePic = async () => {
    if(!confirm("Delete this user's profile picture?")) return;
    try {
      await updateDoc(doc(db, 'users', uid), { profilePic: null });
      showToast('Photo deleted ✅', 'success');
    } catch (err) {
      showToast('Failed to delete photo', 'error');
    }
  };

  window.saveInlineField = async (key, type, isStatus) => {
    const el = document.getElementById(`input-${key}`);
    if (!el) return;
    
    let newVal = el.value.trim();
    if (isStatus) newVal = el.value === 'true';

    const btn = el.nextElementSibling;
    const ogBtnText = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = `<svg class="animate-spin h-4 w-4 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;

    try {
      await updateDoc(doc(db, 'users', uid), {
        [key]: newVal || null // null effectively unsets it if empty, keeping Firebase clean
      });
      showToast('Profile updated successfully ✅', 'success');
      editingField = null;
      renderDashboard(); // Manually render immediately to snap out of edit mode
    } catch (e) {
      console.error("Save error", e);
      showToast('Failed to save field', 'error');
      btn.disabled = false;
      btn.textContent = ogBtnText;
    }
  };

  // Cleanup listener on modal close
  const origClose = modal.close;
  modal.close = () => {
    unsubscribe();
    // Clean up global bindings
    delete window.startInlineEdit;
    delete window.cancelInlineEdit;
    delete window.saveInlineField;
    delete window.deleteProfilePic;
    origClose.call(modal);
  };
};

window.executeResetLeaderboard = async function(container) {
  if (!authManager.isOwner) {
    showToast('Permission denied', 'error');
    return;
  }
  if (!confirm('⚠ Reset all user points?\n\nThis will set all leaderboard points to zero.')) return;
  
  const btn = container.querySelector('#btn-reset-leaderboard');
  const ogText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'EXECUTING RESET...';

  try {
    console.log('Leaderboard Reset Started');
    const usersSnap = await getDocs(collection(db, 'users'));
    console.log(`Users Found: ${usersSnap.size}`);
    console.log('Resetting Points...');

    const batch = writeBatch(db);
    usersSnap.forEach(userDoc => {
      batch.update(doc(db, 'users', userDoc.id), { points: 0 });
    });
    
    await batch.commit();
    console.log('Batch Commit Success');
    console.log('Leaderboard Updated');
    showToast('✅ Leaderboard Reset Successfully', 'success');
  } catch (e) {
    console.error(e);
    showToast('Failed to reset leaderboard', 'error');
  }

  btn.disabled = false;
  btn.textContent = ogText;
}

async function executeClearMessages(container) {
  if (!confirm('NUCLEAR WARNING:\\n\\nThis will PERMANENTLY delete ALL messages and chats.\\nAre you absolutely sure?')) return;
  if (prompt('Type WIPE to confirm:') !== 'WIPE') {
    showToast('Wipe cancelled.', 'info');
    return;
  }
  
  const btn = container.querySelector('#btn-clear-messages');
  const ogText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'WIPING DATABASE...';

  try {
    const chatsSnap = await getDocs(collection(db, 'chats'));
    let count = 0;
    
    // Process each chat sequentially to avoid memory overload
    for (const chatDoc of chatsSnap.docs) {
      // 1. Delete messages subcollection
      const msgsSnap = await getDocs(collection(db, 'chats', chatDoc.id, 'messages'));
      const batch = writeBatch(db);
      msgsSnap.forEach(msgDoc => {
        batch.delete(doc(db, 'chats', chatDoc.id, 'messages', msgDoc.id));
        count++;
      });
      // 2. Delete the chat document itself
      batch.delete(chatDoc.ref);
      await batch.commit();
    }
    
    showToast(`Database wiped. ${count} messages destroyed.`, 'success');
  } catch (e) {
    console.error(e);
    showToast('Failed to complete wipe. See console.', 'error');
  }

  btn.disabled = false;
  btn.textContent = ogText;
}

// ----- POSTS MANAGEMENT -----
window.loadPosts = async (container) => {
  const listEl = container.querySelector('#owner-posts-list');
  if (!listEl) return;
  listEl.innerHTML = '<p class="text-center text-gray-500 py-4 text-sm">Fetching posts...</p>';
  try {
    const snap = await getDocs(query(collection(db, 'posts'), limit(50)));
    if (snap.empty) {
      listEl.innerHTML = '<p class="text-center text-gray-500 py-4 text-sm">No posts found</p>';
      return;
    }
    const posts = [];
    snap.forEach(d => posts.push({ id: d.id, ...d.data() }));
    // Sort by createdAt client-side to avoid needing an index
    posts.sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    
    listEl.innerHTML = posts?.map(p => `
      <div class="bg-gray-800 border border-gray-700/50 rounded-xl p-3 flex flex-col gap-2 relative ${p?.isHidden ? 'opacity-50' : ''}" id="owner-post-${p?.id || ''}">
        <div class="flex gap-2">
          ${p?.imageUrl ? `<img src="${p.imageUrl}" class="w-16 h-16 object-cover rounded-lg flex-shrink-0" />` : `<div class="w-16 h-16 bg-gray-700 rounded-lg flex-shrink-0 flex items-center justify-center text-xs text-gray-400">No Img</div>`}
          <div class="flex-1 min-w-0">
            <p class="text-xs font-bold text-gray-300">${sanitizeHTML(p?.authorName || 'Unknown')} <span class="text-gray-500 font-normal">(${p?.id || ''})</span></p>
            <p class="text-xs text-gray-200 mt-1 line-clamp-2">${sanitizeHTML(p?.caption || '')}</p>
            ${p?.isHidden ? '<span class="text-[10px] bg-yellow-500/20 text-yellow-500 px-1 py-0.5 rounded uppercase mt-1 inline-block">Hidden</span>' : ''}
          </div>
        </div>
        <div class="flex gap-2 mt-1">
          <button class="flex-1 py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded text-[10px] font-bold uppercase transition-colors" onclick="window.ownerDeletePost('${p?.id || ''}')">Delete</button>
          <button class="flex-1 py-1.5 bg-orange-600/20 hover:bg-orange-600/40 text-orange-400 rounded text-[10px] font-bold uppercase transition-colors" onclick="window.ownerRemovePostContent('${p?.id || ''}')">Remove</button>
          <button class="flex-1 py-1.5 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 rounded text-[10px] font-bold uppercase transition-colors" onclick="window.ownerToggleHidden('${p?.id || ''}', ${!p?.isHidden})">${p?.isHidden ? 'Restore' : 'Hide'}</button>
        </div>
      </div>
    `).join('') || '';
  } catch (e) {
    console.error(e);
    listEl.innerHTML = '<p class="text-center text-red-500 py-4 text-sm">Failed to load posts</p>';
  }
};

window.ownerDeletePost = async (postId) => {
  if (!confirm('Delete this post permanently?')) return;
  try {
    const snap = await getDoc(doc(db, 'posts', postId));
    if (snap.exists()) {
      const authorId = snap.data().authorId;
      if (authorId) {
        const { awardPoints } = await import('../auth.js');
        await awardPoints(authorId, -20, 'Post Deleted by Admin');
      }
    }
    await deleteDoc(doc(db, 'posts', postId));
    document.getElementById(`owner-post-${postId}`)?.remove();
    showToast('Post deleted', 'success');
  } catch (e) {
    console.error(e);
    showToast('Failed to delete post', 'error');
  }
};

window.ownerRemovePostContent = async (postId) => {
  if (!confirm('Remove content from this post?')) return;
  try {
    await updateDoc(doc(db, 'posts', postId), {
      caption: '[Removed by Admin]',
      imageUrl: null
    });
    showToast('Content removed', 'success');
    window.loadPosts(document.getElementById('page-container'));
  } catch (e) {
    console.error(e);
    showToast('Failed to remove content', 'error');
  }
};

window.ownerToggleHidden = async (postId, hide) => {
  try {
    await updateDoc(doc(db, 'posts', postId), {
      isHidden: hide
    });
    showToast(hide ? 'Post hidden' : 'Post restored', 'success');
    window.loadPosts(document.getElementById('page-container'));
  } catch (e) {
    console.error(e);
    showToast('Failed to toggle visibility', 'error');
  }
};

// ----- SYSTEM MANAGEMENT -----
window.executeSendAnnouncement = async (container) => {
  const input = container.querySelector('#announcement-text');
  const text = input.value.trim();
  if (!text) { showToast('Enter announcement text', 'warning'); return; }
  
  if (!confirm('Send this announcement to ALL users?')) return;
  
  const btn = container.querySelector('#btn-send-announcement');
  const ogText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'SENDING...';

  try {
    const { createNotification } = await import('../notifications.js');
    let count = 0;
    for (const u of allUsers) {
      if (u.id === authManager.currentUser.uid) continue;
      await createNotification('admin_announcement', u.id, {
        title: '📢 System Announcement',
        message: text
      });
      count++;
    }
    input.value = '';
    showToast(`Announcement sent to ${count} users.`, 'success');
  } catch (e) {
    console.error(e);
    showToast('Failed to send completely.', 'error');
  }

  btn.disabled = false;
  btn.textContent = ogText;
};

window.executeResetNotifications = async () => {
  if (!confirm('Delete ALL notifications in the system?')) return;
  try {
    const snap = await getDocs(collection(db, 'notifications'));
    const batch = writeBatch(db);
    let count = 0;
    snap.forEach(d => {
      batch.delete(d.ref);
      count++;
    });
    await batch.commit();
    showToast(`Reset complete. Deleted ${count} notifications.`, 'success');
  } catch (e) {
    console.error(e);
    showToast('Failed to reset notifications', 'error');
  }
};

window.executeForceRefresh = async () => {
  showToast('Refreshing App Data...', 'info');
  setTimeout(() => {
    window.location.reload();
  }, 1000);
};

window.executeRecalcLeaderboard = async () => {
  if (!confirm('Migrate legacy leaderboard points to users collection? This may take a while.')) return;
  
  const btn = document.querySelector('#btn-recalc-leaderboard');
  if (btn) btn.textContent = 'MIGRATING...';

  try {
    // Fetch all collections
    const [usersSnap, postsSnap, pollsSnap, diariesSnap, capsulesSnap, bdaySnap, sbResSnap, sbSnap] = await Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'posts')),
      getDocs(collection(db, 'polls')),
      getDocs(collection(db, 'diary')),
      getDocs(collection(db, 'timeCapsules')),
      getDocs(collection(db, 'birthdayPoints')),
      getDocs(collection(db, 'slambookResponses')),
      getDocs(collection(db, 'slambooks'))
    ]);

    const posts = []; postsSnap.forEach(d => posts.push({ id: d.id, ...d.data() }));
    const polls = []; pollsSnap.forEach(d => polls.push({ id: d.id, ...d.data() }));
    const diaries = []; diariesSnap.forEach(d => diaries.push({ id: d.id, ...d.data() }));
    const capsules = []; capsulesSnap.forEach(d => capsules.push({ id: d.id, ...d.data() }));
    const birthdayPointsDocs = []; bdaySnap.forEach(d => birthdayPointsDocs.push({ id: d.id, ...d.data() }));
    const slambookResponses = []; sbResSnap.forEach(d => slambookResponses.push({ id: d.id, ...d.data() }));
    const slambooks = []; sbSnap.forEach(d => slambooks.push({ id: d.id, ...d.data() }));

    const batch = writeBatch(db);
    let count = 0;

    usersSnap.forEach(d => {
      const user = d.data();
      const id = d.id;

      const userPosts = posts.filter(p => p.authorId === id);
      const totalLikes = userPosts.reduce((sum, p) => sum + (p.likes?.length || 0), 0);
      
      let totalComments = 0;
      posts.forEach(p => {
        if (p.comments && Array.isArray(p.comments)) {
          totalComments += p.comments.filter(c => c.userId === id || c.authorId === id).length;
        }
      });

      const userPolls = polls.filter(p => p.authorId === id || p.createdBy === id);
      const userDiaries = diaries.filter(d => d.authorId === id || d.userId === id);
      const userCapsules = capsules.filter(c => c.authorId === id || c.createdBy === id);

      const postPoints = userPosts.length * 20;
      const likePoints = totalLikes * 10;
      const commentPoints = totalComments * 5;
      const pollPoints = userPolls.length * 1;
      const diaryPoints = userDiaries.length * 1;
      const capsulePoints = userCapsules.length * 1;

      const userBdayPointsReceived = birthdayPointsDocs
        .filter(bp => bp.targetUserId === id)
        .reduce((sum, bp) => sum + (bp.points || 0), 0);
        
      const userBdayPointsGiven = birthdayPointsDocs
        .filter(bp => bp.senderId === id && bp.type === 'birthday_gift')
        .reduce((sum, bp) => sum + (bp.points || 0), 0);

      const userSlambooks = slambooks.filter(b => b.ownerId === id);
      const slambookConfigPoints = userSlambooks.length * 5;

      const uniqueSlambooksAnswered = new Set();
      slambookResponses.filter(r => r.authorId === id).forEach(r => {
        uniqueSlambooksAnswered.add(r.slambookId);
      });
      const slambookAnswerPoints = uniqueSlambooksAnswered.size * 3;

      let total = postPoints + likePoints + commentPoints + pollPoints + diaryPoints + capsulePoints + userBdayPointsReceived - userBdayPointsGiven + slambookConfigPoints + slambookAnswerPoints;

      if (user.pointsOffset) {
        total = Math.max(0, total - user.pointsOffset);
      }

      batch.update(doc(db, 'users', id), { points: total });
      count++;
    });

    await batch.commit();
    showToast(`Successfully migrated points for ${count} users!`, 'success');
  } catch (e) {
    console.error(e);
    showToast('Migration failed.', 'error');
  }

  if (btn) btn.innerHTML = '<span class="text-lg">🧮</span> Recalculate Leaderboard';
};
