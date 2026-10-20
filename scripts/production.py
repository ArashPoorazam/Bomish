"""Shared production configuration and certificate checks (standard library only)."""

import base64
import hashlib
import json
import re
import shutil
import ssl
import subprocess
import time
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


def require_tools(*names):
    missing = [name for name in names if not shutil.which(name)]
    if missing:
        raise ValueError("Install required tools: " + ", ".join(missing))


def run(args, *, data=None, label="Command", timeout=60):
    # Never include command arguments/output in errors: they may contain credentials.
    result = subprocess.run(
        args, input=data, capture_output=True, timeout=timeout, check=False
    )
    if result.returncode:
        raise ValueError(f"{label} failed (exit {result.returncode})")
    return result.stdout


def compose_command(config, images):
    return [
        "docker", "compose", "--env-file", str(Path(config).resolve(strict=True)),
        "--env-file", str(Path(images).resolve(strict=True)),
        "-f", str(ROOT / "compose.production.yaml"),
    ]


def load_model(config, images):
    run(
        ["python3", str(ROOT / "scripts/validate-release.py"), str(images)],
        label="Immutable image manifest validation",
    )
    return json.loads(run(
        compose_command(config, images) + ["--profile", "tools", "config", "--format", "json"],
        label="Compose configuration validation",
    ))


def site_host(model):
    origin = model["services"]["api"]["environment"]["APP_ORIGIN"]
    url = urlsplit(origin)
    host = url.hostname or ""
    if (
        origin != f"https://{host}" or "." not in host
        or not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", host)
    ):
        raise ValueError("SITE_HOST must be a DNS hostname, without a scheme or path")
    return host


def tls_directory(model):
    mounts = model["services"]["traefik"]["volumes"]
    return Path(next(v["source"] for v in mounts if v["target"] == "/certs"))


def certificate_pin(directory, host):
    """Validate the configured certificate, then pin its key for the origin probe.

    Cloudflare Origin CA certificates aren't in the system public CA bundle.
    Identity comes from the operator-installed certificate, not an insecure fetch.
    """
    cert, key = directory / "origin.crt", directory / "origin.key"
    for path in (cert, key):
        if not path.is_file() or not path.stat().st_size:
            raise ValueError(f"Missing TLS file: {path}")
    hostname_check = run(
        ["openssl", "x509", "-in", str(cert), "-noout", "-checkhost", host],
        label="Certificate hostname validation",
    )
    # OpenSSL 3.0 exits 0 even on a hostname mismatch. Require its affirmative
    # result for this exact host as well as a successful exit, on all versions.
    if hostname_check.strip() != f"Hostname {host} does match certificate".encode():
        raise ValueError("Certificate hostname validation failed")
    run(["openssl", "x509", "-in", str(cert), "-noout", "-checkend", "604800"],
        label="Certificate expiry validation (at least seven days required)")
    dates = run(["openssl", "x509", "-in", str(cert), "-noout", "-startdate"],
                label="Certificate start date").decode().strip()
    if ssl.cert_time_to_seconds(dates.split("=", 1)[1]) > time.time():
        raise ValueError("Certificate is not valid yet; check the host clock")
    public = run(["openssl", "x509", "-in", str(cert), "-pubkey", "-noout"],
                 label="Certificate public key")
    der = run(["openssl", "pkey", "-pubin", "-outform", "DER"], data=public,
              label="Certificate key decoding")
    private_public = run(
        ["openssl", "pkey", "-in", str(key), "-passin", "pass:", "-pubout", "-outform", "DER"],
        label="TLS private key validation (unencrypted key required)",
    )
    if der != private_public:
        raise ValueError("TLS certificate and private key do not match")
    return "sha256//" + base64.b64encode(hashlib.sha256(der).digest()).decode()
