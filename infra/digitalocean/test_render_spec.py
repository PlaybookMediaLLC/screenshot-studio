"""Deployment safety checks; no provider credentials or network required."""

import importlib.util
from pathlib import Path
import unittest

module = importlib.util.spec_from_file_location("render_spec", Path(__file__).with_name("render-spec.py"))
render_spec = importlib.util.module_from_spec(module)
module.loader.exec_module(render_spec)


class DeploymentSpecTest(unittest.TestCase):
    def setUp(self):
        self.base = {
            "name": "existing-production", "region": "nyc",
            "domains": [{"domain": "app.example.com", "type": "PRIMARY"}],
            "services": [{"name": "web", "image": {"registry_type": "GHCR", "registry": "example", "repository": "web", "digest": "sha256:existing"},
                          "instance_count": 2, "envs": [{"key": "EXISTING_SETTING", "value": "preserve"},
                                                        {"key": "DATABASE_URL", "value": "legacy-web-role", "type": "SECRET"}]}],
            "jobs": [{"name": "web-migrate", "kind": "PRE_DEPLOY"}],
            "ingress": {"rules": [{"match": {"path": {"prefix": "/"}}, "component": {"name": "web"}}]},
        }
        keys = "DATABASE_URL BETTER_AUTH_SECRET AUDIT_IP_HASH_SECRET AUDIT_DRAIN_ENCRYPTION_KEY REDIS_URL STORAGE_SERVICE_KEY R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY PLATFORM_RENDER_CDP_TOKEN PLATFORM_RENDER_CDP_URL BETTER_AUTH_URL BETTER_AUTH_TRUSTED_ORIGINS STORAGE_BUCKET STORAGE_DATABASE_URL STORAGE_JWT_SECRET R2_BUCKET_NAME R2_ENDPOINT MIGRATION_DATABASE_URL TEMPORAL_NAMESPACE POSTIZ_TEMPORAL_NAMESPACE POSTIZ_REDIS_URL POSTIZ_JWT_SECRET POSTIZ_TEMPORAL_API_KEY POSTIZ_TEMPORAL_ADDRESS CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_BUCKETNAME CLOUDFLARE_BUCKET_URL CLOUDFLARE_ACCESS_KEY CLOUDFLARE_SECRET_ACCESS_KEY TEMPORAL_API_KEY TEMPORAL_ADDRESS PUBLISHING_SERVICE_TOKEN POSTIZ_API_KEY AUDIT_RETENTION_DATABASE_URL RESEND_API_KEY AUTH_EMAIL_FROM"
        self.secrets = {key: "fixture-" + key for key in keys.split()}
        self.secrets.update(DATABASE_URL="postgresql://web:secret@db:5432/tenant",
                            MIGRATION_DATABASE_URL="postgresql://migrate:secret@db:5432/tenant",
                            AUDIT_RETENTION_DATABASE_URL="postgresql://retention:secret@db:5432/tenant",
                            BETTER_AUTH_URL="https://app.example.com")

    def test_preserves_web_and_restricts_internal_services(self):
        spec = render_spec.render(self.base, self.secrets)
        services = {item["name"]: item for item in spec["services"]}
        self.assertEqual(services["web"]["image"], self.base["services"][0]["image"])
        self.assertEqual(services["web"]["instance_count"], 2)
        self.assertEqual(spec["domains"], self.base["domains"])
        self.assertEqual(set(services), {"web", "screenshot-studio-backend"})
        web_envs = {item["key"]: item for item in services["web"]["envs"]}
        self.assertEqual(web_envs["PLATFORM_RENDER_CDP_URL"]["value"], "fixture-PLATFORM_RENDER_CDP_URL")
        self.assertEqual(web_envs["PLATFORM_RENDER_CDP_TOKEN"]["type"], "SECRET")
        self.assertEqual({r["component"]["name"] for r in spec["ingress"]["rules"]}, {"web", "screenshot-studio-backend"})
        for component in spec["services"] + spec["jobs"]:
            for item in component.get("envs", []):
                if item["key"] != "EXISTING_SETTING":
                    self.assertEqual(item.get("scope"), "RUN_TIME")
                if item["key"] in ["DATABASE_URL", "JWT_SECRET", "TEMPORAL_API_KEY", "TENANT_DATABASE_URL", "TENANT_TEMPORAL_API_KEY", "PLATFORM_RENDER_CDP_TOKEN"]:
                    self.assertEqual(item["type"], "SECRET")
        self.assertNotIn("AUDIT_RETENTION_DATABASE_URL", {e["key"] for e in services["web"]["envs"]})
        backend = services["screenshot-studio-backend"]
        self.assertEqual(backend["health_check"]["port"], 3003)
        self.assertEqual(backend["internal_ports"], [3003, 8082])
        self.assertEqual(backend["instance_size_slug"], "apps-s-1vcpu-2gb")
        worker_env = {e["key"]: e for e in backend["envs"]}
        self.assertEqual(worker_env["RUN_WORKER"]["value"], "true")
        self.assertEqual(worker_env["DISABLE_REGISTRATION"]["value"], "true")
        self.assertEqual(worker_env["TENANT_RUN_MAINTENANCE"]["value"], "true")
        self.assertEqual(worker_env["TENANT_PUBLISHING_SERVICE_TOKEN"]["type"], "SECRET")
        self.assertEqual(worker_env["TENANT_AUDIT_RETENTION_DATABASE_URL"]["type"], "SECRET")
        self.assertEqual({j["kind"] for j in spec["jobs"]}, {"PRE_DEPLOY"})

    def test_social_and_tenant_services_share_one_database(self):
        spec = render_spec.render(self.base, self.secrets)
        backend = next(item for item in spec["services"] if item["name"] == "screenshot-studio-backend")
        backend_env = {item["key"]: item["value"] for item in backend["envs"]}
        migration = next(item for item in spec["jobs"] if item["name"] == "platform-migrate")
        migration_env = {item["key"]: item["value"] for item in migration["envs"]}
        self.assertEqual(backend_env["DATABASE_URL"], self.secrets["DATABASE_URL"])
        self.assertEqual(backend_env["TENANT_DATABASE_URL"], self.secrets["DATABASE_URL"])
        self.assertEqual(migration_env["DATABASE_URL"], self.secrets["MIGRATION_DATABASE_URL"])
        self.assertNotIn("TENANT_PUBLISHING_DIRECT_PROVIDER", backend_env)

    def test_optional_social_credentials_only_reach_backend(self):
        keys = ("X_API_KEY", "X_API_SECRET", "FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET",
                "INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET")
        spec = render_spec.render(self.base, self.secrets)
        backend = next(item for item in spec["services"] if item["name"] == "screenshot-studio-backend")
        self.assertTrue(set(keys).isdisjoint({item["key"] for item in backend["envs"]}))

        self.secrets.update({key: "other-service-" + key for key in keys})
        spec = render_spec.render(self.base, self.secrets)
        backend = next(item for item in spec["services"] if item["name"] == "screenshot-studio-backend")
        self.assertTrue(set(keys).isdisjoint({item["key"] for item in backend["envs"]}))

        self.secrets.update({"POSTIZ_GO_" + key: "fixture-" + key for key in keys})
        spec = render_spec.render(self.base, self.secrets)
        for component in spec["services"] + spec["jobs"]:
            envs = {item["key"]: item for item in component.get("envs", [])}
            if component["name"] == "screenshot-studio-backend":
                for key in keys:
                    self.assertEqual(envs[key]["value"], self.secrets["POSTIZ_GO_" + key])
                    self.assertEqual(envs[key]["type"], "SECRET")
            else:
                self.assertTrue(set(keys).isdisjoint(envs))
        del self.secrets["POSTIZ_GO_X_API_KEY"]
        del self.secrets["POSTIZ_GO_X_API_SECRET"]
        rerendered = render_spec.render(spec, self.secrets)
        backend = next(item for item in rerendered["services"] if item["name"] == "screenshot-studio-backend")
        self.assertTrue({"X_API_KEY", "X_API_SECRET"}.isdisjoint({item["key"] for item in backend["envs"]}))

    def test_web_uses_backend_without_database_and_go_migrates_schema(self):
        self.base["services"][0]["envs"].append({"key": "POSTIZ_API_KEY_TENANT", "value": "legacy-social-key", "type": "SECRET"})
        spec = render_spec.render(self.base, self.secrets)
        web = next(item for item in spec["services"] if item["name"] == "web")
        envs = {item["key"]: item for item in web["envs"]}
        self.assertEqual(envs["PUBLISHING_API_URL"]["value"], "http://screenshot-studio-backend:8082")
        self.assertEqual(envs["PUBLISHING_SERVICE_TOKEN"]["type"], "SECRET")
        self.assertTrue(render_spec.WEB_DATABASE_KEYS.isdisjoint(envs))
        self.assertFalse(any(key.startswith("POSTIZ_API_KEY_") for key in envs))
        jobs = {item["name"]: item for item in spec["jobs"]}
        self.assertEqual(set(jobs), {"platform-migrate"})
        migrate = jobs["platform-migrate"]
        self.assertEqual(migrate["run_command"], "/platform-migrate")
        self.assertEqual(migrate["dockerfile_path"], next(item for item in spec["services"] if item["name"] == "screenshot-studio-backend")["dockerfile_path"])
        self.assertEqual(migrate["envs"], [{"key": "DATABASE_URL", "value": self.secrets["MIGRATION_DATABASE_URL"],
                                            "scope": "RUN_TIME", "type": "SECRET"}])

    def test_fails_closed_for_missing_secrets_or_colliding_queues(self):
        del self.secrets["R2_ACCESS_KEY_ID"]
        with self.assertRaisesRegex(ValueError, "R2_ACCESS_KEY_ID"):
            render_spec.render(self.base, self.secrets)
        self.secrets["R2_ACCESS_KEY_ID"] = "fixture"
        self.secrets["POSTIZ_TEMPORAL_NAMESPACE"] = self.secrets["TEMPORAL_NAMESPACE"]
        with self.assertRaisesRegex(ValueError, "different Temporal namespaces"):
            render_spec.render(self.base, self.secrets)

    def test_rejects_a_second_product_database(self):
        self.secrets["MIGRATION_DATABASE_URL"] = "postgresql://migrate:secret@db:5432/other"
        with self.assertRaisesRegex(ValueError, "same product database"):
            render_spec.render(self.base, self.secrets)

    def test_repeat_render_does_not_duplicate_components_jobs_or_routes(self):
        spec = render_spec.render(self.base, self.secrets)
        self.assertEqual(render_spec.render(spec, self.secrets), spec)
        self.assertEqual(render_spec.render([{"spec": self.base}], self.secrets), spec)
        self.assertEqual(len(self.base["services"]), 1)

    def test_repeat_render_keeps_existing_github_image_digest(self):
        spec = render_spec.render(self.base, self.secrets)
        backend = next(item for item in spec["services"] if item["name"] == "screenshot-studio-backend")
        backend.pop("git")
        backend.pop("source_dir")
        backend.pop("dockerfile_path")
        backend["image"] = {"registry_type": "GHCR", "registry": "playbookmediallc",
                            "repository": "screenshot-studio", "digest": "sha256:" + "a" * 64}
        rerendered = render_spec.render(spec, self.secrets)
        updated = next(item for item in rerendered["services"] if item["name"] == "screenshot-studio-backend")
        self.assertEqual(updated["image"], backend["image"])
        self.assertNotIn("git", updated)

    def test_collaboration_ships_only_with_its_secrets(self):
        spec = render_spec.render(self.base, self.secrets)
        self.assertNotIn("collab", [item["name"] for item in spec["services"]])
        self.secrets.update(COLLAB_TOKEN_SECRET="fixture-signing", COLLAB_SERVICE_TOKEN="fixture-service")
        spec = render_spec.render(self.base, self.secrets)
        services = {item["name"]: item for item in spec["services"]}
        collab = services["collab"]
        collab_env = {item["key"]: item for item in collab["envs"]}
        backend_env = {item["key"] for item in services["screenshot-studio-backend"]["envs"]}
        web_env = {item["key"]: item["value"] for item in services["web"]["envs"]}
        self.assertEqual(collab["dockerfile_path"], "packages/collab-server/Dockerfile")
        self.assertEqual(collab_env["COLLAB_SERVICE_TOKEN"]["type"], "SECRET")
        # The collab service never gets the signing key or a database.
        self.assertNotIn("COLLAB_TOKEN_SECRET", collab_env)
        self.assertFalse({"DATABASE_URL", "REDIS_URL"} & set(collab_env))
        self.assertTrue({"TENANT_COLLAB_TOKEN_SECRET", "TENANT_COLLAB_SERVICE_TOKEN"} <= backend_env)
        self.assertEqual(web_env["PLATFORM_COLLAB_URL"], "wss://app.example.com/collab")
        self.assertNotIn("COLLAB_TOKEN_SECRET", web_env)
        self.assertEqual(spec["ingress"]["rules"][0]["component"]["name"], "collab")
        self.assertEqual(render_spec.render(spec, self.secrets), spec)


if __name__ == "__main__":
    unittest.main()
