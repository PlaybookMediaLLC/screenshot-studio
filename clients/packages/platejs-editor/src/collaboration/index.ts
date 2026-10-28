import { YjsPlugin } from "@platejs/yjs/react";
import { IndexeddbPersistence } from "y-indexeddb";
import type * as Y from "yjs";

import { RemoteCursorOverlay } from "../ui/remote-cursor-overlay";

export interface CollaborationCursor {
  color: string;
  name: string;
  userId: string;
}

export interface CollaborationProviderConfig {
  // Mirrors @oppulence/core CollaborationAccess (this package doesn't depend on
  // @oppulence/core). "comment" and "read" keep webrtc off below and get no
  // loadLocalCopy — only "write" does both; comment/read go through the server.
  access: "read" | "comment" | "write";
  documentName: string;
  getToken: () => Promise<string>;
  hocuspocusUrl: string;
  webrtc: {
    iceServers: Array<{ urls: string[] }>;
    password: string;
    roomName: string;
    signaling: string[];
  } | null;
}

// y-webrtc falls back to these public servers when `signaling` is empty.
const PUBLIC_SIGNALING_HOSTS = new Set([
  "signaling.yjs.dev",
  "y-webrtc-signaling-eu.herokuapp.com",
  "y-webrtc-signaling-us.herokuapp.com",
]);

/**
 * WebRTC needs the host's own signaling (and TURN) servers. An empty list
 * would make y-webrtc use public servers, so it is refused, as are the
 * public hosts themselves.
 */
export const assertPrivateSignaling = (signaling: readonly string[]): void => {
  if (signaling.length === 0) {
    throw new Error("WebRTC collaboration needs explicit signaling servers.");
  }
  for (const url of signaling) {
    const { hostname, protocol } = new URL(url);
    if (protocol !== "wss:" && protocol !== "ws:") {
      throw new Error(`Signaling server ${url} is not a WebSocket URL.`);
    }
    if (PUBLIC_SIGNALING_HOSTS.has(hostname)) {
      throw new Error(`Signaling server ${hostname} is public.`);
    }
  }
};

export const createYjsPlugin = (
  config: CollaborationProviderConfig,
  cursor: CollaborationCursor
) => {
  if (config.access === "write" && config.webrtc) {
    assertPrivateSignaling(config.webrtc.signaling);
  }
  return YjsPlugin.configure({
    render: { afterEditable: RemoteCursorOverlay },
    options: {
      cursors: {
        data: {
          color: cursor.color,
          name: cursor.name,
          style: { backgroundColor: cursor.color },
          selectionStyle: { backgroundColor: `${cursor.color}33` },
          userId: cursor.userId,
        },
      },
      // A write session's browser copy is loaded with loadLocalCopy before
      // init, not as a provider here: see loadLocalCopy.
      providers: [
        {
          type: "hocuspocus",
          options: {
            name: config.documentName,
            token: config.getToken,
            url: config.hocuspocusUrl,
          },
        },
        // Only write sessions may join the WebRTC P2P mesh. y-webrtc has no
        // per-peer read-only enforcement, so a read-only client handed the
        // room/password/signaling config could broadcast Yjs updates directly,
        // bypassing the authorized hocuspocus server path. Gate it on access.
        ...(config.access === "write" && config.webrtc
          ? [
              {
                type: "webrtc" as const,
                options: {
                  password: config.webrtc.password,
                  peerOpts: {
                    config: { iceServers: config.webrtc.iceServers },
                  },
                  roomName: config.webrtc.roomName,
                  signaling: config.webrtc.signaling,
                },
              },
            ]
          : []),
      ],
    },
  });
};

/**
 * The browser's copy of a write session's document, loaded into `doc` before
 * the live session starts. Plate seeds a never-opened document from the stored
 * draft only when no local copy is still loading, and it never retries. As one
 * of its providers, an IndexedDB copy that finished loading after the server
 * sync left a new draft's editor empty. Loaded first, any unsynced local edits
 * are in the document before Plate decides, and it keeps persisting them.
 */
export const loadLocalCopy = (
  documentName: string,
  doc: Y.Doc
): { destroy: () => void; ready: Promise<void> } => {
  const persistence = new IndexeddbPersistence(documentName, doc);
  return {
    destroy: () => {
      persistence.destroy().catch(() => {});
    },
    // Without IndexedDB (some private modes) the session uses the server alone.
    ready: Promise.race([
      persistence.whenSynced.then(() => undefined),
      persistence._db.then(
        () => new Promise<void>(() => {}),
        () => undefined
      ),
    ]),
  };
};

export { YjsPlugin };
