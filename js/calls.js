// WebRTC Calls — Voice & Video using Firestore signaling
// v3: Fixed ICE candidate buffering, state machine, SDP exchange ordering, logging
import { db, doc, collection, addDoc, updateDoc, setDoc, onSnapshot, serverTimestamp, getDoc, getDocs, query, where } from './firebase-config.js';
import { authManager } from './auth.js';
import { createNotification } from './notifications.js';
import { showToast } from './utils.js';

// ===== ICE Server Configuration =====
// STUN for discovery + public TURN for relay fallback behind symmetric NATs
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  // Open TURN relay for NAT traversal (metered.ca free tier)
  {
    urls: 'turn:a.relay.metered.ca:80',
    username: 'e8dd65a92f3c1e3a5f1b3c0a',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:a.relay.metered.ca:443',
    username: 'e8dd65a92f3c1e3a5f1b3c0a',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:a.relay.metered.ca:443?transport=tcp',
    username: 'e8dd65a92f3c1e3a5f1b3c0a',
    credential: 'openrelayproject'
  }
];

// ===== Call States =====
const CALL_STATES = {
  IDLE: 'idle',
  DIALING: 'dialing',       // Caller: initiated, waiting for receiver
  RINGING: 'ringing',       // Caller: receiver's phone is ringing
  INCOMING: 'incoming',     // Receiver: sees incoming call UI
  CONNECTING: 'connecting', // Both: SDP exchanged, waiting for ICE
  CONNECTED: 'connected',   // Both: media flowing
  ENDED: 'ended'
};

function _log(...args) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[Call ${ts}]`, ...args);
}

function _warn(...args) {
  const ts = new Date().toISOString().slice(11, 23);
  console.warn(`[Call ${ts}]`, ...args);
}

function _err(...args) {
  const ts = new Date().toISOString().slice(11, 23);
  console.error(`[Call ${ts}]`, ...args);
}

class CallManager {
  constructor() {
    this.localStream = null;
    this.remoteStreams = {};
    this.peerConnections = {};
    this.currentCallId = null;
    this.currentCallType = null; // 'voice' or 'video'
    this.callStatus = CALL_STATES.IDLE;
    this.incomingCallListener = null;
    this.isMuted = false;
    this.isCameraOff = false;
    this.isSpeakerOn = false;

    // Callbacks — set by UI code
    this.onCallStateChange = null;
    this.onRemoteStream = null;
    this.onCallEnd = null;
    this.onIncomingCall = null;

    // Internal state
    this._isCaller = false;
    this._connectedTimestamp = null;
    this._candidateListeners = {};
    this._callDocListener = null;
    this._ringTimeout = null;
    this._answerSet = false;          // Guard: prevent double setRemoteDescription
    this._pendingCandidates = [];     // Buffer: ICE candidates before remote desc
    this._remoteDescSet = false;      // Flag: remote description successfully set
    this._connectionCheckTimer = null;
    
    // Call history tracking
    this._callTargetId = null;
    this._callTargetName = null;
    this._callCallerName = null;
  }

  get isInCall() {
    return this.callStatus !== CALL_STATES.IDLE && this.callStatus !== CALL_STATES.ENDED;
  }

  // ===================================================================
  //  INCOMING CALL LISTENER (runs globally when logged in)
  // ===================================================================
  listenForIncomingCalls() {
    if (!authManager.currentUser || this.incomingCallListener) return;

    this._cleanupStaleCalls();

    const callsCol = collection(db, 'calls');
    this.incomingCallListener = onSnapshot(callsCol, (snap) => {
      snap.docChanges().forEach(change => {
        if (change.type === 'added') {
          const call = { id: change.doc.id, ...change.doc.data() };

          if (call.targetId === authManager.currentUser.uid &&
              call.status === 'ringing' &&
              !this.isInCall) {

            const createdAt = call.createdAt?.toDate ? call.createdAt.toDate() : null;
            if (createdAt) {
              const ageMs = Date.now() - createdAt.getTime();
              if (ageMs > 45000) {
                _log('Ignoring stale call:', call.id, 'age:', ageMs + 'ms');
                return;
              }
            }

            _log('📞 Incoming call:', call.id, 'from:', call.callerName, 'type:', call.type);
            
            // Check if we came from a deep link to accept this call (from a background push notification)
            const params = new URLSearchParams(window.location.search);
            if (params.get('acceptCallId') === call.id) {
              call.autoAccept = true;
              // Clean up URL so we don't auto-accept again on refresh
              window.history.replaceState({}, '', window.location.pathname + '?page=chat');
            }

            if (this.onIncomingCall) this.onIncomingCall(call);
          }
        }

        if (change.type === 'modified') {
          const call = { id: change.doc.id, ...change.doc.data() };
          if (call.targetId === authManager.currentUser.uid) {
            if (['ended', 'no_answer', 'cancelled'].includes(call.status) &&
                this.callStatus === CALL_STATES.INCOMING) {
              _log('Incoming call cancelled by caller:', call.id);
              this._resetCallState('cancelled');
            }
          }
        }
      });
    });
  }

  stopListeningForCalls() {
    if (this.incomingCallListener) {
      this.incomingCallListener();
      this.incomingCallListener = null;
    }
  }

  async _cleanupStaleCalls() {
    if (!authManager.currentUser) return;
    try {
      const q = query(
        collection(db, 'calls'),
        where('targetId', '==', authManager.currentUser.uid),
        where('status', '==', 'ringing')
      );
      const snap = await getDocs(q);
      const now = Date.now();
      snap.forEach(async (d) => {
        const call = d.data();
        const createdAt = call.createdAt?.toDate ? call.createdAt.toDate().getTime() : 0;
        if (now - createdAt > 60000) {
          _log('Cleaning stale call:', d.id);
          try {
            await updateDoc(doc(db, 'calls', d.id), {
              status: 'no_answer',
              endedAt: serverTimestamp()
            });
          } catch (e) { /* ignore */ }
        }
      });
    } catch (e) {
      _log('Stale call cleanup error:', e.message);
    }
  }

  // ===================================================================
  //  START OUTGOING CALL (caller side)
  // ===================================================================
  async startCall(targetUserId, targetName, type = 'voice') {
    if (this.isInCall) {
      showToast('Already in a call', 'warning');
      return null;
    }

    try {
      this._isCaller = true;
      this.currentCallType = type;
      this.callStatus = CALL_STATES.DIALING;
      this.isMuted = false;
      this.isCameraOff = false;
      this._connectedTimestamp = null;
      this._answerSet = false;
      this._remoteDescSet = false;
      this._pendingCandidates = [];

      this._callTargetId = targetUserId;
      this._callTargetName = targetName;
      this._callCallerName = authManager.userData?.fullName || 'Unknown';

      _log('📱 Starting', type, 'call to', targetName, '(' + targetUserId + ')');
      if (this.onCallStateChange) this.onCallStateChange('dialing');

      // 1. Get local media
      if (this.localStream) {
        this.localStream.getTracks().forEach(t => t.stop());
      }
      
      const constraints = {
        audio: { 
          echoCancellation: true, 
          noiseSuppression: true, 
          autoGainControl: true,
          googEchoCancellation: true,
          googAutoGainControl: true,
          googNoiseSuppression: true,
          googHighpassFilter: true,
          googTypingNoiseDetection: true
        },
        video: type === 'video' ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false
      };
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      _log('✅ Local stream acquired:', this.localStream.getTracks().map(t => t.kind).join(', '));

      // 2. Create call document in Firestore
      const callDoc = await addDoc(collection(db, 'calls'), {
        callerId: authManager.currentUser.uid,
        callerName: authManager.userData?.fullName || 'Unknown',
        callerPhoto: authManager.userData?.profilePic || '',
        targetId: targetUserId,
        targetName: targetName,
        type: type,
        status: 'ringing',
        createdAt: serverTimestamp()
      });
      this.currentCallId = callDoc.id;
      _log('✅ Call document created:', callDoc.id);

      // 3. Create peer connection
      const pc = this._createPeerConnection(targetUserId);
      this.peerConnections[targetUserId] = pc;

      // 4. Add local tracks
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
      _log('✅ Local tracks added to PeerConnection');

      // 5. Start listening for receiver's ICE candidates BEFORE creating offer
      //    This ensures we capture candidates even if they arrive very early
      this._listenForCandidates(targetUserId, 'answer-candidates');

      // 6. Create and set local SDP offer
      _log('📝 Creating SDP offer...');
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: type === 'video'
      });
      
      // Optimize Opus codec for high quality audio
      if (offer.sdp.includes('opus/48000')) {
        offer.sdp = offer.sdp.replace(
          /(a=fmtp:\d+ .*)/g,
          '$1; stereo=1; sprop-stereo=1; maxaveragebitrate=510000; useinbandfec=1; cbr=1'
        );
      }
      
      await pc.setLocalDescription(offer);
      _log('✅ Local description (offer) set. SDP type:', offer.type);

      // 7. Store offer in Firestore
      await updateDoc(doc(db, 'calls', this.currentCallId), {
        offer: { type: offer.type, sdp: offer.sdp }
      });
      _log('✅ Offer written to Firestore');

      // 8. Transition to ringing
      this.callStatus = CALL_STATES.RINGING;
      if (this.onCallStateChange) this.onCallStateChange('ringing');

      // 9. Listen for answer from receiver
      this._listenForAnswer(targetUserId);

      // 10. Send notification
      createNotification(
        type === 'video' ? 'video_call_incoming' : 'voice_call_incoming',
        targetUserId,
        { callId: this.currentCallId, callType: type, message: `${type === 'video' ? '📹' : '📞'} Incoming ${type} call` }
      );

      // 11. Auto-end if not answered in 35s
      if (this._ringTimeout) clearTimeout(this._ringTimeout);
      this._ringTimeout = setTimeout(() => {
        if (this.isInCall && this.callStatus !== CALL_STATES.CONNECTED) {
          _log('⏰ Call not answered after 35s, ending...');
          this.endCall('no_answer');
        }
      }, 35000);

      return this.currentCallId;

    } catch (e) {
      _err('Start call error:', e);
      this._resetCallState('error');
      if (e.name === 'NotAllowedError') {
        showToast('Microphone/camera permission denied. Please allow access.', 'error');
      } else if (e.name === 'NotFoundError') {
        showToast('No microphone/camera found on this device.', 'error');
      } else {
        showToast('Could not start call. Check permissions.', 'error');
      }
      return null;
    }
  }

  // ===================================================================
  //  ANSWER INCOMING CALL (receiver side)
  // ===================================================================
  async answerCall(callId) {
    if (this.callStatus === CALL_STATES.CONNECTED) {
      showToast('Already in a call', 'warning');
      return;
    }

    try {
      _log('📞 Answering call:', callId);

      // 1. Get call document
      const callSnap = await getDoc(doc(db, 'calls', callId));
      if (!callSnap.exists()) {
        showToast('Call ended', 'info');
        this._resetCallState('ended');
        return;
      }

      const callData = callSnap.data();
      _log('Call data:', { status: callData.status, type: callData.type, hasOffer: !!callData.offer });

      if (callData.status !== 'ringing') {
        showToast('Call is no longer available', 'info');
        this._resetCallState('ended');
        return;
      }

      if (!callData.offer) {
        _err('No offer in call document!');
        showToast('Call data incomplete', 'error');
        this._resetCallState('error');
        return;
      }

      // 2. Set internal state
      this._isCaller = false;
      this.currentCallId = callId;
      this.currentCallType = callData.type;
      this.callStatus = CALL_STATES.CONNECTING;
      this.isMuted = false;
      this.isCameraOff = false;
      this._connectedTimestamp = null;
      this._answerSet = false;
      this._remoteDescSet = false;
      this._pendingCandidates = [];
      
      this._callTargetId = callData.callerId;
      this._callTargetName = callData.callerName;
      this._callCallerName = authManager.userData?.fullName || callData.targetName;

      if (this.onCallStateChange) this.onCallStateChange('connecting');

      // 3. Get local media
      if (this.localStream) {
        this.localStream.getTracks().forEach(t => t.stop());
      }

      const constraints = {
        audio: { 
          echoCancellation: true, 
          noiseSuppression: true, 
          autoGainControl: true,
          googEchoCancellation: true,
          googAutoGainControl: true,
          googNoiseSuppression: true,
          googHighpassFilter: true,
          googTypingNoiseDetection: true
        },
        video: callData.type === 'video' ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false
      };
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      _log('✅ Local stream acquired:', this.localStream.getTracks().map(t => t.kind).join(', '));

      const callerId = callData.callerId;

      // 4. Create peer connection
      const pc = this._createPeerConnection(callerId);
      this.peerConnections[callerId] = pc;

      // 5. Add local tracks
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
      _log('✅ Local tracks added to PeerConnection');

      // 6. Start listening for caller's ICE candidates BEFORE setting remote description
      //    This ensures we capture all candidates, even those written before we connected
      this._listenForCandidates(callerId, 'offer-candidates');

      // 7. Set remote description (the offer from caller)
      _log('📝 Setting remote description (offer)...');
      await pc.setRemoteDescription(new RTCSessionDescription(callData.offer));
      this._remoteDescSet = true;
      _log('✅ Remote description (offer) set successfully');

      // 8. Flush any buffered ICE candidates that arrived before remote desc was set
      this._flushPendingCandidates(callerId);

      // 9. Create and set local SDP answer
      _log('📝 Creating SDP answer...');
      const answer = await pc.createAnswer();
      
      // Optimize Opus codec for high quality audio
      if (answer.sdp.includes('opus/48000')) {
        answer.sdp = answer.sdp.replace(
          /(a=fmtp:\d+ .*)/g,
          '$1; stereo=1; sprop-stereo=1; maxaveragebitrate=510000; useinbandfec=1; cbr=1'
        );
      }
      
      await pc.setLocalDescription(answer);
      _log('✅ Local description (answer) set. SDP type:', answer.type);

      // 10. Write answer + status to Firestore (triggers caller's _listenForAnswer)
      await updateDoc(doc(db, 'calls', callId), {
        answer: { type: answer.type, sdp: answer.sdp },
        status: 'connected'
      });
      _log('✅ Answer + status written to Firestore');

      // 11. Listen for call status changes (end, etc.)
      this._listenForCallStatus();

      _log('🔄 Waiting for ICE connection...');

      // 12. Connection check — if ICE doesn't connect in 15s after answer, warn
      this._connectionCheckTimer = setTimeout(() => {
        if (this.isInCall && this.callStatus !== CALL_STATES.CONNECTED) {
          _warn('⚠️ ICE still not connected after 15s');
          const pc = this.peerConnections[callerId];
          if (pc) {
            _log('ICE state:', pc.iceConnectionState, '| Connection state:', pc.connectionState);
            _log('ICE gathering state:', pc.iceGatheringState);
          }
        }
      }, 15000);

    } catch (e) {
      _err('Answer call error:', e);
      this._resetCallState('error');
      if (e.name === 'NotAllowedError') {
        showToast('Microphone/camera permission denied.', 'error');
      } else {
        showToast('Could not answer call. Check permissions.', 'error');
      }
    }
  }

  // ===================================================================
  //  REJECT INCOMING CALL
  // ===================================================================
  async rejectCall(callId) {
    try {
      _log('❌ Rejecting call:', callId);
      await updateDoc(doc(db, 'calls', callId), {
        status: 'rejected',
        endedAt: serverTimestamp()
      });
      this._resetCallState('rejected');
    } catch (e) {
      _err('Reject call error:', e);
    }
  }

  // ===================================================================
  //  END CURRENT CALL
  // ===================================================================
  async endCall(reason = 'ended') {
    _log('📴 Ending call, reason:', reason);
    clearTimeout(this._ringTimeout);
    clearTimeout(this._connectionCheckTimer);

    const callId = this.currentCallId;
    const wasCaller = this._isCaller;
    const callType = this.currentCallType;
    const targetId = this._callTargetId;
    const targetName = this._callTargetName;
    const callerName = this._callCallerName;

    let duration = 0;
    if (this._connectedTimestamp) {
      duration = Math.floor((Date.now() - this._connectedTimestamp) / 1000);
    }

    // Close all peer connections
    Object.entries(this.peerConnections).forEach(([uid, pc]) => {
      _log('Closing PeerConnection for:', uid, '| state:', pc.connectionState);
      try { pc.close(); } catch (e) { /* ignore */ }
    });
    this.peerConnections = {};

    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        track.stop();
        _log('Stopped local track:', track.kind);
      });
      this.localStream = null;
    }

    // Clear remote streams
    this.remoteStreams = {};

    // Clean up Firestore listeners
    Object.values(this._candidateListeners).forEach(unsub => {
      try { unsub(); } catch (e) { /* ignore */ }
    });
    this._candidateListeners = {};
    if (this._callDocListener) {
      try { this._callDocListener(); } catch (e) { /* ignore */ }
      this._callDocListener = null;
    }

    // Update Firestore
    if (callId) {
      try {
        const endTime = Date.now();
        const duration = this._connectedTimestamp ? Math.floor((endTime - this._connectedTimestamp) / 1000) : 0;
        
        await updateDoc(doc(db, 'calls', callId), {
          status: reason,
          endedAt: serverTimestamp(),
          duration: duration
        });
        _log('✅ Call status updated to:', reason);

        // Fetch call doc to log history
        const callSnap = await getDoc(doc(db, 'calls', callId));
        if (callSnap.exists()) {
          const callData = callSnap.data();
          const targetUserId = wasCaller ? callData.targetId : callData.callerId;
          const myUid = authManager.currentUser.uid;
          
          // Log call history to chat
          try {
            const q1 = query(collection(db, 'chats'), where('participants', 'array-contains', myUid));
            const chatsSnap = await getDocs(q1);
            let chatId = null;
            chatsSnap.forEach(d => {
              const cData = d.data();
              if (cData.type === 'dm' && cData.participants.includes(targetUserId)) {
                chatId = d.id;
              }
            });
            
            if (chatId) {
              await addDoc(collection(db, 'chats', chatId, 'messages'), {
                type: 'system_call',
                callType: callType,
                callStatus: reason,
                duration: duration,
                callerId: callData.callerId,
                createdAt: serverTimestamp()
              });
              await updateDoc(doc(db, 'chats', chatId), {
                lastMessage: `${callType === 'video' ? '📹' : '📞'} ${callType === 'video' ? 'Video' : 'Voice'} Call`,
                lastMessageAt: serverTimestamp()
              });
            }
          } catch(e) {
            _err('Failed to log call history:', e);
          }

          // Missed call notification
          if (reason === 'no_answer' && wasCaller) {
            createNotification(
              callType === 'video' ? 'missed_video_call' : 'missed_voice_call',
              callData.targetId,
              { callId, callType, message: `Missed ${callType} call` }
            );
          }
        }
      } catch (e) { /* doc might already be deleted */ }
    }

    this._resetCallState(reason);

    // Save call history (both sides can try, predictable ID avoids dupes)
    if (callId && targetId) {
      this._saveCallHistory(callId, targetId, targetName, callerName, callType, reason, duration);
    }
  }

  async _saveCallHistory(callId, targetId, targetName, callerName, callType, status, duration) {
    const myUid = authManager.currentUser?.uid;
    if (!myUid || !targetId) return;

    try {
      // Find chat between myUid and targetId
      const q1 = query(collection(db, 'chats'), where('participants', 'array-contains', myUid));
      const snap = await getDocs(q1);
      let existingChatId = null;

      snap.forEach(d => {
        const data = d.data();
        if (data.type === 'dm' && data.participants.includes(targetId)) {
          existingChatId = d.id;
        }
      });

      if (!existingChatId) {
        // Create new chat
        const chatRef = await addDoc(collection(db, 'chats'), {
          type: 'dm',
          participants: [myUid, targetId],
          participantNames: [callerName || 'Unknown', targetName || 'Unknown'],
          lastMessage: '',
          lastMessageAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          typing: {},
          unreadCount: { [myUid]: 0, [targetId]: 0 }
        });
        existingChatId = chatRef.id;
      }

      // Add system_call message with predictable ID based on callId to avoid duplicates
      await setDoc(doc(db, 'chats', existingChatId, 'messages', callId + '_history'), {
        type: 'system_call',
        callType: callType,
        callStatus: status,
        duration: duration,
        createdAt: serverTimestamp(),
        senderId: myUid // to know who wrote it (informational)
      });

      // Update chat last message
      await updateDoc(doc(db, 'chats', existingChatId), {
        lastMessage: `📞 ${callType === 'video' ? 'Video' : 'Voice'} Call`,
        lastMessageAt: serverTimestamp()
      });
    } catch (e) {
      console.error('Save call history error:', e);
    }
  }

  // ===================================================================
  //  RESET STATE
  // ===================================================================
  _resetCallState(reason) {
    _log('🔄 Reset call state. Reason:', reason);
    this.currentCallId = null;
    this.currentCallType = null;
    this.callStatus = CALL_STATES.IDLE;
    this._isCaller = false;
    this.isMuted = false;
    this.isCameraOff = false;
    this._connectedTimestamp = null;
    this._answerSet = false;
    this._remoteDescSet = false;
    this._pendingCandidates = [];

    // Safety: Ensure hardware streams are released even if error occurred
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    this.remoteStreams = {};

    clearTimeout(this._ringTimeout);
    this._ringTimeout = null;
    clearTimeout(this._connectionCheckTimer);
    this._connectionCheckTimer = null;

    if (this.onCallEnd) this.onCallEnd(reason);
  }

  // ===================================================================
  //  AUDIO/VIDEO CONTROLS
  // ===================================================================
  toggleMute() {
    if (!this.localStream) return false;
    this.isMuted = !this.isMuted;
    this.localStream.getAudioTracks().forEach(track => {
      track.enabled = !this.isMuted;
    });
    _log('🔇 Mute:', this.isMuted);
    return this.isMuted;
  }

  toggleCamera() {
    if (!this.localStream) return false;
    this.isCameraOff = !this.isCameraOff;
    this.localStream.getVideoTracks().forEach(track => {
      track.enabled = !this.isCameraOff;
    });
    _log('📷 Camera off:', this.isCameraOff);
    return this.isCameraOff;
  }

  async switchCamera() {
    if (!this.localStream || this.currentCallType !== 'video') return;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (!videoTrack) return;

    const settings = videoTrack.getSettings();
    const currentFacing = settings.facingMode || 'user';
    const newFacing = currentFacing === 'user' ? 'environment' : 'user';

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newFacing, width: { ideal: 640 }, height: { ideal: 480 } }
      });
      const newVideoTrack = newStream.getVideoTracks()[0];

      Object.values(this.peerConnections).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(newVideoTrack);
      });

      videoTrack.stop();
      this.localStream.removeTrack(videoTrack);
      this.localStream.addTrack(newVideoTrack);

      _log('📷 Camera switched to:', newFacing);
      return newFacing;
    } catch (e) {
      _err('Camera switch error:', e);
      showToast('Could not switch camera', 'error');
      return null;
    }
  }

  // ===================================================================
  //  CREATE RTCPeerConnection
  // ===================================================================
  _createPeerConnection(remoteUserId) {
    _log('🔗 Creating RTCPeerConnection for:', remoteUserId);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // --- ICE Candidate Generation ---
    pc.onicecandidate = (event) => {
      if (event.candidate && this.currentCallId) {
        const subcollection = this._isCaller ? 'offer-candidates' : 'answer-candidates';
        _log('🧊 Generated ICE candidate →', subcollection, '| type:', event.candidate.type || 'unknown', '| protocol:', event.candidate.protocol || 'unknown');

        addDoc(collection(db, 'calls', this.currentCallId, subcollection), {
          ...event.candidate.toJSON()
        }).catch(err => _err('ICE candidate write error:', err));
      }
      if (!event.candidate) {
        _log('🧊 ICE gathering complete (null candidate)');
      }
    };

    // --- ICE Gathering State ---
    pc.onicegatheringstatechange = () => {
      _log('🧊 ICE gathering state:', pc.iceGatheringState);
    };

    // --- Remote Track Received ---
    pc.ontrack = (event) => {
      _log('🎵 Remote track received:', event.track.kind, '| readyState:', event.track.readyState);
      if (event.streams && event.streams[0]) {
        this.remoteStreams[remoteUserId] = event.streams[0];
        _log('🎵 Remote stream tracks:', event.streams[0].getTracks().map(t => `${t.kind}(${t.readyState})`).join(', '));
        if (this.onRemoteStream) this.onRemoteStream(remoteUserId, event.streams[0]);
      }
    };

    // --- ICE Connection State ---
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      _log('🔌 ICE connection state:', state);

      if (state === 'connected' || state === 'completed') {
        this._handleConnected();
      } else if (state === 'disconnected') {
        _warn('⚠️ ICE disconnected — waiting 5s for recovery...');
        setTimeout(() => {
          if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            _err('ICE did not recover, ending call');
            this.endCall('disconnected');
          }
        }, 5000);
      } else if (state === 'failed') {
        _err('❌ ICE connection failed');
        this.endCall('failed');
      }
    };

    // --- Overall Connection State (backup) ---
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      _log('🔗 PeerConnection state:', state);

      if (state === 'connected') {
        this._handleConnected();
      } else if (state === 'failed' || state === 'closed') {
        if (this.isInCall) {
          _err('PeerConnection', state, '— ending call');
          this.endCall('disconnected');
        }
      }
    };

    // --- Signaling State ---
    pc.onsignalingstatechange = () => {
      _log('📡 Signaling state:', pc.signalingState);
    };

    return pc;
  }

  // ===================================================================
  //  HANDLE CONNECTED STATE (called from ICE/connection state handlers)
  // ===================================================================
  _handleConnected() {
    if (this.callStatus === CALL_STATES.CONNECTED) return; // Already connected

    _log('✅✅✅ CALL CONNECTED! Media should be flowing.');
    this.callStatus = CALL_STATES.CONNECTED;
    this._connectedTimestamp = Date.now();

    // Clear ring/connection timeouts
    if (this._ringTimeout) {
      clearTimeout(this._ringTimeout);
      this._ringTimeout = null;
    }
    if (this._connectionCheckTimer) {
      clearTimeout(this._connectionCheckTimer);
      this._connectionCheckTimer = null;
    }

    // Log stream status for debugging
    if (this.localStream) {
      _log('📤 Local tracks:', this.localStream.getTracks().map(t => `${t.kind}(enabled=${t.enabled}, readyState=${t.readyState})`).join(', '));
    }
    Object.entries(this.remoteStreams).forEach(([uid, stream]) => {
      _log('📥 Remote tracks from', uid + ':', stream.getTracks().map(t => `${t.kind}(enabled=${t.enabled}, readyState=${t.readyState})`).join(', '));
    });

    // Notify UI
    if (this.onCallStateChange) this.onCallStateChange('connected');
  }

  // ===================================================================
  //  LISTEN FOR SDP ANSWER (caller side)
  // ===================================================================
  _listenForAnswer(remoteUserId) {
    if (!this.currentCallId) return;
    _log('👂 Listening for answer on call:', this.currentCallId);

    const unsub = onSnapshot(doc(db, 'calls', this.currentCallId), async (snap) => {
      const data = snap.data();
      if (!data) return;

      // Process the answer SDP
      if (data.answer && !this._answerSet) {
        this._answerSet = true; // Guard: prevent double-processing
        const pc = this.peerConnections[remoteUserId];

        if (pc && pc.signalingState === 'have-local-offer') {
          _log('📨 Received answer from receiver, setting remote description...');
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            this._remoteDescSet = true;
            _log('✅ Remote description (answer) set successfully');

            // Flush any buffered ICE candidates
            this._flushPendingCandidates(remoteUserId);

            // Clear ring timeout — call was answered
            if (this._ringTimeout) {
              clearTimeout(this._ringTimeout);
              this._ringTimeout = null;
            }

            // Move to connecting state
            if (this.callStatus !== CALL_STATES.CONNECTED) {
              this.callStatus = CALL_STATES.CONNECTING;
              if (this.onCallStateChange) this.onCallStateChange('connecting');
            }
          } catch (err) {
            _err('setRemoteDescription error:', err);
            this._answerSet = false; // Allow retry
          }
        } else {
          _warn('Cannot set answer — PC missing or wrong signaling state:', pc?.signalingState);
          this._answerSet = false;
        }
      }

      // Handle remote-side ending the call
      if (['rejected', 'ended', 'no_answer', 'cancelled'].includes(data.status)) {
        if (this.isInCall && data.status !== 'connected') {
          _log('Call ended remotely, status:', data.status);
          this.endCall(data.status);
          unsub();
        }
      }
    });

    this._candidateListeners['call-doc'] = unsub;
  }

  // ===================================================================
  //  LISTEN FOR CALL STATUS (receiver side)
  // ===================================================================
  _listenForCallStatus() {
    if (!this.currentCallId) return;
    _log('👂 Listening for call status changes...');

    const unsub = onSnapshot(doc(db, 'calls', this.currentCallId), (snap) => {
      const data = snap.data();
      if (!data) return;

      if (['ended', 'cancelled'].includes(data.status)) {
        if (this.isInCall) {
          _log('Call ended by caller, status:', data.status);
          this.endCall(data.status);
        }
        unsub();
      }
    });

    this._callDocListener = unsub;
  }

  // ===================================================================
  //  LISTEN FOR ICE CANDIDATES (both sides)
  // ===================================================================
  _listenForCandidates(remoteUserId, subcollection) {
    if (!this.currentCallId) return;
    _log('👂 Listening for ICE candidates in:', subcollection);

    const unsub = onSnapshot(
      collection(db, 'calls', this.currentCallId, subcollection),
      (snap) => {
        snap.docChanges().forEach(change => {
          if (change.type === 'added') {
            const candidateData = change.doc.data();
            const candidate = new RTCIceCandidate(candidateData);
            const pc = this.peerConnections[remoteUserId];

            if (!pc) {
              _warn('No PeerConnection for', remoteUserId, '— buffering candidate');
              this._pendingCandidates.push(candidate);
              return;
            }

            if (!this._remoteDescSet) {
              // Remote description not set yet — buffer the candidate
              _log('🧊 Buffering ICE candidate (remote desc not set yet) from', subcollection);
              this._pendingCandidates.push(candidate);
              return;
            }

            // Remote description is set — add candidate directly
            pc.addIceCandidate(candidate)
              .then(() => _log('🧊 ✅ Added ICE candidate from', subcollection, '| type:', candidateData.type || 'unknown'))
              .catch(err => _warn('🧊 ❌ ICE candidate add error:', err.message));
          }
        });
      }
    );
    this._candidateListeners[subcollection] = unsub;
  }

  // ===================================================================
  //  FLUSH BUFFERED ICE CANDIDATES
  // ===================================================================
  _flushPendingCandidates(remoteUserId) {
    const pc = this.peerConnections[remoteUserId];
    if (!pc || this._pendingCandidates.length === 0) return;

    _log('🧊 Flushing', this._pendingCandidates.length, 'buffered ICE candidates...');

    const candidates = [...this._pendingCandidates];
    this._pendingCandidates = [];

    candidates.forEach((candidate, i) => {
      pc.addIceCandidate(candidate)
        .then(() => _log(`🧊 ✅ Flushed candidate ${i + 1}/${candidates.length}`))
        .catch(err => _warn(`🧊 ❌ Flush candidate ${i + 1} error:`, err.message));
    });
  }
}

export const callManager = new CallManager();
