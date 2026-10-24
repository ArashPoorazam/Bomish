"""Origin client-certificate validation; private probe keys never enter containers."""

import ssl
import time

from production import run, tls_directory


def origin_auth_mode(model):
    mode = model["services"]["traefik"].get("environment", {}).get("ORIGIN_AUTH_MODE", "off")
    if mode not in ("off", "verify", "required"):
        raise ValueError("ORIGIN_AUTH_MODE must be off, verify or required")
    return mode


def validate_certificate(path):
    if not path.is_file() or not path.stat().st_size:
        raise ValueError(f"Missing origin authentication certificate: {path.name}")
    run(["openssl", "x509", "-in", str(path), "-noout", "-checkend", "604800"],
        label=f"{path.name} expiry validation (at least seven days required)")
    start = run(["openssl", "x509", "-in", str(path), "-noout", "-startdate"],
                label="Client certificate start date").decode().strip()
    if ssl.cert_time_to_seconds(start.split("=", 1)[1]) > time.time():
        raise ValueError("Origin authentication certificate is not valid yet")


def validate_ca(path):
    validate_certificate(path)
    constraints = run(["openssl", "x509", "-in", str(path), "-noout", "-ext", "basicConstraints"],
                      label="Client CA constraints").decode()
    if "CA:TRUE" not in constraints:
        raise ValueError(f"Origin authentication trust file must be a CA: {path.name}")


def validate_origin_auth(model):
    """Return local probe credentials only after validating the complete trust chain."""
    if origin_auth_mode(model) == "off":
        return []
    directory = tls_directory(model)
    cloudflare_ca = directory / "cloudflare-origin-pull-ca.pem"
    local_ca = directory / "local-probe-ca.pem"
    probe = directory.parent / "origin-probe"
    cert, key = probe / "client.crt", probe / "client.key"
    for path in (cloudflare_ca, local_ca):
        validate_ca(path)
    if not probe.is_dir() or probe.stat().st_mode & 0o077:
        raise ValueError("origin-probe directory must be private (chmod 0700)")
    if not key.is_file() or key.stat().st_mode & 0o077:
        raise ValueError("Origin probe private key must exist and be private (chmod 0600)")
    # Prevent an override from exposing the probe key through the mounted TLS tree.
    if key.resolve().is_relative_to(directory.resolve()):
        raise ValueError("Origin probe private key must remain outside the mounted TLS directory")
    validate_certificate(cert)
    run(["openssl", "verify", "-purpose", "sslclient", "-CAfile", str(local_ca), str(cert)],
        label="Origin probe client certificate trust/purpose validation")
    public = run(["openssl", "x509", "-in", str(cert), "-pubkey", "-noout"],
                 label="Origin probe public key")
    der = run(["openssl", "pkey", "-pubin", "-outform", "DER"], data=public,
              label="Origin probe certificate key decoding")
    private_public = run(["openssl", "pkey", "-in", str(key), "-passin", "pass:",
                          "-pubout", "-outform", "DER"], label="Origin probe private key")
    if der != private_public:
        raise ValueError("Origin probe certificate and private key do not match")
    return ["--cert", str(cert), "--key", str(key)]
