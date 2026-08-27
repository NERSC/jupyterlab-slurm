"""Small shared helpers used by both the core handlers module and the
optional test-suite module.

Keeping these in a tiny standalone module (with no dependency on
`handlers.py` or `test_suite.py`) avoids a circular import between the two:
`handlers.py` optionally imports `SlurmTestSuiteHandler` from
`test_suite.py`, and `test_suite.py` needs the same envelope/logging
helpers as the rest of the extension.
"""
import logging

logger = logging.Logger(__file__)

# Every Slurm subprocess invocation (squeue/sacct/scontrol/scancel/sbatch,
# including the test-suite harness) must be bounded by a timeout so a
# hung/unresponsive command cannot leak a process or block a request
# indefinitely.
SLURM_COMMAND_TIMEOUT_SECONDS = 60.0


# Unified response envelope used across all handlers. Every response body
# (success or failure) carries the same five keys so the frontend never has
# to special-case a particular endpoint's shape.
def make_envelope(success: bool, data: dict = None, error: str = None,
                   exit_code: int = 0, message: str = None) -> dict:
    return {
        "success": success,
        "responseMessage": message,
        "errorMessage": error,
        "exitCode": exit_code,
        "data": data if data is not None else {},
    }
