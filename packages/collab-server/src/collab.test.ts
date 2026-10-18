import assert from "node:assert/strict";
import test from "node:test";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { Server } from "@hocuspocus/server";
import * as Y from "yjs";
import {
  type CollabBackend,
  CollabBackendError,
  collabHooks,
  draftIdOf,
} from "./collab.ts";

const DRAFT = "cdraft0000001";
const DOCUMENT = `content-draft:${DRAFT}`;

/** A backend that knows two tokens for the draft and one for another draft. */
function fakeBackend() {
  const stored: { state: Uint8Array; token: string }[] = [];
  const grants: Record<string, "read" | "write"> = {
    "editor-token": "write",
    "viewer-token": "read",
  };
  const backend: CollabBackend = {
    authorize: async (token, documentName) => {
      const access = grants[token];
      if (!access || documentName !== DOCUMENT) {
        throw new CollabBackendError(
          "the collaboration token does not grant this document",
          403
        );
      }
      return {
        access,
        draftId: DRAFT,
        organizationId: "org",
        user: { id: token, name: token },
      };
    },
    load: async () => null,
    store: async (_draftId, token, state) => {
      stored.push({ state, token });
    },
  };
  return { backend, stored };
}

function connect(port: number, token: string, document = DOCUMENT) {
  const doc = new Y.Doc();
  const events = { failed: "", synced: false };
  const provider = new HocuspocusProvider({
    document: doc,
    name: document,
    onAuthenticationFailed: ({ reason }) => {
      events.failed = reason || "refused";
    },
    onSynced: () => {
      events.synced = true;
    },
    token,
    url: `ws://127.0.0.1:${port}`,
  });
  return { doc, events, provider };
}

const until = async (check: () => boolean, label: string) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`timed out waiting for ${label}`);
};

test("document names map to drafts only", () => {
  assert.equal(draftIdOf(DOCUMENT), DRAFT);
  assert.equal(draftIdOf("other:cdraft0000001"), null);
  assert.equal(draftIdOf("content-draft:../../etc"), null);
});

test("edits sync between editors, viewers stay read-only, strangers are refused", async () => {
  const { backend, stored } = fakeBackend();
  const log: string[] = [];
  const server = new Server({
    debounce: 50,
    port: 0,
    quiet: true,
    ...collabHooks(backend, (event) => log.push(event)),
  });
  await server.listen();
  const port = server.address.port;
  const editor = connect(port, "editor-token");
  const viewer = connect(port, "viewer-token");
  const stranger = connect(port, "stranger-token");
  try {
    await until(() => editor.events.synced && viewer.events.synced, "sync");
    editor.doc.getText("t").insert(0, "hello");
    await until(
      () => viewer.doc.getText("t").toString() === "hello",
      "edit to reach the viewer"
    );

    viewer.doc.getText("t").insert(0, "nope ");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(
      editor.doc.getText("t").toString(),
      "hello",
      "a read-only edit reached the editor"
    );

    await until(
      () => stranger.events.failed !== "",
      "the stranger to be refused"
    );
    assert.equal(stranger.doc.getText("t").toString(), "");
    assert.ok(log.includes("collab.refused"));

    await until(() => stored.length > 0, "a store");
    const saved = new Y.Doc();
    Y.applyUpdate(saved, stored.at(-1)!.state);
    assert.equal(saved.getText("t").toString(), "hello");
    assert.ok(
      stored.every(({ token }) => token === "editor-token"),
      "stored with a non-writer token"
    );
  } finally {
    for (const client of [editor, viewer, stranger]) client.provider.destroy();
    await server.destroy();
  }
});
