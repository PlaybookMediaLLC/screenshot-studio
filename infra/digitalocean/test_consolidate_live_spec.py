"""Checks the one-time production topology patch without provider access."""

import importlib.util
from pathlib import Path
import unittest

module = importlib.util.spec_from_file_location("consolidate_live_spec", Path(__file__).with_name("consolidate-live-spec.py"))
cutover = importlib.util.module_from_spec(module)
module.loader.exec_module(cutover)


class ConsolidateLiveSpecTest(unittest.TestCase):
    def setUp(self):
        def env(key, value="EV[encrypted]", kind="SECRET"):
            return {"key": key, "value": value, "type": kind, "scope": "RUN_TIME"}

        tenant_keys = "DATABASE_URL TEMPORAL_ADDRESS TEMPORAL_NAMESPACE TEMPORAL_API_KEY AUDIT_RETENTION_DATABASE_URL AUDIT_DRAIN_ENCRYPTION_KEY RESEND_API_KEY STORAGE_SERVICE_KEY STORAGE_BUCKET STORAGE_API_URL BETTER_AUTH_SECRET BETTER_AUTH_URL AUTH_EMAIL_FROM RUN_MAINTENANCE RUN_CRON POSTIZ_API_URL".split()
        self.base = {"spec": {
            "name": "production", "domains": [{"domain": "shots.example.com"}],
            "services": [
                {"name": "web", "image": {"digest": "web-digest"}, "envs": [env("POSTIZ_API_URL", "http://postiz-backend:3000", "GENERAL")]},
                {"name": "storage", "image": {"tag": "fixed"}},
                {"name": "design-renderer", "git": {"branch": "main"}},
                {"name": "postiz-backend", "git": {"branch": "main"}, "source_dir": "services", "dockerfile_path": "Dockerfile", "envs": [env("DATABASE_URL"), env("TEMPORAL_NAMESPACE", "tenant-namespace", "GENERAL"), env("BACKEND_INTERNAL_URL", "http://postiz-backend:3000", "GENERAL")]},
                {"name": "postiz-orchestrator", "envs": []},
                {"name": "publishing-backend", "envs": [env("PUBLISHING_SERVICE_TOKEN")]},
                {"name": "publishing-orchestrator", "envs": [env(key, "true" if key in ("RUN_MAINTENANCE", "RUN_CRON") else "EV[encrypted]", "GENERAL" if key in ("RUN_MAINTENANCE", "RUN_CRON", "POSTIZ_API_URL", "TEMPORAL_ADDRESS", "TEMPORAL_NAMESPACE", "STORAGE_BUCKET", "STORAGE_API_URL", "BETTER_AUTH_URL", "AUTH_EMAIL_FROM") else "SECRET") for key in tenant_keys]},
            ],
            "jobs": [{"name": "web-migrate", "envs": [env("DATABASE_URL", "EV[migration-owner]")]}, {"name": "postiz-migrate", "git": {"branch": "main"}, "source_dir": "services", "dockerfile_path": "Dockerfile", "envs": [env("DATABASE_URL")]}],
            "ingress": {"rules": [{"component": {"name": "postiz-backend"}}, {"component": {"name": "web"}}]},
        }}
        self.digest = "sha256:" + "a" * 64

    def test_preserves_unrelated_components_and_moves_tenant_secrets(self):
        spec = cutover.consolidate(self.base, self.digest)
        services = {item["name"]: item for item in spec["services"]}
        self.assertEqual(set(services), {"web", "storage", "design-renderer", "screenshot-studio-backend"})
        self.assertEqual(services["web"]["image"]["digest"], "web-digest")
        self.assertEqual(services["storage"]["image"]["tag"], "fixed")
        self.assertEqual(spec["domains"], self.base["spec"]["domains"])
        backend = services["screenshot-studio-backend"]
        self.assertEqual(backend["image"]["digest"], self.digest)
        self.assertEqual(backend["health_check"]["port"], 3003)
        self.assertEqual(backend["internal_ports"], [3003, 8082])
        values = {item["key"]: item for item in backend["envs"]}
        self.assertEqual(values["TENANT_AUDIT_RETENTION_DATABASE_URL"]["value"], "EV[encrypted]")
        self.assertEqual(values["TENANT_AUDIT_RETENTION_DATABASE_URL"]["type"], "SECRET")
        self.assertEqual(values["TENANT_RUN_MAINTENANCE"]["value"], "true")
        self.assertEqual(values["RUN_WORKER"]["value"], "true")
        self.assertEqual(values["TENANT_PUBLISHING_SERVICE_TOKEN"]["type"], "SECRET")
        self.assertEqual(values["DATABASE_URL"]["value"], values["TENANT_DATABASE_URL"]["value"])
        self.assertEqual(spec["jobs"][1]["envs"][0]["value"], values["TENANT_DATABASE_URL"]["value"])
        web_env = {item["key"]: item for item in services["web"]["envs"]}
        self.assertEqual(web_env["PUBLISHING_API_URL"]["value"], "http://screenshot-studio-backend:8082")
        self.assertEqual(web_env["PUBLISHING_SERVICE_TOKEN"]["type"], "SECRET")
        self.assertEqual(spec["ingress"]["rules"][0]["component"]["name"], "screenshot-studio-backend")
        self.assertEqual(spec["jobs"][1]["image"]["digest"], self.digest)
        platform = spec["jobs"][0]
        self.assertEqual((platform["name"], platform["run_command"]), ("platform-migrate", "/platform-migrate"))
        self.assertEqual(platform["image"]["digest"], self.digest)
        self.assertEqual(platform["envs"][0]["value"], "EV[migration-owner]")
        self.assertEqual(len(self.base["spec"]["services"]), 7)

    def test_refuses_unexpected_topology(self):
        self.base["spec"]["services"].append({"name": "unexpected"})
        with self.assertRaisesRegex(ValueError, "topology changed"):
            cutover.consolidate(self.base, self.digest)

    def test_uses_commit_tag_and_supports_repeat_deployments(self):
        first_tag = "social-backend-" + "a" * 40
        second_tag = "social-backend-" + "b" * 40
        first = cutover.consolidate(self.base, self.digest, tag=first_tag)
        backend = next(item for item in first["services"] if item["name"] == "screenshot-studio-backend")
        self.assertEqual(backend["image"]["tag"], first_tag)
        self.assertNotIn("digest", backend["image"])
        repeated = cutover.consolidate(first, self.digest, tag=second_tag)
        updated = next(item for item in repeated["services"] if item["name"] == "screenshot-studio-backend")
        self.assertEqual(updated["image"]["tag"], second_tag)
        self.assertEqual(repeated["jobs"][1]["image"]["tag"], second_tag)
        self.assertEqual([job["name"] for job in repeated["jobs"]], ["platform-migrate", "postiz-migrate"])
        self.assertEqual(repeated["jobs"][0]["image"]["tag"], second_tag)
        self.assertEqual(len(repeated["services"]), 4)
        with self.assertRaisesRegex(ValueError, "commit SHA"):
            cutover.consolidate(self.base, self.digest, tag="latest")

    def test_uses_infisical_for_new_backend_credentials(self):
        secrets = {key: "infisical-" + key for key in
                   "POSTIZ_TEMPORAL_API_KEY DATABASE_URL MIGRATION_DATABASE_URL TEMPORAL_API_KEY AUDIT_RETENTION_DATABASE_URL AUDIT_DRAIN_ENCRYPTION_KEY RESEND_API_KEY STORAGE_SERVICE_KEY BETTER_AUTH_SECRET PUBLISHING_SERVICE_TOKEN R2_ENDPOINT R2_BUCKET_NAME R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY REDIS_URL".split()}
        secrets.update({cutover.SOCIAL_SECRET_SOURCES.get(key, key): "infisical-" + key
                        for key in cutover.OPTIONAL_SOCIAL_SECRETS})
        secrets.update({key: "other-service-" + key for key in cutover.OPTIONAL_SOCIAL_SECRETS
                        if key in cutover.SOCIAL_SECRET_SOURCES})
        social = next(service for service in self.base["spec"]["services"] if service["name"] == "postiz-backend")
        social["envs"].append({"key": "FACEBOOK_APP_SECRET", "value": "old-plain-value", "type": "GENERAL", "scope": "RUN_TIME"})
        spec = cutover.consolidate(self.base, self.digest, secrets)
        backend = next(item for item in spec["services"] if item["name"] == "screenshot-studio-backend")
        values = {item["key"]: item["value"] for item in backend["envs"]}
        self.assertEqual(values["DATABASE_URL"], "infisical-DATABASE_URL")
        self.assertEqual(values["TENANT_DATABASE_URL"], "infisical-DATABASE_URL")
        # Migration jobs run as the migration owner, never the runtime role.
        self.assertEqual(next(item for item in spec["jobs"] if item["name"] == "postiz-migrate")["envs"][0]["value"], "infisical-MIGRATION_DATABASE_URL")
        self.assertEqual(values["TENANT_AUDIT_RETENTION_DATABASE_URL"], "infisical-AUDIT_RETENTION_DATABASE_URL")
        for key in cutover.OPTIONAL_SOCIAL_SECRETS:
            entry = next(item for item in backend["envs"] if item["key"] == key)
            self.assertEqual(entry["value"], secrets[cutover.SOCIAL_SECRET_SOURCES.get(key, key)])
            self.assertEqual(entry["type"], "SECRET")
            self.assertNotIn(key, {item["key"] for item in next(service for service in spec["services"] if service["name"] == "web")["envs"]})
        repeated = cutover.consolidate(spec, self.digest, secrets)
        updated = next(item for item in repeated["services"] if item["name"] == "screenshot-studio-backend")
        self.assertEqual(len({item["key"] for item in updated["envs"]}), len(updated["envs"]))
        for key in cutover.OPTIONAL_SOCIAL_SECRETS:
            self.assertEqual(next(item for item in updated["envs"] if item["key"] == key)["type"], "SECRET")
        withdrawn = dict(secrets)
        del withdrawn["POSTIZ_GO_FACEBOOK_APP_SECRET"]
        retired = cutover.consolidate(spec, self.digest, withdrawn)
        retired_backend = next(item for item in retired["services"] if item["name"] == "screenshot-studio-backend")
        self.assertNotIn("FACEBOOK_APP_SECRET", {item["key"] for item in retired_backend["envs"]})
        retired_initial = cutover.consolidate(self.base, self.digest, withdrawn)
        retired_initial_backend = next(item for item in retired_initial["services"] if item["name"] == "screenshot-studio-backend")
        self.assertNotIn("FACEBOOK_APP_SECRET", {item["key"] for item in retired_initial_backend["envs"]})
        with self.assertRaisesRegex(ValueError, "DATABASE_URL"):
            cutover.consolidate(self.base, self.digest, {})

    def test_web_reaches_backend_and_go_owns_migrations(self):
        secrets = {key: "infisical-" + key for key in
                   "POSTIZ_TEMPORAL_API_KEY DATABASE_URL MIGRATION_DATABASE_URL TEMPORAL_API_KEY AUDIT_RETENTION_DATABASE_URL AUDIT_DRAIN_ENCRYPTION_KEY RESEND_API_KEY STORAGE_SERVICE_KEY BETTER_AUTH_SECRET PUBLISHING_SERVICE_TOKEN R2_ENDPOINT R2_BUCKET_NAME R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY REDIS_URL".split()}
        spec = cutover.consolidate(self.base, self.digest, secrets)
        web = next(item for item in spec["services"] if item["name"] == "web")
        envs = {item["key"]: item for item in web["envs"]}
        self.assertEqual(envs["PUBLISHING_API_URL"]["value"], "http://screenshot-studio-backend:8082")
        self.assertEqual(envs["PUBLISHING_SERVICE_TOKEN"]["value"], "infisical-PUBLISHING_SERVICE_TOKEN")
        jobs = {item["name"]: item for item in spec["jobs"]}
        self.assertEqual(set(jobs), {"platform-migrate", "postiz-migrate"})
        self.assertEqual(jobs["platform-migrate"]["envs"][0]["value"], "infisical-MIGRATION_DATABASE_URL")
        del secrets["MIGRATION_DATABASE_URL"]
        with self.assertRaisesRegex(ValueError, "MIGRATION_DATABASE_URL"):
            cutover.consolidate(spec, self.digest, secrets)

    def test_product_api_gets_storage_and_quota_counter(self):
        secrets = {key: "infisical-" + key for key in
                   "POSTIZ_TEMPORAL_API_KEY DATABASE_URL MIGRATION_DATABASE_URL TEMPORAL_API_KEY AUDIT_RETENTION_DATABASE_URL AUDIT_DRAIN_ENCRYPTION_KEY RESEND_API_KEY STORAGE_SERVICE_KEY BETTER_AUTH_SECRET PUBLISHING_SERVICE_TOKEN R2_ENDPOINT R2_BUCKET_NAME R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY REDIS_URL".split()}
        first = cutover.consolidate(self.base, self.digest, secrets)
        # The live production shape is the already-consolidated four services.
        for spec in (first, cutover.consolidate(first, self.digest, secrets)):
            backend = next(item for item in spec["services"] if item["name"] == "screenshot-studio-backend")
            envs = {item["key"]: item for item in backend["envs"]}
            self.assertEqual(len(envs), len(backend["envs"]))
            self.assertEqual(envs["TENANT_R2_ENDPOINT"]["value"], "infisical-R2_ENDPOINT")
            self.assertEqual(envs["TENANT_R2_BUCKET_NAME"]["value"], "infisical-R2_BUCKET_NAME")
            self.assertEqual(envs["TENANT_R2_REGION"]["value"], "auto")
            for key in ("R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "REDIS_URL"):
                self.assertEqual(envs["TENANT_" + key], {"key": "TENANT_" + key, "value": "infisical-" + key,
                                                         "type": "SECRET", "scope": "RUN_TIME"})
        # After the web deploy retires design-renderer, backend deploys still apply.
        without_renderer = dict(first, services=[item for item in first["services"] if item["name"] != "design-renderer"])
        self.assertNotIn("design-renderer", {item["name"] for item in cutover.consolidate(without_renderer, self.digest, secrets)["services"]})
        del secrets["R2_SECRET_ACCESS_KEY"]
        with self.assertRaisesRegex(ValueError, "R2_SECRET_ACCESS_KEY"):
            cutover.consolidate(first, self.digest, secrets)


if __name__ == "__main__":
    unittest.main()
