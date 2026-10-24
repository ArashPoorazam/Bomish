#!/usr/bin/env python3
"""Provision AOP trust and a local probe identity, without replacing existing files."""

import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from origin_auth import validate_ca, validate_origin_auth
from production import ROOT, require_tools, run


def provision(directory, cloudflare_ca):
    directory = Path(directory)
    if not directory.is_absolute() or directory.resolve().is_relative_to(ROOT):
        raise ValueError("Use an absolute secrets directory outside the source checkout")
    tls = directory / "tls"
    probe = directory / "origin-probe"
    targets = [tls / "cloudflare-origin-pull-ca.pem", tls / "local-probe-ca.pem", probe]
    if any(p.exists() or p.is_symlink() for p in targets):
        raise ValueError("Origin authentication files already exist; refusing to replace credentials")
    if not tls.is_dir() or directory.stat().st_mode & 0o077:
        raise ValueError("Use an existing private secrets directory with a tls subdirectory")
    validate_ca(Path(cloudflare_ca))
    # Generate the local signing key in a private temporary directory; never
    # install it. Only the leaf identity and the two public CAs are retained.
    with tempfile.TemporaryDirectory(prefix=".origin-auth-", dir=directory) as temp:
        work = Path(temp)
        ca_key, ca_cert = work / "ca.key", work / "ca.pem"
        run(["openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256",
             "-nodes", "-days", "730", "-subj", "/CN=Bomish local deployment probe CA",
             "-addext", "basicConstraints=critical,CA:TRUE,pathlen:0",
             "-addext", "keyUsage=critical,keyCertSign,cRLSign",
             "-keyout", str(ca_key), "-out", str(ca_cert)], label="Local probe CA generation")
        key, csr, cert = work / "client.key", work / "client.csr", work / "client.crt"
        run(["openssl", "req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256",
             "-nodes", "-subj", "/CN=Bomish local deployment probe",
             "-keyout", str(key), "-out", str(csr)], label="Local probe key generation")
        extensions = work / "client.ext"
        extensions.write_text("basicConstraints=critical,CA:FALSE\n"
                              "keyUsage=critical,digitalSignature\n"
                              "extendedKeyUsage=clientAuth\n")
        run(["openssl", "x509", "-req", "-in", str(csr), "-CA", str(ca_cert),
             "-CAkey", str(ca_key), "-CAcreateserial", "-days", "365",
             "-extfile", str(extensions), "-out", str(cert)], label="Local probe certificate signing")
        run(["openssl", "verify", "-purpose", "sslclient", "-CAfile", str(ca_cert), str(cert)],
            label="Generated probe verification")
        created = []
        try:
            probe.mkdir(mode=0o700)
            created.append(probe)
            for source, target, mode in (
                (cloudflare_ca, targets[0], 0o644), (ca_cert, targets[1], 0o644),
                (cert, probe / "client.crt", 0o600), (key, probe / "client.key", 0o600),
            ):
                with target.open("xb") as output:
                    created.append(target)
                    output.write(Path(source).read_bytes())
                target.chmod(mode)
            model = {"services": {"traefik": {
                "environment": {"ORIGIN_AUTH_MODE": "verify"},
                "volumes": [{"source": str(tls), "target": "/certs"}],
            }}}
            validate_origin_auth(model)
        except Exception:
            for path in reversed(created):
                if path.is_dir():
                    path.rmdir()
                else:
                    path.unlink()
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("secrets_directory", type=Path)
    parser.add_argument("--cloudflare-ca", required=True, type=Path,
                        help="AOP CA downloaded from Cloudflare's official documentation")
    args = parser.parse_args()
    os.umask(0o077)
    require_tools("openssl")
    provision(args.secrets_directory, args.cloudflare_ca)
    print("Origin trust and one-year local probe certificate created; no private keys printed.")
    print("The probe key stays outside the TLS container mount. Back it up securely.")
    print("Set ORIGIN_AUTH_MODE=verify, enable Cloudflare AOP, then enforce required. See docs/origin-auth.md.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        message = str(error) if type(error) is ValueError else "Unable to provision origin authentication files"
        sys.exit(f"Origin authentication setup failed: {message}")
