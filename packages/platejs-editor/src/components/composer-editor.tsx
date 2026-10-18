"use client";

import { Bold, Italic, Underline } from "lucide-react";
import type { Value } from "platejs";
import { KEYS } from "platejs";
import type { PlateEditor } from "platejs/react";
import { Plate, usePlateEditor } from "platejs/react";
import type { KeyboardEventHandler, ReactNode } from "react";
import React from "react";
import { Editor, EditorContainer } from "../ui/editor";
import { FloatingToolbar } from "../ui/floating-toolbar";
import { LinkToolbarButton } from "../ui/link-toolbar-button";
import { MarkToolbarButton } from "../ui/mark-toolbar-button";
import { Toolbar } from "../ui/toolbar";
import { TurnIntoToolbarButton } from "../ui/turn-into-toolbar-button";
import { type ComposerVariant, getComposerEditorPlugins } from "./composer-kit";

export type ComposerMentionUser = {
  id: string;
  email?: string;
  name: string;
  profileImageUrl?: string;
};

export type ComposerSlashItem = {
  value: string;
  label?: string;
  description?: string;
  keywords?: string[];
  focusEditor?: boolean;
  icon: ReactNode;
  onSelect: (editor: PlateEditor, value: string) => void;
};

export type ComposerSlashGroup = {
  group: string;
  items: ComposerSlashItem[];
};

export type ComposerEditorProps = {
  variant: ComposerVariant;
  value: Value;
  onChange: (value: Value) => void;
  placeholder?: string;
  editorKey?: string | number;
  className?: string;
  editorClassName?: string;
  minHeightClassName?: string;
  mentionUsers?: ComposerMentionUser[];
  slashGroups?: ComposerSlashGroup[];
  onEditorReady?: (editor: PlateEditor | null) => void;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  toolbarSlot?: ReactNode;
};

function setComposerRuntime(params: {
  mentionUsers?: ComposerMentionUser[];
  slashGroups?: ComposerSlashGroup[];
}) {
  (
    globalThis as {
      __canvasComposerMentionUsers?: ComposerMentionUser[];
      __canvasComposerSlashGroups?: ComposerSlashGroup[];
    }
  ).__canvasComposerMentionUsers = params.mentionUsers ?? [];
  (
    globalThis as {
      __canvasComposerMentionUsers?: ComposerMentionUser[];
      __canvasComposerSlashGroups?: ComposerSlashGroup[];
    }
  ).__canvasComposerSlashGroups = params.slashGroups ?? [];
}

export function ComposerEditor({
  variant,
  value,
  onChange,
  placeholder,
  editorKey,
  className,
  editorClassName,
  minHeightClassName = "min-h-[220px]",
  mentionUsers,
  slashGroups,
  onEditorReady,
  onKeyDown,
  toolbarSlot,
}: ComposerEditorProps) {
  React.useEffect(() => {
    setComposerRuntime({
      mentionUsers,
      slashGroups,
    });

    return () => {
      setComposerRuntime({
        mentionUsers: [],
        slashGroups: [],
      });
    };
  }, [mentionUsers, slashGroups]);

  const editor = usePlateEditor(
    {
      plugins: [...getComposerEditorPlugins(variant)],
      value,
    },
    [editorKey ?? variant]
  );

  React.useEffect(() => {
    onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  return (
    <Plate
      editor={editor}
      key={editorKey ?? variant}
      onChange={({ value: nextValue }) => onChange(nextValue)}
    >
      <EditorContainer
        className={className ?? minHeightClassName}
        variant="comment"
      >
        <Editor
          className={editorClassName}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          variant="comment"
        />
      </EditorContainer>

      <FloatingToolbar>
        <Toolbar className="gap-1 border-0 p-0">
          <TurnIntoToolbarButton />
          <MarkToolbarButton nodeType={KEYS.bold} shortcut="⌘+B" tooltip="Bold">
            <Bold className="size-4" />
          </MarkToolbarButton>
          <MarkToolbarButton
            nodeType={KEYS.italic}
            shortcut="⌘+I"
            tooltip="Italic"
          >
            <Italic className="size-4" />
          </MarkToolbarButton>
          <MarkToolbarButton
            nodeType={KEYS.underline}
            shortcut="⌘+U"
            tooltip="Underline"
          >
            <Underline className="size-4" />
          </MarkToolbarButton>
          <LinkToolbarButton />
        </Toolbar>
      </FloatingToolbar>

      {toolbarSlot}
    </Plate>
  );
}
