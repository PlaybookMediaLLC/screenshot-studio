/**
 * The collaboration server's hooks (RFC 037). Every decision is the Go
 * backend's: it authorizes each connection from the user's draft-scoped token,
 * and it loads and stores the Yjs state when that token is presented again.
 * This process holds no database credential and cannot open a draft by itself.
 */
import type {
  beforeHandleMessagePayload,
  onAuthenticatePayload,
  onLoadDocumentPayload,
  onRequestPayload,
  onStoreDocumentPayload,
} from "@hocuspocus/server";
import * as Y from "yjs";

/** What the backend grants a connection. */
export type CollabGrant = {
  kind?: "content-draft" | "creative-set";
  access: "read" | "write";
  draftId: string;
  organizationId: string;
  user: { id: string; name: string };
};

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
      headers: {
        authorization: `Bearer ${serviceToken}`,
        "content-type": "application/json",
        ...(init.token ? { "x-collab-token": init.token } : {}),
      },
    });
    const body = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!response.ok) {
      throw new CollabBackendError(
        String(body?.error ?? `backend answered ${response.status}`),
        response.status
      );
    }
    return body ?? {};
  };
  return {
    authorize: async (token, documentName) =>
      (await call("/v1/collab/authorize", {
        body: JSON.stringify({ documentName, token }),
        method: "POST",
      })) as CollabGrant,
    load: async (draftId, token) => {
      const { state } = await call(
        `/v1/collab/documents/${encodeURIComponent(draftId)}`,
        {
          method: "GET",
          token,
        }
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

type Context = { grant: CollabGrant; token: string };

/** The Hocuspocus hooks that route every decision through the backend. */
export function collabHooks(
  backend: CollabBackend,
  log: Log,
  writers: WriterTokens = memoryWriterTokens()
) {
  return {
    async onAuthenticate({
      connectionConfig,
      documentName,
      token,
    }: onAuthenticatePayload): Promise<Context> {
      if (!draftIdOf(documentName) && !/^creative-set:[a-z0-9-]{10,40}$/i.test(documentName)) {
        log("collab.refused", { documentName, reason: "unknown document" });
        throw new Error("Unknown document.");
      }
      try {
        const grant = await backend.authorize(token, documentName);
        connectionConfig.readOnly = grant.kind === "creative-set" || grant.access !== "write";
        if (grant.kind !== "creative-set" && grant.access === "write") await writers.set(documentName, token);
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

    async beforeHandleMessage({ context, documentName, connection }: beforeHandleMessagePayload) {
      const { grant, token } = context as Context;
      if (grant.kind !== "creative-set") return;
      // Presence never carries document changes; revision writes use the Go API.
      connection.readOnly = true;
      await backend.authorize(token, documentName);
    },

    async onLoadDocument({
      context,
      document,
      documentName,
    }: onLoadDocumentPayload) {
      const { grant, token } = context as Context;
      if (grant.kind === "creative-set") return document;
      const state = await backend.load(grant.draftId, token);
      if (state) Y.applyUpdate(document, state);
      log("collab.loaded", { bytes: state?.byteLength ?? 0, documentName });
      return document;
    },

    async onStoreDocument({ document, documentName }: onStoreDocumentPayload) {
      const draftId = draftIdOf(documentName);
      const token = await writers.get(documentName);
      if (!draftId || !token) return;
      await backend.store(draftId, token, Y.encodeStateAsUpdate(document));
      log("collab.stored", { documentName });
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
