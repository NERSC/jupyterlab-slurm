(api)=

# Backend API Reference

This page documents every REST endpoint exposed by the `jupyterlab_slurm`
Jupyter Server extension (`jupyterlab_slurm/handlers.py`). It is intended
for extension developers, site administrators writing deployment/security
policy, and anyone integrating against the extension directly.

## Base URL and authentication

All routes are registered under:

```
<base_url>/jupyterlab_slurm/<endpoint>
```

where `<base_url>` is the Jupyter Server's configured base URL (e.g.
`/user/<name>/` behind JupyterHub).

- **Authentication**: every handler is decorated with
  `@tornado.web.authenticated`, so every request must carry a valid
  Jupyter Server session (browser session cookie) or API token, exactly like
  any other `/api/...` Jupyter Server endpoint. Unauthenticated requests
  receive a `403` from Jupyter Server itself before any handler code runs.
- **XSRF**: mutating requests (`DELETE`/`PATCH`/`POST`) additionally
  require Jupyter Server's standard XSRF token handling (the `_xsrf`
  cookie plus the `X-XSRFToken` header), inherited from `APIHandler`.
- **Username**: handlers that need the OS username (`/user`, `sacct`
  filtering) prefer the authenticated Jupyter identity, falling back to the
  `USER` environment variable of the notebook server process only when no
  Jupyter identity is configured (e.g. single-user/local deployments).

## Response envelope

With the exception of raw HTTP-level failures (e.g. Jupyter Server
returning `403` for missing auth, or `405` for a disallowed method
before a handler runs), every JSON response body shares one envelope,
produced by the `make_envelope()` helper:

```json
{
  "success": true,
  "responseMessage": "human-readable summary or null",
  "errorMessage": null,
  "exitCode": 0,
  "data": {}
}
```

- `success` (bool) — always present; the first thing callers should check.
- `responseMessage` (string or `null`) — human-readable summary; may be
  `null` when not meaningful.
- `errorMessage` (string or `null`) — `null` on success, a message on
  failure. Never a raw/unredacted Slurm stderr dump.
- `exitCode` (int) — the underlying Slurm command's process exit code when
  one exists (`squeue`/`sacct`/`scancel`/`scontrol`/`sbatch`);
  `0` on success for non-command endpoints (`/status`, `/user`,
  `/ui-config`), or a sentinel of `-1`/`1` for handler-level failures
  that never invoked a Slurm command (bad job id, malformed JSON, missing
  config).
- `data` (object) — always an object, `{}` on failure, never `null` or
  absent.

All endpoints, including `/status`, use only the envelope shape above --
there are no additional top-level fields outside of `success`,
`responseMessage`, `errorMessage`, `exitCode`, and `data`.

## Endpoints

### Quick reference

| Method | Route                  | Auth           | Purpose                                      |
| ------ | ---------------------- | -------------- | -------------------------------------------- |
| GET    | `/status`              | session        | Health check / version                       |
| GET    | `/user`                | session        | Resolve OS username                          |
| GET    | `/ui-config`           | session        | Read-only deployment/UI config               |
| GET    | `/squeue`              | session        | Current queue snapshot                       |
| GET    | `/sacct`               | session        | Job accounting history                       |
| GET    | `/job/{job_id}`        | session        | Normalized single-job details                |
| DELETE | `/scancel`             | session + XSRF | Cancel job(s)                                |
| PATCH  | `/scontrol/{action}`   | session + XSRF | Hold/release/other job mutation              |
| POST   | `/sbatch`              | session + XSRF | Submit a batch script                        |
| POST   | `/test-suite`          | session + XSRF | Start backend compatibility harness (opt-in) |
| GET    | `/test-suite/{run_id}` | session        | Poll harness run status                      |
| DELETE | `/test-suite/{run_id}` | session + XSRF | Request harness run cancellation             |

### GET /status

Health check confirming the server extension is installed and running, and
reporting its version so the frontend can detect a mismatched deployment.

- **Handler**: `HealthCheckHandler`
- **Auth**: required (session/token)
- **Request**: no parameters
- **Response** (`200`):

```json
{
  "success": true,
  "responseMessage": "ok",
  "errorMessage": null,
  "exitCode": 0,
  "data": { "name": "jupyterlab_slurm", "version": "<version>" }
}
```

- **Errors**: on an unexpected internal error, responds `500` with
  `success: false` and `errorMessage` set.

### GET /user

Returns the OS username of the notebook server process.

- **Handler**: `UserFetchHandler`
- **Auth**: required
- **Request**: no parameters
- **Response** (`200`):

```json
{
  "success": true,
  "responseMessage": null,
  "errorMessage": null,
  "exitCode": 0,
  "data": { "user": "<username>" }
}
```

- **Errors**: `500` with `success: false` and `errorMessage` set if
  username resolution raises (e.g. environment lookup failure). This
  endpoint previously crashed with an unhandled `TypeError` on its error
  path (attempting `json.dumps()` on a raw exception); this is fixed.
- **Note**: resolves `os.environ['USER']`, _not_ the authenticated
  Jupyter identity — see the caveat above.

### GET /ui-config

Read-only deployment configuration (column labels/sizing, job-details field
policy, reload throttling, dev diagnostics) sourced from server-side
Traitlets config (`SlurmUI`), never user-editable from the frontend.

- **Handler**: `UiConfigHandler`
- **Auth**: required
- **Request**: no parameters
- **Response** (`200`):

```json
{
  "success": true,
  "responseMessage": null,
  "errorMessage": null,
  "exitCode": 0,
  "data": {
    "queue_column_labels": {},
    "queue_column_sizing": {},
    "history_column_labels": {},
    "details_field_groups": {},
    "details_labels": {},
    "details_sources": {},
    "details_hidden": {},
    "squeue_reload_limit_ms": null,
    "dev_diagnostics": { "dev_mode_active": false, "policy_source": "runtime" },
    "server_root_dir": "<absolute path to the server's Contents root>"
  }
}
```

`server_root_dir` is the resolved, real (symlink-free) absolute path of the
Jupyter Server's Contents root (`ServerApp.root_dir`, falling back to the
contents manager's `root_dir` or the process's current directory). The
frontend uses it to translate the absolute filesystem paths returned by
`scontrol`/`sacct` (e.g. `Command`, `WorkDir`, `Stdout`, `Stderr`) into
paths relative to the Contents root for "Open in Editor"/"Open folder"
actions, and to disable those actions when a path falls outside
`server_root_dir` entirely. It is `null` if it could not be resolved.

- **Errors**: `500` with `success: false`/`errorMessage` on an
  unexpected internal error; individual missing config keys default to
  `{}`/`null` rather than failing the request.

### GET /squeue

Runs `squeue` and returns the current queue as normalized rows.

- **Handler**: `SqueueHandler`
- **Auth**: required
- **Request**: no parameters (the output format string is fixed server-side)
- **Response** (`200`):

```json
{
  "success": true,
  "responseMessage": "Success: ...",
  "errorMessage": null,
  "exitCode": 0,
  "data": {
    "rows": [
      [
        "<jobid>",
        "<partition>",
        "<name>",
        "<user>",
        "<st>",
        "<time>",
        "<nodes>",
        "<nodelist/reason>"
      ]
    ],
    "columns": [
      "JOBID",
      "PARTITION",
      "NAME",
      "USER",
      "ST",
      "TIME",
      "NODES",
      "NODELIST(REASON)"
    ]
  }
}
```

- **Errors**: `200` with `success: false`, `exitCode` set to the
  underlying `squeue` return code (or `-1` on a Python-level exception),
  `data.rows` empty, `data.columns` still populated.

### GET /sacct

Runs `sacct` to return recent job accounting history (default: last 30
days, configurable via `SlurmAccounting.sacct_time_window_days` and
`SlurmAccounting.sacct_fields`).

- **Handler**: `SacctHandler`
- **Auth**: required
- **Query parameters**:
  - `user` (optional, string) — filter history to a single user; passed to
    `sacct -u` when supported, and re-filtered client-side (server-side)
    as a fallback.
- **Response** (`200`):

```json
{
  "success": true,
  "responseMessage": "Success: ...",
  "errorMessage": null,
  "exitCode": 0,
  "data": {
    "rows": [
      [
        "<jobid>",
        "<partition>",
        "<jobname>",
        "<user>",
        "<state>",
        "<submit>",
        "<elapsed>",
        "<nnodes>",
        "<exitcode>"
      ]
    ],
    "columns": [
      "JobID",
      "Partition",
      "JobName",
      "User",
      "State",
      "Submit",
      "Elapsed",
      "NNodes",
      "ExitCode"
    ]
  }
}
```

- **Errors**: `200` with `success: false`, `exitCode` from the
  underlying command (or `-1`), `data.rows` empty, `data.columns`
  still populated from the configured field list.

### GET /job/{job_id}

Returns normalized details for a single job. Tries `scontrol show job
<id>` first (covers running/pending jobs); if that fails or returns no
data, falls back to `sacct` (covers completed/purged jobs), including a
per-array-element fallback for array jobs.

- **Handler**: `JobDetailsHandler`
- **Auth**: required
- **Path parameter**: `job_id` (string) — numeric job id, optionally an
  array element in `<jobid>_<index>` form; must match
  `^[0-9]+(_[0-9]+)?$` semantics enforced elsewhere in the extension.
- **Request**: no body/query parameters
- **Response** (`200`, success):

```json
{
  "success": true,
  "responseMessage": null,
  "errorMessage": null,
  "exitCode": 0,
  "data": {
    "source": "scontrol | sacct",
    "fields": {
      "JobID": "...",
      "JobName": "...",
      "User": "...",
      "QOS": "...",
      "Account": "...",
      "State": "...",
      "Command": "...",
      "Partition": "...",
      "SubmitTime": "...",
      "StartTime": "...",
      "EndTime": "...",
      "Elapsed": "...",
      "Nodes": "...",
      "Nodelist": "...",
      "CPUs": "...",
      "GPUs": "...",
      "GPUType": "...",
      "GPUMemVariant": "...",
      "GPUMem": "...",
      "GPUUtil": "...",
      "Mem": "...",
      "GRES": "...",
      "TimeLimit": "...",
      "Stdout": "...",
      "Stderr": "...",
      "WorkDir": "...",
      "ArrayParent": "...",
      "ArrayRanges": "...",
      "ExitCode": "...",
      "DerivedExitCode": "...",
      "Reason": "...",
      "RawScontrol": "..."
    },
    "steps": []
  }
}
```

`steps` is optional, only present when `sacct` returns multiple rows (job
steps) for this job. Any field with no available value is `null` rather
than omitted. `Stdout`/`Stderr` are enriched (when resolvable) with
file-existence and size info via the extension's path-expansion/verification
logic (`%j`/`%J`/`%A`/`%a`/`%x`/`%u` placeholders, symlink and cross-user
checks).

- **Errors**:
  - Missing/empty `job_id` → `400` with `success: false`,
    `errorMessage: "Missing job_id"`, `exitCode: 1`.
  - `job_id` present but not matching the expected job-id shape → `400`
    with `success: false`, `errorMessage: "Invalid job_id: ..."`,
    `exitCode: 1`.
  - Job not found by either `scontrol` or `sacct` → `200` with
    `success: false`, `errorMessage` set to the command's stderr (or
    `"Job not found"`), `exitCode` set to the underlying return code.
  - Unexpected internal error → `200` with `success: false`,
    `errorMessage` set, `exitCode: 1`.

### DELETE /scancel

Cancels one or more jobs via `scancel`. Modeled as `DELETE` because the
operation is idempotent (retrying a cancel on an already-cancelled job is a
no-op success).

- **Handler**: `ScancelHandler`
- **Auth**: required (+ XSRF token)
- **Request body / query**: job IDs, accepted in either of these forms:
  - JSON body: `{"job_ids": ["123", "456"]}` (Content-Type
    `application/json`)
  - Query parameter(s), repeated: `?job_ids=123&job_ids=456`
  - Each ID must match `^[0-9]+(_[0-9]+)?$` (plain job id or
    `<jobid>_<index>` array element)
- **Response** (`200`):

```json
{
  "success": true,
  "responseMessage": "Success: scancel 123 456",
  "errorMessage": null,
  "exitCode": 0,
  "data": { "requestedIds": ["123", "456"], "changedIds": ["123", "456"] }
}
```

- **Errors**:
  - Non-zero `scancel` exit code (a genuine Slurm-level failure to cancel
    a valid request) → `200` with `success: false`, `errorMessage` set
    to `scancel` stderr, `exitCode` set from the command,
    `data.changedIds` empty. Note: cancelling a job id that Slurm does
    not recognize may still return `exitCode: 0` (Slurm's own behavior).
  - Handler-level failure (missing/invalid job id, malformed JSON body,
    too many job ids) → `400` with `success: false`, `errorMessage`
    describing the problem, `exitCode: -1`.
  - `scancel` executable not found on `PATH` → `503`.
  - Unexpected internal error → `500`.

### PATCH /scontrol/{action}

Applies an `scontrol` action to one or more jobs. Modeled as `PATCH`
since `scontrol` mutates only a subset of job properties and the
operation is not idempotent/safe in the `PUT` sense.

- **Handler**: `ScontrolHandler`
- **Auth**: required (+ XSRF token)
- **Path parameter**: `action` — `hold`, `release`, `suspend`,
  `resume`, `requeue`, and `requeuehold` are issued as native `scontrol
<action> <jobid>` subcommands (one job id at a time, see below); any
  other action string is passed through as `scontrol <action>
<job_ids...>` in a single call, following the same status-code rules
  as `/scancel`.
- **Request body / query**: job IDs, same accepted forms as `/scancel`.
- **Response** (`200`, `hold`/`release`):

```json
{
  "success": true,
  "responseMessage": "Success scontrol hold",
  "errorMessage": null,
  "exitCode": 0,
  "data": { "requestedIds": ["123"], "changedIds": ["123"] }
}
```

For multi-job requests, each job id is issued as a separate `scontrol
hold|release <id>` call; the aggregate `success` is `true` only if
_all_ succeeded, and `data.changedIds` lists only the ones that did
(**partial failure** is reported via `success: false` with per-id
errors joined into `errorMessage`, while `data.changedIds` still
reflects whichever ids succeeded).

- **Errors** (for `hold`/`release`/`suspend`/`resume`/`requeue`/`requeuehold`):
  - No job IDs provided → `400`, `success: false`,
    `errorMessage: "No job IDs provided"`, `exitCode: -1`.
  - Partial/total failure → `200`, `success: false`, `errorMessage`
    with one line per failed id, `exitCode` set to the first failing
    command's exit code.
  - For any other `action`, the same handler-level status codes as
    `/scancel` apply (`400` for missing/invalid job id or malformed
    body, `503` if `scontrol` is not found, `500` on an unexpected
    internal error).
- **Known Slurm-behavior quirk**: holding an already-running job is a Slurm
  no-op (still reported as success).

### POST /sbatch

Submits a batch script via `sbatch`.

- **Handler**: `SbatchHandler`
- **Auth**: required (+ XSRF token)
- **Request body** (JSON, `Content-Type: application/json`):

```json
{ "inputPath": "/path/to/script.sh", "outputPath": "/optional/cwd" }
```

- `inputPath` (required) — path to the batch script to submit.
- `outputPath` (optional) — working directory for the `sbatch`
  invocation; defaults to the server process's current directory.

- **Response** (`200`, success):

```json
{
  "success": true,
  "responseMessage": "Success: sbatch",
  "errorMessage": null,
  "exitCode": 0,
  "data": {
    "jobId": "<jobid>",
    "submissionMessage": "Submitted batch job <jobid>"
  }
}
```

- **Errors**:
  - Missing `inputPath` → `400`, `success: false`,
    `errorMessage: "Malformed request: ..."` (raised as
    `tornado.web.MissingArgumentError`), `exitCode: -1`.
  - `inputPath`/`outputPath` not a plain string, or containing a NUL
    byte → `400`, `success: false`, `exitCode: -1`.
  - `sbatch` failure (bad script, invalid options, etc.) → `200`,
    `success: false`, `errorMessage` set to `sbatch` stderr,
    `exitCode` set to its return code, `data: {}`.
  - Unexpected internal error while running `sbatch` itself → still
    `200`, `success: false`, `exitCode: -1`; any other unhandled error
    (e.g. in request handling) → `500`.

### POST /test-suite, GET /test-suite/{run_id}, DELETE /test-suite/{run_id}

Administrator-opt-in backend compatibility harness that exercises
`squeue`/`sacct`/`scontrol` (and, if mutations are allowed,
`sbatch`/`scancel`/`scontrol hold|release`) against the real cluster.
**This route is only registered when `SlurmTesting.enabled` is true** in
the server's Traitlets config; otherwise `/test-suite` returns Jupyter
Server's normal `404` for an unregistered route.

The handler and its config class (`SlurmTestSuiteHandler`/`SlurmTesting`)
live in their own module, `jupyterlab_slurm/test_suite.py`, which is
imported by the rest of the extension inside a `try/except ImportError`.
This means a **production build can omit the module entirely** — not just
disable it at runtime — by running `python scripts/strip_test_suite_from_build.py`
before packaging. Development and CI builds keep the module (and its
default-disabled config) so the harness remains available for staging/dev
use and its tests keep running.

- **Handler**: `SlurmTestSuiteHandler`
- **Auth**: required (+ XSRF token for `POST`/`DELETE`)
- **Configuration** (`SlurmTesting` traitlets config):
  - `enabled` (bool) — must be `true` for the route to exist at all.
  - `test_directory` (str, required at run time) — a directory the suite
    may write disposable scripts/output into.
  - `allow_mutations` (bool) — if `true`, also submits/cancels/holds a
    real disposable test job.
  - `max_runtime_seconds` (int, default 900) — overall suite deadline.
  - `submission_args` (list of str) — extra args appended to `sbatch`.

**POST /test-suite** — starts a new asynchronous run.

- **Response** (`202`):

```json
{
  "success": true,
  "responseMessage": null,
  "errorMessage": null,
  "exitCode": 0,
  "data": { "runId": "<uuid-hex>" }
}
```

- **Errors**: `409` with `success: false` if a run is already in
  progress; `404` with `success: false` if disabled (route normally
  absent, but guarded defensively).

**GET /test-suite/{run_id}** — polls run status/results.

- **Response** (`200`):

```json
{
  "success": true,
  "responseMessage": null,
  "errorMessage": null,
  "exitCode": 0,
  "data": {
    "runId": "<uuid-hex>",
    "status": "queued | running | completed | error",
    "startedAt": "<epoch-seconds>",
    "results": [
      {
        "name": "squeue|sacct|scontrol|submit-and-account|hold-release-cancel",
        "success": true,
        "message": "..."
      }
    ],
    "errorMessage": null
  }
}
```

- **Errors**: `404` with `success: false` if `run_id` is unknown or
  the harness is disabled.

**DELETE /test-suite/{run_id}** — requests cancellation of a running
suite.

- **Response** (`200`):

```json
{
  "success": true,
  "data": { "runId": "<uuid-hex>", "status": "cancel requested" }
}
```

- **Errors**: `404` with `success: false` if `run_id` is unknown.

## HTTP status codes summary

- `200` — the overwhelming majority of responses, _including_
  genuine Slurm-level command failures against a valid request (bad
  job id passed to a working `scancel`/`scontrol`/`sbatch`, missing
  config); callers must check `success`/`exitCode` in the body, not
  just the HTTP status.
- `202` — `POST /test-suite` accepted and started asynchronously.
- `400` — handler-level request problems on `/job/{job_id}`,
  `/scancel`, `/scontrol/{action}`, and `/sbatch`: missing/invalid job
  id, malformed JSON body, too many job ids, no job IDs provided, or an
  invalid `inputPath`/`outputPath`.
- `404` — unknown `/test-suite/{run_id}`, or the harness route itself
  when `SlurmTesting.enabled` is false (route not registered at all).
- `409` — `POST /test-suite` while a run is already in progress.
- `403` — missing/invalid authentication or XSRF token (raised by
  Jupyter Server before the handler runs).
- `500` — truly unexpected internal errors, on any endpoint.
- `503` — the underlying Slurm executable (`scancel`/`scontrol`) could
  not be found on `PATH`/the configured path.

```{note}
Some endpoints (`/scancel`, `/scontrol/{action}`, `/sbatch`) already use
`400`/`500`/`503` for handler-level failures, but genuine Slurm command
failures (bad job id, non-zero exit code on an otherwise well-formed
request) still fold into a `200` envelope everywhere. Fully standardizing
4xx/5xx usage across *all* endpoints and failure classes is a tracked,
still-open item.
```
