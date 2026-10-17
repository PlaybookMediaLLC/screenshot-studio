"use client";

import { TrailingBlockPlugin } from "platejs";
import { BasicBlocksKit } from "../plugins/basic-blocks-kit";
import { BasicMarksKit } from "../plugins/basic-marks-kit";
import { CalloutKit } from "../plugins/callout-kit";
import { FloatingToolbarKit } from "../plugins/floating-toolbar-kit";
import { LinkKit } from "../plugins/link-kit";
import { ListKit } from "../plugins/list-kit";
import { MarkdownKit } from "../plugins/markdown-kit";
import { MediaKit } from "../plugins/media-kit";
import { MentionKit } from "../plugins/mention-kit";
import { SlashKit } from "../plugins/slash-kit";
import { TableKit } from "../plugins/table-kit";

export type ComposerVariant =
  | "composer-email"
  | "composer-portal"
  | "composer-note";

const baseComposerKit = [
  ...BasicBlocksKit,
  ...BasicMarksKit,
  ...ListKit,
  ...LinkKit,
  ...MarkdownKit,
  ...FloatingToolbarKit,
  ...SlashKit,
  TrailingBlockPlugin,
];

export const ComposerEditorKit = {
  "composer-email": [
    ...baseComposerKit,
    ...MediaKit,
    ...TableKit,
    ...CalloutKit,
    ...MentionKit,
  ],
  "composer-portal": [...baseComposerKit, ...MediaKit, ...CalloutKit],
  "composer-note": [...baseComposerKit, ...MentionKit, ...CalloutKit],
} as const;

export function getComposerEditorPlugins(variant: ComposerVariant) {
  return ComposerEditorKit[variant];
}
