import "server-only";
import { createClient, type RedisClientType } from "redis";

const REDIS_CONNECT_TIMEOUT_MS = 1_000;

let redisClient: RedisClientType | undefined;
let connecting: Promise<RedisClientType> | undefined;

function createRedisClient(): RedisClientType {
  const url = process.env.REDIS_URL;

  if (!url) {
    throw new Error("REDIS_URL is required for rate limiting.");
  }

  const client = createClient({
    socket: { connectTimeout: REDIS_CONNECT_TIMEOUT_MS, reconnectStrategy: false },
    url,
  });

  client.on("error", () => undefined);
  return client;
}

export async function getRedisClient(): Promise<RedisClientType> {
  if (redisClient?.isReady) {
    return redisClient;
  }

  connecting ??= createRedisClient().connect().then((client) => {
    redisClient = client;
    return client;
  }).finally(() => {
    connecting = undefined;
  });

  return connecting;
}
