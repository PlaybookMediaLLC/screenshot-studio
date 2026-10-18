import { describe, expect, it } from "../../test/bun-test-compat";
import type { Value } from "platejs";
import { getCopilotContext } from "./copilot-context";

const value: Value = [
  { children: [{ text: "Quarterly plan" }], type: "h1" },
  { children: [{ text: "Revenue" }], type: "h2" },
  { children: [{ text: "Growth accelerated" }], type: "p" },
  { children: [{ text: "Margins improved" }], type: "p" },
];

describe("getCopilotContext", () => {
  it("returns title, heading path, and adjacent blocks", () => {
    const context = getCopilotContext(value, 2);

    expect(context?.title).toBe("Quarterly plan");
    expect(context?.headingPath).toEqual(["Quarterly plan", "Revenue"]);
    expect(context?.previous).toEqual(value[1]);
    expect(context?.current).toEqual(value[2]);
    expect(context?.next).toEqual(value[3]);
  });

  it("returns null when the current top-level node does not exist", () => {
    expect(getCopilotContext(value, 99)).toBeNull();
  });
});
