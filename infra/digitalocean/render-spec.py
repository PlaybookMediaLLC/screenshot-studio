#!/usr/bin/env python3
"""Merge platform components into an exported App Platform spec.

Secrets come from an Infisical JSON export; the generated file is private and
must stay outside git. Rendering never changes the running app.
"""

import argparse
import copy
import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

WEB_DATABASE_KEYS = {"DATABASE_URL", "DIRECT_URL", "MIGRATION_DATABASE_URL", "AUDIT_RETENTION_DATABASE_URL",
                     "STORAGE_SERVICE_KEY", "STORAGE_API_URL", "STORAGE_PROXY_URL", "STORAGE_BUCKET",
                     "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ACCOUNT_ID", "R2_BUCKET_NAME", "R2_ENDPOINT", "R2_REGION",
                     "POSTIZ_API_URL", "POSTIZ_API_KEY"}


def same_logical_database(first, second):
    try:
        a, b = urlsplit(first), urlsplit(second)
        return (a.scheme in ("postgres", "postgresql") and b.scheme in ("postgres", "postgresql")
                and a.hostname and a.hostname == b.hostname
                and (a.port or 5432) == (b.port or 5432)
                and a.path and a.path == b.path
                and parse_qs(a.query).get("search_path") == parse_qs(b.query).get("search_path"))
    except ValueError:
        return False


def render(base, secrets, *, branch="main"):
    if isinstance(base, list):
        if len(base) != 1:
            raise ValueError("Export exactly one DigitalOcean app as the base")
        base = base[0]
    spec = copy.deepcopy(base.get("spec", base))
    if isinstance(secrets, list):
        secrets = {item["key"]: item["value"] for item in secrets}

    def required(key):
        value = secrets.get(key)
        if not value:
            raise ValueError(f"Missing required Infisical secret: {key}")
        return value

    for role_url in ("MIGRATION_DATABASE_URL", "AUDIT_RETENTION_DATABASE_URL"):
        if not same_logical_database(required("DATABASE_URL"), required(role_url)):
            raise ValueError(f"{role_url} must target the same product database as DATABASE_URL")

    def env(key, value, secret=False):
        return {"key": key, "value": value, "scope": "RUN_TIME",
                "type": "SECRET" if secret else "GENERAL"}

    def secret(key, source=None):
        return env(key, required(source or key), True)

    def merge_env(component, values):
        existing = {item["key"]: item for item in component.get("envs", [])}
        existing.update({item["key"]: item for item in values})
        component["envs"] = list(existing.values())

    def service(name, directory, dockerfile, port, health, size="apps-s-1vcpu-1gb"):
        return {
            "name": name,
            "git": {"repo_clone_url": "https://github.com/PlaybookMediaLLC/screenshot-studio.git", "branch": branch},
            "source_dir": directory,
            "dockerfile_path": dockerfile,
            "internal_ports": [port],
            "instance_count": 1,
            "instance_size_slug": size,
            "health_check": {"http_path": health, "port": port,
                             "initial_delay_seconds": 30, "period_seconds": 15,
                             "timeout_seconds": 5, "failure_threshold": 6},
        }

    services = {item["name"]: item for item in spec.get("services", [])}
    web = services["web"]
    origin = required("BETTER_AUTH_URL").rstrip("/")
    # The web has no database: the Go backend owns every read and write.
    web["envs"] = [item for item in web.get("envs", [])
                   if item["key"] not in WEB_DATABASE_KEYS and not item["key"].startswith("POSTIZ_API_KEY_")
                   and item["key"] not in ("PLATFORM_RENDER_SERVICE_URL", "PLATFORM_RENDER_SERVICE_SECRET")]
    web_keys = ["BETTER_AUTH_SECRET", "AUDIT_IP_HASH_SECRET",
                "AUDIT_DRAIN_ENCRYPTION_KEY", "REDIS_URL", "PLATFORM_RENDER_CDP_TOKEN"]
    optional_web_keys = ["RESEND_API_KEY", "AUTH_EMAIL_WEBHOOK_URL", "CLEANUP_SECRET",
                         "SOURCE_WEBHOOK_SIGNING_KEY",
                         "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GITHUB_CLIENT_ID",
                         "GITHUB_CLIENT_SECRET", "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET",
                         "OPENROUTER_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]
    stripe_price_keys = ["STRIPE_PRICE_PRO_MONTHLY", "STRIPE_PRICE_PRO_ANNUAL", "STRIPE_PRICE_BUSINESS_MONTHLY",
                         "STRIPE_PRICE_BUSINESS_ANNUAL", "STRIPE_PRICE_EXTRA_LAUNCH"]
    merge_env(web, [secret(key) for key in web_keys] +
              [secret(key) for key in optional_web_keys if secrets.get(key)] + [
        env("BETTER_AUTH_URL", origin),
        env("BETTER_AUTH_TRUSTED_ORIGINS", required("BETTER_AUTH_TRUSTED_ORIGINS")),
        env("NEXT_PUBLIC_APP_URL", origin),
        env("AUTH_ENABLE_PASSWORD", secrets.get("AUTH_ENABLE_PASSWORD", "true")),
        env("PLATFORM_DESIGN_RENDERER", "enabled"),
        env("PLATFORM_RENDER_CDP_URL", required("PLATFORM_RENDER_CDP_URL")),
        env("PLATFORM_RENDER_BASE_URL", origin),
    ] + [env(key, secrets[key]) for key in ["AUTH_EMAIL_FROM", *stripe_price_keys] if secrets.get(key)])
    services.pop("storage", None)

    # Designs render in Cloudflare Browser Rendering over CDP.
    services.pop("design-renderer", None)

    jobs = {item["name"]: item for item in spec.get("jobs", [])}
    jobs.pop("web-migrate", None)

    if required("TEMPORAL_NAMESPACE") == required("POSTIZ_TEMPORAL_NAMESPACE"):
        raise ValueError("Publishing and Postiz require different Temporal namespaces")
    postiz_env = [secret("DATABASE_URL"),
                  secret("REDIS_URL", "POSTIZ_REDIS_URL"), secret("JWT_SECRET", "POSTIZ_JWT_SECRET"),
                  secret("TEMPORAL_API_KEY", "POSTIZ_TEMPORAL_API_KEY")]
    postiz_env += [env(key, value) for key, value in {
        "TEMPORAL_ADDRESS": required("POSTIZ_TEMPORAL_ADDRESS"),
        "TEMPORAL_NAMESPACE": required("POSTIZ_TEMPORAL_NAMESPACE"), "TEMPORAL_TLS": "true",
        "FRONTEND_URL": origin, "MAIN_URL": origin,
        "NEXT_PUBLIC_BACKEND_URL": origin + "/postiz", "BACKEND_INTERNAL_URL": "http://127.0.0.1:3000",
        "STORAGE_PROVIDER": "cloudflare", "POSTIZ_PRIVATE_MEDIA": "true",
        "CLOUDFLARE_ACCOUNT_ID": required("CLOUDFLARE_ACCOUNT_ID"),
        "CLOUDFLARE_BUCKETNAME": required("CLOUDFLARE_BUCKETNAME"),
        "CLOUDFLARE_BUCKET_URL": required("CLOUDFLARE_BUCKET_URL"), "CLOUDFLARE_REGION": "auto",
    }.items()]
    postiz_env += [secret(key) for key in ["CLOUDFLARE_ACCESS_KEY", "CLOUDFLARE_SECRET_ACCESS_KEY"]]
    provider_secret_sources = {
        "LINKEDIN_CLIENT_ID": "LINKEDIN_CLIENT_ID",
        "LINKEDIN_CLIENT_SECRET": "LINKEDIN_CLIENT_SECRET",
        "X_API_KEY": "POSTIZ_GO_X_API_KEY",
        "X_API_SECRET": "POSTIZ_GO_X_API_SECRET",
        "FACEBOOK_APP_ID": "POSTIZ_GO_FACEBOOK_APP_ID",
        "FACEBOOK_APP_SECRET": "POSTIZ_GO_FACEBOOK_APP_SECRET",
        "INSTAGRAM_APP_ID": "POSTIZ_GO_INSTAGRAM_APP_ID",
        "INSTAGRAM_APP_SECRET": "POSTIZ_GO_INSTAGRAM_APP_SECRET",
    }
    postiz_env += [secret(key, source) for key, source in provider_secret_sources.items() if secrets.get(source)]
    backend = service("screenshot-studio-backend", "services", "services/screenshot-studio-backend/backend/Dockerfile", 3000, "/readyz", "apps-s-1vcpu-2gb")
    merge_env(backend, postiz_env + [env("PORT", "3000"), env("RUN_CRON", "true"), env("RUN_WORKER", "true")])
    # Public Postiz callbacks/API use their own prefix; tenant publishing stays private.
    backend["http_port"] = 3000
    backend["internal_ports"] = [3003]
    backend["health_check"]["port"] = 3003
    # Once GitHub has cut production over to a digest, subsequent config
    # renders must keep that image source instead of switching to DO builds.
    existing_backend = services.get(backend["name"])
    if existing_backend and existing_backend.get("image"):
        for key in ("git", "source_dir", "dockerfile_path"):
            backend.pop(key, None)
        backend["image"] = copy.deepcopy(existing_backend["image"])
    services[backend["name"]] = backend
    job = {k: copy.deepcopy(v) for k, v in backend.items() if k not in ["envs", "http_port", "health_check"]}
    job.pop("internal_ports", None)
    # One migration command applies product and social tables in public.
    jobs["platform-migrate"] = dict(copy.deepcopy(job), name="platform-migrate", kind="PRE_DEPLOY", run_command="/platform-migrate",
                                    envs=[secret("DATABASE_URL", "MIGRATION_DATABASE_URL")])
    jobs.pop("postiz-migrate", None)

    temporal_env = [secret("TEMPORAL_API_KEY"), env("TEMPORAL_ADDRESS", required("TEMPORAL_ADDRESS")),
                    env("TEMPORAL_NAMESPACE", required("TEMPORAL_NAMESPACE")), env("TEMPORAL_TLS", "true")]
    tenant_env = temporal_env + [secret("DATABASE_URL"), secret("POSTIZ_API_KEY"),
              secret("REDIS_URL", "POSTIZ_REDIS_URL"),
              secret("PUBLISHING_SERVICE_TOKEN"),
              env("PORT", "8081"), env("RUN_CRON", "true"),
              env("POSTIZ_API_URL", "http://127.0.0.1:3000/public/v1"),
              env("R2_ENDPOINT", required("R2_ENDPOINT")),
              env("R2_REGION", secrets.get("R2_REGION", "auto")),
              env("R2_BUCKET_NAME", required("R2_BUCKET_NAME")),
              secret("R2_ACCESS_KEY_ID"), secret("R2_SECRET_ACCESS_KEY"),
              env("RUN_MAINTENANCE", "true"), secret("AUDIT_RETENTION_DATABASE_URL"),
              secret("AUDIT_DRAIN_ENCRYPTION_KEY"), secret("RESEND_API_KEY"), secret("BETTER_AUTH_SECRET"),
              env("BETTER_AUTH_URL", origin), env("AUTH_EMAIL_FROM", required("AUTH_EMAIL_FROM")),
              env("PLATFORM_CAMPAIGN_WORKFLOW", secrets.get("PLATFORM_CAMPAIGN_WORKFLOW", "")),
              env("COMPANY_POSTAL_ADDRESS", secrets.get("COMPANY_POSTAL_ADDRESS", ""))]
    merge_env(backend, [dict(item, key="TENANT_" + item["key"]) for item in tenant_env])
    backend["internal_ports"] = [3003, 8082]
    for old_name in ("postiz-backend", "postiz-orchestrator", "publishing-backend", "publishing-orchestrator"):
        services.pop(old_name, None)
    merge_env(web, [env("PUBLISHING_API_URL", "http://screenshot-studio-backend:8082"),
                    secret("PUBLISHING_SERVICE_TOKEN")])
    rules = spec.setdefault("ingress", {}).setdefault("rules", [])
    rules[:] = [rule for rule in rules if rule.get("component", {}).get("name") not in ("postiz-backend", "screenshot-studio-backend")]
    rules.insert(0, {"match": {"path": {"prefix": "/postiz"}}, "component": {"name": "screenshot-studio-backend"}})

    spec["services"] = list(services.values())
    spec["jobs"] = list(jobs.values())
    return spec


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--secrets", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--branch", default="main")
    args = parser.parse_args()
    try:
        spec = render(json.loads(args.base.read_text()), json.loads(args.secrets.read_text()), branch=args.branch)
    except (ValueError, KeyError) as error:
        parser.error(str(error))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as output:
        os.fchmod(output.fileno(), 0o600)
        json.dump(spec, output, indent=2)
        output.write("\n")
    print(f"Rendered {len(spec['services'])} services and {len(spec['jobs'])} jobs to {args.output}; not deployed.")


if __name__ == "__main__":
    main()
