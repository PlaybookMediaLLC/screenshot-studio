/**
 * The subset of the `bun:test` API the vendored tests use, on `node:test`.
 * Keeping the upstream call shapes means a test pulled from oppulence-canvas
 * changes only its import line (see UPSTREAM.md).
 */
import assert from "node:assert/strict";
import {
  after,
  before,
  describe,
  it as nodeIt,
  test as nodeTest,
} from "node:test";

type Body = () => unknown;

const withTimeout =
  (run: typeof nodeTest) =>
  (name: string, body: Body, timeout?: number): void => {
    void run(name, { timeout }, async () => {
      await body();
    });
  };

export const test = withTimeout(nodeTest);
export const it = withTimeout(nodeIt);
export { describe };
export const beforeAll = (body: Body, timeout?: number) =>
  before(async () => void (await body()), { timeout });
export const afterAll = (body: Body, timeout?: number) =>
  after(async () => void (await body()), { timeout });

function contains(actual: unknown, expected: unknown): boolean {
  if (typeof actual === "string") return actual.includes(String(expected));
  if (Array.isArray(actual)) return actual.includes(expected);
  throw new TypeError(
    `toContain expects a string or an array, got ${typeof actual}`
  );
}

function matchers(actual: unknown, negate: boolean) {
  const check = (pass: boolean, message: string) =>
    assert.ok(negate ? !pass : pass, negate ? `not: ${message}` : message);
  return {
    toBe: (expected: unknown) =>
      check(
        Object.is(actual, expected),
        `expected ${String(actual)} to be ${String(expected)}`
      ),
    toBeDefined: () => check(actual !== undefined, "expected a defined value"),
    toBeGreaterThan: (expected: number) =>
      check(
        (actual as number) > expected,
        `expected ${String(actual)} > ${expected}`
      ),
    toBeNull: () =>
      check(actual === null, `expected ${String(actual)} to be null`),
    toContain: (expected: unknown) =>
      check(
        contains(actual, expected),
        `expected value to contain ${String(expected)}`
      ),
    toEqual: (expected: unknown) => {
      let equal = true;
      try {
        assert.deepStrictEqual(actual, expected);
      } catch {
        equal = false;
      }
      check(
        equal,
        `expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`
      );
    },
    toMatch: (expected: RegExp | string) =>
      check(
        typeof expected === "string"
          ? String(actual).includes(expected)
          : expected.test(String(actual)),
        `expected ${String(actual)} to match ${String(expected)}`
      ),
  };
}

export function expect(actual: unknown) {
  return { ...matchers(actual, false), not: matchers(actual, true) };
}
