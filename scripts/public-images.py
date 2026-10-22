"""Generate the public image manifest; --upload publishes immutable objects to R2."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import mimetypes
import os
import re
from pathlib import Path
import subprocess
import urllib.request
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "lib/assets/public-images.json"
BUCKET = "screenshot-studio-public-assets"
ORIGIN = "https://shots-assets.oppulence.io"
CACHE = "public, max-age=31536000, immutable"
EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".svg", ".ico"}


def manifest():
    return {
        "/" + path.relative_to(ROOT / "public").as_posix():
        "static/" + hashlib.sha256(path.read_bytes()).hexdigest()[:20] + "/" + re.sub(r"[^A-Za-z0-9_./-]", "-", path.relative_to(ROOT / "public").as_posix())
        for path in sorted((ROOT / "public").rglob("*"))
        if path.is_file() and path.suffix.lower() in EXTENSIONS
    }


def upload(item):
    local, key = item
    path = ROOT / "public" / local.lstrip("/")
    url = ORIGIN + "/" + quote(key)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Mozilla/5.0 ShotsAssetPublisher"}), timeout=30) as response:
            if response.headers.get("Cache-Control") == CACHE and int(response.headers.get("Content-Length", 0)) == path.stat().st_size:
                return
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
    env = dict(os.environ, CLOUDFLARE_ACCOUNT_ID="de345701e5dc7e14d3c079da3e637448")
    result = subprocess.run([
        "npx", "--no-install", "wrangler", "r2", "object", "put", BUCKET + "/" + key,
        "--file", str(path), "--content-type", mimetypes.guess_type(path)[0] or "application/octet-stream",
        "--cache-control", CACHE,
    ], cwd=ROOT, env=env, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("R2 upload failed: " + local)
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 ShotsAssetPublisher"}), timeout=60) as response:
        assert response.headers.get("Cache-Control") == CACHE, local
        assert hashlib.sha256(response.read()).digest() == hashlib.sha256(path.read_bytes()).digest(), local
    print("Verified " + local, flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upload", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    images = manifest()
    assert images and all(key.startswith("static/") and ".." not in key.split("/") for key in images.values())
    content = json.dumps(images, indent=2) + "\n"
    if args.check:
        assert MANIFEST.read_text() == content, "Run npm run assets:manifest after changing public images"
    else:
        MANIFEST.parent.mkdir(parents=True, exist_ok=True)
        MANIFEST.write_text(content)
    if args.upload:
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(upload, images.items()))
    print(f"{len(images)} public images {'published' if args.upload else 'indexed'}")
