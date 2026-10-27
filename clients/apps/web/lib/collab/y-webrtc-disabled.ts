/**
 * Stands in for y-webrtc in this app's bundle (RFC 013). Peer-to-peer
 * collaboration is off: it needs our own signaling and TURN servers, and the
 * real library carries the public y-webrtc signaling servers as defaults.
 * Turning WebRTC on means removing the alias in next.config.ts and revising
 * the RFC.
 */
export class WebrtcProvider {
  constructor() {
    throw new Error('WebRTC collaboration is disabled in this app.')
  }
}
