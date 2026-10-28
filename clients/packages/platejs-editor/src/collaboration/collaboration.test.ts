import { createPlateEditor } from "platejs/react";
import { expect, test } from "../../test/bun-test-compat";
import { assertPrivateSignaling, createYjsPlugin, YjsPlugin } from "./index";

const refuses = (signaling: string[]): boolean => {
  try {
    assertPrivateSignaling(signaling);
    return false;
  } catch {
    return true;
  }
};

test("refuses WebRTC without our own signaling servers", () => {
  expect(refuses([])).toBe(true);
  expect(refuses(["wss://signaling.yjs.dev"])).toBe(true);
  expect(refuses(["https://signal.example.com"])).toBe(true);
  expect(refuses(["wss://signal.shots.example"])).toBe(false);
});

test("a write session's browser copy is not one of Plate's providers", () => {
  // Plate skips seeding a new document while a local provider is loading and
  // never retries; the host loads the copy with loadLocalCopy before init.
  const plugin = createYjsPlugin(
    {
      access: "write",
      documentName: "content-draft:cdraft0000001:1",
      getToken: async () => "token",
      hocuspocusUrl: "ws://127.0.0.1:1234",
      webrtc: null,
    },
    { color: "#000", name: "Writer", userId: "writer" }
  );
  const editor = createPlateEditor({ plugins: [plugin] });
  const { awareness, providers, ydoc } = editor.getOptions(YjsPlugin);
  // Awareness keeps an interval timer; release it so the test process exits.
  awareness.destroy();
  ydoc.destroy();
  expect(
    providers.map((provider) => ("type" in provider ? provider.type : ""))
  ).toEqual(["hocuspocus"]);
});
