"""Exercise copy promotion/failure isolation without a production connection."""

import importlib.util
import io
import json
import os
from pathlib import Path
import shlex
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch


REPO = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("dev_database", REPO / "scripts/dev-database.py")
dev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dev)


class LocalCopyTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = self.root / ".data"
        self.data.mkdir()
        migrations = self.root / "backend/migrations"
        migrations.mkdir(parents=True)
        (migrations / "001_initial.sql").touch()
        self.current = self.data / "production-current.json"
        self.old_name = "bomish_dev_" + "a" * 32
        self.old_uploads = self.data / "production-copies" / self.old_name / "uploads"
        self.old_uploads.mkdir(parents=True)
        (self.old_uploads / "original.jpg").write_bytes(b"old image")
        self.old = {"database": self.old_name, "uploads": str(self.old_uploads)}
        self.current.write_text(json.dumps(self.old))
        self.calls = []
        self.failure = None
        self.version = "001"
        self.cluster = self.data / "postgres"
        for name, value in (("ROOT", self.root), ("DATA", self.data), ("CURRENT", self.current)):
            self.enterContext(patch.object(dev, name, value))
        self.enterContext(patch.dict(os.environ, {"BOMISH_PRODUCTION_SSH": "user@production.test",
                                                "BOMISH_PRODUCTION_PORT": "2222"}))
        self.enterContext(patch.object(dev.shutil, "which", return_value="/usr/bin/test"))
        self.enterContext(patch.object(dev.subprocess, "run", side_effect=self.command))

    def command(self, args, **kwargs):
        self.calls.append(args)
        tool = Path(args[0]).name
        stdout = ""
        stage = tool
        if tool == "ssh":
            remote = shlex.split(args[-1])
            self.assertEqual(remote[0], "docker")
            if remote[1] == "ps":
                stdout = "b" * 12 + "\n"
            else:
                self.assertEqual(remote[1], "exec")
                stage = remote[3]
                self.assertIn(stage, ("pg_dump", "tar"))
                if stage == "pg_dump" and self.failure != stage:
                    kwargs["stdout"].write(b"example dump")
                if stage == "tar" and self.failure != stage:
                    with tarfile.open(fileobj=kwargs["stdout"], mode="w") as archive:
                        member = tarfile.TarInfo("image.jpg")
                        member.size = 5
                        archive.addfile(member, io.BytesIO(b"image"))
        elif tool == "psql":
            sql = args[-1]
            if sql == "SHOW data_directory":
                stdout = str(self.cluster)
            elif "schema_migrations" in sql:
                stdout = self.version
            else:
                stdout = "3\n3"
        elif tool == "bomish-api":
            self.assertEqual(args[1], "prepare-local-copy")
            self.assertIn("@127.0.0.1:55432/bomish_dev_", kwargs["env"]["DATABASE_URL"])
        if self.failure == stage:
            raise subprocess.CalledProcessError(1, args)
        return subprocess.CompletedProcess(args, 0, stdout=stdout, stderr="")

    def test_success_promotes_database_and_uploads_together(self):
        result = dev.refresh()
        self.assertEqual(json.loads(self.current.read_text()), result)
        self.assertNotEqual(result["database"], self.old_name)
        self.assertEqual((Path(result["uploads"]) / "image.jpg").read_bytes(), b"image")
        self.assertFalse(list(self.data.rglob("*.dump")))
        self.assertFalse(list(self.data.rglob("*.tar")))
        self.assertEqual((self.old_uploads / "original.jpg").read_bytes(), b"old image")
        self.assertFalse(any(Path(c[0]).name == "dropdb" for c in self.calls))

    def test_failed_stages_preserve_current_and_remove_partial_copy(self):
        for stage in ("pg_dump", "tar", "pg_restore", "bomish-api"):
            with self.subTest(stage=stage):
                self.failure = stage
                self.calls.clear()
                with self.assertRaises(subprocess.CalledProcessError):
                    dev.refresh()
                self.assertEqual(dev.current(), self.old)
                self.assertEqual(list((self.data / "production-copies").iterdir()), [self.old_uploads.parent])
                for args in self.calls:
                    if Path(args[0]).name == "dropdb":
                        self.assertNotEqual(args[-1], self.old_name)

    def test_newer_schema_does_not_promote(self):
        self.version = "001\n999"
        with self.assertRaisesRegex(ValueError, "newer migrations"):
            dev.refresh()
        self.assertEqual(dev.current(), self.old)
        self.assertFalse(any(Path(c[0]).name == "bomish-api" for c in self.calls))

    def test_wrong_local_cluster_is_rejected_before_ssh(self):
        self.cluster = Path("/another/postgres")
        with self.assertRaisesRegex(ValueError, "not this checkout"):
            dev.refresh()
        self.assertFalse(any(c[0] == "ssh" for c in self.calls))

    def test_offline_reads_selection_without_commands(self):
        self.assertEqual(dev.current(), self.old)
        self.current.unlink()
        self.assertEqual(dev.current()["database"], "bomish")
        self.assertEqual(self.calls, [])

    def test_invalid_saved_selection_is_rejected(self):
        self.current.write_text(json.dumps({**self.old, "database": "postgres"}))
        with self.assertRaises(ValueError):
            dev.current()

    def test_archive_rejects_traversal_and_links(self):
        for name, kind in (("../escape", tarfile.REGTYPE), ("link", tarfile.SYMTYPE)):
            with self.subTest(name=name):
                archive = self.root / "unsafe.tar"
                with tarfile.open(archive, "w") as output:
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    member.linkname = "/etc/passwd" if kind == tarfile.SYMTYPE else ""
                    output.addfile(member)
                with self.assertRaisesRegex(ValueError, "Unsafe member"):
                    dev.extract_uploads(archive, self.old_uploads)

    def test_ssh_validates_target_and_enforces_known_host(self):
        command = dev.ssh_command()
        self.assertIn("StrictHostKeyChecking=yes", command)
        self.assertIn("BatchMode=yes", command)
        self.assertIn("-T", command)
        for target in ("-oProxyCommand=bad", "user@host; echo bad"):
            with patch.dict(os.environ, {"BOMISH_PRODUCTION_SSH": target}):
                with self.assertRaises(ValueError):
                    dev.ssh_command()


if __name__ == "__main__":
    unittest.main()
