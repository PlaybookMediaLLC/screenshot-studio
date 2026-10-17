"use client";

import { CopilotPlugin } from "@platejs/ai/react";
import { serializeMd, stripMarkdown } from "@platejs/markdown";
import type { TElement } from "platejs";

import { GhostText } from "../ui/ghost-text";
import { getCopilotContext } from "../lib/copilot-context";

import { MarkdownKit } from "./markdown-kit";

const MAX_CONTEXT_BLOCK_CHARS = 1800;

const serializeContextBlock = (
  editor: Parameters<typeof serializeMd>[0],
  node?: TElement
): string => {
  if (!node) return "(none)";
  return serializeMd(editor, { value: [node] })
    .trim()
    .slice(0, MAX_CONTEXT_BLOCK_CHARS);
};

const getCopilotPrompt = (
  editor: Parameters<typeof serializeMd>[0]
): string => {
  const blockEntry = editor.api.block({ highest: true });
  const currentIndex = blockEntry?.[1][0];
  if (currentIndex === undefined) return "";

  const context = getCopilotContext(editor.children, currentIndex);
  if (!context) return "";

  return [
    "Continue Current block through the next punctuation mark.",
    `Document title: ${context.title ?? "Untitled"}`,
    `Heading path: ${context.headingPath.join(" > ") || "(none)"}`,
    `Previous block:\n${serializeContextBlock(editor, context.previous)}`,
    `Current block:\n${serializeContextBlock(editor, context.current)}`,
    `Next block:\n${serializeContextBlock(editor, context.next)}`,
  ].join("\n\n");
};

export const CopilotKit = [
  ...MarkdownKit,
  CopilotPlugin.configure(({ api }) => ({
    options: {
      completeOptions: {
        api: "/api/ai/copilot",
        onFinish: (_, completion) => {
          if (completion === "0") return;

          api.copilot.setBlockSuggestion({
            text: stripMarkdown(completion),
          });
        },
      },
      debounceDelay: 500,
      renderGhostText: GhostText,
      getPrompt: ({ editor }) => getCopilotPrompt(editor),
    },
    shortcuts: {
      accept: {
        keys: "tab",
      },
      acceptNextWord: {
        keys: "mod+right",
      },
      reject: {
        keys: "escape",
      },
      triggerSuggestion: {
        keys: "ctrl+space",
      },
    },
  })),
];
