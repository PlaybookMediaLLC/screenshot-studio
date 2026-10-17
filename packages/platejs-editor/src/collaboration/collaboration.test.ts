import { expect, test } from "../../test/bun-test-compat";
import { assertPrivateSignaling } from "./index";

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
