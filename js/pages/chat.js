// Chat page — Full featured with typing, presence, images, voice msgs, call buttons
import { db, collection, doc, query, orderBy, onSnapshot, addDoc, getDocs, updateDoc,
  serverTimestamp, where, setDoc, arrayUnion, limit, deleteDoc } from '../firebase-config.js';
import { showToast, timeAgo, sanitizeHTML, debounce } from '../utils.js';
import { authManager } from '../auth.js';
import { presenceManager } from '../presence.js';
import { callManager } from '../calls.js';
import { router } from '../router.js';
import { createNotification } from '../notifications.js';

let unsubChats = null;
let unsubMessages = null;
let currentChatId = null;
let chatViewOpen = false;

export function destroyChat() {
  if (unsubChats) unsubChats();
  if (unsubMessages) unsubMessages();
  unsubChats = null; unsubMessages = null;
  currentChatId = null; chatViewOpen = false;
}

// Store container reference for reliable DOM access
let chatContainer = null;

export async function renderChat(container) {
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

    <!-- Chat View Overlay — placed OUTSIDE section for reliable z-index -->
    <div id="chat-view" class="hidden fixed inset-0 z-[60] bg-cream-100 flex flex-col">
      <div id="chat-header" class="flex items-center gap-3 p-3 bg-white border-b border-gray-100 shadow-sm"></div>
      <div id="chat-messages" class="flex-1 overflow-y-auto p-4 space-y-2"></div>
      <div id="typing-indicator" class="hidden px-4 py-1">
        <span class="text-xs text-gray-400 flex items-center gap-1">
          <span class="typing-dots"><span>.</span><span>.</span><span>.</span></span>
          <span class="typing-name">typing</span>
        </span>
      </div>
      <div class="p-3 bg-white border-t border-gray-100">
        <div class="flex items-center gap-2">
          <button id="attach-btn" class="p-2 text-gray-400 hover:text-navy-500 transition-colors">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13"/></svg>
          </button>
          <input type="text" id="msg-input" placeholder="Type a message..."
            class="flex-1 px-4 py-2.5 border border-gray-200 rounded-full text-sm text-navy-800 placeholder:text-gray-400 focus:outline-none focus:border-navy-500 bg-white"/>
          <input type="file" id="chat-file-input" accept="image/*" class="hidden"/>
          <button id="send-msg-btn" class="p-2.5 bg-navy-500 rounded-full text-white hover:bg-navy-600 transition-colors active:scale-95">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/></svg>
          </button>
        </div>
      </div>
    </div>
  `;

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
              <div class="${u.online ? 'online-dot' : 'offline-dot'}"></div>
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

  try {
    const q = query(
      collection(db, 'chats'),
      where('participants', 'array-contains', authManager.currentUser.uid),
      orderBy('lastMessageAt', 'desc')
    );
    unsubChats = onSnapshot(q, (snap) => {
      if (snap.empty) {
        dmList.innerHTML = `
          <div class="text-center py-10">
            <div class="text-3xl mb-2">💬</div>
            <p class="text-sm text-gray-400">No conversations yet</p>
            <p class="text-xs text-gray-300 mt-1">Start chatting with classmates!</p>
          </div>`;
        return;
      }
      dmList.innerHTML = '';
      snap.forEach(d => {
        const chat = { id: d.id, ...d.data() };
        if (chat.type === 'group' && chat.id === 'core37') return; // Skip group in DM list

        const otherIdx = chat.participants.findIndex(p => p !== authManager.currentUser?.uid);
        const otherName = chat.participantNames?.[otherIdx] || 'Classmate';
        const otherUid = chat.participants[otherIdx];
        const unread = chat.unreadCount?.[authManager.currentUser.uid] || 0;
        const lastMsg = chat.lastMessage || 'Start a conversation';
        const time = chat.lastMessageAt?.toDate ? timeAgo(chat.lastMessageAt.toDate()) : '';

        const item = document.createElement('div');
        item.className = `chat-item ${unread > 0 ? 'chat-item-unread' : ''}`;
        item.innerHTML = `
          <div class="relative">
            ${chat.participantPhotos?.[otherIdx]
              ? `<img src="${chat.participantPhotos[otherIdx]}" class="avatar" alt="${sanitizeHTML(otherName)}"/>`
              : `<div class="avatar avatar-placeholder text-sm">${otherName[0]}</div>`}
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
      });
    }, () => {
      dmList.innerHTML = '<p class="text-center text-gray-400 py-8 text-sm">Configure Firebase for chat</p>';
    });
  } catch (e) {
    dmList.innerHTML = '<p class="text-center text-gray-400 py-8 text-sm">Set up Firebase for chat</p>';
  }
}

async function openGroupChat(container) {
  const groupId = 'core37';
  // Ensure group chat doc exists
  try {
    const { getDoc } = await import('../firebase-config.js');
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
  // Use container reference first, fall back to global document
  const chatView = (chatContainer || container)?.querySelector('#chat-view') || document.querySelector('#chat-view');
  if (!chatView) { console.error('Chat view not found'); return; }
  chatView.classList.remove('hidden');

  const header = document.querySelector('#chat-header');
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
  header.querySelector('#back-chat-btn').addEventListener('click', () => {
    chatView.classList.add('hidden');
    if (unsubMessages) unsubMessages();
    currentChatId = null;
    chatViewOpen = false;
    presenceManager.setTyping(chatId, false);
  });

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
      const el = document.querySelector('#chat-status');
      if (el) {
        el.textContent = status.online ? 'Online' : (status.lastSeen ? `Last seen ${timeAgo(status.lastSeen)}` : 'Offline');
        el.className = `text-[10px] ${status.online ? 'text-green-500' : 'text-gray-400'}`;
      }
    });
  }

  // Load messages
  const msgContainer = document.querySelector('#chat-messages');
  try {
    const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('createdAt', 'asc'), limit(100));
    unsubMessages = onSnapshot(q, (snap) => {
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
      let lastDate = '';
      snap.forEach(d => {
        const msg = d.data();
        const isMine = msg.senderId === authManager.currentUser?.uid;
        const msgTime = msg.createdAt?.toDate ? msg.createdAt.toDate() : new Date();

        // Date separator
        const dateStr = msgTime.toLocaleDateString();
        if (dateStr !== lastDate) {
          lastDate = dateStr;
          msgContainer.innerHTML += `
            <div class="flex items-center justify-center my-3">
              <span class="text-[10px] text-gray-400 bg-cream-100 px-3 py-1 rounded-full">${dateStr === new Date().toLocaleDateString() ? 'Today' : dateStr}</span>
            </div>`;
        }

        const msgEl = document.createElement('div');
        msgEl.className = `flex ${isMine ? 'justify-end' : 'justify-start'} msg-animate`;
        msgEl.innerHTML = `
          <div class="${isMine ? 'msg-sent' : 'msg-received'} max-w-[75%] ${msg.imageUrl ? 'p-1' : ''}">
            ${!isMine && isGroup ? `<p class="text-[10px] font-semibold ${isMine ? 'text-white/70' : 'text-navy-500'} mb-0.5">${sanitizeHTML(msg.senderName || '')}</p>` : ''}
            ${msg.imageUrl ? `<img src="${msg.imageUrl}" class="rounded-xl max-w-full max-h-60 mb-1" alt="Shared image" loading="lazy"/>` : ''}
            ${msg.text ? `<p class="text-sm">${sanitizeHTML(msg.text)}</p>` : ''}
            <div class="flex items-center justify-end gap-1 mt-1">
              <p class="text-[9px] ${isMine ? 'text-white/50' : 'text-gray-400'}">${msgTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
              ${isMine ? '<span class="text-[9px] text-white/40">✓✓</span>' : ''}
            </div>
          </div>
        `;

        // Long press for delete (own messages only)
        if (isMine) {
          let pressTimer;
          const bubble = msgEl.querySelector('.msg-sent');
          bubble?.addEventListener('touchstart', () => {
            pressTimer = setTimeout(() => {
              if (confirm('Delete this message?')) {
                deleteDoc(doc(db, 'chats', chatId, 'messages', d.id)).catch(console.error);
              }
            }, 600);
          });
          bubble?.addEventListener('touchend', () => clearTimeout(pressTimer));
          bubble?.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (confirm('Delete this message?')) {
              deleteDoc(doc(db, 'chats', chatId, 'messages', d.id)).catch(console.error);
            }
          });
        }

        msgContainer.appendChild(msgEl);
      });
      msgContainer.scrollTop = msgContainer.scrollHeight;
    });
  } catch (e) { console.error(e); }

  // Typing indicator - watch the chat document for typing field
  onSnapshot(doc(db, 'chats', chatId), (snap) => {
    const data = snap.data();
    if (!data) return;
    const typingUsers = presenceManager.getTypingUsers(data);
    const indicator = document.querySelector('#typing-indicator');
    if (indicator) {
      if (typingUsers.length > 0) {
        indicator.classList.remove('hidden');
      } else {
        indicator.classList.add('hidden');
      }
    }
  });

  // Clear unread count
  if (authManager.currentUser) {
    updateDoc(doc(db, 'chats', chatId), {
      [`unreadCount.${authManager.currentUser.uid}`]: 0
    }).catch(() => {});
  }

  // Send message
  const sendBtn = document.querySelector('#send-msg-btn');
  const msgInput = document.querySelector('#msg-input');

  // Typing indicator on input
  msgInput?.addEventListener('input', debounce(() => {
    presenceManager.setTyping(chatId, msgInput.value.trim().length > 0);
  }, 500));

  const sendMessage = async () => {
    const text = msgInput.value.trim();
    if (!text || !currentChatId || !authManager.currentUser) return;
    msgInput.value = '';
    presenceManager.setTyping(chatId, false);

    try {
      await addDoc(collection(db, 'chats', currentChatId, 'messages'), {
        text, senderId: authManager.currentUser.uid,
        senderName: authManager.userData?.fullName || 'Unknown',
        createdAt: serverTimestamp()
      });
      await updateDoc(doc(db, 'chats', currentChatId), {
        lastMessage: text,
        lastMessageAt: serverTimestamp()
      });

      // Increment unread for other participants
      if (otherUid) {
        await updateDoc(doc(db, 'chats', currentChatId), {
          [`unreadCount.${otherUid}`]: (await import('../firebase-config.js')).increment(1)
        });
        createNotification('chat_message', otherUid, { chatId: currentChatId, message: text });
      }
    } catch (e) { console.error('Send error:', e); }
  };

  sendBtn?.addEventListener('click', sendMessage);
  msgInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

  // Image attachment
  const attachBtn = document.querySelector('#attach-btn');
  const fileInput = document.querySelector('#chat-file-input');
  attachBtn?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file || !currentChatId || !authManager.currentUser) return;

    try {
      showToast('Sending image...', 'info');
      const { storageRef, uploadBytes, getDownloadURL } = await import('../firebase-config.js');
      const { storage } = await import('../firebase-config.js');
      const path = `chat-images/${currentChatId}/${Date.now()}_${file.name}`;
      const sRef = storageRef(storage, path);
      await uploadBytes(sRef, file);
      const imageUrl = await getDownloadURL(sRef);

      await addDoc(collection(db, 'chats', currentChatId, 'messages'), {
        text: '',
        imageUrl,
        senderId: authManager.currentUser.uid,
        senderName: authManager.userData?.fullName || 'Unknown',
        createdAt: serverTimestamp()
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

function startCallUI(targetUid, targetName, type) {
  const callOverlay = document.getElementById('call-overlay');
  if (!callOverlay) return;

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
        ` : ''}
        <button class="call-control-btn call-end-btn" id="end-call-btn">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15.536a5 5 0 010-7.072m-2.828 9.9a9 9 0 010-12.728"/></svg>
          <span class="text-[10px] mt-1">End</span>
        </button>
      </div>
    </div>
  `;

  // Setup call callbacks
  callManager.onCallStateChange = (state) => {
    const statusEl = callOverlay.querySelector('#call-status-text');
    if (statusEl) {
      if (state === 'ringing') statusEl.textContent = 'Ringing...';
      else if (state === 'connected') statusEl.textContent = 'Connected';
    }
  };

  callManager.onRemoteStream = (userId, stream) => {
    const container = callOverlay.querySelector('#remote-video-container');
    if (container && type === 'video') {
      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      video.playsInline = true;
      video.className = 'w-full h-full object-cover';
      container.appendChild(video);
    }
    // For audio-only calls, the audio plays automatically via the stream
    if (type === 'voice') {
      const audio = document.createElement('audio');
      audio.srcObject = stream;
      audio.autoplay = true;
      callOverlay.appendChild(audio);
    }
  };

  callManager.onCallEnd = () => {
    callOverlay.classList.add('hidden');
    callOverlay.innerHTML = '';
    showToast('Call ended', 'info');
  };

  // Start the call
  callManager.startCall(targetUid, targetName, type);

  // Show local video
  if (type === 'video' && callManager.localStream) {
    const localContainer = callOverlay.querySelector('#local-video-container');
    if (localContainer) {
      const video = document.createElement('video');
      video.srcObject = callManager.localStream;
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      video.className = 'w-full h-full object-cover rounded-xl';
      localContainer.appendChild(video);
    }
  }

  // Controls
  callOverlay.querySelector('#toggle-mute')?.addEventListener('click', () => {
    const muted = callManager.toggleMute();
    const btn = callOverlay.querySelector('#toggle-mute');
    if (btn) btn.classList.toggle('call-control-active', muted);
  });

  callOverlay.querySelector('#toggle-camera')?.addEventListener('click', () => {
    const off = callManager.toggleCamera();
    const btn = callOverlay.querySelector('#toggle-camera');
    if (btn) btn.classList.toggle('call-control-active', off);
  });

  callOverlay.querySelector('#end-call-btn')?.addEventListener('click', () => {
    callManager.endCall();
  });
}

// Export for use in incoming call handler
export { startCallUI };
