/**
 * The collaboration server's hooks (RFC 037). Every decision is the Go
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

/** The Go backend's collaboration routes. */
export type CollabBackend = {
  authorize: (token: string, documentName: string) => Promise<CollabGrant>;
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
  return /^[a-z0-9-]{10,40}$/i.test(id) ? id : null;
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

const contextSchema = z.object({
  grant: collabGrantSchema,
  token: z.string().min(1),
});
type Context = z.infer<typeof contextSchema>;

/** The Hocuspocus hooks that route every decision through the backend. */
export function collabHooks(
  backend: CollabBackend,
  log: Log,
  writers: WriterTokens = memoryWriterTokens()
) {
  const currentAccess = async (
    value: unknown,
    documentName: string,
    connection: connectedPayload["connection"]
  ) => {
    const { grant: original, token } = contextSchema.parse(value);
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
        const grant = await backend.authorize(token, documentName);
        connectionConfig.readOnly =
          grant.kind === "creative-set" || grant.access !== "write";
        log("collab.admitted", {
          access: grant.access,
          documentName,
          organizationId: grant.organizationId,
          userId: grant.user.id,
        });
        return { grant, token };
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
      protect(context, documentName, connection);
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
