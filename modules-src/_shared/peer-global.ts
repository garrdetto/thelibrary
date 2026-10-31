import { Peer } from 'peerjs';

declare global {
  interface Window {
    Peer: typeof Peer;
  }
}

window.Peer = Peer;
