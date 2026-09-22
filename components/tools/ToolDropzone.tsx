"use client";

import * as React from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { Image01Icon, Add01Icon } from "hugeicons-react";
import { cn } from "@/lib/utils";
import { TOOL_DROPZONE_ACCEPT } from "./useToolQueue";

interface ToolDropzoneProps {
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  /** e.g. "PNG" on /png-to-jpg, so the prompt matches the page's promise. */
  sourceLabel?: string;
  /** Renders the slim "add more" bar instead of the full empty state. */
  compact?: boolean;
}

export function ToolDropzone({
  onFiles,
  multiple = true,
  sourceLabel,
  compact = false,
}: ToolDropzoneProps) {
  /**
   * Rejected files are forwarded too, rather than dropped here.
   *
   * react-dropzone filters on `accept` before this runs, so anything it turns
   * away would otherwise vanish with no feedback at all: dropping a lone .tiff
   * looked like the page was broken, and one bad file in a batch disappeared
   * unmentioned. The queue is the single place that validates and reports, so
   * everything is handed to it and it decides what to say.
   */
  const onDrop = React.useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      const all = [...accepted, ...rejected.map((entry) => entry.file)];
      if (all.length > 0) onFiles(all);
    },
    [onFiles]
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: TOOL_DROPZONE_ACCEPT,
    multiple,
    noClick: false,
  });

  const noun = sourceLabel ? `${sourceLabel} image` : "image";
  const plural = multiple ? `${noun}s` : noun;

  if (compact) {
    return (
      <button
        type="button"
        onClick={open}
        {...getRootProps({
          className: cn(
            "flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground",
            isDragActive && "border-foreground/50 bg-muted/60 text-foreground"
          ),
        })}
      >
        <input {...getInputProps()} />
        <Add01Icon size={16} aria-hidden="true" />
        {isDragActive ? `Drop to add ${plural}` : `Add more ${plural}`}
      </button>
    );
  }

  return (
    <div
      {...getRootProps({
        className: cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted/20 px-6 py-16 text-center transition-colors hover:border-foreground/30 hover:bg-muted/40",
          isDragActive && "border-foreground/50 bg-muted/60"
        ),
        role: "button",
        "aria-label": `Choose ${plural} to process`,
      })}
    >
      <input {...getInputProps()} />
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Image01Icon size={22} aria-hidden="true" />
      </div>
      <p className="text-base font-medium text-foreground">
        {isDragActive ? `Drop your ${plural} here` : `Drop ${plural} here`}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        or click to browse, {multiple ? "select as many as you like" : "one image at a time"}
      </p>
      <p className="mt-4 text-xs text-muted-foreground">
        PNG, JPG, WebP, AVIF · processed in your browser, never uploaded
      </p>
    </div>
  );
}
