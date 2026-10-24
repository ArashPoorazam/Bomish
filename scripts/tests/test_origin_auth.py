"""Use real certificates to test origin-client trust and key isolation."""

import importlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from origin_auth import validate_ca, validate_origin_auth  # noqa: E402

setup = importlib.import_module("init-origin-auth")
site = importlib.import_module("verify-site")


class OriginAuthTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "tls").mkdir(mode=0o700)
        self.ca = self.root / "edge-ca.pem"
        self.ca_key = self.root / "edge-ca.key"
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256",
            "-nodes", "-days", "30", "-subj", "/CN=Test edge CA",
            "-addext", "basicConstraints=critical,CA:TRUE",
            "-keyout", str(self.ca_key), "-out", str(self.ca),
        ], check=True, capture_output=True)
        self.model = {"services": {"traefik": {
            "environment": {"ORIGIN_AUTH_MODE": "required"},
            "volumes": [{"source": str(self.root / "tls"), "target": "/certs"}],
        }}}

    def test_provision_validate_and_no_overwrite(self):
        setup.provision(self.root, self.ca)
        options = validate_origin_auth(self.model)
        key = self.root / "origin-probe/client.key"
        before = key.read_bytes()
        self.assertEqual(options, ["--cert", str(key.with_suffix(".crt")), "--key", str(key)])
        self.assertEqual(key.stat().st_mode & 0o777, 0o600)
        self.assertEqual(key.parent.stat().st_mode & 0o777, 0o700)
        self.assertFalse(list((self.root / "tls").glob("*.key")))
        self.assertFalse(list(self.root.glob(".origin-auth-*")))
        with self.assertRaisesRegex(ValueError, "already exist"):
            setup.provision(self.root, self.ca)
        self.assertEqual(before, key.read_bytes())

    def test_off_needs_no_credentials_and_unknown_mode_is_rejected(self):
        environment = self.model["services"]["traefik"]["environment"]
        environment["ORIGIN_AUTH_MODE"] = "off"
        self.assertEqual(validate_origin_auth(self.model), [])
        environment["ORIGIN_AUTH_MODE"] = "typo"
        with self.assertRaisesRegex(ValueError, "must be"):
            validate_origin_auth(self.model)

    def test_missing_credentials_and_wrong_key_fail(self):
        with self.assertRaisesRegex(ValueError, "Missing"):
            validate_origin_auth(self.model)
        setup.provision(self.root, self.ca)
        (self.root / "origin-probe/client.key").write_bytes(self.ca_key.read_bytes())
        with self.assertRaisesRegex(ValueError, "do not match"):
            validate_origin_auth(self.model)

    def test_untrusted_client_and_non_ca_fail(self):
        setup.provision(self.root, self.ca)
        local_ca = self.root / "tls/local-probe-ca.pem"
        local_ca.write_bytes(self.ca.read_bytes())
        with self.assertRaisesRegex(ValueError, "trust/purpose"):
            validate_origin_auth(self.model)
        with self.assertRaisesRegex(ValueError, "must be a CA"):
            validate_ca(self.root / "origin-probe/client.crt")

    def test_exposed_private_key_fails(self):
        setup.provision(self.root, self.ca)
        key = self.root / "origin-probe/client.key"
        key.chmod(0o644)
        with self.assertRaisesRegex(ValueError, "private key"):
            validate_origin_auth(self.model)
        key.chmod(0o600)
        key.parent.chmod(0o755)
        with self.assertRaisesRegex(ValueError, "directory must be private"):
            validate_origin_auth(self.model)

    def test_negative_probe_requires_tls_alert_not_a_network_outage(self):
        for code, error, accepted in (
            (56, b"tlsv13 alert certificate required", True),
            (35, b"sslv3 alert handshake failure", True),
            (0, b"", False), (28, b"Connection timed out", False),
            (7, b"Connection refused", False), (90, b"Public key mismatch", False),
            (56, b"Connection reset by peer", False),
        ):
            with self.subTest(code=code, error=error):
                result = subprocess.CompletedProcess([], code, b"", error)
                with patch.object(site.subprocess, "run", return_value=result):
                    if accepted:
                        site.verify_client_required("bomish.test", [])
                    else:
                        with self.assertRaisesRegex(ValueError, "demonstrably reject"):
                            site.verify_client_required("bomish.test", [])


if __name__ == "__main__":
    unittest.main()
