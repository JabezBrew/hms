#!/usr/bin/env python3
"""Generate or validate private synthetic deployment settings without printing secrets."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import secrets
import stat

KIT = Path(__file__).resolve().parent
DOMAIN = re.compile(r"(?=.{1,253}\Z)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*\Z")


def read_env(path: Path) -> dict[str, str]:
    values = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or key in values:
            raise ValueError("Invalid or duplicate env setting; use the generated file format")
        values[key] = value
    return values


def validate(path: Path, require_tunnel: bool, public: bool = False) -> None:
    file_mode = path.stat().st_mode
    if path.is_symlink() or not stat.S_ISREG(file_mode) or stat.S_IMODE(file_mode) & 0o077:
        raise ValueError("Private env must be a regular file with mode 600")
    values = read_env(path)
    if not DOMAIN.fullmatch(values.get("CLIENT_DOMAIN", "")):
        raise ValueError("CLIENT_DOMAIN must be a DNS hostname")
    for key, expected in {
        "HMS_ENV": "staging", "HMS_SEED_DEMO_DATA": "true",
        "HMS_DEMO_SEED_PROFILE": "smoke", "HMS_COOKIE_SECURE": "true",
        "COMPOSE_PROJECT_NAME": "hms-free-test",
    }.items():
        if values.get(key) != expected:
            raise ValueError(f"{key} must be {expected} for the synthetic testing kit")
    for key, minimum in {"DB_PASSWORD": 64, "HMS_JWT_SECRET": 128,
                         "HMS_BOOTSTRAP_ADMIN_PASSWORD": 48}.items():
        if not re.fullmatch(rf"[0-9a-f]{{{minimum},}}", values.get(key, "")):
            raise ValueError(f"{key} must contain the generated hexadecimal secret")
    port = values.get("HMS_TEST_HTTP_PORT", "")
    if not port.isdigit() or not 1024 <= int(port) <= 65535:
        raise ValueError("HMS_TEST_HTTP_PORT must be between 1024 and 65535")
    if require_tunnel:
        token = values.get("CLOUDFLARE_TUNNEL_TOKEN", "")
        team = values.get("HMS_TEST_ACCESS_TEAM_DOMAIN", "")
        if not token or any(char.isspace() for char in token):
            raise ValueError("Set CLOUDFLARE_TUNNEL_TOKEN privately before deploying the tunnel")
        if not public and (not DOMAIN.fullmatch(team) or not team.endswith(".cloudflareaccess.com")):
            raise ValueError("Set HMS_TEST_ACCESS_TEAM_DOMAIN to your team.cloudflareaccess.com hostname")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--domain")
    parser.add_argument("--admin-email")
    parser.add_argument("--output", type=Path, default=KIT / ".env")
    parser.add_argument("--check", type=Path)
    parser.add_argument("--require-tunnel", action="store_true")
    parser.add_argument("--public", action="store_true",
                        help="Use HMS login without a Cloudflare Access gate")
    args = parser.parse_args()
    try:
        if args.check:
            validate(args.check, args.require_tunnel, args.public)
            print("Private synthetic deployment settings validated.")
            return 0
        if not args.domain or not DOMAIN.fullmatch(args.domain):
            raise ValueError("Supply --domain with a lowercase DNS hostname")
        if not args.admin_email or not re.fullmatch(r"[A-Za-z0-9.!+_%=-]+@[A-Za-z0-9.-]+", args.admin_email):
            raise ValueError("Supply --admin-email with your login email")
        overrides = {
            "VERSION": "free-test", "COMPOSE_PROJECT_NAME": "hms-free-test",
            "CLIENT_SLUG": "free-test", "CLIENT_NAME": "HMS Synthetic Test",
            "CLIENT_DOMAIN": args.domain, "ACME_EMAIL": args.admin_email,
            "HMS_ENV": "staging", "HMS_FACILITY_CODE": "TEST",
            "HMS_FACILITY_NAME": "HMS Synthetic Test", "HMS_SEED_DEMO_DATA": "true",
            "HMS_BOOTSTRAP_ADMIN_EMAIL": args.admin_email,
            "HMS_BOOTSTRAP_ADMIN_NAME": "Test Administrator",
            "DB_PASSWORD": secrets.token_hex(32), "HMS_JWT_SECRET": secrets.token_hex(64),
            "HMS_BOOTSTRAP_ADMIN_PASSWORD": secrets.token_hex(24),
            "GRAFANA_ADMIN_PASSWORD": secrets.token_hex(24),
            "PUBLIC_HEALTHCHECK_MODE": "skip",
            "RESTIC_REPOSITORY": "", "RESTIC_PASSWORD": "",
            "AWS_ACCESS_KEY_ID": "", "AWS_SECRET_ACCESS_KEY": "",
        }
        template = (KIT.parent / "compose-v2" / "env.example").read_text()
        template = template.replace("# Copy this file to ops/compose-v2/.env on the client VPS.",
                                    "# Private settings generated for ops/free-testing/.env.")
        lines = [f"{line.split('=', 1)[0]}={overrides[line.split('=', 1)[0]]}"
                 if "=" in line and line.split("=", 1)[0] in overrides else line
                 for line in template.splitlines()]
        lines.extend(["", "# Synthetic private tunnel; keep credentials in this ignored file.",
                      "HMS_DEMO_SEED_PROFILE=smoke", "HMS_TEST_HTTP_PORT=8088",
                      "CLOUDFLARE_TUNNEL_TOKEN=", "HMS_TEST_ACCESS_TEAM_DOMAIN="])
        fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as output:
            output.write("\n".join(lines) + "\n")
        print(f"Created private settings at {args.output}. Credentials are only in that file.")
        return 0
    except (OSError, ValueError) as error:
        # OSError filenames are safe here; never echo env values or secret contents.
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    raise SystemExit(main())
