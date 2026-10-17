import { YjsPlugin } from "@platejs/yjs/react";

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

export const createYjsPlugin = (
  config: CollaborationProviderConfig,
  cursor: CollaborationCursor
) =>
  YjsPlugin.configure({
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

export { YjsPlugin };
