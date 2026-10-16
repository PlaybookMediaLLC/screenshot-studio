'use client'

import * as React from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Download04Icon,
  Copy01Icon,
  AspectRatioIcon,
  Add01Icon,
  Video01Icon,
  Delete02Icon,
  ArrowTurnBackwardIcon,
  ArrowTurnForwardIcon,
  Download01Icon,
  RefreshIcon,
  MagicWand01Icon,
  GridIcon,
  RulerIcon,
  FileZipIcon,
  KeyboardIcon,
  MoreHorizontalIcon,
} from 'hugeicons-react'
import { selectScreenshot, useImageStore } from '@/lib/store'
import { useShallow } from 'zustand/react/shallow'
import { useExport } from '@/hooks/useExport'
import { shouldIgnoreEditorShortcut } from '@/lib/editor-shortcuts'
import { KeyboardShortcutsDialog } from '@/components/canvas/dialogs/KeyboardShortcutsDialog'
import { useBatchExport } from '@/hooks/useBatchExport'
import { aspectRatios } from '@/lib/constants/aspect-ratios'
import { AspectRatioPicker } from '@/components/aspect-ratio/aspect-ratio-picker'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { CopyProgressDialog } from '@/components/canvas/dialogs/CopyProgressDialog'
import { BatchExportProgressDialog } from '@/components/canvas/dialogs/BatchExportProgressDialog'
import { ExportSlideshowDialog } from '@/lib/export-slideshow-dialog'
import { ImageExportProgressView } from '@/components/canvas/dialogs/ImageProgressView'
import { FormatSelector, QualityPresetSelector, ScaleSlider } from '@/components/export'
import { cn } from '@/lib/utils'
import { SaveToWorkspaceButton } from '@/components/workspace/SaveToWorkspaceButton'
import { ProjectMenu } from '@/components/projects/ProjectMenu'
import { ShareButton } from './share/ShareButton'
import { FeedbackWidget } from '@/components/FeedbackWidget'
import { AccountMenu } from '@/components/auth/AccountMenu'
import { useIsMobile } from '@/hooks/use-mobile'
import { hasVisibleMockups, shouldRenderSourceImage } from '@/lib/device-mockups/layouts'
import { removeScreenshot } from '@/lib/editor/remove-screenshot'

/** A quiet square toolbar button with a tooltip; `active` marks a toggled tool. */
function ToolButton({
  active = false,
  children,
  className,
  label,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          aria-pressed={props['aria-pressed']}
          className={cn(
            'grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground',
            'transition-[color,background-color,transform] duration-150 hover:bg-foreground/[0.06] hover:text-foreground active:scale-95',
            'disabled:pointer-events-none disabled:opacity-35',
            active && 'bg-foreground/[0.08] text-foreground',
            className
          )}
          type="button"
          {...props}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

/** A hairline between toolbar groups. */
function ToolDivider() {
  return <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-foreground/[0.08]" />
}

export function EditorHeader() {
  const isMobile = useIsMobile()
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false)
  const screenshot = useImageStore(useShallow(selectScreenshot))
  const {
    selectedAspectRatio,
    slides,
    uploadedImageUrl,
    textOverlays,
    editorMode,
    mockups,
    timeline,
    animationClips,
    resetCanvasSettings,
    showTemplates,
    setShowTemplates,
    showRulers,
    showGrid,
    rulerInterval,
    toggleRulers,
    toggleGrid,
    setRulerInterval,
  } = useImageStore()
  const [aspectRatioOpen, setAspectRatioOpen] = React.useState(false)
  const [exportOpen, setExportOpen] = React.useState(false)
  const [exportSlideshowOpen, setExportSlideshowOpen] = React.useState(false)
  const [exportError, setExportError] = React.useState<string | null>(null)
  const [resetOpen, setResetOpen] = React.useState(false)

  const currentAspectRatio = aspectRatios.find((ar) => ar.id === selectedAspectRatio)
  const hasImage =
    (!!screenshot.src && shouldRenderSourceImage(editorMode, mockups)) ||
    (editorMode === 'device' && hasVisibleMockups(mockups))

  const hasContent = hasImage || textOverlays.length > 0

  // Undo/redo state
  const [canUndo, setCanUndo] = React.useState(false)
  const [canRedo, setCanRedo] = React.useState(false)
  const showHistoryControls = hasImage || canUndo || canRedo

  React.useEffect(() => {
    const updateTemporalState = () => {
      const { pastStates, futureStates } = useImageStore.temporal.getState()
      setCanUndo(pastStates.length > 0)
      setCanRedo(futureStates.length > 0)
    }
    updateTemporalState()
    const unsubscribe = useImageStore.temporal.subscribe(updateTemporalState)
    return unsubscribe
  }, [])

  const handleUndo = React.useCallback(() => {
    const { undo, pastStates } = useImageStore.temporal.getState()
    if (pastStates.length > 0) undo()
  }, [])

  const handleRedo = React.useCallback(() => {
    const { redo, futureStates } = useImageStore.temporal.getState()
    if (futureStates.length > 0) redo()
  }, [])

  // Keep history shortcuts mounted even when undo/delete empties the canvas.
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreEditorShortcut(event) || event.altKey || !(event.metaKey || event.ctrlKey))
        return
      const key = event.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      event.preventDefault()
      if (key === 'y' || event.shiftKey) handleRedo()
      else handleUndo()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleUndo, handleRedo])

  const showVideoExport =
    slides.length > 0 || timeline.tracks.length > 0 || animationClips.length > 0

  const {
    copyImage,
    isExporting,
    isCopying,
    progress,
    copyProgress,
    settings: exportSettings,
    exportImage,
    renderExportBlob,
    updateScale,
    updateFormat,
    updateQualityPreset,
  } = useExport(selectedAspectRatio)

  const { isBatchExporting, batchProgress, exportAllSlides } = useBatchExport(
    selectedAspectRatio,
    exportSettings
  )

  const handleExport = async () => {
    setExportError(null)
    try {
      await exportImage()
      setExportOpen(false)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed. Please try again.')
    }
  }

  const handleExportAll = async () => {
    setExportOpen(false)
    await exportAllSlides()
  }

  const formatLabel =
    exportSettings.format === 'jpeg' ? 'JPEG' : exportSettings.format === 'webp' ? 'WebP' : 'PNG'

  return (
    <>
      <header
        className={cn(
          'grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-foreground/[0.06] bg-background',
          isMobile ? 'px-2' : 'px-3'
        )}
      >
        <div className="flex min-w-0 items-center gap-1 justify-self-start">
          {/* On desktop the logo lives in the sidebar rail. */}
          {isMobile ? (
            <Link
              aria-label="Shots"
              className="grid size-8 shrink-0 place-items-center rounded-lg transition-opacity hover:opacity-80"
              href="/"
            >
              <Image
                alt=""
                className="size-6 rounded-md"
                height={24}
                priority
                src="/logo-mark.png"
                width={24}
              />
            </Link>
          ) : null}
          <button
            aria-expanded={showTemplates}
            aria-label="Templates"
            className={cn(
              'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium',
              'transition-colors duration-150',
              showTemplates
                ? 'bg-foreground/[0.08] text-foreground'
                : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground'
            )}
            onClick={() => setShowTemplates(!showTemplates)}
            type="button"
          >
            <MagicWand01Icon className="shrink-0" size={15} />
            {!isMobile ? <span>Templates</span> : null}
          </button>
          <ProjectMenu compact={isMobile} />
        </div>

        {/* One floating toolbar: history, guides, and canvas size. */}
        <div className="flex items-center justify-self-center rounded-xl border border-foreground/[0.06] bg-foreground/[0.03] p-0.5">
          {showHistoryControls ? (
            <>
              <ToolButton disabled={!canUndo} label="Undo (⌘Z)" onClick={handleUndo}>
                <ArrowTurnBackwardIcon size={15} />
              </ToolButton>
              <ToolButton disabled={!canRedo} label="Redo (⌘⇧Z)" onClick={handleRedo}>
                <ArrowTurnForwardIcon size={15} />
              </ToolButton>
              <ToolDivider />
            </>
          ) : null}

          {hasImage && !isMobile ? (
            <>
              <ToolButton
                active={showRulers}
                aria-pressed={showRulers}
                label="Toggle rulers"
                onClick={toggleRulers}
              >
                <RulerIcon size={15} />
              </ToolButton>
              {showRulers ? (
                <select
                  className="h-7 shrink-0 cursor-pointer rounded-md border-0 bg-transparent px-1 text-[11px] text-muted-foreground outline-none hover:text-foreground"
                  onChange={(e) => setRulerInterval(Number(e.target.value))}
                  title="Ruler interval"
                  value={rulerInterval}
                >
                  <option value={25}>25px</option>
                  <option value={50}>50px</option>
                  <option value={100}>100px</option>
                  <option value={200}>200px</option>
                </select>
              ) : null}
              <ToolButton
                active={showGrid}
                aria-pressed={showGrid}
                label="Toggle grid"
                onClick={toggleGrid}
              >
                <GridIcon size={15} />
              </ToolButton>
              <ToolDivider />
            </>
          ) : null}

          <Popover onOpenChange={setAspectRatioOpen} open={aspectRatioOpen}>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg text-muted-foreground',
                  'transition-colors duration-150 hover:bg-foreground/[0.06] hover:text-foreground',
                  isMobile ? 'px-2' : 'px-2.5'
                )}
                type="button"
              >
                <AspectRatioIcon size={15} />
                <span className="font-mono text-xs leading-none tabular-nums">
                  {currentAspectRatio
                    ? `${currentAspectRatio.width}:${currentAspectRatio.height}`
                    : 'Auto'}
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="center"
              className="w-[420px] p-0"
              collisionPadding={16}
              sideOffset={10}
            >
              <AspectRatioPicker onSelect={() => setAspectRatioOpen(false)} />
            </PopoverContent>
          </Popover>

          {slides.length > 0 && !isMobile ? (
            <label className="inline-flex shrink-0 cursor-pointer">
              <input
                accept="image/*"
                className="hidden"
                multiple
                onChange={(e) => {
                  if (e.target.files?.length) {
                    useImageStore.getState().addImages(Array.from(e.target.files))
                  }
                }}
                type="file"
              />
              <span className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium leading-none text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground">
                <Add01Icon size={14} />
                <span>Add Slide</span>
              </span>
            </label>
          ) : null}
        </div>

        <div className="flex items-center gap-1 justify-self-end">
          {hasContent && !isMobile ? (
            <ToolButton className="hover:text-destructive" label="Remove" onClick={removeScreenshot}>
              <Delete02Icon size={15} />
            </ToolButton>
          ) : null}
          <ToolButton
            disabled={!hasContent || isExporting || isCopying}
            label="Copy"
            onClick={() => copyImage()}
          >
            <Copy01Icon size={15} />
          </ToolButton>

          {hasImage && showVideoExport && !isMobile ? (
            <button
              className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-foreground/[0.08] px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-foreground/[0.06]"
              onClick={() => setExportSlideshowOpen(true)}
              type="button"
            >
              <Video01Icon size={14} />
              <span>Export Video</span>
            </button>
          ) : null}

          <ShareButton compact={isMobile} disabled={!hasContent} render={renderExportBlob} />

          <Popover onOpenChange={isExporting ? undefined : setExportOpen} open={exportOpen}>
            <PopoverTrigger asChild>
              <button
                aria-label="Save"
                className={cn(
                  'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-foreground text-[13px] font-medium text-background',
                  'transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.98]',
                  'disabled:pointer-events-none disabled:opacity-35',
                  isMobile ? 'px-2' : 'px-3'
                )}
                disabled={!hasContent}
                type="button"
              >
                <Download04Icon size={15} />
                {!isMobile ? <span>Save</span> : null}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-[340px] p-0"
              collisionPadding={16}
              onPointerDownOutside={isExporting ? (e) => e.preventDefault() : undefined}
              sideOffset={10}
            >
              {isExporting ? (
                <div className="p-5">
                  <p className="mb-1 text-sm font-medium text-foreground">Exporting...</p>
                  <p className="mb-4 text-xs text-muted-foreground">Rendering your creation</p>
                  <ImageExportProgressView format={exportSettings.format} progress={progress} />
                </div>
              ) : (
                <div className="space-y-4 p-4">
                  <FormatSelector format={exportSettings.format} onFormatChange={updateFormat} />
                  <QualityPresetSelector
                    format={exportSettings.format}
                    onQualityPresetChange={updateQualityPreset}
                    qualityPreset={exportSettings.qualityPreset}
                  />
                  <ScaleSlider onScaleChange={updateScale} scale={exportSettings.scale} />

                  {exportError && (
                    <div className="rounded-md border border-destructive/20 bg-destructive/10 p-2.5 text-xs text-destructive">
                      {exportError}
                    </div>
                  )}

                  <Button
                    className="h-10 w-full rounded-md text-sm font-semibold transition-all"
                    disabled={isExporting}
                    onClick={handleExport}
                  >
                    <Download01Icon className="mr-2" size={16} />
                    Export as {formatLabel}
                  </Button>

                  <SaveToWorkspaceButton createExport={renderExportBlob} disabled={isExporting} />

                  {slides.length > 1 && (
                    <Button
                      className="h-10 w-full rounded-md text-sm font-semibold transition-all"
                      disabled={isExporting || isBatchExporting}
                      onClick={handleExportAll}
                      variant="outline"
                    >
                      <FileZipIcon className="mr-2" size={16} />
                      Export All ({slides.length})
                    </Button>
                  )}
                </div>
              )}
            </PopoverContent>
          </Popover>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label="More"
                    className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground data-[state=open]:bg-foreground/[0.08] data-[state=open]:text-foreground"
                    type="button"
                  >
                    <MoreHorizontalIcon size={16} />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">More</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-52" sideOffset={8}>
              <DropdownMenuItem onSelect={() => setShortcutsOpen(true)}>
                <KeyboardIcon size={15} />
                Keyboard shortcuts
              </DropdownMenuItem>
              {hasContent || uploadedImageUrl ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setResetOpen(true)} variant="destructive">
                    <RefreshIcon size={15} />
                    Start over
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>

          {!isMobile ? <FeedbackWidget /> : null}
          <AccountMenu />
        </div>
      </header>

      <AlertDialog onOpenChange={setResetOpen} open={resetOpen}>
        <AlertDialogContent className="sm:max-w-[420px]">
          <AlertDialogHeader>
            <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive sm:mx-0">
              <RefreshIcon aria-hidden="true" size={18} />
            </div>
            <AlertDialogTitle>Start over?</AlertDialogTitle>
            <AlertDialogDescription>
              This resets the design: background, frame, text, stickers, markup, devices, and
              animation. Your screenshots stay, and you can undo it with ⌘Z.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/30"
              onClick={resetCanvasSettings}
            >
              Start over
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      <CopyProgressDialog open={isCopying} progress={copyProgress} />

      <BatchExportProgressDialog
        open={isBatchExporting}
        batchProgress={batchProgress}
        format={exportSettings.format}
      />

      <ExportSlideshowDialog open={exportSlideshowOpen} onOpenChange={setExportSlideshowOpen} />
    </>
  )
}
