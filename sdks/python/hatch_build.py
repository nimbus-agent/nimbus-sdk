"""Copy the language-neutral spec into the distribution at build time.

The spec lives at the repository root, outside this project directory, because it is
not Python's to own. Both the sdist and the wheel need it: a hook that populates only
the wheel produces an sdist that cannot be built from, which nobody notices until a
downstream packager tries.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

DATA_DIR = Path("src") / "nimbus_sdk" / "_data" / "spec"


class SpecDataHook(BuildHookInterface):  # type: ignore[type-arg]
    """Populates ``nimbus_sdk/_data/spec`` before every build target."""

    PLUGIN_NAME = "spec-data"

    def initialize(self, version: str, build_data: dict[str, Any]) -> None:
        project = Path(self.root)
        source = project.parent.parent / "docs" / "spec"
        if not source.is_dir():
            # An sdist already carries its own copy under src/, so a rebuild from an
            # unpacked sdist has no repository above it and nothing to do.
            if (project / DATA_DIR).is_dir():
                return
            raise RuntimeError(
                f"spec source not found at {source} and no bundled copy present"
            )

        target = project / DATA_DIR
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(source, target, ignore=shutil.ignore_patterns("*.md"))
