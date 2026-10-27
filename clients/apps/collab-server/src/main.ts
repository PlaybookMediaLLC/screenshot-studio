/**
 * Runs the collaboration server. Configuration comes from the environment:
 * PORT, COLLAB_BACKEND_URL (the Go backend), COLLAB_SERVICE_TOKEN (the
 * credential that opens only the backend's collaboration routes) and,
 * to run more than one replica, COLLAB_REDIS_URL.
 */
import { Redis as RedisExtension } from "@hocuspocus/extension-redis";
import { Server } from "@hocuspocus/server";
import { Redis } from "ioredis";
import {
  backendClient,
  collabHooks,
  memoryWriterTokens,
  redisWriterTokens,
} from "./collab.ts";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set.`);
  return value;
};

const log = (event: string, fields: Record<string, unknown>) =>
  console.warn(
    JSON.stringify({ event, ...fields, time: new Date().toISOString() })
  );

// With Redis, replicas relay document updates and awareness to each other,
// and one of them (by lock) stores each document. Redis carries live Yjs
// updates and writer tokens only; the backend still holds every draft.
const redisUrl = process.env.COLLAB_REDIS_URL;
const redis = redisUrl ? new Redis(redisUrl) : null;

const server = new Server({
  debounce: 2_000,
  maxDebounce: 10_000,
  name: "shots-collab",
  port: Number(process.env.PORT ?? 1234),
  quiet: true,
  extensions: redisUrl
    ? [
        new RedisExtension({
          // The extension subscribes at once; ioredis's ready check would
          // then send INFO on a subscriber connection, which Redis refuses.
          createClient: () => new Redis(redisUrl, { enableReadyCheck: false }),
          prefix: "shots-collab",
        }),
      ]
    : [],
  ...collabHooks(
    backendClient(
      required("COLLAB_BACKEND_URL"),
      required("COLLAB_SERVICE_TOKEN")
    ),
    log,
    redis ? redisWriterTokens(redis) : memoryWriterTokens()
  ),
});

await server.listen();
log("collab.listening", { port: server.configuration.port });
