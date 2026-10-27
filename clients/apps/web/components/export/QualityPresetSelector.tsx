'use client';

import { SegmentedControl } from '@/components/ui/segmented-control'
import type { ExportFormat, QualityPreset } from '@/lib/export/types';
import { QUALITY_PRESET_LABELS } from '@/lib/export/types';
import { Label } from '@/components/ui/label'

interface QualityPresetSelectorProps {
  qualityPreset: QualityPreset;
  format: ExportFormat;
  onQualityPresetChange: (preset: QualityPreset) => void;
}

const PRESETS: QualityPreset[] = ['high', 'medium', 'low'];

export function QualityPresetSelector({
  qualityPreset,
  format,
  onQualityPresetChange,
}: QualityPresetSelectorProps) {
  const currentLabel = QUALITY_PRESET_LABELS[qualityPreset];

  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium text-foreground">Quality</Label>
      <SegmentedControl
        value={qualityPreset}
        onChange={(id) => onQualityPresetChange(id as QualityPreset)}
        options={PRESETS.map((preset) => ({
          id: preset,
          label: QUALITY_PRESET_LABELS[preset].label,
        }))}
      />
      <p className="text-xs text-muted-foreground">
        {currentLabel.description[format]}
      </p>
    </div>
  );
}
