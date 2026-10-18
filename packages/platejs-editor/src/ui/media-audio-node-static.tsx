import type { SlateElementProps, TAudioElement } from "../exports/platejs-static";
import { SlateElement } from "../exports/platejs-static";

export function MediaAudioElementStatic(
  props: SlateElementProps<TAudioElement & { captionUrl?: string }>
) {
  const { captionUrl, url } = props.element;

  return (
    <SlateElement className="mb-1" {...props}>
      <figure className="group relative cursor-default">
        <div className="h-16">
          {/* biome-ignore lint/a11y/useMediaCaption: Uploaded audio may have no
              caption file. Rendering the track unconditionally would register a
              TextTrack that can never load, surfacing an empty "Captions" entry
              in the native controls. */}
          <audio className="size-full" controls src={url}>
            {captionUrl ? (
              <track
                kind="captions"
                label="Captions"
                src={captionUrl}
                srcLang="en"
              />
            ) : null}
          </audio>
        </div>
      </figure>
      {props.children}
    </SlateElement>
  );
}
