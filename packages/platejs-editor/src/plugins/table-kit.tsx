"use client";

import {
  getNextTableCell,
  getPreviousTableCell,
  getTableEntries,
} from "@platejs/table";
import {
  TableCellHeaderPlugin,
  TableCellPlugin,
  TablePlugin,
  TableRowPlugin,
} from "@platejs/table/react";
import { createPlatePlugin } from "platejs/react";

import {
  TableCellElement,
  TableCellHeaderElement,
  TableElement,
  TableRowElement,
} from "../ui/table-node";

/**
 * Tab / Shift+Tab moves the caret to the next / previous table cell, selecting
 * its content (Notion-style). At the last cell, a forward Tab appends a row and
 * lands in its first cell.
 *
 * `@platejs/table` only binds Shift+Arrow (cell-selection extension) — it never
 * handles Tab. An earlier plugin in the pipeline `preventDefault`s Tab (so the
 * browser doesn't move focus) but does no cell navigation, which left every
 * cell's text concatenating into the first one. This handler still runs (Plate
 * dispatches every `onKeyDown` regardless of `defaultPrevented`), so it does
 * the actual navigation; a no-op outside a table lets Tab fall through.
 */
const TableTabNavigationPlugin = createPlatePlugin({
  key: "table-tab-navigation",
  handlers: {
    onKeyDown: ({ editor, event }) => {
      if (event.key !== "Tab") {
        return;
      }
      const entries = getTableEntries(editor);
      if (!entries) {
        return;
      }
      const { cell, row } = entries;
      const [, cellPath] = cell;
      const target = event.shiftKey
        ? getPreviousTableCell(editor, cell, cellPath, row)
        : getNextTableCell(editor, cell, cellPath, row);

      event.preventDefault();
      event.stopPropagation();

      if (target) {
        editor.tf.select(editor.api.start(target[1]));
        return;
      }
      // Forward Tab past the last cell appends a row and lands in its first
      // cell (Notion-style). `insert.tableRow` is registered by TablePlugin at
      // runtime but isn't on this generic editor's transform type, so reach it
      // defensively. Backward Tab at the first cell simply stays put.
      if (!event.shiftKey) {
        const insert = (
          editor.tf as { insert?: { tableRow?: () => void } }
        ).insert;
        insert?.tableRow?.();
        // The new row now exists after the current one, so the "next cell"
        // is its first cell — move the caret there.
        const after = getTableEntries(editor);
        if (after) {
          const newCell = getNextTableCell(
            editor,
            after.cell,
            after.cell[1],
            after.row
          );
          if (newCell) {
            editor.tf.select(editor.api.start(newCell[1]));
          }
        }
      }
    },
  },
});

export const TableKit = [
  TableTabNavigationPlugin,
  TablePlugin.withComponent(TableElement),
  TableRowPlugin.withComponent(TableRowElement),
  TableCellPlugin.withComponent(TableCellElement),
  TableCellHeaderPlugin.withComponent(TableCellHeaderElement),
];
