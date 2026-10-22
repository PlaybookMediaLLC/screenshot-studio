# Public image delivery

Bundled product images live in the public R2 bucket `screenshot-studio-public-assets`. Workspace uploads continue to use private tenant storage.

After adding or changing an image under `public/`:

1. Run `npm run assets:manifest` to regenerate `lib/assets/public-images.json`.
2. Authenticate Wrangler for the Playbook account, then run `npm run upload-all-to-r2`. It uploads content-versioned keys and verifies uploaded bytes and cache headers. Unchanged objects are reused.
3. Commit the image and manifest together before deploying. The unit suite rejects a stale manifest.

`NEXT_PUBLIC_R2_PUBLIC_URL` enables production delivery. `publicImageUrl()` returns a versioned `/r2-assets/static/…` URL, proxied to R2 with a one-year immutable browser cache. Same-origin delivery preserves canvas export without requiring public CORS changes. Existing saved local image paths redirect to their current version. Changing an image changes its URL, so cached old versions cannot hide an update.

Production Docker builds omit the manifest-listed public images when R2 is configured. Local builds without R2 keep serving bundled files. Fonts and other runtime assets remain bundled. Publish images before deploying; keep old immutable objects so existing saved projects remain usable.
