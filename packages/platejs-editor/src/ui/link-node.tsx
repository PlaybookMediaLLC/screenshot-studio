"use client";

import { useLink } from "@platejs/link/react";
import { PiArrowUpRight as ArrowUpRightIcon, PiCopy as CopyIcon, PiFileText as FileTextIcon, PiLink as LinkIcon } from "react-icons/pi";
import { useEffect } from "react";

export const mockRecentDocuments = [
  {
    id: "docs/examples/ai",
    icon: "📋",
    title: "AI",
  },
  {
    id: "docs/examples/callout",
    icon: "🧰",
    title: "Callout",
  },
  {
    id: "docs/examples/equation",
    icon: "🧮",
    title: "Equation",
  },
  {
    id: "docs/examples/toc",
    icon: "📚",
    title: "Table of Contents",
  },
];

import {
  PlateElement,
  type PlateElementProps,
  useEditorPlugin,
  useElement,
  usePluginOption,
} from "platejs/react";
import type { MyLinkElement } from "../components/plate-types";

import { openSafeUrl } from "../lib/safe-url";
import { linkPlugin } from "../plugins/link-kit";

import { Button } from "./button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card";

export function LinkElement(props: PlateElementProps) {
  const element = useElement<MyLinkElement>();
  const { props: linkAttributes } = useLink({ element });
  const { api, setOption } = useEditorPlugin(linkPlugin);

  const activeLinkId = usePluginOption(linkPlugin, "activeId");
  const mode = usePluginOption(linkPlugin, "mode");
  const isOpen = activeLinkId === element.id && mode === "hover";

  const isInternal = element.url.startsWith("/");

  const onCopy = async () => {
    const urlToCopy = isInternal
      ? `${window.location.origin}${element.url}`
      : element.url;

    try {
      await navigator.clipboard.writeText(urlToCopy);
    } catch {
      return;
    }
  };

  return (
    <HoverCard
      closeDelay={0}
      onOpenChange={(nextOpen) => {
        setOption("mode", nextOpen ? "hover" : null);
        setOption("activeId", nextOpen ? element.id : null);
      }}
      open={isOpen}
      openDelay={0}
    >
      <HoverCardTrigger asChild>
        <span>
          <PlateElement
            as="a"
            {...props}
            attributes={{
              ...props.attributes,
              ...linkAttributes,
              onClick: () => {
                openSafeUrl(element.url, isInternal ? "_self" : "_blank");
              },
              onMouseDown: (e) => e.preventDefault(),
            }}
            className="cursor-pointer border-b-1 font-medium text-primary/65"
          >
            {props.children}
          </PlateElement>
        </span>
      </HoverCardTrigger>
      <HoverCardContent className="w-fit animate-none px-1.5 py-1 transition-none">
        <div className="flex items-center">
          <LinkPreview element={element} />
          <Button
            className="ml-1 shrink-0 px-2 py-1"
            onClick={onCopy}
            variant="ghost"
          >
            <CopyIcon className="size-3! shrink-0" />
          </Button>
          <Button
            className="shrink-0 px-2 py-1"
            onClick={() => {
              setOption("activeId", element.id);
              api.a.show({ linkElement: element, mode: "edit" });
            }}
            variant="ghost"
          >
            <span className="text-xs">Edit</span>
          </Button>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

const LinkPreview = ({ element }: { element: MyLinkElement }) => {
  const { editor } = useEditorPlugin(linkPlugin);

  const isInternal = element.url.startsWith("/");

  const document = mockRecentDocuments.find(
    (template) => template.id === element.url.slice(1)
  );

  const Icon = (
    <span>
      {element.icon ? (
        <span>{element.icon}</span>
      ) : (
        <FileTextIcon className="size-4" />
      )}
    </span>
  );

  useEffect(() => {
    if (!document) return;
    if (document.title !== element.title || document.icon !== element.icon) {
      editor.tf.setNodes(
        { icon: document.icon, title: document.title },
        {
          at: [],
          mode: "lowest",
          match: (n) => n.type === linkPlugin.key && n.id === element.id,
        }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document, editor.tf.setNodes, element.icon, element.id, element.title]);

  return (
    <div className="flex items-center gap-1 text-primary/65">
      {isInternal ? (
        <>
          <span className="relative mr-3">
            {Icon}
            <ArrowUpRightIcon className="absolute -right-3 bottom-0 size-3.5 font-bold" />
          </span>
          <span className="h-6 max-w-[200px] truncate text-sm leading-6">
            {element.title}
          </span>
        </>
      ) : (
        <>
          <LinkIcon className="mt-px mr-1 size-3.5 shrink-0" />
          <span className="h-6 max-w-[200px] truncate text-sm leading-6">
            {element.url}
          </span>
        </>
      )}
    </div>
  );
};
