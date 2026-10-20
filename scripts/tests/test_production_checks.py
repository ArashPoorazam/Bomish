"""Real TLS fixtures and simulated HTTP failures for production validation."""

import copy
import importlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from production import certificate_pin  # noqa: E402

site = importlib.import_module("verify-site")


class CertificateTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def certificate(self, name="origin", days="30", host="bomish.test"):
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256",
            "-nodes", "-days", days, "-subj", f"/CN={host}",
            "-addext", f"subjectAltName=DNS:{host}",
            "-keyout", str(self.root / f"{name}.key"), "-out", str(self.root / f"{name}.crt"),
        ], check=True, capture_output=True)

    def test_valid_certificate_and_wrong_hostname(self):
        self.certificate()
        self.assertTrue(certificate_pin(self.root, "bomish.test").startswith("sha256//"))
        with self.assertRaisesRegex(ValueError, "hostname"):
            certificate_pin(self.root, "other.test")

    def test_legacy_openssl_zero_exit_on_hostname_mismatch(self):
        self.certificate()
        real_run = subprocess.run

        def legacy_run(command, **kwargs):
            result = real_run(command, **kwargs)
            if "-checkhost" in command:
                # OpenSSL 3.0 reports mismatches in stdout but still exits 0.
                self.assertIn(b"does NOT match certificate", result.stdout)
                result.returncode = 0
            return result

        with patch("production.subprocess.run", side_effect=legacy_run):
            with self.assertRaisesRegex(ValueError, "hostname"):
                certificate_pin(self.root, "other.test")

    def test_hostname_check_requires_explicit_confirmation(self):
        self.certificate()
        for output in (b"", b"unexpected output\n", b"Hostname other.test does match certificate\n"):
            with self.subTest(output=output):
                with patch("production.subprocess.run", return_value=subprocess.CompletedProcess(
                    ["openssl"], 0, output, b""
                )):
                    with self.assertRaisesRegex(ValueError, "hostname"):
                        certificate_pin(self.root, "bomish.test")

    def test_wildcard_certificate_matches_only_one_subdomain_level(self):
        self.certificate(host="*.bomish.test")
        self.assertTrue(certificate_pin(self.root, "www.bomish.test").startswith("sha256//"))
        for host in ("bomish.test", "nested.www.bomish.test"):
            with self.subTest(host=host):
                with self.assertRaisesRegex(ValueError, "hostname"):
                    certificate_pin(self.root, host)

    def test_expiring_certificate_and_mismatched_private_key(self):
        self.certificate(days="1")
        with self.assertRaisesRegex(ValueError, "expiry"):
            certificate_pin(self.root, "bomish.test")
        self.certificate()
        self.certificate("other")
        (self.root / "origin.key").write_bytes((self.root / "other.key").read_bytes())
        with self.assertRaisesRegex(ValueError, "do not match"):
            certificate_pin(self.root, "bomish.test")


class WebsiteTest(unittest.TestCase):
    def setUp(self):
        self.responses = [
            (301, {"location": "https://bomish.test/api/v1/health?deployment_probe=1"}, ""),
            (200, {"content-type": "text/html", "cf-ray": "test"}, "<html>Bomish</html>"),
            (200, {"cf-ray": "test"}, '{"status":"ok"}'),
            (200, {"cf-ray": "test"}, '{"catalogOnly":true}'),
        ]

    def verify(self, responses):
        with patch.object(site, "fetch", side_effect=responses):
            site.verify("bomish.test", [], cloudflare=True)

    def test_valid_site(self):
        self.verify(self.responses)

    def test_redirect_error_page_unhealthy_api_and_wrong_catalog_mode(self):
        replacements = [
            (0, (200, {}, "")),
            (0, (301, {"location": "https://attacker.test/"}, "")),
            (1, (200, {"content-type": "text/html", "cf-ray": "test"}, "not html")),
            (1, (503, {}, "<html>error</html>")),
            (1, (200, {"content-type": "text/html"}, "<html>direct origin</html>")),
            (2, (200, {"cf-ray": "test"}, '{"status":"failed"}')),
            (2, (200, {"cf-ray": "test"}, "not JSON")),
            (3, (200, {"cf-ray": "test"}, '{"catalogOnly":false}')),
            (3, (200, {"cf-ray": "test"}, '{"catalogOnly":1}')),
        ]
        for index, response in replacements:
            with self.subTest(response=response):
                responses = copy.deepcopy(self.responses)
                responses[index] = response
                with self.assertRaises(ValueError):
                    self.verify(responses)

    def test_public_probe_uses_certificate_verification_and_no_redirect_following(self):
        def curl(command, **kwargs):
            self.assertNotIn("--insecure", command)
            self.assertNotIn("--location", command)
            Path(command[command.index("--dump-header") + 1]).write_text(
                "HTTP/1.1 200 OK\nContent-Type: application/json\n"
            )
            Path(command[command.index("--output") + 1]).write_text('{"status":"ok"}')
            return subprocess.CompletedProcess(command, 0, "200", "")
        with patch.object(site.subprocess, "run", side_effect=curl):
            status, headers, body = site.fetch("https://bomish.test/api/v1/health", [])
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["status"], "ok")


if __name__ == "__main__":
    unittest.main()
