"use client";

import {
  BLOCK_CONTEXT_MENU_ID,
  BlockMenuPlugin,
} from "@platejs/selection/react";
import { MoreHorizontal } from "lucide-react";
import {
  useEditorPlugin,
  useEditorRef,
  useElement,
  usePluginOption,
} from "platejs/react";
import type * as React from "react";
import { useIsTouchDevice } from "../hooks/use-is-touch-device";
import { useLockScroll } from "../hooks/use-lock-scroll";
import { cn } from "../lib/utils";

import { BlockMenu } from "./block-menu";
import { Button, type ButtonProps } from "./button";
import { useContextMenu } from "./menu";

export function BlockContextMenu({ children }: { children: React.ReactNode }) {
  const { api, editor } = useEditorPlugin(BlockMenuPlugin);
  const anchorRect = usePluginOption(BlockMenuPlugin, "position");
  const openId = usePluginOption(BlockMenuPlugin, "openId");
  const isTouch = useIsTouchDevice();

  useLockScroll(openId === BLOCK_CONTEXT_MENU_ID, `#${editor.meta.uid}`);

  const { getAnchorRect, show, store } = useContextMenu(anchorRect);

  const openContextMenu = (x: number, y: number) => {
    show();
    api.blockMenu.show(BLOCK_CONTEXT_MENU_ID, {
      x,
      y,
    });
  };

  const isContextMenuDisabled = (target: EventTarget | null) => {
    const dataset = (target as HTMLElement | null)?.dataset;
    return dataset?.slateEditor === "true";
  };

  if (isTouch) {
    return children;
  }

  return (
    <div
      aria-expanded={openId === BLOCK_CONTEXT_MENU_ID}
      aria-haspopup="menu"
      className="group/context-menu w-full"
      data-plate-selectable
      data-state={openId === BLOCK_CONTEXT_MENU_ID ? "open" : "closed"}
      onContextMenu={(event) => {
        if (isContextMenuDisabled(event.target)) return;

        event.preventDefault();
        openContextMenu(event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        const isKeyboardContextMenu =
          event.key === "ContextMenu" ||
          (event.shiftKey && event.key === "F10");

        if (!isKeyboardContextMenu || isContextMenuDisabled(event.target)) {
          return;
        }

        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        openContextMenu(rect.left + rect.width / 2, rect.top + rect.height / 2);
      }}
      role="button"
      tabIndex={0}
    >
      {children}

      <BlockMenu
        getAnchorRect={getAnchorRect}
        open={openId === BLOCK_CONTEXT_MENU_ID}
        store={store}
      />
    </div>
  );
}

export function BlockActionButton({
  className,
  defaultStyles = true,
  ...props
}: Partial<ButtonProps> & { defaultStyles?: boolean }) {
  const editor = useEditorRef();
  const element = useElement();

  return (
    <Button
      className={cn(
        defaultStyles &&
          "absolute top-1 right-1 opacity-0 transition-opacity group-hover:opacity-100",
        className
      )}
      contentEditable={false}
      onClick={(e) => {
        e.stopPropagation();
        editor
          .getApi(BlockMenuPlugin)
          .blockMenu.showContextMenu(element.id as string, {
            x: e.clientX,
            y: e.clientY,
          });
      }}
      size="blockAction"
      tooltip="More actions"
      variant="blockAction"
      {...props}
    >
      <MoreHorizontal />
    </Button>
  );
}
