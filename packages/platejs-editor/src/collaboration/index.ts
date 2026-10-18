import { YjsPlugin } from "@platejs/yjs/react";

import { RemoteCursorOverlay } from "../ui/remote-cursor-overlay";

export interface CollaborationCursor {
  color: string;
  name: string;
  userId: string;
}

export interface CollaborationProviderConfig {
  // Mirrors @oppulence/core CollaborationAccess (this package doesn't depend on
  // @oppulence/core). "comment" and "read" both keep indexeddb/webrtc off below —
  // only "write" joins the P2P mesh; comment/read go through the server.
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
      providers: [
        ...(config.access === "write"
          ? [
              {
                type: "indexeddb" as const,
                options: { docName: config.documentName },
              },
            ]
          : []),
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

export { YjsPlugin };
