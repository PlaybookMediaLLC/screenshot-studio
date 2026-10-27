import { describe, expect, it } from "../../test/bun-test-compat";
import {
  editorActionForTool,
  EditorProposalSchema,
  editorToolForAction,
} from "./ai-editor";

describe("editor AI proposal contract", () => {
  it("maps the three editor actions to Plate tools", () => {
    expect(editorActionForTool("edit")).toBe("replace_selection");
    expect(editorActionForTool("generate")).toBe("insert_blocks");
    expect(editorActionForTool("comment")).toBe("add_comment");
    expect(editorToolForAction("add_comment")).toBe("comment");
  });

  it("rejects empty and oversized proposal content", () => {
    expect(
      EditorProposalSchema.safeParse({
        action: "replace_selection",
        content: "",
      }).success
    ).toBe(false);
    expect(
      EditorProposalSchema.safeParse({
        action: "insert_blocks",
        content: "x".repeat(20_001),
      }).success
    ).toBe(false);
  });
});
