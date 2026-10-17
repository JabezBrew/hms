"""Copy the real lease into an isolated host substitute; no production override."""
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def copy_lease_helper(root: Path, lease: Path) -> Path:
    source = (REPO / 'ops/deploy-lease.py').read_text()
    original = "LEASE_PATH = Path('/opt/.hms-deploy-state/deploy.lock')"
    assert source.count(original) == 1
    target = root / 'ops/deploy-lease.py'
    target.parent.mkdir(parents=True, exist_ok=True)
    source = source.replace(original, f'LEASE_PATH = Path({str(lease.resolve())!r})')
    legacy = "LEGACY_LOCK_PATH = Path('/tmp/hms-deploy.lock')"
    assert source.count(legacy) == 1
    source = source.replace(legacy, f'LEGACY_LOCK_PATH = Path({str(lease.parent.parent / "legacy-deploy.lock")!r})')
    target.write_text(source)
    return target
