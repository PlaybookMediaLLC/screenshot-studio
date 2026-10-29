/**
 * The collaboration server's hooks (RFC 013). Every decision is the Go
 * backend's: it authorizes each connection from the user's draft-scoped token,
 * and it loads and stores the Yjs state when that token is presented again.
 * This process holds no database credential and cannot open a draft by itself.
 */
import type {
  beforeHandleMessagePayload,
  connectedPayload,
  onAuthenticatePayload,
  onLoadDocumentPayload,
  onRequestPayload,
  onStoreDocumentPayload,
} from "@hocuspocus/server";
import { IncomingMessage, MessageType } from "@hocuspocus/server";
import * as Y from "yjs";
import { z } from "zod";
import { protectConnection } from "./access.ts";

/** Validated backend authority for one document and user. */
export const collabGrantSchema = z.object({
  kind: z.enum(["content-draft", "creative-set"]).optional(),
  access: z.enum(["read", "write"]),
  draftId: z.string().min(1),
  organizationId: z.string().min(1),
  user: z.object({ id: z.string().min(1), name: z.string() }),
});

/** What the backend grants a connection. */
export type CollabGrant = z.infer<typeof collabGrantSchema>;

/** The backend's counts of changes that can alter collaboration access. */
export const collabEpochsSchema = z.object({
  global: z.number(),
  organizations: z.record(z.string(), z.number()),
});

/** Access counts: one for every workspace, and one per workspace asked for. */
export type CollabEpochs = z.infer<typeof collabEpochsSchema>;

/** The Go backend's collaboration routes. */
export type CollabBackend = {
  authorize: (token: string, documentName: string) => Promise<CollabGrant>;
  epochs: (organizationIds: string[]) => Promise<CollabEpochs>;
  load: (draftId: string, token: string) => Promise<Uint8Array | null>;
  store: (draftId: string, token: string, state: Uint8Array) => Promise<void>;
};

/** A refused call, with the backend's status. */
export class CollabBackendError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CollabBackendError";
    this.status = status;
  }
}

const DOCUMENT_PREFIX = "content-draft:";

/** The draft a document name is for, or null for any other name. */
export function draftIdOf(documentName: string): string | null {
  const id = documentName.startsWith(DOCUMENT_PREFIX)
    ? documentName.slice(DOCUMENT_PREFIX.length)
    : "";
  const match = /^([a-z0-9-]{10,40})(?::[1-9][0-9]{0,9})?$/i.exec(id);
  return match?.[1] ?? null;
}

/** A client for the backend, authenticated with the collaboration credential. */
export function backendClient(
  baseUrl: string,
  serviceToken: string,
  fetchImpl: typeof fetch = fetch
): CollabBackend {
  const call = async (path: string, init: RequestInit & { token?: string }) => {
    const response = await fetchImpl(new URL(path, baseUrl), {
      ...init,
      signal: AbortSignal.timeout(5_000),
      headers: {
        authorization: `Bearer ${serviceToken}`,
        "content-type": "application/json",
        ...(init.token ? { "x-collab-token": init.token } : {}),
      },
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new CollabBackendError(
        "Collaboration access is unavailable.",
        response.status
      );
    }
    return body ?? {};
  };
  return {
    authorize: async (token, documentName) =>
      collabGrantSchema.parse(
        await call("/v1/collab/authorize", {
          body: JSON.stringify({ documentName, token }),
          method: "POST",
        })
      ),
    epochs: async (organizationIds) =>
      collabEpochsSchema.parse(
        await call(
          `/v1/collab/epochs?${new URLSearchParams(
            organizationIds.map((id) => ["organizationId", id])
          )}`,
          { method: "GET" }
        )
      ),
    load: async (draftId, token) => {
      const { state } = z.object({ state: z.string().nullable() }).parse(
        await call(`/v1/collab/documents/${encodeURIComponent(draftId)}`, {
          method: "GET",
          token,
        })
      );
      return typeof state === "string" ? Buffer.from(state, "base64") : null;
    },
    store: async (draftId, token, state) => {
      await call(`/v1/collab/documents/${encodeURIComponent(draftId)}`, {
        body: JSON.stringify({ state: Buffer.from(state).toString("base64") }),
        method: "PUT",
        token,
      });
    },
  };
}

type Log = (event: string, fields: Record<string, unknown>) => void;

/**
 * The newest read-write token per document. A store runs after a debounce,
 * possibly after its connection left, so it uses the last writer's token.
 * With several replicas the store can run on any of them (the Redis
 * extension picks one by lock), so the tokens must be shared too.
 */
export type WriterTokens = {
  get: (documentName: string) => Promise<string | undefined>;
  set: (documentName: string, token: string) => Promise<void>;
};

/** Writer tokens for a single replica. */
export function memoryWriterTokens(): WriterTokens {
  const tokens = new Map<string, string>();
  return {
    get: async (documentName) => tokens.get(documentName),
    set: async (documentName, token) => {
      tokens.set(documentName, token);
    },
  };
}

/** How long a writer token is kept: the backend's store grace for a token. */
const WRITER_TOKEN_TTL_SECONDS = 12 * 60 * 60;

/** Writer tokens shared by every replica through Redis. */
export function redisWriterTokens(redis: {
  get: (key: string) => Promise<string | null>;
  set: (
    key: string,
    value: string,
    mode: "EX",
    seconds: number
  ) => Promise<unknown>;
}): WriterTokens {
  const key = (documentName: string) => `shots-collab:writer:${documentName}`;
  return {
    get: async (documentName) =>
      (await redis.get(key(documentName))) ?? undefined,
    set: async (documentName, token) => {
      await redis.set(key(documentName), token, "EX", WRITER_TOKEN_TTL_SECONDS);
    },
  };
}

/** The access counts a decision was made against, and when. */
const checkSchema = z.object({
  global: z.number(),
  organization: z.number(),
  at: z.number(),
});
type Check = z.infer<typeof checkSchema>;

const contextSchema = z.object({
  grant: collabGrantSchema,
  token: z.string().min(1),
  admitted: checkSchema.optional(),
});
type Context = z.infer<typeof contextSchema>;

type Connection = connectedPayload["connection"];

/**
 * The Hocuspocus hooks that route every decision through the backend.
 *
 * A connection is authorized when it opens (onAuthenticate). After that it is
 * authorized again only when access may have changed: the backend publishes a
 * count per workspace, and one for every workspace, that moves with each
 * change that can take access away (a removed or demoted member, an ended
 * session, a replaced or deleted draft). The counts are polled every `pollMs`
 * while connections are open; a move re-checks that workspace's connections
 * at once, and any connection is re-checked after `recheckMs` regardless.
 */
export function collabHooks(
  backend: CollabBackend,
  log: Log,
  writers: WriterTokens = memoryWriterTokens(),
  {
    pollMs = 1_000,
    recheckMs = 60_000,
  }: { pollMs?: number; recheckMs?: number } = {}
) {
  const known = { global: 0, organizations: new Map<string, number>() };
  const checks = new WeakMap<Connection, Check>();
  type Open = {
    connection: Connection;
    context: unknown;
    documentName: string;
  };
  const open = new Map<string, Set<Open>>();
  let timer: ReturnType<typeof setInterval> | null = null;
  const snapshot = (organizationId: string): Check => ({
    global: known.global,
    organization: known.organizations.get(organizationId) ?? 0,
    at: Date.now(),
  });
  const unchanged = (check: Check | undefined, organizationId: string) =>
    !!check &&
    check.global === known.global &&
    check.organization === (known.organizations.get(organizationId) ?? 0) &&
    Date.now() - check.at < recheckMs;
  const currentAccess = async (
    value: unknown,
    documentName: string,
    connection: Connection
  ) => {
    const { grant: original, token } = contextSchema.parse(value);
    if (unchanged(checks.get(connection), original.organizationId)) return;
    // Taken before the request: a change published while it runs is seen next time.
    const next = snapshot(original.organizationId);
    const grant = await backend.authorize(token, documentName);
    if (
      grant.draftId !== original.draftId ||
      grant.organizationId !== original.organizationId ||
      grant.user.id !== original.user.id ||
      grant.kind !== original.kind
    ) {
      throw new CollabBackendError("Collaboration authority changed.", 403);
    }
    // A delayed grant must never undo an already observed demotion. A later
    // upgrade takes effect on a new connection with a newly issued token.
    connection.readOnly =
      connection.readOnly ||
      grant.kind === "creative-set" ||
      grant.access !== "write";
    checks.set(connection, next);
  };
  const recheck = ({ connection, context, documentName }: Open) => {
    currentAccess(context, documentName, connection).catch((error: unknown) => {
      log("collab.revoked", {
        documentName,
        status: error instanceof CollabBackendError ? error.status : 0,
      });
      connection.close({
        code: 4403,
        reason: "Document access is no longer available.",
      });
    });
  };
  const poll = async () => {
    if (open.size === 0) {
      if (timer) clearInterval(timer);
      timer = null;
      return;
    }
    try {
      const counts = await backend.epochs([...open.keys()]);
      const moved = new Set<string>();
      if (counts.global !== known.global) {
        for (const id of open.keys()) moved.add(id);
      }
      known.global = counts.global;
      for (const [id, count] of Object.entries(counts.organizations)) {
        if ((known.organizations.get(id) ?? 0) !== count) moved.add(id);
        known.organizations.set(id, count);
      }
      // Pushed revocation: an idle reader loses access without waiting for a frame.
      for (const id of moved)
        for (const entry of open.get(id) ?? []) recheck(entry);
    } catch (error) {
      log("collab.epochs_failed", {
        status: error instanceof CollabBackendError ? error.status : 0,
      });
    }
  };
  const track = (entry: Open, organizationId: string) => {
    const entries = open.get(organizationId) ?? new Set<Open>();
    entries.add(entry);
    open.set(organizationId, entries);
    entry.connection.onClose(() => {
      entries.delete(entry);
      if (entries.size === 0) open.delete(organizationId);
    });
    if (!timer) {
      timer = setInterval(() => void poll(), pollMs);
      timer.unref?.();
    }
  };
  const protect = (
    value: unknown,
    documentName: string,
    connection: connectedPayload["connection"]
  ) => {
    protectConnection(connection, () =>
      currentAccess(value, documentName, connection)
    );
  };
  return {
    async onAuthenticate({
      connectionConfig,
      documentName,
      token,
    }: onAuthenticatePayload): Promise<Context> {
      if (
        !draftIdOf(documentName) &&
        !/^creative-set:[a-z0-9-]{10,40}$/i.test(documentName)
      ) {
        log("collab.refused", { documentName, reason: "unknown document" });
        throw new Error("Unknown document.");
      }
      try {
        // The counts as they stand before the request: a change published while
        // it runs moves the workspace past this, so the next message re-checks.
        const before = {
          at: Date.now(),
          global: known.global,
          organizations: new Map(known.organizations),
        };
        const grant = await backend.authorize(token, documentName);
        const admitted: Check = {
          at: before.at,
          global: before.global,
          organization: before.organizations.get(grant.organizationId) ?? 0,
        };
        connectionConfig.readOnly =
          grant.kind === "creative-set" || grant.access !== "write";
        log("collab.admitted", {
          access: grant.access,
          documentName,
          organizationId: grant.organizationId,
          userId: grant.user.id,
        });
        return { grant, token, admitted };
      } catch (error) {
        log("collab.refused", {
          documentName,
          reason: error instanceof Error ? error.message : "unknown",
          status: error instanceof CollabBackendError ? error.status : 0,
        });
        throw error;
      }
    },

    async connected({ context, documentName, connection }: connectedPayload) {
      const { admitted, grant } = contextSchema.parse(context);
      if (admitted) checks.set(connection, admitted);
      track({ connection, context, documentName }, grant.organizationId);
      protect(context, documentName, connection);
    },

    async onDestroy() {
      if (timer) clearInterval(timer);
      timer = null;
    },

    async beforeHandleMessage({
      context,
      documentName,
      connection,
      update,
    }: beforeHandleMessagePayload) {
      protect(context, documentName, connection);
      await currentAccess(context, documentName, connection);
      if (connection.readOnly) return;
      // Hocuspocus 3 does not await beforeSync. Keep all async authority and
      // writer-token work in this awaited hook, before the update is applied.
      const message = new IncomingMessage(update);
      message.readVarString();
      const type = message.readVarUint();
      if (type !== MessageType.Sync && type !== MessageType.SyncReply) return;
      const syncType = message.readVarUint();
      if (syncType !== 1 && syncType !== 2) return;
      const { token } = contextSchema.parse(context);
      // Read the shared store: another replica may have changed the writer.
      if ((await writers.get(documentName)) !== token) {
        await writers.set(documentName, token);
      }
    },

    async onLoadDocument({
      context,
      document,
      documentName,
    }: onLoadDocumentPayload) {
      const { grant, token } = contextSchema.parse(context);
      if (grant.kind === "creative-set") return document;
      const state = await backend.load(grant.draftId, token);
      if (state) Y.applyUpdate(document, state);
      log("collab.loaded", { bytes: state?.byteLength ?? 0, documentName });
      return document;
    },

    async onStoreDocument({ document, documentName }: onStoreDocumentPayload) {
      const draftId = draftIdOf(documentName);
      if (!draftId) return;
      try {
        const token = await writers.get(documentName);
        if (!token) return;
        await backend.store(draftId, token, Y.encodeStateAsUpdate(document));
        log("collab.stored", { documentName });
      } catch (error) {
        log("collab.store_failed", {
          documentName,
          status: error instanceof CollabBackendError ? error.status : 0,
        });
        for (const connection of document.getConnections()) {
          connection.close({
            code: 1013,
            reason: "Document save unavailable. Reconnect to retry.",
          });
        }
        // Hocuspocus's debounced store does not handle rejected Error objects.
        // Its silent rejection convention skips afterStoreDocument without an
        // unhandled rejection taking down every room. The client's existing
        // local Yjs persistence resubmits pending edits after fresh admission.
        throw null;
      }
    },

    async onRequest({ request, response }: onRequestPayload) {
      if (request.url === "/health") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"status":"ok"}');
        // Hocuspocus treats a rejection as "handled": no default response.
        throw null;
      }
    },
  };
}
