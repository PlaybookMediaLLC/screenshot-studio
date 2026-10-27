"use client";

import { TabbablePlugin } from "@platejs/tabbable/react";
import { KEYS } from "platejs";

const TAB_HANDLED_BLOCK_TYPES = new Set<string>([
  KEYS.codeBlock,
  KEYS.li,
  KEYS.listTodoClassic,
  KEYS.table,
]);

export const TabbableKit = TabbablePlugin.configure(({ editor }) => ({
  node: {
    isElement: true,
  },
  options: {
    query: () => {
      if (editor.api.isAt({ start: true }) || editor.api.isAt({ end: true })) {
        return false;
      }

      return !editor.api.some({
        match: (node) =>
          Boolean(
            (node.type && TAB_HANDLED_BLOCK_TYPES.has(String(node.type))) ||
              node.listStyleType
          ),
      });
    },
  },
  override: {
    enabled: {
      indent: false,
    },
  },
}));
