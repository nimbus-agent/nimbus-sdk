"""Acceptance tests for the wire behaviour the gateway depends on.

These drive ``python -m nimbus_quickstart_connector.main`` as a real process, so they
exercise the handshake and the MCP transport over one pair of pipes — the only place the
bug this project is shaped around can appear.

The last two tests are the ones to keep. See their docstrings.
"""

from __future__ import annotations

import json
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from types import TracebackType
from typing import Any

from nimbus_quickstart_connector.manifest import MANIFEST, TOOLS

MODULE = "nimbus_quickstart_connector.main"
# Only ever reached on a failure: a healthy run answers in milliseconds. Long enough to
# absorb a slow CI runner's interpreter start, short enough that a broken replay reports
# in seconds rather than half a minute.
TIMEOUT_SECONDS = 10.0
POLL_SECONDS = 0.02


@dataclass(frozen=True)
class Run:
    returncode: int
    stdout: str
    stderr: str


class Connector:
    """The connector, running, with its stdout readable *while* it runs.

    Reading stdout as it arrives is what makes the split-frame test below causal rather
    than timed: it can wait for a response that proves the child consumed the first
    write before it issues the second. A ``time.sleep`` between writes cannot prove
    that — a child slower to start than the sleep is long reads both writes as one
    chunk, and the test silently degenerates into the pipelining test above it.
    """

    def __init__(self) -> None:
        self._process = subprocess.Popen(
            [sys.executable, "-m", MODULE],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        assert self._process.stdin is not None
        assert self._process.stdout is not None
        assert self._process.stderr is not None
        self._stdin = self._process.stdin
        self._stdout = self._process.stdout
        self._stderr = self._process.stderr
        # Appended to by the reader thread, read by the test thread. `list.append` and
        # indexing are atomic here, so no lock is needed for this access pattern.
        self.lines: list[str] = []
        self._err: list[bytes] = []
        self._threads = [
            threading.Thread(target=self._read_stdout, daemon=True),
            threading.Thread(target=self._read_stderr, daemon=True),
        ]
        for thread in self._threads:
            thread.start()

    def __enter__(self) -> Connector:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        if self._process.poll() is None:
            self._process.kill()
            self._process.wait(timeout=TIMEOUT_SECONDS)

    def _read_stdout(self) -> None:
        while True:
            raw = self._stdout.readline()
            if not raw:
                return
            self.lines.append(raw.decode("utf-8"))

    def _read_stderr(self) -> None:
        self._err.append(self._stderr.read())

    def write(self, text: str) -> None:
        self._stdin.write(text.encode("utf-8"))
        self._stdin.flush()

    def wait_for_id(self, wanted: int) -> dict[str, Any]:
        """The first JSON-RPC frame carrying ``id``, or an assertion failure."""
        deadline = time.monotonic() + TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            for frame in frames("".join(self.lines)):
                if frame.get("id") == wanted:
                    return frame
            if self._process.poll() is not None and not self._stdout.readable():
                break
            time.sleep(POLL_SECONDS)
        raise AssertionError(
            f"no frame with id {wanted}; stdout was:\n{''.join(self.lines)}"
        )

    def finish(self) -> Run:
        self._stdin.close()
        returncode = self._process.wait(timeout=TIMEOUT_SECONDS)
        for thread in self._threads:
            thread.join(timeout=TIMEOUT_SECONDS)
        return Run(
            returncode=returncode,
            stdout="".join(self.lines),
            stderr=b"".join(self._err).decode("utf-8"),
        )


def drive(text: str) -> Run:
    """Write ``text`` as one chunk, close stdin, and collect everything.

    The write is issued while the child is still starting, so it sits in the pipe buffer
    before the child's first read and arrives whole — which is exactly what a gateway
    that announces unprompted does.
    """
    with Connector() as connector:
        connector.write(text)
        return connector.finish()


def hello(versions: list[str]) -> str:
    return json.dumps({"nimbus": "hello", "contractVersions": versions}) + "\n"


def frames(stdout: str) -> list[dict[str, Any]]:
    parsed: list[dict[str, Any]] = []
    for line in stdout.split("\n"):
        if line.strip():
            parsed.append(json.loads(line))
    return parsed


def request(request_id: int, method: str, params: dict[str, Any] | None = None) -> str:
    body: dict[str, Any] = {"jsonrpc": "2.0", "id": request_id, "method": method}
    if params is not None:
        body["params"] = params
    return json.dumps(body) + "\n"


INITIALIZE = request(
    1,
    "initialize",
    {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "acceptance-test", "version": "0.0.0"},
    },
)
INITIALIZED = (
    json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n"
)
LIST_TOOLS = request(2, "tools/list")


def assert_answered_initialize(frame: dict[str, Any]) -> None:
    """Proved ours by ``serverInfo`` — a frame only this connector could have written.

    Nothing here is inferred from timing and no log line is involved.
    """
    result = frame.get("result", {})
    assert result.get("serverInfo", {}).get("name") == MANIFEST["id"]


def test_answers_a_hello_it_can_satisfy_and_exits_cleanly() -> None:
    run = drive(hello(["1"]))
    assert run.returncode == 0, run.stderr
    first = frames(run.stdout)[0]
    assert first["nimbus"] == "hello"
    assert first["contractVersions"] == ["1"]


def test_refuses_a_hello_with_no_common_major_and_exits_20() -> None:
    run = drive(hello(["2"]))
    assert run.returncode == 20
    assert "handshake refused" in run.stderr


def test_answers_a_request_pipelined_into_the_hellos_chunk() -> None:
    """Half of the defect this template exists to avoid: the **complete** frames.

    The gateway may pipeline its first MCP request into the same chunk as its hello.
    ``perform_handshake`` returns those extra frames as ``result.pending``; a connector
    that starts its transport on raw stdin never sees them, and the session's first
    request is answered with silence.

    If you restructure ``main.py`` and drop the ``pending`` replay, this test fails.
    """
    run = drive(hello(["1"]) + INITIALIZE)
    assert run.returncode == 0, run.stderr
    answered = [frame for frame in frames(run.stdout) if frame.get("id") == 1]
    assert answered, f"no response to the pipelined request; stdout was:\n{run.stdout}"
    assert_answered_initialize(answered[0])


def test_completes_a_frame_the_hellos_chunk_left_half_written() -> None:
    """The other half: the frame the gateway left **half-written**.

    ``pending`` cannot carry it — it was never a complete line — so it survives only
    inside the ``NdjsonLineReader`` passed to ``perform_handshake``. That is why
    ``main.py`` keeps pushing the rest of stdin *through that same reader* instead of
    letting the transport read raw stdin. Replaying ``pending`` and then reading raw
    stdin passes the test above and fails this one: the transport would receive the tail
    of a JSON frame whose head the handshake consumed.

    The synchronisation is causal, not timed. The first write ends part-way through the
    ``tools/list`` frame; the test then waits for the ``initialize`` response, which the
    connector cannot produce until it has consumed that whole write. Only then does the
    rest of the frame go out. There is no sleep to tune and no way for the two writes to
    be read as one.
    """
    cut = 25
    assert 0 < cut < len(LIST_TOOLS) - 1
    with Connector() as connector:
        connector.write(hello(["1"]) + INITIALIZE + INITIALIZED + LIST_TOOLS[:cut])
        assert_answered_initialize(connector.wait_for_id(1))
        connector.write(LIST_TOOLS[cut:])
        listed = connector.wait_for_id(2)
        run = connector.finish()

    assert run.returncode == 0, run.stderr
    names = [tool["name"] for tool in listed["result"]["tools"]]
    assert names == [TOOLS[0]["name"]]
