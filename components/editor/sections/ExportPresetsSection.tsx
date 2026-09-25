"use client";

import * as React from "react";
import { SectionWrapper } from "./SectionWrapper";
import { useImageStore } from "@/lib/store";
import { toast } from "sonner";

export const exportPresets = [
  { id: "twitter-post", name: "Twitter/X", platform: "Social", width: 1200, height: 675 },
  { id: "instagram-square", name: "Instagram Square", platform: "Social", width: 1080, height: 1080 },
  { id: "instagram-story", name: "Instagram Story", platform: "Social", width: 1080, height: 1920 },
  { id: "facebook-post", name: "Facebook", platform: "Social", width: 1200, height: 630 },
  { id: "linkedin-post", name: "LinkedIn", platform: "Social", width: 1200, height: 627 },
  { id: "youtube-thumbnail", name: "YouTube", platform: "Video", width: 1280, height: 720 },
  { id: "pinterest-pin", name: "Pinterest", platform: "Social", width: 1000, height: 1500 },
  { id: "devices-ipad", name: "iPad Pro", platform: "Device", width: 2048, height: 2732 },
];

export function ExportPresetsSection() {
  return (
    <SectionWrapper title="Export Presets" defaultOpen={false}>
      <p className="mb-2 text-[10px] text-muted-foreground">Canvas size at 1×. Export scale multiplies these dimensions.</p>
      <div className="grid grid-cols-2 gap-1.5">
        {exportPresets.map((preset) => (
          <button
            key={preset.id}
            onClick={() => {
              useImageStore.getState().setCustomDimensions(preset.width, preset.height);
              toast.success(`${preset.name}: ${preset.width}×${preset.height} at 1×`);
            }}
            className="px-2.5 py-2 rounded-lg border border-border/30 hover:border-border/60 hover:bg-accent/50 transition-all text-left active:scale-[0.98]"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {preset.platform}
              </span>
            </div>
            <p className="text-[11px] font-semibold text-foreground mt-0.5">
              {preset.name}
            </p>
            <p className="text-[9px] text-muted-foreground">{preset.width}×{preset.height}</p>
          </button>
        ))}
      </div>
    </SectionWrapper>
  );
}
