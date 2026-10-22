"use client";

import { unwrapLink, upsertLink, validateUrl } from "@platejs/link";
import { CursorOverlayPlugin } from "@platejs/selection/react";
import { cn } from "@udecode/cn";
import { PiFileText as FileTextIcon, PiLink as LinkIcon, PiTrash as Trash2Icon } from "react-icons/pi";
import { NodeApi, type TText } from "platejs";
import {
  type PlateEditor,
  useEditorPlugin,
  useEditorRef,
  useEditorSelector,
  usePluginOption,
} from "platejs/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MyLinkElement } from "../components/plate-types";

import { linkPlugin, useActiveLink } from "../plugins/link-kit";

import { Button } from "./button";
import { Command, CommandInput, CommandItem, CommandList } from "./command";
import { getCursorOverlayElement } from "./cursor-overlay";
import { Input, inputVariants } from "./input";
import { mockRecentDocuments } from "./link-node";
import { Popover, PopoverAnchor, PopoverContent } from "./popover";

type LinkCommandDocument = (typeof mockRecentDocuments)[number];

const onUpsertLink = (editor: PlateEditor, url: string) => {
  upsertLink(editor, { skipValidation: true, url });
  editor.setOption(linkPlugin, "mode", null);
  editor.tf.focus();
};

export function LinkFloatingToolbar() {
  const mode = usePluginOption(linkPlugin, "mode");

  const anchorElement = usePluginOption(linkPlugin, "anchorElement");
  const { editor, setOption } = useEditorPlugin(linkPlugin);

  const aboveLink = useEditorSelector((plateEditor) => {
    if (plateEditor.api.isExpanded()) return;

    return plateEditor.api.above<MyLinkElement>({
      match: (n) => n.type === linkPlugin.key,
    })?.[0];
  }, []);

  const aboveUrl = editor.api.above<MyLinkElement>()?.[0].url ?? "";

  const [initialUrl, setInitialUrl] = useState(aboveUrl);

  useEffect(() => {
    setInitialUrl(aboveUrl);
  }, [aboveUrl]);

  const open = mode === "insert" || mode === "edit" || mode === "cursor";

  useEffect(() => {
    if (aboveLink) {
      const timeoutId = window.setTimeout(() => {
        const anchorNode = editor.api.toDOMNode(aboveLink);
        if (!anchorNode) {
          return;
        }

        setOption("activeId", aboveLink.id);
        setOption("mode", "cursor");
        setOption("anchorElement", anchorNode);
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }
    if (mode === "cursor" && !aboveLink) {
      setOption("activeId", null);
      setOption("mode", null);
      setOption("anchorElement", null);
    }
  }, [aboveLink, editor, mode, setOption]);

  if (!open) return null;

  return (
    <Popover
      modal={false}
      onOpenChange={(isOpen) => {
        setOption("mode", isOpen ? "insert" : null);
      }}
      open={open}
    >
      {anchorElement && (
        <PopoverAnchor virtualRef={{ current: anchorElement }} />
      )}

      <PopoverContent
        align="center"
        onEscapeKeyDown={() => editor.tf.focus()}
        onOpenAutoFocus={(e) => {
          if (mode === "cursor") return e.preventDefault();
        }}
        side="bottom"
      >
        {mode === "insert" ? (
          <InsertLinkCommand initialUrl={initialUrl} />
        ) : (
          <EditLinkCommand
            autoFocus={mode !== "cursor"}
            initialUrl={initialUrl}
            setInitialUrl={setInitialUrl}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

const InsertLinkCommand = ({ initialUrl }: { initialUrl: string }) => {
  const [query, setQuery] = useState(initialUrl);

  const [searchDocuments, setSearchDocuments] = useState<LinkCommandDocument[]>(
    []
  );

  const { editor } = useEditorPlugin(linkPlugin);

  const recentDocuments = useMemo(() => mockRecentDocuments.slice(0, 5), []);

  useEffect(() => {
    setSearchDocuments(
      mockRecentDocuments.filter((doc) =>
        doc.title?.toLowerCase().includes(query.toLowerCase())
      )
    );
  }, [query]);

  const count = searchDocuments.length;

  return (
    <Command shouldFilter={false}>
      <CommandInput
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing)
            return onUpsertLink(editor, query);
        }}
        onValueChange={(value) => setQuery(value)}
        placeholder="Paste link or search pages"
        value={query}
      />

      {count > 1 && (
        <span className="mx-2 font-medium text-foreground0 text-sm">
          Recents
        </span>
      )}
      <CommandList>
        {query.length === 0 &&
          recentDocuments.map((recentDocument) => (
            <InternalLinkCommandItem
              document={recentDocument}
              key={recentDocument.id}
            />
          ))}

        {query.length > 0 && (
          <>
            {searchDocuments.slice(0, 5).map((searchDocument) => (
              <InternalLinkCommandItem
                document={searchDocument}
                key={searchDocument.id}
              />
            ))}

            <OutsideLinkCommandItem query={query} />
          </>
        )}
      </CommandList>
    </Command>
  );
};

const EditLinkCommand = ({
  autoFocus,
  initialUrl,
  setInitialUrl,
}: {
  initialUrl: string;
  setInitialUrl: (url: string) => void;
  autoFocus?: boolean;
}) => {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState<string>("");
  const [text, setText] = useState<string>("");
  const [searchDocuments, setSearchDocuments] = useState<LinkCommandDocument[]>(
    []
  );

  const mode = usePluginOption(linkPlugin, "mode");

  const { editor, setOption } = useEditorPlugin(linkPlugin);
  const activeLinkId = usePluginOption(linkPlugin, "activeId");

  const editingLinkEntry = useActiveLink();
  const editingLinkNode = editingLinkEntry?.[0];
  const editingLinkPath = editingLinkEntry?.[1];

  const updateLinkSelection = useCallback(() => {
    const selectedLink = editor.api.node({
      at: [],
      mode: "lowest",
      match: (n) => n.type === linkPlugin.key && n.id === activeLinkId,
    })?.[0];

    if (!selectedLink) {
      return;
    }

    editor.tf.select(selectedLink);

    window.setTimeout(() => {
      editor.getApi(CursorOverlayPlugin).cursorOverlay.addCursor("selection", {
        selection: editor.selection,
      });

      setOption("anchorElement", getCursorOverlayElement());
    }, 0);
  }, [activeLinkId, editor, setOption]);

  useEffect(() => {
    if (editingLinkEntry) {
      setText(NodeApi.string(editingLinkEntry[0]));
    }
  }, [editingLinkEntry]);

  const document = mockRecentDocuments.find(
    (template) => template.id === initialUrl.slice(1)
  );

  useEffect(() => {
    setSearchDocuments(
      mockRecentDocuments.filter((doc) =>
        doc.title?.toLowerCase().includes(query.toLowerCase())
      )
    );
  }, [query]);

  const onEditLink = (url: string) => {
    if (!editingLinkNode) {
      return;
    }

    upsertLink(editor, {
      skipValidation: true,
      url,
    });

    setInitialUrl(url);
    setQuery("");
    setSearching(false);
    setOption("mode", "cursor");
    const anchorNode = editor.api.toDOMNode(editingLinkNode);
    if (anchorNode) {
      setOption("anchorElement", anchorNode);
    }
    editor.tf.focus();
  };

  const onTitleChange = (newTitle: string) => {
    setText(newTitle);

    if (newTitle.length === 0 || !editingLinkNode || !editingLinkPath) return;

    const firstText = editingLinkNode.children[0];
    if (!firstText) {
      return;
    }

    const newLink = { ...firstText, text: newTitle };

    editor.tf.replaceNodes<TText>(newLink, {
      at: editingLinkPath,
      children: true,
    });

    updateLinkSelection();
  };

  return (
    <>
      <div className="mt-2 px-3 font-medium text-muted-foreground text-xs">
        Page or URL
      </div>

      {searching ? (
        <Command shouldFilter={false}>
          <CommandInput
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing)
                return onEditLink(query);
            }}
            onValueChange={(value) => setQuery(value)}
            placeholder="Paste link or search pages"
            value={query}
            wrapClassName="mt-0"
          />
          {query.length > 0 && (
            <CommandList>
              {searchDocuments.slice(0, 5).map((searchDocument) => (
                <InternalLinkCommandItem
                  document={searchDocument}
                  key={searchDocument.id}
                  onSelect={() => onEditLink(`/${searchDocument.id}`)}
                />
              ))}

              <OutsideLinkCommandItem query={query} />
            </CommandList>
          )}
        </Command>
      ) : (
        <div className="px-3 py-1.5">
          <button
            className={cn(
              inputVariants(),
              "flex w-full cursor-pointer items-center hover:bg-muted"
            )}
            onClick={() => {
              setSearching(true);

              const isInternal = initialUrl.startsWith("/");

              if (!isInternal) {
                setQuery(initialUrl);
              }
            }}
            type="button"
          >
            {document ? (
              <>
                {document.icon ? (
                  <span className="mr-1">{document.icon}</span>
                ) : (
                  <FileTextIcon className="size-3.5" />
                )}
                <span>{document.title}</span>
              </>
            ) : (
              <>
                <LinkIcon className="mt-px mr-1 size-3.5 shrink-0" />
                <span className="h-6 max-w-[200px] truncate text-sm leading-6">
                  {initialUrl}
                </span>
              </>
            )}
          </button>
        </div>
      )}

      {query.length === 0 && (
        <div className="my-2 px-3">
          <div className="mb-1.5 font-medium text-muted-foreground text-xs">
            Link title
          </div>

          <Input
            autoFocus={!searching && autoFocus}
            onChange={(e) => onTitleChange(e.target.value)}
            onFocus={() => {
              if (mode === "cursor") {
                setOption("mode", "edit");
                updateLinkSelection();
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (!editingLinkNode) {
                  return;
                }

                editor.tf.select(editingLinkNode, { focus: true });
                const anchorNode = editor.api.toDOMNode(editingLinkNode);
                if (anchorNode) {
                  setOption("anchorElement", anchorNode);
                }
                setOption("mode", "cursor");
              }
            }}
            value={text}
          />

          <Button
            className="mt-4 w-full"
            onClick={() => {
              unwrapLink(editor);
              setOption("mode", null);
              editor.tf.focus();
            }}
            variant="outline"
          >
            <Trash2Icon />
            Remove link
          </Button>
        </div>
      )}
    </>
  );
};

const OutsideLinkCommandItem = ({ query }: { query: string }) => {
  const editor = useEditorRef();

  return (
    <CommandItem
      className="h-fit py-1"
      onSelect={() => onUpsertLink(editor, query)}
    >
      <LinkIcon className="mr-2 size-3.5 shrink-0" />
      <div className="flex flex-col">
        <span className="truncate font-medium text-sm">{query}</span>
        <span className="text-foreground0 text-xs">
          {validateUrl(editor, query)
            ? "Link to web page"
            : "Type a complete URL to link"}
        </span>
      </div>
    </CommandItem>
  );
};

const InternalLinkCommandItem = ({
  document,
  onSelect,
}: {
  document: LinkCommandDocument;
  onSelect?: () => void;
}) => {
  const editor = useEditorRef();

  return (
    <CommandItem
      autoFocus
      className="flex items-center gap-2"
      onSelect={() => {
        if (onSelect) return onSelect();

        onUpsertLink(editor, `/${document.id}`);
      }}
    >
      {document.icon ? (
        <span>{document.icon}</span>
      ) : (
        <FileTextIcon className="size-3.5" />
      )}
      <span>{document.title}</span>
    </CommandItem>
  );
};
