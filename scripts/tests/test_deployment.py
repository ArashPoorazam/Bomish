"""Exercise release delivery with real files and a fake Docker executable."""

import json
import os
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
        for name in ("deploy.sh", "validate-release.py"):
            shutil.copy2(REPO / "scripts" / name, self.source / "scripts" / name)
        (self.source / "compose.production.yaml").write_text("services: {}\n")
        self.host = self.root / "host"
        self.host.mkdir()
        (self.host / "deployment.env").write_text("COMPOSE_PROJECT_NAME=test\n")
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
"""
        )
        docker.chmod(0o755)
        self.log = self.root / "docker.jsonl"
        self.env = {
            **os.environ,
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "DOCKER_TEST_LOG": str(self.log),
        }

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
