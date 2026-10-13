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
                {"name": "postiz-backend", "git": {"branch": "main"}, "source_dir": "services", "dockerfile_path": "Dockerfile", "envs": [env("DATABASE_URL"), env("TEMPORAL_NAMESPACE"), env("BACKEND_INTERNAL_URL", "http://postiz-backend:3000", "GENERAL")]},
                {"name": "postiz-orchestrator", "envs": []},
                {"name": "publishing-backend", "envs": []},
                {"name": "publishing-orchestrator", "envs": [env(key, "true" if key in ("RUN_MAINTENANCE", "RUN_CRON") else "EV[encrypted]", "GENERAL" if key in ("RUN_MAINTENANCE", "RUN_CRON", "POSTIZ_API_URL") else "SECRET") for key in tenant_keys]},
            ],
            "jobs": [{"name": "web-migrate"}, {"name": "postiz-migrate", "git": {"branch": "main"}, "source_dir": "services", "dockerfile_path": "Dockerfile", "envs": [env("DATABASE_URL")]}],
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
        values = {item["key"]: item for item in backend["envs"]}
        self.assertEqual(values["TENANT_AUDIT_RETENTION_DATABASE_URL"]["value"], "EV[encrypted]")
        self.assertEqual(values["TENANT_AUDIT_RETENTION_DATABASE_URL"]["type"], "SECRET")
        self.assertEqual(values["TENANT_RUN_MAINTENANCE"]["value"], "true")
        self.assertEqual(values["RUN_WORKER"]["value"], "true")
        self.assertEqual(spec["ingress"]["rules"][0]["component"]["name"], "screenshot-studio-backend")
        self.assertEqual(spec["jobs"][1]["image"]["digest"], self.digest)
        self.assertEqual(len(self.base["spec"]["services"]), 7)

    def test_refuses_unexpected_topology(self):
        self.base["spec"]["services"].append({"name": "unexpected"})
        with self.assertRaisesRegex(ValueError, "topology changed"):
            cutover.consolidate(self.base, self.digest)


if __name__ == "__main__":
    unittest.main()
