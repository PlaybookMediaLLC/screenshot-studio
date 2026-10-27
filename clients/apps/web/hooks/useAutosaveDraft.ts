"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_IMAGE_PLACEMENT,
  useImageStore,
  OmitFunctions,
  ImageState,
} from "@/lib/store";
import { toast } from "sonner";
import {
  compactDeviceScreenForDraft,
} from "@/lib/device-mockups/layouts";
import {
  normalizeDraftMockups,
  resolveRestoredEditorMode,
} from "@/lib/device-mockups/draft-migration";
import {
  saveDraft,
  getDraft,
  blobUrlToBase64,
  deleteDraft,
  migrateFromLocalStorage,
  autoCleanIndexedDB,
} from "@/lib/draft-storage";
import type { PersistedImageState } from "@/lib/draft-storage";
import { useProjectSession } from '@/lib/projects/session'
import { trackDraftRestore } from "@/lib/projects/draft-ready";

const AUTOSAVE_DELAY = 1000;
// A returning editor waits for the save started by the previous mount.
let pendingDraftSave: Promise<void> = Promise.resolve();
// Navigation keeps the live store. Rehydrating it again would replace uploaded
// URLs with draft data URLs and turn a clean project into an unsaved edit.
let restoredThisPage = false;

/**
 * Live session state. It is written to the draft so the persisted shape stays
 * complete, but always at its idle value — a restored draft should open with
 * nothing playing and no tool armed, whatever the user was doing when they left.
 */
const IDLE_SESSION_STATE = {
  isPreviewing: false,
  previewIndex: 0,
  previewStartedAt: null,
  activeAnnotationTool: null,
  selectedAnnotationId: null,
  showTemplates: false,
} satisfies Partial<OmitFunctions<ImageState>>;

/**
 * Blob URLs die with the page, so anything blob-backed must be inlined as a
 * data URL to survive a reload. Re-encoding a 4K image on every autosave tick
 * is far too slow, so conversions are cached by blob URL.
 */
const MAX_CACHED_BLOBS = 24;
const blobToDataUrlCache = new Map<string, string>();

async function toPersistableSrc(src: string): Promise<string> {
  if (!src.startsWith("blob:")) return src;

  const cached = blobToDataUrlCache.get(src);
  if (cached) return cached;

  const dataUrl = await blobUrlToBase64(src);
  if (blobToDataUrlCache.size >= MAX_CACHED_BLOBS) {
    const oldest = blobToDataUrlCache.keys().next().value;
    if (oldest !== undefined) blobToDataUrlCache.delete(oldest);
  }
  blobToDataUrlCache.set(src, dataUrl);
  return dataUrl;
}

/**
 * Derive the persisted image state from the store rather than listing fields by
 * hand. Hand-listing is what silently dropped annotations, blur regions, slides
 * and timeline data: anything a developer forgot to add was written as an empty
 * default. Deriving inverts that — new state is persisted unless explicitly
 * normalized above.
 */
function toPersistedImageState(state: ImageState): OmitFunctions<ImageState> {
  const persisted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (typeof value === "function") continue;
    persisted[key] = value;
  }

  return {
    ...(persisted as OmitFunctions<ImageState>),
    ...IDLE_SESSION_STATE,
  };
}

/** A saved timeline without the playback position older drafts stored in it. */
function withoutPlayback(timeline: ImageState["timeline"] & { playhead?: unknown; isPlaying?: unknown }) {
  const { playhead: _playhead, isPlaying: _isPlaying, ...rest } = timeline;
  return rest;
}

/** Drop undefined keys so an older draft falls back to store defaults instead of
 * overwriting them with undefined. */
function definedOnly<T extends object>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<T>;
}

export function useAutosaveDraft() {
  const imageStore = useImageStore();
  const saveTimeoutRef = useRef<NodeJS.Timeout>(null);
  const hasLoadedRef = useRef(false);
  const restoreRef = useRef<Promise<void> | null>(null);
  const lastSnapshotRef = useRef<string>('');
  // Warn about a full quota once per session, not once per autosave tick.
  const hasWarnedQuotaRef = useRef(false);
  const conflictRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Load draft on mount
  useEffect(() => {
    const loadDraft = async () => {
      if (hasLoadedRef.current) return;
      if (restoredThisPage) {
        hasLoadedRef.current = true;
        lastSnapshotRef.current = JSON.stringify(toPersistedImageState(useImageStore.getState()));
        return;
      }

      try {
        await pendingDraftSave;
        // Migrate from localStorage to IndexedDB (one-time)
        await migrateFromLocalStorage();

        // Auto-clean IndexedDB on startup (removes old/corrupted data)
        const cleanResult = await autoCleanIndexedDB();
        if (cleanResult.cleaned) {
          console.warn('[draft] autoCleanIndexedDB wiped the draft:', cleanResult.reason);
        }

        const draft = await getDraft();
        if (!draft) {
          lastSnapshotRef.current = JSON.stringify(toPersistedImageState(useImageStore.getState()));
          hasLoadedRef.current = true;
          restoredThisPage = true;
          return;
        }

        // Restore the whole image state in one shot. Restoring field-by-field
        // is what lost annotations, blur regions and slides: any field without
        // an explicit line here silently stayed at its default.
        const img = draft.imageState;
        if (img) {
          const {
            timeline,
            browserUrl,
            mockups,
            deviceLayoutSnapshot,
            deviceScreenAssets,
            editorMode,
            ...rest
          } = img;
          const normalizeMockups = (draftMockups: typeof mockups) => normalizeDraftMockups(
            draftMockups,
            {
              uploadedImageUrl: img.uploadedImageUrl ?? null,
              imageName: img.imageName ?? null,
              canvasDimensions: img.canvasDimensions,
              deviceScreenAssets,
            },
          );
          const normalized = normalizeMockups(mockups);
          useImageStore.setState({
            ...definedOnly(rest),
            mockups: normalized.mockups,
            ...(editorMode !== undefined || normalized.migratedLegacyMockups
              ? {
                  editorMode: resolveRestoredEditorMode(
                    editorMode,
                    normalized.migratedLegacyMockups,
                  ),
                }
              : {}),
            ...(deviceLayoutSnapshot !== undefined
              ? {
                  deviceLayoutSnapshot: deviceLayoutSnapshot
                    ? normalizeMockups(deviceLayoutSnapshot).mockups
                    : null,
                }
              : {}),
            ...IDLE_SESSION_STATE,
            // Drafts from before the playback store carried the playhead here.
            ...(timeline ? { timeline: withoutPlayback(timeline) } : {}),
            // Drafts written before browserUrl existed fall back to the frame title.
            ...(browserUrl !== undefined
              ? { browserUrl }
              : img.imageBorder?.title
                ? { browserUrl: img.imageBorder.title }
                : {}),
          });
        }

        // Drafts from before the single store kept these fields separately.
        const legacy = draft.editorState;
        if (legacy && !img?.imagePlacement) {
          useImageStore.setState({
            imagePlacement: {
              offsetX: legacy.screenshot?.offsetX ?? DEFAULT_IMAGE_PLACEMENT.offsetX,
              offsetY: legacy.screenshot?.offsetY ?? DEFAULT_IMAGE_PLACEMENT.offsetY,
              rotation: legacy.screenshot?.rotation ?? DEFAULT_IMAGE_PLACEMENT.rotation,
            },
            ...(legacy.canvas?.padding !== undefined ? { canvasPadding: legacy.canvas.padding } : {}),
            ...(legacy.pattern ? { pattern: legacy.pattern } : {}),
          });
        }
        // Restoring the draft is where this session starts, not an undoable step.
        useImageStore.temporal.getState().clear();

        setLastSaved(new Date(draft.timestamp));
        lastSnapshotRef.current = JSON.stringify(toPersistedImageState(useImageStore.getState()));
        hasLoadedRef.current = true;
        restoredThisPage = true;
      } catch (error) {
        console.error("Failed to load draft:", error);
        hasLoadedRef.current = true;
      }
    };

    restoreRef.current ??= loadDraft();
    trackDraftRestore(restoreRef.current);
  }, []);

  const saveNow = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = null;
    if (!hasLoadedRef.current || conflictRef.current) return pendingDraftSave;
    // Capture before navigation can replace the live project; serialize writes.
    const persistedImage = toPersistedImageState(useImageStore.getState());
    const save = async () => {
      try {
        // The dirty check covers everything that actually gets persisted, so
        // editing any feature — including ones added later — marks the draft
        // dirty. Previously it tracked a hand-picked subset, so changes to
        // untracked state were skipped as "nothing changed".
        const snapshot = JSON.stringify(persistedImage);

        if (snapshot === lastSnapshotRef.current) {
          return; // Nothing changed — skip save
        }

        setIsSaving(true);

        // Inline every blob-backed source as a data URL — blob: references are
        // dead on the next page load.
        const rawUploadedImageUrl = persistedImage.uploadedImageUrl;
        const processedUploadedImageUrl = rawUploadedImageUrl
          ? await toPersistableSrc(rawUploadedImageUrl)
          : null;

        const processedBackgroundConfig = { ...persistedImage.backgroundConfig };
        if (
          processedBackgroundConfig.type === "image" &&
          typeof processedBackgroundConfig.value === "string"
        ) {
          processedBackgroundConfig.value = await toPersistableSrc(
            processedBackgroundConfig.value
          );
        }

        const processedImageOverlays = await Promise.all(
          persistedImage.imageOverlays.map(async (overlay) =>
            overlay.isCustom
              ? { ...overlay, src: await toPersistableSrc(overlay.src) }
              : overlay
          )
        );

        // Slides hold blob URLs created from the uploaded File objects. Without
        // this they restore as dead references and the deck renders empty —
        // which also silently removes batch export, since it needs 2+ slides.
        const processedSlides = await Promise.all(
          persistedImage.slides.map(async (slide) => ({
            ...slide,
            src: await toPersistableSrc(slide.src),
          }))
        );

        const deviceScreenAssets: Record<string, string> = {};
        const deviceScreenAssetIds = new Map<string, string>();
        const processMockups = async (mockups: typeof persistedImage.mockups) => (
          Promise.all(mockups.map(async (mockup) => {
            const screen = compactDeviceScreenForDraft(
              mockup.screen,
              rawUploadedImageUrl ?? null,
            );
            const src = screen.src ? await toPersistableSrc(screen.src) : null;
            if (screen.isCustom && src) {
              let assetId = deviceScreenAssetIds.get(src);
              if (!assetId) {
                assetId = `screen-${deviceScreenAssetIds.size + 1}`;
                deviceScreenAssetIds.set(src, assetId);
                deviceScreenAssets[assetId] = src;
              }
              return {
                ...mockup,
                screen: {
                  ...screen,
                  src: null,
                  sourceRef: `device-screen:${assetId}` as const,
                },
              };
            }
            return {
              ...mockup,
              screen: {
                ...screen,
                src,
              },
            };
          }))
        );
        // Timeline audio is blob-backed like images; inline it so it survives a reload.
        const processedMotion = {
          ...persistedImage.motion,
          audio: await Promise.all(
            persistedImage.motion.audio.map(async (clip) => ({
              ...clip,
              src: await toPersistableSrc(clip.src),
            }))
          ),
        };

        const processedMockups = await processMockups(persistedImage.mockups);
        const processedDeviceLayoutSnapshot = persistedImage.deviceLayoutSnapshot
          ? await processMockups(persistedImage.deviceLayoutSnapshot)
          : persistedImage.deviceLayoutSnapshot;

        // Spread the derived state, then override only the fields whose blob
        // sources had to be inlined above.
        const imageState: PersistedImageState = {
          ...persistedImage,
          uploadedImageUrl: processedUploadedImageUrl,
          backgroundConfig: processedBackgroundConfig,
          imageOverlays: processedImageOverlays,
          slides: processedSlides,
          motion: processedMotion,
          mockups: processedMockups,
          deviceLayoutSnapshot: processedDeviceLayoutSnapshot,
          deviceScreenAssets,
        };

        const result = await saveDraft(imageState);

        if (!result.ok) {
          if (result.reason === 'conflict') {
            conflictRef.current = true;
            // Saved projects use server revisions for conflicts; the shared local
            // recovery slot is not their save status.
            if (useProjectSession.getState().projectId) return;
            toast.error('This draft was changed in another tab', {
              id: 'draft-conflict',
              description: 'This tab has stopped saving locally. Export your work or save it as a project before reloading.',
              duration: Infinity,
            });
          }
          // Leave lastSnapshotRef untouched so the next change retries this
          // save instead of treating the failed write as already persisted.
          console.warn("[draft] autosave failed:", result.reason, result.error);
          if (result.reason === "quota" && !hasWarnedQuotaRef.current) {
            hasWarnedQuotaRef.current = true;
            toast.error("Couldn't save your draft", {
              description:
                "Browser storage is full. Export your work — recent changes may not survive a reload.",
              duration: 10000,
            });
          }
          return;
        }

        lastSnapshotRef.current = snapshot;
        setLastSaved(new Date());
      } catch (error) {
        console.warn("[draft] autosave threw:", error);
      } finally {
        setIsSaving(false);
      }
    };
    pendingDraftSave = pendingDraftSave.then(save, save);
    return pendingDraftSave;
  }, []);

  useEffect(() => {
    if (!hasLoadedRef.current) return;
    saveTimeoutRef.current = setTimeout(() => void saveNow(), AUTOSAVE_DELAY);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [imageStore, saveNow]);

  useEffect(() => {
    const flush = () => void saveNow();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasLoadedRef.current || useProjectSession.getState().projectId) return;
      const snapshot = JSON.stringify(toPersistedImageState(useImageStore.getState()));
      if (snapshot === lastSnapshotRef.current) return;
      flush();
      event.preventDefault();
      event.returnValue = "You have unsaved changes.";
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", onBeforeUnload);
      flush();
    };
  }, [saveNow]);

  useEffect(() => useProjectSession.subscribe((session, previous) => {
    if (session.projectId) toast.dismiss('draft-conflict');
    else if (previous.projectId && conflictRef.current) {
      toast.warning('Local recovery is paused', { id: 'draft-conflict', duration: Infinity,
        description: 'Another tab owns this browser draft. Save this design as a project or export it before closing.' });
    }
  }), []);

  const clearDraft = async () => {
    try {
      await deleteDraft();
      conflictRef.current = false;
      toast.dismiss('draft-conflict');
      imageStore.resetSlideshow();
      imageStore.clearImage();
      imageStore.clearTextOverlays();
      imageStore.clearImageOverlays();
      imageStore.clearMockups();

      setLastSaved(null);
    } catch (error) {
      console.error("Failed to clear draft:", error);
      throw error;
    }
  };

  return { isSaving, lastSaved, clearDraft };
}
