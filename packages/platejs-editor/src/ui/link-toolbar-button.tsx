"use client";

import { PiLink as Link } from "react-icons/pi";
import { useEditorPlugin } from "platejs/react";
import type * as React from "react";

import { linkPlugin } from "../plugins/link-kit";

import { ToolbarButton } from "./toolbar";

export function LinkToolbarButton(
  props: React.ComponentProps<typeof ToolbarButton>
) {
  const { api } = useEditorPlugin(linkPlugin);

  return (
    <ToolbarButton
      data-plate-focus
      onClick={() => api.a.show()}
      tooltip="Link"
      {...props}
    >
      <Link />
    </ToolbarButton>
  );
}
