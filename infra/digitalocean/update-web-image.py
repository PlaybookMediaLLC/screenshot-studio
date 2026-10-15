#!/usr/bin/env python3
"""Update the live web image without replacing the app spec.

The web has no database; the backend image's platform-migrate job owns the schema.
"""

import argparse
import copy
import json
import os
import re
from pathlib import Path

IMAGE = {"registry_type": "GHCR", "registry": "playbookmediallc", "repository": "screenshot-studio"}
SERVICES = {"web", "storage", "screenshot-studio-backend"}
# Designs render in Cloudflare Browser Rendering over CDP, not a render service.
RETIRED_SERVICES = {"design-renderer"}
RETIRED_WEB_KEYS = {"PLATFORM_RENDER_SERVICE_URL", "PLATFORM_RENDER_SERVICE_SECRET"}
JOBS = {"platform-migrate", "postiz-migrate"}
# The web reaches data and storage only through the backend (same list as render-spec.py).
WEB_DATABASE_KEYS = {"DATABASE_URL", "DIRECT_URL", "MIGRATION_DATABASE_URL", "AUDIT_RETENTION_DATABASE_URL",
                     "STORAGE_SERVICE_KEY", "STORAGE_API_URL", "STORAGE_PROXY_URL", "STORAGE_BUCKET",
                     "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ACCOUNT_ID", "R2_BUCKET_NAME", "R2_ENDPOINT", "R2_REGION",
                     "POSTIZ_API_URL", "POSTIZ_API_KEY"}


def update_web_image(base, tag, secrets=None):
    if not re.fullmatch(r"web-[0-9a-f]{40}", tag):
        raise ValueError("Expected a unique web-<commit SHA> image tag")
    if isinstance(base, list):
        if len(base) != 1:
            raise ValueError("Expected one DigitalOcean app")
        base = base[0]
    spec = copy.deepcopy(base.get("spec", base))
    services = {item["name"]: item for item in spec["services"]}
    jobs = {item["name"]: item for item in spec.get("jobs", [])}
    if "web-migrate" in jobs:
        raise ValueError("Deploy the backend first; its platform-migrate job replaces web-migrate")
    if set(services) - RETIRED_SERVICES != SERVICES or set(jobs) != JOBS:
        raise ValueError("Production topology changed; inspect the app before updating web")

    web = services["web"]
    current = web.get("image", {})
    if any(current.get(key) != value for key, value in IMAGE.items()):
        raise ValueError("web image source changed")
    web["image"] = dict(IMAGE, tag=tag)

    spec["services"] = [item for item in spec["services"] if item["name"] not in RETIRED_SERVICES]
    web_envs = web["envs"] = [item for item in web.get("envs", [])
                              if item["key"] not in WEB_DATABASE_KEYS | RETIRED_WEB_KEYS]
    if secrets is not None:
        if not secrets.get("PLATFORM_RENDER_CDP_URL"):
            raise ValueError("Missing Infisical secret: PLATFORM_RENDER_CDP_URL")
        web_envs[:] = [item for item in web_envs if not item["key"].startswith("PLATFORM_RENDER_CDP_")]
        web_envs += [{"key": "PLATFORM_RENDER_CDP_URL", "value": secrets["PLATFORM_RENDER_CDP_URL"],
                      "type": "GENERAL", "scope": "RUN_TIME"},
                     # Filled from Infisical with the other secrets below.
                     {"key": "PLATFORM_RENDER_CDP_TOKEN", "value": "", "type": "SECRET", "scope": "RUN_TIME"}]
    source = next((item for item in web_envs if item["key"] == "CLIENT_IP_SOURCE"), None)
    if source is None:
        web_envs.append({"key": "CLIENT_IP_SOURCE", "value": "digitalocean",
                         "type": "GENERAL", "scope": "RUN_TIME"})
    else:
        source["value"] = "digitalocean"

    if secrets is not None:
        for item in web_envs:
            if item.get("type") != "SECRET":
                continue
            if not secrets.get(item["key"]):
                raise ValueError(f"Missing Infisical secret: {item['key']}")
            item["value"] = secrets[item["key"]]
    return spec


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--from-infisical-env", action="store_true")
    args = parser.parse_args()
    spec = update_web_image(json.loads(args.base.read_text()), args.tag,
                            dict(os.environ) if args.from_infisical_env else None)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as output:
        os.fchmod(output.fileno(), 0o600)
        json.dump(spec, output)
    print("Prepared web image update")


if __name__ == "__main__":
    main()
