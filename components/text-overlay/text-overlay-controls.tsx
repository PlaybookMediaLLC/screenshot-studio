'use client';

import { useRef, useEffect } from 'react';
import { useEditorPanels } from '@/lib/store/editor-panels';
import { useImageStore, withTypingHistory } from '@/lib/store';
import { Delete02Icon, ViewIcon, ViewOffSlashIcon, Add01Icon, TextIcon } from 'hugeicons-react';
import { getAvailableFontWeights } from '@/lib/constants/fonts';
import { FontPicker } from '@/components/editor/typography/FontPicker';
import { TextStyleFields } from '@/components/editor/typography/TextStyleFields';
import { cn } from '@/lib/utils';
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'

const QUICK_COLORS = [
  '#ffffff', '#000000', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#3b82f6', '#8b5cf6',
];

const WEIGHT_LABELS: Record<string, string> = {
  '100': 'Thin',
  '200': 'Extra Light',
  '300': 'Light',
  'normal': 'Regular',
  '400': 'Regular',
  '500': 'Medium',
  '600': 'Semibold',
  'bold': 'Bold',
  '700': 'Bold',
  '800': 'Extra Bold',
  '900': 'Black',
};

/** Text layers and the selected one's properties, together. */
export const TextOverlayControls = () => (
  <div className="space-y-3">
    <TextLayerList />
    <TextProperties />
  </div>
);

/**
 * Add text, and the list of text layers. Selection is the editor's own, so
 * picking a layer here or on the canvas shows the same properties.
 */
export const TextLayerList = () => {
  const {
    textOverlays,
    addTextOverlay,
    updateTextOverlay,
    removeTextOverlay,
    clearTextOverlays,
  } = useImageStore();
  const selectedOverlayId = useImageStore((state) => state.selectedTextId);
  const setSelectedOverlayId = useImageStore((state) => state.setSelectedTextId);

  const handleAddText = () => {
    setSelectedOverlayId(addTextOverlay());
    useEditorPanels.getState().showTab('edit');
  };

  return (
    <div className="space-y-3">
      {/* Add text button — big and clear */}
      <Button variant="custom" size={null}
        onClick={handleAddText}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-border/60 hover:border-primary/40 hover:bg-primary/5 text-muted-foreground hover:text-primary transition-all duration-150"
      >
        <Add01Icon size={16} />
        <span className="text-xs font-medium">Add Text</span>
      </Button>

      {/* Text overlay list */}
      {textOverlays.length > 0 && (
        <div className="space-y-1">
          {textOverlays.map((overlay) => {
            const isSelected = selectedOverlayId === overlay.id;
            return (
              <div
                key={overlay.id}
                className={cn(
                  'flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-all group',
                  isSelected
                    ? 'bg-primary/8 border border-primary/20'
                    : 'hover:bg-accent/60 border border-transparent'
                )}
              >
                <div className={cn(
                  "w-7 h-7 rounded-md flex items-center justify-center shrink-0",
                  isSelected ? "bg-primary/10 text-primary" : "bg-muted/60 text-muted-foreground/60"
                )}>
                  <TextIcon size={13} />
                </div>
                <Button variant="custom" size={null}
                  type="button"
                  aria-label={`Edit text: ${overlay.text || 'Empty text'}`}
                  aria-pressed={isSelected}
                  onClick={() => setSelectedOverlayId(isSelected ? null : overlay.id)}
                  className={cn(
                    'flex-1 text-left text-xs font-medium truncate',
                    !overlay.isVisible && 'text-muted-foreground line-through'
                  )}
                >
                  {overlay.text || 'Empty text'}
                </Button>
                <Button variant="custom" size={null}
                  aria-label={overlay.isVisible ? "Hide text" : "Show text"}
                  onClick={(e) => {
                    e.stopPropagation();
                    updateTextOverlay(overlay.id, { isVisible: !overlay.isVisible });
                  }}
                  className="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
                >
                  {overlay.isVisible
                    ? <ViewIcon size={13} />
                    : <ViewOffSlashIcon size={13} />}
                </Button>
                <Button variant="custom" size={null}
                  aria-label="Delete text"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeTextOverlay(overlay.id);
                    if (selectedOverlayId === overlay.id) setSelectedOverlayId(null);
                  }}
                  className="p-1 rounded-md text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Delete02Icon size={13} />
                </Button>
              </div>
            );
          })}

          {textOverlays.length > 1 && (
            <Button variant="custom" size={null}
              onClick={clearTextOverlays}
              className="text-[10px] text-muted-foreground hover:text-destructive transition-colors px-2.5 py-1"
            >
              Clear all
            </Button>
          )}
        </div>
      )}

    </div>
  );
};

/** Properties of the selected text layer, or nothing when no text is selected. */
export const TextProperties = ({ autoFocus = false }: { autoFocus?: boolean }) => {
  const { textOverlays, updateTextOverlay } = useImageStore();
  const selectedOverlayId = useImageStore((state) => state.selectedTextId);
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const selectedOverlay = textOverlays.find((o) => o.id === selectedOverlayId);

  // Focus the content box for new text, not when the selection came from the canvas.
  useEffect(() => {
    if (autoFocus && selectedOverlayId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [autoFocus, selectedOverlayId]);

  return (
    <>
      {selectedOverlay && (
        <div className="space-y-4">

          {/* Text content */}
          <div className="space-y-1.5">
            <Label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Content</Label>
            <Textarea
              aria-label="Text content"
              ref={editInputRef}
              value={selectedOverlay.text}
              onChange={(e) => withTypingHistory(`text:${selectedOverlay.id}`, () =>
                updateTextOverlay(selectedOverlay.id, { text: e.target.value }))}
              placeholder="Type your text..."
              rows={2}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
          </div>

          {/* Color */}
          <div className="space-y-1.5">
            <Label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Color</Label>
            <div className="flex items-center gap-1.5">
              {QUICK_COLORS.map((color) => (
                <Button variant="custom" size={null}
                  key={color}
                  aria-label={`Text color ${color}`}
                  onClick={() => updateTextOverlay(selectedOverlay.id, { color })}
                  className={cn(
                    'w-5 h-5 rounded-full transition-all shrink-0',
                    selectedOverlay.color === color
                      ? 'ring-[1.5px] ring-foreground ring-offset-1 ring-offset-background scale-110'
                      : 'hover:scale-110'
                  )}
                  style={{
                    backgroundColor: color,
                    border: color === '#ffffff' ? '1px solid hsl(var(--border))' : undefined,
                  }}
                />
              ))}
              <div className="w-px h-4 bg-border/40 mx-0.5" />
              <Input
                aria-label="Custom text color"
                type="color"
                value={selectedOverlay.color}
                onInput={(e) => updateTextOverlay(selectedOverlay.id, { color: e.currentTarget.value })}
                className="w-5 h-5 rounded-full cursor-pointer border border-border/50 appearance-none bg-transparent [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0"
              />
            </div>
          </div>

          {/* Typography */}
          <div className="space-y-2">
            <Label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Typography</Label>

            {/* Font family */}
            <FontPicker
              value={selectedOverlay.fontFamily}
              onChange={(fontFamily) => {
                const weights = getAvailableFontWeights(fontFamily);
                const newWeight = weights.includes(selectedOverlay.fontWeight)
                  ? selectedOverlay.fontWeight
                  : weights.includes('bold') ? 'bold' : weights[0] || 'normal';
                updateTextOverlay(selectedOverlay.id, { fontFamily, fontWeight: newWeight });
              }}
            />

            {/* Weight */}
            <Select
              value={selectedOverlay.fontWeight}
              onValueChange={(nextValue) =>
                updateTextOverlay(selectedOverlay.id, { fontWeight: nextValue })
              }
            >
              <SelectTrigger
                aria-label="Font weight"
                className="w-full h-9 px-2.5 text-xs rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {getAvailableFontWeights(selectedOverlay.fontFamily).map((w) => (
                  <SelectItem key={w} value={w}>
                    {WEIGHT_LABELS[w] ?? w}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Size */}
            <Slider
              value={[selectedOverlay.fontSize]}
              onValueChange={(v) => updateTextOverlay(selectedOverlay.id, { fontSize: v[0] })}
              min={8}
              max={150}
              step={1}
              label="Size"
              valueDisplay={`${selectedOverlay.fontSize}px`}
            />
          </div>

          <TextStyleFields text={selectedOverlay} />

          {/* Opacity */}
          <Slider
            value={[selectedOverlay.opacity]}
            onValueChange={(v) => updateTextOverlay(selectedOverlay.id, { opacity: v[0] })}
            min={0}
            max={1}
            step={0.01}
            label="Opacity"
            valueDisplay={`${Math.round(selectedOverlay.opacity * 100)}%`}
          />

          <div className="space-y-2">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Position on canvas</p>
            <div className="flex gap-2">
              <Button variant="custom" size={null}
                type="button"
                onClick={() => updateTextOverlay(selectedOverlay.id, { position: { ...selectedOverlay.position, x: 50 } })}
                className="flex-1 rounded-md border border-border px-2 py-2 text-xs hover:bg-accent"
              >
                Center horizontally
              </Button>
              <Button variant="custom" size={null}
                type="button"
                onClick={() => updateTextOverlay(selectedOverlay.id, { position: { ...selectedOverlay.position, y: 50 } })}
                className="flex-1 rounded-md border border-border px-2 py-2 text-xs hover:bg-accent"
              >
                Center vertically
              </Button>
            </div>
            <div className="flex gap-2">
              {(['x', 'y'] as const).map((axis) => (
                <Label key={axis} className="flex flex-1 items-center gap-1 text-xs text-muted-foreground">
                  {axis.toUpperCase()} (%)
                  <Input
                    type="number" min={0} max={100} step={0.1}
                    aria-label={`Text ${axis.toUpperCase()} position`}
                    value={Math.round(selectedOverlay.position[axis] * 10) / 10}
                    onChange={(event) => {
                      const value = event.currentTarget.valueAsNumber;
                      if (Number.isFinite(value)) updateTextOverlay(selectedOverlay.id, {
                        position: { ...selectedOverlay.position, [axis]: Math.min(100, Math.max(0, value)) },
                      });
                    }}
                    className="h-8 min-w-0 w-full rounded-md border border-border bg-background px-2 text-foreground"
                  />
                </Label>
              ))}
            </div>
          </div>

          {/* Orientation */}
          <div className="space-y-1.5">
            <Label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Orientation</Label>
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted/50 border border-border/20">
              {(['horizontal', 'vertical'] as const).map((dir) => (
                <Button variant="custom" size={null}
                  key={dir}
                  onClick={() => updateTextOverlay(selectedOverlay.id, { orientation: dir })}
                  className={cn(
                    'flex-1 h-7 rounded-md text-[11px] font-medium transition-all capitalize',
                    selectedOverlay.orientation === dir
                      ? 'bg-background text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {dir}
                </Button>
              ))}
            </div>
          </div>

          {/* Text Shadow */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Shadow</Label>
              <Button variant="custom" size={null}
                aria-label="Text shadow"
                aria-pressed={selectedOverlay.textShadow.enabled}
                onClick={() => updateTextOverlay(selectedOverlay.id, {
                  textShadow: { ...selectedOverlay.textShadow, enabled: !selectedOverlay.textShadow.enabled },
                })}
                className={cn(
                  'w-8 h-[18px] rounded-full transition-colors relative',
                  selectedOverlay.textShadow.enabled ? 'bg-primary' : 'bg-muted-foreground/30'
                )}
              >
                <span
                  className={cn(
                    'absolute top-[3px] w-3 h-3 rounded-full bg-white transition-transform',
                    selectedOverlay.textShadow.enabled ? 'left-[17px]' : 'left-[3px]'
                  )}
                />
              </Button>
            </div>

            {selectedOverlay.textShadow.enabled && (
              <div className="space-y-1">
                <Slider
                  value={[selectedOverlay.textShadow.blur]}
                  onValueChange={(v) => updateTextOverlay(selectedOverlay.id, {
                    textShadow: { ...selectedOverlay.textShadow, blur: v[0] },
                  })}
                  min={0}
                  max={20}
                  step={1}
                  label="Blur"
                  valueDisplay={`${selectedOverlay.textShadow.blur}px`}
                />
                <Slider
                  value={[selectedOverlay.textShadow.offsetX]}
                  onValueChange={(v) => updateTextOverlay(selectedOverlay.id, {
                    textShadow: { ...selectedOverlay.textShadow, offsetX: v[0] },
                  })}
                  min={-20}
                  max={20}
                  step={1}
                  label="X Offset"
                  valueDisplay={`${selectedOverlay.textShadow.offsetX}px`}
                />
                <Slider
                  value={[selectedOverlay.textShadow.offsetY]}
                  onValueChange={(v) => updateTextOverlay(selectedOverlay.id, {
                    textShadow: { ...selectedOverlay.textShadow, offsetY: v[0] },
                  })}
                  min={-20}
                  max={20}
                  step={1}
                  label="Y Offset"
                  valueDisplay={`${selectedOverlay.textShadow.offsetY}px`}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
