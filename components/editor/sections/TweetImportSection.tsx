'use client';

import * as React from 'react';
import { useImageStore } from '@/lib/store';
import { getAspectRatioPreset } from '@/lib/aspect-ratio-utils';
import { domToCanvas } from 'modern-screenshot';
import { ArrowDown01Icon, Cancel01Icon, LinkSquare02Icon, Loading03Icon, NewTwitterIcon } from 'hugeicons-react';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Button } from '@/components/ui/button';
import { TWEET_WIDTH, TweetCard, parseTweetId, type TweetData } from '@/components/tweet-image/TweetCard';

type Status = 'idle' | 'loading' | 'loaded' | 'capturing';

export function TweetImportSection() {
  const { setUploadedImageUrl, setImageOpacity, setImageScale, setBorderRadius, selectedAspectRatio } = useImageStore();

  const [urlInput, setUrlInput] = React.useState('');
  const [tweetData, setTweetData] = React.useState<TweetData | null>(null);
  const [tweetTheme, setTweetTheme] = React.useState<'light' | 'dark'>('dark');
  const [status, setStatus] = React.useState<Status>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [isOpen, setIsOpen] = React.useState(false);
  const requestAbortRef = React.useRef<AbortController | null>(null);

  // Separate ref for the off-screen full-width capture element
  const hiddenCaptureRef = React.useRef<HTMLDivElement>(null);
  // Preview: render at TWEET_WIDTH, scale down to sidebar width
  const previewWrapRef = React.useRef<HTMLDivElement>(null);
  const previewInnerRef = React.useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = React.useState(1);
  const [previewHeight, setPreviewHeight] = React.useState<number | undefined>(undefined);

  // Recalculate scale + height whenever the wrapper or inner content changes
  React.useEffect(() => {
    const wrap = previewWrapRef.current;
    const inner = previewInnerRef.current;
    if (!wrap || !inner) return;

    const update = () => {
      const wrapW = wrap.clientWidth;
      const s = wrapW > 0 ? wrapW / TWEET_WIDTH : 1;
      setPreviewScale(s);
      setPreviewHeight(inner.scrollHeight * s);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrap);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [tweetData, tweetTheme]);

  // ── Fetch tweet ──
  const fetchTweet = React.useCallback(
    async (input: string) => {
      const id = parseTweetId(input);
      if (!id) {
        setError('Enter a valid tweet URL or ID');
        return;
      }

      setStatus('loading');
      setError(null);
      setTweetData(null);

      requestAbortRef.current?.abort();
      const controller = new AbortController();
      requestAbortRef.current = controller;
      let timedOut = false;
      const timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 20000);

      try {
        const res = await fetch(`/api/tweet/${id}`, { signal: controller.signal });
        const json = await res.json();
        if (requestAbortRef.current !== controller) return;

        if (!res.ok || !json.data) {
          setError(json.error || 'Tweet not found');
          setStatus('idle');
        } else {
          setTweetData(json.data as TweetData);
          setStatus('loaded');
        }
      } catch {
        if (requestAbortRef.current !== controller) return;
        setError(timedOut ? 'Tweet preview timed out. Try again' : 'Failed to fetch tweet');
        setStatus('idle');
      } finally {
        window.clearTimeout(timeoutId);
        if (requestAbortRef.current === controller) {
          requestAbortRef.current = null;
        }
      }
    },
    []
  );

  React.useEffect(() => {
    return () => requestAbortRef.current?.abort();
  }, []);

  const handleCancelFetch = React.useCallback(() => {
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    setStatus('idle');
    setError(null);
  }, []);

  const handleDismissPreview = React.useCallback(() => {
    setTweetData(null);
    setStatus('idle');
  }, []);

  // ── Add to canvas ──
  // Captures from the hidden off-screen element which is already at TWEET_WIDTH.
  // Scales to fill canvas (same approach as CodeSnippetSection).
  const handleAddToCanvas = React.useCallback(async () => {
    if (!hiddenCaptureRef.current) return;
    setStatus('capturing');

    try {
      // Wait for images in the hidden capture element to load
      const images = hiddenCaptureRef.current.querySelectorAll('img');
      await Promise.all(
        Array.from(images).map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete) return resolve();
              img.onload = () => resolve();
              img.onerror = () => resolve();
            })
        )
      );

      // Scale to fill canvas width, minimum 2x for retina
      const preset = getAspectRatioPreset(selectedAspectRatio);
      const targetWidth = preset?.width || 1920;
      const captureScale = Math.max(2, targetWidth / TWEET_WIDTH);

      const captureBg = tweetTheme === 'dark' ? '#000000' : '#ffffff';
      const canvas = await domToCanvas(hiddenCaptureRef.current, {
        scale: captureScale,
        backgroundColor: captureBg,
      });

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png')
      );

      if (blob) {
        const url = URL.createObjectURL(blob);
        setUploadedImageUrl(url, 'tweet-screenshot.png');
        setImageOpacity(1);
        setImageScale(100);
        setBorderRadius(16);
        setTweetData(null);
        setUrlInput('');
        setStatus('idle');
      }
    } catch (e) {
      console.error('Tweet capture failed:', e);
      setError('Failed to capture tweet');
      setStatus('loaded');
    }
  }, [setUploadedImageUrl, setImageOpacity, setImageScale, setBorderRadius, tweetTheme, selectedAspectRatio]);

  return (
    <>
      <div className="mb-1 px-2">
        <div className="overflow-hidden rounded-md border border-foreground/10 bg-foreground/[0.04] transition-colors hover:bg-foreground/[0.06]">
          <button
            type="button"
            onClick={() => setIsOpen((open) => !open)}
            aria-expanded={isOpen}
            aria-controls="tweet-import-content"
            className="group flex w-full items-center gap-3 px-3 py-3 text-left"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-foreground/[0.06] text-foreground">
              <NewTwitterIcon size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">Add a Tweet</span>
              <span className="block truncate text-xs text-muted-foreground">Turn any X post into an image</span>
            </span>
            <ArrowDown01Icon
              size={16}
              className={`shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none group-hover:text-foreground ${isOpen ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </button>

          <div
            id="tweet-import-content"
            hidden={!isOpen}
          >
            <div>
              <div className="space-y-3 border-t border-foreground/10 px-3 pb-3 pt-3">
          <p className="whitespace-nowrap text-[10px] leading-4 text-muted-foreground">
            Fetch, preview, then add to canvas.
          </p>

          <div className="space-y-2">
            <label
              htmlFor="tweet-url"
              className="block text-[10px] font-medium leading-4 text-foreground"
            >
              Tweet URL
            </label>

            <div className="relative">
              <LinkSquare02Icon
                size={14}
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50"
              />
              <input
                id="tweet-url"
                type="url"
                value={urlInput}
                onChange={(event) => {
                  setUrlInput(event.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') fetchTweet(urlInput);
                }}
                placeholder="https://x.com/user/status/..."
                spellCheck={false}
                autoComplete="off"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'tweet-url-error' : undefined}
                className="h-9 w-full rounded-md border border-foreground/10 bg-foreground/4 pl-8 pr-9 text-[11px] text-foreground outline-none transition-[border-color,box-shadow] max-[768px]:h-11 placeholder:text-muted-foreground/50 focus-visible:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring/40"
              />
              {urlInput ? (
                <button
                  type="button"
                  onClick={() => {
                    setUrlInput('');
                    setError(null);
                    setTweetData(null);
                    setStatus('idle');
                  }}
                  aria-label="Clear tweet URL"
                  className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground after:absolute after:-inset-2 after:content-[''] hover:bg-foreground/6 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <Cancel01Icon size={13} aria-hidden="true" />
                </button>
              ) : null}
            </div>

            {error ? (
              <div
                id="tweet-url-error"
                role="alert"
                className="rounded-md border border-destructive/20 bg-destructive/10 px-2.5 py-2 text-[10px] leading-4 text-destructive"
              >
                {error}
              </div>
            ) : null}

            {status === 'idle' && urlInput.trim() && !tweetData && !error ? (
              <div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => fetchTweet(urlInput)}
                  className="h-9 w-full text-[11px] max-[768px]:h-11"
                >
                  Fetch tweet
                </Button>
                <p className="mt-2 text-[9px] leading-4 text-muted-foreground">
                  You will review the screenshot before it reaches the canvas.
                </p>
              </div>
            ) : null}
          </div>

          {status === 'loading' ? (
            <div
              role="status"
              aria-live="polite"
              className="rounded-md border border-foreground/10 bg-foreground/4 p-3"
            >
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground/8 text-foreground">
                  <Loading03Icon
                    size={15}
                    aria-hidden="true"
                    className="motion-safe:animate-spin"
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold leading-4 text-foreground">
                    Fetching tweet
                  </p>
                  <p className="text-[9px] leading-4 text-muted-foreground">
                    Fetching post details and media
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCancelFetch}
                  className="ml-auto min-h-6 cursor-pointer rounded-md px-2 py-1 text-[9px] font-medium text-muted-foreground max-[768px]:min-h-11 hover:bg-foreground/6 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {tweetData && status !== 'loading' ? (
            <div className="space-y-2.5">
              <SegmentedControl
                size="sm"
                value={tweetTheme}
                onChange={(id) => setTweetTheme(id as 'light' | 'dark')}
                options={[
                  { id: 'light', label: 'Light' },
                  { id: 'dark', label: 'Dark' },
                ]}
                className="w-full"
              />

              <div className="relative">
                <button
                  type="button"
                  onClick={handleDismissPreview}
                  disabled={status === 'capturing'}
                  aria-label="Dismiss preview"
                  className="absolute right-2 top-2 z-10 flex size-6 cursor-pointer items-center justify-center rounded-md bg-foreground/10 text-muted-foreground backdrop-blur-sm after:absolute after:-inset-2.5 after:content-[''] transition-colors hover:bg-foreground/20 hover:text-foreground disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <Cancel01Icon size={12} aria-hidden="true" />
                </button>
                <div
                  ref={previewWrapRef}
                  className="rounded-md border border-foreground/10 ring-1 ring-foreground/4"
                  style={{
                    overflow: 'hidden',
                    height: previewHeight,
                    backgroundColor: tweetTheme === 'dark' ? '#000000' : '#ffffff',
                  }}
                >
                  <div
                    ref={previewInnerRef}
                    style={{
                      width: TWEET_WIDTH,
                      transform: `scale(${previewScale})`,
                      transformOrigin: 'top left',
                    }}
                  >
                    <TweetCard tweet={tweetData} theme={tweetTheme} />
                  </div>
                </div>
              </div>

              <Button
                type="button"
                size="sm"
                onClick={handleAddToCanvas}
                disabled={status === 'capturing'}
                className="h-9 w-full text-[11px] max-[768px]:h-11"
              >
                {status === 'capturing' ? (
                  <>
                    <Loading03Icon
                      size={13}
                      aria-hidden="true"
                      className="motion-safe:animate-spin"
                    />
                    Adding{'\u2026'}
                  </>
                ) : (
                  'Add to canvas'
                )}
              </Button>
            </div>
          ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

    {tweetData && (
      <div
        aria-hidden
        style={{
          position: 'fixed',
          left: '-99999px',
          top: 0,
          pointerEvents: 'none',
          zIndex: -1,
        }}
      >
        <div
          ref={hiddenCaptureRef}
          style={{
            width: TWEET_WIDTH,
            backgroundColor: tweetTheme === 'dark' ? '#000000' : '#ffffff',
          }}
        >
          <TweetCard tweet={tweetData} theme={tweetTheme} />
        </div>
      </div>
    )}
    </>
  );
}
