"""Record which conformance cases this binding actually executed.

Off unless ``NIMBUS_CONFORMANCE_REPORT`` names a directory, so a local ``pytest -q``
behaves exactly as it did before. It is for FULL-SUITE runs: set it and then filter
with ``-k`` and the report is truthful but partial, which the reconciler rejects — it
cannot tell a filtered run from a broken one.

``load_corpus`` returns case bodies and discards the index's ``file`` entry, and it is
published surface that does not change for a CI concern. ``corpus_files`` reads the
same index through the same ``spec_root()``, and each runner zips the two — so this
inherits the bundled-copy behaviour, including the local-only trap that an
un-reinstalled ``_data/spec`` serves a stale index (run ``python -m pip install -e .``
after editing ``docs/spec``).

No lock, and that is a considered position rather than an omission. The suite is
single-threaded, nothing in its configuration makes it otherwise, and ``set`` mutation
is atomic under the GIL regardless.

The scenario worth guarding is ``pytest-xdist``, and a lock does not guard it: xdist
distributes across PROCESSES, so every worker would get its own recorder, its own
``atexit``, and its own GIL — while all of them wrote to the same
``python.<corpus>.suite.json`` and clobbered each other. The producer segment is what
makes that correct, so it carries the worker id when one is set. The reconciler
already unions producers, so N workers reporting a slice each reconcile to the whole
corpus.
"""

from __future__ import annotations

import atexit
import json
import os
from pathlib import Path

from nimbus_sdk import spec_root


def corpus_files(area: str) -> list[str]:
    """The ``file`` identity of every case the area's index lists, in index order."""
    index_path = spec_root() / "conformance" / "v1" / area / "index.json"
    if not index_path.is_file():
        raise FileNotFoundError(f"no conformance corpus for {area!r} at {index_path}")
    with index_path.open(encoding="utf-8") as handle:
        index: dict[str, object] = json.load(handle)
    entries = index["cases"]
    assert isinstance(entries, list)
    files: list[str] = []
    for entry in entries:
        assert isinstance(entry, dict)
        files.append(str(entry["file"]))
    return files


class Recorder:
    """Collects case identities and writes one report file on flush."""

    def __init__(self, corpus: str, producer: str, directory: str | None) -> None:
        self._corpus = corpus
        self._producer = producer
        self._directory = directory
        self._executed: set[str] = set()

    def record(self, file: str) -> None:
        """Note that ``file`` executed and passed."""
        self._executed.add(file)

    def flush(self) -> None:
        if not self._directory:
            return
        out = Path(self._directory)
        out.mkdir(parents=True, exist_ok=True)
        payload = {
            "language": "python",
            "corpus": self._corpus,
            "producer": self._producer,
            "executed": sorted(self._executed),
        }
        target = out / f"python.{self._corpus}.{self._producer}.json"
        target.write_text(json.dumps(payload), encoding="utf-8")


def recorder(corpus: str, producer: str = "suite") -> Recorder:
    """A recorder for ``corpus``, flushed automatically at interpreter exit.

    ``atexit`` rather than a pytest fixture: the corpus modules are parametrised at
    import time and a session-scoped fixture would have to be requested by every test
    to run at all.

    Under ``pytest-xdist`` each worker is a separate PROCESS with its own recorder, so
    the worker id joins the producer name — otherwise every worker would write the
    same file and the last one to exit would be the only one counted. Nothing sets
    that variable today; the two lines are what make adding ``-n auto`` a non-event
    instead of a silent truncation.
    """
    worker = os.environ.get("PYTEST_XDIST_WORKER")
    if worker:
        producer = f"{producer}-{worker}"
    rec = Recorder(corpus, producer, os.environ.get("NIMBUS_CONFORMANCE_REPORT"))
    atexit.register(rec.flush)
    return rec
