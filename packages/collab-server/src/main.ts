/**
 * Runs the collaboration server. Configuration comes from the environment:
 * PORT, COLLAB_BACKEND_URL (the Go backend) and COLLAB_SERVICE_TOKEN (the
 * credential that opens only the backend's collaboration routes).
 */
import { Server } from "@hocuspocus/server";
import { backendClient, collabHooks } from "./collab.ts";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set.`);
  return value;
};

const log = (event: string, fields: Record<string, unknown>) =>
  console.warn(
    JSON.stringify({ event, ...fields, time: new Date().toISOString() })
  );

const server = new Server({
  debounce: 2_000,
  maxDebounce: 10_000,
  name: "shots-collab",
  port: Number(process.env.PORT ?? 1234),
  quiet: true,
  ...collabHooks(
    backendClient(
      required("COLLAB_BACKEND_URL"),
      required("COLLAB_SERVICE_TOKEN")
    ),
    log
  ),
});

await server.listen();
log("collab.listening", { port: server.configuration.port });
