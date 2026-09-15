#!/usr/bin/env python3
"""Remove the opt-in compatibility test-suite harness from a build tree.

`jupyterlab_slurm/test_suite.py` contains the entire `/test-suite` harness
(`SlurmTestSuiteHandler` + the `SlurmTesting` config class). It is designed
to be optional: `jupyterlab_slurm/__init__.py` and `jupyterlab_slurm/handlers.py`
guard their imports of it with `try/except ImportError`, so if the file is
missing the extension behaves exactly as if `SlurmTesting.enabled` were
always `False` -- the `/test-suite` route is never registered.

Run this script before building a *production* wheel/sdist to make sure the
harness module is not shipped at all, e.g.:

    python scripts/strip_test_suite_from_build.py
    python -m build

This is intentionally a separate, explicit step rather than an automatic
part of every build, so that local development and CI test runs (which do
exercise the harness in jupyterlab_slurm/tests/test_handlers.py) keep working
without any extra configuration.
"""
import os
import sys

TARGET = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "jupyterlab_slurm", "test_suite.py",
)


def main():
    if not os.path.exists(TARGET):
        print(f"[strip_test_suite] {TARGET} already absent; nothing to do.")
        return 0
    os.remove(TARGET)
    print(f"[strip_test_suite] Removed {TARGET} from the build tree.")
    print("[strip_test_suite] The /test-suite route will not be registered "
          "in this build; SlurmTesting.enabled has no effect.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
