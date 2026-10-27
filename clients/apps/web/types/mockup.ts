import type { DeviceArt } from "@/lib/frames/devices";
import type { CompositionLayoutId } from "@/lib/frames/layouts";
import type { CodeContent, DeviceOrientation, ScreenFrame } from "@/lib/frames/schema";

export type DeviceFamily = "phone" | "watch" | "tablet" | "laptop" | "desktop" | "spatial";
export type DeviceFinish = "light" | "dark" | "graphite";
export type DevicePerspective = "front" | "left" | "right";
export type DeviceImageFit = "cover" | "contain";
export type DeviceScreenSourceRef = "uploaded-image" | `device-screen:${string}`;

export interface DeviceFrameAsset {
  src: string;
  maskSrc: string;
  screen: { x: number; y: number; width: number; height: number };
  // Optional mask coverage; the image continues to use the original screen viewport.
  maskScreen?: DeviceFrameAsset["screen"];
  emptyStatePosition?: { x: number; y: number };
  emptyStateWidth?: number;
  emptyStateTransform?: string;
}
export type DeviceLayoutId =
  | "center-stage"
  | "editorial-offset"
  | "duo-split"
  | "duo-depth"
  | "trio-fan"
  | "product-suite"
  | CompositionLayoutId;

export interface MockupDefinition {
  id: string;
  name: string;
  family: DeviceFamily;
  finish: DeviceFinish;
  perspective: DevicePerspective;
  aspectRatio: number;
  asset?: DeviceFrameAsset;
  /** A device drawn in-house, parameterized by color and orientation. */
  art?: DeviceArt;
}

export interface DeviceScreenContent {
  src: string | null;
  name: string | null;
  fit: DeviceImageFit;
  scale: number;
  offset: { x: number; y: number };
  isCustom: boolean;
  sourceRef?: DeviceScreenSourceRef;
  /** The content's width / height, so a browser, window, or bare frame fits it. */
  aspect?: number;
  /** Code drawn as the screen instead of an image. */
  code?: CodeContent;
}

export interface Mockup {
  id: string;
  /** The device this screen shows on; kept while another frame kind is in use. */
  definitionId: string;
  position: { x: number; y: number };
  size: number;
  rotation: number;
  opacity: number;
  isVisible: boolean;
  screen: DeviceScreenContent;
  /** What holds the screen. Absent means the device in `definitionId`. */
  frame?: ScreenFrame;
  /** A drawn device's color id. */
  color?: string;
  /** A drawn device's orientation. */
  orientation?: DeviceOrientation;
}

export interface DeviceLayoutSlot {
  family?: DeviceFamily;
  definitionId?: string;
  position: { x: number; y: number };
  size: number;
  sizeByFamily?: Partial<Record<DeviceFamily, number>>;
  rotation: number;
}

export interface DeviceLayoutDefinition {
  id: DeviceLayoutId;
  name: string;
  description: string;
  slots: DeviceLayoutSlot[];
}
