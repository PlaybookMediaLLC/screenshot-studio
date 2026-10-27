declare module "react-lazy-load-image-component" {
  import type * as React from "react";

  export type LazyLoadImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
    effect?: string;
    wrapperProps?: React.HTMLAttributes<HTMLSpanElement> & {
      ref?: React.Ref<unknown>;
    };
  };

  export const LazyLoadImage: React.ComponentType<LazyLoadImageProps>;
}
