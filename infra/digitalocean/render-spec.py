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
from urllib.parse import urlparse


def render(base, secrets, *, stack="full", branch="main"):
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
    web_keys = ["DATABASE_URL", "BETTER_AUTH_SECRET", "AUDIT_IP_HASH_SECRET",
                "AUDIT_DRAIN_ENCRYPTION_KEY", "REDIS_URL", "STORAGE_SERVICE_KEY",
                "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "PLATFORM_RENDER_SERVICE_SECRET"]
    optional_web_keys = ["RESEND_API_KEY", "AUTH_EMAIL_WEBHOOK_URL", "CLEANUP_SECRET",
                         "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GITHUB_CLIENT_ID",
                         "GITHUB_CLIENT_SECRET", "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET",
                         "OPENROUTER_API_KEY", "POSTIZ_API_KEY"]
    merge_env(web, [secret(key) for key in web_keys] +
              [secret(key) for key in optional_web_keys if secrets.get(key)] + [
        env("BETTER_AUTH_URL", origin),
        env("BETTER_AUTH_TRUSTED_ORIGINS", required("BETTER_AUTH_TRUSTED_ORIGINS")),
        env("NEXT_PUBLIC_APP_URL", origin),
        env("AUTH_ENABLE_PASSWORD", secrets.get("AUTH_ENABLE_PASSWORD", "true")),
        env("STORAGE_API_URL", "http://storage:5000"),
        env("STORAGE_PROXY_URL", origin + "/api/tenant/storage"),
        env("STORAGE_BUCKET", required("STORAGE_BUCKET")),
        env("PLATFORM_DESIGN_RENDERER", "enabled"),
        env("PLATFORM_RENDER_SERVICE_URL", "http://design-renderer:8080"),
        env("PLATFORM_RENDER_BASE_URL", origin),
    ] + [env(key, secrets[key]) for key in ["AUTH_EMAIL_FROM", "R2_ACCOUNT_ID", "R2_BUCKET_NAME", "R2_ENDPOINT", "R2_REGION"] if secrets.get(key)])

    storage = service("storage", "", "", 5000, "/status", "apps-s-1vcpu-0.5gb")
    for key in ["git", "source_dir", "dockerfile_path"]:
        del storage[key]
    storage["image"] = {"registry_type": "DOCKER_HUB", "registry": "supabase", "repository": "storage-api", "tag": "v1.37.8"}
    merge_env(storage, [
        secret("DATABASE_URL", "STORAGE_DATABASE_URL"),
        secret("DATABASE_POOL_URL", "STORAGE_DATABASE_URL"),
        secret("AUTH_JWT_SECRET", "STORAGE_JWT_SECRET"),
        secret("AWS_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID"),
        secret("AWS_SECRET_ACCESS_KEY", "R2_SECRET_ACCESS_KEY"),
    ] + [env(key, value) for key, value in {
        "SERVER_PORT": "5000", "AUTH_JWT_ALGORITHM": "HS256", "DB_INSTALL_ROLES": "false",
        "STORAGE_BACKEND": "s3", "STORAGE_S3_BUCKET": required("R2_BUCKET_NAME"),
        "STORAGE_S3_ENDPOINT": required("R2_ENDPOINT"), "STORAGE_S3_REGION": "auto",
        "STORAGE_S3_FORCE_PATH_STYLE": "true", "ENABLE_IMAGE_TRANSFORMATION": "false",
        "UPLOAD_FILE_SIZE_LIMIT": "52428800", "UPLOAD_FILE_SIZE_LIMIT_STANDARD": "52428800",
        "UPLOAD_SIGNED_URL_EXPIRATION_TIME": "120", "TUS_URL_PATH": "/upload/resumable",
        "TUS_URL_EXPIRY_MS": "3600000",
    }.items()])
    services["storage"] = storage

    renderer = service("design-renderer", "services/design-renderer", "services/design-renderer/Dockerfile", 8080, "/ready", "apps-s-1vcpu-2gb")
    merge_env(renderer, [secret("RENDER_SERVICE_SECRET", "PLATFORM_RENDER_SERVICE_SECRET"),
                         env("RENDER_ALLOWED_ORIGIN", origin), env("RENDER_CONCURRENCY", "2")])
    services["design-renderer"] = renderer

    jobs = {item["name"]: item for item in spec.get("jobs", [])}
    jobs["web-migrate"] = {
        "name": "web-migrate", "kind": "PRE_DEPLOY", "image": copy.deepcopy(web["image"]),
        "instance_count": 1, "instance_size_slug": "apps-s-1vcpu-1gb",
        "run_command": "sh -c 'cd /app/migrator && node node_modules/prisma/build/index.js migrate deploy'",
        "envs": [secret("DATABASE_URL", "MIGRATION_DATABASE_URL")],
    }

    if stack == "full":
        if required("TEMPORAL_NAMESPACE") == required("POSTIZ_TEMPORAL_NAMESPACE"):
            raise ValueError("Publishing and Postiz require different Temporal namespaces")
        tenant_db = urlparse(required("DATABASE_URL"))
        postiz_db = urlparse(required("POSTIZ_DATABASE_URL"))
        if (tenant_db.hostname, tenant_db.port or 5432, tenant_db.path) == (postiz_db.hostname, postiz_db.port or 5432, postiz_db.path):
            raise ValueError("Postiz requires a separate database")
        postiz_env = [secret("DATABASE_URL", "POSTIZ_DATABASE_URL"),
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
        postiz_env += [secret(key) for key in ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "X_API_KEY", "X_API_SECRET"] if secrets.get(key)]
        backend = service("screenshot-studio-backend", "services", "services/screenshot-studio-backend/backend/Dockerfile", 3000, "/readyz", "apps-s-1vcpu-2gb")
        merge_env(backend, postiz_env + [env("PORT", "3000"), env("RUN_CRON", "true"), env("RUN_WORKER", "true")])
        # Public Postiz callbacks/API use their own prefix; tenant publishing stays private.
        backend["http_port"] = 3000
        backend["internal_ports"] = [3003]
        backend["health_check"]["port"] = 3003
        services[backend["name"]] = backend
        job = {k: copy.deepcopy(v) for k, v in backend.items() if k not in ["envs", "http_port", "health_check"]}
        job.pop("internal_ports", None)
        job.update(name="postiz-migrate", kind="PRE_DEPLOY", run_command="/postiz-migrate", envs=[secret("DATABASE_URL", "POSTIZ_DATABASE_URL")])
        jobs[job["name"]] = job

        temporal_env = [secret("TEMPORAL_API_KEY"), env("TEMPORAL_ADDRESS", required("TEMPORAL_ADDRESS")),
                        env("TEMPORAL_NAMESPACE", required("TEMPORAL_NAMESPACE")), env("TEMPORAL_TLS", "true")]
        tenant_env = temporal_env + [secret("DATABASE_URL"), secret("STORAGE_SERVICE_KEY"), secret("POSTIZ_API_KEY"),
                  env("PORT", "8081"), env("RUN_CRON", "true"), env("STORAGE_API_URL", "http://storage:5000"),
                  env("STORAGE_BUCKET", required("STORAGE_BUCKET")), env("POSTIZ_API_URL", "http://127.0.0.1:3000/public/v1"),
                  env("RUN_MAINTENANCE", "true"), secret("AUDIT_RETENTION_DATABASE_URL"),
                  secret("AUDIT_DRAIN_ENCRYPTION_KEY"), secret("RESEND_API_KEY"), secret("BETTER_AUTH_SECRET"),
                  env("BETTER_AUTH_URL", origin), env("AUTH_EMAIL_FROM", required("AUTH_EMAIL_FROM")),
                  env("COMPANY_POSTAL_ADDRESS", secrets.get("COMPANY_POSTAL_ADDRESS", ""))]
        merge_env(backend, [dict(item, key="TENANT_" + item["key"]) for item in tenant_env])
        for old_name in ("postiz-backend", "postiz-orchestrator", "publishing-backend", "publishing-orchestrator"):
            services.pop(old_name, None)
        merge_env(web, [env("POSTIZ_API_URL", "http://screenshot-studio-backend:3000/public/v1"), secret("POSTIZ_API_KEY")])
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
    parser.add_argument("--stack", choices=["core", "full"], default="full")
    parser.add_argument("--branch", default="main")
    args = parser.parse_args()
    try:
        spec = render(json.loads(args.base.read_text()), json.loads(args.secrets.read_text()), stack=args.stack, branch=args.branch)
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
