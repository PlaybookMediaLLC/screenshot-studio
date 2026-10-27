"use client";

// Remote carets and selections of the other people in a collaborative
// session. Added in Screenshot Studio (see UPSTREAM.md), after the Plate
// registry's remote-cursor-overlay.

import { YjsPlugin } from "@platejs/yjs/react";
import {
  type CursorOverlayData,
  useRemoteCursorOverlayPositions,
} from "@slate-yjs/react";
import { useEditorContainerRef, usePluginOption } from "platejs/react";
import type { CSSProperties, RefObject } from "react";

type CursorData = {
  color: string;
  name: string;
  selectionStyle?: CSSProperties;
  style?: CSSProperties;
};

function RemoteCursor({
  caretPosition,
  data,
  selectionRects,
}: CursorOverlayData<CursorData>) {
  const selectionStyle = data?.selectionStyle ?? data?.style;
  return (
    <>
      {selectionRects.map((position, index) => (
        <div
          className="pointer-events-none absolute"
          // biome-ignore lint/suspicious/noArrayIndexKey: rects have no identity
          key={index}
          style={{ ...selectionStyle, ...position }}
        />
      ))}
      {caretPosition ? (
        <div
          className="pointer-events-none absolute w-0.5"
          data-testid="remote-cursor"
          style={{ ...caretPosition, background: data?.color }}
        >
          <div
            className="absolute top-0 rounded rounded-bl-none px-1.5 py-0.5 text-white text-xs whitespace-nowrap"
            style={{ background: data?.color, transform: "translateY(-100%)" }}
          >
            {data?.name}
          </div>
        </div>
      ) : null}
    </>
  );
}

function RemoteCursors() {
  const containerRef = useEditorContainerRef();
  const [cursors] = useRemoteCursorOverlayPositions<CursorData>({
    // The container is mounted before the editor renders its overlays.
    containerRef: containerRef as RefObject<HTMLDivElement>,
  });
  return (
    <>
      {cursors.map((cursor) => (
        <RemoteCursor key={cursor.clientId} {...cursor} />
      ))}
    </>
  );
}

/** Renders once the document has synced; before that there are no peers. */
export function RemoteCursorOverlay() {
  const isSynced = usePluginOption(YjsPlugin, "_isSynced");
  return isSynced ? <RemoteCursors /> : null;
}
