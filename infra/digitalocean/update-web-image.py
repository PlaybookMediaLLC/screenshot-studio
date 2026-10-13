#!/usr/bin/env python3
"""Update the live web image and its predeploy job without replacing the app spec."""

import argparse
import copy
import json
import os
import re
from pathlib import Path

IMAGE = {"registry_type": "GHCR", "registry": "playbookmediallc", "repository": "screenshot-studio"}
SERVICES = {"web", "storage", "design-renderer", "screenshot-studio-backend"}
JOBS = {"web-migrate", "postiz-migrate"}


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
    if set(services) != SERVICES or set(jobs) != JOBS:
        raise ValueError("Production topology changed; inspect the app before updating web")

    image = dict(IMAGE, tag=tag)
    for component in (services["web"], jobs["web-migrate"]):
        current = component.get("image", {})
        if any(current.get(key) != value for key, value in IMAGE.items()):
            raise ValueError(f"{component['name']} image source changed")
        component["image"] = copy.deepcopy(image)

    web_envs = services["web"].setdefault("envs", [])
    source = next((item for item in web_envs if item["key"] == "CLIENT_IP_SOURCE"), None)
    if source is None:
        web_envs.append({"key": "CLIENT_IP_SOURCE", "value": "digitalocean",
                         "type": "GENERAL", "scope": "RUN_TIME"})
    else:
        source["value"] = "digitalocean"

    if secrets is not None:
        for component in (services["web"], jobs["web-migrate"]):
            for item in component.get("envs", []):
                if item.get("type") != "SECRET":
                    continue
                source = ("MIGRATION_DATABASE_URL" if component["name"] == "web-migrate"
                          and item["key"] == "DATABASE_URL" else item["key"])
                if not secrets.get(source):
                    raise ValueError(f"Missing Infisical secret: {source}")
                item["value"] = secrets[source]
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
    print("Prepared web and web-migrate image update")


if __name__ == "__main__":
    main()
