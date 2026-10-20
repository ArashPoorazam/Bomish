#!/usr/bin/env python3
"""Validate an images.env artifact as data, never as shell commands."""

import re
import sys
from pathlib import Path

expected = {"API_IMAGE", "WEB_IMAGE", "BACKUP_IMAGE"}
keys = set()
for line in Path(sys.argv[1]).read_text().splitlines():
    match = re.fullmatch(
        r"(API_IMAGE|WEB_IMAGE|BACKUP_IMAGE)=ghcr\.io/[a-z0-9_./-]+@sha256:[a-f0-9]{64}",
        line,
    )
    if not match or match[1] in keys:
        raise SystemExit("Invalid image artifact: expected three unique GHCR image digests")
    keys.add(match[1])
if keys != expected:
    raise SystemExit("Incomplete image artifact")
