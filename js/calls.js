// WebRTC Calls — Voice, Video, and Group calls using Firestore signaling
import { db, doc, collection, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp, getDoc } from './firebase-config.js';
import { authManager } from './auth.js';
import { createNotification } from './notifications.js';
import { showToast } from './utils.js';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

class CallManager {
  constructor() {
    this.localStream = null;
    this.remoteStreams = {};
    this.peerConnections = {};
    this.currentCallId = null;
    this.currentCallType = null; // 'voice' or 'video'
    this.callStatus = 'idle'; // idle | dialing | ringing | connected | ended
    this.callListeners = [];
    this.incomingCallListener = null;
    this.isInCall = false;
    this.isMuted = false;
    this.isCameraOff = false;
    this.onCallStateChange = null;
    this.onRemoteStream = null;
    this.onCallEnd = null;
    this.onIncomingCall = null;
    this._candidateListeners = {};
    this._ringTimeout = null;
  }

  // Start listening for incoming calls
  listenForIncomingCalls() {
    if (!authManager.currentUser || this.incomingCallListener) return;

    const callsQuery = collection(db, 'calls');
    // We'll listen for documents where we're the target
    this.incomingCallListener = onSnapshot(callsQuery, (snap) => {
      snap.docChanges().forEach(change => {
        if (change.type === 'added') {
          const call = { id: change.doc.id, ...change.doc.data() };
          if (call.targetId === authManager.currentUser.uid &&
              call.status === 'ringing' &&
              !this.isInCall) {
            // Show incoming call UI
            if (this.onIncomingCall) this.onIncomingCall(call);
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

  // Start an outgoing call
  async startCall(targetUserId, targetName, type = 'voice') {
    // Only block if we're actively connected — not just dialing
    if (this.isInCall && this.callStatus === 'connected') {
      showToast('Already in a call', 'warning');
      return null;
    }

    try {
      this.currentCallType = type;
      this.callStatus = 'dialing';
      this.isInCall = true;
      this.isMuted = false;
      this.isCameraOff = false;

      // Get local media stream
      const constraints = {
        audio: true,
        video: type === 'video' ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false
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

      // Create peer connection
      const pc = this._createPeerConnection(targetUserId);
      this.peerConnections[targetUserId] = pc;

      // Add local tracks
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });

      // Create offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Store offer in Firestore
      await updateDoc(doc(db, 'calls', this.currentCallId), {
        offer: { type: offer.type, sdp: offer.sdp }
      });

      // Transition to ringing state
      this.callStatus = 'ringing';

      // Listen for answer
      this._listenForAnswer(targetUserId);

      // Listen for ICE candidates from remote
      this._listenForCandidates(targetUserId, 'answer-candidates');

      // Notify caller state change
      if (this.onCallStateChange) this.onCallStateChange('ringing');

      // Send notification
      createNotification('call_incoming', targetUserId, {
        callId: this.currentCallId,
        callType: type,
        message: `${type === 'video' ? '📹' : '📞'} Incoming ${type} call`
      });

      // Auto-end if not answered in 30s
      if (this._ringTimeout) clearTimeout(this._ringTimeout);
      this._ringTimeout = setTimeout(() => {
        if (this.isInCall && this.callStatus !== 'connected') {
          this.endCall('no_answer');
        }
      }, 30000);

      return this.currentCallId;
    } catch (e) {
      console.error('Start call error:', e);
      this.callStatus = 'idle';
      this.isInCall = false;
      showToast('Could not start call. Check microphone/camera permissions.', 'error');
      return null;
    }
  }

  // Answer an incoming call
  async answerCall(callId) {
    // Allow answering if we're idle, or if we were just shown the incoming UI
    if (this.isInCall && this.callStatus === 'connected') {
      showToast('Already in a call', 'warning');
      return;
    }

    try {
      const callSnap = await getDoc(doc(db, 'calls', callId));
      if (!callSnap.exists()) {
        showToast('Call ended', 'info');
        return;
      }

      const callData = callSnap.data();
      this.currentCallId = callId;
      this.currentCallType = callData.type;
      this.callStatus = 'ringing';
      this.isInCall = true;
      this.isMuted = false;
      this.isCameraOff = false;

      // Get local media stream
      const constraints = {
        audio: true,
        video: callData.type === 'video' ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false
      };
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

      const callerId = callData.callerId;

      // Create peer connection
      const pc = this._createPeerConnection(callerId);
      this.peerConnections[callerId] = pc;

      // Add local tracks
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });

      // Set remote description (offer)
      await pc.setRemoteDescription(new RTCSessionDescription(callData.offer));

      // Create answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // Store answer in Firestore — this triggers the caller's _listenForAnswer
      await updateDoc(doc(db, 'calls', callId), {
        answer: { type: answer.type, sdp: answer.sdp },
        status: 'connected'
      });

      // Listen for ICE candidates from remote
      this._listenForCandidates(callerId, 'offer-candidates');

      // Immediately transition to connected
      this.callStatus = 'connected';
      if (this.onCallStateChange) this.onCallStateChange('connected');

    } catch (e) {
      console.error('Answer call error:', e);
      this.callStatus = 'idle';
      this.isInCall = false;
      showToast('Could not answer call. Check permissions.', 'error');
    }
  }

  // Reject an incoming call
  async rejectCall(callId) {
    try {
      await updateDoc(doc(db, 'calls', callId), { status: 'rejected' });
    } catch (e) { console.error('Reject call error:', e); }
  }

  // End the current call
  async endCall(reason = 'ended') {
    clearTimeout(this._ringTimeout);

    // Close peer connections
    Object.values(this.peerConnections).forEach(pc => {
      pc.close();
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
    Object.values(this._candidateListeners).forEach(unsub => unsub());
    this._candidateListeners = {};

    // Update call status in Firestore
    if (this.currentCallId) {
      try {
        await updateDoc(doc(db, 'calls', this.currentCallId), {
          status: reason,
          endedAt: serverTimestamp()
        });
      } catch (e) { /* ignore */ }
    }

    this.currentCallId = null;
    this.currentCallType = null;
    this.callStatus = 'idle';
    this.isInCall = false;
    this.isMuted = false;
    this.isCameraOff = false;

    if (this.onCallEnd) this.onCallEnd(reason);
  }

  // Toggle mute
  toggleMute() {
    if (!this.localStream) return;
    this.isMuted = !this.isMuted;
    this.localStream.getAudioTracks().forEach(track => {
      track.enabled = !this.isMuted;
    });
    return this.isMuted;
  }

  // Toggle camera
  toggleCamera() {
    if (!this.localStream) return;
    this.isCameraOff = !this.isCameraOff;
    this.localStream.getVideoTracks().forEach(track => {
      track.enabled = !this.isCameraOff;
    });
    return this.isCameraOff;
  }

  // Private: Create RTCPeerConnection
  _createPeerConnection(remoteUserId) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && this.currentCallId) {
        const isOffer = this.peerConnections[remoteUserId] === pc &&
          authManager.currentUser.uid !== remoteUserId;
        const candidatesCollection = isOffer ? 'offer-candidates' : 'answer-candidates';

        addDoc(collection(db, 'calls', this.currentCallId, candidatesCollection), {
          ...event.candidate.toJSON()
        }).catch(console.error);
      }
    };

    // Handle remote tracks
    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        this.remoteStreams[remoteUserId] = event.streams[0];
        if (this.onRemoteStream) this.onRemoteStream(remoteUserId, event.streams[0]);
      }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected' && this.callStatus !== 'connected') {
        // ICE negotiation succeeded — force state to connected
        this.callStatus = 'connected';
        if (this.onCallStateChange) this.onCallStateChange('connected');
        if (this._ringTimeout) { clearTimeout(this._ringTimeout); this._ringTimeout = null; }
      } else if (state === 'disconnected' || state === 'failed') {
        this.endCall('disconnected');
      }
    };

    return pc;
  }

  // Private: Listen for SDP answer (caller-side)
  _listenForAnswer(remoteUserId) {
    if (!this.currentCallId) return;
    const unsub = onSnapshot(doc(db, 'calls', this.currentCallId), (snap) => {
      const data = snap.data();
      if (!data) return;

      // When remote answers — set remote description and transition to connected
      if (data.answer && this.peerConnections[remoteUserId]) {
        const pc = this.peerConnections[remoteUserId];
        if (!pc.currentRemoteDescription) {
          pc.setRemoteDescription(new RTCSessionDescription(data.answer))
            .then(() => {
              // Strictly update state to connected
              this.callStatus = 'connected';
              if (this.onCallStateChange) this.onCallStateChange('connected');
            })
            .catch(err => console.error('setRemoteDescription error:', err));
          // Clear ring timeout immediately — call was answered
          if (this._ringTimeout) { clearTimeout(this._ringTimeout); this._ringTimeout = null; }
        }
      }

      // Also check Firestore status field for connected transition
      if (data.status === 'connected' && this.callStatus !== 'connected') {
        this.callStatus = 'connected';
        if (this.onCallStateChange) this.onCallStateChange('connected');
        if (this._ringTimeout) { clearTimeout(this._ringTimeout); this._ringTimeout = null; }
      }

      if (data.status === 'rejected' || data.status === 'ended' || data.status === 'no_answer') {
        this.endCall(data.status);
        unsub();
      }
    });
    this._candidateListeners['answer'] = unsub;
  }

  // Private: Listen for ICE candidates
  _listenForCandidates(remoteUserId, subcollection) {
    if (!this.currentCallId) return;
    const unsub = onSnapshot(
      collection(db, 'calls', this.currentCallId, subcollection),
      (snap) => {
        snap.docChanges().forEach(change => {
          if (change.type === 'added') {
            const candidate = new RTCIceCandidate(change.doc.data());
            const pc = this.peerConnections[remoteUserId];
            if (pc) pc.addIceCandidate(candidate).catch(console.error);
          }
        });
      }
    );
    this._candidateListeners[subcollection] = unsub;
  }
}

export const callManager = new CallManager();
