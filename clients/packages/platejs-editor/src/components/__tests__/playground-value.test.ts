import type { Descendant } from "platejs";
import { describe, expect, it } from "../../../test/bun-test-compat";

import { playgroundValue } from "../../examples/playground-value";

const collectElementIds = (nodes: Descendant[]): string[] => {
  const ids: string[] = [];

  for (const node of nodes) {
    if ("text" in node) {
      continue;
    }

    ids.push(typeof node.id === "string" ? node.id : "");
    ids.push(...collectElementIds(node.children));
  }

  return ids;
};

describe("playgroundValue", () => {
  it("provides stable, unique IDs for server and client rendering", () => {
    const ids = collectElementIds(playgroundValue);

    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id.startsWith("playground-"))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
