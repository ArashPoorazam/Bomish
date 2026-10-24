#!/usr/bin/env python3
"""Validate deployment inputs and pull images before changing running services."""

import argparse
import configparser
import ipaddress
import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

from production import (
    ROOT, certificate_pin, compose_command, load_model, require_tools, run,
    site_host, tls_directory,
)
from origin_auth import validate_origin_auth


def validate_configuration(model, images):
    host = site_host(model)
    services = model["services"]
    manifest = dict(line.split("=", 1) for line in Path(images).read_text().splitlines())
    for service, name in (("api", "API"), ("web", "WEB"), ("backup", "BACKUP")):
        if services[service]["image"] != manifest[f"{name}_IMAGE"]:
            raise ValueError(f"Environment overrides the verified {service} image")
    if services["api"]["environment"]["STORE_MODE"] != "catalog":
        raise ValueError("Production installation requires catalog mode")
    repository = services["backup"]["environment"]["RESTIC_REPOSITORY"]
    if not repository.startswith("s3:https://") or "YOUR-" in repository:
        raise ValueError("Configure RESTIC_REPOSITORY with an off-server HTTPS S3 bucket")
    endpoint = urlsplit(repository[3:])
    if not endpoint.hostname or endpoint.hostname in ("localhost", "127.0.0.1", "::1") or not endpoint.path.strip("/"):
        raise ValueError("RESTIC_REPOSITORY requires an off-server endpoint and bucket")
    trusted = services["api"]["environment"]["TRUSTED_PROXY_CIDRS"]
    cloudflare = next(
        item.split("=", 1)[1] for item in services["traefik"]["command"]
        if item.startswith("--entrypoints.websecure.forwardedheaders.trustedips=")
    )
    def networks(value):
        result = {ipaddress.ip_network(item.strip()) for item in value.split(",")}
        if any(net.prefixlen == 0 for net in result):
            raise ValueError("Proxy CIDRs must not trust the entire Internet")
        return result
    cf_networks, trusted_networks = networks(cloudflare), networks(trusted)
    edge = {
        ipaddress.ip_network(item["subnet"])
        for item in model["networks"]["edge"]["ipam"]["config"]
    }
    if trusted_networks != cf_networks | edge:
        raise ValueError("TRUSTED_PROXY_CIDRS must contain the edge subnet and Cloudflare CIDRs")
    if services["web"]["environment"]["SITE_URL"] != f"https://{host}":
        raise ValueError("Frontend SITE_URL must match the API origin")


def validate_secrets(model):
    values = {}
    for name, spec in model["secrets"].items():
        path = Path(spec["file"])
        if path.resolve().is_relative_to(ROOT):
            raise ValueError("Keep production secrets outside the source directory")
        if not path.is_file() or not path.stat().st_size:
            raise ValueError(f"Missing or empty secret: {name}")
        # Compose bind-mounts files without remapping ownership for nonroot users.
        if not path.stat().st_mode & 0o004:
            raise ValueError(f"Secret {name} must be container-readable (chmod 0444 inside a private directory)")
        if path.parent.stat().st_mode & 0o077:
            raise ValueError(f"Secret directory must be private (chmod 0700): {path.parent}")
        values[name] = path.read_text().strip()
        if not values[name] or "REPLACE_ME" in values[name]:
            raise ValueError(f"Configure secret: {name}")
    if not re.fullmatch(r"[a-fA-F0-9]{64}", values["totp_key"]):
        raise ValueError("totp_key must contain 32 bytes encoded as hexadecimal")
    for role, user in (("app", "bomish_app"), ("migration", "bomish_migrator")):
        url = urlsplit(values[f"{role}_database_url"])
        if (
            url.scheme != "postgres" or url.hostname != "db" or url.port != 5432
            or url.path != "/bomish" or url.username != user
            or unquote(url.password or "") != values[f"{role}_db_password"]
        ):
            raise ValueError(f"{role}_database_url must match its database role and password")
    credentials = configparser.ConfigParser(interpolation=None)
    credentials.read_string(values["backup_credentials"])
    for name in ("aws_access_key_id", "aws_secret_access_key"):
        if not credentials.get("default", name, fallback="").strip():
            raise ValueError(f"backup_credentials requires {name} in [default]")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config")
    parser.add_argument("images")
    parser.add_argument("--first-install", action="store_true",
                        help="Also pull database and Traefik images")
    args = parser.parse_args()
    require_tools("docker", "python3", "openssl", "curl", "flock", "realpath")
    model = load_model(args.config, args.images)
    validate_configuration(model, args.images)
    validate_secrets(model)
    certificate_pin(tls_directory(model), site_host(model))
    validate_origin_auth(model)
    server = json.loads(run(["docker", "info", "--format", "{{json .}}"],
                            label="Docker access (check group membership)"))
    if server["OSType"] != "linux" or server["Architecture"] not in ("x86_64", "amd64"):
        raise ValueError("Published images currently require a Linux amd64 Docker server")
    print("Configuration, secrets, certificate and Docker platform passed.", flush=True)
    command = compose_command(args.config, args.images)
    services = ["api", "web", "backup"]
    if args.first_install:
        services += ["db", "traefik"]
    # Pulling proves registry authentication, manifest and blob access. It does
    # not start/recreate containers or touch application/database volumes.
    subprocess.run(command + ["pull", *services], check=True)
    for name in ("api", "web", "backup", "db", "traefik"):
        image = model["services"][name]["image"]
        platform = run(
            ["docker", "image", "inspect", image, "--format", "{{.Os}}/{{.Architecture}}"],
            label=f"{name} image inspection (prepare infrastructure images on first install)",
        ).decode().strip()
        if platform != "linux/amd64":
            raise ValueError(f"{name} image must support linux/amd64")
    print("Preflight passed; required images are available. No services were changed.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.SubprocessError, configparser.Error):
        # Validation errors are curated; subprocess/JSON/config errors can include secrets.
        error = sys.exc_info()[1]
        message = str(error) if type(error) is ValueError else "Unable to validate deployment inputs or pull images"
        sys.exit(f"Preflight failed: {message}")
