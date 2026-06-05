// Chat page — WhatsApp-style with typing, presence, images, voice msgs, call buttons
import { db, storage, collection, doc, query, orderBy, onSnapshot, addDoc, getDocs, updateDoc,
  serverTimestamp, where, setDoc, arrayUnion, limit, deleteDoc, getDoc, increment, deleteField,
  storageRef, uploadBytes, getDownloadURL } from '../firebase-config.js';
import { showToast, timeAgo, sanitizeHTML, debounce } from '../utils.js';
import { authManager } from '../auth.js';
import { presenceManager } from '../presence.js';
import { callManager } from '../calls.js';
import { router } from '../router.js';
import { createNotification } from '../notifications.js';

let unsubChats = null;
let unsubMessages = null;
let unsubTyping = null;
let currentChatId = null;
let chatViewOpen = false;

export function destroyChat() {
  if (unsubChats) unsubChats();
  if (unsubMessages) unsubMessages();
  if (unsubTyping) unsubTyping();
  unsubChats = null; unsubMessages = null; unsubTyping = null;
  currentChatId = null; chatViewOpen = false;
  // Hide the chat view overlay
  const cv = document.getElementById('chat-view');
  if (cv) cv.style.display = 'none';
  // Restore bottom nav
  const bn = document.getElementById('bottom-nav');
  if (bn) bn.style.display = '';
}

// Store container reference for reliable DOM access
let chatContainer = null;

export async function renderChat(container) {
  router.registerDestroy('chat', destroyChat);
  destroyChat();
  chatContainer = container;

  container.innerHTML = `
    <section class="px-4 pt-4" id="chat-section">
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-xl font-bold text-navy-800">Messages</h2>
        <div class="flex items-center gap-2">
          <button id="new-chat-btn" class="p-2 rounded-full hover:bg-cream-200 transition-colors text-navy-500" title="New Chat">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"/></svg>
          </button>
        </div>
      </div>

      <!-- Group Chat -->
      <div class="mb-5">
        <h3 class="section-title mb-3">Group Chat</h3>
        <div id="group-chats" class="space-y-1">
          <div class="chat-item" id="core37-chat">
            <div class="avatar avatar-placeholder text-sm">37</div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between">
                <p class="font-semibold text-sm text-navy-800">Core 37 <span class="text-[10px] text-gray-400 font-normal">(Group)</span></p>
              </div>
              <p class="text-xs text-gray-400 truncate" id="core37-last-msg">Tap to open group chat</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Direct Messages -->
      <div>
        <h3 class="section-title mb-3">Direct Messages</h3>
        <div id="dm-list" class="space-y-1"></div>
      </div>
    </section>
  `;

  // Create chat-view as a DIRECT CHILD of document.body (not inside #app)
  // This prevents any parent container's overflow/transform from breaking position:fixed
  let chatView = document.getElementById('chat-view');
  if (!chatView) {
    chatView = document.createElement('div');
    chatView.id = 'chat-view';
    chatView.innerHTML = `
      <div id="chat-header" class="chat-view-header"></div>
      <div id="chat-messages" class="chat-messages-container"></div>
      <div id="typing-indicator" class="typing-indicator-bar">
        <span class="text-xs text-gray-400 flex items-center gap-1">
          <span class="typing-dots"><span>.</span><span>.</span><span>.</span></span>
          <span class="typing-name">typing</span>
        </span>
      </div>
      <div class="chat-input-bar">
        <div class="chat-input-row">
          <button id="attach-btn" class="chat-attach-btn">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13"/></svg>
          </button>
          <input type="text" id="msg-input" class="chat-msg-input" placeholder="Type a message..." autocomplete="off"/>
          <input type="file" id="chat-file-input" accept="image/*" class="hidden"/>
          <button id="send-msg-btn" class="chat-send-btn">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/></svg>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(chatView);
  }
  // Ensure it starts hidden
  chatView.style.display = 'none';

  // New Chat button
  container.querySelector('#new-chat-btn')?.addEventListener('click', () => showNewChatModal());

  // Core 37 Group Chat
  container.querySelector('#core37-chat')?.addEventListener('click', () => {
    openGroupChat(container);
  });

  loadChatList(container);
}

async function showNewChatModal() {
  try {
    const snap = await getDocs(collection(db, 'users'));
    const users = [];
    snap.forEach(d => {
      if (d.id !== authManager.currentUser?.uid) {
        users.push({ id: d.id, ...d.data() });
      }
    });

    const modal = router.openModal('', { title: 'New Message' });
    modal.body.innerHTML = `
      <div class="p-4">
        <input type="text" id="new-chat-search" placeholder="Search classmates..." class="w-full px-4 py-3 border border-gray-200 rounded-2xl text-sm text-navy-800 placeholder:text-gray-400 focus:outline-none focus:border-navy-500 bg-white mb-4"/>
        <div id="new-chat-users" class="space-y-1 max-h-80 overflow-y-auto">
          ${users.map(u => `
            <div class="chat-item new-chat-user" data-uid="${u.id}" data-name="${sanitizeHTML(u.fullName || '')}">
              ${u.profilePic ? `<img src="${u.profilePic}" class="avatar" alt=""/>` : `<div class="avatar avatar-placeholder text-sm">${(u.fullName || '?')[0]}</div>`}
              <div class="flex-1 min-w-0">
                <p class="font-semibold text-sm text-navy-800">${sanitizeHTML(u.fullName || 'Unknown')}</p>
                <p class="text-xs text-gray-400">${u.nickname ? `"${sanitizeHTML(u.nickname)}"` : ''}</p>
              </div>
              <div class="presence-dot-mini ${u.online ? 'online' : ''}" id="newchat-dot-${u.id}"></div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Search filter
    modal.body.querySelector('#new-chat-search')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      modal.body.querySelectorAll('.new-chat-user').forEach(el => {
        const name = el.dataset.name.toLowerCase();
        el.style.display = name.includes(q) ? '' : 'none';
      });
    });

    // Click on user to start chat
    modal.body.querySelectorAll('.new-chat-user').forEach(el => {
      el.addEventListener('click', async () => {
        const targetUid = el.dataset.uid;
        const targetName = el.dataset.name;
        modal.close();
        await startOrOpenDM(targetUid, targetName);
      });
    });

    // Real-time presence watchers for each user in the new chat list
    users.forEach(u => {
      presenceManager.watchUser(u.id, (status) => {
        const dot = modal.body.querySelector(`#newchat-dot-${u.id}`);
        if (dot) {
          dot.classList.toggle('online', status.online);
        }
      });
    });
  } catch (e) {
    showToast('Could not load users', 'error');
  }
}

async function startOrOpenDM(targetUid, targetName) {
  if (!authManager.currentUser) return;
  const myUid = authManager.currentUser.uid;

  // Check if chat already exists
  try {
    const q1 = query(collection(db, 'chats'), where('participants', 'array-contains', myUid));
    const snap = await getDocs(q1);
    let existingChatId = null;

    snap.forEach(d => {
      const data = d.data();
      if (data.type === 'dm' && data.participants.includes(targetUid)) {
        existingChatId = d.id;
      }
    });

    if (existingChatId) {
      const chatSection = document.querySelector('#chat-section');
      openChat(chatSection?.parentElement || document.querySelector('#page-container'), existingChatId, targetName, targetUid);
    } else {
      // Create new chat
      const chatRef = await addDoc(collection(db, 'chats'), {
        type: 'dm',
        participants: [myUid, targetUid],
        participantNames: [authManager.userData?.fullName || 'You', targetName],
        lastMessage: '',
        lastMessageAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        typing: {},
        unreadCount: { [myUid]: 0, [targetUid]: 0 }
      });
      const chatSection = document.querySelector('#chat-section');
      openChat(chatSection?.parentElement || document.querySelector('#page-container'), chatRef.id, targetName, targetUid);
    }
  } catch (e) {
    console.error(e);
    showToast('Could not start chat', 'error');
  }
}

function loadChatList(container) {
  const dmList = container.querySelector('#dm-list');
  if (!authManager.currentUser) {
    dmList.innerHTML = '<p class="text-center text-gray-400 py-8 text-sm">Login to see chats</p>';
    return;
  }

  // Show loading state
  dmList.innerHTML = `
    <div class="space-y-3">
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
    </div>`;

  try {
    // Simple query WITHOUT orderBy to avoid composite index requirement
    // We'll sort client-side after receiving data
    const q = query(
      collection(db, 'chats'),
      where('participants', 'array-contains', authManager.currentUser.uid)
    );
    unsubChats = onSnapshot(q, (snap) => {
      if (snap.empty) {
        dmList.innerHTML = `
          <div class="text-center py-12">
            <div class="text-4xl mb-3">💬</div>
            <p class="text-sm font-semibold text-navy-800 mb-1">Start chatting with your friends</p>
            <p class="text-xs text-gray-400">Tap the ✏️ button above to start a new conversation</p>
          </div>`;
        return;
      }

      // Collect all chats and sort client-side by lastMessageAt (newest first)
      const chats = [];
      snap.forEach(d => {
        const chat = { id: d.id, ...d.data() };
        if (chat.type === 'group' && chat.id === 'core37') return; // Skip group
        chats.push(chat);
      });

      // Sort by lastMessageAt descending (newest first — like WhatsApp)
      chats.sort((a, b) => {
        const aTime = a.lastMessageAt?.toDate ? a.lastMessageAt.toDate().getTime() : 0;
        const bTime = b.lastMessageAt?.toDate ? b.lastMessageAt.toDate().getTime() : 0;
        return bTime - aTime;
      });

      dmList.innerHTML = '';
      chats.forEach(chat => {
        const otherIdx = chat.participants.findIndex(p => p !== authManager.currentUser?.uid);
        const otherName = chat.participantNames?.[otherIdx] || 'Classmate';
        const otherUid = chat.participants?.[otherIdx];
        const unread = chat.unreadCount?.[authManager.currentUser.uid] || 0;
        const lastMsg = chat.lastMessage || 'Start a conversation';
        const time = chat.lastMessageAt?.toDate ? timeAgo(chat.lastMessageAt.toDate()) : '';

        const item = document.createElement('div');
        item.className = `chat-item ${unread > 0 ? 'chat-item-unread' : ''}`;
        item.innerHTML = `
          <div class="relative">
            ${chat.participantPhotos?.[otherIdx]
              ? `<img src="${chat.participantPhotos[otherIdx]}" class="avatar" alt="${sanitizeHTML(otherName)}"/>`
              : `<div class="avatar avatar-placeholder text-sm">${(otherName || '?')[0]}</div>`}
            <div class="presence-dot-mini" id="presence-${otherUid}"></div>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between">
              <p class="font-semibold text-sm text-navy-800">${sanitizeHTML(otherName)}</p>
              <span class="text-[10px] text-gray-400">${time}</span>
            </div>
            <p class="text-xs text-gray-400 truncate">${sanitizeHTML(lastMsg)}</p>
          </div>
          ${unread > 0 ? `<span class="unread-badge">${unread}</span>` : ''}
        `;
        item.addEventListener('click', () => openChat(container, chat.id, otherName, otherUid));
        dmList.appendChild(item);

        // Watch online status for each user in list
        if (otherUid) {
          presenceManager.watchUser(otherUid, (status) => {
            const dot = dmList.querySelector(`#presence-${otherUid}`);
            if (dot) {
              dot.classList.toggle('online', status.online);
            }
          });
        }
      });
    }, (err) => {
      console.error('Chat list error:', err);
      dmList.innerHTML = `
        <div class="text-center py-12">
          <div class="text-4xl mb-3">💬</div>
          <p class="text-sm font-semibold text-navy-800 mb-1">Start chatting with your friends</p>
          <p class="text-xs text-gray-400">Tap the ✏️ button above to start a new conversation</p>
        </div>`;
    });
  } catch (e) {
    dmList.innerHTML = `
      <div class="text-center py-12">
        <div class="text-4xl mb-3">💬</div>
        <p class="text-sm font-semibold text-navy-800 mb-1">Start chatting with your friends</p>
        <p class="text-xs text-gray-400">Tap the ✏️ button to begin!</p>
      </div>`;
  }
}

async function openGroupChat(container) {
  const groupId = 'core37';
  // Ensure group chat doc exists
  try {
    const snap = await getDoc(doc(db, 'chats', groupId));
    if (!snap.exists()) {
      await setDoc(doc(db, 'chats', groupId), {
        type: 'group',
        name: 'Core 37',
        participants: [authManager.currentUser.uid],
        lastMessage: '',
        lastMessageAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        typing: {}
      });
    } else {
      // Add current user to participants if not already
      const data = snap.data();
      if (!data.participants?.includes(authManager.currentUser.uid)) {
        await updateDoc(doc(db, 'chats', groupId), {
          participants: arrayUnion(authManager.currentUser.uid)
        });
      }
    }
  } catch (e) { }

  openChat(container, groupId, 'Core 37', null, true);
}

function openChat(container, chatId, name, otherUid = null, isGroup = false) {
  currentChatId = chatId;
  chatViewOpen = true;
  
  // Clean up previous message listener
  if (unsubMessages) { unsubMessages(); unsubMessages = null; }
  if (unsubTyping) { unsubTyping(); unsubTyping = null; }
  
  // Chat-view is now a direct child of body, show it via display
  const chatView = document.getElementById('chat-view');
  if (!chatView) { console.error('Chat view not found'); return; }
  chatView.style.display = 'flex';

  // Hide bottom nav for full-screen chat experience
  const bottomNav = document.getElementById('bottom-nav');
  if (bottomNav) bottomNav.style.display = 'none';

  const header = chatView.querySelector('#chat-header') || document.querySelector('#chat-header');
  header.innerHTML = `
    <button id="back-chat-btn" class="p-2 -ml-2 text-navy-500 hover:text-navy-700 transition-colors">
      <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
    </button>
    ${isGroup
      ? `<div class="avatar avatar-placeholder text-sm">37</div>`
      : `<div class="avatar avatar-placeholder text-sm">${name[0]}</div>`}
    <div class="flex-1">
      <p class="font-semibold text-sm text-navy-800">${sanitizeHTML(name)}</p>
      <p class="text-[10px] text-gray-400" id="chat-status">${isGroup ? 'Group Chat' : 'Checking status...'}</p>
    </div>
    ${!isGroup ? `
      <button id="voice-call-btn" class="p-2 text-navy-500 hover:text-navy-700 transition-colors" title="Voice Call">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"/></svg>
      </button>
      <button id="video-call-btn" class="p-2 text-navy-500 hover:text-navy-700 transition-colors" title="Video Call">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9.75a2.25 2.25 0 002.25-2.25V7.5a2.25 2.25 0 00-2.25-2.25H4.5A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"/></svg>
      </button>
    ` : ''}
  `;

  // Back button
  const closeChat = () => {
    chatView.style.display = 'none';
    if (unsubMessages) { unsubMessages(); unsubMessages = null; }
    if (unsubTyping) { unsubTyping(); unsubTyping = null; }
    currentChatId = null;
    chatViewOpen = false;
    presenceManager.setTyping(chatId, false);
    // Restore bottom nav
    if (bottomNav) bottomNav.style.display = '';
  };
  header.querySelector('#back-chat-btn').addEventListener('click', closeChat);

  // Call buttons
  header.querySelector('#voice-call-btn')?.addEventListener('click', () => {
    if (otherUid) startCallUI(otherUid, name, 'voice');
  });
  header.querySelector('#video-call-btn')?.addEventListener('click', () => {
    if (otherUid) startCallUI(otherUid, name, 'video');
  });

  // Watch presence for DMs
  if (otherUid) {
    presenceManager.watchUser(otherUid, (status) => {
      const el = chatView.querySelector('#chat-status') || document.querySelector('#chat-status');
      if (el) {
        el.textContent = status.online ? 'Online' : (status.lastSeen ? `Last seen ${timeAgo(status.lastSeen)}` : 'Offline');
        el.className = `text-[10px] ${status.online ? 'text-green-500' : 'text-gray-400'}`;
      }
    });
  }

  // Load messages with auto-scroll and pagination
  const msgContainer = chatView.querySelector('#chat-messages') || document.querySelector('#chat-messages');
  let isFirstLoad = true;
  let messageLimit = 30;
  let chatObserver = null;
  
  const setupMessageListener = () => {
    if (unsubMessages) unsubMessages();
    try {
      // Use desc to get newest messages, then reverse below for UI
      const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('createdAt', 'desc'), limit(messageLimit));
      unsubMessages = onSnapshot(q, (snap) => {
        // Save scroll position for smooth pagination (load older)
        const oldHeight = msgContainer.scrollHeight;
        const oldScroll = msgContainer.scrollTop;
        
        msgContainer.innerHTML = '';
        if (snap.empty) {
          msgContainer.innerHTML = `
            <div class="flex items-center justify-center h-full">
              <div class="text-center">
                <div class="text-4xl mb-2">👋</div>
                <p class="text-sm text-gray-400">Start the conversation!</p>
              </div>
            </div>`;
          return;
        }

        // Pagination observer target
        if (snap.size >= messageLimit) {
          const topEl = document.createElement('div');
          topEl.id = 'chat-top-observer';
          topEl.className = 'py-3 text-center text-[10px] text-navy-300 font-semibold uppercase tracking-wider';
          topEl.textContent = 'Loading older messages...';
          msgContainer.appendChild(topEl);
        }

        let lastDate = '';
        let lastSender = '';
        
        const docs = [];
        snap.forEach(d => docs.push(d));
        docs.reverse(); // Render oldest first (top to bottom)

        docs.forEach(d => {
          const msg = d.data();
          const msgId = d.id;
          const isMine = msg.senderId === authManager.currentUser?.uid;
          const msgTime = msg.createdAt?.toDate ? msg.createdAt.toDate() : new Date();

          const myUid = authManager.currentUser?.uid;
          if (msg.hiddenFor?.includes(myUid) || msg.deletedFor?.includes(myUid)) return;

          const dateStr = msgTime.toLocaleDateString();
          if (dateStr !== lastDate) {
            lastDate = dateStr;
            const dateEl = document.createElement('div');
            dateEl.className = 'flex items-center justify-center my-3';
            dateEl.innerHTML = `<span class="text-[10px] text-gray-400 bg-cream-200/80 px-3 py-1 rounded-full backdrop-blur-sm">${dateStr === new Date().toLocaleDateString() ? 'Today' : dateStr}</span>`;
            msgContainer.appendChild(dateEl);
          }

        // Consecutive same-sender: tighter spacing
        const sameSender = msg.senderId === lastSender;
        lastSender = msg.senderId;

        // Message status ticks
        const status = msg.status || 'sent';
        let tickHTML = '';
        if (isMine) {
          if (status === 'read') tickHTML = '<span class="msg-tick msg-tick-read">✓✓</span>';
          else if (status === 'delivered') tickHTML = '<span class="msg-tick">✓✓</span>';
          else tickHTML = '<span class="msg-tick">✓</span>';
        }

        // Reactions display
        const reactions = msg.reactions || {};
        const reactionEntries = Object.entries(reactions);
        let reactionsHTML = '';
        if (reactionEntries.length > 0) {
          const grouped = {};
          reactionEntries.forEach(([uid, emoji]) => {
            grouped[emoji] = (grouped[emoji] || 0) + 1;
          });
          reactionsHTML = `<div class="msg-reactions">${Object.entries(grouped).map(([emoji, count]) => 
            `<span class="msg-reaction-pill">${emoji}${count > 1 ? ` ${count}` : ''}</span>`
          ).join('')}</div>`;
        }

        // Reply preview
        let replyHTML = '';
        if (msg.replyTo) {
          replyHTML = `
            <div class="msg-reply-preview">
              <div class="msg-reply-bar"></div>
              <div>
                <p class="text-[10px] font-semibold">${sanitizeHTML(msg.replyTo.senderName || '')}</p>
                <p class="text-[10px] truncate max-w-[200px]">${sanitizeHTML(msg.replyTo.text || '📷 Image')}</p>
              </div>
            </div>`;
        }

        // WhatsApp-style "deleted for everyone" placeholder
        if (msg.deletedForEveryone) {
          const delText = isMine ? '🗑 You deleted this message' : '🗑 This message was deleted';
          const msgEl = document.createElement('div');
          msgEl.className = `flex ${isMine ? 'justify-end' : 'justify-start'} ${sameSender ? 'mt-0.5' : 'mt-2'} msg-animate`;
          msgEl.innerHTML = `
            <div class="${isMine ? 'msg-sent' : 'msg-received'} msg-deleted-bubble">
              <p class="text-xs">${delText}</p>
              <p class="text-[9px] ${isMine ? 'text-white/40' : 'text-gray-400'} text-right mt-0.5">${msgTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
            </div>`;
          msgContainer.appendChild(msgEl);
          return; // Skip normal rendering
        }

        // Forwarded label
        let forwardedHTML = '';
        if (msg.forwarded) {
          forwardedHTML = `<p class="text-[10px] italic ${isMine ? 'text-white/60' : 'text-gray-400'} mb-0.5">↗️ Forwarded</p>`;
        }

        const msgEl = document.createElement('div');
        msgEl.className = `flex ${isMine ? 'justify-end' : 'justify-start'} ${sameSender ? 'mt-0.5' : 'mt-2'} msg-animate msg-wrapper`;
        msgEl.innerHTML = `
          <div class="relative msg-bubble-wrap">
            <div class="${isMine ? 'msg-sent' : 'msg-received'} ${msg.imageUrl ? 'p-1' : ''}" data-msgid="${msgId}">
              ${!isMine && isGroup && !sameSender ? `<p class="text-[10px] font-semibold text-navy-500 mb-0.5">${sanitizeHTML(msg.senderName || '')}</p>` : ''}
              ${forwardedHTML}
              ${replyHTML}
              ${msg.imageUrl ? `<img src="${msg.imageUrl}" class="rounded-xl max-w-full max-h-60 mb-1" alt="Shared image" loading="lazy"/>` : ''}
              ${msg.text ? `<p class="text-sm leading-relaxed msg-text-content">${sanitizeHTML(msg.text)}</p>` : ''}
              <div class="flex items-center justify-end gap-1 mt-0.5">
                <p class="text-[9px] ${isMine ? 'text-white/50' : 'text-gray-400'}">${msgTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                ${tickHTML}
              </div>
            </div>
            ${reactionsHTML}
            <!-- Desktop hover menu trigger -->
            <button class="msg-hover-menu-btn" data-msgid="${msgId}">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>
            </button>
          </div>
        `;

        // Bind context menu for this message
        const bubble = msgEl.querySelector('.msg-sent, .msg-received');
        const hoverBtn = msgEl.querySelector('.msg-hover-menu-btn');
        
        const openMenu = (e) => {
          e.preventDefault();
          e.stopPropagation();
          showMsgContextMenu(chatId, msgId, msg, isMine, bubble, msgTime);
        };

        // Long press (mobile)
        let pressTimer;
        bubble?.addEventListener('touchstart', (e) => {
          pressTimer = setTimeout(() => openMenu(e), 500);
        }, { passive: true });
        bubble?.addEventListener('touchend', () => clearTimeout(pressTimer));
        bubble?.addEventListener('touchmove', () => clearTimeout(pressTimer));
        
        // Right click (desktop)
        bubble?.addEventListener('contextmenu', openMenu);
        
        // Hover menu button (desktop)
        hoverBtn?.addEventListener('click', openMenu);

        msgContainer.appendChild(msgEl);
      });

      // Restore scroll or auto-scroll
      if (isFirstLoad) {
        requestAnimationFrame(() => {
          msgContainer.scrollTop = msgContainer.scrollHeight;
        });
      } else if (msgContainer.scrollHeight > oldHeight) {
        // We loaded older messages, preserve the exact scroll position
        msgContainer.scrollTop = oldScroll + (msgContainer.scrollHeight - oldHeight);
      } else {
        // A new message arrived while we are at the bottom, auto scroll
        if (msgContainer.scrollHeight - msgContainer.scrollTop - msgContainer.clientHeight < 150) {
          requestAnimationFrame(() => {
            msgContainer.scrollTop = msgContainer.scrollHeight;
          });
        }
      }
      
      // Setup Infinite Scroll Observer
      if (chatObserver) { chatObserver.disconnect(); chatObserver = null; }
      const topObserverTarget = msgContainer.querySelector('#chat-top-observer');
      if (topObserverTarget && 'IntersectionObserver' in window) {
        chatObserver = new IntersectionObserver((entries) => {
          if (entries[0].isIntersecting) {
            messageLimit += 30;
            setupMessageListener();
          }
        });
        chatObserver.observe(topObserverTarget);
      }
      
      if (otherUid && !isFirstLoad) {
        markMessagesAsRead(chatId, otherUid);
      }
      isFirstLoad = false;
    });
  } catch (e) { console.error(e); }
  };
  
  setupMessageListener();

  // Typing indicator + Pinned message bar - watch the chat document
  unsubTyping = onSnapshot(doc(db, 'chats', chatId), (snap) => {
    const data = snap.data();
    if (!data) return;
    
    // Typing indicator
    const typingUsers = presenceManager.getTypingUsers(data);
    const indicator = chatView.querySelector('#typing-indicator') || document.querySelector('#typing-indicator');
    if (indicator) {
      if (typingUsers.length > 0) {
        indicator.classList.add('visible');
        msgContainer.scrollTop = msgContainer.scrollHeight;
      } else {
        indicator.classList.remove('visible');
      }
    }

    // Pinned message bar
    let pinBar = chatView.querySelector('.pinned-msg-bar');
    if (data.pinnedMessage) {
      if (!pinBar) {
        pinBar = document.createElement('div');
        pinBar.className = 'pinned-msg-bar';
        const headerEl = chatView.querySelector('.chat-view-header');
        if (headerEl) headerEl.after(pinBar);
      }
      pinBar.innerHTML = `
        <span class="pinned-icon">📌</span>
        <div class="pinned-text">
          <p class="pinned-sender">${sanitizeHTML(data.pinnedMessage.senderName || '')}</p>
          <p class="pinned-preview">${sanitizeHTML(data.pinnedMessage.text || '')}</p>
        </div>
        <button class="pinned-close">✕</button>
      `;
      // Replace element to clear stale event listeners
      const freshBar = pinBar.cloneNode(true);
      pinBar.replaceWith(freshBar);
      pinBar = freshBar;
      // Capture pinnedMessage data for this snapshot
      const pinnedData = { ...data.pinnedMessage };
      freshBar.addEventListener('click', (e) => {
        if (e.target.closest('.pinned-close')) {
          updateDoc(doc(db, 'chats', chatId), { pinnedMessage: deleteField() }).catch(err => console.error('Unpin error:', err));
          if (pinnedData.id) {
            updateDoc(doc(db, 'chats', chatId, 'messages', pinnedData.id), { pinned: false }).catch(() => {});
          }
          return;
        }
        const pinnedEl = msgContainer.querySelector(`[data-msgid="${pinnedData.id}"]`);
        if (pinnedEl) {
          pinnedEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          pinnedEl.classList.add('msg-highlight');
          setTimeout(() => pinnedEl.classList.remove('msg-highlight'), 2000);
        }
      });
    } else if (pinBar) {
      pinBar.remove();
    }
  });

  // Clear unread count
  if (authManager.currentUser) {
    updateDoc(doc(db, 'chats', chatId), {
      [`unreadCount.${authManager.currentUser.uid}`]: 0
    }).catch(() => {});
  }

  // Send message
  const sendBtn = chatView.querySelector('#send-msg-btn') || document.querySelector('#send-msg-btn');
  const msgInput = chatView.querySelector('#msg-input') || document.querySelector('#msg-input');

  // Focus input
  setTimeout(() => msgInput?.focus(), 300);

  // Mobile keyboard handler — keep input visible above keyboard
  if (window.visualViewport) {
    const onViewportResize = () => {
      const vv = window.visualViewport;
      chatView.style.height = `${vv.height}px`;
      // Scroll to bottom when keyboard opens
      requestAnimationFrame(() => {
        msgContainer.scrollTop = msgContainer.scrollHeight;
      });
    };
    window.visualViewport.addEventListener('resize', onViewportResize);
    // Clean up when chat is closed
    const origClose = closeChat;
    const closeChatWithCleanup = () => {
      window.visualViewport?.removeEventListener('resize', onViewportResize);
      chatView.style.height = '';
      origClose();
    };
    header.querySelector('#back-chat-btn')?.removeEventListener('click', origClose);
    header.querySelector('#back-chat-btn')?.addEventListener('click', closeChatWithCleanup);
  }

  // Auto-scroll when input is focused (keyboard appears)
  msgInput?.addEventListener('focus', () => {
    setTimeout(() => {
      msgContainer.scrollTop = msgContainer.scrollHeight;
    }, 300);
  });

  // Typing indicator on input
  msgInput?.addEventListener('input', debounce(() => {
    presenceManager.setTyping(chatId, msgInput.value.trim().length > 0);
  }, 500));

  const sendMessage = async () => {
    const text = msgInput.value.trim();
    if (!text || !currentChatId || !authManager.currentUser) return;
    msgInput.value = '';
    presenceManager.setTyping(chatId, false);

    // Build message data
    const msgData = {
      text, senderId: authManager.currentUser.uid,
      senderName: authManager.userData?.fullName || 'Unknown',
      createdAt: serverTimestamp(),
      status: 'sent'
    };

    // Attach reply reference if replying
    if (replyToMsg) {
      msgData.replyTo = {
        id: replyToMsg.id,
        text: replyToMsg.text,
        senderName: replyToMsg.senderName,
        senderId: replyToMsg.senderId
      };
      replyToMsg = null;
      document.querySelector('.reply-preview-bar')?.remove();
    }

    try {
      await addDoc(collection(db, 'chats', currentChatId, 'messages'), msgData);
      await updateDoc(doc(db, 'chats', currentChatId), {
        lastMessage: text,
        lastMessageAt: serverTimestamp()
      });

      // Increment unread for other participants
      if (otherUid) {
        await updateDoc(doc(db, 'chats', currentChatId), {
          [`unreadCount.${otherUid}`]: increment(1)
        });
        createNotification('chat_message', otherUid, { chatId: currentChatId, message: text, messagePreview: text.substring(0, 80) });
      }
    } catch (e) { console.error('Send error:', e); }
  };

  sendBtn?.addEventListener('click', sendMessage);
  msgInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

  // Image attachment
  const attachBtn = chatView.querySelector('#attach-btn') || document.querySelector('#attach-btn');
  const fileInput = chatView.querySelector('#chat-file-input') || document.querySelector('#chat-file-input');
  attachBtn?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file || !currentChatId || !authManager.currentUser) return;

    try {
      showToast('Sending image...', 'info');
      const path = `chat-images/${currentChatId}/${Date.now()}_${file.name}`;
      const sRef = storageRef(storage, path);
      await uploadBytes(sRef, file);
      const imageUrl = await getDownloadURL(sRef);

      await addDoc(collection(db, 'chats', currentChatId, 'messages'), {
        text: '',
        imageUrl,
        senderId: authManager.currentUser.uid,
        senderName: authManager.userData?.fullName || 'Unknown',
        createdAt: serverTimestamp(),
        status: 'sent'
      });
      await updateDoc(doc(db, 'chats', currentChatId), {
        lastMessage: '📷 Image',
        lastMessageAt: serverTimestamp()
      });
      showToast('Image sent! 📸', 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to send image', 'error');
    }
    fileInput.value = '';
  });
}

// Mark messages as read
async function markMessagesAsRead(chatId, otherUid) {
  try {
    const q = query(
      collection(db, 'chats', chatId, 'messages'),
      where('senderId', '==', otherUid),
      where('status', 'in', ['sent', 'delivered'])
    );
    const snap = await getDocs(q);
    snap.forEach(async (d) => {
      await updateDoc(doc(db, 'chats', chatId, 'messages', d.id), { status: 'read' });
    });
  } catch (e) { /* non-critical */ }
}

export function startCallUI(targetUid, targetName, type) {
  const callOverlay = document.getElementById('call-overlay');
  if (!callOverlay) return;

  // Set up call state tracking
  let callTimer = null;
  let callSeconds = 0;

  // Callback: state changes (dialing → ringing → connected)
  callManager.onCallStateChange = (state) => {
    const statusEl = callOverlay.querySelector('#call-status-text');
    if (statusEl) {
      if (state === 'dialing') statusEl.textContent = 'Calling...';
      else if (state === 'ringing') statusEl.textContent = 'Ringing...';
      else if (state === 'connected') {
        // Timer starts NOW — only when ICE has truly connected
        statusEl.textContent = 'Connected · 00:00';
        if (callTimer) clearInterval(callTimer);
        callSeconds = 0;
        callTimer = setInterval(() => {
          callSeconds++;
          const mins = Math.floor(callSeconds / 60).toString().padStart(2, '0');
          const secs = (callSeconds % 60).toString().padStart(2, '0');
          statusEl.textContent = `Connected · ${mins}:${secs}`;
        }, 1000);
      }
    }
    // Hide avatar info for video when connected
    if (state === 'connected' && type === 'video') {
      const callInfo = callOverlay.querySelector('.call-info');
      if (callInfo) callInfo.style.display = 'none';
    }
  };

  // Callback: remote stream received
  callManager.onRemoteStream = (userId, stream) => {
    const container = callOverlay.querySelector('#remote-video-container');
    if (container && type === 'video') {
      container.innerHTML = ''; // Clear any previous
      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      video.playsInline = true;
      video.className = 'w-full h-full object-cover';
      container.appendChild(video);
    }
    // For audio-only calls, create an audio element
    if (type === 'voice') {
      const existingAudio = callOverlay.querySelector('audio');
      if (!existingAudio) {
        const audio = document.createElement('audio');
        audio.srcObject = stream;
        audio.autoplay = true;
        audio.play().catch(console.error);
        callOverlay.appendChild(audio);
      }
    }
  };

  // Callback: call ended
  callManager.onCallEnd = (reason) => {
    if (callTimer) clearInterval(callTimer);
    callOverlay.classList.add('hidden');
    callOverlay.innerHTML = '';
    if (reason === 'no_answer') {
      showToast('No answer', 'info');
    } else if (reason === 'rejected') {
      showToast('Call declined', 'info');
    } else if (reason === 'disconnected' || reason === 'failed') {
      showToast('Call disconnected', 'warning');
    } else {
      showToast('Call ended', 'info');
    }
  };

  // Now show the call UI
  callOverlay.classList.remove('hidden');
  callOverlay.innerHTML = `
    <div class="call-screen ${type === 'video' ? 'call-video' : 'call-voice'}">
      <div id="remote-video-container" class="call-remote-video"></div>
      <div id="local-video-container" class="call-local-video"></div>
      <div class="call-info">
        <div class="call-avatar-ring">
          <div class="avatar avatar-placeholder text-2xl w-20 h-20">${targetName[0]}</div>
        </div>
        <h3 class="text-lg font-bold text-white mt-4">${sanitizeHTML(targetName)}</h3>
        <p class="text-sm text-white/70 mt-1" id="call-status-text">Calling...</p>
      </div>
      <div class="call-controls">
        <button class="call-control-btn" id="toggle-mute">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"/></svg>
          <span class="text-[10px] mt-1">Mute</span>
        </button>
        ${type === 'video' ? `
          <button class="call-control-btn" id="toggle-camera">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9.75a2.25 2.25 0 002.25-2.25V7.5a2.25 2.25 0 00-2.25-2.25H4.5A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"/></svg>
            <span class="text-[10px] mt-1">Camera</span>
          </button>
          <button class="call-control-btn" id="switch-camera">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644V14.652"/></svg>
            <span class="text-[10px] mt-1">Flip</span>
          </button>
        ` : `
          <button class="call-control-btn" id="toggle-speaker">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z"/></svg>
            <span class="text-[10px] mt-1">Speaker</span>
          </button>
        `}
        <button class="call-control-btn call-end-btn" id="end-call-btn">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15.536a5 5 0 010-7.072m-2.828 9.9a9 9 0 010-12.728"/></svg>
          <span class="text-[10px] mt-1">End</span>
        </button>
      </div>
    </div>
  `;

  // Start the call (async)
  (async () => {
    const callId = await callManager.startCall(targetUid, targetName, type);
    if (!callId) {
      // Call failed to start
      callOverlay.classList.add('hidden');
      callOverlay.innerHTML = '';
      return;
    }

    // Show local video preview after stream is ready
    if (type === 'video' && callManager.localStream) {
      _showLocalVideo(callOverlay, callManager.localStream);
    }
  })();

  // Bind control handlers
  _bindCallControls(callOverlay, callTimer, type);
}

// ===== RECEIVER CALL UI (after answerCall completes) =====
export function showAnsweredCallUI(callerUid, callerName, type) {
  const callOverlay = document.getElementById('call-overlay');
  if (!callOverlay) return;

  let callTimer = null;
  let callSeconds = 0;

  // Callback: state changes
  callManager.onCallStateChange = (state) => {
    const statusEl = callOverlay.querySelector('#call-status-text');
    if (statusEl) {
      if (state === 'connected') {
        statusEl.textContent = 'Connected · 00:00';
        if (callTimer) clearInterval(callTimer);
        callSeconds = 0;
        callTimer = setInterval(() => {
          callSeconds++;
          const mins = Math.floor(callSeconds / 60).toString().padStart(2, '0');
          const secs = (callSeconds % 60).toString().padStart(2, '0');
          statusEl.textContent = `Connected · ${mins}:${secs}`;
        }, 1000);
      }
    }
    if (state === 'connected' && type === 'video') {
      const callInfo = callOverlay.querySelector('.call-info');
      if (callInfo) callInfo.style.display = 'none';
    }
  };

  // If already connected (ICE completed before UI rendered), start timer
  if (callManager.callStatus === 'connected') {
    // Will be handled after UI renders below
    setTimeout(() => {
      if (callManager.onCallStateChange) callManager.onCallStateChange('connected');
    }, 100);
  }

  // Callback: remote stream
  callManager.onRemoteStream = (userId, stream) => {
    const container = callOverlay.querySelector('#remote-video-container');
    if (container && type === 'video') {
      container.innerHTML = '';
      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      video.playsInline = true;
      video.className = 'w-full h-full object-cover';
      container.appendChild(video);
    }
    if (type === 'voice') {
      const existingAudio = callOverlay.querySelector('audio');
      if (!existingAudio) {
        const audio = document.createElement('audio');
        audio.srcObject = stream;
        audio.autoplay = true;
        audio.play().catch(console.error);
        callOverlay.appendChild(audio);
      }
    }
  };

  // Callback: call ended
  callManager.onCallEnd = (reason) => {
    if (callTimer) clearInterval(callTimer);
    callOverlay.classList.add('hidden');
    callOverlay.innerHTML = '';
    showToast('Call ended', 'info');
  };

  // Render the call UI
  callOverlay.classList.remove('hidden');
  callOverlay.innerHTML = `
    <div class="call-screen ${type === 'video' ? 'call-video' : 'call-voice'}">
      <div id="remote-video-container" class="call-remote-video"></div>
      <div id="local-video-container" class="call-local-video"></div>
      <div class="call-info">
        <div class="call-avatar-ring">
          <div class="avatar avatar-placeholder text-2xl w-20 h-20">${callerName[0]}</div>
        </div>
        <h3 class="text-lg font-bold text-white mt-4">${sanitizeHTML(callerName)}</h3>
        <p class="text-sm text-white/70 mt-1" id="call-status-text">Connecting...</p>
      </div>
      <div class="call-controls">
        <button class="call-control-btn" id="toggle-mute">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"/></svg>
          <span class="text-[10px] mt-1">Mute</span>
        </button>
        ${type === 'video' ? `
          <button class="call-control-btn" id="toggle-camera">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9.75a2.25 2.25 0 002.25-2.25V7.5a2.25 2.25 0 00-2.25-2.25H4.5A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"/></svg>
            <span class="text-[10px] mt-1">Camera</span>
          </button>
          <button class="call-control-btn" id="switch-camera">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644V14.652"/></svg>
            <span class="text-[10px] mt-1">Flip</span>
          </button>
        ` : `
          <button class="call-control-btn" id="toggle-speaker">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z"/></svg>
            <span class="text-[10px] mt-1">Speaker</span>
          </button>
        `}
        <button class="call-control-btn call-end-btn" id="end-call-btn">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15.536a5 5 0 010-7.072m-2.828 9.9a9 9 0 010-12.728"/></svg>
          <span class="text-[10px] mt-1">End</span>
        </button>
      </div>
    </div>
  `;

  // Show local video preview (receiver side)
  if (type === 'video' && callManager.localStream) {
    _showLocalVideo(callOverlay, callManager.localStream);
  }

  // If remote stream already available, show it
  Object.entries(callManager.remoteStreams).forEach(([uid, stream]) => {
    if (callManager.onRemoteStream) callManager.onRemoteStream(uid, stream);
  });

  // Bind controls
  _bindCallControls(callOverlay, callTimer, type);
}

// ===== SHARED: Show local video preview =====
function _showLocalVideo(callOverlay, stream) {
  const localContainer = callOverlay.querySelector('#local-video-container');
  if (localContainer) {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true; // Mute local preview to avoid echo
    video.className = 'w-full h-full object-cover rounded-xl';
    localContainer.appendChild(video);
  }
}

// ===== SHARED: Bind call control buttons =====
function _bindCallControls(callOverlay, callTimer, type) {
  callOverlay.querySelector('#toggle-mute')?.addEventListener('click', () => {
    const muted = callManager.toggleMute();
    const btn = callOverlay.querySelector('#toggle-mute');
    if (btn) {
      btn.classList.toggle('call-control-active', muted);
      btn.querySelector('span').textContent = muted ? 'Unmute' : 'Mute';
    }
  });

  callOverlay.querySelector('#toggle-camera')?.addEventListener('click', () => {
    const off = callManager.toggleCamera();
    const btn = callOverlay.querySelector('#toggle-camera');
    if (btn) {
      btn.classList.toggle('call-control-active', off);
      btn.querySelector('span').textContent = off ? 'Cam On' : 'Camera';
    }
    // Show/hide local video
    const localContainer = callOverlay.querySelector('#local-video-container');
    if (localContainer) {
      localContainer.style.opacity = off ? '0.3' : '1';
    }
  });

  callOverlay.querySelector('#switch-camera')?.addEventListener('click', async () => {
    const btn = callOverlay.querySelector('#switch-camera');
    if (btn) btn.classList.add('call-control-active');
    const facing = await callManager.switchCamera();
    if (facing && callManager.localStream) {
      // Update local video preview with new stream
      _showLocalVideo(callOverlay, callManager.localStream);
    }
    setTimeout(() => {
      if (btn) btn.classList.remove('call-control-active');
    }, 500);
  });

  callOverlay.querySelector('#toggle-speaker')?.addEventListener('click', () => {
    const btn = callOverlay.querySelector('#toggle-speaker');
    const audio = callOverlay.querySelector('audio');
    if (audio && btn) {
      const isLoud = btn.classList.toggle('call-control-active');
      audio.volume = isLoud ? 1.0 : 0.5;
      btn.querySelector('span').textContent = isLoud ? 'Earpiece' : 'Speaker';
    }
  });

  callOverlay.querySelector('#end-call-btn')?.addEventListener('click', () => {
    if (callTimer) clearInterval(callTimer);
    callManager.endCall();
  });
}

// Global reply-to state
let replyToMsg = null;

function showMsgContextMenu(chatId, msgId, msg, isMine, bubbleEl, msgTime) {
  // Remove any existing menu
  document.querySelector('.msg-context-menu')?.remove();
  document.querySelector('.msg-context-backdrop')?.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'msg-context-backdrop';
  
  const menu = document.createElement('div');
  menu.className = 'msg-context-menu';

  // Emoji reactions bar
  const emojis = ['❤️', '😂', '😮', '😢', '👍', '🔥', '😎'];
  menu.innerHTML = `
    <div class="msg-ctx-reactions">
      ${emojis.map(e => `<button class="msg-ctx-emoji" data-emoji="${e}">${e}</button>`).join('')}
    </div>
    <div class="msg-ctx-actions">
      <button class="msg-ctx-action" data-action="reply">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"/></svg>
        Reply
      </button>
      <button class="msg-ctx-action" data-action="copy">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"/></svg>
        Copy
      </button>
      <button class="msg-ctx-action" data-action="forward">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3"/></svg>
        Forward
      </button>
      <button class="msg-ctx-action" data-action="pin">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 3.75V16.5L12 14.25 7.5 16.5V3.75"/></svg>
        ${msg.pinned ? 'Unpin' : 'Pin'}
      </button>
      ${isMine ? `
        <button class="msg-ctx-action" data-action="info">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"/></svg>
          Info
        </button>
      ` : ''}
      <div class="msg-ctx-divider"></div>
      <button class="msg-ctx-action" data-action="delete-me">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>
        Delete for Me
      </button>
      ${isMine ? `
        <button class="msg-ctx-action msg-ctx-danger" data-action="delete-all">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>
          Delete for Everyone
        </button>
      ` : ''}
    </div>
  `;

  const closeMenu = () => {
    menu.classList.add('msg-ctx-closing');
    backdrop.remove();
    setTimeout(() => menu.remove(), 200);
  };

  backdrop.addEventListener('click', closeMenu);

  // Handle emoji reactions
  menu.querySelectorAll('.msg-ctx-emoji').forEach(btn => {
    btn.addEventListener('click', async () => {
      closeMenu();
      try {
        const uid = authManager.currentUser?.uid;
        if (uid) {
          await updateDoc(doc(db, 'chats', chatId, 'messages', msgId), {
            [`reactions.${uid}`]: btn.dataset.emoji
          });
        }
      } catch (e) { console.error('Reaction error:', e); }
    });
  });

  // Handle action buttons
  menu.querySelectorAll('.msg-ctx-action').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      closeMenu();

      switch (action) {
        case 'reply':
          replyToMsg = { id: msgId, text: msg.text, senderName: msg.senderName, senderId: msg.senderId };
          showReplyPreview();
          break;

        case 'copy':
          if (msg.text) {
            navigator.clipboard?.writeText(msg.text)
              .then(() => showToast('Copied!', 'success'))
              .catch(() => {});
          }
          break;

        case 'forward':
          showForwardModal(chatId, msg);
          break;

        case 'pin': {
          try {
            if (msg.pinned) {
              // Unpin
              await updateDoc(doc(db, 'chats', chatId, 'messages', msgId), { pinned: false });
              await updateDoc(doc(db, 'chats', chatId), { pinnedMessage: deleteField() });
              showToast('Unpinned', 'success');
            } else {
              // Pin
              await updateDoc(doc(db, 'chats', chatId, 'messages', msgId), { pinned: true });
              await updateDoc(doc(db, 'chats', chatId), {
                pinnedMessage: {
                  id: msgId,
                  text: msg.text || '📷 Image',
                  senderName: msg.senderName || 'Unknown'
                }
              });
              showToast('Pinned 📌', 'success');
            }
          } catch (e) {
            console.error('Pin error:', e);
            showToast('Could not pin message', 'error');
          }
          break;
        }

        case 'info':
          showMessageInfoPage(msg, msgTime);
          break;

        case 'delete-me': {
          try {
            const uid = authManager.currentUser?.uid;
            if (uid) {
              // Immediately hide from DOM for instant feedback
              const msgEl = bubbleEl.closest('.msg-wrapper') || bubbleEl.closest('.flex');
              if (msgEl) msgEl.style.display = 'none';
              // Persist to Firestore
              await updateDoc(doc(db, 'chats', chatId, 'messages', msgId), {
                hiddenFor: arrayUnion(uid)
              });
              showToast('Deleted for you', 'success');
            }
          } catch (e) {
            console.error('Delete for me error:', e);
            showToast('Could not delete', 'error');
            // Restore visibility on error
            const msgEl = bubbleEl.closest('.msg-wrapper') || bubbleEl.closest('.flex');
            if (msgEl) msgEl.style.display = '';
          }
          break;
        }

        case 'delete-all': {
          try {
            // WhatsApp-style: wipe content, keep placeholder
            await updateDoc(doc(db, 'chats', chatId, 'messages', msgId), {
              deletedForEveryone: true,
              text: '',
              imageUrl: '',
              reactions: {},
              replyTo: null,
              forwarded: false
            });
            // Update last message preview
            await updateDoc(doc(db, 'chats', chatId), {
              lastMessage: '🗑 This message was deleted'
            });
            showToast('Deleted for everyone', 'success');
          } catch (e) { console.error(e); }
          break;
        }
      }
    });
  });

  document.body.appendChild(backdrop);
  document.body.appendChild(menu);

  // Position near the bubble
  requestAnimationFrame(() => {
    const rect = bubbleEl.getBoundingClientRect();
    const menuH = menu.offsetHeight;
    const menuW = menu.offsetWidth;
    let top = rect.top - menuH - 8;
    if (top < 10) top = rect.bottom + 8;
    let left = rect.left;
    if (left + menuW > window.innerWidth - 10) left = window.innerWidth - menuW - 10;
    if (left < 10) left = 10;
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
  });
}

// ========== FORWARD MESSAGE MODAL ==========
async function showForwardModal(chatId, msg) {
  // Remove existing
  document.querySelector('.forward-modal')?.remove();

  const modal = document.createElement('div');
  modal.className = 'forward-modal';
  modal.innerHTML = `
    <div class="forward-modal-content">
      <div class="forward-modal-header">
        <button class="forward-close-btn">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
        <h3>Forward to...</h3>
        <button class="forward-send-btn" disabled>Send</button>
      </div>
      <div class="forward-search-wrap">
        <input type="text" class="forward-search-input" placeholder="Search friends..." autocomplete="off"/>
      </div>
      <div class="forward-msg-preview">
        <div class="msg-reply-bar"></div>
        <p class="text-xs text-gray-500 truncate">${sanitizeHTML(msg.text || '📷 Image')}</p>
      </div>
      <div class="forward-user-list"></div>
    </div>
  `;

  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('forward-modal-open'));

  const userList = modal.querySelector('.forward-user-list');
  const searchInput = modal.querySelector('.forward-search-input');
  const sendBtn = modal.querySelector('.forward-send-btn');
  const selected = new Set();

  // Load user's existing chats
  let chatUsers = [];
  try {
    const chatsQ = query(
      collection(db, 'chats'),
      where('participants', 'array-contains', authManager.currentUser.uid)
    );
    const chatsSnap = await getDocs(chatsQ);
    chatsSnap.forEach(d => {
      const chat = d.data();
      if (chat.type === 'group') return;
      const otherIdx = chat.participants.findIndex(p => p !== authManager.currentUser?.uid);
      const otherName = chat.participantNames?.[otherIdx] || 'Classmate';
      const otherUid = chat.participants?.[otherIdx];
      const otherPhoto = chat.participantPhotos?.[otherIdx] || '';
      if (otherUid) {
        chatUsers.push({ uid: otherUid, name: otherName, photo: otherPhoto, chatId: d.id });
      }
    });
  } catch (e) { console.error(e); }

  function renderUsers(filter = '') {
    const filtered = filter
      ? chatUsers.filter(u => u.name.toLowerCase().includes(filter.toLowerCase()))
      : chatUsers;
    
    if (filtered.length === 0) {
      userList.innerHTML = '<p class="text-center text-gray-400 text-sm py-8">No friends found</p>';
      return;
    }

    userList.innerHTML = filtered.map(u => `
      <label class="forward-user-item ${selected.has(u.uid) ? 'forward-user-selected' : ''}" data-uid="${u.uid}">
        ${u.photo
          ? `<img src="${u.photo}" class="forward-user-avatar" alt=""/>`
          : `<div class="forward-user-avatar forward-user-placeholder">${u.name[0]}</div>`}
        <span class="forward-user-name">${sanitizeHTML(u.name)}</span>
        <div class="forward-checkbox ${selected.has(u.uid) ? 'forward-checked' : ''}">
          ${selected.has(u.uid) ? '✓' : ''}
        </div>
      </label>
    `).join('');

    userList.querySelectorAll('.forward-user-item').forEach(item => {
      item.addEventListener('click', () => {
        const uid = item.dataset.uid;
        if (selected.has(uid)) selected.delete(uid);
        else selected.add(uid);
        sendBtn.disabled = selected.size === 0;
        renderUsers(searchInput.value);
      });
    });
  }

  renderUsers();

  searchInput.addEventListener('input', () => renderUsers(searchInput.value));

  // Close
  modal.querySelector('.forward-close-btn').addEventListener('click', () => {
    modal.classList.remove('forward-modal-open');
    setTimeout(() => modal.remove(), 200);
  });

  // Send forward
  sendBtn.addEventListener('click', async () => {
    if (selected.size === 0) return;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';

    for (const uid of selected) {
      const targetChat = chatUsers.find(u => u.uid === uid);
      if (!targetChat) continue;

      try {
        await addDoc(collection(db, 'chats', targetChat.chatId, 'messages'), {
          text: msg.text || '',
          imageUrl: msg.imageUrl || '',
          senderId: authManager.currentUser.uid,
          senderName: authManager.userData?.fullName || 'Unknown',
          createdAt: serverTimestamp(),
          status: 'sent',
          forwarded: true
        });
        await updateDoc(doc(db, 'chats', targetChat.chatId), {
          lastMessage: `↗️ ${msg.text || '📷 Image'}`,
          lastMessageAt: serverTimestamp(),
          [`unreadCount.${uid}`]: increment(1)
        });
      } catch (e) { console.error('Forward error:', e); }
    }

    showToast(`Forwarded to ${selected.size} friend${selected.size > 1 ? 's' : ''}`, 'success');
    modal.classList.remove('forward-modal-open');
    setTimeout(() => modal.remove(), 200);
  });
}

// ========== MESSAGE INFO PAGE ==========
function showMessageInfoPage(msg, msgTime) {
  document.querySelector('.msg-info-page')?.remove();

  const sentTime = msgTime.toLocaleString();
  const statusLabel = msg.status === 'read' ? 'Read' : msg.status === 'delivered' ? 'Delivered' : 'Sent';
  const statusIcon = msg.status === 'read' ? '✅' : msg.status === 'delivered' ? '📬' : '📤';
  const readTime = msg.readAt?.toDate ? msg.readAt.toDate().toLocaleString() : (msg.status === 'read' ? sentTime : '—');
  const deliveredTime = msg.deliveredAt?.toDate ? msg.deliveredAt.toDate().toLocaleString() : (msg.status !== 'sent' ? sentTime : '—');

  const page = document.createElement('div');
  page.className = 'msg-info-page';
  page.innerHTML = `
    <div class="msg-info-header">
      <button class="msg-info-back">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
      </button>
      <h3>Message Info</h3>
    </div>
    <div class="msg-info-body">
      <div class="msg-info-preview">
        <div class="msg-sent" style="display:inline-block;">
          ${msg.imageUrl ? `<img src="${msg.imageUrl}" style="max-width:200px;border-radius:12px;margin-bottom:4px;" alt=""/>` : ''}
          ${msg.text ? `<p class="text-sm">${sanitizeHTML(msg.text)}</p>` : ''}
          <p class="text-[9px] text-white/50 text-right mt-1">${msgTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
        </div>
      </div>

      <div class="msg-info-section">
        <div class="msg-info-row">
          <div class="msg-info-icon">📤</div>
          <div class="msg-info-detail">
            <p class="msg-info-label">Sent</p>
            <p class="msg-info-value">${sentTime}</p>
          </div>
        </div>
        <div class="msg-info-row">
          <div class="msg-info-icon">📬</div>
          <div class="msg-info-detail">
            <p class="msg-info-label">Delivered</p>
            <p class="msg-info-value">${deliveredTime}</p>
          </div>
        </div>
        <div class="msg-info-row">
          <div class="msg-info-icon">✅</div>
          <div class="msg-info-detail">
            <p class="msg-info-label">Read</p>
            <p class="msg-info-value">${readTime}</p>
          </div>
        </div>
      </div>

      <div class="msg-info-section">
        <p class="msg-info-section-title">Status</p>
        <div class="msg-info-status-badge">
          <span>${statusIcon}</span>
          <span>${statusLabel}</span>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(page);
  requestAnimationFrame(() => page.classList.add('msg-info-open'));

  page.querySelector('.msg-info-back').addEventListener('click', () => {
    page.classList.remove('msg-info-open');
    setTimeout(() => page.remove(), 250);
  });
}

// ========== REPLY PREVIEW ==========
function showReplyPreview() {
  if (!replyToMsg) return;
  let preview = document.querySelector('.reply-preview-bar');
  if (preview) preview.remove();

  preview = document.createElement('div');
  preview.className = 'reply-preview-bar';
  preview.innerHTML = `
    <div class="msg-reply-bar"></div>
    <div class="flex-1 min-w-0">
      <p class="text-[10px] font-semibold text-navy-500">${sanitizeHTML(replyToMsg.senderName || '')}</p>
      <p class="text-xs text-gray-500 truncate">${sanitizeHTML(replyToMsg.text || '📷 Image')}</p>
    </div>
    <button class="reply-close-btn">✕</button>
  `;

  const inputBar = document.querySelector('.chat-input-bar');
  if (inputBar) inputBar.insertBefore(preview, inputBar.firstChild);

  preview.querySelector('.reply-close-btn')?.addEventListener('click', () => {
    replyToMsg = null;
    preview.remove();
  });

  document.querySelector('#msg-input')?.focus();
}

