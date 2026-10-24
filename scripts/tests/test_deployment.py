"""Exercise release delivery with real files and a fake Docker executable."""

import json
import os
import pty
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
COMMIT = "a" * 40
IMAGES = "".join(
    f"{name}_IMAGE=ghcr.io/example/bomish/{name.lower()}@sha256:{digit * 64}\n"
    for name, digit in (("API", "1"), ("WEB", "2"), ("BACKUP", "3"))
)


class DeploymentTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        (self.source / "scripts").mkdir(parents=True)
        for name in ("deploy.sh", "validate-release.py", "production.py", "preflight.py",
                     "verify-site.py", "first-install.sh", "origin_auth.py"):
            shutil.copy2(REPO / "scripts" / name, self.source / "scripts" / name)
        shutil.copy2(REPO / "compose.production.yaml", self.source / "compose.production.yaml")
        self.host = self.root / "host"
        self.host.mkdir()
        self.secrets = self.host / "secrets"
        subprocess.run(["python3", str(REPO / "scripts/init-deployment.py"), str(self.secrets)],
                       check=True, capture_output=True)
        credentials = self.secrets / "backup_credentials"
        credentials.chmod(0o600)
        credentials.write_text("[default]\naws_access_key_id=test\naws_secret_access_key=test\n")
        credentials.chmod(0o444)
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256",
            "-nodes", "-days", "30", "-subj", "/CN=bomish.test",
            "-addext", "subjectAltName=DNS:bomish.test",
            "-keyout", str(self.secrets / "tls/origin.key"),
            "-out", str(self.secrets / "tls/origin.crt"),
        ], check=True, capture_output=True)
        self.config = self.host / "deployment.env"
        self.config.write_text(
            f"COMPOSE_PROJECT_NAME=test\nSITE_HOST=bomish.test\nSECRETS_DIR={self.secrets}\n"
            "CLOUDFLARE_CIDRS=192.0.2.0/24\nTRUSTED_PROXY_CIDRS=172.30.10.0/24,192.0.2.0/24\n"
            "RESTIC_REPOSITORY=s3:https://s3.example.test/bucket/test\n"
        )
        self.images = self.host / "images.env"
        self.images.write_text(IMAGES)
        # Compose configuration rendering needs the CLI, but no Docker daemon.
        clean_env = {k: v for k, v in os.environ.items() if k not in (
            "API_IMAGE", "WEB_IMAGE", "BACKUP_IMAGE", "SECRETS_DIR", "SITE_HOST",
            "CLOUDFLARE_CIDRS", "TRUSTED_PROXY_CIDRS", "RESTIC_REPOSITORY",
            "COMPOSE_PROJECT_NAME", "EDGE_SUBNET", "SITE_INDEXABLE", "ORIGIN_AUTH_MODE",
        )}
        self.model = self.root / "model.json"
        self.model.write_bytes(subprocess.check_output([
            "docker", "compose", "--env-file", str(self.config),
            "--env-file", str(self.images), "-f", str(self.source / "compose.production.yaml"),
            "--profile", "tools", "config", "--format", "json",
        ], env=clean_env))
        self.bin = self.root / "bin"
        self.bin.mkdir()
        docker = self.bin / "docker"
        docker.write_text(
            """#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
with open(os.environ["DOCKER_TEST_LOG"], "a") as log:
    log.write(json.dumps({"args": args, "cwd": os.getcwd()}) + "\\n")
if "-f" in args and "up" in args and "api" in args:
    compose = str(Path(args[args.index("-f") + 1]).resolve())
    if compose == os.environ.get("DOCKER_TEST_FAIL_COMPOSE"):
        sys.exit(1)
if "config" in args and "--format" in args:
    model = json.loads(Path(os.environ["DOCKER_TEST_MODEL"]).read_text())
    # Mimic image manifest interpolation for successive deliveries.
    if not os.environ.get("DOCKER_TEST_OVERRIDE_IMAGE"):
        manifest = Path(args[args.index("-f") - 1]).read_text()
        values = dict(line.split("=", 1) for line in manifest.splitlines())
        for service in ("api", "web", "backup"):
            model["services"][service]["image"] = values[service.upper() + "_IMAGE"]
    print(json.dumps(model))
elif args[0] == "info":
    print(json.dumps({"OSType": "linux", "Architecture": os.environ.get("DOCKER_TEST_ARCH", "x86_64")}))
elif args[:2] == ["image", "inspect"]:
    print("linux/amd64")
elif "pull" in args:
    sys.exit(int(os.environ.get("DOCKER_TEST_PULL_CODE", "0")))
elif args[-2:] == ["cat", "config"]:
    sys.exit(0 if Path(os.environ["DOCKER_TEST_RESTIC"]).exists()
             else int(os.environ.get("DOCKER_TEST_RESTIC_CODE", "10")))
elif args[-2:] == ["backup", "init"]:
    Path(os.environ["DOCKER_TEST_RESTIC"]).touch()
elif args[-2:] == ["owner-tools", "bootstrap-owner"]:
    Path(os.environ["DOCKER_TEST_OWNER"]).touch()
elif "psql" in args:
    print(("t" if "EXISTS" in args[-1] else "1") if Path(os.environ["DOCKER_TEST_OWNER"]).exists() else "0")
"""
        )
        docker.chmod(0o755)
        self.log = self.root / "docker.jsonl"
        self.env = {
            **os.environ,
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "DOCKER_TEST_LOG": str(self.log),
            "DOCKER_TEST_MODEL": str(self.model),
            "DOCKER_TEST_RESTIC": str(self.host / "restic-initialized"),
            "DOCKER_TEST_OWNER": str(self.host / "owner-created"),
            "CURL_TEST_LOG": str(self.root / "curl.jsonl"),
        }
        curl = self.bin / "curl"
        curl.write_text(
            """#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
with open(os.environ["CURL_TEST_LOG"], "a") as log:
    log.write(json.dumps(args) + "\\n")
if os.environ.get("CURL_TEST_FAIL_PUBLIC") and "--resolve" not in args:
    sys.exit(60)
if os.environ.get("CURL_TEST_FAIL_ORIGIN") and "--resolve" in args:
    sys.exit(90)
url = args[-1]
status, headers, body = 200, "CF-Ray: test\\nContent-Type: application/json\\n", ""
if url.startswith("http:"):
    status, headers = 301, "Location: " + url.replace("http:", "https:", 1) + "\\n"
elif url.endswith("/settings"):
    body = '{"catalogOnly":true}'
elif url.endswith("/health"):
    body = '{"status":"ok"}'
else:
    headers += "Content-Type: text/html\\n"
    body = "<html>Bomish</html>"
Path(args[args.index("--dump-header") + 1]).write_text(f"HTTP/1.1 {status}\\n" + headers)
Path(args[args.index("--output") + 1]).write_text(body)
print(status, end="")
"""
        )
        curl.chmod(0o755)

    def deliver(self, mode, delivery="10-1", images=IMAGES, check=True):
        incoming = self.host / "incoming" / delivery
        incoming.mkdir(parents=True)
        (incoming / "images.env").write_text(images)
        with tarfile.open(incoming / "source.tar.gz", "w:gz") as archive:
            for child in self.source.iterdir():
                archive.add(child, arcname=child.name)
        return subprocess.run(
            [
                "bash",
                str(REPO / "scripts" / "deploy-received.sh"),
                mode,
                COMMIT,
                delivery,
                str(self.host),
            ],
            env=self.env,
            text=True,
            capture_output=True,
            check=check,
        )

    def calls(self):
        if not self.log.exists():
            return []
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def test_prepare_pulls_exact_digests_without_starting_services(self):
        self.deliver("prepare")
        prepared = self.host / "prepared"
        self.assertTrue(prepared.is_symlink())
        self.assertEqual((prepared / "images.env").read_text(), IMAGES)
        self.assertEqual((prepared / "release.commit").read_text().strip(), COMMIT)
        self.assertEqual(
            (prepared / "compose.production.yaml").stat().st_mode & 0o777, 0o644
        )
        self.assertEqual(
            [call["args"] for call in self.calls()],
            [["pull", line.split("=", 1)[1]] for line in IMAGES.splitlines()],
        )
        self.assertFalse((self.host / "current").exists())
        self.assertFalse((self.host / "auto-deploy-ready").exists())
        self.assertFalse((self.host / "incoming" / "10-1").exists())

    def test_auto_requires_completed_first_installation(self):
        result = self.deliver("auto", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Complete first installation", result.stderr)
        self.assertEqual(self.calls(), [])
        self.assertFalse((self.host / "current").exists())

    def test_invalid_manifest_never_pulls_or_executes_shell(self):
        sentinel = self.root / "executed"
        bad_manifests = (
            IMAGES.replace("@sha256:" + "1" * 64, ":latest"),
            IMAGES + IMAGES.splitlines()[0] + "\n",
            IMAGES.splitlines()[0] + "\n",
            IMAGES + f"$(touch {sentinel})\n",
        )
        for attempt, manifest in enumerate(bad_manifests, 1):
            with self.subTest(manifest=manifest):
                result = self.deliver(
                    "prepare", f"11-{attempt}", images=manifest, check=False
                )
                self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.calls(), [])
        self.assertFalse(sentinel.exists())
        self.assertFalse((self.host / "prepared").exists())

    def test_auto_records_source_and_rolls_back_using_previous_compose(self):
        (self.host / "auto-deploy-ready").touch()
        self.deliver("auto")
        old_release = (self.host / "current").resolve()
        state = self.host / "release-state"
        self.assertEqual(
            (state / "current.source").read_text().strip(), str(old_release)
        )
        self.assertEqual((self.host / "images.env").read_text(), IMAGES)

        new_release = self.host / "releases" / f"{COMMIT}-10-2"
        self.env["DOCKER_TEST_FAIL_COMPOSE"] = str(
            new_release / "compose.production.yaml"
        )
        result = self.deliver("auto", "10-2", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Restoring previous application images", result.stderr)
        self.assertEqual((self.host / "current").resolve(), old_release)
        self.assertEqual(
            (state / "current.source").read_text().strip(), str(old_release)
        )
        rollback = self.calls()[-1]["args"]
        self.assertEqual(
            rollback[rollback.index("-f") + 1],
            str(old_release / "compose.production.yaml"),
        )
        self.assertIn(str(state / "current.env"), rollback)
        self.assertTrue(
            any(call["args"][-2:] == ["backup", "once"] for call in self.calls())
        )

    def test_successful_update_keeps_previous_source_and_manifest(self):
        (self.host / "auto-deploy-ready").touch()
        self.deliver("auto")
        old_release = (self.host / "current").resolve()
        updated = IMAGES.replace("1" * 64, "4" * 64)
        self.deliver("auto", "10-2", images=updated)
        state = self.host / "release-state"
        self.assertEqual((state / "previous.env").read_text(), IMAGES)
        self.assertEqual(
            (state / "previous.source").read_text().strip(), str(old_release)
        )
        self.assertEqual((state / "current.env").read_text(), updated)
        self.assertEqual((self.host / "images.env").read_text(), updated)
        self.assertNotEqual((self.host / "current").resolve(), old_release)

    def install(self, *, terminal=False):
        command = [
            "bash", str(self.source / "scripts/first-install.sh"),
            str(self.config), str(self.images),
        ]
        if not terminal:
            return subprocess.run(command, env=self.env, capture_output=True, text=True)
        master, slave = pty.openpty()
        try:
            return subprocess.run(command, env=self.env, stdin=slave, stdout=slave,
                                  stderr=subprocess.PIPE, timeout=60)
        finally:
            os.close(master)
            os.close(slave)

    def test_first_install_resumes_without_recreating_owner_or_repository(self):
        # Interruption before owner interaction leaves a migrated DB/repository.
        failed = self.install()
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("interactive SSH terminal", failed.stderr)
        self.assertTrue((self.host / "restic-initialized").exists())
        self.assertFalse((self.host / "release-state/current.env").exists())
        completed = self.install(terminal=True)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        repeated = self.install()
        self.assertEqual(repeated.returncode, 0, repeated.stderr)
        calls = [call["args"] for call in self.calls()]
        self.assertEqual(sum(a[-2:] == ["backup", "init"] for a in calls), 1)
        self.assertEqual(sum(a[-2:] == ["owner-tools", "bootstrap-owner"] for a in calls), 1)
        self.assertTrue((self.host / "current").is_symlink())
        self.assertFalse((self.host / "auto-deploy-ready").exists())

    def test_repository_auth_failure_does_not_initialize_or_start_database(self):
        self.env["DOCKER_TEST_RESTIC_CODE"] = "12"
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("initialization was not attempted", result.stderr)
        calls = [call["args"] for call in self.calls()]
        self.assertFalse(any("up" in a or a[-2:] == ["backup", "init"] for a in calls))

    def test_preflight_failure_never_changes_services(self):
        for variable, value in (("DOCKER_TEST_ARCH", "aarch64"), ("DOCKER_TEST_PULL_CODE", "1")):
            with self.subTest(variable=variable):
                self.env[variable] = value
                result = self.install()
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any("up" in c["args"] or "run" in c["args"] for c in self.calls()))
                del self.env[variable]

    def test_missing_secrets_and_changed_image_override_fail_before_pull(self):
        password = self.secrets / "postgres_password"
        original = password.read_bytes()
        password.unlink()
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("postgres_password", result.stderr)
        self.assertFalse(any("pull" in c["args"] for c in self.calls()))
        password.write_bytes(original)
        password.chmod(0o444)
        model = json.loads(self.model.read_text())
        model["services"]["api"]["image"] = "ghcr.io/example/unverified:latest"
        self.model.write_text(json.dumps(model))
        self.env["DOCKER_TEST_OVERRIDE_IMAGE"] = "1"
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("overrides the verified", result.stderr)
        self.assertFalse(any("pull" in c["args"] for c in self.calls()))

    def test_origin_failure_rolls_back_and_preserves_current_release(self):
        (self.host / "auto-deploy-ready").touch()
        self.deliver("auto")
        previous = (self.host / "current").resolve()
        self.env["CURL_TEST_FAIL_ORIGIN"] = "1"
        result = self.deliver("auto", "10-2", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Restoring previous application images", result.stderr)
        self.assertEqual((self.host / "current").resolve(), previous)

    def test_public_failure_records_running_release_but_reports_failure(self):
        (self.host / "auto-deploy-ready").touch()
        self.env["CURL_TEST_FAIL_PUBLIC"] = "1"
        result = self.deliver("auto", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Origin is healthy", result.stderr)
        self.assertNotIn("Restoring previous", result.stderr)
        self.assertEqual(
            (self.host / "release-state/current.source").read_text().strip(),
            str((self.host / "current").resolve()),
        )
        probes = [json.loads(line) for line in (self.root / "curl.jsonl").read_text().splitlines()]
        for probe in probes:
            if "--insecure" in probe:
                self.assertIn("--pinnedpubkey", probe)
                self.assertIn("--resolve", probe)

    def test_ssh_transport_pins_host_and_transfers_only_committed_source(self):
        for name in ("deploy-over-ssh.sh", "deploy-received.sh"):
            shutil.copy2(REPO / "scripts" / name, self.source / "scripts" / name)
        subprocess.run(["git", "init", "-q", str(self.source)], check=True)
        subprocess.run(["git", "-C", str(self.source), "add", "."], check=True)
        subprocess.run(
            [
                "git", "-C", str(self.source),
                "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                "commit", "-qm", "Test source",
            ],
            check=True,
        )
        commit = subprocess.check_output(
            ["git", "-C", str(self.source), "rev-parse", "HEAD"], text=True
        ).strip()
        (self.source / ".env").write_text("UNTRACKED_SECRET=must-not-transfer\n")
        artifact = self.root / "images.env"
        artifact.write_text(IMAGES)
        key = self.root / "test-key"
        subprocess.run(
            ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(key)],
            check=True,
        )
        transport_log = self.root / "transport.jsonl"
        captured = self.root / "captured"
        captured.mkdir()
        for tool in ("ssh", "scp"):
            stub = self.bin / tool
            stub.write_text(
                """#!/usr/bin/env python3
import json, os, shutil, sys
from pathlib import Path
with open(os.environ["TRANSPORT_TEST_LOG"], "a") as log:
    log.write(json.dumps(sys.argv) + "\\n")
if Path(sys.argv[0]).name == "scp":
    for path in sys.argv[-3:-1]:
        shutil.copy2(path, Path(os.environ["TRANSPORT_CAPTURE"]) / Path(path).name)
"""
            )
            stub.chmod(0o755)
        env = {
            **self.env,
            "TRANSPORT_TEST_LOG": str(transport_log),
            "TRANSPORT_CAPTURE": str(captured),
            "GITHUB_RUN_ID": "42",
            "GITHUB_RUN_ATTEMPT": "2",
            "DEPLOY_MODE": "prepare",
            "DEPLOY_HOST": "vps.example.invalid",
            "DEPLOY_PORT": "2222",
            "DEPLOY_USER": "daedalus",
            "DEPLOY_SSH_KEY": key.read_text(),
            "DEPLOY_KNOWN_HOSTS": (
                "[vps.example.invalid]:2222 " + key.with_suffix(".pub").read_text()
            ),
        }
        command = [
            "bash", str(self.source / "scripts" / "deploy-over-ssh.sh"),
            commit, str(artifact),
        ]
        subprocess.run(command, env=env, capture_output=True, check=True)
        calls = [json.loads(line) for line in transport_log.read_text().splitlines()]
        self.assertEqual(len(calls), 3)
        for call in calls:
            self.assertIn("StrictHostKeyChecking=yes", call)
            self.assertIn("BatchMode=yes", call)
            self.assertIn("2222", call)
            self.assertFalse(Path(call[call.index("-i") + 1]).exists())
        self.assertEqual((captured / "images.env").read_text(), IMAGES)
        with tarfile.open(captured / "source.tar.gz") as archive:
            names = archive.getnames()
        self.assertIn("scripts/deploy.sh", names)
        self.assertNotIn(".env", names)
        self.assertNotIn(".git", names)
        for name, value in (
            ("DEPLOY_PORT", "22; echo injected"),
            ("DEPLOY_HOST", "host; echo injected"),
        ):
            with self.subTest(name=name):
                result = subprocess.run(
                    command, env={**env, name: value}, capture_output=True
                )
                self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(transport_log.read_text().splitlines()), 3)


if __name__ == "__main__":
    unittest.main()
