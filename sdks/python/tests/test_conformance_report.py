"""The recorder's own tests. It is test-only code, but a broken recorder makes the CI
gate report coverage that was never executed — so it gets the same treatment as the
bindings."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from _conformance_report import Recorder, corpus_files, recorder

from nimbus_sdk import load_corpus


def test_corpus_files_returns_index_order_file_identities() -> None:
    files = corpus_files("url-resolution")
    assert len(files) >= 28
    assert all(f.startswith("cases/") and f.endswith(".json") for f in files)


def test_corpus_files_length_matches_load_corpus() -> None:
    # The zip every corpus runner performs. If these ever diverge, every case after the
    # divergence would be recorded under the wrong name.
    for area in ("negotiation", "framing", "diagnostics", "url-resolution"):
        assert len(corpus_files(area)) == len(load_corpus(area)), area


def test_recorder_writes_the_envelope(tmp_path: Path) -> None:
    rec = Recorder("framing", "suite", str(tmp_path))
    rec.record("cases/b.json")
    rec.record("cases/a.json")
    rec.record("cases/b.json")
    rec.flush()
    report_path = tmp_path / "python.framing.suite.json"
    written = json.loads(report_path.read_text(encoding="utf-8"))
    assert written == {
        "language": "python",
        "corpus": "framing",
        "producer": "suite",
        "executed": ["cases/a.json", "cases/b.json"],
    }


def test_recorder_writes_nothing_without_a_directory(tmp_path: Path) -> None:
    rec = Recorder("framing", "suite", None)
    rec.record("cases/a.json")
    rec.flush()
    assert list(tmp_path.iterdir()) == []


def test_the_producer_carries_the_xdist_worker_id(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # xdist runs workers as separate processes, so a lock would not help — a
    # per-worker file name is what stops two workers clobbering one report. The
    # reconciler unions producers.
    monkeypatch.setenv("NIMBUS_CONFORMANCE_REPORT", str(tmp_path))
    monkeypatch.setenv("PYTEST_XDIST_WORKER", "gw3")
    rec = recorder("framing")
    rec.record("cases/a.json")
    rec.flush()
    assert (tmp_path / "python.framing.suite-gw3.json").is_file()


def test_corpus_files_rejects_an_unknown_area() -> None:
    with pytest.raises(FileNotFoundError):
        corpus_files("no-such-corpus")
