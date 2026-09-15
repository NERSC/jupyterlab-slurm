"""Small shared helpers used by both the core handlers module and the
optional test-suite module.

Keeping these in a tiny standalone module (with no dependency on
`handlers.py` or `test_suite.py`) avoids a circular import between the two:
`handlers.py` optionally imports `SlurmTestSuiteHandler` from
`test_suite.py`, and `test_suite.py` needs the same envelope/logging
helpers as the rest of the extension.
"""
import logging
import re

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


# Substrings that indicate a Slurm command failure was caused by an
# unreachable/broken backend (controller down, exec-layer failure, etc.)
# rather than an ordinary Slurm-level rejection of a valid request (e.g. a
# nonexistent job id, or a `-u <user>` filter that doesn't resolve to a real
# system account). Matched case-insensitively against combined stdout+stderr.
_INFRA_FAILURE_SIGNATURES = (
    "unable to contact slurm controller",
    "communication connection failure",
    "zero bytes were transmitted or received",
    "connection refused",
    "no route to host",
    "error response from daemon",
    "command not found",
)


_CANCELLED_BY_UID_RE = re.compile(r'\bby (\d+)\s*$')


def resolve_cancelled_by_uid(state_text):
    """Slurm's own `sacct`/`scontrol` output renders a job cancelled by a
    user (as opposed to timed out, OOM-killed, etc.) as the literal text
    "CANCELLED by <uid>" -- a bare numeric uid, never a username. Left as-is,
    this is confusing to display (e.g. "CANCELLED by 2001" gives no hint
    that 2001 is even a user id, let alone which user). Resolve it to
    "CANCELLED by <username>" via the local passwd database when possible,
    falling back to the original numeric text if the uid can't be resolved
    (e.g. it belongs to a different host's user database, as can happen with
    accounting data from a decommissioned/renamed account).
    """
    if not state_text:
        return state_text
    m = _CANCELLED_BY_UID_RE.search(state_text)
    if not m:
        return state_text
    try:
        import pwd
        replacement = pwd.getpwuid(int(m.group(1))).pw_name
    except Exception:
        # NSS lookup failed (e.g. incomplete LDAP/sssd setup on this host,
        # or a uid from a decommissioned/renamed account) -- keep the
        # numeric id, but make clear it IS a user id rather than leaving an
        # ambiguous bare number (e.g. "CANCELLED by user 2001" instead of
        # the more cryptic "CANCELLED by 2001").
        replacement = "user {}".format(m.group(1))
    return state_text[:m.start(1)] + replacement + state_text[m.end(1):]


def is_infra_failure(rc, err) -> bool:
    """Classify a Slurm command failure as an infra/backend problem (missing
    executable, timeout, unreachable controller, exec-layer error) rather
    than an ordinary Slurm-level rejection of a valid request. Callers use
    this to report 503 only for genuine backend outages, keeping HTTP 200 (or
    404, for job-details) for the many "the command ran fine and told us no"
    outcomes -- an unresolvable `-u <user>` filter or a nonexistent job id is
    a normal response to a normal request, not a server-side failure.
    """
    if rc in (127, -1):
        return True
    text = (err or "").lower()
    return any(sig in text for sig in _INFRA_FAILURE_SIGNATURES)
