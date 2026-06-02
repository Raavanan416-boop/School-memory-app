// WebRTC Calls — Voice, Video, and Group calls using Firestore signaling
// Fixed: ICE candidate direction, state machine, stale cleanup, missed calls, camera switch
import { db, doc, collection, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp, getDoc, getDocs, query, where } from './firebase-config.js';
import { authManager } from './auth.js';
import { createNotification } from './notifications.js';
import { showToast } from './utils.js';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' }
];

// Valid call state transitions
const CALL_STATES = {
  IDLE: 'idle',
  DIALING: 'dialing',    // Caller: initiated call, waiting for answer
  RINGING: 'ringing',    // Receiver: incoming call shown
  INCOMING: 'incoming',  // Receiver: sees incoming call UI
  CONNECTED: 'connected',// Both: WebRTC connection established
  ENDED: 'ended'         // Both: call has ended
};

class CallManager {
  constructor() {
    this.localStream = null;
    this.remoteStreams = {};
    this.peerConnections = {};
    this.currentCallId = null;
    this.currentCallType = null; // 'voice' or 'video'
    this.callStatus = CALL_STATES.IDLE;
    this.callListeners = [];
    this.incomingCallListener = null;
    this.isMuted = false;
    this.isCameraOff = false;
    this.isSpeakerOn = false;
    this.onCallStateChange = null;
    this.onRemoteStream = null;
    this.onCallEnd = null;
    this.onIncomingCall = null;
    this._candidateListeners = {};
    this._callDocListener = null;
    this._ringTimeout = null;
    this._isCaller = false; // true = caller, false = receiver
    this._connectedTimestamp = null;
  }

  // Is the call in an active state (not idle/ended)?
  get isInCall() {
    return this.callStatus !== CALL_STATES.IDLE && this.callStatus !== CALL_STATES.ENDED;
  }

  // Start listening for incoming calls
  listenForIncomingCalls() {
    if (!authManager.currentUser || this.incomingCallListener) return;

    // Clean up stale calls from previous sessions first
    this._cleanupStaleCalls();

    const callsCol = collection(db, 'calls');
    this.incomingCallListener = onSnapshot(callsCol, (snap) => {
      snap.docChanges().forEach(change => {
        if (change.type === 'added') {
          const call = { id: change.doc.id, ...change.doc.data() };

          // Only process calls targeting me that are currently ringing
          if (call.targetId === authManager.currentUser.uid &&
              call.status === 'ringing' &&
              !this.isInCall) {

            // Verify the call is fresh (created within last 45 seconds)
            const createdAt = call.createdAt?.toDate ? call.createdAt.toDate() : null;
            if (createdAt) {
              const ageMs = Date.now() - createdAt.getTime();
              if (ageMs > 45000) {
                console.log('[CallManager] Ignoring stale call:', call.id, 'age:', ageMs);
                return;
              }
            }

            // Show incoming call UI
            console.log('[CallManager] Incoming call:', call.id, 'from:', call.callerName);
            if (this.onIncomingCall) this.onIncomingCall(call);
          }
        }

        // Also watch for status changes on calls targeting me
        if (change.type === 'modified') {
          const call = { id: change.doc.id, ...change.doc.data() };
          if (call.targetId === authManager.currentUser.uid) {
            // If call was cancelled/ended while we're showing incoming UI
            if ((call.status === 'ended' || call.status === 'no_answer' || call.status === 'cancelled') &&
                this.callStatus === CALL_STATES.INCOMING) {
              console.log('[CallManager] Incoming call cancelled:', call.id);
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

  // Clean up stale call documents from previous sessions
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
        // If call is older than 60 seconds, auto-reject it
        if (now - createdAt > 60000) {
          console.log('[CallManager] Cleaning stale call:', d.id);
          try {
            await updateDoc(doc(db, 'calls', d.id), {
              status: 'no_answer',
              endedAt: serverTimestamp()
            });
          } catch (e) { /* ignore */ }
        }
      });
    } catch (e) {
      console.log('[CallManager] Stale call cleanup error:', e.message);
    }
  }

  // ===== START OUTGOING CALL =====
  async startCall(targetUserId, targetName, type = 'voice') {
    // Block only if actively in a call
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

      if (this.onCallStateChange) this.onCallStateChange('dialing');

      // Get local media stream
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: type === 'video' ? {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 }
        } : false
      };
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

      // Create call document in Firestore
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
      console.log('[CallManager] Call created:', callDoc.id);

      // Create peer connection
      const pc = this._createPeerConnection(targetUserId);
      this.peerConnections[targetUserId] = pc;

      // Add local tracks to peer connection
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });

      // Create SDP offer
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: type === 'video'
      });
      await pc.setLocalDescription(offer);

      // Store offer in Firestore
      await updateDoc(doc(db, 'calls', this.currentCallId), {
        offer: { type: offer.type, sdp: offer.sdp }
      });

      // Transition to ringing state
      this.callStatus = CALL_STATES.RINGING;
      if (this.onCallStateChange) this.onCallStateChange('ringing');

      // Listen for answer from receiver
      this._listenForAnswer(targetUserId);

      // Listen for ICE candidates from receiver (they write to answer-candidates)
      this._listenForCandidates(targetUserId, 'answer-candidates');

      // Send notification to receiver
      createNotification(type === 'video' ? 'video_call_incoming' : 'voice_call_incoming', targetUserId, {
        callId: this.currentCallId,
        callType: type,
        message: `${type === 'video' ? '📹' : '📞'} Incoming ${type} call`
      });

      // Auto-end if not answered in 35 seconds
      if (this._ringTimeout) clearTimeout(this._ringTimeout);
      this._ringTimeout = setTimeout(() => {
        if (this.isInCall && this.callStatus !== CALL_STATES.CONNECTED) {
          console.log('[CallManager] Call not answered, ending...');
          this.endCall('no_answer');
        }
      }, 35000);

      return this.currentCallId;
    } catch (e) {
      console.error('[CallManager] Start call error:', e);
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

  // ===== ANSWER INCOMING CALL =====
  async answerCall(callId) {
    // Only allow answering if we're idle or showing incoming UI
    if (this.callStatus === CALL_STATES.CONNECTED) {
      showToast('Already in a call', 'warning');
      return;
    }

    try {
      // Get the call document
      const callSnap = await getDoc(doc(db, 'calls', callId));
      if (!callSnap.exists()) {
        showToast('Call ended', 'info');
        this._resetCallState('ended');
        return;
      }

      const callData = callSnap.data();

      // Verify call is still ringing
      if (callData.status !== 'ringing') {
        showToast('Call is no longer available', 'info');
        this._resetCallState('ended');
        return;
      }

      // Verify there's an offer to answer
      if (!callData.offer) {
        console.error('[CallManager] No offer in call document');
        showToast('Call data incomplete', 'error');
        this._resetCallState('error');
        return;
      }

      this._isCaller = false;
      this.currentCallId = callId;
      this.currentCallType = callData.type;
      this.callStatus = CALL_STATES.RINGING;
      this.isMuted = false;
      this.isCameraOff = false;
      this._connectedTimestamp = null;

      // Get local media stream
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: callData.type === 'video' ? {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 }
        } : false
      };
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

      const callerId = callData.callerId;

      // Create peer connection
      const pc = this._createPeerConnection(callerId);
      this.peerConnections[callerId] = pc;

      // Add local tracks to peer connection
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });

      // Set remote description (the offer from caller)
      await pc.setRemoteDescription(new RTCSessionDescription(callData.offer));

      // Create SDP answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // Store answer in Firestore — this triggers the caller's _listenForAnswer
      await updateDoc(doc(db, 'calls', callId), {
        answer: { type: answer.type, sdp: answer.sdp },
        status: 'connected'
      });

      // Listen for ICE candidates from caller (they write to offer-candidates)
      this._listenForCandidates(callerId, 'offer-candidates');

      // Listen for call status changes (end, etc.)
      this._listenForCallStatus();

      console.log('[CallManager] Call answered, waiting for ICE connection...');

      // Note: We do NOT set callStatus to CONNECTED here.
      // The onconnectionstatechange handler will do that once ICE succeeds.

    } catch (e) {
      console.error('[CallManager] Answer call error:', e);
      this._resetCallState('error');
      if (e.name === 'NotAllowedError') {
        showToast('Microphone/camera permission denied.', 'error');
      } else {
        showToast('Could not answer call. Check permissions.', 'error');
      }
    }
  }

  // ===== REJECT INCOMING CALL =====
  async rejectCall(callId) {
    try {
      await updateDoc(doc(db, 'calls', callId), {
        status: 'rejected',
        endedAt: serverTimestamp()
      });
      this._resetCallState('rejected');
    } catch (e) {
      console.error('[CallManager] Reject call error:', e);
    }
  }

  // ===== END CURRENT CALL =====
  async endCall(reason = 'ended') {
    console.log('[CallManager] Ending call, reason:', reason);
    clearTimeout(this._ringTimeout);

    const callId = this.currentCallId;
    const wasCaller = this._isCaller;
    const callType = this.currentCallType;
    const wasConnected = this.callStatus === CALL_STATES.CONNECTED;

    // Close peer connections
    Object.values(this.peerConnections).forEach(pc => {
      try { pc.close(); } catch (e) { /* ignore */ }
    });
    this.peerConnections = {};

    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    // Stop remote streams
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

    // Update call status in Firestore
    if (callId) {
      try {
        await updateDoc(doc(db, 'calls', callId), {
          status: reason,
          endedAt: serverTimestamp()
        });
      } catch (e) { /* ignore — doc might already be deleted */ }

      // ===== MISSED CALL NOTIFICATION =====
      // If call was never connected and caller is ending it (no_answer), send missed call notif
      if (reason === 'no_answer' && wasCaller) {
        try {
          const callSnap = await getDoc(doc(db, 'calls', callId));
          if (callSnap.exists()) {
            const callData = callSnap.data();
            const targetId = callData.targetId;
            const notifType = callType === 'video' ? 'missed_video_call' : 'missed_voice_call';
            createNotification(notifType, targetId, {
              callId: callId,
              callType: callType,
              message: `Missed ${callType} call`
            });
          }
        } catch (e) {
          console.error('[CallManager] Missed call notification error:', e);
        }
      }
    }

    // Reset all state
    this._resetCallState(reason);
  }

  // Reset call state to idle
  _resetCallState(reason) {
    this.currentCallId = null;
    this.currentCallType = null;
    this.callStatus = CALL_STATES.IDLE;
    this._isCaller = false;
    this.isMuted = false;
    this.isCameraOff = false;
    this._connectedTimestamp = null;

    clearTimeout(this._ringTimeout);
    this._ringTimeout = null;

    if (this.onCallEnd) this.onCallEnd(reason);
  }

  // ===== AUDIO/VIDEO CONTROLS =====

  toggleMute() {
    if (!this.localStream) return false;
    this.isMuted = !this.isMuted;
    this.localStream.getAudioTracks().forEach(track => {
      track.enabled = !this.isMuted;
    });
    return this.isMuted;
  }

  toggleCamera() {
    if (!this.localStream) return false;
    this.isCameraOff = !this.isCameraOff;
    this.localStream.getVideoTracks().forEach(track => {
      track.enabled = !this.isCameraOff;
    });
    return this.isCameraOff;
  }

  // Switch between front and back camera
  async switchCamera() {
    if (!this.localStream || this.currentCallType !== 'video') return;

    const videoTrack = this.localStream.getVideoTracks()[0];
    if (!videoTrack) return;

    // Get current facing mode
    const settings = videoTrack.getSettings();
    const currentFacing = settings.facingMode || 'user';
    const newFacing = currentFacing === 'user' ? 'environment' : 'user';

    try {
      // Get new stream with opposite camera
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newFacing, width: { ideal: 640 }, height: { ideal: 480 } }
      });
      const newVideoTrack = newStream.getVideoTracks()[0];

      // Replace track in peer connection
      Object.values(this.peerConnections).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
          sender.replaceTrack(newVideoTrack);
        }
      });

      // Stop old track and replace in local stream
      videoTrack.stop();
      this.localStream.removeTrack(videoTrack);
      this.localStream.addTrack(newVideoTrack);

      return newFacing;
    } catch (e) {
      console.error('[CallManager] Camera switch error:', e);
      showToast('Could not switch camera', 'error');
      return null;
    }
  }

  // ===== PRIVATE: Create RTCPeerConnection =====
  _createPeerConnection(remoteUserId) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // Handle ICE candidates — direction depends on role (caller vs receiver)
    pc.onicecandidate = (event) => {
      if (event.candidate && this.currentCallId) {
        // CRITICAL FIX: Caller writes to offer-candidates, Receiver writes to answer-candidates
        const subcollection = this._isCaller ? 'offer-candidates' : 'answer-candidates';

        addDoc(collection(db, 'calls', this.currentCallId, subcollection), {
          ...event.candidate.toJSON()
        }).catch(err => console.error('[CallManager] ICE candidate write error:', err));
      }
    };

    // Handle remote tracks (audio/video from the other side)
    pc.ontrack = (event) => {
      console.log('[CallManager] Remote track received:', event.track.kind);
      if (event.streams && event.streams[0]) {
        this.remoteStreams[remoteUserId] = event.streams[0];
        if (this.onRemoteStream) this.onRemoteStream(remoteUserId, event.streams[0]);
      }
    };

    // Handle ICE connection state changes
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      console.log('[CallManager] ICE connection state:', state);

      if (state === 'connected' || state === 'completed') {
        // ICE has successfully connected — this is the REAL connection
        if (this.callStatus !== CALL_STATES.CONNECTED) {
          console.log('[CallManager] ICE connected — call is truly connected now');
          this.callStatus = CALL_STATES.CONNECTED;
          this._connectedTimestamp = Date.now();
          if (this.onCallStateChange) this.onCallStateChange('connected');
          if (this._ringTimeout) {
            clearTimeout(this._ringTimeout);
            this._ringTimeout = null;
          }
        }
      } else if (state === 'disconnected') {
        console.log('[CallManager] ICE disconnected — will wait for recovery...');
        // Don't end immediately — ICE can recover
        setTimeout(() => {
          if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            this.endCall('disconnected');
          }
        }, 5000);
      } else if (state === 'failed') {
        console.log('[CallManager] ICE failed — ending call');
        this.endCall('failed');
      }
    };

    // Handle peer connection state changes (overall state)
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log('[CallManager] Peer connection state:', state);

      if (state === 'connected') {
        // Backup: also trigger connected from here
        if (this.callStatus !== CALL_STATES.CONNECTED) {
          this.callStatus = CALL_STATES.CONNECTED;
          this._connectedTimestamp = Date.now();
          if (this.onCallStateChange) this.onCallStateChange('connected');
          if (this._ringTimeout) {
            clearTimeout(this._ringTimeout);
            this._ringTimeout = null;
          }
        }
      } else if (state === 'failed' || state === 'closed') {
        if (this.isInCall) {
          this.endCall('disconnected');
        }
      }
    };

    return pc;
  }

  // ===== PRIVATE: Listen for SDP answer (caller-side) =====
  _listenForAnswer(remoteUserId) {
    if (!this.currentCallId) return;

    const unsub = onSnapshot(doc(db, 'calls', this.currentCallId), (snap) => {
      const data = snap.data();
      if (!data) return;

      // When receiver sends their answer — set it as remote description
      if (data.answer && this.peerConnections[remoteUserId]) {
        const pc = this.peerConnections[remoteUserId];
        if (!pc.currentRemoteDescription) {
          console.log('[CallManager] Received answer, setting remote description...');
          pc.setRemoteDescription(new RTCSessionDescription(data.answer))
            .then(() => {
              console.log('[CallManager] Remote description set successfully');
              // NOTE: We do NOT set callStatus to CONNECTED here.
              // Wait for ICE to actually connect (oniceconnectionstatechange).
            })
            .catch(err => console.error('[CallManager] setRemoteDescription error:', err));

          // Clear ring timeout — call was answered (even if ICE hasn't connected yet)
          if (this._ringTimeout) {
            clearTimeout(this._ringTimeout);
            this._ringTimeout = null;
          }
        }
      }

      // Handle remote-side ending the call
      if (data.status === 'rejected' || data.status === 'ended' || data.status === 'no_answer' || data.status === 'cancelled') {
        if (this.isInCall) {
          this.endCall(data.status);
        }
        unsub();
      }
    });

    this._candidateListeners['call-doc'] = unsub;
  }

  // ===== PRIVATE: Listen for call status changes (receiver-side) =====
  _listenForCallStatus() {
    if (!this.currentCallId) return;

    const unsub = onSnapshot(doc(db, 'calls', this.currentCallId), (snap) => {
      const data = snap.data();
      if (!data) return;

      // Handle caller ending the call
      if (data.status === 'ended' || data.status === 'cancelled') {
        if (this.isInCall) {
          this.endCall(data.status);
        }
        unsub();
      }
    });

    this._callDocListener = unsub;
  }

  // ===== PRIVATE: Listen for ICE candidates =====
  _listenForCandidates(remoteUserId, subcollection) {
    if (!this.currentCallId) return;

    console.log('[CallManager] Listening for ICE candidates in:', subcollection);

    const unsub = onSnapshot(
      collection(db, 'calls', this.currentCallId, subcollection),
      (snap) => {
        snap.docChanges().forEach(change => {
          if (change.type === 'added') {
            const candidateData = change.doc.data();
            const candidate = new RTCIceCandidate(candidateData);
            const pc = this.peerConnections[remoteUserId];
            if (pc && pc.remoteDescription) {
              pc.addIceCandidate(candidate)
                .then(() => console.log('[CallManager] Added ICE candidate from', subcollection))
                .catch(err => console.warn('[CallManager] ICE candidate add error:', err));
            } else if (pc) {
              // Queue candidate — remote description not set yet
              // This happens when candidates arrive before the answer
              console.log('[CallManager] Queuing ICE candidate (no remote desc yet)');
              // RTCPeerConnection will queue it internally if setRemoteDescription hasn't been called
              pc.addIceCandidate(candidate).catch(() => {
                // Expected if remote desc isn't set — will be re-tried by WebRTC internally
              });
            }
          }
        });
      }
    );
    this._candidateListeners[subcollection] = unsub;
  }
}

export const callManager = new CallManager();
