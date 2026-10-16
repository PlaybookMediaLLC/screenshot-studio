#!/usr/bin/env python3
"""Cut over the existing production spec to one image-backed backend service.

The input is a fresh `doctl apps get -o json` export. Keep input and output
private: both contain App Platform encrypted secret values.
"""

import argparse
import copy
import json
import os
import re
from pathlib import Path

OLD_BACKENDS = {"postiz-backend", "postiz-orchestrator", "publishing-backend", "publishing-orchestrator"}
BACKEND = "screenshot-studio-backend"
IMAGE = {"registry_type": "GHCR", "registry": "playbookmediallc", "repository": "screenshot-studio"}
SOCIAL_SECRET_SOURCES = {
    "REDIS_URL": "POSTIZ_REDIS_URL",
    "JWT_SECRET": "POSTIZ_JWT_SECRET",
    "TEMPORAL_API_KEY": "POSTIZ_TEMPORAL_API_KEY",
    "X_API_KEY": "POSTIZ_GO_X_API_KEY",
    "X_API_SECRET": "POSTIZ_GO_X_API_SECRET",
    "FACEBOOK_APP_ID": "POSTIZ_GO_FACEBOOK_APP_ID",
    "FACEBOOK_APP_SECRET": "POSTIZ_GO_FACEBOOK_APP_SECRET",
    "INSTAGRAM_APP_ID": "POSTIZ_GO_INSTAGRAM_APP_ID",
    "INSTAGRAM_APP_SECRET": "POSTIZ_GO_INSTAGRAM_APP_SECRET",
}
# Set on the app directly rather than in Infisical (the GitHub App behind
# release intake). Deploys keep their encrypted values as they are.
LIVE_ONLY_SECRETS = ("TENANT_GITHUB_APP_CLIENT_SECRET", "TENANT_GITHUB_APP_PRIVATE_KEY")
OPTIONAL_SOCIAL_SECRETS = (
    "LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "X_API_KEY", "X_API_SECRET",
    "FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET", "INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET",
)


def set_env(envs, key, value):
    for item in envs:
        if item["key"] == key:
            item["value"] = value
            return
    envs.append({"key": key, "value": value, "type": "GENERAL", "scope": "RUN_TIME"})


def set_secret_env(envs, key, value):
    for item in envs:
        if item["key"] == key:
            item.update(value=value, type="SECRET", scope="RUN_TIME")
            return
    envs.append({"key": key, "value": value, "type": "SECRET", "scope": "RUN_TIME"})


def publishing_token(services, secrets):
    if secrets is not None and secrets.get("PUBLISHING_SERVICE_TOKEN"):
        return secrets["PUBLISHING_SERVICE_TOKEN"]
    for name in (BACKEND, "publishing-backend"):
        for item in services.get(name, {}).get("envs", []):
            if item["key"] in ("TENANT_PUBLISHING_SERVICE_TOKEN", "PUBLISHING_SERVICE_TOKEN"):
                return item["value"]
    raise ValueError("PUBLISHING_SERVICE_TOKEN is required for the Ent publishing API")


def configure_publishing_api(backend, web, token, direct_enabled=False):
    set_secret_env(backend["envs"], "TENANT_PUBLISHING_SERVICE_TOKEN", token)
    set_env(backend["envs"], "TENANT_PUBLISHING_DIRECT_PROVIDER", "true" if direct_enabled else "false")
    if direct_enabled:
        social = {item["key"]: item for item in backend["envs"]}
        for key in ("POSTIZ_PRIVATE_MEDIA", "STORAGE_PROVIDER", "CLOUDFLARE_ACCOUNT_ID",
                    "CLOUDFLARE_BUCKETNAME", "CLOUDFLARE_BUCKET_URL", "CLOUDFLARE_ACCESS_KEY",
                    "CLOUDFLARE_SECRET_ACCESS_KEY"):
            if key not in social:
                raise ValueError(f"Direct publishing requires {key}")
            value = social[key]["value"]
            if social[key].get("type") == "SECRET":
                set_secret_env(backend["envs"], "TENANT_" + key, value)
            else:
                set_env(backend["envs"], "TENANT_" + key, value)
    backend["internal_ports"] = [3003, 8082]
    # The web reaches all data through the backend.
    set_env(web["envs"], "PUBLISHING_API_URL", f"http://{BACKEND}:8082")
    set_secret_env(web["envs"], "PUBLISHING_SERVICE_TOKEN", token)


def configure_product_api(backend, secrets):
    """The product API signs R2 transfers and counts workspace quotas in Redis."""
    if secrets is None:
        return
    for key in ("R2_ENDPOINT", "R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "REDIS_URL"):
        if not secrets.get(key):
            raise ValueError(f"Missing Infisical secret: {key}")
    set_env(backend["envs"], "TENANT_R2_ENDPOINT", secrets["R2_ENDPOINT"])
    set_env(backend["envs"], "TENANT_R2_BUCKET_NAME", secrets["R2_BUCKET_NAME"])
    set_env(backend["envs"], "TENANT_R2_REGION", secrets.get("R2_REGION") or "auto")
    for key in ("R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "REDIS_URL"):
        set_secret_env(backend["envs"], "TENANT_" + key, secrets[key])


def refresh_secrets(envs, secrets):
    if secrets is None:
        return
    for item in envs:
        if item.get("type") != "SECRET":
            continue
        key = item["key"]
        if key in OPTIONAL_SOCIAL_SECRETS:
            continue
        source = key.removeprefix("TENANT_") if key.startswith("TENANT_") else SOCIAL_SECRET_SOURCES.get(key, key)
        if secrets.get(source):
            item["value"] = secrets[source]
        elif key in LIVE_ONLY_SECRETS and item.get("value"):
            continue
        else:
            raise ValueError(f"Missing Infisical secret: {source}")


def shared_database(backend, migration, secrets=None):
    envs = {item["key"]: item for item in backend["envs"]}
    value = secrets.get("DATABASE_URL") if secrets is not None else envs["TENANT_DATABASE_URL"]["value"]
    if not value:
        raise ValueError("DATABASE_URL is required for the shared backend database")
    set_secret_env(backend["envs"], "DATABASE_URL", value)
    # Migrations need DDL; the runtime role can only read and write rows.
    owner = secrets.get("MIGRATION_DATABASE_URL") if secrets is not None else value
    if not owner:
        raise ValueError("MIGRATION_DATABASE_URL is required for the Postiz migration")
    set_secret_env(migration["envs"], "DATABASE_URL", owner)


def platform_migration(spec, postiz_migration, secrets=None):
    """Replace the web's Prisma job with the Go platform migrator in the backend image."""
    names = ("platform-migrate", "web-migrate")
    previous = next((item for item in spec.get("jobs", []) if item["name"] in names), None)
    if previous is None:
        raise ValueError("Platform migration job is missing")
    database = (secrets.get("MIGRATION_DATABASE_URL") if secrets is not None else
                next((item["value"] for item in previous.get("envs", []) if item["key"] == "DATABASE_URL"), None))
    if not database:
        raise ValueError("MIGRATION_DATABASE_URL is required for the platform migration")
    job = dict(copy.deepcopy(postiz_migration), name="platform-migrate", run_command="/platform-migrate",
               envs=[{"key": "DATABASE_URL", "value": database, "type": "SECRET", "scope": "RUN_TIME"}])
    spec["jobs"] = [job if item is previous else item for item in spec["jobs"]
                    if item is previous or item["name"] not in names]


def add_optional_social_secrets(envs, secrets):
    if secrets is None:
        return
    envs[:] = [item for item in envs if item["key"] not in OPTIONAL_SOCIAL_SECRETS or
               secrets.get(SOCIAL_SECRET_SOURCES.get(item["key"], item["key"]))]
    existing = {item["key"]: item for item in envs}
    for key in OPTIONAL_SOCIAL_SECRETS:
        if value := secrets.get(SOCIAL_SECRET_SOURCES.get(key, key)):
            item = existing.get(key)
            if item is None:
                envs.append({"key": key, "value": value, "type": "SECRET", "scope": "RUN_TIME"})
            else:
                item.update(value=value, type="SECRET", scope="RUN_TIME")


def consolidate(base, digest, secrets=None, tag=None):
    if not digest.startswith("sha256:") or len(digest) != 71:
        raise ValueError("Expected an immutable SHA-256 image digest")
    if tag is not None and not re.fullmatch(r"social-backend-[0-9a-f]{40}", tag):
        raise ValueError("Expected a commit SHA image tag")
    image = dict(IMAGE, **({"tag": tag} if tag else {"digest": digest}))
    if isinstance(base, list):
        if len(base) != 1:
            raise ValueError("Expected one DigitalOcean app")
        base = base[0]
    spec = copy.deepcopy(base.get("spec", base))
    services = {item["name"]: item for item in spec["services"]}
    # The web deploy retires design-renderer; both shapes are current.
    if set(services) - {"design-renderer"} == {"web", "storage", BACKEND}:
        backend = services[BACKEND]
        if backend.get("image", {}).get("registry_type") != "GHCR":
            raise ValueError("Combined backend image source changed")
        refresh_secrets(backend["envs"], secrets)
        add_optional_social_secrets(backend["envs"], secrets)
        configure_publishing_api(backend, services["web"], publishing_token(services, secrets),
                                 secrets is not None and secrets.get("ENABLE_DIRECT_PROVIDER") == "true")
        configure_product_api(backend, secrets)
        backend["image"] = image
        migration = next((item for item in spec.get("jobs", []) if item["name"] == "postiz-migrate"), None)
        if migration is None:
            raise ValueError("Postiz migration job is missing")
        migration["image"] = copy.deepcopy(image)
        shared_database(backend, migration, secrets)
        platform_migration(spec, migration, secrets)
        return spec
    if set(services) != {"web", "storage", "design-renderer"} | OLD_BACKENDS:
        raise ValueError("Production topology changed; inspect the app before cutting over")
    if {item["name"] for item in spec.get("jobs", [])} != {"web-migrate", "postiz-migrate"}:
        raise ValueError("Production jobs changed; inspect the app before cutting over")

    social = copy.deepcopy(services["postiz-backend"])
    tenant = services["publishing-orchestrator"]
    social_env = social["envs"]
    tenant_env = tenant["envs"]
    required = {"DATABASE_URL", "TEMPORAL_ADDRESS", "TEMPORAL_NAMESPACE", "TEMPORAL_API_KEY",
                "AUDIT_RETENTION_DATABASE_URL", "AUDIT_DRAIN_ENCRYPTION_KEY", "RESEND_API_KEY",
                "STORAGE_SERVICE_KEY", "STORAGE_BUCKET", "STORAGE_API_URL", "BETTER_AUTH_SECRET",
                "BETTER_AUTH_URL", "AUTH_EMAIL_FROM", "RUN_MAINTENANCE", "RUN_CRON"}
    if not required <= {item["key"] for item in tenant_env}:
        raise ValueError("Tenant orchestrator is missing required runtime settings")
    refresh_secrets(social_env, secrets)
    add_optional_social_secrets(social_env, secrets)
    for item in tenant_env:
        entry = copy.deepcopy(item)
        entry["key"] = "TENANT_" + entry["key"]
        social_env.append(entry)
    refresh_secrets([item for item in social_env if item["key"].startswith("TENANT_")], secrets)
    set_env(social_env, "RUN_WORKER", "true")
    set_env(social_env, "ORCHESTRATOR_PORT", "3002")
    set_env(social_env, "BACKEND_INTERNAL_URL", "http://127.0.0.1:3000")
    set_env(social_env, "TENANT_POSTIZ_API_URL", "http://127.0.0.1:3000/public/v1")
    set_env(social_env, "TENANT_PORT", "8081")
    set_env(social_env, "TENANT_RUN_MAINTENANCE", "true")
    set_env(social_env, "TENANT_RUN_CRON", "true")
    configure_publishing_api(social, services["web"], publishing_token(services, secrets),
                             secrets is not None and secrets.get("ENABLE_DIRECT_PROVIDER") == "true")
    configure_product_api(social, secrets)
    if len({item["key"] for item in social_env}) != len(social_env):
        raise ValueError("Backend environment contains duplicate keys")
    social["name"] = BACKEND
    for key in ("git", "source_dir", "dockerfile_path"):
        social.pop(key, None)
    social["image"] = copy.deepcopy(image)
    social["instance_size_slug"] = "apps-s-1vcpu-2gb"
    social["http_port"] = 3000
    social["internal_ports"] = [3003, 8082]
    social["health_check"] = {
        "http_path": "/readyz", "port": 3003,
        "initial_delay_seconds": 45, "period_seconds": 15,
        "timeout_seconds": 10, "failure_threshold": 6,
    }

    spec["services"] = [item for item in spec["services"] if item["name"] not in OLD_BACKENDS] + [social]
    for rule in spec["ingress"]["rules"]:
        if rule["component"]["name"] == "postiz-backend":
            rule["component"]["name"] = BACKEND
    web = services["web"]
    set_env(web["envs"], "POSTIZ_API_URL", f"http://{BACKEND}:3000/public/v1")

    migration = next(item for item in spec["jobs"] if item["name"] == "postiz-migrate")
    for key in ("git", "source_dir", "dockerfile_path"):
        migration.pop(key, None)
    migration["image"] = copy.deepcopy(image)
    shared_database(social, migration, secrets)
    platform_migration(spec, migration, secrets)
    return spec


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--digest", required=True)
    parser.add_argument("--tag", help="Unique social-backend-<commit SHA> tag to deploy")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--from-infisical-env", action="store_true",
                        help="Use OIDC-loaded Infisical values for the new backend secrets")
    args = parser.parse_args()
    spec = consolidate(json.loads(args.base.read_text()), args.digest,
                       dict(os.environ) if args.from_infisical_env else None, args.tag)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as output:
        os.fchmod(output.fileno(), 0o600)
        json.dump(spec, output)
    print(f"Prepared {len(spec['services'])} services and {len(spec['jobs'])} jobs")


if __name__ == "__main__":
    main()
