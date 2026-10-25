#!/usr/bin/env python3
"""Stage production copies locally and atomically select the database/uploads pair."""

import getpass
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
from datetime import datetime, timezone
from urllib.parse import quote
import uuid


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / ".data"
CURRENT = DATA / "production-current.json"
DB_PATTERN = r"bomish_dev_[a-f0-9]{32}"
# Never let inherited libpq options redirect a local administrative operation.
LOCAL_ENV = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
LOCAL = ["-h", "127.0.0.1", "-p", "55432", "-U", getpass.getuser()]


def run(args, **kwargs):
    return subprocess.run(args, check=True, env=LOCAL_ENV, **kwargs)


def query(database, sql):
    return run(["psql", "-X", *LOCAL, "-d", database, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql],
               capture_output=True, text=True).stdout.strip()


def database_url(name):
    return f"postgres://{quote(getpass.getuser(), safe='')}@127.0.0.1:55432/{name}?sslmode=disable"


def current():
    if not CURRENT.exists():
        return {"database": "bomish", "uploads": str(DATA / "uploads")}
    state = json.loads(CURRENT.read_text())
    if not re.fullmatch(DB_PATTERN, state["database"]):
        raise ValueError("Invalid saved local database name")
    expected = DATA / "production-copies" / state["database"] / "uploads"
    if Path(state["uploads"]).resolve() != expected.resolve() or not expected.is_dir():
        raise ValueError("Saved production copy uploads are missing or invalid")
    return state


def ssh_command():
    target = os.environ.get("BOMISH_PRODUCTION_SSH", "")
    port = os.environ.get("BOMISH_PRODUCTION_PORT", "22")
    if not re.fullmatch(r"[a-zA-Z0-9_][a-zA-Z0-9_.@-]*", target):
        raise ValueError("Set BOMISH_PRODUCTION_SSH in .env to user@host or an SSH alias")
    if not port.isdigit() or not 1 <= int(port) <= 65535:
        raise ValueError("BOMISH_PRODUCTION_PORT must be between 1 and 65535")
    command = ["ssh", "-T", "-p", port, "-o", "BatchMode=yes",
               "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=15",
               "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4"]
    if identity := os.environ.get("BOMISH_PRODUCTION_IDENTITY_FILE"):
        command += ["-i", str(Path(identity).expanduser()), "-o", "IdentitiesOnly=yes"]
    return [*command, target]


def remote(ssh, args, **kwargs):
    # OpenSSH passes one command string to the remote shell.
    return run([*ssh, shlex.join(args)], **kwargs)


def container(ssh, project, service):
    result = remote(ssh, ["docker", "ps", "--filter", f"label=com.docker.compose.project={project}",
                          "--filter", f"label=com.docker.compose.service={service}",
                          "--format", "{{.ID}}"], capture_output=True, text=True).stdout.strip()
    if not re.fullmatch(r"[a-f0-9]{12,64}", result):
        raise ValueError(f"Expected one running production {service} container for {project}")
    return result


def extract_uploads(archive, destination):
    with tarfile.open(archive) as source:
        # Uploaded files must not install symlinks, devices or escape the copy.
        for member in source.getmembers():
            path = destination / member.name
            if not (member.isfile() or member.isdir()) or not path.resolve().is_relative_to(destination.resolve()):
                raise ValueError("Unsafe member in production uploads archive")
        source.extractall(destination, filter="data")


def refresh():
    ssh = ssh_command()
    project = os.environ.get("BOMISH_PRODUCTION_PROJECT", "bomish-production")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", project):
        raise ValueError("Invalid BOMISH_PRODUCTION_PROJECT")
    for dependency in ("ssh", "pg_restore", "createdb", "dropdb"):
        if not shutil.which(dependency):
            raise ValueError(f"Missing dependency: {dependency}")
    # Confirm the port belongs to this checkout's cluster before creating anything.
    if Path(query("postgres", "SHOW data_directory")).resolve() != (DATA / "postgres").resolve():
        raise ValueError("Port 55432 is not this checkout's development database")
    db_container = container(ssh, project, "db")
    api_container = container(ssh, project, "api")
    name = "bomish_dev_" + uuid.uuid4().hex
    work = DATA / "production-copies" / name
    work.mkdir(parents=True, mode=0o700)
    uploads = work / "uploads"
    uploads.mkdir()
    dump = work / "database.dump"
    archive = work / "uploads.tar"
    created = False
    committed = False
    try:
        print("Fetching production database and uploads over SSH…", file=sys.stderr)
        with dump.open("wb") as output:
            remote(ssh, ["docker", "exec", db_container, "pg_dump", "-U", "postgres",
                         "-d", "bomish", "--format=custom", "--no-owner", "--no-acl"], stdout=output)
        # Dump first: upload names are immutable, matching the production backup flow.
        with archive.open("wb") as output:
            remote(ssh, ["docker", "exec", api_container, "tar", "-C", "/data/uploads", "-cf", "-", "."], stdout=output)
        extract_uploads(archive, uploads)
        print("Restoring and validating a separate local database…", file=sys.stderr)
        run(["createdb", *LOCAL, "--template=template0", name])
        created = True
        run(["pg_restore", *LOCAL, "--exit-on-error", "--no-owner", "--no-acl", "-d", name, str(dump)])
        known = {p.name.split("_", 1)[0] for p in (ROOT / "backend/migrations").glob("*.sql")}
        restored = set(query(name, "SELECT version FROM schema_migrations").splitlines())
        if restored - known:
            raise ValueError("Production has newer migrations. Update this checkout before refreshing")
        env = dict(LOCAL_ENV, DATABASE_URL=database_url(name), APP_ENV="development", SEED_DEMO="false")
        env.pop("DATABASE_URL_FILE", None)
        subprocess.run([str(DATA / "bomish-api"), "prepare-local-copy"], env=env, check=True, stdout=sys.stderr)
        query(name, "SELECT count(*) FROM products; SELECT count(*) FROM categories")
        state = {"database": name, "uploads": str(uploads),
                 "fetched_at": datetime.now(timezone.utc).isoformat()}
        # Commit database AND uploads together. No rename/drop of the active DB.
        pending = work / "current.json"
        pending.write_text(json.dumps(state) + "\n")
        os.replace(pending, CURRENT)
        committed = True
        print("Production copy ready. Previous local copies are preserved.", file=sys.stderr)
        return state
    finally:
        dump.unlink(missing_ok=True)
        archive.unlink(missing_ok=True)
        if not committed:
            if created:
                subprocess.run(["dropdb", *LOCAL, "--if-exists", name], env=LOCAL_ENV, check=False)
            shutil.rmtree(work)


def main():
    os.umask(0o077)
    if sys.argv[1:] not in (["--offline"], ["--refresh-production"]):
        raise ValueError("Usage: dev-database.py --offline|--refresh-production (called by dev-local.sh)")
    state = refresh() if sys.argv[1] == "--refresh-production" else current()
    if "fetched_at" in state:
        print(f"Using production copy fetched at {state['fetched_at']}", file=sys.stderr)
    # Two lines read by the launcher; never shell-evaluate saved metadata.
    print(database_url(state["database"]))
    print(state["uploads"])


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError, tarfile.TarError) as error:
        print(f"Local database setup failed: {error}. Previous local data remains selected.", file=sys.stderr)
        sys.exit(1)
