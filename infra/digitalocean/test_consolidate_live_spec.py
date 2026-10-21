"""Checks the production deploy patch without provider access."""

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

        tenant_keys = "DATABASE_URL TEMPORAL_ADDRESS TEMPORAL_NAMESPACE TEMPORAL_API_KEY AUDIT_RETENTION_DATABASE_URL AUDIT_DRAIN_ENCRYPTION_KEY RESEND_API_KEY STORAGE_SERVICE_KEY STORAGE_BUCKET STORAGE_API_URL BETTER_AUTH_SECRET BETTER_AUTH_URL AUTH_EMAIL_FROM RUN_MAINTENANCE RUN_CRON".split()
        general = {"RUN_MAINTENANCE", "RUN_CRON", "TEMPORAL_ADDRESS", "TEMPORAL_NAMESPACE", "STORAGE_BUCKET", "STORAGE_API_URL", "BETTER_AUTH_URL", "AUTH_EMAIL_FROM"}
        backend_envs = [env("DATABASE_URL"), env("PLATFORM_SOCIAL_ENCRYPTION_KEY"), env("TEMPORAL_NAMESPACE", "social-namespace", "GENERAL"),
                        env("BACKEND_INTERNAL_URL", "http://127.0.0.1:3000", "GENERAL"), env("TENANT_PUBLISHING_SERVICE_TOKEN")]
        backend_envs += [env("TENANT_" + key, "true" if key in ("RUN_MAINTENANCE", "RUN_CRON") else "EV[encrypted]",
                             "GENERAL" if key in general else "SECRET") for key in tenant_keys]
        # The live app still holds the legacy names; each deploy moves them.
        backend_envs += [env("POSTIZ_PRIVATE_MEDIA", "false", "GENERAL"),
                         env("TENANT_POSTIZ_API_URL", "http://127.0.0.1:3000/public/v1", "GENERAL"),
                         env("TEMPORAL_POSTIZ_TASK_QUEUE", "postiz", "GENERAL")]
        image = dict(cutover.IMAGE, tag="social-backend-" + "0" * 40)
        self.base = {"spec": {
            "name": "production", "domains": [{"domain": "shots.example.com"}],
            "services": [
                {"name": "web", "image": {"digest": "web-digest"}, "envs": [env("POSTIZ_API_URL", "http://screenshot-studio-backend:3000/public/v1", "GENERAL")]},
                {"name": "storage", "image": {"tag": "fixed"}},
                {"name": "design-renderer", "git": {"branch": "main"}},
                {"name": "screenshot-studio-backend", "image": image, "envs": backend_envs},
            ],
            "jobs": [{"name": "platform-migrate", "image": image, "run_command": "/platform-migrate", "envs": [env("DATABASE_URL", "EV[migration-owner]")]},
                     {"name": "postiz-migrate", "image": image, "run_command": "/postiz-migrate", "envs": [env("DATABASE_URL")]}],
            "ingress": {"rules": [{"component": {"name": "screenshot-studio-backend"}}, {"component": {"name": "web"}}]},
        }}
        self.digest = "sha256:" + "a" * 64

    def test_preserves_unrelated_components_and_moves_legacy_names(self):
        spec = cutover.consolidate(self.base, self.digest)
        services = {item["name"]: item for item in spec["services"]}
        self.assertEqual(set(services), {"web", "storage", "design-renderer", "screenshot-studio-backend"})
        self.assertEqual(services["web"]["image"]["digest"], "web-digest")
        self.assertEqual(services["storage"]["image"]["tag"], "fixed")
        self.assertEqual(spec["domains"], self.base["spec"]["domains"])
        backend = services["screenshot-studio-backend"]
        self.assertEqual(backend["image"]["digest"], self.digest)
        self.assertEqual(backend["internal_ports"], [3003, 8082])
        values = {item["key"]: item for item in backend["envs"]}
        self.assertEqual(values["TENANT_AUDIT_RETENTION_DATABASE_URL"]["value"], "EV[encrypted]")
        self.assertEqual(values["TENANT_PUBLISHING_SERVICE_TOKEN"]["type"], "SECRET")
        self.assertEqual(values["DATABASE_URL"]["value"], values["TENANT_DATABASE_URL"]["value"])
        self.assertEqual(values["SOCIAL_PRIVATE_MEDIA"]["value"], "false")
        self.assertEqual(values["TENANT_SOCIAL_API_URL"]["value"], "http://127.0.0.1:3000/public/v1")
        # A pin to the legacy queue would keep new posts off the social queue.
        self.assertNotIn("TEMPORAL_SOCIAL_TASK_QUEUE", values)
        keys = {item["key"] for service in spec["services"] + spec["jobs"] for item in service.get("envs", [])}
        self.assertFalse({key for key in keys if "POSTIZ" in key})
        web_env = {item["key"]: item for item in services["web"]["envs"]}
        self.assertEqual(web_env["PUBLISHING_API_URL"]["value"], "http://screenshot-studio-backend:8082")
        self.assertEqual(web_env["SOCIAL_API_URL"]["value"], "http://screenshot-studio-backend:3000/public/v1")
        self.assertEqual(spec["ingress"]["rules"][0]["component"]["name"], "screenshot-studio-backend")
        social = spec["jobs"][1]
        self.assertEqual((social["name"], social["run_command"]), ("social-migrate", "/social-migrate"))
        self.assertEqual(social["image"]["digest"], self.digest)
        self.assertEqual(social["envs"][0]["value"], values["TENANT_DATABASE_URL"]["value"])
        platform = spec["jobs"][0]
        self.assertEqual((platform["name"], platform["run_command"]), ("platform-migrate", "/platform-migrate"))
        self.assertEqual(platform["image"]["digest"], self.digest)
        self.assertEqual(platform["envs"][0]["value"], "EV[migration-owner]")
        self.assertEqual(len(self.base["spec"]["services"]), 4)

    def test_reads_legacy_infisical_names_until_they_move(self):
        secrets = {key: "infisical-" + key for key in
                   "PLATFORM_SOCIAL_ENCRYPTION_KEY DATABASE_URL MIGRATION_DATABASE_URL TEMPORAL_API_KEY AUDIT_RETENTION_DATABASE_URL AUDIT_DRAIN_ENCRYPTION_KEY RESEND_API_KEY STORAGE_SERVICE_KEY BETTER_AUTH_SECRET PUBLISHING_SERVICE_TOKEN R2_ENDPOINT R2_BUCKET_NAME R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY REDIS_URL".split()}
        spec = cutover.consolidate(self.base, self.digest, dict(secrets, POSTIZ_GO_X_API_KEY="legacy-x", SOCIAL_X_API_SECRET="new-x",
                                                                POSTIZ_GO_X_API_SECRET="stale-x"))
        backend = next(item for item in spec["services"] if item["name"] == "screenshot-studio-backend")
        values = {item["key"]: item["value"] for item in backend["envs"]}
        self.assertEqual(values["X_API_KEY"], "legacy-x")
        # Once the social name exists in Infisical, it wins.
        self.assertEqual(values["X_API_SECRET"], "new-x")

    def test_notifications_configuration_stays_backend_owned(self):
        backend = self.base["spec"]["services"][-1]
        keys = ("PLATFORM_NOTIFICATION_ENCRYPTION_KEY", "SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET",
                "PLATFORM_SLACK_CALLBACK_URL", "INTEGRATION_ENCRYPTION_KEY",
                "PLATFORM_WEBHOOK_ENCRYPTION_KEY")
        secrets = {key: "fixture-" + key for key in keys}
        secrets.update({key: "fixture" for key in ("R2_ENDPOINT", "R2_BUCKET_NAME", "R2_ACCESS_KEY_ID",
                                                  "R2_SECRET_ACCESS_KEY", "REDIS_URL")})
        cutover.configure_product_api(backend, secrets)
        values = {item["key"]: item for item in backend["envs"]}
        for key in keys:
            self.assertEqual(values["TENANT_" + key]["value"], secrets[key])
            self.assertEqual(values["TENANT_" + key]["type"], "SECRET")
            self.assertEqual(values["TENANT_" + key]["scope"], "RUN_TIME")
        cutover.configure_product_api(backend, {key: value for key, value in secrets.items() if key not in keys})
        self.assertFalse({item["key"] for item in backend["envs"]} & {"TENANT_" + key for key in keys})

    def test_refuses_unexpected_topology(self):
        self.base["spec"]["services"].append({"name": "unexpected"})
        with self.assertRaisesRegex(ValueError, "topology changed"):
            cutover.consolidate(self.base, self.digest)

    def test_social_credential_key_is_required_and_backend_only(self):
        envs = []
        with self.assertRaisesRegex(ValueError, "PLATFORM_SOCIAL_ENCRYPTION_KEY"):
            cutover.configure_social_credentials(envs, None)
        with self.assertRaisesRegex(ValueError, "PLATFORM_SOCIAL_ENCRYPTION_KEY"):
            cutover.configure_social_credentials(envs, {})
        cutover.configure_social_credentials(envs, {"PLATFORM_SOCIAL_ENCRYPTION_KEY": "private-fixture"})
        self.assertEqual(envs, [{"key": "PLATFORM_SOCIAL_ENCRYPTION_KEY", "value": "private-fixture",
                                 "type": "SECRET", "scope": "RUN_TIME"}])
        cutover.configure_social_credentials(envs, None)
        spec = cutover.consolidate(self.base, self.digest)
        web = next(item for item in spec["services"] if item["name"] == "web")
        self.assertNotIn("PLATFORM_SOCIAL_ENCRYPTION_KEY", {item["key"] for item in web["envs"]})

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
        self.assertEqual([job["name"] for job in repeated["jobs"]], ["platform-migrate", "social-migrate"])
        self.assertEqual(repeated["jobs"][0]["image"]["tag"], second_tag)
        self.assertEqual(len(repeated["services"]), 4)
        with self.assertRaisesRegex(ValueError, "commit SHA"):
            cutover.consolidate(self.base, self.digest, tag="latest")

    def test_uses_infisical_for_new_backend_credentials(self):
        secrets = {key: "infisical-" + key for key in
                   "SOCIAL_TEMPORAL_API_KEY PLATFORM_SOCIAL_ENCRYPTION_KEY DATABASE_URL MIGRATION_DATABASE_URL TEMPORAL_API_KEY AUDIT_RETENTION_DATABASE_URL AUDIT_DRAIN_ENCRYPTION_KEY RESEND_API_KEY STORAGE_SERVICE_KEY BETTER_AUTH_SECRET PUBLISHING_SERVICE_TOKEN R2_ENDPOINT R2_BUCKET_NAME R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY REDIS_URL".split()}
        secrets.update({cutover.SOCIAL_SECRET_SOURCES.get(key, key): "infisical-" + key
                        for key in cutover.OPTIONAL_SOCIAL_SECRETS})
        secrets.update({key: "other-service-" + key for key in cutover.OPTIONAL_SOCIAL_SECRETS
                        if key in cutover.SOCIAL_SECRET_SOURCES})
        social = next(service for service in self.base["spec"]["services"] if service["name"] == "screenshot-studio-backend")
        social["envs"].append({"key": "FACEBOOK_APP_SECRET", "value": "old-plain-value", "type": "GENERAL", "scope": "RUN_TIME"})
        spec = cutover.consolidate(self.base, self.digest, secrets)
        backend = next(item for item in spec["services"] if item["name"] == "screenshot-studio-backend")
        values = {item["key"]: item["value"] for item in backend["envs"]}
        self.assertEqual(values["DATABASE_URL"], "infisical-DATABASE_URL")
        self.assertEqual(values["TENANT_DATABASE_URL"], "infisical-DATABASE_URL")
        # Migration jobs run as the migration owner, never the runtime role.
        self.assertEqual(next(item for item in spec["jobs"] if item["name"] == "social-migrate")["envs"][0]["value"], "infisical-MIGRATION_DATABASE_URL")
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
        del withdrawn["SOCIAL_FACEBOOK_APP_SECRET"]
        retired = cutover.consolidate(spec, self.digest, withdrawn)
        retired_backend = next(item for item in retired["services"] if item["name"] == "screenshot-studio-backend")
        self.assertNotIn("FACEBOOK_APP_SECRET", {item["key"] for item in retired_backend["envs"]})
        retired_initial = cutover.consolidate(self.base, self.digest, withdrawn)
        retired_initial_backend = next(item for item in retired_initial["services"] if item["name"] == "screenshot-studio-backend")
        self.assertNotIn("FACEBOOK_APP_SECRET", {item["key"] for item in retired_initial_backend["envs"]})
        with self.assertRaisesRegex(ValueError, "DATABASE_URL"):
            cutover.consolidate(self.base, self.digest, {})

    def test_every_backend_secret_comes_from_infisical(self):
        envs = [{"key": "TENANT_GITHUB_APP_PRIVATE_KEY", "value": "EV[live]", "type": "SECRET"}]
        cutover.refresh_secrets(envs, {"GITHUB_APP_PRIVATE_KEY": "fresh"})
        self.assertEqual(envs[0]["value"], "fresh")
        # A live value is not enough; Infisical is the only source.
        with self.assertRaisesRegex(ValueError, "Missing Infisical secret: GITHUB_APP_PRIVATE_KEY"):
            cutover.refresh_secrets(envs, {})

    def test_web_reaches_backend_and_go_owns_migrations(self):
        secrets = {key: "infisical-" + key for key in
                   "SOCIAL_TEMPORAL_API_KEY PLATFORM_SOCIAL_ENCRYPTION_KEY DATABASE_URL MIGRATION_DATABASE_URL TEMPORAL_API_KEY AUDIT_RETENTION_DATABASE_URL AUDIT_DRAIN_ENCRYPTION_KEY RESEND_API_KEY STORAGE_SERVICE_KEY BETTER_AUTH_SECRET PUBLISHING_SERVICE_TOKEN R2_ENDPOINT R2_BUCKET_NAME R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY REDIS_URL".split()}
        spec = cutover.consolidate(self.base, self.digest, secrets)
        web = next(item for item in spec["services"] if item["name"] == "web")
        envs = {item["key"]: item for item in web["envs"]}
        self.assertEqual(envs["PUBLISHING_API_URL"]["value"], "http://screenshot-studio-backend:8082")
        self.assertEqual(envs["PUBLISHING_SERVICE_TOKEN"]["value"], "infisical-PUBLISHING_SERVICE_TOKEN")
        jobs = {item["name"]: item for item in spec["jobs"]}
        self.assertEqual(set(jobs), {"platform-migrate", "social-migrate"})
        self.assertEqual(jobs["platform-migrate"]["envs"][0]["value"], "infisical-MIGRATION_DATABASE_URL")
        del secrets["MIGRATION_DATABASE_URL"]
        with self.assertRaisesRegex(ValueError, "MIGRATION_DATABASE_URL"):
            cutover.consolidate(spec, self.digest, secrets)

    def test_product_api_gets_storage_and_quota_counter(self):
        secrets = {key: "infisical-" + key for key in
                   "SOCIAL_TEMPORAL_API_KEY PLATFORM_SOCIAL_ENCRYPTION_KEY DATABASE_URL MIGRATION_DATABASE_URL TEMPORAL_API_KEY AUDIT_RETENTION_DATABASE_URL AUDIT_DRAIN_ENCRYPTION_KEY RESEND_API_KEY STORAGE_SERVICE_KEY BETTER_AUTH_SECRET PUBLISHING_SERVICE_TOKEN R2_ENDPOINT R2_BUCKET_NAME R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY REDIS_URL".split()}
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

    def test_collab_service_ships_only_with_its_secrets(self):
        secrets = {key: "infisical-" + key for key in
                   "SOCIAL_TEMPORAL_API_KEY PLATFORM_SOCIAL_ENCRYPTION_KEY DATABASE_URL MIGRATION_DATABASE_URL TEMPORAL_API_KEY AUDIT_RETENTION_DATABASE_URL AUDIT_DRAIN_ENCRYPTION_KEY RESEND_API_KEY STORAGE_SERVICE_KEY BETTER_AUTH_SECRET PUBLISHING_SERVICE_TOKEN R2_ENDPOINT R2_BUCKET_NAME R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY REDIS_URL".split()}
        collab_tag = "collab-" + "c" * 40
        live = cutover.consolidate(self.base, self.digest, secrets)
        self.assertNotIn("collab", {item["name"] for item in cutover.consolidate(live, self.digest, secrets, None, collab_tag)["services"]})
        enabled = dict(secrets, COLLAB_TOKEN_SECRET="signing-key", COLLAB_SERVICE_TOKEN="collab-credential")
        spec = cutover.consolidate(live, self.digest, enabled, None, collab_tag)
        services = {item["name"]: item for item in spec["services"]}
        collab = services["collab"]
        self.assertEqual(collab["image"], dict(cutover.IMAGE, tag=collab_tag))
        collab_env = {item["key"]: item for item in collab["envs"]}
        self.assertEqual(collab_env["COLLAB_BACKEND_URL"]["value"], "http://screenshot-studio-backend:8082")
        self.assertEqual((collab_env["COLLAB_SERVICE_TOKEN"]["type"], collab_env["COLLAB_SERVICE_TOKEN"]["value"]),
                         ("SECRET", "collab-credential"))
        # The collab service gets no signing key, database or Redis setting.
        self.assertEqual(set(collab_env), {"COLLAB_BACKEND_URL", "COLLAB_SERVICE_TOKEN"})
        backend = {item["key"]: item["value"] for item in services["screenshot-studio-backend"]["envs"]}
        self.assertEqual(backend["TENANT_COLLAB_TOKEN_SECRET"], "signing-key")
        self.assertEqual(backend["TENANT_COLLAB_SERVICE_TOKEN"], "collab-credential")
        self.assertEqual(spec["ingress"]["rules"][0], {"match": {"path": {"prefix": "/collab"}}, "component": {"name": "collab"}})
        repeated = cutover.consolidate(spec, self.digest, enabled, None, collab_tag)
        self.assertEqual(repeated, spec)
        withdrawn = cutover.consolidate(spec, self.digest, secrets, None, collab_tag)
        self.assertNotIn("collab", {item["name"] for item in withdrawn["services"]})
        self.assertNotIn("collab", {rule["component"]["name"] for rule in withdrawn["ingress"]["rules"]})
        withdrawn_backend = next(item for item in withdrawn["services"] if item["name"] == "screenshot-studio-backend")
        self.assertFalse({"TENANT_COLLAB_TOKEN_SECRET", "TENANT_COLLAB_SERVICE_TOKEN"} & {item["key"] for item in withdrawn_backend["envs"]})
        with self.assertRaisesRegex(ValueError, "collab-<commit SHA>"):
            cutover.consolidate(live, self.digest, enabled, None, "collab-latest")
        with self.assertRaisesRegex(ValueError, "COLLAB_REDIS_URL"):
            cutover.consolidate(live, self.digest, dict(enabled, COLLAB_INSTANCE_COUNT="2"), None, collab_tag)
        scaled = cutover.consolidate(live, self.digest, dict(enabled, COLLAB_INSTANCE_COUNT="3",
                                                             COLLAB_REDIS_URL="rediss://collab"), None, collab_tag)
        scaled_collab = next(item for item in scaled["services"] if item["name"] == "collab")
        self.assertEqual(scaled_collab["instance_count"], 3)
        self.assertEqual({item["key"]: item["type"] for item in scaled_collab["envs"]}["COLLAB_REDIS_URL"], "SECRET")

    def test_onboarding_keys_follow_infisical(self):
        secrets = {key: "infisical-" + key for key in
                   "SOCIAL_TEMPORAL_API_KEY PLATFORM_SOCIAL_ENCRYPTION_KEY DATABASE_URL MIGRATION_DATABASE_URL TEMPORAL_API_KEY AUDIT_RETENTION_DATABASE_URL AUDIT_DRAIN_ENCRYPTION_KEY RESEND_API_KEY STORAGE_SERVICE_KEY BETTER_AUTH_SECRET PUBLISHING_SERVICE_TOKEN R2_ENDPOINT R2_BUCKET_NAME R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY REDIS_URL".split()}
        first = cutover.consolidate(self.base, self.digest, secrets)
        backend_envs = lambda spec: {item["key"]: item for item in next(
            item for item in spec["services"] if item["name"] == "screenshot-studio-backend")["envs"]}
        self.assertFalse(cutover.OPTIONAL_TENANT_KEYS & set(backend_envs(first)))
        # A key added to Infisical reaches the live app on the next deploy.
        keyed = cutover.consolidate(first, self.digest, dict(secrets, PLATFORM_ENRICHMENT_EXA_API_KEY="exa", OPENROUTER_API_KEY="or"))
        envs = backend_envs(keyed)
        self.assertEqual(envs["TENANT_PLATFORM_ENRICHMENT_EXA_API_KEY"], {"key": "TENANT_PLATFORM_ENRICHMENT_EXA_API_KEY", "value": "exa",
                                                                          "type": "SECRET", "scope": "RUN_TIME"})
        self.assertEqual(envs["TENANT_OPENROUTER_API_KEY"]["value"], "or")
        # Removing it from Infisical removes it from the app instead of failing the deploy.
        self.assertFalse(cutover.OPTIONAL_TENANT_KEYS & set(backend_envs(cutover.consolidate(keyed, self.digest, secrets))))

    def test_mcp_host_follows_infisical(self):
        secrets = {key: "infisical-" + key for key in
                   "SOCIAL_TEMPORAL_API_KEY PLATFORM_SOCIAL_ENCRYPTION_KEY DATABASE_URL MIGRATION_DATABASE_URL TEMPORAL_API_KEY AUDIT_RETENTION_DATABASE_URL AUDIT_DRAIN_ENCRYPTION_KEY RESEND_API_KEY STORAGE_SERVICE_KEY BETTER_AUTH_SECRET PUBLISHING_SERVICE_TOKEN R2_ENDPOINT R2_BUCKET_NAME R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY REDIS_URL".split()}
        live = cutover.consolidate(self.base, self.digest, secrets)
        self.assertFalse(any(cutover.is_mcp_rule(rule) for rule in live["ingress"]["rules"]))
        enabled = dict(secrets, PLATFORM_MCP_URL="https://mcp.example.com/mcp")
        spec = cutover.consolidate(live, self.digest, enabled)
        services = {item["name"]: item for item in spec["services"]}
        for name in ("web", "screenshot-studio-backend"):
            envs = {item["key"]: item for item in services[name]["envs"]}
            self.assertEqual(envs["PLATFORM_MCP_URL"]["value"], "https://mcp.example.com/mcp")
        # Only the MCP and OAuth paths on the MCP host reach the backend, ahead of the web.
        rules = spec["ingress"]["rules"]
        mcp_rules = rules[:len(cutover.MCP_PATH_PREFIXES)]
        self.assertEqual([rule["match"]["path"]["prefix"] for rule in mcp_rules], list(cutover.MCP_PATH_PREFIXES))
        for rule in mcp_rules:
            self.assertEqual(rule["match"]["authority"], {"exact": "mcp.example.com"})
            self.assertEqual(rule["component"], {"name": "screenshot-studio-backend", "preserve_path_prefix": True})
        self.assertEqual(sum(cutover.is_mcp_rule(rule) for rule in rules), len(cutover.MCP_PATH_PREFIXES))
        self.assertIn({"domain": "mcp.example.com", "type": "ALIAS"}, spec["domains"])
        self.assertIn({"domain": "shots.example.com"}, spec["domains"])
        self.assertEqual(cutover.consolidate(spec, self.digest, enabled), spec)
        # A deploy without Infisical values leaves the live MCP host alone.
        self.assertEqual(cutover.consolidate(spec, self.digest)["domains"], spec["domains"])
        moved = cutover.consolidate(spec, self.digest, dict(secrets, PLATFORM_MCP_URL="https://agents.example.com/mcp"))
        self.assertEqual([item["domain"] for item in moved["domains"]], ["shots.example.com", "agents.example.com"])
        removed = cutover.consolidate(spec, self.digest, secrets)
        self.assertEqual(removed["domains"], [{"domain": "shots.example.com"}])
        self.assertFalse(any(cutover.is_mcp_rule(rule) for rule in removed["ingress"]["rules"]))
        self.assertNotIn("PLATFORM_MCP_URL", {item["key"] for service in removed["services"] for item in service.get("envs", [])})
        for url in ("http://mcp.example.com/mcp", "https://shots.example.com/social/mcp"):
            with self.assertRaisesRegex(ValueError, "PLATFORM_MCP_URL"):
                cutover.consolidate(live, self.digest, dict(secrets, PLATFORM_MCP_URL=url))


if __name__ == "__main__":
    unittest.main()
