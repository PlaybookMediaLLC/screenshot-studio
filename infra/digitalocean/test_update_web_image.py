import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("update_web_image", Path(__file__).with_name("update-web-image.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class UpdateWebImageTest(unittest.TestCase):
    def setUp(self):
        image = dict(module.IMAGE, digest="sha256:" + "a" * 64)
        self.base = {"spec": {
            "services": [
                {"name": "web", "image": image, "envs": [{"key": "REDIS_URL", "value": "old", "type": "SECRET"},
                                                         {"key": "DATABASE_URL", "value": "old", "type": "SECRET"}]},
                {"name": "storage"}, {"name": "design-renderer"},
                {"name": "screenshot-studio-backend"},
            ],
            "jobs": [
                {"name": "platform-migrate", "image": {"tag": "social-backend-sha"}},
                {"name": "postiz-migrate"},
            ],
            "domains": [{"domain": "shots.oppulence.io"}],
        }}

    def test_updates_only_web_image_and_refreshes_scoped_credentials(self):
        tag = "web-" + "b" * 40
        result = module.update_web_image(self.base, tag, {"REDIS_URL": "runtime-redis"})
        self.assertEqual(result["services"][0]["image"], dict(module.IMAGE, tag=tag))
        self.assertEqual(result["jobs"], self.base["spec"]["jobs"])
        self.assertEqual(result["services"][0]["envs"][0]["value"], "runtime-redis")
        self.assertNotIn("DATABASE_URL", {item["key"] for item in result["services"][0]["envs"]})
        self.assertIn({"key": "CLIENT_IP_SOURCE", "value": "digitalocean",
                       "type": "GENERAL", "scope": "RUN_TIME"}, result["services"][0]["envs"])
        self.assertEqual(result["domains"], self.base["spec"]["domains"])
        self.assertEqual(self.base["spec"]["services"][0]["image"]["digest"], "sha256:" + "a" * 64)

    def test_rejects_unexpected_topology_and_missing_secret(self):
        tag = "web-" + "b" * 40
        with self.assertRaisesRegex(ValueError, "Missing Infisical"):
            module.update_web_image(self.base, tag, {})
        bad = {"spec": {**self.base["spec"], "services": self.base["spec"]["services"][:-1]}}
        with self.assertRaisesRegex(ValueError, "topology changed"):
            module.update_web_image(bad, tag)
        with self.assertRaisesRegex(ValueError, "commit SHA"):
            module.update_web_image(self.base, "latest")
        legacy = {"spec": {**self.base["spec"], "jobs": [{"name": "web-migrate"}, {"name": "postiz-migrate"}]}}
        with self.assertRaisesRegex(ValueError, "Deploy the backend first"):
            module.update_web_image(legacy, tag)
