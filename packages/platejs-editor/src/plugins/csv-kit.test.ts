import { expect, test } from "../../test/bun-test-compat";
import { createSlateEditor, NodeApi } from "platejs";

import { BaseBasicBlocksKit } from "./basic-blocks-base-kit";
import { CsvKit, CsvPlugin } from "./csv-kit";
import { BaseTableKit } from "./table-base-kit";

test("CSV deserialization produces a Plate table with headers and rows", () => {
  const editor = createSlateEditor({
    plugins: [...BaseBasicBlocksKit, ...BaseTableKit, ...CsvKit],
  });
  const value = editor.getApi(CsvPlugin).csv.deserialize({
    data: "Customer,Amount\nAcme,1250\nGlobex,890\n",
  });
  const table = value?.find((node) => "type" in node && node.type === "table");

  expect(table).toBeDefined();
  expect(NodeApi.string(table as never)).toContain("Acme1250");
  expect(NodeApi.string(table as never)).toContain("Globex890");
});
