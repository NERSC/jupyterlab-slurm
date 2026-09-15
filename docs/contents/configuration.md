(configuration)=

# Configuration

`jupyterlab-slurm` exposes its user-facing settings through JupyterLab's
standard **Settings Editor**, defined by `schema/plugin.json` in the
[project repository](https://github.com/NERSC/jupyterlab-slurm). No manual
file editing is required: open JupyterLab's **Settings > Advanced Settings
Editor**, choose **Slurm Dashboard**, and edit the JSON on the right-hand
side.

The following settings are currently available:

- `userOnly` (boolean, default `false`) — start the queue in "user view"
  (only your jobs), instead of the full queue.
- `notifyOnStateChange` (boolean, default `false`) — show a notification
  whenever one of *your own* jobs' state changes (e.g. `R` → `CD`),
  including when a job leaves the queue entirely (e.g. on completion). Jobs
  belonging to other users are never notified on, independent of the
  separate `userOnly` grid filter above.
- `autoReload` (boolean, default `true`) — automatically poll `squeue` for
  updates.
- `autoReloadRate` (number, default `10`) — seconds between automatic
  `squeue` refreshes.
- `itemsPerPageAuto` (boolean, default `true`) — automatically size the
  page to fit the available vertical space.
- `itemsPerPage` (number, default `10`) — number of rows displayed per
  page when `itemsPerPageAuto` is `false`.
- `itemsPerPageOptions` (array of numbers, default
  `[10, 15, 20, 25, 30, 40, 50]`) — page-size choices offered to the user.
- `columnState` (array, default `[]`) — persisted queue-table column order,
  visibility, width, and pinning. This is managed automatically as you
  reorder, resize, hide, or pin columns in the grid; it isn't meant to be
  hand-edited, but you can clear it (set back to `[]`) to reset the table to
  its default layout.

## Server-side (administrator) configuration

Deployment-level behavior — such as which columns are shown, job-details
field policy, and reload throttling — is controlled separately by the
Jupyter Server administrator via Traitlets configuration (`SlurmUI`,
`SlurmAccounting`, and, for the opt-in backend test harness,
`SlurmTesting`), not by end users. This read-only configuration is served
to the frontend from the `GET /jupyterlab_slurm/ui-config` endpoint; see
{ref}`api` for details.

All Traitlets below go in the Jupyter Server config file (typically
`jupyter_server_config.py`, or `jupyter_notebook_config.py` for classic
notebook), or an equivalent `*.d` JSON config fragment. This is standard
Jupyter Server configuration — see the
[Jupyter Server documentation](https://jupyter-server.readthedocs.io/en/latest/other/full-config.html)
for config file discovery/precedence rules (e.g. `/etc/jupyter/`,
`$JUPYTER_CONFIG_DIR`, per-user config, JupyterHub-spawned single-user
config, etc.).

The example below was exercised end-to-end against a local JupyterHub +
real Slurm cluster test rig (`docker/jupyterhub/`) — every value shown was
observed to take effect via a live `GET /ui-config` and real `sbatch`/`sacct`
calls, not just read from source. For the full runnable rig used to validate
this, see `docker/jupyterhub/README.md`.

### Command paths (`SlurmCommandPaths`)

Point at absolute paths if the Slurm client binaries are not reliably on the
`PATH` inherited by the Jupyter server process (common on HPC systems that
manage Slurm via environment modules):

```python
c.SlurmCommandPaths.squeue_path = "/usr/bin/squeue"
c.SlurmCommandPaths.scancel_path = "/usr/bin/scancel"
c.SlurmCommandPaths.scontrol_path = "/usr/bin/scontrol"
c.SlurmCommandPaths.sbatch_path = "/usr/bin/sbatch"
c.SlurmCommandPaths.sacct_path = "/usr/bin/sacct"
```

### Accounting window and fields (`SlurmAccounting`)

Controls the `sacct` query used by Job History. Narrow the time window and
field list to reduce load on a busy accounting database; widen the window
if users need to see older completed jobs:

```python
c.SlurmAccounting.sacct_path = "sacct"
c.SlurmAccounting.sacct_fields = (
    "JobID,Partition,JobName,User,State,Submit,Elapsed,NNodes,ExitCode"
)
c.SlurmAccounting.sacct_time_window_days = 14  # default: 30
```

### UI policy (`SlurmUI`)

Read-only, admin-controlled hints for the frontend (column labels/sizing,
and a server-enforced floor on client polling frequency):

```python
c.SlurmUI.queue_column_labels = {
    "PARTITION": "Queue",
    "NODELIST(REASON)": "Nodes / Reason",
}
c.SlurmUI.queue_column_sizing = {"NAME": {"minWidth": 160, "flex": 2}}
c.SlurmUI.history_column_labels = {"Partition": "Queue"}

# Minimum interval (ms) the client is allowed to poll squeue at; the
# frontend clamps its own reload rate to this floor.
c.SlurmUI.squeue_reload_limit_ms = 10000  # default: 5000
```

### Site hooks (`SlurmUI`, admin-only)

Optional hooks let a site adapt or audit Slurm command execution without
forking the extension. Hooks are `"module.submodule:callable"` import paths,
and are **fail-closed**: a hook only loads if its top-level module is also
listed in `site_hook_allowlist` — an empty allow-list rejects every
configured hook.

```python
# Ship your own hooks as an installed package, e.g. `perlmutter_hooks`:
c.SlurmUI.site_hook_audit = "perlmutter_hooks:audit"
c.SlurmUI.site_hook_pre_exec = "perlmutter_hooks:pre_exec"
c.SlurmUI.site_hook_allowlist = ["perlmutter_hooks"]

# Leave these False/empty in production:
c.SlurmUI.dev_mode = False
c.SlurmUI.allow_user_hooks = False
```

Each hook receives the Slurm command name, the argv/env or parsed
output, and a `context` dict; see `jupyterlab_slurm/config.py` for the
exact signature of each hook point (`pre_build`, `pre_exec`,
`around_exec`, `post_process`, `audit`). A minimal example implementation
lives at `docker/jupyterhub/site_hooks_example.py`.

### Verifying configuration after deployment

After restarting the Jupyter server (or JupyterHub-spawned single-user
server), confirm the new configuration is live without needing the
frontend:

```bash
curl -b <session-cookie> -H "X-XSRFToken: <token>" \
  https://<host>/user/<name>/jupyterlab_slurm/ui-config
```

The response should reflect the configured `queue_column_labels`,
`squeue_reload_limit_ms`, etc. For JupyterHub deployments specifically, see
{ref}`deployment` for how per-user identity and this configuration interact
when spawning single-user servers.
