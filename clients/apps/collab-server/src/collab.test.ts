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
  memoryWriterTokens,
  redisWriterTokens,
} from "./collab.ts";

const DRAFT = "cdraft0000001";
const DOCUMENT = `content-draft:${DRAFT}`;

/** A backend that knows two tokens for the draft and one for another draft. */
function fakeBackend() {
  const stored: { state: Uint8Array; token: string }[] = [];
  const grants: Record<string, "read" | "write"> = {
    "editor-token": "write",
    "second-editor-token": "write",
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
  return { backend, stored, grants };
}

function connect(port: number, token: string, document = DOCUMENT) {
  const doc = new Y.Doc();
  const events = { failed: "", synced: false, closed: false };
  const provider = new HocuspocusProvider({
    document: doc,
    name: document,
    onAuthenticationFailed: ({ reason }) => {
      events.failed = reason || "refused";
    },
    onClose: () => {
      events.closed = true;
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

test("an open editor becomes read-only before its next live edit", async () => {
  const { backend, stored, grants } = fakeBackend();
  const server = new Server({
    port: 0,
    quiet: true,
    debounce: 50,
    ...collabHooks(backend, () => {}),
  });
  await server.listen();
  const owner = connect(server.address.port, "editor-token");
  const member = connect(server.address.port, "second-editor-token");
  try {
    await until(
      () => owner.events.synced && member.events.synced,
      "both editors"
    );
    owner.doc.getText("t").insert(0, "original");
    await until(
      () => member.doc.getText("t").toString() === "original",
      "initial edit"
    );
    grants["second-editor-token"] = "read";
    member.doc.getText("t").insert(0, "forbidden ");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(
      owner.doc.getText("t").toString(),
      "original",
      "a demoted editor's update was broadcast"
    );
    owner.doc.getText("t").insert(8, " allowed");
    await until(
      () => member.doc.getText("t").toString().includes("allowed"),
      "read-only member's authorized updates"
    );
    await until(() => stored.length > 0, "stored authorized content");
    const saved = new Y.Doc();
    Y.applyUpdate(saved, stored.at(-1)!.state);
    assert.ok(!saved.getText("t").toString().includes("forbidden"));
    saved.destroy();
  } finally {
    for (const client of [owner, member]) {
      client.provider.destroy();
      client.doc.destroy();
    }
    await server.destroy();
  }
});

test("an update's echo and acknowledgement share one outgoing decision", async () => {
  const { backend } = fakeBackend();
  const authorize = backend.authorize;
  let calls = 0;
  backend.authorize = async (token, documentName) => {
    calls += 1;
    return authorize(token, documentName);
  };
  const server = new Server({
    port: 0,
    quiet: true,
    ...collabHooks(backend, () => {}),
  });
  await server.listen();
  const owner = connect(server.address.port, "editor-token");
  try {
    await until(() => owner.events.synced, "sync");
    await new Promise((resolve) => setTimeout(resolve, 200));
    const before = calls;
    for (let index = 0; index < 10; index += 1) {
      owner.doc.getText("t").insert(index, "x");
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    await until(
      () =>
        server.hocuspocus.documents.get(DOCUMENT)?.getText("t").length === 10,
      "ten updates"
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    // One decision admits each update; one more releases its echo together with
    // the sync acknowledgement Hocuspocus sends in the same turn (was two).
    assert.ok(
      calls - before <= 20,
      `${calls - before} decisions for ten updates`
    );
  } finally {
    owner.provider.destroy();
    owner.doc.destroy();
    await server.destroy();
  }
});

test("a removed idle recipient gets no later document updates or awareness", async () => {
  const { backend, grants } = fakeBackend();
  const server = new Server({
    port: 0,
    quiet: true,
    ...collabHooks(backend, () => {}),
  });
  await server.listen();
  const owner = connect(server.address.port, "editor-token");
  const viewer = connect(server.address.port, "viewer-token");
  try {
    await until(
      () => owner.events.synced && viewer.events.synced,
      "initial sync"
    );
    delete grants["viewer-token"];
    owner.doc.getText("t").insert(0, "private after removal");
    owner.provider.setAwarenessField("user", { name: "Private presence" });
    await until(() => viewer.events.closed, "removed idle recipient to close");
    assert.equal(viewer.doc.getText("t").toString(), "");
    assert.ok(
      ![...viewer.provider.awareness!.getStates().values()].some(
        (state) => state.user?.name === "Private presence"
      )
    );
  } finally {
    for (const client of [owner, viewer]) {
      client.provider.destroy();
      client.doc.destroy();
    }
    await server.destroy();
  }
});

test("a delayed authorization cannot release frames queued after removal", async () => {
  const { backend, grants } = fakeBackend();
  const authorize = backend.authorize;
  const release = Promise.withResolvers<void>();
  let hold = false;
  let checking = false;
  backend.authorize = async (token, documentName) => {
    const grant = await authorize(token, documentName);
    if (hold && token === "viewer-token") {
      hold = false;
      checking = true;
      await release.promise;
    }
    return grant;
  };
  const server = new Server({
    port: 0,
    quiet: true,
    ...collabHooks(backend, () => {}),
  });
  await server.listen();
  const owner = connect(server.address.port, "editor-token");
  const viewer = connect(server.address.port, "viewer-token");
  try {
    await until(() => owner.events.synced && viewer.events.synced, "sync");
    hold = true;
    owner.doc.getText("t").insert(0, "before removal");
    await until(() => checking, "held outgoing authorization");
    delete grants["viewer-token"];
    owner.doc.getText("t").insert(14, " PRIVATE");
    await until(
      () =>
        server.hocuspocus.documents
          .get(DOCUMENT)
          ?.getText("t")
          .toString()
          .includes("PRIVATE") ?? false,
      "private update queued while authorization is held"
    );
    release.resolve();
    await until(
      () => viewer.doc.getText("t").toString().includes("before removal"),
      "authorized batch"
    );
    assert.ok(!viewer.doc.getText("t").toString().includes("PRIVATE"));
    await until(
      () => viewer.events.closed,
      "new authorization to refuse the later batch"
    );
    assert.ok(!viewer.doc.getText("t").toString().includes("PRIVATE"));
  } finally {
    release.resolve();
    for (const client of [owner, viewer]) {
      client.provider.destroy();
      client.doc.destroy();
    }
    await server.destroy();
  }
});

test("a rejected document store closes its room without crashing the server", async () => {
  const { backend, stored } = fakeBackend();
  const store = backend.store;
  let refuse = true;
  backend.store = async (...args) => {
    if (refuse) throw new CollabBackendError("store refused", 403);
    await store(...args);
  };
  const log: string[] = [];
  const server = new Server({
    debounce: 10,
    port: 0,
    quiet: true,
    ...collabHooks(backend, (event) => log.push(event)),
  });
  await server.listen();
  const owner = connect(server.address.port, "editor-token");
  let reconnected: HocuspocusProvider | undefined;
  try {
    await until(() => owner.events.synced, "sync");
    owner.doc.getText("t").insert(0, "pending client state");
    await until(
      () => owner.events.closed,
      "refused store to close its document"
    );
    assert.ok(log.includes("collab.store_failed"));
    assert.ok(!log.includes("collab.stored"));
    assert.equal(stored.length, 0);
    // Reopening with the retained client state requires a fresh admission.
    owner.provider.destroy();
    refuse = false;
    await until(
      () => server.hocuspocus.getDocumentsCount() === 0,
      "failed room to unload"
    );
    reconnected = new HocuspocusProvider({
      document: owner.doc,
      name: DOCUMENT,
      token: "editor-token",
      url: `ws://127.0.0.1:${server.address.port}`,
    });
    await until(
      () => stored.length > 0,
      "pending state to persist on reconnect"
    );
    const restored = new Y.Doc();
    try {
      Y.applyUpdate(restored, stored.at(-1)!.state);
      assert.equal(restored.getText("t").toString(), "pending client state");
    } finally {
      restored.destroy();
    }
  } finally {
    reconnected?.destroy();
    owner.provider.destroy();
    owner.doc.destroy();
    await server.destroy();
  }
});

test("a failed writer-token store refuses the update before broadcasting it", async () => {
  const { backend } = fakeBackend();
  const writers = memoryWriterTokens();
  const set = writers.set;
  let refuse = false;
  writers.set = async (documentName, token) => {
    if (refuse && token === "second-editor-token")
      throw new Error("writer store unavailable");
    await set(documentName, token);
  };
  const server = new Server({
    port: 0,
    quiet: true,
    ...collabHooks(backend, () => {}, writers),
  });
  await server.listen();
  const owner = connect(server.address.port, "editor-token");
  const member = connect(server.address.port, "second-editor-token");
  try {
    await until(
      () => owner.events.synced && member.events.synced,
      "both editors"
    );
    owner.doc.getText("t").insert(0, "original");
    await until(
      () => member.doc.getText("t").toString() === "original",
      "initial update"
    );
    refuse = true;
    member.doc.getText("t").insert(8, " must not broadcast");
    await until(() => member.events.closed, "failed writer to close");
    assert.equal(owner.doc.getText("t").toString(), "original");
    assert.equal(
      server.hocuspocus.documents.get(DOCUMENT)?.getText("t").toString(),
      "original"
    );
  } finally {
    for (const client of [owner, member]) {
      client.provider.destroy();
      client.doc.destroy();
    }
    await server.destroy();
  }
});

// Two replicas behind one Redis: an edit on one reaches a reader on the
// other, and the document is stored with the writer's token whichever
// replica wins the store lock. Needs a real Redis (COLLAB_TEST_REDIS_URL).
test(
  "replicas share edits and writer tokens through Redis",
  { skip: !process.env.COLLAB_TEST_REDIS_URL },
  async () => {
    const { Redis: RedisExtension } =
      await import("@hocuspocus/extension-redis");
    const { Redis } = await import("ioredis");
    const url = process.env.COLLAB_TEST_REDIS_URL ?? "";
    const { backend, stored, grants } = fakeBackend();
    const clients: InstanceType<typeof Redis>[] = [];
    const replica = async () => {
      const redis = new Redis(url);
      clients.push(redis);
      const server = new Server({
        debounce: 50,
        extensions: [
          new RedisExtension({
            createClient: () => {
              const client = new Redis(url, { enableReadyCheck: false });
              clients.push(client);
              return client;
            },
            prefix: `shots-collab-test-${process.pid}`,
          }),
        ],
        port: 0,
        quiet: true,
        ...collabHooks(backend, () => {}, redisWriterTokens(redis)),
      });
      await server.listen();
      return server;
    };
    const first = await replica();
    const second = await replica();
    const editor = connect(first.address.port, "editor-token");
    const viewer = connect(second.address.port, "viewer-token");
    try {
      await until(() => editor.events.synced && viewer.events.synced, "sync");
      editor.doc.getText("t").insert(0, "across replicas");
      await until(
        () => viewer.doc.getText("t").toString() === "across replicas",
        "the edit to cross replicas"
      );
      await until(() => stored.length > 0, "a store");
      assert.ok(stored.every(({ token }) => token === "editor-token"));
      delete grants["viewer-token"];
      editor.doc.getText("t").insert(0, "private ");
      await until(
        () => viewer.events.closed,
        "removed remote recipient to close"
      );
      assert.equal(viewer.doc.getText("t").toString(), "across replicas");
    } finally {
      editor.provider.destroy();
      viewer.provider.destroy();
      await Promise.all([first.destroy(), second.destroy()]);
      for (const client of clients) client.disconnect();
    }
  }
);

test("Story Sets share presence only and reauthorize membership on messages", async () => {
  const name = "creative-set:cstory00000001";
  const admitted = new Set(["alice", "bob"]);
  const backend: CollabBackend = {
    authorize: async (token, documentName) => {
      if (!admitted.has(token) || documentName !== name)
        throw new CollabBackendError("Member removed", 403);
      return {
        kind: "creative-set",
        access: "write",
        draftId: "cstory00000001",
        organizationId: "org",
        user: { id: token, name: token },
      };
    },
    load: async () => {
      assert.fail("Story content must not load through Yjs");
    },
    store: async () => {
      assert.fail("Story content must not save through Yjs");
    },
  };
  const server = new Server({
    port: 0,
    quiet: true,
    debounce: 50,
    ...collabHooks(backend, () => {}),
  });
  await server.listen();
  const alice = connect(server.address.port, "alice", name);
  const bob = connect(server.address.port, "bob", name);
  const stranger = connect(
    server.address.port,
    "alice",
    "creative-set:another000001"
  );
  try {
    await until(
      () => alice.events.synced && bob.events.synced,
      "set presence sync"
    );
    alice.provider.setAwarenessField("user", { name: "Alice" });
    await until(
      () =>
        [...bob.provider.awareness!.getStates().values()].some(
          (state) => state.user?.name === "Alice"
        ),
      "peer presence"
    );
    alice.doc.getText("content").insert(0, "must not propagate");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(bob.doc.getText("content").toString(), "");
    await until(() => stranger.events.failed !== "", "wrong set refused");
    admitted.delete("alice");
    alice.provider.setAwarenessField("user", { name: "Removed" });
    await until(() => alice.events.closed, "removed member disconnected");
    assert.ok(
      ![...bob.provider.awareness!.getStates().values()].some(
        (state) => state.user?.name === "Removed"
      )
    );
  } finally {
    for (const client of [alice, bob, stranger]) {
      client.provider.destroy();
      client.doc.destroy();
    }
    await server.destroy();
  }
});
