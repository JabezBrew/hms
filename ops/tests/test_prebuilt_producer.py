from __future__ import annotations

import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tarfile
import time

import pytest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "ops/free-testing/build-release.py"
SPEC = importlib.util.spec_from_file_location("prebuilt_producer", SCRIPT)
PRODUCER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PRODUCER)
EPOCH = "202610300030"


def git(repository, *args):
    env = PRODUCER.clean_environment()
    env.update(GIT_AUTHOR_NAME="Fixture", GIT_AUTHOR_EMAIL="fixture@example.test",
               GIT_COMMITTER_NAME="Fixture", GIT_COMMITTER_EMAIL="fixture@example.test")
    return subprocess.check_output(["git", "-C", str(repository), *args], env=env,
                                   stderr=subprocess.DEVNULL)


@pytest.fixture
def repository(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "--quiet")
    files = {
        "ops/compose-v2/runtime-schema-epoch": EPOCH + "\n",
        "ops/schema-compatibility.sh": f'hms_candidate_breaking_epoch() {{ printf "%s\\n" "{EPOCH}"; }}\n',
        "ops/prebuilt_release.py": (ROOT / "ops/prebuilt_release.py").read_text(),
        f"backend-rs/migrations/{EPOCH}_fixture.sql": "-- fixture\n",
        "backend-rs/Dockerfile": "FROM scratch\nARG HMS_BUILD_SHA\n",
        "frontend/Dockerfile": "FROM scratch\nARG HMS_BUILD_SHA\n",
        "frontend/.env.example": "EXAMPLE=value\n",
        "tools/executable.sh": "#!/bin/sh\nexit 0\n",
    }
    for name, content in files.items():
        path = repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    (repo / "tools/executable.sh").chmod(0o755)
    git(repo, "add", ".")
    git(repo, "commit", "--quiet", "-m", "Fixture source")
    return repo


def revision(repository):
    return git(repository, "rev-parse", "HEAD").decode().strip()


def archive_source(repository, destination):
    sha = revision(repository)
    archive = destination / "source.tar"
    archive.write_bytes(git(repository, "-c", "tar.umask=022", "archive", "--format=tar", sha))
    return archive, sha, PRODUCER.source_tree(repository, sha)


def test_real_git_archive_keeps_full_commit_files_and_executable_modes(repository, tmp_path):
    archive, sha, expected = archive_source(repository, tmp_path)
    source = tmp_path / "extracted"
    source.mkdir()
    PRODUCER.extract_source(archive, source, sha, expected)
    assert {str(p.relative_to(source)) for p in source.rglob("*") if p.is_file()} == set(expected)
    assert (source / "tools/executable.sh").stat().st_mode & 0o777 == 0o755
    assert (source / "frontend/.env.example").stat().st_mode & 0o777 == 0o644
    assert PRODUCER.source_epoch(source) == EPOCH


def test_untracked_private_files_are_not_in_committed_source(repository, tmp_path):
    (repository / ".env").write_text("PRIVATE=untracked-fixture\n")
    archive, sha, expected = archive_source(repository, tmp_path)
    source = tmp_path / "source"
    source.mkdir()
    PRODUCER.extract_source(archive, source, sha, expected)
    assert not (source / ".env").exists()


def test_local_git_replace_refs_cannot_rewrite_the_named_commit(repository, tmp_path):
    original = revision(repository)
    expected_content = (repository / "frontend/Dockerfile").read_text()
    (repository / "frontend/Dockerfile").write_text(expected_content + "# replaced fixture\n")
    git(repository, "add", ".")
    git(repository, "commit", "--quiet", "-m", "Replacement fixture")
    git(repository, "replace", original, revision(repository))
    expected = PRODUCER.source_tree(repository, original)
    archive = tmp_path / "source.tar"
    archive.write_bytes(PRODUCER.git(repository, "archive", "--format=tar", original))
    source = tmp_path / "source"
    source.mkdir()
    PRODUCER.extract_source(archive, source, original, expected)
    assert (source / "frontend/Dockerfile").read_text() == expected_content


@pytest.mark.parametrize("candidate", ["main", "HEAD", "abc1234", "A" * 40, "1" * 40])
def test_only_exact_existing_full_commit_is_accepted(repository, candidate):
    with pytest.raises(PRODUCER.ReleaseError):
        PRODUCER.source_tree(repository, candidate)


def test_tracked_worktree_changes_refuse_release(repository):
    (repository / "frontend/Dockerfile").write_text("changed\n")
    with pytest.raises(PRODUCER.ReleaseError, match="tracked changes"):
        PRODUCER.source_tree(repository, revision(repository))


def test_local_git_attributes_are_rejected(repository):
    (repository / ".git/info/attributes").write_text("* export-ignore\n")
    with pytest.raises(PRODUCER.ReleaseError, match="attributes"):
        PRODUCER.source_tree(repository, revision(repository))


@pytest.mark.parametrize("attributes", ["tools/* export-ignore\n", "tools/* export-subst\n"])
def test_committed_archive_transforms_cannot_change_exact_source(repository, tmp_path, attributes):
    (repository / ".gitattributes").write_text(attributes)
    (repository / "tools/executable.sh").write_text("$Format:%H$\n")
    git(repository, "add", ".")
    git(repository, "commit", "--quiet", "-m", "Archive attribute fixture")
    archive, sha, expected = archive_source(repository, tmp_path)
    source = tmp_path / "source"
    source.mkdir()
    with pytest.raises(PRODUCER.ReleaseError, match="complete committed|content differs"):
        PRODUCER.extract_source(archive, source, sha, expected)


@pytest.mark.parametrize("name,kind", [(".env", "file"), ("frontend/.env.production", "file"),
                                       ("target/cache", "file"), ("link", "link")])
def test_private_build_cache_and_link_entries_are_rejected(repository, name, kind):
    path = repository / name
    path.parent.mkdir(exist_ok=True, parents=True)
    if kind == "link":
        path.symlink_to("frontend/Dockerfile")
    else:
        path.write_text("fixture\n")
    git(repository, "add", "--force", name)
    git(repository, "commit", "--quiet", "-m", "Unsupported archive fixture")
    with pytest.raises(PRODUCER.ReleaseError, match="unsupported or private"):
        PRODUCER.source_tree(repository, revision(repository))


@pytest.mark.parametrize("bad_name,kind", [("../escape", tarfile.REGTYPE),
    ("/absolute", tarfile.REGTYPE), ("folder\\escape", tarfile.REGTYPE),
    ("link", tarfile.SYMTYPE), ("hard", tarfile.LNKTYPE), ("fifo", tarfile.FIFOTYPE)])
def test_unsafe_tar_members_never_extract_outside_source(tmp_path, bad_name, kind):
    archive, source = tmp_path / "source.tar", tmp_path / "source"
    source.mkdir()
    with tarfile.open(archive, "w", format=tarfile.PAX_FORMAT, pax_headers={"comment": "a" * 40}) as stream:
        member = tarfile.TarInfo(bad_name)
        member.type = kind
        member.linkname = "../escape"
        stream.addfile(member, io.BytesIO())
    with pytest.raises(PRODUCER.ReleaseError):
        PRODUCER.extract_source(archive, source, "a" * 40, {})
    assert not (tmp_path / "escape").exists()


def test_wrong_tar_commit_refuses_extraction(repository, tmp_path):
    archive, _sha, expected = archive_source(repository, tmp_path)
    source = tmp_path / "source"
    source.mkdir()
    with pytest.raises(PRODUCER.ReleaseError, match="commit metadata"):
        PRODUCER.extract_source(archive, source, "f" * 40, expected)
    assert not list(source.iterdir())


@pytest.fixture
def fake_docker(tmp_path, monkeypatch):
    tools = tmp_path / "tools"
    tools.mkdir()
    path = tools / "docker"
    path.write_text(f"#!{sys.executable}\n" + '''import hashlib, io, json, os, pathlib, sys, tarfile, time
args = sys.argv[1:]
state = pathlib.Path(os.environ["FIXTURE_STATE"])
log = pathlib.Path(os.environ["FIXTURE_COMMANDS"])
with log.open("a") as stream: stream.write(json.dumps(args) + "\\n")
data = json.loads(state.read_text()) if state.exists() else {}
def layer(ref):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w") as archive:
        payload = ref.encode()
        item = tarfile.TarInfo("component")
        item.size = len(payload)
        item.mode = 0o644
        archive.addfile(item, io.BytesIO(payload))
    return output.getvalue()
if args[:2] == ["context", "inspect"]:
    print(os.environ.get("FIXTURE_CONTEXT", '[{"Name":"fixture","Endpoints":{"docker":{"Host":"unix:///fixture.sock"}}}]'))
elif args[0] == "info":
    print(os.environ.get("FIXTURE_ENGINE", '{"OSType":"linux","Architecture":"aarch64"}'))
elif args[:2] == ["buildx", "version"]: print("fixture")
elif args[:2] == ["buildx", "ls"]:
    builders = json.loads(os.environ.get("FIXTURE_BUILDERS", '[{"Name":"fixture","Driver":"docker","Nodes":[{"Endpoint":"fixture","Status":"running","Platforms":["linux/arm64"]}]}]'))
    for builder in builders: print(json.dumps(builder))
elif args[:2] == ["buildx", "build"]:
    if os.environ.get("FIXTURE_BUILD_WAIT"):
        pathlib.Path(os.environ["FIXTURE_BUILD_WAIT"]).write_text(str(os.getpid()))
        time.sleep(60)
    if os.environ.get("FIXTURE_BUILD_FAIL"): sys.exit(7)
    ref = args[args.index("--tag")+1]
    labels = dict(args[i+1].split("=", 1) for i, arg in enumerate(args) if arg == "--label")
    content = layer(ref)
    config = json.dumps({"os":"linux", "architecture":"arm64", "config":{"Labels":labels},
                         "rootfs":{"type":"layers","diff_ids":["sha256:"+hashlib.sha256(content).hexdigest()]}},
                        sort_keys=True).encode()
    data[ref] = {"Id":"sha256:"+hashlib.sha256(config).hexdigest(), "Os":"linux",
                 "Architecture":"arm64", "Size":len(content), "Config":{"Labels":labels},
                 "ConfigBlob":config.decode()}
    state.write_text(json.dumps(data))
elif args[:2] == ["image", "inspect"]:
    item = data.get(args[2])
    if not item: sys.exit(1)
    bad = os.environ.get("FIXTURE_IMAGE_BAD")
    if bad == "platform": item["Architecture"] = "amd64"
    if bad == "revision": item["Config"]["Labels"]["org.opencontainers.image.revision"] = "f"*40
    if bad == "labels": item["Config"]["Labels"] = None
    if bad == "size": item["Size"] = True
    if bad == "id": item["Id"] = "short"
    if bad == "epoch": item["Config"]["Labels"]["systems.thehms.schema-epoch"] = "000000000000"
    print(json.dumps([item]))
elif args[:2] == ["image", "save"]:
    if os.environ.get("FIXTURE_SAVE_FAIL"): sys.exit(9)
    saved = []
    with tarfile.open(args[args.index("--output")+1], "w") as archive:
        def add(name, payload):
            member = tarfile.TarInfo(name)
            member.size = len(payload)
            archive.addfile(member, io.BytesIO(payload))
        for ref in args[args.index("--output")+2:]:
            item = data[ref]
            config = item["Id"][7:]+".json"
            saved_layer = item["Config"]["Labels"]["systems.thehms.component"]+"/layer.tar"
            add(config, item["ConfigBlob"].encode())
            add(saved_layer, b"corrupt" if os.environ.get("FIXTURE_SAVE_CORRUPT") else layer(ref))
            saved.append({"Config":config,"RepoTags":[ref],"Layers":[saved_layer]})
        add("manifest.json", json.dumps(saved).encode())
else: sys.exit(2)
''')
    path.chmod(0o755)
    monkeypatch.setenv("PATH", str(tools) + os.pathsep + os.environ["PATH"])
    monkeypatch.setenv("FIXTURE_STATE", str(tmp_path / "images.json"))
    monkeypatch.setenv("FIXTURE_COMMANDS", str(tmp_path / "commands.jsonl"))
    monkeypatch.delenv("DOCKER_HOST", raising=False)
    monkeypatch.delenv("DOCKER_CONTEXT", raising=False)
    monkeypatch.delenv("BUILDX_BUILDER", raising=False)
    monkeypatch.delenv("BUILDKIT_HOST", raising=False)
    return tmp_path / "commands.jsonl"


def cli(repository, output, **kwargs):
    return subprocess.run([sys.executable, str(SCRIPT), "--repository", str(repository),
                           "--revision", revision(repository), "--output", str(output),
                           "--build-budget-gib", "8", "--reserve-gib", "8"],
                          capture_output=True, text=True, timeout=20, **kwargs)


def test_cli_builds_both_exact_source_images_and_publishes_private_complete_bundle(repository, tmp_path, fake_docker):
    output = tmp_path / "release"
    result = cli(repository, output)
    assert result.returncode == 0, result.stderr
    manifest = json.loads((output / "manifest.json").read_text())
    assert manifest["revision"] == revision(repository)
    assert manifest["schema_epoch"] == EPOCH
    assert manifest["platform"] == "linux/arm64"
    assert set(manifest["images"]) == {"rust", "frontend"}
    assert set(output.iterdir()) == {output / name for name in ("manifest.json", "source.tar.gz", "images.tar.gz")}
    assert output.stat().st_mode & 0o777 == 0o700
    for path in output.iterdir():
        assert path.stat().st_mode & 0o777 == 0o600
        assert path.stat().st_nlink == 1
    for field in ("source", "images_archive"):
        record = manifest[field]
        assert record == PRODUCER.file_record(output / record["file"])
    with tarfile.open(output / "images.tar.gz", "r:gz") as saved:
        assert len(json.load(saved.extractfile("manifest.json"))) == 2
    for image in manifest["images"].values():
        assert image["config_id"] == image["id"]
        assert image["unpacked_size"] == 10240
    commands = [json.loads(row) for row in fake_docker.read_text().splitlines()]
    builds = [row for row in commands if row[:2] == ["buildx", "build"]]
    assert len(builds) == 2
    assert all(row[row.index("--platform") + 1] == "linux/arm64" and "--load" in row for row in builds)
    assert all("--provenance=false" in row and "--sbom=false" in row for row in builds)
    assert all(row[row.index("--builder") + 1] == "fixture" for row in builds)
    assert all(Path(row[-1]) != repository for row in builds)
    assert sum(row[:2] == ["buildx", "ls"] for row in commands) == 3
    assert not list(tmp_path.glob(".hms-prebuilt-*"))


@pytest.mark.parametrize("failure", ["FIXTURE_BUILD_FAIL", "FIXTURE_SAVE_FAIL"])
def test_cli_failure_never_publishes_partial_bundle_or_retains_work(repository, tmp_path, fake_docker, monkeypatch, failure):
    monkeypatch.setenv(failure, "1")
    result = cli(repository, tmp_path / "release")
    assert result.returncode != 0
    assert "failed" in result.stderr
    assert not (tmp_path / "release").exists()
    assert not list(tmp_path.glob(".hms-prebuilt-*"))


def test_saved_layer_corruption_prevents_bundle_publication(repository, tmp_path, fake_docker, monkeypatch):
    monkeypatch.setenv("FIXTURE_SAVE_CORRUPT", "1")
    result = cli(repository, tmp_path / "release")
    assert result.returncode != 0
    assert "archive integrity verification failed" in result.stderr
    assert not (tmp_path / "release").exists()
    assert not list(tmp_path.glob(".hms-prebuilt-*"))


@pytest.mark.parametrize("bad", ["platform", "revision", "labels", "size", "id", "epoch"])
def test_cli_mismatched_image_provenance_refuses_export(repository, tmp_path, fake_docker, monkeypatch, bad):
    monkeypatch.setenv("FIXTURE_IMAGE_BAD", bad)
    result = cli(repository, tmp_path / "release")
    assert result.returncode != 0
    assert "provenance did not match" in result.stderr
    assert not (tmp_path / "release").exists()
    assert not any(json.loads(row)[:2] == ["image", "save"] for row in fake_docker.read_text().splitlines())


@pytest.mark.parametrize("modern", [False, True])
def test_inspection_distinguishes_config_identity_from_containerd_manifest(monkeypatch, modern):
    config_id, object_id = "sha256:" + "a" * 64, "sha256:" + "b" * 64
    image = {"Id": object_id if modern else config_id, "Os": "linux", "Architecture": "arm64",
             "Size": 100, "Config": {"Labels": {"org.opencontainers.image.revision": "a" * 40,
             "systems.thehms.component": "rust", "systems.thehms.schema-epoch": EPOCH}}}
    if modern:
        image["Descriptor"] = {"digest": object_id,
            "mediaType": "application/vnd.docker.distribution.manifest.v2+json",
            "annotations": {"config.digest": config_id}}
    monkeypatch.setattr(PRODUCER, "command", lambda _args: json.dumps([image]).encode())
    value = PRODUCER.inspect_image("fixture", "a" * 40, "rust", EPOCH)
    assert value["config_id"] == config_id
    assert value["id"] == image["Id"]


@pytest.mark.parametrize("descriptor", [{}, {"digest": "sha256:" + "b" * 64},
    {"digest": "sha256:" + "b" * 64, "mediaType": "application/vnd.oci.image.index.v1+json", "annotations": {"config.digest": "sha256:" + "a" * 64}},
    {"digest": "sha256:" + "b" * 64, "mediaType": "application/vnd.oci.image.manifest.v1+json", "annotations": {"config.digest": "short"}}])
def test_present_invalid_descriptor_cannot_fall_back_to_object_id(monkeypatch, descriptor):
    image = {"Id": "sha256:" + "b" * 64, "Os": "linux", "Architecture": "arm64",
             "Size": 100, "Descriptor": descriptor,
             "Config": {"Labels": {"org.opencontainers.image.revision": "a" * 40,
             "systems.thehms.component": "rust", "systems.thehms.schema-epoch": EPOCH}}}
    monkeypatch.setattr(PRODUCER, "command", lambda _args: json.dumps([image]).encode())
    with pytest.raises(PRODUCER.ReleaseError, match="provenance did not match"):
        PRODUCER.inspect_image("fixture", "a" * 40, "rust", EPOCH)


@pytest.mark.parametrize("engine", ['{"OSType":"linux","Architecture":"x86_64"}', "[]", "bad"])
def test_cli_unverified_engine_never_builds(repository, tmp_path, fake_docker, monkeypatch, engine):
    monkeypatch.setenv("FIXTURE_ENGINE", engine)
    result = cli(repository, tmp_path / "release")
    assert result.returncode != 0
    assert not any(json.loads(row)[:2] == ["buildx", "build"] for row in fake_docker.read_text().splitlines())


@pytest.mark.parametrize("key", ["DOCKER_HOST", "DOCKER_CONTEXT", "BUILDX_BUILDER", "BUILDKIT_HOST"])
def test_cli_endpoint_overrides_cannot_redirect_builds(repository, tmp_path, fake_docker, monkeypatch, key):
    monkeypatch.setenv(key, "fixture-remote")
    result = cli(repository, tmp_path / "release")
    assert result.returncode != 0
    assert not fake_docker.exists()


@pytest.mark.parametrize("context", ['[{"Endpoints":{"docker":{"Host":"ssh://fixture"}}}]',
    '[{"Endpoints":{"docker":{"Host":"tcp://fixture:2376"}}}]', '[]', '[null]', 'bad'])
def test_cli_remote_or_unverified_context_never_builds(repository, tmp_path, fake_docker, monkeypatch, context):
    monkeypatch.setenv("FIXTURE_CONTEXT", context)
    result = cli(repository, tmp_path / "release")
    assert result.returncode != 0
    assert not any(json.loads(row)[:2] == ["buildx", "build"] for row in fake_docker.read_text().splitlines())


@pytest.mark.parametrize("change", ["remote_driver", "remote_endpoint", "not_running", "no_arm64", "multiple_nodes", "missing"])
def test_cli_unverified_builder_never_compiles(repository, tmp_path, fake_docker, monkeypatch, change):
    node = {"Endpoint": "fixture", "Status": "running", "Platforms": ["linux/arm64"]}
    builder = {"Name": "fixture", "Driver": "docker", "Nodes": [node]}
    if change == "remote_driver": builder["Driver"] = "remote"
    if change == "remote_endpoint": node["Endpoint"] = "ssh://fixture"
    if change == "not_running": node["Status"] = "inactive"
    if change == "no_arm64": node["Platforms"] = ["linux/amd64"]
    if change == "multiple_nodes": builder["Nodes"].append(dict(node))
    monkeypatch.setenv("FIXTURE_BUILDERS", json.dumps([] if change == "missing" else [builder]))
    result = cli(repository, tmp_path / "release")
    assert result.returncode != 0
    assert not any(json.loads(row)[:2] == ["buildx", "build"] for row in fake_docker.read_text().splitlines())


def test_persisted_remote_default_cannot_override_explicit_local_builder(repository, tmp_path, fake_docker, monkeypatch):
    builders = [{"Name": "remote-default", "Current": True, "Driver": "remote", "Nodes": [{"Endpoint": "ssh://fixture"}]},
                {"Name": "fixture", "Current": False, "Driver": "docker", "Nodes": [{"Endpoint": "fixture", "Status": "running", "Platforms": ["linux/arm64"]}]}]
    monkeypatch.setenv("FIXTURE_BUILDERS", json.dumps(builders))
    result = cli(repository, tmp_path / "release")
    assert result.returncode == 0, result.stderr
    commands = [json.loads(row) for row in fake_docker.read_text().splitlines()]
    builds = [row for row in commands if row[:2] == ["buildx", "build"]]
    assert len(builds) == 2
    assert all(row[row.index("--builder") + 1] == "fixture" for row in builds)


def test_existing_output_directory_is_untouched(repository, tmp_path, fake_docker):
    output = tmp_path / "release"
    output.mkdir()
    sentinel = output / "preserve"
    sentinel.write_text("existing")
    result = cli(repository, output)
    assert result.returncode != 0
    assert sentinel.read_text() == "existing"
    assert not fake_docker.exists()


def test_low_headroom_refuses_before_docker(repository, tmp_path, fake_docker, monkeypatch):
    monkeypatch.setattr(PRODUCER.shutil, "disk_usage", lambda _path: type("Disk", (), {"free": 15 * PRODUCER.GIB})())
    args = PRODUCER.parser().parse_args(["--repository", str(repository), "--revision", revision(repository),
                                       "--output", str(tmp_path / "release"), "--build-budget-gib", "8", "--reserve-gib", "8"])
    with pytest.raises(PRODUCER.ReleaseError, match="headroom"):
        PRODUCER.produce(args)
    assert not fake_docker.exists()


def test_signal_stops_client_cleans_owned_work_and_keeps_bundle_unpublished(repository, tmp_path, fake_docker, monkeypatch):
    marker = tmp_path / "waiting"
    monkeypatch.setenv("FIXTURE_BUILD_WAIT", str(marker))
    process = subprocess.Popen([sys.executable, str(SCRIPT), "--repository", str(repository),
        "--revision", revision(repository), "--output", str(tmp_path / "release"),
        "--build-budget-gib", "8", "--reserve-gib", "8"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        deadline = time.monotonic() + 10
        while not marker.exists() and process.poll() is None and time.monotonic() < deadline:
            time.sleep(0.02)
        assert marker.exists()
        process.send_signal(signal.SIGTERM)
        _stdout, stderr = process.communicate(timeout=5)
        assert process.returncode == 128 + signal.SIGTERM
        assert "interrupted" in stderr
        assert not (tmp_path / "release").exists()
        assert not list(tmp_path.glob(".hms-prebuilt-*"))
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=5)


def test_publish_refuses_even_a_racing_empty_output_directory(tmp_path):
    bundle, output = tmp_path / "bundle", tmp_path / "release"
    bundle.mkdir()
    output.mkdir()
    for name in ("source.tar.gz", "images.tar.gz", "manifest.json"):
        (bundle / name).write_text("fixture")
    inode = output.stat().st_ino
    with pytest.raises(FileExistsError):
        PRODUCER.publish(bundle, output)
    assert output.stat().st_ino == inode
    assert not list(output.iterdir())
