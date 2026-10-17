"use client";

import { useMediaState } from "@platejs/media/react";
import { ResizableProvider } from "@platejs/resizable";
import type { TAudioElement } from "platejs";
import { PlateElement, type PlateElementProps, withHOC } from "platejs/react";

import { Caption, CaptionTextarea } from "./caption";

export const MediaAudioElement = withHOC(
  ResizableProvider,
  function MediaAudioElementContent(
    props: PlateElementProps<TAudioElement & { captionUrl?: string }>
  ) {
    const { align = "center", readOnly, unsafeUrl } = useMediaState();
    const { captionUrl } = props.element;

    return (
      <PlateElement className="mb-1" {...props}>
        <figure className="group relative" contentEditable={false}>
          <div className="h-16">
            <audio className="size-full" controls src={unsafeUrl}>
              <track
                kind="captions"
                label="Captions"
                src={captionUrl}
                srcLang="en"
              />
            </audio>
          </div>

          <Caption align={align} style={{ width: "100%" }}>
            <CaptionTextarea
              className="h-20"
              placeholder="Write a caption..."
              readOnly={readOnly}
            />
          </Caption>
        </figure>
        {props.children}
      </PlateElement>
    );
  }
);
