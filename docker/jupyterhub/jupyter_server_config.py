c = get_config()  # noqa: F821

# The real Slurm client binaries (extracted from the `slurmctld` container)
# are installed at /usr/bin, already on PATH for every spawned single-user
# server, so bare command names resolve correctly without needing wrapper
# scripts. Each single-user server runs as its own real OS user (via
# JupyterHub's LocalProcessSpawner), so these commands execute with real,
# per-user identity against the shared cluster over munge -- this is what
# validates the "server runs Slurm commands as the intended user" release
# blocker that the earlier root-only docker-exec wrappers could not.
c.SlurmCommandPaths.squeue_path = "squeue"
c.SlurmCommandPaths.scancel_path = "scancel"
c.SlurmCommandPaths.scontrol_path = "scontrol"
c.SlurmCommandPaths.sbatch_path = "sbatch"
c.SlurmCommandPaths.sacct_path = "sacct"

c.ServerApp.disable_check_xsrf = False

# --- The settings below are deployment-shaped examples, exercised against
# this real Hub + Slurm rig, and documented in ../../docs/deployment.md. A
# real site config (e.g. for NERSC) would tailor the values, not the shape. ---

# Accounting window/fields (SlurmAccounting): keep the sacct query narrow and
# cheap for a busy multi-user controller; widen sacct_time_window_days if
# users need to see older completed jobs in Job History.
c.SlurmAccounting.sacct_path = "sacct"
c.SlurmAccounting.sacct_fields = "JobID,Partition,JobName,User,State,Submit,Elapsed,NNodes,ExitCode"
c.SlurmAccounting.sacct_time_window_days = 14

# UI policy (SlurmUI): admin-only, read-only-to-the-frontend hints served via
# GET /jupyterlab_slurm/ui-config.
c.SlurmUI.queue_column_labels = {"PARTITION": "Queue", "NODELIST(REASON)": "Nodes / Reason"}
c.SlurmUI.queue_column_sizing = {"NAME": {"minWidth": 160, "flex": 2}}
c.SlurmUI.history_column_labels = {"Partition": "Queue"}
# Server-enforced floor on client polling, in ms, to protect the controller.
c.SlurmUI.squeue_reload_limit_ms = 10000

# Site hooks (admin-only; must be both configured AND allow-listed by module
# prefix to load -- an empty allow-list rejects every hook, even a configured
# one). See site_hooks_example.py for the example implementation.
c.SlurmUI.site_hook_audit = "site_hooks_example:audit"
c.SlurmUI.site_hook_pre_exec = "site_hooks_example:pre_exec"
c.SlurmUI.site_hook_allowlist = ["site_hooks_example"]
c.SlurmUI.dev_mode = False
c.SlurmUI.allow_user_hooks = False
