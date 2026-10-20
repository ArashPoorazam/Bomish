#!/usr/bin/env python3
"""Generate local deployment secrets without printing credentials. Run on the VPS."""

import argparse
import os
import secrets
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument(
    "directory", type=Path, help="Absolute secrets directory, outside the checkout"
)
args = parser.parse_args()
root = args.directory
if not root.is_absolute():
    parser.error("Use an absolute directory outside the checkout")
if root.resolve().is_relative_to(Path(__file__).resolve().parents[1]):
    parser.error("Keep production secrets outside the checkout")
if root.exists():
    parser.error("Destination already exists; refusing to overwrite credentials")
os.umask(0o077)
root.mkdir(parents=True, mode=0o700)
app = secrets.token_hex(32)
migrator = secrets.token_hex(32)
values = {
    "postgres_password": secrets.token_hex(32),
    "app_db_password": app,
    "migration_db_password": migrator,
    "app_database_url": f"postgres://bomish_app:{app}@db:5432/bomish?sslmode=disable",
    "migration_database_url": f"postgres://bomish_migrator:{migrator}@db:5432/bomish?sslmode=disable",
    "totp_key": secrets.token_hex(32),
    "restic_password": secrets.token_hex(32),
    "grafana_password": secrets.token_urlsafe(32),
    "backup_credentials": "[default]\naws_access_key_id = REPLACE_ME\naws_secret_access_key = REPLACE_ME",
}
for name, value in values.items():
    path = root / name
    path.write_text(value + "\n")
    # Parent is 0700. Bind-mounted Compose secrets must be readable by nonroot
    # application/PostgreSQL/Grafana users inside their respective containers.
    path.chmod(0o444)
(root / "tls").mkdir(mode=0o700)
print(f"Secrets written to {root}; no existing files were replaced.")
print(
    "Configure backup_credentials and tls/origin.crt + tls/origin.key before deployment."
)
print("Store the restic password and TOTP key in an independent password manager.")
