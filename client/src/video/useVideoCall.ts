import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMsg, IceServer, ServerMsg, VideoParticipant } from '@qchat/shared';
import { onSignal } from './bus.js';

export type CallMode = 'none' | 'cam' | 'watch';

export interface VideoCall {
  mode: CallMode;
  /** Your own camera (muted for you, so there is no echo). */
  local: MediaStream | null;
  /** The cameras you are receiving, by name. */
  remotes: Record<string, MediaStream>;
  error: string | null;
  micOn: boolean;
  camOn: boolean;
  join: (cam: boolean) => Promise<void>;
  leave: () => void;
  toggleMic: () => void;
  toggleCam: () => void;
}

/**
 * One room's live video. The pictures go straight between browsers (WebRTC); the server only tells you who is in the
 * call and passes the set-up messages along. Whoever arrives later makes the first move toward each person already there.
 */
export function useVideoCall(room: string, send: (m: ClientMsg) => void, participants: VideoParticipant[], ice: IceServer[]): VideoCall {
  const [mode, setMode] = useState<CallMode>('none');
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remotes, setRemotes] = useState<Record<string, MediaStream>>({});
  const [error, setError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  const peers = useRef(new Map<string, RTCPeerConnection>());
  const waitingIce = useRef(new Map<string, RTCIceCandidateInit[]>());
  const localRef = useRef<MediaStream | null>(null);
  const modeRef = useRef<CallMode>('none');
  const iceRef = useRef(ice);
  iceRef.current = ice;
  const sendRef = useRef(send);
  sendRef.current = send;

  const closePeer = useCallback((nick: string) => {
    const pc = peers.current.get(nick);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        /* already closed */
      }
    }
    peers.current.delete(nick);
    waitingIce.current.delete(nick);
    setRemotes((r) => {
      if (!(nick in r)) return r;
      const { [nick]: _gone, ...rest } = r;
      return rest;
    });
  }, []);

  const stopEverything = useCallback(() => {
    for (const nick of [...peers.current.keys()]) closePeer(nick);
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    setLocal(null);
    setRemotes({});
    modeRef.current = 'none';
    setMode('none');
  }, [closePeer]);

  const makePeer = useCallback(
    (nick: string): RTCPeerConnection => {
      const pc = new RTCPeerConnection({ iceServers: iceRef.current });
      peers.current.set(nick, pc);
      pc.onicecandidate = (e) => {
        if (e.candidate) sendRef.current({ t: 'rtc', room, to: nick, kind: 'ice', data: e.candidate.toJSON() });
      };
      pc.ontrack = (e) => {
        const stream = e.streams[0] ?? new MediaStream([e.track]);
        setRemotes((r) => ({ ...r, [nick]: stream }));
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') closePeer(nick);
      };
      return pc;
    },
    [room, closePeer],
  );

  const addMine = (pc: RTCPeerConnection) => {
    const s = localRef.current;
    if (s) for (const t of s.getTracks()) pc.addTrack(t, s);
  };

  /** Make the first move toward someone who was already in the call. */
  const callPeer = useCallback(
    async (nick: string) => {
      if (peers.current.has(nick)) return;
      const pc = makePeer(nick);
      if (localRef.current) addMine(pc);
      else {
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });
      }
      await pc.setLocalDescription(await pc.createOffer());
      sendRef.current({ t: 'rtc', room, to: nick, kind: 'offer', data: pc.localDescription?.toJSON() });
    },
    [makePeer, room],
  );

  // What the server tells us.
  useEffect(() => {
    return onSignal((m: ServerMsg) => {
      if (!('room' in m) || m.room !== room) return;
      if (m.t === 'videoPeers') {
        for (const nick of m.peers) void callPeer(nick);
      } else if (m.t === 'videoEnded') {
        stopEverything();
        setError(m.reason);
      } else if (m.t === 'rtc') {
        void (async () => {
          const from = m.from;
          try {
            if (m.kind === 'offer') {
              if (modeRef.current === 'none') return;
              peers.current.get(from) && closePeer(from);
              const pc = makePeer(from);
              await pc.setRemoteDescription(m.data as RTCSessionDescriptionInit);
              for (const c of waitingIce.current.get(from) ?? []) await pc.addIceCandidate(c);
              waitingIce.current.delete(from);
              addMine(pc);
              await pc.setLocalDescription(await pc.createAnswer());
              sendRef.current({ t: 'rtc', room, to: from, kind: 'answer', data: pc.localDescription?.toJSON() });
            } else if (m.kind === 'answer') {
              const pc = peers.current.get(from);
              if (!pc) return;
              await pc.setRemoteDescription(m.data as RTCSessionDescriptionInit);
              for (const c of waitingIce.current.get(from) ?? []) await pc.addIceCandidate(c);
              waitingIce.current.delete(from);
            } else if (m.kind === 'ice') {
              const pc = peers.current.get(from);
              if (pc?.remoteDescription) await pc.addIceCandidate(m.data as RTCIceCandidateInit);
              else waitingIce.current.set(from, [...(waitingIce.current.get(from) ?? []), m.data as RTCIceCandidateInit]);
            }
          } catch {
            closePeer(from);
          }
        })();
      }
    });
  }, [room, callPeer, makePeer, closePeer, stopEverything]);

  // Someone left the call: drop the connection to them.
  const names = participants.map((p) => p.nick).join('|');
  useEffect(() => {
    const here = new Set(participants.map((p) => p.nick));
    for (const nick of [...peers.current.keys()]) if (!here.has(nick)) closePeer(nick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names, closePeer]);

  // Leaving the room, or the page, leaves the call.
  useEffect(() => () => {
    if (modeRef.current !== 'none') sendRef.current({ t: 'videoLeave', room });
    for (const nick of [...peers.current.keys()]) peers.current.get(nick)?.close();
    localRef.current?.getTracks().forEach((t) => t.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  const join = useCallback(
    async (cam: boolean) => {
      setError(null);
      if (typeof RTCPeerConnection === 'undefined') return setError('This browser cannot do live video.');
      if (cam) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } },
            audio: { echoCancellation: true, noiseSuppression: true },
          });
          localRef.current = stream;
          setLocal(stream);
          setMicOn(true);
          setCamOn(true);
        } catch (e) {
          const name = (e as DOMException).name;
          setError(
            name === 'NotAllowedError'
              ? 'Your browser blocked the camera or microphone. Allow them for this site in the address bar, then try again.'
              : name === 'NotFoundError'
                ? 'No camera or microphone was found.'
                : 'The camera could not be started.',
          );
          return;
        }
      }
      modeRef.current = cam ? 'cam' : 'watch';
      setMode(modeRef.current);
      send({ t: 'videoJoin', room, cam });
    },
    [room, send],
  );

  const leave = useCallback(() => {
    send({ t: 'videoLeave', room });
    stopEverything();
  }, [room, send, stopEverything]);

  const toggleMic = useCallback(() => {
    const on = !micOn;
    localRef.current?.getAudioTracks().forEach((t) => (t.enabled = on));
    setMicOn(on);
  }, [micOn]);

  const toggleCam = useCallback(() => {
    const on = !camOn;
    localRef.current?.getVideoTracks().forEach((t) => (t.enabled = on));
    setCamOn(on);
  }, [camOn]);

  return { mode, local, remotes, error, micOn, camOn, join, leave, toggleMic, toggleCam };
}
