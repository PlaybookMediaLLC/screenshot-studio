import { expect, test } from "../../test/bun-test-compat";
import { BaseTagPlugin } from "@platejs/tag";
import { createSlateEditor, KEYS } from "platejs";

test("inserts a tag value when a multi-select option is selected", () => {
  const editor = createSlateEditor({
    plugins: [BaseTagPlugin],
    selection: {
      anchor: { offset: 0, path: [0, 0] },
      focus: { offset: 0, path: [0, 0] },
    },
    value: [{ type: KEYS.p, children: [{ text: "" }] }],
  });

  editor.getTransforms(BaseTagPlugin).insert.tag({ value: "Finance" });

  expect(
    editor.api.some({
      at: [],
      match: (node) => node.type === KEYS.tag && node.value === "Finance",
    })
  ).toBe(true);
});
