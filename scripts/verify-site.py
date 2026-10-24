#!/usr/bin/env python3
"""Verify HTTP redirection, HTTPS homepage, API health and catalog mode."""

import argparse
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlsplit

from production import certificate_pin, load_model, require_tools, site_host, tls_directory
from origin_auth import origin_auth_mode, validate_origin_auth


def fetch(url, options):
    with tempfile.TemporaryDirectory(prefix="bomish-probe-") as directory:
        headers = Path(directory) / "headers"
        body = Path(directory) / "body"
        result = subprocess.run(
            ["curl", "--silent", "--show-error", "--noproxy", "*",
             "--connect-timeout", "10", "--max-time", "30", "--max-filesize", "5242880",
             "--dump-header", str(headers), "--output", str(body),
             "--write-out", "%{http_code}", *options, url],
            capture_output=True, text=True, check=False,
        )
        if result.returncode:
            raise ValueError(f"{url}: connection/TLS failed (curl exit {result.returncode})")
        fields = {}
        for line in headers.read_text().splitlines():
            if line.startswith("HTTP/"):
                fields = {}
            elif ":" in line:
                name, value = line.split(":", 1)
                fields[name.lower()] = value.strip()
        return int(result.stdout), fields, body.read_text(errors="replace")


def verify(host, options, *, cloudflare=False):
    # Preserve the path and query, and never follow a redirect to hide errors.
    path = "/api/v1/health?deployment_probe=1"
    status, headers, _ = fetch(f"http://{host}{path}", options)
    if status not in (301, 302, 307, 308) or headers.get("location") not in (
        f"https://{host}{path}", f"https://{host}:443{path}",
    ):
        raise ValueError("HTTP must redirect to HTTPS on the same host, preserving path and query")
    for path in ("/", "/api/v1/health", "/api/v1/settings"):
        status, headers, body = fetch(f"https://{host}{path}", options)
        if status != 200:
            raise ValueError(f"HTTPS {path} returned {status}, expected 200")
        if cloudflare and not headers.get("cf-ray"):
            raise ValueError("Public HTTPS response did not pass through Cloudflare (missing CF-Ray)")
        if path == "/":
            if "text/html" not in headers.get("content-type", "") or "<html" not in body.lower():
                raise ValueError("Homepage did not return HTML")
        else:
            try:
                value = json.loads(body)
            except ValueError:
                raise ValueError(f"{path} did not return JSON") from None
            valid = False
            if isinstance(value, dict):
                valid = value.get("status") == "ok" if path.endswith("health") else value.get("catalogOnly") is True
            if not valid:
                raise ValueError(f"{path} returned an unexpected application response")


def verify_client_required(host, options):
    """A working authenticated origin must reject a fresh unauthenticated handshake.

    Only TLS peer-rejection errors count: a timeout, DNS or pinning failure is not
    evidence of client authentication. Call this after the positive probe passes.
    """
    result = subprocess.run([
        "curl", "--silent", "--show-error", "--noproxy", "*",
        "--connect-timeout", "5", "--max-time", "10", "--output", "/dev/null",
        *options, f"https://{host}/api/v1/health",
    ], capture_output=True, check=False)
    # curl/OpenSSL versions report TLS alert failures at handshake, send or read.
    if result.returncode not in (35, 55, 56) or b"alert" not in result.stderr.lower():
        raise ValueError("Origin did not demonstrably reject a client without a certificate")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config")
    parser.add_argument("--images")
    parser.add_argument("--public-url", help="Public Cloudflare origin; also usable from Actions")
    parser.add_argument("--origin", action="store_true", help="Probe local Traefik on 127.0.0.1")
    args = parser.parse_args()
    require_tools("curl")
    options = []
    unauthenticated_options = None
    if args.public_url:
        url = urlsplit(args.public_url)
        host = url.hostname
        if not host or args.public_url.rstrip("/") != f"https://{host}" or args.origin:
            parser.error("--public-url must be an HTTPS origin and cannot accompany --origin")
    else:
        if not args.config or not args.images:
            parser.error("Pass --config and --images, or --public-url")
        model = load_model(args.config, args.images)
        host = site_host(model)
        if args.origin:
            require_tools("openssl")
            pin = certificate_pin(tls_directory(model), host)
            # Cloudflare Origin CA is not publicly trusted. The previously
            # validated local certificate's key MUST match the TLS server.
            options = ["--insecure", "--pinnedpubkey", pin,
                       "--resolve", f"{host}:80:127.0.0.1",
                       "--resolve", f"{host}:443:127.0.0.1"]
            if origin_auth_mode(model) == "required":
                unauthenticated_options = options.copy()
            options += validate_origin_auth(model)
    for attempt in range(5):
        try:
            verify(host, options, cloudflare=not args.origin)
            if unauthenticated_options is not None:
                verify_client_required(host, unauthenticated_options)
            print(f"{'Origin Traefik' if args.origin else 'Public Cloudflare'} checks passed: redirect, HTTPS homepage, API and catalog mode.")
            return
        except ValueError:
            if attempt == 4:
                raise
            time.sleep(3)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        sys.exit(f"Website verification failed: {error}")
