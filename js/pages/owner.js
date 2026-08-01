import { db, collection, getDocs, doc, updateDoc, writeBatch, deleteDoc, query, limit, getDoc, onSnapshot, addDoc, serverTimestamp, orderBy, setDoc } from '../firebase-config.js';
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
      // Clean up screenshot activity real-time listener
      if (screenshotActivityUnsubscribe) {
        screenshotActivityUnsubscribe();
        screenshotActivityUnsubscribe = null;
      }
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
          <button class="owner-tab-btn" data-tab="posts">📸 Posts</button>
          <button class="owner-tab-btn" data-tab="system">⚙️ System</button>
          <button class="owner-tab-btn" data-tab="feedback">📝 Feedback</button>
          <button class="owner-tab-btn" data-tab="history">🕒 Logins</button>
          <button class="owner-tab-btn" data-tab="bday_history">🎂 Bday Hist</button>
          <button class="owner-tab-btn" data-tab="reset">☢️ Reset</button>
          <button class="owner-tab-btn" data-tab="screenshots">📸 Screenshots</button>
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

        <div id="tab-bday_history" class="owner-tab-content hidden space-y-4">
          <div class="flex justify-between items-center mb-2">
            <h3 class="text-white font-bold">Birthday Wish History</h3>
            <button id="btn-refresh-bday-history" class="text-xs text-blue-400 hover:text-blue-300">Refresh</button>
          </div>
          <div class="relative mb-3">
            <input type="text" id="owner-search-bday-history" class="w-full px-4 py-2 bg-[#1e293b] border border-gray-700/50 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500 transition-colors shadow-inner" placeholder="Search by Year or User ID..."/>
          </div>
          <div id="owner-bday-history-list" class="space-y-3 max-h-[60vh] overflow-y-auto hide-scrollbar">
            <p class="text-center text-gray-500 py-4 font-mono text-sm">Loading history...</p>
          </div>
        </div>

        <div id="tab-reset" class="owner-tab-content hidden space-y-4">
          <!-- NEW: Massive Full App Reset Button -->
          <div class="bg-red-900/20 border-2 border-red-500/50 rounded-2xl p-6 text-center shadow-[0_0_20px_rgba(239,68,68,0.2)] animate-pulse hover:animate-none transition-all cursor-pointer group" id="btn-full-app-reset">
            <h2 class="text-2xl font-black text-red-500 tracking-wider mb-2 flex items-center justify-center gap-3">
              <span class="text-3xl">🔴</span> FULL APP RESET
            </h2>
            <p class="text-sm text-red-300 font-medium opacity-80 group-hover:opacity-100 transition-opacity">Start a fresh season. Wipes points, claims, and activities.</p>
          </div>

          <div class="bg-[#1e293b] border border-red-500/30 rounded-2xl p-5 shadow-[0_0_15px_rgba(239,68,68,0.1)] relative">
            <h3 class="text-white font-bold mb-4 flex items-center gap-2">
              <svg class="w-5 h-5 text-red-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
              Advanced Reset Control
            </h3>
            
            <div class="grid grid-cols-2 gap-3 mb-6" id="reset-options">
              <label class="flex items-center gap-2 text-sm text-gray-300 hover:text-white cursor-pointer"><input type="checkbox" value="messages" class="w-4 h-4 rounded bg-gray-800 border-gray-600 text-red-500 focus:ring-red-500/50"> Messages</label>
              <label class="flex items-center gap-2 text-sm text-gray-300 hover:text-white cursor-pointer"><input type="checkbox" value="group_messages" class="w-4 h-4 rounded bg-gray-800 border-gray-600 text-red-500 focus:ring-red-500/50"> Group Messages</label>
              <label class="flex items-center gap-2 text-sm text-gray-300 hover:text-white cursor-pointer"><input type="checkbox" value="call_history" class="w-4 h-4 rounded bg-gray-800 border-gray-600 text-red-500 focus:ring-red-500/50"> Call History</label>
              <label class="flex items-center gap-2 text-sm text-gray-300 hover:text-white cursor-pointer"><input type="checkbox" value="notifications" class="w-4 h-4 rounded bg-gray-800 border-gray-600 text-red-500 focus:ring-red-500/50"> Notifications</label>
              <label class="flex items-center gap-2 text-sm text-gray-300 hover:text-white cursor-pointer"><input type="checkbox" value="leaderboard_points" class="w-4 h-4 rounded bg-gray-800 border-gray-600 text-red-500 focus:ring-red-500/50"> Leaderboard Pts</label>
              <label class="flex items-center gap-2 text-sm text-gray-300 hover:text-white cursor-pointer"><input type="checkbox" value="posts" class="w-4 h-4 rounded bg-gray-800 border-gray-600 text-red-500 focus:ring-red-500/50"> Posts</label>
              <label class="flex items-center gap-2 text-sm text-gray-300 hover:text-white cursor-pointer"><input type="checkbox" value="likes" class="w-4 h-4 rounded bg-gray-800 border-gray-600 text-red-500 focus:ring-red-500/50"> Likes</label>
              <label class="flex items-center gap-2 text-sm text-gray-300 hover:text-white cursor-pointer"><input type="checkbox" value="comments" class="w-4 h-4 rounded bg-gray-800 border-gray-600 text-red-500 focus:ring-red-500/50"> Comments</label>
              <label class="flex items-center gap-2 text-sm text-gray-300 hover:text-white cursor-pointer"><input type="checkbox" value="polls" class="w-4 h-4 rounded bg-gray-800 border-gray-600 text-red-500 focus:ring-red-500/50"> Polls</label>
              <label class="flex items-center gap-2 text-sm text-gray-300 hover:text-white cursor-pointer"><input type="checkbox" value="diaries" class="w-4 h-4 rounded bg-gray-800 border-gray-600 text-red-500 focus:ring-red-500/50"> Diaries</label>
              <label class="flex items-center gap-2 text-sm text-gray-300 hover:text-white cursor-pointer"><input type="checkbox" value="time_capsules" class="w-4 h-4 rounded bg-gray-800 border-gray-600 text-red-500 focus:ring-red-500/50"> Time Capsules</label>
              <label class="flex items-center gap-2 text-sm text-gray-300 hover:text-white cursor-pointer"><input type="checkbox" value="slam_books" class="w-4 h-4 rounded bg-gray-800 border-gray-600 text-red-500 focus:ring-red-500/50"> Slam Books</label>
              <label class="flex items-center gap-2 text-sm text-gray-300 hover:text-white cursor-pointer"><input type="checkbox" value="friends_list" class="w-4 h-4 rounded bg-gray-800 border-gray-600 text-red-500 focus:ring-red-500/50"> Friends List</label>
              <label class="flex items-center gap-2 text-sm text-gray-300 hover:text-white cursor-pointer"><input type="checkbox" value="birthday_wishes" class="w-4 h-4 rounded bg-gray-800 border-gray-600 text-red-500 focus:ring-red-500/50"> Birthday Wishes</label>
              <label class="flex items-center gap-2 text-sm text-gray-300 hover:text-white cursor-pointer"><input type="checkbox" value="miss_you_notifications" class="w-4 h-4 rounded bg-gray-800 border-gray-600 text-red-500 focus:ring-red-500/50"> Miss You Notifs</label>
              <label class="flex items-center gap-2 text-sm text-gray-300 hover:text-white cursor-pointer"><input type="checkbox" value="activity_logs" class="w-4 h-4 rounded bg-gray-800 border-gray-600 text-red-500 focus:ring-red-500/50"> Activity Logs</label>
              <label class="flex items-center gap-2 text-sm text-gray-300 hover:text-white cursor-pointer"><input type="checkbox" value="user_points" class="w-4 h-4 rounded bg-gray-800 border-gray-600 text-red-500 focus:ring-red-500/50"> User Points</label>
              <label class="flex items-center gap-2 text-sm font-bold text-red-400 hover:text-red-300 cursor-pointer col-span-2 border-t border-gray-700/50 pt-3 mt-1"><input type="checkbox" id="reset-everything" value="everything" class="w-4 h-4 rounded bg-gray-800 border-gray-600 text-red-600 focus:ring-red-600"> Everything (Full Reset)</label>
            </div>

            <div class="space-y-3 mb-6 bg-gray-900/50 p-4 rounded-xl border border-gray-700">
              <label class="block text-xs font-semibold text-gray-400 uppercase tracking-widest">Authorization Required</label>
              <input type="password" id="owner-secret-code" placeholder="Enter Owner Secret Code..." class="w-full px-4 py-2 bg-[#0f172a] border border-red-500/30 rounded-lg text-white focus:outline-none focus:border-red-500 transition-colors placeholder-gray-600 font-mono text-sm"/>
            </div>

            <!-- Progress Indicator -->
            <div id="reset-progress-container" class="hidden mb-4">
              <div class="flex justify-between text-xs font-mono mb-1">
                <span id="reset-progress-text" class="text-blue-400">Resetting...</span>
                <span id="reset-progress-pct" class="text-blue-400">0%</span>
              </div>
              <div class="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
                <div id="reset-progress-bar" class="bg-blue-500 h-1.5 rounded-full transition-all duration-300" style="width: 0%"></div>
              </div>
            </div>

            <button id="btn-execute-reset" class="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-[0_0_15px_rgba(220,38,38,0.4)] transition-all disabled:opacity-50">
              EXECUTE RESET
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

        <div id="tab-feedback" class="owner-tab-content hidden space-y-4">
          <div class="flex justify-between items-center mb-2">
            <h3 class="text-white font-bold">User Feedback</h3>
            <button id="btn-refresh-feedback" class="text-xs text-blue-400 hover:text-blue-300">Refresh</button>
          </div>
          <div id="owner-feedback-list" class="space-y-3 max-h-[60vh] overflow-y-auto hide-scrollbar">
            <p class="text-center text-gray-500 py-4 font-mono text-sm">Loading feedback...</p>
          </div>
        </div>

        <div id="tab-history" class="owner-tab-content hidden flex-col h-full space-y-4">
          <!-- Main User Directory View -->
          <div id="adv-history-main" class="flex-col flex h-full">
            <div class="flex justify-between items-center mb-3">
              <h3 class="text-white font-bold">Advanced Login History</h3>
              <div class="flex gap-2">
                <button id="btn-delete-all-history" class="text-xs text-red-500 hover:text-red-400 bg-red-500/10 px-2 py-1 rounded">Delete Entire History</button>
                <button id="btn-refresh-history" class="text-xs text-blue-400 hover:text-blue-300 bg-blue-500/10 px-2 py-1 rounded">Refresh</button>
              </div>
            </div>

            <!-- Global Stats -->
            <div class="grid grid-cols-2 gap-2 mb-4">
              <div class="bg-gray-800/80 p-2 rounded-lg border border-gray-700/50 text-center"><p class="text-[10px] text-gray-400">Total Sessions</p><p class="text-white font-bold" id="hist-stat-total">-</p></div>
              <div class="bg-gray-800/80 p-2 rounded-lg border border-gray-700/50 text-center"><p class="text-[10px] text-gray-400">Today's Logins</p><p class="text-white font-bold" id="hist-stat-today">-</p></div>
              <div class="bg-gray-800/80 p-2 rounded-lg border border-gray-700/50 text-center"><p class="text-[10px] text-gray-400">Currently Online</p><p class="text-green-400 font-bold" id="hist-stat-online">-</p></div>
              <div class="bg-gray-800/80 p-2 rounded-lg border border-gray-700/50 text-center"><p class="text-[10px] text-gray-400">Total App Usage Time</p><p class="text-blue-400 font-bold text-xs mt-1" id="hist-stat-usage">-</p></div>
              <div class="bg-gray-800/80 p-2 rounded-lg border border-gray-700/50 text-center col-span-2"><p class="text-[10px] text-gray-400">Avg Session</p><p class="text-white text-xs mt-1" id="hist-stat-avg">-</p></div>
              <div class="bg-gray-800/80 p-2 rounded-lg border border-gray-700/50 text-center"><p class="text-[10px] text-gray-400">Longest</p><p class="text-white text-[10px] mt-1" id="hist-stat-max">-</p></div>
              <div class="bg-gray-800/80 p-2 rounded-lg border border-gray-700/50 text-center"><p class="text-[10px] text-gray-400">Shortest</p><p class="text-white text-[10px] mt-1" id="hist-stat-min">-</p></div>
            </div>

            <!-- User List -->
            <div id="owner-history-list" class="space-y-2 overflow-y-auto hide-scrollbar flex-1 pb-10">
              <p class="text-center text-gray-500 py-4 font-mono text-sm">Loading users...</p>
            </div>
          </div>

          <!-- Individual User Sub-View -->
          <div id="adv-history-sub" class="hidden flex-col h-full">
            <button id="btn-back-history" class="text-xs text-blue-400 hover:text-blue-300 mb-3 flex items-center gap-1">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg> Back to Users
            </button>
            <div class="bg-gray-800/80 rounded-xl p-3 mb-3 border border-gray-700 flex flex-col gap-2 relative">
               <button id="btn-delete-user-sessions" class="absolute top-2 right-2 text-red-400 hover:text-red-300 bg-red-400/10 p-1.5 rounded-lg text-[10px] font-bold">🗑 DELETE ALL SESSIONS</button>
               <div class="flex items-center gap-3">
                 <img id="sub-user-photo" src="" class="w-12 h-12 rounded-full object-cover bg-gray-700 hidden">
                 <div id="sub-user-initials" class="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-lg hidden"></div>
                 <div>
                   <h4 id="sub-user-name" class="text-white font-bold"></h4>
                   <p id="sub-user-email" class="text-xs text-gray-400"></p>
                 </div>
               </div>
               <div class="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-gray-700/50">
                 <div><span class="text-[10px] text-gray-500 block">Total Sessions</span><span class="text-white text-sm" id="sub-user-total">0</span></div>
                 <div><span class="text-[10px] text-gray-500 block">Total Usage Time</span><span class="text-white text-sm" id="sub-user-time">0s</span></div>
                 <div><span class="text-[10px] text-gray-500 block">Last Login</span><span class="text-white text-xs" id="sub-user-last">-</span></div>
                 <div><span class="text-[10px] text-gray-500 block">Current Status</span><span class="text-white text-xs font-bold" id="sub-user-status">-</span></div>
               </div>
            </div>
            <h4 class="text-gray-300 font-bold text-xs mb-2 uppercase tracking-wider">Session History</h4>
            <div id="sub-user-sessions" class="space-y-3 overflow-y-auto hide-scrollbar flex-1 pb-10">
            </div>
          </div>
        </div>

        <div id="tab-system" class="owner-tab-content hidden space-y-4">

          <div class="bg-[#1e293b] rounded-2xl p-4 border border-[#d4af37]/30 shadow-[0_0_15px_rgba(212,175,55,0.1)]">
            <h3 class="text-white font-bold text-sm mb-4 flex items-center gap-2"><span class="text-xl">🚀</span> APP LAUNCH CONTROL</h3>
            
            <div class="flex items-center justify-between mb-4 pb-4 border-b border-gray-700/50">
              <span class="text-sm font-semibold text-gray-300">Launch System</span>
              <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" id="toggle-launch" class="sr-only peer">
                <div class="w-11 h-6 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#d4af37]"></div>
              </label>
            </div>
            
            <div class="space-y-3 mb-4">
              <div>
                <label class="block text-xs text-gray-400 mb-1">Launch Date</label>
                <input type="date" id="launch-date" class="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#d4af37]">
              </div>
              <div>
                <label class="block text-xs text-gray-400 mb-1">Launch Time</label>
                <input type="time" id="launch-time" class="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#d4af37]">
              </div>
            </div>
            
            <button id="btn-save-launch" class="w-full py-2.5 bg-[#d4af37] hover:bg-[#b5952f] text-black font-bold rounded-xl transition-all text-sm mb-3">SAVE LAUNCH SETTINGS</button>
            <button id="btn-preview-launch" class="w-full py-2 bg-gray-800 border border-gray-600 hover:bg-gray-700 text-white font-semibold rounded-xl transition-all text-sm flex items-center justify-center gap-2">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
              Preview Launch Screen
            </button>
          </div>

          <!-- Special Intro Manager (Friendship Day) -->
          <div class="bg-[#1e293b] rounded-2xl p-4 border border-amber-500/30 shadow-md">
            <div class="flex items-center justify-between mb-3">
              <div>
                <h3 class="text-white font-bold text-sm flex items-center gap-1.5">
                  <span class="text-amber-400">✨</span> Special Intro Manager
                </h3>
                <p class="text-xs text-gray-400 mt-0.5">Intro Type: <span class="text-amber-300 font-semibold">Friendship Day</span></p>
              </div>
              <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" id="toggle-friendship-intro" class="sr-only peer">
                <div class="w-11 h-6 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
              </label>
            </div>
            
            <div class="mb-3">
              <label class="block text-xs text-gray-400 mb-1">Activation Date</label>
              <input type="date" id="friendship-intro-date" class="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-400">
            </div>

            <button id="btn-save-friendship-intro" class="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-black font-bold rounded-xl transition-all text-sm mb-2">
              SAVE FRIENDSHIP INTRO SETTINGS
            </button>
            <button id="btn-preview-friendship-intro" class="w-full py-2 bg-gray-800 border border-gray-600 hover:bg-gray-700 text-amber-300 font-semibold rounded-xl transition-all text-sm flex items-center justify-center gap-2">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              Preview Friendship Intro
            </button>
          </div>

          <div class="bg-[#1e293b] rounded-2xl p-4 border border-gray-700/50 shadow-md flex items-center justify-between">
            <h3 class="text-white font-bold text-sm">Birthday Feature</h3>
            <label class="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" id="toggle-birthday" class="sr-only peer">
              <div class="w-11 h-6 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
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

        <div id="tab-screenshots" class="owner-tab-content hidden space-y-4">
          <!-- Screenshot Alert Mode Toggle -->
          <div class="bg-[#1e293b] rounded-2xl p-4 border border-red-500/30 shadow-[0_0_15px_rgba(239,68,68,0.1)]">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <span class="text-2xl">📸</span>
                <div>
                  <h3 class="text-white font-bold text-sm">Screenshot Alert Mode</h3>
                  <p class="text-[10px] text-gray-400 mt-0.5">ON = All users notified &bull; OFF = Owner only</p>
                </div>
              </div>
              <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" id="toggle-screenshot-alert" class="sr-only peer">
                <div class="w-11 h-6 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-500"></div>
              </label>
            </div>
          </div>

          <!-- Screenshot Activity Log -->
          <div class="bg-[#1e293b] rounded-2xl p-4 border border-gray-700/50 shadow-md">
            <div class="flex justify-between items-center mb-3">
              <h3 class="text-white font-bold text-sm flex items-center gap-2">
                <span class="text-lg">📋</span> Screenshot Activity
              </h3>
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                <span class="text-[10px] text-green-400 font-mono">REALTIME</span>
              </div>
            </div>
            <div id="screenshot-activity-list" class="space-y-3 max-h-[60vh] overflow-y-auto hide-scrollbar">
              <p class="text-center text-gray-500 py-4 font-mono text-sm">Loading screenshot activity...</p>
            </div>
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
  container.querySelector('#btn-full-app-reset').addEventListener('click', () => showFullAppResetModal(container));
  container.querySelector('#btn-execute-reset').addEventListener('click', () => executeAdvancedReset(container));
  
  // Connect "Everything" checkbox logic
  const everythingCheck = container.querySelector('#reset-everything');
  const otherChecks = container.querySelectorAll('#reset-options input[type="checkbox"]:not(#reset-everything)');
  if (everythingCheck) {
    everythingCheck.addEventListener('change', (e) => {
      otherChecks.forEach(chk => chk.checked = e.target.checked);
    });
  }
  otherChecks.forEach(chk => chk.addEventListener('change', () => {
    if (!chk.checked) everythingCheck.checked = false;
  }));
  
  // Bind system actions
  container.querySelector('#btn-refresh-posts').addEventListener('click', () => loadPosts(container));
  container.querySelector('#btn-refresh-feedback').addEventListener('click', () => loadFeedback(container));
  container.querySelector('#btn-refresh-history').addEventListener('click', () => loadHistory(container));
  container.querySelector('#btn-refresh-bday-history')?.addEventListener('click', () => loadBdayHistory(container));
  container.querySelector('#btn-send-announcement').addEventListener('click', () => executeSendAnnouncement(container));
  container.querySelector('#btn-reset-notifs').addEventListener('click', () => executeResetNotifications());
  container.querySelector('#btn-force-refresh').addEventListener('click', () => executeForceRefresh());
  container.querySelector('#btn-recalc-leaderboard').addEventListener('click', () => executeRecalcLeaderboard());

  // Setup birthday toggle
  setupBirthdayToggle(container);
  setupLaunchControl(container);
  setupFriendshipIntroControl(container);
  setupScreenshotAlertToggle(container);

  // Load data in background
  setTimeout(() => loadPosts(container), 500);
  setTimeout(() => loadFeedback(container), 1000);
  setTimeout(() => loadHistory(container), 1500);
  setTimeout(() => loadBdayHistory(container), 2000);
  setTimeout(() => loadScreenshotActivity(container), 2500);

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
        ${(u?.photoURL && u?.photoURL !== 'undefined') || (u?.profilePic && u?.profilePic !== 'undefined') 
          ? `<img src="${(u.photoURL && u.photoURL !== 'undefined' ? u.photoURL : u.profilePic)}" class="w-10 h-10 rounded-lg object-cover border border-gray-600"/>`
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
    const { collection, getDocs, query, where } = await import('../firebase-config.js');
    const postsSnap = await getDocs(query(collection(db, 'posts'), where('authorId', '==', uid)));
    
    totalPosts = postsSnap.size;
    postsSnap.forEach(d => {
      const p = d.data();
      totalLikes += (p.likes?.length || 0);
      if (p.comments) {
        totalComments += p.comments.filter(c => c.authorId === uid || c.userId === uid).length;
      }
    });

    const userDoc = await getDoc(doc(db, 'users', uid));
    if (userDoc.exists()) {
      computedPoints = userDoc.data().points || 0;
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
          ${(user.photoURL && user.photoURL !== 'undefined') || (user.profilePic && user.profilePic !== 'undefined') 
            ? `<img src="${(user.photoURL && user.photoURL !== 'undefined' ? user.photoURL : user.profilePic)}" class="w-16 h-16 rounded-xl object-cover border border-gray-600"/>`
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

async function deleteInBatches(docsToDelete, collectionName, onProgress, startPct, endPct) {
  if (!docsToDelete || docsToDelete.length === 0) return;
  const chunkSize = 400;
  for (let i = 0; i < docsToDelete.length; i += chunkSize) {
    const chunk = docsToDelete.slice(i, i + chunkSize);
    const batch = writeBatch(db);
    chunk.forEach(ref => batch.delete(ref));
    await batch.commit();
    const currentPct = Math.round(startPct + ((i + chunk.length) / docsToDelete.length) * (endPct - startPct));
    if (onProgress) onProgress(currentPct, `Clearing ${collectionName}...`);
  }
}

async function executeAdvancedReset(container) {
  const secretInput = container.querySelector('#owner-secret-code').value;
  if (secretInput !== 'OWNER777') {
    showToast('Invalid Owner Secret Code', 'error');
    return;
  }

  const selectedOptions = Array.from(container.querySelectorAll('#reset-options input[type="checkbox"]:checked')).map(c => c.value);
  if (selectedOptions.length === 0) {
    showToast('Select at least one module to reset', 'warning');
    return;
  }

  if (!confirm('Are you sure?\nThis action cannot be undone.')) return;

  const btn = container.querySelector('#btn-execute-reset');
  const progContainer = container.querySelector('#reset-progress-container');
  const progText = container.querySelector('#reset-progress-text');
  const progPct = container.querySelector('#reset-progress-pct');
  const progBar = container.querySelector('#reset-progress-bar');
  
  btn.disabled = true;
  btn.textContent = 'EXECUTING RESET...';
  progContainer.classList.remove('hidden');

  const updateProgress = (pct, text) => {
    progPct.textContent = `${pct}%`;
    progBar.style.width = `${pct}%`;
    if (text) progText.textContent = text;
  };

  try {
    let totalSteps = selectedOptions.length;
    let stepSize = 100 / totalSteps;
    let currentStep = 0;

    const hasOption = (opt) => selectedOptions.includes(opt) || selectedOptions.includes('everything');

    // 1. Messages / Group Messages
    if (hasOption('messages') || hasOption('group_messages')) {
      updateProgress(Math.round(currentStep * stepSize), 'Fetching Chats...');
      const chatsSnap = await getDocs(collection(db, 'chats'));
      
      let chatRefsToDelete = [];
      let messageRefsToDelete = [];
      
      for (const chatDoc of chatsSnap.docs) {
        const data = chatDoc.data();
        const isGroup = !!data.isGroup;
        if ((isGroup && hasOption('group_messages')) || (!isGroup && hasOption('messages'))) {
          chatRefsToDelete.push(chatDoc.ref);
          const msgsSnap = await getDocs(collection(db, 'chats', chatDoc.id, 'messages'));
          msgsSnap.forEach(m => messageRefsToDelete.push(m.ref));
        }
      }
      
      await deleteInBatches(messageRefsToDelete, 'Messages', updateProgress, currentStep * stepSize, (currentStep + 0.5) * stepSize);
      await deleteInBatches(chatRefsToDelete, 'Chats', updateProgress, (currentStep + 0.5) * stepSize, (currentStep + 1) * stepSize);
      currentStep += (hasOption('messages') && hasOption('group_messages') ? 2 : 1); // Adjust roughly
    }

    // 2. Call History
    if (hasOption('call_history')) {
      updateProgress(Math.round(currentStep * stepSize), 'Clearing Calls...');
      const callsSnap = await getDocs(collection(db, 'calls'));
      let callRefs = [];
      callsSnap.forEach(d => callRefs.push(d.ref));
      await deleteInBatches(callRefs, 'Calls', updateProgress, currentStep * stepSize, (currentStep + 1) * stepSize);
      currentStep++;
    }

    // 3. Notifications & Miss You
    if (hasOption('notifications') || hasOption('miss_you_notifications')) {
      updateProgress(Math.round(currentStep * stepSize), 'Clearing Notifications...');
      const notifSnap = await getDocs(collection(db, 'notifications'));
      let notifRefs = [];
      notifSnap.forEach(d => {
        const data = d.data();
        if (hasOption('notifications') || (hasOption('miss_you_notifications') && data.type === 'miss_you')) {
          notifRefs.push(d.ref);
        }
      });
      await deleteInBatches(notifRefs, 'Notifications', updateProgress, currentStep * stepSize, (currentStep + 1) * stepSize);
      currentStep += (hasOption('notifications') && hasOption('miss_you_notifications') ? 2 : 1);
    }

    // 4. Posts / Likes / Comments
    if (hasOption('posts') || hasOption('likes') || hasOption('comments')) {
      updateProgress(Math.round(currentStep * stepSize), 'Processing Posts...');
      const postsSnap = await getDocs(collection(db, 'posts'));
      
      let postsToDelete = [];
      let commentsToDelete = [];
      let postsToUpdateLikes = [];
      
      for (const pDoc of postsSnap.docs) {
        if (hasOption('posts')) {
          postsToDelete.push(pDoc.ref);
        } else if (hasOption('likes')) {
          postsToUpdateLikes.push(pDoc.ref);
        }
        
        if (hasOption('posts') || hasOption('comments')) {
          const cSnap = await getDocs(collection(db, 'posts', pDoc.id, 'comments'));
          cSnap.forEach(c => commentsToDelete.push(c.ref));
        }
      }
      
      await deleteInBatches(commentsToDelete, 'Comments', updateProgress, currentStep * stepSize, (currentStep + 0.3) * stepSize);
      
      if (postsToUpdateLikes.length > 0) {
        for (let i = 0; i < postsToUpdateLikes.length; i += 400) {
          const chunk = postsToUpdateLikes.slice(i, i + 400);
          const batch = writeBatch(db);
          chunk.forEach(ref => batch.update(ref, { likes: [] }));
          await batch.commit();
        }
      }
      
      if (postsToDelete.length > 0) {
        await deleteInBatches(postsToDelete, 'Posts', updateProgress, (currentStep + 0.6) * stepSize, (currentStep + 1) * stepSize);
      }
      
      if (hasOption('posts')) currentStep++;
      if (hasOption('likes')) currentStep++;
      if (hasOption('comments')) currentStep++;
    }

    // 5. Polls
    if (hasOption('polls')) {
      updateProgress(Math.round(currentStep * stepSize), 'Clearing Polls...');
      const pollsSnap = await getDocs(collection(db, 'polls'));
      let pollRefs = [];
      pollsSnap.forEach(d => pollRefs.push(d.ref));
      await deleteInBatches(pollRefs, 'Polls', updateProgress, currentStep * stepSize, (currentStep + 1) * stepSize);
      currentStep++;
    }

    // 6. Diaries
    if (hasOption('diaries')) {
      updateProgress(Math.round(currentStep * stepSize), 'Clearing Diaries...');
      const diarySnap = await getDocs(collection(db, 'diary'));
      let dRefs = [];
      diarySnap.forEach(d => dRefs.push(d.ref));
      await deleteInBatches(dRefs, 'Diaries', updateProgress, currentStep * stepSize, (currentStep + 1) * stepSize);
      currentStep++;
    }

    // 7. Time Capsules
    if (hasOption('time_capsules')) {
      updateProgress(Math.round(currentStep * stepSize), 'Clearing Time Capsules...');
      const capSnap = await getDocs(collection(db, 'timeCapsules'));
      let capRefs = [];
      let capMsgRefs = [];
      for (const cDoc of capSnap.docs) {
        capRefs.push(cDoc.ref);
        const mSnap = await getDocs(collection(db, 'timeCapsules', cDoc.id, 'messages'));
        mSnap.forEach(m => capMsgRefs.push(m.ref));
      }
      await deleteInBatches(capMsgRefs, 'Capsule Msgs', updateProgress, currentStep * stepSize, (currentStep + 0.5) * stepSize);
      await deleteInBatches(capRefs, 'Capsules', updateProgress, (currentStep + 0.5) * stepSize, (currentStep + 1) * stepSize);
      currentStep++;
    }

    // 8. Slam Books
    if (hasOption('slam_books')) {
      updateProgress(Math.round(currentStep * stepSize), 'Clearing Slam Books...');
      const sbSnap = await getDocs(collection(db, 'slambooks'));
      const sbrSnap = await getDocs(collection(db, 'slambookResponses'));
      let sbRefs = [];
      sbSnap.forEach(d => sbRefs.push(d.ref));
      sbrSnap.forEach(d => sbRefs.push(d.ref));
      await deleteInBatches(sbRefs, 'Slam Books', updateProgress, currentStep * stepSize, (currentStep + 1) * stepSize);
      currentStep++;
    }

    // 9. Birthday Wishes
    if (hasOption('birthday_wishes')) {
      updateProgress(Math.round(currentStep * stepSize), 'Clearing Birthdays...');
      const bdaySnap = await getDocs(collection(db, 'birthdayPoints'));
      let bRefs = [];
      bdaySnap.forEach(d => bRefs.push(d.ref));
      await deleteInBatches(bRefs, 'Birthdays', updateProgress, currentStep * stepSize, (currentStep + 1) * stepSize);
      currentStep++;
    }

    // 10. Activity Logs (Badges)
    if (hasOption('activity_logs')) {
      updateProgress(Math.round(currentStep * stepSize), 'Clearing Activity Logs...');
      const badgeSnap = await getDocs(collection(db, 'badges'));
      let badgeRefs = [];
      badgeSnap.forEach(d => badgeRefs.push(d.ref));
      await deleteInBatches(badgeRefs, 'Activity Logs', updateProgress, currentStep * stepSize, (currentStep + 1) * stepSize);
      currentStep++;
    }

    // 11. Leaderboard / User Points / Friends List
    if (hasOption('leaderboard_points') || hasOption('user_points') || hasOption('friends_list')) {
      updateProgress(Math.round(currentStep * stepSize), 'Updating Users...');
      const usersSnap = await getDocs(collection(db, 'users'));
      let userRefs = [];
      usersSnap.forEach(d => userRefs.push(d.ref));
      
      for (let i = 0; i < userRefs.length; i += 400) {
        const chunk = userRefs.slice(i, i + 400);
        const batch = writeBatch(db);
        chunk.forEach(ref => {
          let updates = {};
          if (hasOption('leaderboard_points') || hasOption('user_points')) updates.points = 0;
          if (hasOption('friends_list')) updates.closeFriends = [];
          batch.update(ref, updates);
        });
        await batch.commit();
      }
      if (hasOption('leaderboard_points')) currentStep++;
      if (hasOption('user_points')) currentStep++;
      if (hasOption('friends_list')) currentStep++;
    }

    updateProgress(100, 'Reset Completed Successfully');
    
    // Write Log
    await addDoc(collection(db, 'resetLogs'), {
      ownerName: authManager.currentUser?.displayName || 'Owner',
      ownerId: authManager.currentUser?.uid,
      resetType: hasOption('everything') ? ['Everything (Full Reset)'] : selectedOptions,
      timestamp: serverTimestamp()
    });

    showToast('Reset Completed Successfully', 'success');
    container.querySelector('#owner-secret-code').value = '';
    
  } catch (err) {
    console.error('Reset error:', err);
    showToast('Reset failed or partially completed', 'error');
    updateProgress(100, 'Reset Error');
  }

  btn.disabled = false;
  btn.textContent = 'EXECUTE RESET';
  setTimeout(() => { progContainer.classList.add('hidden'); }, 3000);
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
      const pollPoints = userPolls.length * 2;
      const diaryPoints = userDiaries.length * 4;
      const capsulePoints = userCapsules.length * 5;

      const userBdayPointsReceived = birthdayPointsDocs
        .filter(bp => bp.targetUserId === id)
        .reduce((sum, bp) => sum + (bp.points || 0), 0);
        
      const userBdayPointsGiven = birthdayPointsDocs
        .filter(bp => bp.senderId === id && bp.type === 'birthday_gift')
        .reduce((sum, bp) => sum + (bp.points || 0), 0);

      const userSlambooks = slambooks.filter(b => b.ownerId === id);
      const slambookConfigPoints = userSlambooks.length * 6;

      const uniqueSlambooksAnswered = new Set();
      slambookResponses.filter(r => r.authorId === id).forEach(r => {
        uniqueSlambooksAnswered.add(r.slambookId);
      });
      const slambookAnswerPoints = uniqueSlambooksAnswered.size * 3;

      let total = postPoints + likePoints + commentPoints + pollPoints + diaryPoints + capsulePoints + userBdayPointsReceived + userBdayPointsGiven + slambookConfigPoints + slambookAnswerPoints;

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

// ==========================================
// FULL APP RESET
// ==========================================

function showFullAppResetModal(container) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[300] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-fade-in';
  overlay.innerHTML = `
    <div class="bg-[#0f172a] rounded-2xl p-6 w-full max-w-md border border-red-500/50 shadow-[0_0_30px_rgba(239,68,68,0.3)] relative">
      <div class="w-16 h-16 bg-red-500/20 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4 border-2 border-red-500">
        <svg class="w-8 h-8" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
      </div>
      <h3 class="text-xl font-bold text-white text-center mb-4">Reset Entire App?</h3>
      <p class="text-sm text-gray-300 text-center mb-6 leading-relaxed">
        <span class="text-red-400 font-bold block mb-2">⚠️ This will permanently reset the entire application.</span>
        All points, leaderboard data, claims, activities and temporary data will be removed.<br><br>
        <span class="text-green-400 font-semibold">User accounts and basic profile information will remain.</span>
      </p>

      <!-- Progress indicator for Full Reset -->
      <div id="full-reset-progress-container" class="hidden mb-6 bg-gray-900 p-4 rounded-xl border border-gray-700">
        <div class="flex justify-between text-xs font-mono mb-2">
          <span id="full-reset-progress-text" class="text-blue-400">Initializing...</span>
          <span id="full-reset-progress-pct" class="text-blue-400 font-bold">0%</span>
        </div>
        <div class="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
          <div id="full-reset-progress-bar" class="bg-gradient-to-r from-red-500 to-orange-500 h-2 rounded-full transition-all duration-300" style="width: 0%"></div>
        </div>
      </div>

      <div class="flex gap-3" id="full-reset-buttons">
        <button id="full-reset-cancel" class="flex-1 py-3 rounded-xl border border-gray-600 text-sm font-bold text-gray-400 hover:bg-gray-800 transition-colors">Cancel</button>
        <button id="full-reset-confirm" class="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold shadow-[0_0_15px_rgba(220,38,38,0.4)] transition-all">Reset App</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const cancelBtn = overlay.querySelector('#full-reset-cancel');
  const confirmBtn = overlay.querySelector('#full-reset-confirm');

  cancelBtn.addEventListener('click', () => overlay.remove());

  confirmBtn.addEventListener('click', async () => {
    // Only allow owner
    if (!authManager.isOwner) return;

    confirmBtn.disabled = true;
    cancelBtn.style.display = 'none';
    confirmBtn.innerHTML = '<svg class="animate-spin h-5 w-5 mx-auto text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>';
    
    const progContainer = overlay.querySelector('#full-reset-progress-container');
    progContainer.classList.remove('hidden');

    const updateFullProgress = (pct, text) => {
      overlay.querySelector('#full-reset-progress-pct').textContent = pct + '%';
      overlay.querySelector('#full-reset-progress-bar').style.width = pct + '%';
      if (text) overlay.querySelector('#full-reset-progress-text').textContent = text;
    };

    try {
      await executeFullAppResetLogic(updateFullProgress);
      updateFullProgress(100, 'Reset Complete! 🚀');
      confirmBtn.innerHTML = '✅ DONE';
      confirmBtn.classList.replace('bg-red-600', 'bg-green-600');
      confirmBtn.classList.replace('hover:bg-red-700', 'hover:bg-green-700');
      
      setTimeout(() => {
        overlay.remove();
        showToast('Application fully reset for a new season!', 'success');
      }, 2000);
    } catch (e) {
      console.error('Full App Reset Error:', e);
      showToast('Reset failed. Check console.', 'error');
      confirmBtn.innerHTML = 'Error';
      cancelBtn.style.display = 'block';
      confirmBtn.disabled = false;
    }
  });
}

async function executeFullAppResetLogic(updateProgress) {
  // We have 8 stages for 100%
  const step = Math.floor(100 / 8); 
  let currentPct = 0;

  // 1. Reset Users (Points: 0, SavedPosts: [])
  updateProgress(currentPct, 'Resetting User Points & Data...');
  const usersSnap = await getDocs(collection(db, 'users'));
  let userRefs = [];
  usersSnap.forEach(d => userRefs.push(d.ref));
  for (let i = 0; i < userRefs.length; i += 400) {
    const chunk = userRefs.slice(i, i + 400);
    const batch = writeBatch(db);
    chunk.forEach(ref => {
      batch.update(ref, { 
        points: 0,
        savedPosts: []
      });
    });
    await batch.commit();
  }
  currentPct += step;

  // 2. Clear Birthday Gifts & Claims
  updateProgress(currentPct, 'Clearing Birthday Data...');
  const bdaySnap = await getDocs(collection(db, 'birthdayPoints'));
  let bRefs = [];
  bdaySnap.forEach(d => bRefs.push(d.ref));
  await deleteInBatches(bRefs, 'Birthdays', null, 0, 100);
  currentPct += step;

  // 3. Clear Poll Votes
  updateProgress(currentPct, 'Clearing Poll Votes...');
  const pollsSnap = await getDocs(collection(db, 'polls'));
  let pollUpdates = [];
  pollsSnap.forEach(d => pollUpdates.push({ ref: d.ref, data: d.data() }));
  for (let i = 0; i < pollUpdates.length; i += 400) {
    const chunk = pollUpdates.slice(i, i + 400);
    const batch = writeBatch(db);
    chunk.forEach(p => {
      const opts = p.data.options || [];
      const clearedOpts = opts.map(o => ({ text: o.text, votes: [] }));
      batch.update(p.ref, { options: clearedOpts });
    });
    await batch.commit();
  }
  currentPct += step;

  // 4. Clear Post Likes, Comments & Tags
  updateProgress(currentPct, 'Clearing Post Activity...');
  const postsSnap = await getDocs(collection(db, 'posts'));
  let postsToUpdate = [];
  let commentsToDelete = [];
  
  for (const pDoc of postsSnap.docs) {
    postsToUpdate.push(pDoc.ref);
    const cSnap = await getDocs(collection(db, 'posts', pDoc.id, 'comments'));
    cSnap.forEach(c => commentsToDelete.push(c.ref));
  }
  
  // Update posts first
  for (let i = 0; i < postsToUpdate.length; i += 400) {
    const chunk = postsToUpdate.slice(i, i + 400);
    const batch = writeBatch(db);
    chunk.forEach(ref => {
      batch.update(ref, { 
        likes: [],
        pendingTags: [],
        taggedFriends: [],
        commentCount: 0
      });
    });
    await batch.commit();
  }
  
  // Then delete comments
  updateProgress(currentPct + (step/2), 'Clearing Comments...');
  await deleteInBatches(commentsToDelete, 'Comments', null, 0, 100);
  currentPct += step;

  // 5. Clear Diary Reactions
  updateProgress(currentPct, 'Clearing Diary Reactions...');
  const diarySnap = await getDocs(collection(db, 'diary'));
  let diaryRefs = [];
  diarySnap.forEach(d => diaryRefs.push(d.ref));
  for (let i = 0; i < diaryRefs.length; i += 400) {
    const chunk = diaryRefs.slice(i, i + 400);
    const batch = writeBatch(db);
    chunk.forEach(ref => {
      batch.update(ref, { reactions: [] });
    });
    await batch.commit();
  }
  currentPct += step;

  // 6. Clear Badges / Activity Logs
  updateProgress(currentPct, 'Clearing Activity Logs...');
  const badgeSnap = await getDocs(collection(db, 'badges'));
  let badgeRefs = [];
  badgeSnap.forEach(d => badgeRefs.push(d.ref));
  await deleteInBatches(badgeRefs, 'Badges', null, 0, 100);
  currentPct += step;

  // 7. Clear Notifications
  updateProgress(currentPct, 'Clearing Notifications...');
  const notifSnap = await getDocs(collection(db, 'notifications'));
  let notifRefs = [];
  notifSnap.forEach(d => notifRefs.push(d.ref));
  await deleteInBatches(notifRefs, 'Notifications', null, 0, 100);
  currentPct += step;

  // 8. Final Realtime Flush / Check
  updateProgress(95, 'Syncing Realtime State...');
  // Force userCache and other local states to catch up if needed
  // onSnapshot listeners will auto-trigger because the DB changed!
  // Wait a moment for firestore to flush locally
  await new Promise(r => setTimeout(r, 1000));
}

async function loadFeedback(container) {
  const listEl = container.querySelector('#owner-feedback-list');
  if (!listEl) return;
  listEl.innerHTML = '<p class="text-center text-gray-500 py-4 font-mono text-sm">Loading feedback...</p>';
  try {
    const q = query(collection(db, 'feedback'), orderBy('createdAt', 'desc'), limit(50));
    const snap = await getDocs(q);
    if (snap.empty) {
      listEl.innerHTML = '<p class="text-center text-gray-500 py-4 font-mono text-sm">No feedback found.</p>';
      return;
    }
    let html = '';
    snap.forEach(docSnap => {
      const d = docSnap.data();
      const date = d.createdAt ? d.createdAt.toDate().toLocaleString() : 'Unknown Time';
      html += `
        <div class="bg-[#1e293b] p-3 rounded-xl border border-gray-700/50 shadow-sm flex flex-col gap-2">
          <div class="flex justify-between items-center text-xs text-gray-400">
            <span class="font-bold text-white">${sanitizeHTML(d.userName || 'Unknown')}</span>
            <span>${date}</span>
          </div>
          <p class="text-sm text-gray-300 whitespace-pre-wrap">${sanitizeHTML(d.feedback)}</p>
          <div class="text-[10px] text-gray-500 uppercase tracking-widest text-right">Device: ${d.device || 'Unknown'} | v${d.appVersion || '?'}</div>
        </div>
      `;
    });
    listEl.innerHTML = html;
  } catch (e) {
    listEl.innerHTML = '<p class="text-center text-red-500 py-4 font-mono text-sm">Error loading feedback.</p>';
    console.error(e);
  }
}


// ================= Advanced Login History ================= //
let liveHistoryTimers = [];

function clearHistoryTimers() {
  liveHistoryTimers.forEach(t => clearInterval(t));
  liveHistoryTimers = [];
}

async function loadHistory(container) {
  const listEl = container.querySelector('#owner-history-list');
  const mainView = container.querySelector('#adv-history-main');
  const subView = container.querySelector('#adv-history-sub');
  
  if (!listEl) return;
  listEl.innerHTML = '<p class="text-center text-gray-500 py-4 font-mono text-sm animate-pulse">Loading users...</p>';
  
  mainView.classList.remove('hidden');
  mainView.classList.add('flex');
  subView.classList.add('hidden');
  subView.classList.remove('flex');
  
  clearHistoryTimers();
  
  try {
    const { collection, getDocs, deleteDoc, doc, query, orderBy, limit } = await import('../firebase-config.js');
    
    // Fetch all users first
    const usersSnap = await getDocs(collection(db, 'users'));
    
    // Fetch sessions for all users in parallel
    const sessionPromises = usersSnap.docs.map(async (userDoc) => {
      try {
        const sSnap = await getDocs(collection(db, 'loginHistory', userDoc.id, 'sessions'));
        return sSnap.docs;
      } catch(e) {
        return [];
      }
    });
    
    const sessionDocsArrays = await Promise.all(sessionPromises);
    let allSessions = [];
    sessionDocsArrays.forEach(docs => docs.forEach(d => allSessions.push(d)));
    
    // Sort in memory by loginTime desc
    allSessions.sort((a,b) => {
      const dataA = a.data();
      const dataB = b.data();
      const timeA = dataA.loginTimeClient || (dataA.loginTime ? dataA.loginTime.toMillis() : 0);
      const timeB = dataB.loginTimeClient || (dataB.loginTime ? dataB.loginTime.toMillis() : 0);
      return timeB - timeA;
    });
    
    const snapDocs = allSessions.slice(0, 500);
    
    let totalSessions = 0;
    let todayLogins = 0;
    let onlineUsers = 0;
    let totalUsageMs = 0;
    let longestMs = 0;
    let shortestMs = Infinity;
    
    const todayStr = new Date().toLocaleDateString('en-GB');
    const usersMap = {}; // uid -> { stats, sessions: [] }
    
    snapDocs.forEach(docSnap => {
      const s = docSnap.data();
      if (!s.uid) return;
      
      totalSessions++;
      
      const loginDate = s.loginTimeClient ? new Date(s.loginTimeClient) : (s.loginTime ? s.loginTime.toDate() : new Date());
      if (loginDate.toLocaleDateString('en-GB') === todayStr) todayLogins++;
      
      let isOnline = false;
      let durationMs = 0;
      
      if (s.status === 'Online') {
        const timeSinceActive = Date.now() - (s.lastActive?.toMillis() || Date.now());
        if (timeSinceActive < 90000) {
          isOnline = true;
          onlineUsers++;
        }
      }
      
      if (isOnline) {
        durationMs = Date.now() - (s.loginTimeClient || loginDate.getTime());
      } else if (s.logoutTime) {
        durationMs = s.logoutTime.toMillis() - (s.loginTimeClient || loginDate.getTime());
      } else if (s.durationSeconds) {
        durationMs = s.durationSeconds * 1000;
      }
      
      if (durationMs < 0) durationMs = 0;
      totalUsageMs += durationMs;
      if (durationMs > longestMs) longestMs = durationMs;
      if (durationMs > 0 && durationMs < shortestMs) shortestMs = durationMs;
      
      if (!usersMap[s.uid]) {
        usersMap[s.uid] = {
          uid: s.uid,
          name: s.name,
          email: s.email,
          photo: s.photo,
          totalSessions: 0,
          totalUsageMs: 0,
          isOnline: false,
          lastLogin: loginDate,
          sessions: []
        };
      }
      
      const u = usersMap[s.uid];
      u.totalSessions++;
      u.totalUsageMs += durationMs;
      if (isOnline) u.isOnline = true;
      if (loginDate > u.lastLogin) u.lastLogin = loginDate;
      u.sessions.push({ id: docSnap.id, ...s, calculatedDurationMs: durationMs, isOnline });
    });
    
    // Update Global Stats
    container.querySelector('#hist-stat-total').innerText = totalSessions;
    container.querySelector('#hist-stat-today').innerText = todayLogins;
    container.querySelector('#hist-stat-online').innerText = onlineUsers;
    container.querySelector('#hist-stat-usage').innerText = formatMs(totalUsageMs);
    container.querySelector('#hist-stat-avg').innerText = totalSessions > 0 ? formatMs(totalUsageMs / totalSessions) : '0s';
    container.querySelector('#hist-stat-max').innerText = longestMs > 0 ? formatMs(longestMs) : '0s';
    container.querySelector('#hist-stat-min').innerText = shortestMs !== Infinity ? formatMs(shortestMs) : '0s';
    
    const userArray = Object.values(usersMap).sort((a,b) => b.lastLogin - a.lastLogin);
    
    if (userArray.length === 0) {
      listEl.innerHTML = '<p class="text-center text-gray-500 py-4 font-mono text-sm">No login history found.</p>';
      return;
    }
    
    let html = '';
    userArray.forEach(u => {
      const statusHtml = u.isOnline 
        ? `<span class="px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-[10px] font-bold tracking-wide animate-pulse">ONLINE</span>`
        : `<span class="px-2 py-0.5 bg-gray-700 text-gray-400 rounded text-[10px] font-bold tracking-wide">OFFLINE</span>`;
        
      html += `
        <div class="user-hist-card bg-gray-800/50 hover:bg-gray-800 p-3 rounded-xl border border-gray-700/50 cursor-pointer transition-all flex items-center justify-between gap-3" data-uid="${u.uid}">
          <div class="relative">
            ${u.photo ? `<img src="${u.photo}" class="w-10 h-10 rounded-full object-cover">` : `<div class="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold">${(u.name||'?')[0].toUpperCase()}</div>`}
            ${u.isOnline ? `<div class="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-gray-800 rounded-full"></div>` : ''}
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-bold text-white text-sm truncate">${sanitizeHTML(u.name || 'Unknown')}</p>
            <p class="text-xs text-gray-400 truncate">${u.totalSessions} Sessions • ${formatMs(u.totalUsageMs)}</p>
          </div>
          <div class="flex flex-col items-end gap-1">
            ${statusHtml}
            <span class="text-[9px] text-gray-500">${u.lastLogin.toLocaleDateString()}</span>
          </div>
        </div>
      `;
    });
    
    listEl.innerHTML = html;
    
    // Bind click events to open sub-view
    listEl.querySelectorAll('.user-hist-card').forEach(card => {
      card.addEventListener('click', () => openUserHistory(card.dataset.uid, usersMap[card.dataset.uid], container));
    });

    // Master Delete Button
    const btnMaster = container.querySelector('#btn-delete-all-history');
    if (btnMaster) {
      // replace clone to drop old listeners
      const newBtn = btnMaster.cloneNode(true);
      btnMaster.parentNode.replaceChild(newBtn, btnMaster);
      newBtn.addEventListener('click', async () => {
        if (!confirm('WARNING: This will permanently delete ALL login history for ALL users. Continue?')) return;
        try {
          const { writeBatch } = await import('../firebase-config.js');
          const batch = writeBatch(db);
          snapDocs.forEach(d => batch.delete(d.ref));
          await batch.commit();
          showToast('Entire login history deleted', 'success');
          loadHistory(container);
        } catch(e) {
          console.error(e);
          showToast('Failed to delete history', 'error');
        }
      });
    }

  } catch (e) {
    listEl.innerHTML = '<p class="text-center text-red-500 py-4 font-mono text-sm">Error loading history.</p>';
    console.error(e);
  }
}

function openUserHistory(uid, userData, container) {
  const mainView = container.querySelector('#adv-history-main');
  const subView = container.querySelector('#adv-history-sub');
  
  mainView.classList.add('hidden');
  mainView.classList.remove('flex');
  subView.classList.remove('hidden');
  subView.classList.add('flex');
  
  clearHistoryTimers();
  
  // Populate User Header
  const photo = container.querySelector('#sub-user-photo');
  const initials = container.querySelector('#sub-user-initials');
  if (userData.photo) {
    photo.src = userData.photo;
    photo.classList.remove('hidden');
    initials.classList.add('hidden');
  } else {
    initials.innerText = (userData.name||'?')[0].toUpperCase();
    initials.classList.remove('hidden');
    photo.classList.add('hidden');
  }
  
  container.querySelector('#sub-user-name').innerText = userData.name || 'Unknown User';
  container.querySelector('#sub-user-email').innerText = userData.email || 'No email';
  container.querySelector('#sub-user-total').innerText = userData.totalSessions;
  container.querySelector('#sub-user-time').innerText = formatMs(userData.totalUsageMs);
  container.querySelector('#sub-user-last').innerText = userData.lastLogin.toLocaleString();
  container.querySelector('#sub-user-status').innerText = userData.isOnline ? '🟢 Online' : '⚪ Offline';
  
  // Populate Sessions
  const sessionsList = container.querySelector('#sub-user-sessions');
  let sHtml = '';
  userData.sessions.forEach((s, idx) => {
    const isLive = s.isOnline;
    const loginStr = (s.loginTimeClient ? new Date(s.loginTimeClient) : (s.loginTime?.toDate() || new Date())).toLocaleString();
    const logoutStr = isLive ? 'Currently Active' : (s.logoutTime ? s.logoutTime.toDate().toLocaleString() : 'Unknown');
    const statusLabel = isLive 
      ? `<span class="text-green-400 font-bold tracking-wide animate-pulse">🟢 Currently Online</span>`
      : `<span class="text-gray-400 font-semibold">Completed</span>`;
      
    sHtml += `
      <div class="bg-gray-800 p-3 rounded-lg border border-gray-700 relative">
        <button class="btn-del-session absolute top-2 right-2 text-gray-500 hover:text-red-400 p-1" data-id="${s.id}">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
        </button>
        <div class="flex justify-between items-center mb-2 border-b border-gray-700 pb-2 mr-6">
          <span class="text-white font-bold text-sm">Session #${userData.totalSessions - idx}</span>
          ${statusLabel}
        </div>
        <div class="grid grid-cols-2 gap-y-2 text-xs">
          <div><span class="text-gray-500 block">Login</span><span class="text-gray-300">${loginStr}</span></div>
          <div><span class="text-gray-500 block">Logout</span><span class="text-gray-300">${logoutStr}</span></div>
          <div class="col-span-2"><span class="text-gray-500 block">Used For</span><span class="text-blue-400 font-mono text-sm ${isLive ? 'live-timer' : ''}" data-start="${s.loginTimeClient || s.loginTime?.toMillis()}">${isLive ? 'Calculating...' : formatMsFull(s.calculatedDurationMs)}</span></div>
          <div><span class="text-gray-500 block">Device</span><span class="text-gray-300">${s.device || 'Unknown'} - ${s.os || 'Unknown'}</span></div>
          <div><span class="text-gray-500 block">Browser</span><span class="text-gray-300">${s.browser || 'Unknown'}</span></div>
        </div>
      </div>
    `;
  });
  
  sessionsList.innerHTML = sHtml;
  
  // Start live timers
  sessionsList.querySelectorAll('.live-timer').forEach(el => {
    const startMs = parseInt(el.dataset.start);
    if (!startMs) return;
    const update = () => el.innerText = formatMsFull(Date.now() - startMs);
    update();
    liveHistoryTimers.push(setInterval(update, 1000));
  });
  
  // Back button
  const backBtn = container.querySelector('#btn-back-history');
  const newBack = backBtn.cloneNode(true);
  backBtn.parentNode.replaceChild(newBack, backBtn);
  newBack.addEventListener('click', () => loadHistory(container));
  
  // Delete all sessions for user
  const delAllBtn = container.querySelector('#btn-delete-user-sessions');
  const newDelAll = delAllBtn.cloneNode(true);
  delAllBtn.parentNode.replaceChild(newDelAll, delAllBtn);
  newDelAll.addEventListener('click', async () => {
    if (!confirm(`Are you sure you want to delete ALL ${userData.totalSessions} sessions for ${userData.name}?`)) return;
    try {
      const { writeBatch, doc } = await import('../firebase-config.js');
      const batch = writeBatch(db);
      userData.sessions.forEach(s => {
        batch.delete(doc(db, 'loginHistory', uid, 'sessions', s.id));
      });
      await batch.commit();
      showToast('User sessions deleted', 'success');
      loadHistory(container); // Go back to main
    } catch(e) {
      console.error(e);
      showToast('Failed: ' + e.message, 'error'); console.error('DELETE ERROR:', e);
    }
  });
  
  // Single session delete
  sessionsList.querySelectorAll('.btn-del-session').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      if (!confirm('Delete this session record?')) return;
      const sid = e.currentTarget.dataset.id;
      try {
        const { deleteDoc, doc } = await import('../firebase-config.js');
        await deleteDoc(doc(db, 'loginHistory', uid, 'sessions', sid));
        btn.closest('.bg-gray-800').remove();
        showToast('Session deleted', 'success');
      } catch(err) {
        console.error(err);
        showToast('Failed: ' + err.message, 'error'); console.error('DELETE ERROR:', err);
      }
    });
  });
}

function formatMs(ms) {
  if (!ms || ms < 0) return '0s';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s%60}s`;
  return `${s}s`;
}

function formatMsFull(ms) {
  if (!ms || ms < 0) return '0 Seconds';
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  let parts = [];
  if (h > 0) parts.push(`${h} Hour${h !== 1 ? 's' : ''}`);
  if (m > 0) parts.push(`${m} Minute${m !== 1 ? 's' : ''}`);
  if (s > 0 || parts.length === 0) parts.push(`${s} Second${s !== 1 ? 's' : ''}`);
  return parts.join(' ');
}
// ========================================================== //


async function setupBirthdayToggle(container) {
  const toggle = container.querySelector('#toggle-birthday');
  if (!toggle) return;
  
  try {
    const settingsRef = doc(db, 'settings', 'features');
    const snap = await getDoc(settingsRef);
    if (snap.exists()) {
      toggle.checked = snap.data().birthdayEnabled ?? false;
    }
  } catch (e) { console.error('Error fetching settings:', e); }

  toggle.addEventListener('change', async (e) => {
    try {
      const settingsRef = doc(db, 'settings', 'features');
      await updateDoc(settingsRef, { birthdayEnabled: e.target.checked }).catch(async () => {
        // Create document if it doesn't exist
        const { setDoc } = await import('../firebase-config.js');
        await setDoc(settingsRef, { birthdayEnabled: e.target.checked });
      });
      showToast('Birthday Feature ' + (e.target.checked ? 'Enabled' : 'Disabled'), 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to update setting', 'error');
      e.target.checked = !e.target.checked;
    }
  });
}

async function setupLaunchControl(container) {
  const toggle = container.querySelector('#toggle-launch');
  const dateInput = container.querySelector('#launch-date');
  const timeInput = container.querySelector('#launch-time');
  const saveBtn = container.querySelector('#btn-save-launch');
  const previewBtn = container.querySelector('#btn-preview-launch');
  if (!toggle || !dateInput || !timeInput || !saveBtn || !previewBtn) return;
  
  const settingsRef = doc(db, 'systemSettings', 'appLaunch');
  let currentSettings = { enabled: false, launchTime: Date.now() };

  try {
    const snap = await getDoc(settingsRef);
    if (snap.exists()) {
      currentSettings = snap.data();
      toggle.checked = currentSettings.enabled;
      if (currentSettings.launchTime) {
        const d = new Date(currentSettings.launchTime.toMillis ? currentSettings.launchTime.toMillis() : currentSettings.launchTime);
        dateInput.value = d.toISOString().split('T')[0];
        timeInput.value = d.toTimeString().substring(0,5);
      }
    }
  } catch (e) { console.error('Error fetching launch settings:', e); }

  toggle.addEventListener('change', async (e) => {
    try {
      const { setDoc, serverTimestamp } = await import('../firebase-config.js');
      await setDoc(settingsRef, { 
        enabled: e.target.checked, 
        updatedBy: authManager.currentUser.uid, 
        updatedAt: serverTimestamp() 
      }, { merge: true });
      showToast('Launch System ' + (e.target.checked ? 'Enabled' : 'Disabled'), 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to update launch setting', 'error');
      e.target.checked = !e.target.checked;
    }
  });

  saveBtn.addEventListener('click', async () => {
    if (!dateInput.value || !timeInput.value) {
      showToast('Please select date and time', 'error');
      return;
    }
    
    const timeVal = new Date(dateInput.value + 'T' + timeInput.value).getTime();
    if (isNaN(timeVal)) {
      showToast('Invalid date/time', 'error');
      return;
    }

    try {
      const { setDoc, serverTimestamp } = await import('../firebase-config.js');
      await setDoc(settingsRef, {
        launchTime: timeVal,
        updatedBy: authManager.currentUser.uid,
        updatedAt: serverTimestamp()
      }, { merge: true });
      showToast('Launch Time Saved!', 'success');
    } catch(e) {
      console.error(e);
      showToast('Failed to save launch time', 'error');
    }
  });

  previewBtn.addEventListener('click', async () => {
    try {
      const { launchManager } = await import('../services/launchManager.js');
      launchManager.previewScreen();
    } catch(e) {
      console.error(e);
      showToast('Could not load preview', 'error');
    }
  });
}

async function setupFriendshipIntroControl(container) {
  const toggle = container.querySelector('#toggle-friendship-intro');
  const dateInput = container.querySelector('#friendship-intro-date');
  const saveBtn = container.querySelector('#btn-save-friendship-intro');
  const previewBtn = container.querySelector('#btn-preview-friendship-intro');
  if (!toggle || !dateInput || !saveBtn || !previewBtn) return;

  try {
    const { friendshipIntroManager } = await import('../services/friendshipIntroManager.js');
    const settings = await friendshipIntroManager.fetchSettings();
    toggle.checked = Boolean(settings.enabled);
    if (settings.selectedDate) {
      dateInput.value = settings.selectedDate;
    } else {
      dateInput.value = '2026-08-02';
    }

    saveBtn.addEventListener('click', async () => {
      if (saveBtn.disabled) return;
      if (!dateInput.value) {
        showToast('Please select date', 'error');
        return;
      }

      saveBtn.disabled = true;
      let saveSuccess = false;

      try {
        await friendshipIntroManager.saveSettings(toggle.checked, dateInput.value);
        friendshipIntroManager.resetSessionSeen();
        showToast('Friendship Intro Settings Saved!', 'success');
        saveSuccess = true;
      } catch(e) {
        console.error(e);
        showToast('Failed to save intro settings', 'error');
      } finally {
        saveBtn.disabled = false;
      }

      if (saveSuccess) {
        try {
          await friendshipIntroManager.checkAndRunIntro();
        } catch(err) {
          console.error('[FriendshipIntro] Error in post-save checkAndRunIntro:', err);
        }
      }
    });

    previewBtn.addEventListener('click', async () => {
      try {
        await friendshipIntroManager.playFriendshipIntro(true);
      } catch(e) {
        console.error(e);
        showToast('Could not load preview', 'error');
      }
    });
  } catch (e) {
    console.error('Error setting up Friendship Intro control:', e);
  }
}

async function loadBdayHistory(container) {
  const list = container.querySelector('#owner-bday-history-list');
  if (!list) return;
  list.innerHTML = `<p class="text-center text-gray-500 py-4 font-mono text-sm">Loading history...</p>`;
  
  try {
    const snap = await getDocs(query(collection(db, 'birthdayWishHistory'), orderBy('archivedAt', 'desc')));
    if (snap.empty) {
      list.innerHTML = `<p class="text-center text-gray-500 py-4 font-mono text-sm">No birthday history found.</p>`;
      return;
    }

    let records = [];
    snap.forEach(d => records.push({ id: d.id, ...d.data() }));

    const renderRecords = (data) => {
      if (data.length === 0) {
        list.innerHTML = `<p class="text-center text-gray-500 py-4 font-mono text-sm">No matches found.</p>`;
        return;
      }
      
      list.innerHTML = data.map(rec => {
        return `
          <div class="bg-[#1e293b] p-4 rounded-xl border border-gray-700/50 relative">
            <div class="flex justify-between items-start mb-2">
              <div>
                <p class="text-white font-bold">${sanitizeHTML(rec.userId)} <span class="text-xs text-gray-400 font-mono">(${rec.year})</span></p>
                <p class="text-[10px] text-gray-400">Archived: ${rec.archivedAt?.toDate ? new Date(rec.archivedAt.toDate()).toLocaleString() : 'N/A'}</p>
              </div>
              <button class="delete-history-btn text-red-500 hover:text-red-400 p-2" data-id="${rec.id}">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>
            <div class="flex gap-4 text-xs text-gray-300 mt-3">
              <span>Wishes: <span class="text-pink-400">${rec.wishesCount || 0}</span></span>
              <span>Replies: <span class="text-blue-400">${rec.repliesCount || 0}</span></span>
              <span>Reactions: <span class="text-green-400">${rec.reactionsCount || 0}</span></span>
            </div>
          </div>
        `;
      }).join('');
      
      // Bind delete
      list.querySelectorAll('.delete-history-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Permanently delete this archived birthday record? This cannot be undone.')) return;
          try {
            await deleteDoc(doc(db, 'birthdayWishHistory', btn.dataset.id));
            btn.closest('.bg-\\[\\#1e293b\\]').remove();
            showToast('Archived history deleted', 'success');
          } catch (e) {
            console.error(e);
            showToast('Failed to delete', 'error');
          }
        });
      });
    };

    renderRecords(records);

    const searchInput = container.querySelector('#owner-search-bday-history');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const queryTerm = e.target.value.toLowerCase();
        const filtered = records.filter(r => 
          (r.userId && r.userId.toLowerCase().includes(queryTerm)) ||
          (r.year && r.year.toString().includes(queryTerm))
        );
        renderRecords(filtered);
      });
    }

  } catch (err) {
    console.error('Error loading bday history:', err);
    list.innerHTML = `<p class="text-center text-red-500 py-4 font-mono text-sm">Failed to load history</p>`;
  }
}

// ==========================================
// SCREENSHOT ALERT TOGGLE & ACTIVITY LOG
// ==========================================

let screenshotActivityUnsubscribe = null;

async function setupScreenshotAlertToggle(container) {
  const toggle = container.querySelector('#toggle-screenshot-alert');
  if (!toggle) return;

  try {
    const settingsRef = doc(db, 'settings', 'features');
    const snap = await getDoc(settingsRef);
    if (snap.exists()) {
      toggle.checked = snap.data().screenshotAlertMode ?? false;
    }
  } catch (e) { console.error('Error fetching screenshot alert settings:', e); }

  toggle.addEventListener('change', async (e) => {
    try {
      const settingsRef = doc(db, 'settings', 'features');
      await updateDoc(settingsRef, { screenshotAlertMode: e.target.checked }).catch(async () => {
        // Create document if it doesn't exist
        await setDoc(settingsRef, { screenshotAlertMode: e.target.checked }, { merge: true });
      });
      showToast('Screenshot Alert Mode ' + (e.target.checked ? 'ON — All users will be notified' : 'OFF — Owner only'), 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to update setting', 'error');
      e.target.checked = !e.target.checked;
    }
  });
}

async function loadScreenshotActivity(container) {
  const list = container.querySelector('#screenshot-activity-list');
  if (!list) return;

  // Clean up previous listener if any
  if (screenshotActivityUnsubscribe) {
    screenshotActivityUnsubscribe();
    screenshotActivityUnsubscribe = null;
  }

  try {
    const q = query(
      collection(db, 'screenshotActivity'),
      orderBy('timestamp', 'desc')
    );

    // Real-time listener
    screenshotActivityUnsubscribe = onSnapshot(q, (snapshot) => {
      if (snapshot.empty) {
        list.innerHTML = `<p class="text-center text-gray-500 py-4 font-mono text-sm">No screenshot activity yet.</p>`;
        return;
      }

      let html = '';
      snapshot.forEach(docSnap => {
        const d = docSnap.data();
        const photo = d.userPhoto;
        const initial = (d.userName || '?')[0].toUpperCase();

        html += `
          <div class="bg-gray-800/60 rounded-xl p-3 border border-gray-700/40 hover:border-red-500/30 transition-colors">
            <div class="flex items-start gap-3">
              <div class="flex-shrink-0">
                ${photo
                  ? `<img src="${sanitizeHTML(photo)}" class="w-10 h-10 rounded-full object-cover border border-gray-600" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
                  : ''}
                <div class="w-10 h-10 rounded-full bg-red-600 items-center justify-center text-white font-bold text-sm" style="display:${photo ? 'none' : 'flex'}">${initial}</div>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-white font-semibold text-sm">👤 ${sanitizeHTML(d.userName || 'Unknown')}</p>
                <p class="text-xs text-gray-400 mt-1">📍 ${sanitizeHTML(d.pageName || 'Unknown Page')}</p>
                ${d.contentTitle ? `<p class="text-xs text-gray-300 mt-0.5">📖 ${sanitizeHTML(d.contentTitle)}</p>` : ''}
                <div class="flex items-center gap-3 mt-2">
                  <span class="text-[10px] text-gray-500 flex items-center gap-1">🕒 ${sanitizeHTML(d.time || '')}</span>
                  <span class="text-[10px] text-gray-500 flex items-center gap-1">📅 ${sanitizeHTML(d.date || '')}</span>
                </div>
              </div>
            </div>
          </div>
        `;
      });

      list.innerHTML = html;
    }, (error) => {
      console.error('Screenshot activity listener error:', error);
      list.innerHTML = `<p class="text-center text-red-500 py-4 font-mono text-sm">Failed to load activity. Index may need creation.</p>`;
    });

  } catch (err) {
    console.error('Error setting up screenshot activity:', err);
    list.innerHTML = `<p class="text-center text-red-500 py-4 font-mono text-sm">Failed to load screenshot activity</p>`;
  }
}
