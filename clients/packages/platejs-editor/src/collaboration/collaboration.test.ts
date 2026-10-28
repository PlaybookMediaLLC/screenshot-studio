import { createPlateEditor } from "platejs/react";
import { expect, test } from "../../test/bun-test-compat";
import {
  assertPrivateSignaling,
  createYjsPlugin,
  throttleCursor,
  YjsPlugin,
} from "./index";

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

test("cursor moves are throttled, the last one always sent, other fields at once", async () => {
  const sent: [string, unknown][] = [];
  const awareness = {
    setLocalStateField(field: string, value: unknown) {
      sent.push([field, value]);
    },
  };
  const restore = throttleCursor(awareness, 40);
  for (let index = 0; index < 10; index += 1)
    awareness.setLocalStateField("selection", index);
  awareness.setLocalStateField("data", "Writer");
  expect(sent).toEqual([
    ["selection", 0],
    ["data", "Writer"],
  ]);
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(sent.at(-1)).toEqual(["selection", 9]);
  expect(sent.length).toBe(3);
  restore();
  awareness.setLocalStateField("selection", "after");
  expect(sent.at(-1)).toEqual(["selection", "after"]);
});
