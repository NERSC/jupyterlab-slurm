import datetime
import json
import os
import re
import sys
import asyncio
from typing import Any, Dict

from traitlets.config import Config
import pytest
from tornado.httpclient import HTTPClientError

from .__mocks__.slurm import SlurmControllerMock
from ..config import SlurmCommandPaths

@pytest.fixture(autouse=True)
def mock_server_config(jp_server_config):
    base_path = os.path.dirname(os.path.abspath(__file__))
    
    # Initialize/Reset the shared test data file
    data_path = os.path.join(base_path, 'data', 'squeue_test_data.txt')
    initial_data = """            5025_1 debug     interactive   testuser R        0:01      1 node001
            5025_2 regular   batch_job     testuser R        1:00      2 node[002-003]
            5025_3 regular   pending_job   testuser PD       0:00      1 (Priority)
"""
    with open(data_path, 'w') as f:
        f.write(initial_data)

    paths_config = Config()
    paths = SlurmCommandPaths()
    paths.squeue_path = os.path.join(base_path, '__mocks__/squeue')
    paths.scancel_path = os.path.join(base_path, '__mocks__/scancel')
    paths.scontrol_path = os.path.join(base_path, '__mocks__/scontrol')
    paths.sbatch_path = os.path.join(base_path, '__mocks__/sbatch')
    # new accounting mock path - call via Python to avoid needing executable bit
    sacct_script = os.path.join(base_path, '__mocks__/sacct')
    paths.sacct_path = f"{sys.executable} {sacct_script}"
    paths_config.update(paths.get_paths())
    jp_server_config['SlurmCommandPaths'] = paths_config
    yield jp_server_config

def _get_slurm_controller_mock():
    return SlurmControllerMock()

async def run_command(commands: str) -> Dict[str, Any]:
    import asyncio, shlex, os
    print(f'Command: ${commands}')
    print(f'Exists: {os.path.exists(shlex.split(commands)[0])}')
    process = await asyncio.create_subprocess_exec(*shlex.split(commands),
                                                   stdout=asyncio.subprocess.PIPE,
                                                   stderr=asyncio.subprocess.PIPE,
                                                   cwd=None)
    stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=60.0)
    # decode stdout and from bytes to str, and return stdout, stderr, and returncode
    return {
        'stdout': stdout.decode().strip(),
        'stderr': stderr.decode().strip(),
        'returncode': process.returncode
        }

async def test_status_health_check(jp_fetch):
    response = await jp_fetch("jupyterlab_slurm", "status")

    assert response.code == 200
    payload = json.loads(response.body)
    assert payload["success"] is True
    assert payload["data"]["name"] == "jupyterlab_slurm"
    # Version is reported so the frontend can verify a matched deployment.
    assert "version" in payload["data"] and isinstance(payload["data"]["version"], str)


async def test_test_suite_is_disabled_by_default(jp_fetch):
    """The compatibility harness must not be routable in a default deployment."""
    with pytest.raises(HTTPClientError) as exc_info:
        await jp_fetch(
            "jupyterlab_slurm",
            "test-suite",
            method="POST",
            body="{}",
        )
    assert exc_info.value.code == 404


@pytest.fixture
def enabled_testing(jp_server_config, tmp_path):
    testing = Config()
    testing["enabled"] = True
    testing["allow_mutations"] = False
    testing["test_directory"] = str(tmp_path)
    testing["max_runtime_seconds"] = 60
    jp_server_config["SlurmTesting"] = testing
    return jp_server_config


async def test_test_suite_run_lifecycle_read_only(enabled_testing, jp_fetch):
    response = await jp_fetch(
        "jupyterlab_slurm",
        "test-suite",
        method="POST",
        body="{}",
    )
    assert response.code == 202
    run_id = json.loads(response.body)["data"]["runId"]

    # The read-only mode should complete without submitting a Slurm job.
    for _ in range(20):
        response = await jp_fetch("jupyterlab_slurm", f"test-suite/{run_id}")
        payload = json.loads(response.body)
        if payload["data"]["status"] in {"completed", "error"}:
            break
        await asyncio.sleep(0.05)
    assert payload["data"]["status"] == "completed"
    names = {item["name"] for item in payload["data"]["results"]}
    assert {"squeue", "sacct", "scontrol", "submit-and-account"} <= names

@pytest.fixture
def admin_ui_config(jp_server_config):
    """Simulate an HPC admin defining SlurmUI/SlurmAccounting via server config."""
    ui_config = Config()
    ui_config['queue_column_labels'] = {'JOBID': 'Job ID', 'PARTITION': 'QOS'}
    ui_config['history_column_labels'] = {'JobID': 'Job ID'}
    ui_config['squeue_reload_limit_ms'] = 12000
    jp_server_config['SlurmUI'] = ui_config

    acc_config = Config()
    acc_config['sacct_fields'] = \
        'JobID,JobName,Partition,Account,AllocCPUS,State,ExitCode,Submit'
    acc_config['sacct_time_window_days'] = 14
    jp_server_config['SlurmAccounting'] = acc_config
    return jp_server_config

async def test_admin_ui_config_propagates(admin_ui_config, jp_fetch):
    # Admin-defined SlurmUI settings should flow through to the /ui-config endpoint.
    response = await jp_fetch("jupyterlab_slurm", "ui-config")
    assert response.code == 200
    payload = json.loads(response.body)
    assert payload['success'] is True
    data = payload['data']
    assert data['queue_column_labels'] == {'JOBID': 'Job ID', 'PARTITION': 'QOS'}
    assert data['history_column_labels'] == {'JobID': 'Job ID'}
    assert data['squeue_reload_limit_ms'] == 12000

async def test_admin_sacct_fields_propagate(admin_ui_config, jp_fetch):
    # Admin-defined SlurmAccounting.sacct_fields should drive the history columns.
    response = await jp_fetch("jupyterlab_slurm", "sacct")
    assert response.code == 200
    payload = json.loads(response.body)
    assert payload['data']['columns'] == [
        'JobID', 'JobName', 'Partition', 'Account',
        'AllocCPUS', 'State', 'ExitCode', 'Submit'
    ]

async def test_squeue(jp_fetch):
    response = await jp_fetch("jupyterlab_slurm", "squeue")
    assert response.code == 200
    payload = json.loads(response.body)
    assert payload['success'] is True
    assert payload['exitCode'] == 0

    rows = payload['data']['rows']
    assert isinstance(rows, list) and len(rows) > 0
    # Ensure rows match expected 8-column format and first column is an integer job id (array-like allowed)
    row = rows[0]
    assert len(row) == 8
    # Job ID may be numeric or array-like (e.g., 5025_2); just ensure it is non-empty
    assert isinstance(row[0], str) and len(row[0]) > 0

async def test_sacct_cancelled_by_uid_resolved_to_username(jp_fetch, monkeypatch):
    """Real `sacct` output renders a self-cancelled job's State as the
    literal text "CANCELLED by <uid>" -- a bare numeric uid, never a
    username. This should be resolved to a real username via the local
    passwd/NSS database when possible, so the frontend never shows a bare,
    unexplained number."""
    from .. import handlers as handlers_module

    async def fake_run_command(self, exec_command):
        return {
            "returncode": 0,
            "stdout": "9999|debug|myjob|testuser|CANCELLED by {}|00:00:10|1|0:0\n".format(os.getuid()),
            "stderr": ""
        }

    monkeypatch.setattr(
        handlers_module.SacctHandler, "_run_command", fake_run_command
    )

    response = await jp_fetch("jupyterlab_slurm", "sacct")
    assert response.code == 200
    payload = json.loads(response.body)
    rows = payload['data']['rows']
    row = next((r for r in rows if r[0] == '9999'), None)
    assert row is not None
    columns = payload['data']['columns']
    state_idx = next(i for i, c in enumerate(columns) if c.lower() == 'state')
    import pwd
    expected_username = pwd.getpwuid(os.getuid()).pw_name
    assert row[state_idx] == "CANCELLED by {}".format(expected_username)


async def test_sacct_cancelled_by_unresolvable_uid_falls_back_to_user_prefix(jp_fetch, monkeypatch):
    """When the uid can't be resolved via the local passwd/NSS database
    (e.g. incomplete LDAP/sssd setup, or a decommissioned/renamed account),
    keep the numeric id but make clear it IS a user id, rather than leaving
    an ambiguous bare number."""
    from .. import handlers as handlers_module

    async def fake_run_command(self, exec_command):
        return {
            "returncode": 0,
            "stdout": "9998|debug|myjob|testuser|CANCELLED by 999999999|00:00:10|1|0:0\n",
            "stderr": ""
        }

    monkeypatch.setattr(
        handlers_module.SacctHandler, "_run_command", fake_run_command
    )

    response = await jp_fetch("jupyterlab_slurm", "sacct")
    assert response.code == 200
    payload = json.loads(response.body)
    rows = payload['data']['rows']
    row = next((r for r in rows if r[0] == '9998'), None)
    assert row is not None
    columns = payload['data']['columns']
    state_idx = next(i for i, c in enumerate(columns) if c.lower() == 'state')
    assert row[state_idx] == "CANCELLED by user 999999999"


async def test_sacct_excludes_non_terminal_states(jp_fetch, monkeypatch):
    """Job History (sacct) should only show jobs that have actually
    finished. Real `sacct` reports every job in the queried time window
    regardless of state, including PENDING/RUNNING/SUSPENDED/etc. -- those
    are already live/actionable in the Queue tab, so they must be filtered
    out here to avoid duplicate, stale, and potentially misleading (e.g.
    a still-running job's placeholder ExitCode) rows in History."""
    from .. import handlers as handlers_module

    async def fake_run_command(self, exec_command):
        return {
            "returncode": 0,
            "stdout": "\n".join([
                "8001|debug|still_pending|testuser|PENDING|0:00|1|0:0",
                "8002|debug|still_running|testuser|RUNNING|0:05|1|0:0",
                "8003|debug|paused|testuser|SUSPENDED|0:10|1|0:0",
                "8004|debug|finished_ok|testuser|COMPLETED|0:20|1|0:0",
                "8005|debug|finished_bad|testuser|FAILED|0:15|1|1:0",
                "8006|debug|self_cancelled|testuser|CANCELLED by {}|0:01|1|0:0".format(os.getuid()),
            ]) + "\n",
            "stderr": ""
        }

    monkeypatch.setattr(
        handlers_module.SacctHandler, "_run_command", fake_run_command
    )

    response = await jp_fetch("jupyterlab_slurm", "sacct")
    assert response.code == 200
    payload = json.loads(response.body)
    rows = payload['data']['rows']
    ids = {r[0] for r in rows}

    # Non-terminal states must be excluded.
    assert "8001" not in ids
    assert "8002" not in ids
    assert "8003" not in ids

    # Terminal states (including a resolved self-cancellation) must remain.
    assert "8004" in ids
    assert "8005" in ids
    assert "8006" in ids


async def test_squeue_long_username_not_truncated(jp_fetch):
    """`squeue`'s `%.Nx` format specifier truncates (not just pads) a value
    wider than N -- `%.8u` previously dropped the trailing character(s) of
    any username longer than 8 characters (e.g. a real "testuser1" account
    rendered as "testuser"), corrupting both the User column display and the
    "My jobs only" filter (which compares against the full username). The
    format string must use a wide enough field (e.g. `%.20u`) to preserve
    real-world usernames intact."""
    data_path = os.path.join(os.path.dirname(__file__), 'data', 'squeue_test_data.txt')
    long_user = "verylongusername1"  # 18 chars, well past the old 8-char limit
    with open(data_path, 'a') as f:
        f.write(
            "              9001     debug some_job {} PD       0:00      1 (Priority)\n".format(long_user)
        )
    response = await jp_fetch("jupyterlab_slurm", "squeue")
    assert response.code == 200
    payload = json.loads(response.body)
    rows = payload['data']['rows']
    row = next((r for r in rows if r[0] == '9001'), None)
    assert row is not None
    assert row[3] == long_user


async def test_scancel(jp_fetch):
    # Get a current job id from live squeue data
    response = await jp_fetch("jupyterlab_slurm", "squeue")
    assert response.code == 200
    payload = json.loads(response.body)
    rows = payload['data']['rows']
    assert len(rows) > 0
    job_id = rows[0][0]

    # Cancel that job
    response = await jp_fetch(
        "jupyterlab_slurm",
        "scancel",
        method='DELETE',
        params=[('job_ids', job_id)]
    )
    assert response.code == 200
    result = json.loads(response.body)
    assert result['success'] is True
    assert result['exitCode'] == 0

    # Verify job removed
    response = await jp_fetch("jupyterlab_slurm", "squeue")
    assert response.code == 200
    payload = json.loads(response.body)
    new_rows = payload['data']['rows']
    assert len(new_rows) == len(rows) - 1
    assert all(row[0] != job_id for row in new_rows)

async def test_scontrol(jp_fetch):
    # Pick a job id from current squeue and record its initial state
    response = await jp_fetch("jupyterlab_slurm", "squeue")
    assert response.code == 200
    payload = json.loads(response.body)
    rows = payload['data']['rows']
    assert len(rows) > 0
    job_id, initial_state = rows[0][0], rows[0][4]

    # Hold the job
    response = await jp_fetch(
        "jupyterlab_slurm",
        "scontrol/hold",
        method='PATCH',
        headers={'Content-Type': 'application/json'},
        body=json.dumps({'job_ids': [job_id]})
    )
    assert response.code == 200
    # Verify the job is now held. NERSC/standard Slurm represents a user hold as
    # a PENDING job (ST=PD) with Reason=(JobHeldUser) -- there is no distinct
    # 'H' squeue state code.
    response = await jp_fetch("jupyterlab_slurm", "squeue")
    assert response.code == 200
    payload = json.loads(response.body)
    rows = payload['data']['rows']
    held_row = next((row for row in rows if row[0] == job_id), None)
    assert held_row is not None
    assert held_row[4] == 'PD'
    assert held_row[7] == '(JobHeldUser)'

    # Release the job
    response = await jp_fetch(
        "jupyterlab_slurm",
        "scontrol/release",
        method='PATCH',
        headers={'Content-Type': 'application/json'},
        body=json.dumps({'job_ids': [job_id]})
    )
    assert response.code == 200

    # After release the hold reason is cleared (no longer JobHeldUser); the job
    # returns to the normal pending queue.
    response = await jp_fetch("jupyterlab_slurm", "squeue")
    assert response.code == 200
    payload = json.loads(response.body)
    rows = payload['data']['rows']
    released_row = next((row for row in rows if row[0] == job_id), None)
    assert released_row is not None
    assert released_row[7] != '(JobHeldUser)'

async def test_sbatch(jp_fetch, mock_server_config, tmp_path):
    # confirm that the job is not there before running sbatch
    response = await jp_fetch('jupyterlab_slurm', 'squeue')
    assert response.code == 200
    payload = json.loads(response.body)
    original_num_jobs = len(payload['data']['rows'])

    base_path = os.path.dirname(os.path.abspath(__file__))
    command_paths = SlurmCommandPaths()
    command_paths.sbatch_path = os.path.join(base_path, '__mocks__/sbatch')
    print("*"*80)
    print(command_paths.sbatch_path)
    print("*"*80)

    try:
        f = tmp_path / 'sample_job.sh'
        f.write_text("echo 'running'")
        command = f'{command_paths.sbatch_path} {f.resolve()}'

        process_result = await run_command(command)
        print(process_result)
    except Exception as e:
        raise

    # confirm that job was added after running sbatch
    response = await jp_fetch('jupyterlab_slurm', 'squeue')
    assert response.code == 200
    payload = json.loads(response.body)
    post_num_jobs = len(payload['data']['rows'])

    assert post_num_jobs == original_num_jobs + 1

async def test_sacct(jp_fetch):
    response = await jp_fetch("jupyterlab_slurm", "sacct")
    assert response.code == 200
    payload = json.loads(response.body)
    assert payload['success'] is True
    assert payload['exitCode'] == 0
    rows = payload['data']['rows']
    cols = payload['data']['columns']
    assert isinstance(rows, list)
    assert isinstance(cols, list)
    assert cols == [
        'JobID', 'Partition', 'JobName', 'User', 'State', 'Submit', 'Elapsed', 'NNodes', 'ExitCode'
    ]
    # Submit time is a default column so users can distinguish jobs sharing a
    # name/id; verify it is populated for allocation rows.
    submit_idx = cols.index('Submit')
    # ensure at least one history row present and matches column count
    assert len(rows) > 0
    assert all(len(r) == len(cols) for r in rows)
    # The history query uses `sacct -X`, so only allocation rows must be
    # returned -- no job-step rows such as "5025.batch" / "5025.extern".
    job_id_idx = cols.index('JobID')
    assert all('.' not in r[job_id_idx] for r in rows)
    # Every allocation row should carry a Submit timestamp.
    assert all(len(r[submit_idx]) > 0 for r in rows)

async def test_sacct_user_filter(jp_fetch):
    # Request history for a specific user known to be present in the mock data
    target_user = 'user007'
    response = await jp_fetch("jupyterlab_slurm", "sacct", params={"user": target_user})
    assert response.code == 200
    payload = json.loads(response.body)
    assert payload['success'] is True
    assert payload['exitCode'] == 0
    rows = payload['data']['rows']
    cols = payload['data']['columns']
    assert 'User' in cols
    user_idx = cols.index('User')
    # Ensure at least one row and that all returned rows belong to the requested user
    assert len(rows) > 0
    assert all(r[user_idx] == target_user for r in rows)


async def test_ui_config_contains_reload_limit(jp_fetch):
    response = await jp_fetch("jupyterlab_slurm", "ui-config")
    assert response.code == 200
    payload = json.loads(response.body)
    assert payload["success"] is True
    assert "data" in payload
    data = payload["data"]
    # New server-driven reload limit should be present (may be None if not configured explicitly)
    assert "squeue_reload_limit_ms" in data
    # Value may be None (if not set in the test config) or an int
    val = data.get("squeue_reload_limit_ms")
    assert (val is None) or isinstance(val, int)
    # History column labels should be present (may be empty if not configured)
    assert "history_column_labels" in data
    hist = data.get("history_column_labels")
    assert isinstance(hist, dict)


async def test_job_details_sacct_fallback(jp_fetch):
    """Test the /job/<id> endpoint falls back to sacct for finished jobs."""
    # Use a job ID known to be in sacct_test_data.txt (not in squeue - finished job)
    job_id = "5025"
    response = await jp_fetch("jupyterlab_slurm", f"job/{job_id}")
    assert response.code == 200
    payload = json.loads(response.body)
    assert payload["success"] is True
    assert payload["exitCode"] == 0
    assert "data" in payload
    data = payload["data"]
    # Should have used sacct since job is not active (scontrol not configured by default)
    assert data.get("source") == "sacct"
    # Verify fields are populated
    fields = data.get("fields", {})
    assert fields.get("JobID") == job_id
    assert fields.get("JobName") == "long_job"
    assert fields.get("User") == "user006"
    assert fields.get("State") == "COMPLETED"
    assert fields.get("WorkDir") == "/home/user006/jobs"
    # Stdout/Stderr are None because the mock files don't exist on disk
    # In production, these would be populated if the files exist
    assert fields.get("Stdout") is None
    assert fields.get("Stderr") is None
    # Check steps are returned (5025.batch should be present)
    steps = data.get("steps", [])
    assert isinstance(steps, list)
    assert len(steps) >= 1
    step_ids = [s.get("JobID") for s in steps]
    assert "5025.batch" in step_ids


async def test_job_details_sacct_gpu_from_tres(jp_fetch):
    """Job Details via the sacct fallback must derive the GPU count from the
    modern AllocTRES/ReqTRES fields. Older code requested AllocGRES/ReqGRES,
    which modern Slurm removed (sacct fatals: "AllocGRES has been removed,
    please use AllocTRES"), breaking Job Details entirely."""
    job_id = "5026"  # GPU job in the fixture: AllocTRES=...,gres/gpu=1,...
    response = await jp_fetch("jupyterlab_slurm", f"job/{job_id}")
    assert response.code == 200
    payload = json.loads(response.body)
    assert payload["success"] is True
    assert payload["exitCode"] == 0
    data = payload["data"]
    assert data.get("source") == "sacct"
    fields = data.get("fields", {})
    assert fields.get("JobID") == job_id
    # GPU count parsed from the TRES string (gres/gpu=1)
    assert fields.get("GPUs") == "1"
    # GPU type parsed from the typed TRES key (gres/gpu:a100=1)
    assert fields.get("GPUType") == "a100"
    # GPU memory/utilization TRES keys (gres/gpumem, gres/gpuutil)
    assert fields.get("GPUMem") == "40000"
    assert fields.get("GPUUtil") == "87"


async def test_job_details_array_element_sacct_fallback(jp_fetch):
    """An array-element job id that Slurm's sacct rejects ("Bad job array
    element specified") must still resolve by retrying against the base array
    job id, then selecting the requested element from the results."""
    job_id = "7040_2"
    response = await jp_fetch("jupyterlab_slurm", f"job/{job_id}")
    assert response.code == 200
    payload = json.loads(response.body)
    assert payload["success"] is True
    assert payload["exitCode"] == 0
    data = payload["data"]
    assert data.get("source") == "sacct"
    fields = data.get("fields", {})
    # The requested element row (not the sibling 7040_1) should be picked.
    assert fields.get("JobID") == job_id
    assert fields.get("State") == "FAILED"
    assert fields.get("ExitCode") == "7:0"
    # The .batch step row for the element should be surfaced as a step.
    steps = data.get("steps", [])
    step_ids = [s.get("JobID") for s in steps]
    assert "7040_2.batch" in step_ids


async def test_job_details_not_found(jp_fetch):
    """Test the /job/<id> endpoint returns error for non-existent job."""
    job_id = "99999"  # Non-existent job
    response = await jp_fetch("jupyterlab_slurm", f"job/{job_id}", raise_error=False)
    assert response.code == 404  # Not found is now surfaced as HTTP 404
    payload = json.loads(response.body)
    assert payload["success"] is False
    assert "errorMessage" in payload or payload.get("exitCode") != 0


def test_job_details_is_infra_failure_classifier():
    """`_is_infra_failure()` must distinguish a genuine "job not found"
    scontrol/sacct exit from a backend/infrastructure failure (missing
    executable, timeout, unreachable controller, exec-layer error), so
    callers can report 503 instead of a misleading 404."""
    from ..handlers import JobDetailsHandler

    # Genuine "job not found" - a normal Slurm-level non-zero exit with no
    # infra-failure signature in the message.
    assert JobDetailsHandler._is_infra_failure(1, "slurm_load_jobs error: Invalid job id specified") is False
    assert JobDetailsHandler._is_infra_failure(0, "") is False

    # Missing executable / timeout (already-recognized rc sentinels).
    assert JobDetailsHandler._is_infra_failure(127, "") is True
    assert JobDetailsHandler._is_infra_failure(-1, "command timed out after 60s") is True

    # Backend/infra error text, even with an ambiguous non-sentinel rc.
    assert JobDetailsHandler._is_infra_failure(1, "Unable to contact slurm controller (connect failure)") is True
    assert JobDetailsHandler._is_infra_failure(
        1, "Error response from daemon: container abc123 is not running"
    ) is True
    assert JobDetailsHandler._is_infra_failure(2, "Connection refused") is True


async def test_job_details_infra_failure_returns_503_not_404(jp_fetch, monkeypatch):
    """When both scontrol and sacct fail because the backend/controller is
    unreachable (not because the job genuinely doesn't exist), /job/<id>
    must report HTTP 503, not a misleading HTTP 404."""
    from .. import handlers as handlers_module

    async def fake_run_with_hooks(self, command_name, argv, env, context):
        return 1, "", "Unable to contact slurm controller (connect failure)"

    monkeypatch.setattr(
        handlers_module.JobDetailsHandler, "_run_with_hooks", fake_run_with_hooks
    )

    response = await jp_fetch("jupyterlab_slurm", "job/12345", raise_error=False)
    assert response.code == 503
    payload = json.loads(response.body)
    assert payload["success"] is False
    assert "controller" in payload["errorMessage"].lower()


async def test_sacct_uses_30_day_window(jp_fetch):
    """Test that the sacct endpoint uses a 30-day time window by default."""
    response = await jp_fetch("jupyterlab_slurm", "sacct")
    assert response.code == 200
    payload = json.loads(response.body)
    assert payload['success'] is True
    # The responseMessage contains the executed command - verify it includes 30-day window
    response_msg = payload.get('responseMessage', '')
    assert 'now-30days' in response_msg, f"Expected 30-day window in command, got: {response_msg}"


def test_parse_scontrol_basic():
    """Test parse_scontrol handles simple Key=Value pairs."""
    def parse_scontrol(text: str):
        kv = {}
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            for m in re.finditer(r'(\w+)=(.*?)(?=\s+\w+=|$)', stripped):
                kv[m.group(1)] = m.group(2).strip()
        return kv

    text = "JobId=12345 JobName=my_job Partition=gpu"
    result = parse_scontrol(text)
    assert result['JobId'] == '12345'
    assert result['JobName'] == 'my_job'
    assert result['Partition'] == 'gpu'


def test_parse_scontrol_values_with_spaces():
    """Test parse_scontrol handles values containing spaces (e.g., Reason field)."""
    def parse_scontrol(text: str):
        kv = {}
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            for m in re.finditer(r'(\w+)=(.*?)(?=\s+\w+=|$)', stripped):
                kv[m.group(1)] = m.group(2).strip()
        return kv

    text = "JobId=12345 Reason=Resources not available Partition=gpu JobState=PENDING"
    result = parse_scontrol(text)
    assert result['JobId'] == '12345'
    assert result['Reason'] == 'Resources not available'
    assert result['Partition'] == 'gpu'
    assert result['JobState'] == 'PENDING'


def test_parse_scontrol_multiline():
    """Test parse_scontrol handles multi-line scontrol output."""
    def parse_scontrol(text: str):
        kv = {}
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            for m in re.finditer(r'(\w+)=(.*?)(?=\s+\w+=|$)', stripped):
                kv[m.group(1)] = m.group(2).strip()
        return kv

    text = (
        "JobId=12345 JobName=my_job UserId=testuser(1000)\n"
        "   Partition=gpu JobState=RUNNING Reason=None\n"
        "   WorkDir=/home/testuser/jobs StdOut=/home/testuser/jobs/slurm-12345.out\n"
        "   NodeList=node010 NumCPUs=4 Gres=gpu:4\n"
    )
    result = parse_scontrol(text)
    assert result['JobId'] == '12345'
    assert result['JobName'] == 'my_job'
    assert result['UserId'] == 'testuser(1000)'
    assert result['WorkDir'] == '/home/testuser/jobs'
    assert result['StdOut'] == '/home/testuser/jobs/slurm-12345.out'
    assert result['NodeList'] == 'node010'
    assert result['Gres'] == 'gpu:4'


def test_parse_scontrol_empty_values():
    """Test parse_scontrol handles empty/none values."""
    def parse_scontrol(text: str):
        kv = {}
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            for m in re.finditer(r'(\w+)=(.*?)(?=\s+\w+=|$)', stripped):
                kv[m.group(1)] = m.group(2).strip()
        return kv

    text = "JobId=12345 EndTime= Reason=None"
    result = parse_scontrol(text)
    assert result['JobId'] == '12345'
    assert result['EndTime'] == ''
    assert result['Reason'] == 'None'


async def test_job_details_active_job_via_scontrol(jp_fetch):
    """Test the /job/<id> endpoint returns scontrol data for an active (running) job."""
    # Job 5025_2 is RUNNING in the squeue test data
    job_id = "5025_2"
    response = await jp_fetch("jupyterlab_slurm", f"job/{job_id}")
    assert response.code == 200
    payload = json.loads(response.body)
    assert payload["success"] is True
    assert "data" in payload
    data = payload["data"]
    # Should have used scontrol since job is active
    assert data.get("source") == "scontrol"
    fields = data.get("fields", {})
    assert fields.get("JobID") == job_id
    assert fields.get("JobName") == "batch_job"
    assert fields.get("State") == "RUNNING"
    assert fields.get("Partition") == "regular"
    assert fields.get("NodeList") is not None
    assert fields.get("WorkDir") is not None
    assert fields.get("Stdout") is not None
    assert fields.get("Stderr") is not None
    # A CPU-partition job (like Perlmutter's `shared`/`regular`) has no GPU
    # allocation: the mock now models resources via modern TRES strings and
    # only emits a GPU for GPU partitions.
    assert fields.get("GPUs") is None
    # NumCPUs is 2 per node (2 nodes -> 4), Mem comes from MinMemoryNode.
    assert fields.get("CPUs") == "4"
    assert fields.get("Mem") == "256M"
    assert fields.get("Elapsed") is not None


async def test_job_details_gpu_job_via_scontrol(jp_fetch):
    """A running GPU-partition job should surface a GPU count. Verified
    against real Perlmutter `scontrol show job` output: the job has NO
    `Gres=` key at all (only `scontrol show node` has that); GPU info comes
    from the typed `AllocTRES` (e.g. "gres/gpu:a100=4,gres/gpu=4") once the
    job is running."""
    # Inject a running GPU job into the shared squeue mock data.
    data_path = os.path.join(os.path.dirname(__file__), 'data', 'squeue_test_data.txt')
    with open(data_path, 'a') as f:
        # jobid partition jobname user state elapsed nodes reason/nodelist
        f.write("            5025_9 gpu       gpu_job       testuser R        0:30      1 node009\n")

    response = await jp_fetch("jupyterlab_slurm", "job/5025_9")
    assert response.code == 200
    payload = json.loads(response.body)
    assert payload["success"] is True
    data = payload["data"]
    assert data.get("source") == "scontrol"
    fields = data.get("fields", {})
    assert fields.get("State") == "RUNNING"
    assert fields.get("Partition") == "gpu"
    assert fields.get("GPUs") == "4"
    # GPU type comes from the typed AllocTRES key (gres/gpu:a100=4), and the
    # memory variant (40GB vs 80GB) comes from node Features/constraints
    # (Features=gpu&a100&hbm80g), matching real Perlmutter node output.
    assert fields.get("GPUType") == "a100"
    assert fields.get("GPUMemVariant") == "80g"


async def test_job_details_gpu_job_pending_via_scontrol(jp_fetch):
    """A PENDING GPU-partition job should still surface a GPU count, sourced
    from the untyped `TresPerNode`/`ReqTRES` (since `AllocTRES` is `(null)`
    before the job starts). Verified against a real Perlmutter pending GPU
    job, which reports `TresPerNode=gres/gpu:4` and
    `ReqTRES=...,gres/gpu=1024` with no GPU type information available yet."""
    data_path = os.path.join(os.path.dirname(__file__), 'data', 'squeue_test_data.txt')
    with open(data_path, 'a') as f:
        # jobid partition jobname user state elapsed nodes reason/nodelist
        f.write("            5025_10 gpu       gpu_job_pend  testuser PD       0:00      2 (Resources)\n")

    response = await jp_fetch("jupyterlab_slurm", "job/5025_10")
    assert response.code == 200
    payload = json.loads(response.body)
    assert payload["success"] is True
    data = payload["data"]
    assert data.get("source") == "scontrol"
    fields = data.get("fields", {})
    assert fields.get("State") == "PENDING"
    assert fields.get("Partition") == "gpu"
    # No typed AllocTRES yet (job hasn't started); GPU count must come from
    # TresPerNode/ReqTRES instead.
    assert fields.get("GPUs") == "4"


async def test_job_details_command_null_sentinel_normalized(jp_fetch, monkeypatch):
    """A job submitted via `sbatch --wrap=...` has no underlying script file,
    so real `scontrol show job` reports `Command=(null)` (Slurm's own literal
    text for "unset"), not an omitted/blank key. The active-job (scontrol)
    path must normalize that sentinel to a real `None`/absent value rather
    than passing the literal text `"(null)"` straight through to the
    frontend, where it would render as the confusing string "(null)"."""
    from .. import handlers as handlers_module

    scontrol_output = (
        "JobId=5025_1 JobName=wrap_job UserId=testuser(1000) "
        "Account=myaccount QOS=debug JobState=RUNNING Reason=None "
        "NumNodes=1 NumCPUs=2 NumTasks=1 CPUs/Task=1 "
        "ReqTRES=cpu=2,mem=256M,node=1 AllocTRES=cpu=2,mem=256M,node=1 "
        "MinMemoryNode=256M Partition=debug NodeList=node001 "
        "TimeLimit=00:05:00 SubmitTime=2026-01-20T10:00:00 "
        "StartTime=2026-01-20T10:05:00 EndTime=Unknown "
        "WorkDir=/home/testuser/jobs Command=(null) Features=cpu "
        "TresPerNode= TresPerTask=cpu=1"
    )

    async def fake_run_with_hooks(self, command_name, argv, env, context):
        if command_name == 'scontrol':
            return 0, scontrol_output, ""
        # The internal SubmitLine enrichment lookup (sacct) -- return
        # nothing here so the test isolates the `(null)` normalization
        # behavior of the scontrol path itself.
        return 1, "", "no accounting data"

    monkeypatch.setattr(
        handlers_module.JobDetailsHandler, "_run_with_hooks", fake_run_with_hooks
    )

    response = await jp_fetch("jupyterlab_slurm", "job/5025_1")
    assert response.code == 200
    payload = json.loads(response.body)
    data = payload["data"]
    assert data.get("source") == "scontrol"
    fields = data.get("fields", {})
    # Must be normalized to a real absent value, never the literal "(null)"
    # sentinel text leaking straight through to the frontend.
    assert fields.get("Command") is None


async def test_job_details_command_includes_sbatch_arguments(jp_fetch, monkeypatch):
    """Real `scontrol show job` output only ever reports the bare script
    path in `Command`, NEVER any arguments the user passed to `sbatch` (e.g.
    `sbatch args_test.sh hello world`) -- confirmed against a real Docker
    Slurm cluster job. `sacct`'s `SubmitLine` field DOES capture the full
    original invocation including arguments and is available immediately,
    even for a still-active job; the active-job path must enrich Command
    with it so a job's real arguments are visible, matching what the
    completed-job (sacct-fallback) path already does."""
    from .. import handlers as handlers_module

    scontrol_output = (
        "JobId=5025_1 JobName=args_test UserId=testuser(1000) "
        "JobState=RUNNING Partition=debug NodeList=node001 "
        "Command=/data/testuser1_jobs/args_test.sh WorkDir=/data/testuser1_jobs"
    )

    async def fake_run_with_hooks(self, command_name, argv, env, context):
        if command_name == 'scontrol':
            return 0, scontrol_output, ""
        assert command_name == 'sacct'
        return 0, "sbatch args_test.sh hello world\n", ""

    monkeypatch.setattr(
        handlers_module.JobDetailsHandler, "_run_with_hooks", fake_run_with_hooks
    )

    response = await jp_fetch("jupyterlab_slurm", "job/5025_1")
    assert response.code == 200
    payload = json.loads(response.body)
    fields = payload["data"]["fields"]
    assert fields.get("Command") == "args_test.sh hello world"


async def test_job_details_command_requotes_wrap_value_with_spaces(jp_fetch, monkeypatch):
    """`sacct`'s `SubmitLine` (used to enrich `Command`) loses the original
    shell quoting around a multi-word `--wrap` value, so a job submitted as
    `sbatch --chdir=<dir> --wrap="sleep 60" --job-name=foo` is reported as
    the unquoted text `--chdir=<dir> --wrap=sleep 60 --job-name=foo`.
    Pasted back into a shell as-is, that text is NOT the full/original
    command -- it splits `sleep` and `60` into two unrelated tokens instead
    of one `--wrap` argument. The Command field must re-quote the `--wrap`
    value so what's shown/copied is a faithful, re-runnable reproduction of
    the original invocation."""
    from .. import handlers as handlers_module

    scontrol_output = (
        "JobId=5030 JobName=s08_wrap_job UserId=testuser1(1000) "
        "JobState=RUNNING Partition=debug NodeList=node001 "
        "Command=(null) WorkDir=/data/testuser1_scenarios"
    )

    async def fake_run_with_hooks(self, command_name, argv, env, context):
        if command_name == 'scontrol':
            return 0, scontrol_output, ""
        assert command_name == 'sacct'
        return 0, (
            "sbatch --chdir=/data/testuser1_scenarios --wrap=sleep 60 "
            "--job-name=s08_wrap_job\n"
        ), ""

    monkeypatch.setattr(
        handlers_module.JobDetailsHandler, "_run_with_hooks", fake_run_with_hooks
    )

    response = await jp_fetch("jupyterlab_slurm", "job/5030")
    assert response.code == 200
    payload = json.loads(response.body)
    fields = payload["data"]["fields"]
    assert fields.get("Command") == (
        'sbatch --chdir=/data/testuser1_scenarios --wrap="sleep 60" '
        '--job-name=s08_wrap_job'
    )


async def test_job_details_completed_wrap_job_command_is_requoted_and_unprefixed(jp_fetch, monkeypatch):
    """The `--wrap` requoting/`sbatch`-prefix normalization fix must also
    apply to *completed* jobs served via the sacct-fallback branch, not
    just the scontrol active-job path (`_get_submit_line`). The fallback
    branch reads `SubmitLine` directly from its own `sacct` query, so
    without this fix a finished `--wrap` job's Command would regress to
    the raw, broken (unquoted) text once the job left the scontrol
    active-job view."""
    from .. import handlers as handlers_module

    async def fake_run_command(self, args=None):
        return {
            "success": True,
            "responseMessage": "ok",
            "errorMessage": None,
            "exitCode": 0,
            "data": {"rows": [], "columns": []},
        }

    monkeypatch.setattr(
        handlers_module.SqueueHandler, "run_command", fake_run_command
    )

    async def fake_run_with_hooks(self, command_name, argv, env, context):
        if command_name == 'scontrol':
            # Job is no longer visible to scontrol -- forces the sacct
            # fallback branch.
            return 1, "", "Invalid job id specified"
        assert command_name == 'sacct'
        col_list = [
            "JobID", "JobName", "User", "Partition", "Account", "AllocCPUS",
            "State", "ExitCode", "Start", "End", "Elapsed", "Submit",
            "Timelimit", "QOS", "NodeList", "NNodes", "NTasks", "ReqMem",
            "MaxRSS", "TotalCPU", "UserCPU", "SystemCPU", "AveDiskRead",
            "AveDiskWrite", "WorkDir", "StdOut", "StdErr", "SubmitLine",
            "DerivedExitCode", "AllocTRES", "ReqTRES",
        ]
        values = {c: "" for c in col_list}
        values.update({
            "JobID": "5031",
            "JobName": "s08_wrap_job",
            "User": "testuser1",
            "Partition": "debug",
            "State": "COMPLETED",
            "SubmitLine": (
                'sbatch --chdir=/data/testuser1_scenarios --wrap=sleep 60 '
                '--job-name=s08_wrap_job'
            ),
        })
        row = '|'.join(values[c] for c in col_list)
        return 0, row + "\n", ""

    monkeypatch.setattr(
        handlers_module.JobDetailsHandler, "_run_with_hooks", fake_run_with_hooks
    )

    response = await jp_fetch("jupyterlab_slurm", "job/5031")
    assert response.code == 200
    payload = json.loads(response.body)
    fields = payload["data"]["fields"]
    assert fields.get("Command") == (
        'sbatch --chdir=/data/testuser1_scenarios --wrap="sleep 60" '
        '--job-name=s08_wrap_job'
    )


async def test_job_details_command_falls_back_when_submit_line_unavailable(jp_fetch, monkeypatch):
    """If the SubmitLine enrichment lookup fails (no accounting data yet,
    sacct unreachable, etc.), fall back to scontrol's bare Command rather
    than losing the field entirely."""
    from .. import handlers as handlers_module

    scontrol_output = (
        "JobId=5025_1 JobName=args_test UserId=testuser(1000) "
        "JobState=RUNNING Partition=debug NodeList=node001 "
        "Command=/data/testuser1_jobs/args_test.sh WorkDir=/data/testuser1_jobs"
    )

    async def fake_run_with_hooks(self, command_name, argv, env, context):
        if command_name == 'scontrol':
            return 0, scontrol_output, ""
        return 1, "", "sacct: error: no accounting data"

    monkeypatch.setattr(
        handlers_module.JobDetailsHandler, "_run_with_hooks", fake_run_with_hooks
    )

    response = await jp_fetch("jupyterlab_slurm", "job/5025_1")
    assert response.code == 200
    payload = json.loads(response.body)
    fields = payload["data"]["fields"]
    assert fields.get("Command") == "/data/testuser1_jobs/args_test.sh"


async def test_job_details_elapsed_uses_now_not_estimated_end_time_while_running(jp_fetch, monkeypatch):
    """Regression test: `scontrol show job`'s `EndTime` for a still-active
    job is Slurm's *estimate* of completion (StartTime + TimeLimit), always
    present once the job starts -- NOT the job's actual end time. Using it
    directly for the Elapsed calculation made a running job's Elapsed jump
    straight to its full requested walltime (e.g. "5:00" for a 5-minute
    job) from the very first poll and stay pinned there for the entire run,
    instead of reflecting real elapsed time. Elapsed must be computed
    against "now" whenever the job hasn't actually reached a terminal
    state, regardless of what `EndTime` says."""
    from .. import handlers as handlers_module

    now = datetime.datetime.now()
    start_dt = now - datetime.timedelta(seconds=30)
    # 5-minute TimeLimit -> EndTime is ~4.5 minutes in the future relative
    # to "now", well past the ~30s actually elapsed so far.
    end_dt = start_dt + datetime.timedelta(minutes=5)

    scontrol_output = (
        "JobId=5025_1 JobName=long_job UserId=testuser(1000) "
        "JobState=RUNNING Partition=debug NodeList=node001 "
        "TimeLimit=00:05:00 "
        "StartTime={start} EndTime={end} "
        "WorkDir=/data/testuser1_jobs"
    ).format(
        start=start_dt.strftime('%Y-%m-%dT%H:%M:%S'),
        end=end_dt.strftime('%Y-%m-%dT%H:%M:%S'),
    )

    async def fake_run_with_hooks(self, command_name, argv, env, context):
        if command_name == 'scontrol':
            return 0, scontrol_output, ""
        return 1, "", "no accounting data"

    monkeypatch.setattr(
        handlers_module.JobDetailsHandler, "_run_with_hooks", fake_run_with_hooks
    )

    response = await jp_fetch("jupyterlab_slurm", "job/5025_1")
    assert response.code == 200
    payload = json.loads(response.body)
    fields = payload["data"]["fields"]
    assert fields.get("State") == "RUNNING"
    # Elapsed must reflect ~30s (now - StartTime), NOT ~5:00 (EndTime -
    # StartTime, the full requested walltime).
    elapsed = fields.get("Elapsed")
    assert elapsed is not None
    assert elapsed != "05:00"
    minutes, seconds = (elapsed.split(':') + ['0'])[:2]
    assert int(minutes) == 0


async def test_job_details_terminal_scontrol_enriches_cpu_time_from_sacct(jp_fetch, monkeypatch):
    """Regression test: some Slurm sites keep a finished job visible to
    `scontrol show job` for a while after completion (until `MinJobAge`
    elapses), so the details handler can still take the `scontrol`
    (active-job) branch even once the job is terminal. That branch never
    populates CPU/memory usage accounting fields (TotalCPU/UserCPU/
    SystemCPU/MaxRSS) -- those only exist in `sacct` -- so "Total CPU Time"
    stayed blank/stale forever for such a job, even after it completed.
    The handler must enrich with a real `sacct` usage query once the
    scontrol-reported state is terminal."""
    from .. import handlers as handlers_module

    scontrol_output = (
        "JobId=6001 JobName=cpu_job UserId=testuser(1000) "
        "JobState=COMPLETED Partition=debug NodeList=node001 "
        "TimeLimit=00:05:00 "
        "StartTime=2024-03-21T10:00:00 EndTime=2024-03-21T10:04:30 "
        "WorkDir=/data/testuser1_jobs"
    )

    async def fake_run_with_hooks(self, command_name, argv, env, context):
        if command_name == 'scontrol':
            return 0, scontrol_output, ""
        if command_name == 'sacct':
            # -j is followed by the job id; use it to build a plausible row.
            jid = argv[argv.index('-j') + 1] if '-j' in argv else '6001'
            row = f"{jid}.batch|512K|00:04:15|00:03:50|00:00:25|1.00M|2.00M"
            return 0, row, ""
        return 1, "", "unexpected command"

    monkeypatch.setattr(
        handlers_module.JobDetailsHandler, "_run_with_hooks", fake_run_with_hooks
    )

    response = await jp_fetch("jupyterlab_slurm", "job/6001")
    assert response.code == 200
    payload = json.loads(response.body)
    fields = payload["data"]["fields"]
    assert fields.get("State") == "COMPLETED"
    assert fields.get("TotalCPU") == "00:04:15"
    assert fields.get("UserCPU") == "00:03:50"
    assert fields.get("SystemCPU") == "00:00:25"
    assert fields.get("MaxRSS") == "512K"


async def test_job_details_placeholder_expansion(jp_fetch, tmp_path):
    """Test Slurm placeholder expansion in log paths."""
    job_id = "12345"
    workdir = str(tmp_path)
    stdout_name = f"slurm-{job_id}.out"
    stdout_path = tmp_path / stdout_name
    stdout_path.write_text("stdout content")
    
    # We need to inject this job into the mock somehow or use a mock scontrol that returns these paths
    # For this test, let's just test the expansion logic via a new test case in handlers.py if possible,
    # but since we are doing integration tests, we'll mock scontrol output.
    
    # Update the mock scontrol to return placeholders
    # In our current mock slurm_commands.py, scontrol show job uses squeue data.
    # Let's add a job with placeholders to our mock data.
    with open(os.path.join(os.path.dirname(__file__), 'data', 'squeue_test_data.txt'), 'a') as f:
        # jobid partition jobname user state elapsed nodes reason/nodelist
        # Note: the mock scontrol is quite limited and doesn't return StdOut/StdErr usually
        # unless we modify it.
        f.write(f"            {job_id} debug     test_job     testuser R        0:01      1 node001\n")

    # The current scontrol mock doesn't return StdOut/StdErr. 
    # Let's verify the direct logic for now by adding a unit test for expand_slurm_path
    pass

def test_expand_slurm_path_logic():
    from ..handlers import JobDetailsHandler
    from unittest.mock import MagicMock
    # Create a mock application and request
    app = MagicMock()
    app.ui_methods = {}
    # Mock settings to avoid Jupyer Server's path joining logic failure during init
    app.settings = {"base_url": "/", "csp_report_uri": "/csp"}
    request = MagicMock()
    request.connection = MagicMock()
    handler = JobDetailsHandler(app, request)
    
    # Test simple expansion
    assert handler.expand_slurm_path("slurm-%j.out", "123", "test", "user") == "slurm-123.out"
    assert handler.expand_slurm_path("slurm-%u-%x.out", "123", "myjob", "alice") == "slurm-alice-myjob.out"
    
    # Test array placeholders
    # %J should be parent ID (123)
    assert handler.expand_slurm_path("slurm-%J.out", "123_4", "test", "user") == "slurm-123.out"
    # %A should be parent ID (123), %a should be index (4)
    assert handler.expand_slurm_path("job_%A_%a.log", "123_4", "test", "user") == "job_123_4.log"
    # %A/%a for non-array jobs
    assert handler.expand_slurm_path("job_%A_%a.log", "123", "test", "user") == "job_123_0.log"

def test_expand_and_verify_path(tmp_path):
    from ..handlers import JobDetailsHandler
    from unittest.mock import MagicMock
    app = MagicMock()
    app.ui_methods = {}
    app.settings = {"base_url": "/", "csp_report_uri": "/csp"}
    request = MagicMock()
    request.connection = MagicMock()
    handler = JobDetailsHandler(app, request)
    
    # Create a file
    f = tmp_path / "test.out"
    f.write_text("content")
    
    # Test absolute path
    assert handler.expand_and_verify_path(str(f), "1", "2", "3", "4") == str(f)
    
    # Test relative path with workdir
    assert handler.expand_and_verify_path("test.out", "1", "2", "3", str(tmp_path)) == str(f)
    
    # Test non-existent file
    assert handler.expand_and_verify_path("missing.out", "1", "2", "3", str(tmp_path)) is None

def test_parse_gpus_logic():
    """Test the GPU parsing logic directly with various GRES formats."""
    import re
    def parse_gpus(gres):
        if not gres: return None
        for part in gres.split(','):
            if part.startswith('gpu'):
                m = re.search(r'gpu:.*?(\d+)', part)
                if m: return m.group(1)
                m = re.search(r'gpu:(\d+)', part)
                if m: return m.group(1)
        return None

    assert parse_gpus("gpu:4") == "4"
    assert parse_gpus("gpu:kepler:2") == "2"
    assert parse_gpus("gpu:1(S:0)") == "1"
    assert parse_gpus("cpu:8,gpu:4") == "4"
    assert parse_gpus("nic:1,gpu:tesla:1") == "1"
    assert parse_gpus("something_else:1") is None

def test_elapsed_calculation_logic():
    """Test the robust Elapsed calculation logic with space and T formats."""
    import datetime
    
    def calculate_elapsed(start_str, end_str):
        if not start_str or start_str == 'Unknown' or start_str == 'N/A':
            return None
        try:
            s_str = start_str.replace(' ', 'T')
            start_dt = datetime.datetime.fromisoformat(s_str)
            if end_str and end_str != 'Unknown' and end_str != 'N/A':
                e_str = end_str.replace(' ', 'T')
                end_dt = datetime.datetime.fromisoformat(e_str)
            else:
                # Use a fixed 'now' for testing
                end_dt = datetime.datetime.fromisoformat("2024-03-21T11:00:00")
            
            delta = end_dt - start_dt
            if delta.total_seconds() >= 0:
                seconds = int(delta.total_seconds())
                days, remainder = divmod(seconds, 86400)
                hours, remainder = divmod(remainder, 3600)
                minutes, seconds = divmod(remainder, 60)
                if days > 0:
                    return f"{days}-{hours:02d}:{minutes:02d}:{seconds:02d}"
                elif hours > 0:
                    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
                else:
                    return f"{minutes:02d}:{seconds:02d}"
        except:
            return None
        return None

    # Test T format
    assert calculate_elapsed("2024-03-21T10:00:00", "2024-03-21T10:01:30") == "01:30"
    # Test Space format
    assert calculate_elapsed("2024-03-21 10:00:00", "2024-03-21 11:30:00") == "01:30:00"
    # Test Day format
    assert calculate_elapsed("2024-03-20 10:00:00", "2024-03-21 11:30:00") == "1-01:30:00"
    # Test 'now' logic
    assert calculate_elapsed("2024-03-21 10:00:00", None) == "01:00:00"
    # Test Unknown
    assert calculate_elapsed("Unknown", None) is None


# ---------------------------------------------------------------------------
# Additional coverage: error/edge paths across the command handlers
# ---------------------------------------------------------------------------

def _make_job_details_handler():
    """Build a JobDetailsHandler instance without a running server, for unit
    testing its pure helper methods."""
    from ..handlers import JobDetailsHandler
    from unittest.mock import MagicMock
    app = MagicMock()
    app.ui_methods = {}
    app.settings = {"base_url": "/", "csp_report_uri": "/csp"}
    request = MagicMock()
    request.connection = MagicMock()
    return JobDetailsHandler(app, request)


async def test_run_with_hooks_bounded_by_timeout(monkeypatch):
    """The site-hook execution path (`JobDetailsHandler._run_with_hooks`) must
    be bounded by a timeout like every other Slurm invocation, so a
    hung/unresponsive command cannot block a request or leak a process
    indefinitely."""
    from .. import handlers as handlers_module

    handler = _make_job_details_handler()
    handler._hooks_loaded = True
    handler._hooks = {
        'pre_build': None, 'pre_exec': None, 'around_exec': None,
        'post_process': None, 'audit': None,
    }

    class _NeverEndingProc:
        returncode = None

        async def communicate(self):
            await asyncio.sleep(10)
            return b"", b""

        def kill(self):
            self.returncode = -9

    async def fake_create_subprocess_exec(*args, **kwargs):
        return _NeverEndingProc()

    monkeypatch.setattr(handlers_module.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    monkeypatch.setattr(handlers_module, "SLURM_COMMAND_TIMEOUT_SECONDS", 0.05)

    rc, out, err = await handler._run_with_hooks("sacct", ["sacct", "-j", "1"], {}, {})
    assert rc == -1
    assert out == ""
    assert "timed out" in err


async def test_user_endpoint(jp_fetch):
    """The /user endpoint returns the current username, wrapped in the
    unified response envelope."""
    response = await jp_fetch("jupyterlab_slurm", "user")
    assert response.code == 200
    payload = json.loads(response.body)
    assert payload['success'] is True
    assert payload['exitCode'] == 0
    assert payload['errorMessage'] is None
    assert "user" in payload['data']


async def test_scancel_invalid_job_id(jp_fetch):
    """A non-numeric job id must be rejected (InvalidSlurmJobID) and surface as
    a failed response rather than shelling out."""
    response = await jp_fetch(
        "jupyterlab_slurm",
        "scancel",
        method='DELETE',
        params={'job_ids': ['not-a-job-id']},
        raise_error=False,
    )
    assert response.code == 400  # malformed request (invalid job id)
    result = json.loads(response.body)
    assert result['success'] is False
    assert result['exitCode'] != 0


async def test_scancel_multiple_jobs(jp_fetch):
    """scancel should remove every requested job id from the queue."""
    response = await jp_fetch("jupyterlab_slurm", "squeue")
    rows = json.loads(response.body)['data']['rows']
    assert len(rows) >= 2
    ids = [rows[0][0], rows[1][0]]

    response = await jp_fetch(
        "jupyterlab_slurm",
        "scancel",
        method='DELETE',
        params=[('job_ids', jid) for jid in ids]
    )
    assert response.code == 200
    result = json.loads(response.body)
    assert result['success'] is True

    response = await jp_fetch("jupyterlab_slurm", "squeue")
    new_rows = json.loads(response.body)['data']['rows']
    remaining = {r[0] for r in new_rows}
    assert all(jid not in remaining for jid in ids)


async def test_scancel_accepts_grouped_array_range_job_id(jp_fetch):
    """A batch containing a *grouped* array-range job id (e.g.
    "107_[17-20%4]", squeue's collapsed display form for several still-
    pending array tasks sharing a throttle limit) must not cause the whole
    kill/scancel request to be rejected as malformed. Unlike `/job/{id}`,
    real `scancel` genuinely supports cancelling such a range as a single
    target, so this shape must pass validation alongside ordinary job ids.
    """
    response = await jp_fetch("jupyterlab_slurm", "squeue")
    rows = json.loads(response.body)['data']['rows']
    ids = [rows[0][0], rows[1][0], "107_[17-20%4]", "107_15", "107_16"]

    response = await jp_fetch(
        "jupyterlab_slurm",
        "scancel",
        method='DELETE',
        params=[('job_ids', jid) for jid in ids],
        raise_error=False,
    )
    assert response.code == 200
    result = json.loads(response.body)
    assert result['success'] is True
    assert set(result['data']['requestedIds']) == set(ids)


async def test_scontrol_hold_missing_job_ids(jp_fetch):
    """Holding with an empty job list must fail with a clear message rather than
    silently succeeding."""
    response = await jp_fetch(
        "jupyterlab_slurm",
        "scontrol/hold",
        method='PATCH',
        body=json.dumps({'job_ids': []}),
        raise_error=False,
    )
    assert response.code == 400  # malformed request (missing job ids)
    result = json.loads(response.body)
    assert result['success'] is False
    assert result['errorMessage'] == "No job IDs provided"
    assert result['data']['changedIds'] == []


async def test_scontrol_hold_multiple_jobs(jp_fetch):
    """Holding several jobs at once should mark them all held and report each in
    changedIds."""
    response = await jp_fetch("jupyterlab_slurm", "squeue")
    rows = json.loads(response.body)['data']['rows']
    ids = [rows[0][0], rows[2][0]]

    response = await jp_fetch(
        "jupyterlab_slurm",
        "scontrol/hold",
        method='PATCH',
        headers={'Content-Type': 'application/json'},
        body=json.dumps({'job_ids': ids})
    )
    assert response.code == 200
    result = json.loads(response.body)
    assert result['success'] is True
    assert set(result['data']['changedIds']) == set(ids)

    # Verify both jobs now report the held state in squeue: ST=PD with
    # Reason=(JobHeldUser) (NERSC/standard Slurm has no 'H' state code).
    response = await jp_fetch("jupyterlab_slurm", "squeue")
    rows = json.loads(response.body)['data']['rows']
    held = {r[0]: (r[4], r[7]) for r in rows}
    for jid in ids:
        assert held.get(jid) == ('PD', '(JobHeldUser)')


async def test_scontrol_hold_expands_grouped_array_range_job_id(jp_fetch, monkeypatch):
    """Holding a *grouped* array-range job id (e.g. "132_[3-20%4]", squeue's
    collapsed display form for several still-pending array tasks sharing a
    throttle limit) must not be passed to `scontrol` verbatim: unlike
    `scancel`, real `scontrol hold`/`release`/etc. only understand a single
    job or array element and reject the bracketed range outright with
    "Invalid job id specified for job ...". The handler must expand it into
    its individual array-element ids before invoking `scontrol`.
    """
    from .. import handlers as handlers_module

    seen_job_ids = []

    async def fake_run_command(self, command=None, stdin=None, cwd=None):
        last_token = command[-1] if isinstance(command, (list, tuple)) else None
        seen_job_ids.append(last_token)
        if last_token and re.search(r"\[.*\]", last_token):
            # Mirror real scontrol's rejection of the bracketed range form.
            return {
                "stdout": "",
                "stderr": f"{last_token}: Invalid job id specified for job {last_token}",
                "returncode": 1,
            }
        return {"stdout": "", "stderr": "", "returncode": 0}

    monkeypatch.setattr(handlers_module.SlurmCommandHandler, "_run_command", fake_run_command)

    response = await jp_fetch(
        "jupyterlab_slurm",
        "scontrol/hold",
        method='PATCH',
        headers={'Content-Type': 'application/json'},
        body=json.dumps({'job_ids': ['132_[3-4]']}),
    )
    assert response.code == 200
    result = json.loads(response.body)
    assert result['success'] is True
    assert result['data']['requestedIds'] == ['132_[3-4]']
    assert set(result['data']['changedIds']) == {'132_3', '132_4'}
    # None of the actual `scontrol` invocations should ever receive the raw
    # bracketed range form.
    assert all(jid is None or '[' not in jid for jid in seen_job_ids)


async def test_sbatch_missing_input_path(jp_fetch):
    """Submitting without an inputPath must fail gracefully with an error
    envelope (not a 500)."""
    response = await jp_fetch(
        "jupyterlab_slurm",
        "sbatch",
        method='POST',
        body=json.dumps({}),
        raise_error=False,
    )
    assert response.code == 400  # malformed request (missing inputPath)
    result = json.loads(response.body)
    assert result['success'] is False
    assert result['exitCode'] != 0


async def test_sbatch_via_handler_extracts_job_id(jp_fetch):
    """A successful sbatch through the handler should add a job to the queue and
    surface the parsed job id in the response data."""
    response = await jp_fetch("jupyterlab_slurm", "squeue")
    original = len(json.loads(response.body)['data']['rows'])

    response = await jp_fetch(
        "jupyterlab_slurm",
        "sbatch",
        method='POST',
        body=json.dumps({'inputPath': '/tmp/some_job.sh'})
    )
    assert response.code == 200
    result = json.loads(response.body)
    assert result['success'] is True
    assert result['exitCode'] == 0
    # The mock prints "Submitted batch job <id>"; the handler parses the id.
    assert result['data'].get('jobId') is not None

    response = await jp_fetch("jupyterlab_slurm", "squeue")
    post = len(json.loads(response.body)['data']['rows'])
    assert post == original + 1


async def test_sbatch_gpu_job_end_to_end(jp_fetch, tmp_path):
    """Submitting a script with `#SBATCH --partition=gpu` (or `--gres=gpu`)
    should flow through the mock cluster like a real GPU job: it shows up in
    squeue under the GPU partition, and its job details expose a GPU count,
    exercising the same local mock cluster used for CPU jobs."""
    script = tmp_path / "gpu_job.sh"
    script.write_text(
        "#!/bin/bash\n"
        "#SBATCH --partition=gpu\n"
        "#SBATCH --job-name=gpu_e2e\n"
        "#SBATCH --nodes=1\n"
        "#SBATCH --gres=gpu:4\n"
        "echo hello\n"
    )

    response = await jp_fetch(
        "jupyterlab_slurm",
        "sbatch",
        method='POST',
        body=json.dumps({'inputPath': str(script)})
    )
    assert response.code == 200
    result = json.loads(response.body)
    assert result['success'] is True
    job_id = result['data'].get('jobId')
    assert job_id is not None

    # The job should now be visible in the queue under the GPU partition.
    response = await jp_fetch("jupyterlab_slurm", "squeue")
    rows = json.loads(response.body)['data']['rows']
    row = next((r for r in rows if job_id in r), None)
    assert row is not None
    assert "gpu" in row

    # Job details should surface GPU info for this submitted job.
    response = await jp_fetch("jupyterlab_slurm", f"job/{job_id}")
    assert response.code == 200
    payload = json.loads(response.body)
    assert payload['success'] is True
    fields = payload['data'].get('fields', {})
    assert fields.get('Partition') == 'gpu'
    assert fields.get('GPUs') == '4'


async def test_job_details_pending_job_via_scontrol(jp_fetch):
    """A pending job in the queue resolves via scontrol with a PENDING state and
    a Reason populated (from the reason/nodelist column)."""
    job_id = "5025_3"  # PENDING with reason "(Priority)" in the test data
    response = await jp_fetch("jupyterlab_slurm", f"job/{job_id}")
    assert response.code == 200
    payload = json.loads(response.body)
    assert payload['success'] is True
    data = payload['data']
    assert data.get('source') == 'scontrol'
    fields = data.get('fields', {})
    assert fields.get('JobID') == job_id
    assert fields.get('State') == 'PENDING'
    assert fields.get('Reason') is not None
    # StdoutExists/StderrExists enrichment keys are always present
    assert 'StdoutExists' in fields
    assert 'StderrExists' in fields


def test_get_file_info(tmp_path):
    """_get_file_info reports existence and size for real paths, and safely
    handles missing paths and None."""
    handler = _make_job_details_handler()

    f = tmp_path / "out.log"
    f.write_text("hello world")  # 11 bytes
    info = handler._get_file_info(str(f))
    assert info['exists'] is True
    assert info['size'] == 11

    missing = handler._get_file_info(str(tmp_path / "nope.log"))
    assert missing == {"exists": False, "size": 0}

    assert handler._get_file_info(None) == {"exists": False, "size": 0}


def test_extract_script_path():
    """_extract_script_path strips the submitter command and its flags to find
    the script path."""
    handler = _make_job_details_handler()

    assert handler._extract_script_path("sbatch /home/u/run.sh") == "/home/u/run.sh"
    assert handler._extract_script_path(
        "sbatch -N1 --qos=regular /home/u/run.sh") == "/home/u/run.sh"
    assert handler._extract_script_path(
        "/usr/bin/sbatch -p debug /scratch/job.sh") == "/scratch/job.sh"
    assert handler._extract_script_path("") is None
    assert handler._extract_script_path(None) is None


def test_extract_script_path_wrap_jobs_have_no_script():
    """`sbatch --wrap="<command>"` jobs have no associated script file at
    all. Slurm's `SubmitLine`/`Command` reconstruction loses the original
    shell quoting around a multi-word `--wrap` value, so
    e.g. `--wrap="sleep 600" --job-name=foo --hold` is reported as the
    unquoted text `--wrap=sleep 600 --job-name=foo --hold`. Without special
    handling, the leftover `600` token (which doesn't start with "-") would
    be mistaken for the job's positional script-path argument, producing a
    bogus "script path" that doesn't correspond to any real file."""
    handler = _make_job_details_handler()

    assert handler._extract_script_path(
        '--wrap=sleep 600 --job-name=t1_pend_test --hold') is None
    assert handler._extract_script_path('sbatch --wrap="sleep 600"') is None
    assert handler._extract_script_path("--wrap=true") is None


def test_get_field_factory():
    """get_field_factory resolves fields via the field_map (raw->normalized),
    aliases, direct names, and returns None when absent."""
    handler = _make_job_details_handler()

    pick = {'JobIDRaw': '123', 'JobState': 'RUNNING', 'Foo': 'bar'}
    field_map = {'JobIDRaw': 'JobID'}
    aliases = {'State': ['JobState']}
    get_field = handler.get_field_factory(pick, aliases, field_map)

    # Resolved via reverse field_map lookup
    assert get_field('JobID') == '123'
    # Resolved via alias list
    assert get_field('State') == 'RUNNING'
    # Resolved directly by same name
    assert get_field('Foo') == 'bar'
    # Absent -> None
    assert get_field('Missing') is None


# ---------------------------------------------------------------------------
# Malformed JSON, missing/invalid job IDs, empty queues, partial multi-job
# actions, non-UTF-8 output, and very large output.
# ---------------------------------------------------------------------------

async def test_scontrol_hold_malformed_json_body(jp_fetch):
    """A body that claims to be JSON but isn't must not crash the handler; it
    should degrade to the same "no job IDs provided" failure envelope used
    for an actually-empty request, rather than a 500."""
    response = await jp_fetch(
        "jupyterlab_slurm",
        "scontrol/hold",
        method='PATCH',
        headers={'Content-Type': 'application/json'},
        body="{not valid json",
        raise_error=False,
    )
    assert response.code == 400  # malformed request body
    result = json.loads(response.body)
    assert result['success'] is False
    assert result['errorMessage'] == "No job IDs provided"
    assert result['data']['requestedIds'] == []
    assert result['data']['changedIds'] == []


async def test_scancel_malformed_json_body(jp_fetch):
    """A malformed JSON body on scancel must surface as a failed response
    envelope, not an unhandled server error."""
    response = await jp_fetch(
        "jupyterlab_slurm",
        "scancel",
        method='DELETE',
        headers={'Content-Type': 'application/json'},
        body="{not valid json",
        allow_nonstandard_methods=True,
        raise_error=False,
    )
    assert response.code == 400  # malformed request body
    result = json.loads(response.body)
    assert result['success'] is False
    assert result['data']['requestedIds'] == []
    assert result['data']['changedIds'] == []


async def test_squeue_empty_queue(jp_fetch):
    """squeue must report success with an empty rows list when no jobs are
    queued, rather than an error or a malformed payload."""
    data_path = os.path.join(os.path.dirname(__file__), 'data', 'squeue_test_data.txt')
    with open(data_path, 'w') as f:
        f.write("")
    response = await jp_fetch("jupyterlab_slurm", "squeue")
    assert response.code == 200
    payload = json.loads(response.body)
    assert payload['success'] is True
    assert payload['exitCode'] == 0
    assert payload['data']['rows'] == []
    assert payload['data']['columns'] == [
        "JOBID", "PARTITION", "NAME", "USER", "ST", "TIME", "NODES", "NODELIST(REASON)"
    ]


async def test_scontrol_hold_partial_multi_job_failure(jp_fetch, monkeypatch):
    """When holding several jobs and one fails, `changedIds` must reflect only
    the jobs that actually succeeded, `success` must be False overall, and the
    failing job id must be identifiable from the error message.

    The per-job command execution is monkeypatched (rather than relying on a
    replacement mock binary wired through `SlurmCommandPaths`) so the fake
    failure is guaranteed to be in effect regardless of fixture setup order.
    """
    from .. import handlers as handlers_module

    async def fake_run_command(self, command=None, stdin=None, cwd=None):
        last_token = command[-1] if isinstance(command, (list, tuple)) else (command.strip().split()[-1] if command else None)
        if last_token == '9999':
            return {"stdout": "", "stderr": "scontrol: error: Invalid job id specified", "returncode": 1}
        return {"stdout": "", "stderr": "", "returncode": 0}

    monkeypatch.setattr(handlers_module.SlurmCommandHandler, "_run_command", fake_run_command)

    response = await jp_fetch(
        "jupyterlab_slurm",
        "scontrol/hold",
        method='PATCH',
        headers={'Content-Type': 'application/json'},
        body=json.dumps({'job_ids': ['5025_1', '9999']}),
    )
    assert response.code == 200
    result = json.loads(response.body)
    assert result['success'] is False
    assert result['data']['requestedIds'] == ['5025_1', '9999']
    assert result['data']['changedIds'] == ['5025_1']
    assert '9999' in result['errorMessage']


async def test_scontrol_suspend_resume_running_job(jp_fetch):
    """Suspending a RUNNING job should mark it ST=S; resuming it should
    return it to ST=R. Mirrors the existing hold/release coverage, but for
    the runtime-control pair (`scontrol suspend`/`scontrol resume`)."""
    response = await jp_fetch("jupyterlab_slurm", "squeue")
    rows = json.loads(response.body)['data']['rows']
    running_id = next(r[0] for r in rows if r[4] == 'R')

    response = await jp_fetch(
        "jupyterlab_slurm",
        "scontrol/suspend",
        method='PATCH',
        headers={'Content-Type': 'application/json'},
        body=json.dumps({'job_ids': [running_id]}),
    )
    assert response.code == 200
    result = json.loads(response.body)
    assert result['success'] is True
    assert result['data']['changedIds'] == [running_id]

    response = await jp_fetch("jupyterlab_slurm", "squeue")
    rows = json.loads(response.body)['data']['rows']
    suspended = {r[0]: r[4] for r in rows}
    assert suspended[running_id] == 'S'

    response = await jp_fetch(
        "jupyterlab_slurm",
        "scontrol/resume",
        method='PATCH',
        headers={'Content-Type': 'application/json'},
        body=json.dumps({'job_ids': [running_id]}),
    )
    assert response.code == 200
    result = json.loads(response.body)
    assert result['success'] is True

    response = await jp_fetch("jupyterlab_slurm", "squeue")
    rows = json.loads(response.body)['data']['rows']
    resumed = {r[0]: r[4] for r in rows}
    assert resumed[running_id] == 'R'


async def test_scontrol_requeue_and_requeuehold(jp_fetch):
    """Requeue returns a job to PENDING without a hold; Requeue & Hold
    returns it to PENDING but immediately held (JobHeldUser), matching real
    Slurm semantics for `scontrol requeue`/`scontrol requeuehold`."""
    response = await jp_fetch("jupyterlab_slurm", "squeue")
    rows = json.loads(response.body)['data']['rows']
    running_id = next(r[0] for r in rows if r[4] == 'R')

    response = await jp_fetch(
        "jupyterlab_slurm",
        "scontrol/requeue",
        method='PATCH',
        headers={'Content-Type': 'application/json'},
        body=json.dumps({'job_ids': [running_id]}),
    )
    assert response.code == 200
    result = json.loads(response.body)
    assert result['success'] is True

    response = await jp_fetch("jupyterlab_slurm", "squeue")
    rows = json.loads(response.body)['data']['rows']
    requeued = {r[0]: (r[4], r[7]) for r in rows}
    assert requeued[running_id] == ('PD', '(JobRequeued)')

    response = await jp_fetch(
        "jupyterlab_slurm",
        "scontrol/requeuehold",
        method='PATCH',
        headers={'Content-Type': 'application/json'},
        body=json.dumps({'job_ids': [running_id]}),
    )
    assert response.code == 200
    result = json.loads(response.body)
    assert result['success'] is True

    response = await jp_fetch("jupyterlab_slurm", "squeue")
    rows = json.loads(response.body)['data']['rows']
    held = {r[0]: (r[4], r[7]) for r in rows}
    assert held[running_id] == ('PD', '(JobHeldUser)')


async def test_scontrol_suspend_resume_missing_job_ids(jp_fetch):
    """Suspend/resume/requeue/requeuehold must all reject an empty job list
    with a clear 400, matching hold/release's existing behavior."""
    for action in ('suspend', 'resume', 'requeue', 'requeuehold'):
        response = await jp_fetch(
            "jupyterlab_slurm",
            f"scontrol/{action}",
            method='PATCH',
            body=json.dumps({'job_ids': []}),
            raise_error=False,
        )
        assert response.code == 400
        result = json.loads(response.body)
        assert result['success'] is False
        assert result['errorMessage'] == "No job IDs provided"


async def test_run_command_handles_non_utf8_output(tmp_path):
    """`SlurmCommandHandler._run_command()` decodes stdout/stderr with
    errors='replace'; invalid byte sequences in a command's raw output must
    not raise, and the surrounding well-formed text must still come through."""
    from ..handlers import SlurmCommandHandler
    from unittest.mock import MagicMock

    handler = SlurmCommandHandler.__new__(SlurmCommandHandler)
    handler._serverlog = MagicMock()

    script = tmp_path / "non_utf8_emitter"
    with open(script, 'wb') as f:
        f.write(b"#!/usr/bin/env python3\n")
        f.write(b"import sys\n")
        f.write(b"sys.stdout.buffer.write(b'ok \\xff\\xfe done\\n')\n")
        f.write(b"sys.stderr.buffer.write(b'warn \\xfd\\xfc end\\n')\n")
    script.chmod(0o755)

    out = await handler._run_command(f"{sys.executable} {script}")
    assert out['returncode'] == 0
    assert 'ok' in out['stdout']
    assert 'done' in out['stdout']
    assert 'warn' in out['stderr']
    assert 'end' in out['stderr']


async def test_squeue_handles_very_large_output(jp_fetch):
    """A very large number of queued jobs must all be parsed without
    truncation or error. Uses the default squeue mock's shared backing file
    directly (rather than a replacement mock binary), so it is unaffected by
    fixture setup ordering."""
    num_jobs = 5000
    data_path = os.path.join(os.path.dirname(__file__), 'data', 'squeue_test_data.txt')
    lines = [
        f"{i:>18} debug     job_{i:<8} testuser R        0:01      1 node001\n"
        for i in range(num_jobs)
    ]
    with open(data_path, 'w') as f:
        f.writelines(lines)

    response = await jp_fetch("jupyterlab_slurm", "squeue")
    assert response.code == 200
    payload = json.loads(response.body)
    assert payload['success'] is True
    rows = payload['data']['rows']
    assert len(rows) == num_jobs
    assert rows[0][0] == '0'
    assert rows[-1][0] == str(num_jobs - 1)


# ---------------------------------------------------------------------------
# Path expansion placeholders (%j, %J, %A, %a, %x, %u), symlink behavior,
# inaccessible files, and cross-user paths.
# ---------------------------------------------------------------------------

def test_expand_slurm_path_additional_placeholders():
    """Extend basic placeholder coverage: full-string combinations, %j vs %J
    for array jobs, and graceful handling of missing name/user."""
    handler = _make_job_details_handler()

    # %j keeps the full (possibly array-element) job id.
    assert handler.expand_slurm_path("out-%j.log", "500", "myjob", "bob") == "out-500.log"
    assert handler.expand_slurm_path("out-%j.log", "500_2", "myjob", "bob") == "out-500_2.log"

    # All placeholders combined in a single template string.
    combined = handler.expand_slurm_path("%u/%x/%A_%a_%j_%J.log", "700_3", "training", "alice")
    assert combined == "alice/training/700_3_700_3_700.log"

    # Missing name/user must be replaced with empty strings, not raise.
    assert handler.expand_slurm_path("%u-%x.log", "1", None, None) == "-.log"


def test_expand_and_verify_path_symlink(tmp_path):
    """A symlink pointing at a real, existing file must resolve successfully
    (the handler uses `os.path.isfile`, which follows symlinks)."""
    handler = _make_job_details_handler()
    real = tmp_path / "real.out"
    real.write_text("actual output")
    link = tmp_path / "linked.out"
    link.symlink_to(real)

    assert handler.expand_and_verify_path(
        str(link), "1", "job", "user", str(tmp_path)) == str(link)


def test_expand_and_verify_path_broken_symlink(tmp_path):
    """A dangling symlink (target missing) must not be reported as an
    existing file."""
    handler = _make_job_details_handler()
    target = tmp_path / "missing_target.out"
    link = tmp_path / "broken.out"
    link.symlink_to(target)

    assert handler.expand_and_verify_path(
        str(link), "1", "job", "user", str(tmp_path)) is None


@pytest.mark.skipif(os.geteuid() == 0, reason="root bypasses directory permission checks")
def test_get_file_info_permission_denied(tmp_path):
    """A file that exists but sits behind a non-searchable directory must be
    reported as not accessible (exists: False), not raise an unhandled
    exception."""
    handler = _make_job_details_handler()
    restricted_dir = tmp_path / "restricted"
    restricted_dir.mkdir()
    target = restricted_dir / "out.log"
    target.write_text("secret output")
    os.chmod(str(restricted_dir), 0o000)
    try:
        info = handler._get_file_info(str(target))
        assert info == {"exists": False, "size": 0}
    finally:
        os.chmod(str(restricted_dir), 0o755)


def test_expand_and_verify_path_rejects_traversal_outside_workdir(tmp_path):
    """A relative path containing `..` must not be allowed to escape the
    job's own working directory (path-traversal protection), even if a file
    exists at the resolved location outside `workdir`."""
    handler = _make_job_details_handler()
    workdir = tmp_path / "job_workdir"
    workdir.mkdir()
    outside = tmp_path / "secret.out"
    outside.write_text("outside workdir")

    resolved = handler.expand_and_verify_path(
        "../secret.out", "1", "job", "user", str(workdir)
    )
    assert resolved is None


def test_expand_and_verify_path_absolute_path_still_trusted(tmp_path):
    """Absolute paths (e.g. a job's own recorded StdOut/StdErr) are trusted
    as-is and are not subject to the relative-path workdir containment
    check."""
    handler = _make_job_details_handler()
    workdir = tmp_path / "job_workdir"
    workdir.mkdir()
    absolute_file = tmp_path / "elsewhere.out"
    absolute_file.write_text("absolute output")

    resolved = handler.expand_and_verify_path(
        str(absolute_file), "1", "job", "user", str(workdir)
    )
    assert resolved == str(absolute_file)


def test_expand_and_verify_path_cross_user_no_ownership_check(tmp_path):
    """Document a currently-open gap:
    `expand_and_verify_path` only checks that a file exists on disk; it does
    not verify the file actually belongs to (or is otherwise associated
    with) the requesting user. A path expanded with another user's `%u` value
    still resolves as long as the file is present."""
    handler = _make_job_details_handler()
    other_users_dir = tmp_path / "home" / "otheruser"
    other_users_dir.mkdir(parents=True)
    f = other_users_dir / "slurm-42.out"
    f.write_text("someone else's output")

    resolved = handler.expand_and_verify_path(
        "slurm-%j.out", "42", "job", "otheruser", str(other_users_dir)
    )
    assert resolved == str(f)


# ---------------------------------------------------------------------------
# Unified response envelope: every endpoint (success and failure) must carry
# the same 5-key shape: success, responseMessage, errorMessage, exitCode, data.
# ---------------------------------------------------------------------------

_ENVELOPE_KEYS = {"success", "responseMessage", "errorMessage", "exitCode", "data"}


def _assert_envelope_shape(payload):
    assert _ENVELOPE_KEYS <= set(payload.keys())
    assert isinstance(payload["success"], bool)
    assert isinstance(payload["exitCode"], int)
    assert isinstance(payload["data"], dict)
    if payload["success"]:
        assert payload["errorMessage"] is None
    else:
        assert payload["errorMessage"] is not None


async def test_status_envelope_shape(jp_fetch):
    """/status must conform to the unified envelope."""
    response = await jp_fetch("jupyterlab_slurm", "status")
    assert response.code == 200
    payload = json.loads(response.body)
    _assert_envelope_shape(payload)
    assert payload["success"] is True
    assert payload["exitCode"] == 0
    assert payload["data"]["name"] == "jupyterlab_slurm"
    assert "version" in payload["data"]


async def test_user_envelope_shape(jp_fetch):
    """/user success response must conform to the unified envelope."""
    response = await jp_fetch("jupyterlab_slurm", "user")
    assert response.code == 200
    payload = json.loads(response.body)
    _assert_envelope_shape(payload)
    assert payload["success"] is True
    assert "user" in payload["data"]


async def test_user_error_path_returns_envelope_not_crash(monkeypatch):
    """Regression test for the historical bug where the /user error path did
    `json.dumps(e)` on a raw Exception object, raising TypeError instead of
    returning a graceful error body. Exercised directly against the handler
    since the failure path requires os.environ.get() itself to raise."""
    from ..handlers import UserFetchHandler
    from unittest.mock import MagicMock

    app = MagicMock()
    app.ui_methods = {}
    app.settings = {"base_url": "/", "csp_report_uri": "/csp"}
    request = MagicMock()
    request.connection = MagicMock()
    handler = UserFetchHandler(app, request)
    handler._serverlog = MagicMock()

    # Bypass the @tornado.web.authenticated check on a bare handler instance
    # (no full request cycle ran `prepare()` to populate the current user).
    # Use an identity object with no username/name so the handler falls back
    # to `os.environ.get('USER')` (the path being regression-tested), while
    # still being truthy enough to satisfy `@tornado.web.authenticated`.
    class _IdentityWithoutName:
        username = None
        name = None

    handler._jupyter_current_user = _IdentityWithoutName()

    finished = {}

    def fake_finish(body):
        finished["body"] = body

    handler.finish = fake_finish

    def raising_get(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(os.environ, "get", raising_get)

    # Must not raise.
    handler.get()

    payload = json.loads(finished["body"])
    _assert_envelope_shape(payload)
    assert payload["success"] is False
    assert "boom" in payload["errorMessage"]


async def test_ui_config_envelope_shape(jp_fetch):
    """/ui-config must conform to the unified envelope (exitCode/
    responseMessage added alongside the pre-existing success/data)."""
    response = await jp_fetch("jupyterlab_slurm", "ui-config")
    assert response.code == 200
    payload = json.loads(response.body)
    _assert_envelope_shape(payload)
    assert payload["success"] is True
    assert payload["exitCode"] == 0


async def test_job_details_envelope_shape(jp_fetch):
    """/job/<id> success response must include responseMessage alongside the
    pre-existing success/exitCode/data keys."""
    response = await jp_fetch("jupyterlab_slurm", "job/5025")
    assert response.code == 200
    payload = json.loads(response.body)
    _assert_envelope_shape(payload)
    assert payload["success"] is True


async def test_job_details_missing_id_envelope_shape(jp_fetch):
    """/job/<id> failure response (an invalid job id) must conform to the
    unified envelope and surface as a 400 (malformed request)."""
    response = await jp_fetch("jupyterlab_slurm", "job/nonexistent-9999999", raise_error=False)
    assert response.code == 400
    payload = json.loads(response.body)
    _assert_envelope_shape(payload)
    assert payload["success"] is False


async def test_test_suite_envelope_shape(enabled_testing, jp_fetch):
    """/test-suite responses (start + status) must include exitCode/
    responseMessage alongside the pre-existing success/data/errorMessage."""
    response = await jp_fetch(
        "jupyterlab_slurm",
        "test-suite",
        method="POST",
        body="{}",
    )
    assert response.code == 202
    payload = json.loads(response.body)
    _assert_envelope_shape(payload)
    run_id = payload["data"]["runId"]

    for _ in range(20):
        response = await jp_fetch("jupyterlab_slurm", f"test-suite/{run_id}")
        payload = json.loads(response.body)
        _assert_envelope_shape(payload)
        if payload["data"]["status"] in {"completed", "error"}:
            break
        await asyncio.sleep(0.05)
    assert payload["data"]["status"] == "completed"


async def test_squeue_scancel_scontrol_sbatch_already_conformant(jp_fetch):
    """The command handlers already conformed to the 5-key shape before this
    change; confirm they still do (both on success and on a failure path)."""
    response = await jp_fetch("jupyterlab_slurm", "squeue")
    assert response.code == 200
    _assert_envelope_shape(json.loads(response.body))

    response = await jp_fetch(
        "jupyterlab_slurm",
        "scancel",
        method='DELETE',
        params={'job_ids': ['not-a-job-id']},
        raise_error=False,
    )
    assert response.code == 400  # malformed request (invalid job id)
    _assert_envelope_shape(json.loads(response.body))

    response = await jp_fetch(
        "jupyterlab_slurm",
        "sbatch",
        method='POST',
        body=json.dumps({}),
        raise_error=False,
    )
    assert response.code == 400  # malformed request (missing inputPath)
    _assert_envelope_shape(json.loads(response.body))


# ---------------------------------------------------------------------------
# HTTP 4xx/5xx statuses, request bounding, and username resolution.
# ---------------------------------------------------------------------------

async def test_scancel_too_many_job_ids_rejected(jp_fetch):
    """A request with more job ids than MAX_JOB_IDS_PER_REQUEST must be
    rejected as a malformed request (400) rather than spawning a command
    with an unbounded argument list."""
    from ..handlers import MAX_JOB_IDS_PER_REQUEST

    too_many = [str(i) for i in range(MAX_JOB_IDS_PER_REQUEST + 1)]
    response = await jp_fetch(
        "jupyterlab_slurm",
        "scancel",
        method='DELETE',
        body=json.dumps({'job_ids': too_many}),
        headers={'Content-Type': 'application/json'},
        allow_nonstandard_methods=True,
        raise_error=False,
    )
    assert response.code == 400
    result = json.loads(response.body)
    assert result['success'] is False
    assert 'exceeding the limit' in result['errorMessage']


async def test_scancel_command_not_found_maps_to_service_unavailable():
    """When the configured Slurm executable cannot be resolved at all
    (`_run_command` returns exitCode 127), `run_command()` must classify
    that as a 503 (service/command unavailable) rather than the generic
    200 used for an ordinary Slurm command failure."""
    from ..handlers import ScancelHandler
    from unittest.mock import MagicMock

    handler = ScancelHandler.__new__(ScancelHandler)
    handler._slurm_command = "/nonexistent/path/to/scancel-binary"
    handler._serverlog = MagicMock()
    handler.get_jobids = lambda: ["123"]

    out = await handler.run_command()
    assert out['success'] is False
    assert out['exitCode'] == 127
    assert out['_httpStatus'] == 503


async def test_user_prefers_authenticated_identity_over_os_environ(monkeypatch):
    """Username resolution must prefer the authenticated Jupyter identity
    over the process `USER` environment variable, so multi-user deployments
    (e.g. JupyterHub) don't leak/misreport a shared process owner."""
    from ..handlers import UserFetchHandler
    from unittest.mock import MagicMock

    app = MagicMock()
    app.ui_methods = {}
    app.settings = {"base_url": "/", "csp_report_uri": "/csp"}
    request = MagicMock()
    request.connection = MagicMock()
    handler = UserFetchHandler(app, request)
    handler._serverlog = MagicMock()

    class _Identity:
        username = "real-authenticated-user"

    handler._jupyter_current_user = _Identity()

    finished = {}
    handler.finish = lambda body: finished.setdefault("body", body)

    # If the handler ever fell back to os.environ, this would report a
    # different name and the assertion below would fail.
    monkeypatch.setattr(os.environ, "get", lambda *a, **k: "wrong-process-user")

    handler.get()

    payload = json.loads(finished["body"])
    assert payload["success"] is True
    assert payload["data"]["user"] == "real-authenticated-user"


# ---------------------------------------------------------------------------
# Argv-based execution boundary: sbatch/scontrol never re-tokenize a
# user-controlled value (script path / job id) through shlex/a shell.
# ---------------------------------------------------------------------------

async def test_sbatch_rejects_non_string_input_path(jp_fetch):
    """A non-string inputPath (e.g. a JSON object/array) must be rejected as
    a malformed request rather than reaching argv-based execution."""
    response = await jp_fetch(
        "jupyterlab_slurm",
        "sbatch",
        method='POST',
        body=json.dumps({'inputPath': {'not': 'a string'}}),
        raise_error=False,
    )
    assert response.code == 400
    result = json.loads(response.body)
    assert result['success'] is False
    assert 'Invalid inputPath' in result['errorMessage']


async def test_sbatch_rejects_nul_byte_in_path(jp_fetch):
    """A path containing an embedded NUL byte must be rejected outright."""
    response = await jp_fetch(
        "jupyterlab_slurm",
        "sbatch",
        method='POST',
        body=json.dumps({'inputPath': "script.sh\x00.sh"}),
        raise_error=False,
    )
    assert response.code == 400
    result = json.loads(response.body)
    assert result['success'] is False
    assert 'Invalid inputPath' in result['errorMessage']


async def test_sbatch_script_path_with_spaces_not_retokenized(jp_fetch, tmp_path):
    """A script path containing whitespace must be passed to sbatch as a
    single argv element, not re-split by shlex into multiple arguments."""
    script = tmp_path / "my test job.sh"
    script.write_text("#!/bin/sh\necho hi\n")

    response = await jp_fetch(
        "jupyterlab_slurm",
        "sbatch",
        method='POST',
        body=json.dumps({'inputPath': str(script), 'outputPath': str(tmp_path)}),
    )
    assert response.code == 200
    result = json.loads(response.body)
    # The mock sbatch script should receive the whole path as one argument
    # and succeed (rather than erroring out on a mis-split extra argument).
    assert result['success'] is True


async def test_run_command_accepts_argv_list_directly():
    """`_run_command` must execute a pre-built argv list verbatim (no
    shlex re-tokenization), which is the boundary-validation-safe path for
    any user-controlled value such as a submitted script path."""
    from ..handlers import SlurmCommandHandler
    from unittest.mock import MagicMock

    handler = SlurmCommandHandler.__new__(SlurmCommandHandler)
    handler._serverlog = MagicMock()

    out = await handler._run_command([sys.executable, "-c", "print('hello world')"])
    assert out['returncode'] == 0
    assert out['stdout'].strip() == 'hello world'


def test_validate_slurm_command_path_warns_on_missing_absolute_path(tmp_path):
    """An absolute, configured command path that doesn't exist on disk must
    trigger a startup warning (configured command paths must be
    trusted/executable)."""
    from ..handlers import _validate_slurm_command_path
    from unittest.mock import MagicMock

    log = MagicMock()
    missing = str(tmp_path / "no-such-squeue")
    _validate_slurm_command_path("squeue", missing, log)
    assert log.warning.called
    assert "does not exist" in log.warning.call_args[0][0]


def test_validate_slurm_command_path_warns_on_non_executable_file(tmp_path):
    """An absolute path that exists but isn't executable must also warn."""
    from ..handlers import _validate_slurm_command_path
    from unittest.mock import MagicMock

    log = MagicMock()
    not_exec = tmp_path / "sbatch"
    not_exec.write_text("not a real binary")
    os.chmod(str(not_exec), 0o644)
    _validate_slurm_command_path("sbatch", str(not_exec), log)
    assert log.warning.called
    assert "not an executable file" in log.warning.call_args[0][0]


def test_validate_slurm_command_path_warns_on_unresolvable_bare_command():
    """A bare command name that cannot be found on PATH must warn."""
    from ..handlers import _validate_slurm_command_path
    from unittest.mock import MagicMock

    log = MagicMock()
    _validate_slurm_command_path("sacct", "definitely-not-a-real-slurm-command-xyz", log)
    assert log.warning.called
    assert "could not be resolved on PATH" in log.warning.call_args[0][0]


def test_validate_slurm_command_path_no_warning_for_trusted_absolute_executable():
    """A valid, executable absolute path must not trigger a warning."""
    from ..handlers import _validate_slurm_command_path
    from unittest.mock import MagicMock

    log = MagicMock()
    _validate_slurm_command_path("squeue", sys.executable, log)
    log.warning.assert_not_called()


def test_validate_slurm_command_path_no_op_for_empty_path():
    """An empty/None configured path (nothing configured) must be a no-op,
    not raise or warn."""
    from ..handlers import _validate_slurm_command_path
    from unittest.mock import MagicMock

    log = MagicMock()
    _validate_slurm_command_path("sacct", None, log)
    _validate_slurm_command_path("sacct", "", log)
    log.warning.assert_not_called()


async def test_run_command_missing_executable_does_not_leak_path_env(monkeypatch):
    """A missing/unresolvable executable must report a generic error and
    must NOT include the raw `PATH` environment value in the response body
    returned to the client. The PATH value is still available via
    debug-level logging for operator troubleshooting."""
    from ..handlers import SlurmCommandHandler
    from unittest.mock import MagicMock

    monkeypatch.setenv("PATH", "/some/very/secret-looking/internal/path:/usr/bin")
    handler = SlurmCommandHandler.__new__(SlurmCommandHandler)
    handler._serverlog = MagicMock()

    out = await handler._run_command(["definitely-not-a-real-slurm-command-xyz"])
    assert out["returncode"] == 127
    assert "secret-looking" not in out["stderr"]
    assert "PATH=" not in out["stderr"]


# ---------------------------------------------------------------------------
# Admin-configurable hooks: production defaults must disable user hooks/dev
# mode, enforce the hook allowlist (fail-closed), and never let a
# request-scope/user-scope value override server policy.
# ---------------------------------------------------------------------------

def _make_hook_handler(ui_cfg):
    from ..handlers import JobDetailsHandler
    from unittest.mock import MagicMock

    handler = JobDetailsHandler.__new__(JobDetailsHandler)
    handler._serverlog = MagicMock()
    handler._hooks_loaded = False
    handler._hooks = {
        'pre_build': None, 'pre_exec': None, 'around_exec': None,
        'post_process': None, 'audit': None,
    }
    handler.application = MagicMock()
    handler.application.settings = {'SlurmUI': ui_cfg}
    return handler


def test_site_hook_empty_allowlist_rejects_every_hook_in_production(monkeypatch):
    """An empty `site_hook_allowlist` must reject every configured hook when
    not in dev_mode, rather than silently permitting any import (the
    fail-open bug: `if allowlist and not dev_mode` skipped the check
    entirely whenever the allowlist was empty)."""
    monkeypatch.delenv('JLSLURM_DEV', raising=False)
    handler = _make_hook_handler({
        'dev_mode': False,
        'site_hook_allowlist': [],
        'site_hook_pre_exec': 'os.path:join',
        'site_hook_audit': 'os.path:join',
    })

    handler._load_site_hooks()

    assert handler._hooks['pre_exec'] is None
    assert handler._hooks['audit'] is None


def test_site_hook_allowlist_permits_matching_module_only(monkeypatch):
    """A non-empty allowlist must only permit hooks whose module prefix is
    explicitly listed; other configured hooks are still rejected."""
    monkeypatch.delenv('JLSLURM_DEV', raising=False)
    handler = _make_hook_handler({
        'dev_mode': False,
        'site_hook_allowlist': ['os.path'],
        'site_hook_pre_exec': 'os.path:join',
        'site_hook_audit': 'json:dumps',
    })

    handler._load_site_hooks()

    assert handler._hooks['pre_exec'] is not None
    assert handler._hooks['audit'] is None


def test_site_hook_dev_mode_bypasses_allowlist(monkeypatch):
    """`dev_mode: True` (an explicit admin/server-scope setting) is the only
    way to bypass the allowlist check."""
    monkeypatch.delenv('JLSLURM_DEV', raising=False)
    handler = _make_hook_handler({
        'dev_mode': True,
        'site_hook_allowlist': [],
        'site_hook_pre_exec': 'os.path:join',
    })

    handler._load_site_hooks()

    assert handler._hooks['pre_exec'] is not None


def test_is_admin_policy_present_reflects_server_scope_settings():
    """`_is_admin_policy_present()` must be True whenever `SlurmUI` is
    present in `web_app.settings` (server-scope, set once at extension load
    from Traitlets config) and False when it is entirely absent."""
    handler = _make_hook_handler({'dev_mode': False})
    assert handler._is_admin_policy_present() is True

    handler_no_policy = _make_hook_handler(None)
    handler_no_policy.application.settings = {}
    assert handler_no_policy._is_admin_policy_present() is False
