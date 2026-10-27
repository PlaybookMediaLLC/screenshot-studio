"use client";

import {
  type AvatarImageProps,
  Fallback,
  Image,
  Root,
} from "@radix-ui/react-avatar";

import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../lib/utils";

const avatarVariants = cva("relative flex shrink-0 overflow-hidden", {
  defaultVariants: {
    size: "default",
    variant: "default",
  },
  variants: {
    size: {
      default: "size-10",
      lg: "size-12",
      profile: "size-20",
      settings: "size-20 md:size-28",
      sm: "size-6",
    },
    variant: {
      default: "rounded-full",
    },
  },
});

type AvatarProps = React.ComponentProps<typeof Root> &
  VariantProps<typeof avatarVariants>;

function Avatar({ className, size, variant, ...props }: AvatarProps) {
  return (
    <Root
      className={cn(avatarVariants({ size, variant }), className)}
      data-slot="avatar"
      {...props}
    />
  );
}

function AvatarImage({
  className,
  onLoadingStatusChange,
  alt,
  ...props
}: React.ComponentProps<typeof Image> &
  Pick<AvatarImageProps, "onLoadingStatusChange">) {
  return (
    <Image
      alt={alt ?? ""}
      className={cn(
        "aspect-square size-full select-none object-cover",
        className
      )}
      data-slot="avatar-image"
      onLoadingStatusChange={onLoadingStatusChange}
      {...props}
    />
  );
}

const avatarFallbackVariants = cva(
  "box-content flex size-full items-center justify-center",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "rounded-full bg-muted",
      },
    },
  }
);

type AvatarFallbackProps = React.ComponentProps<typeof Fallback> &
  VariantProps<typeof avatarFallbackVariants>;

function AvatarFallback({ className, variant, ...props }: AvatarFallbackProps) {
  return (
    <Fallback
      className={cn(avatarFallbackVariants({ variant }), className)}
      data-slot="avatar-fallback"
      {...props}
    />
  );
}

export { Avatar, AvatarFallback, AvatarImage };
