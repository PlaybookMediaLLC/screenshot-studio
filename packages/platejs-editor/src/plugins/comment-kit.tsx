"use client";

import {
  type BaseCommentConfig,
  BaseCommentPlugin,
  getDraftCommentKey,
} from "@platejs/comment";

import type { ExtendConfig, Path } from "platejs";
import { isSlateString } from "platejs";
import { toTPlatePlugin, useEditorContainerRef } from "platejs/react";
import { useEffect } from "react";

import { CommentLeaf } from "../ui/comment-node";
import { FloatingDiscussion } from "../ui/floating-discussion";

type CommentConfig = ExtendConfig<
  BaseCommentConfig,
  {
    activeId: string | null;
    commentingBlock: Path | null;
    hoverId: string | null;
    isOverlapWithEditor: boolean;
    /** Below this editable width, comments open beside their block instead of in the side column. */
    overlapWidth: number;
    uniquePathMap: Map<string, Path>;
    updateTimestamp: number | null;
  }
>;

export const commentPlugin = toTPlatePlugin<CommentConfig>(BaseCommentPlugin, {
  handlers: {
    onClick: ({ api, event, setOption, type }) => {
      let leaf = event.target as HTMLElement;
      let isSet = false;

      const unsetActiveSuggestion = () => {
        setOption("activeId", null);
        isSet = true;
      };

      if (!isSlateString(leaf)) unsetActiveSuggestion();

      while (leaf.parentElement) {
        if (leaf.classList.contains(`slate-${type}`)) {
          const commentsEntry = api.comment!.node();

          if (!commentsEntry) {
            unsetActiveSuggestion();

            break;
          }

          const id = api.comment!.nodeId(commentsEntry[0]) ?? null;
          const isDraft = commentsEntry[0][getDraftCommentKey()];

          setOption("activeId", isDraft ? getDraftCommentKey() : id);
          isSet = true;

          break;
        }

        leaf = leaf.parentElement;
      }

      if (!isSet) unsetActiveSuggestion();
    },
  },
  options: {
    activeId: null,
    commentingBlock: null,
    hoverId: null,
    isOverlapWithEditor: false,
    overlapWidth: 700,
    uniquePathMap: new Map(),
    updateTimestamp: null,
  },
  useHooks: ({ editor, getOption, setOption }) => {
    const editorContainerRef = useEditorContainerRef();

    useEffect(() => {
      if (!editorContainerRef.current) return;

      const editable = editor.api.toDOMNode(editor);

      if (!editable) return;

      const observer = new ResizeObserver((entries) => {
        const width = entries[0].contentRect.width;
        const isOverlap = width < (getOption("overlapWidth") ?? 700);

        setOption("isOverlapWithEditor", isOverlap);
      });

      observer.observe(editable);

      return () => {
        observer.disconnect();
      };
    }, [editor, editorContainerRef, setOption]);
  },
})
  .extendTransforms(
    ({
      editor,
      setOption,
      tf: {
        comment: { setDraft },
      },
    }) => ({
      setDraft: () => {
        if (editor.api.isCollapsed()) {
          editor.tf.select(editor.api.block()![1]);
        }

        setDraft();

        editor.tf.collapse();
        setOption("activeId", getDraftCommentKey());
        setOption("commentingBlock", editor.selection!.focus.path.slice(0, 1));
      },
    })
  )
  .overrideEditor(
    ({ editor, setOption, tf: { apply, insertBreak }, tf, type }) => ({
      transforms: {
        apply(operation) {
          if (
            operation.type !== "set_selection" &&
            operation.type !== "set_node" &&
            operation.type !== "split_node" &&
            operation.type !== "merge_node"
          ) {
            const { newProperties, properties } = operation;
            const nextProperties = newProperties as
              Record<string, unknown> | undefined;
            const previousProperties = properties as
              Record<string, unknown> | undefined;

            if (
              previousProperties?.[getDraftCommentKey()] ||
              nextProperties?.[getDraftCommentKey()]
            ) {
              return;
            }

            setOption("updateTimestamp", Date.now());
          }

          apply(operation);
        },
        insertBreak() {
          setOption("updateTimestamp", Date.now());

          tf.comment.removeMark();
          insertBreak();
          editor.tf.unsetNodes([type], {
            at: editor.selection?.focus,
            mode: "lowest",
          });
        },
      },
    })
  )
  .extend({
    shortcuts: {
      setDraft: {
        keys: "mod+shift+m",
        handler: ({ editor }) => {
          // Slate selection updates are debounced; use the word selected in the DOM now.
          const selection = window.getSelection();
          if (selection?.rangeCount && editor.api.toDOMNode(editor)?.contains(selection.anchorNode)) {
            const range = editor.api.toSlateRange(selection, { exactMatch: false, suppressThrow: true });
            if (range) editor.tf.select(range);
          }
          editor.getTransforms(commentPlugin).comment.setDraft();
        },
      },
    },
  })
  // extend, not configure: a host's .configure({ options }) must keep these.
  .extend({
    render: {
      afterEditable: FloatingDiscussion,
      node: CommentLeaf,
    },
  });

export const CommentKit = [commentPlugin];
