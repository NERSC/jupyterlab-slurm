from traitlets import Unicode, Dict, Integer, List, Bool
from traitlets.config import Configurable


class SlurmCommandPaths(Configurable):
    squeue_path = Unicode(
        default_value="squeue",
        help="Path to the squeue command (resolved from PATH if not overridden)"
    ).tag(config=True)

    scancel_path = Unicode(
        default_value="scancel",
        help="Path to the scancel command (resolved from PATH if not overridden)"
    ).tag(config=True)

    scontrol_path = Unicode(
        default_value="scontrol",
        help="Path to the scontrol command (resolved from PATH if not overridden)"
    ).tag(config=True)

    sbatch_path = Unicode(
        default_value="sbatch",
        help="Path to the sbatch command (resolved from PATH if not overridden)"
    ).tag(config=True)

    # Optional accounting command path (added for job history)
    sacct_path = Unicode(
        default_value="sacct",
        help="Path to the sacct command (resolved from PATH if not overridden)"
    ).tag(config=True)

    def get_paths(self):
        return {
            'squeue_path': self.squeue_path,
            'scancel_path': self.scancel_path,
            'scontrol_path': self.scontrol_path,
            'sbatch_path': self.sbatch_path,
            'sacct_path': self.sacct_path
        }


# Backward-compatible optional accounting command configuration
class SlurmAccounting(Configurable):
    # Path to sacct command (if not provided, handlers will resolve from PATH)
    sacct_path = Unicode(
        default_value="sacct",
        help="Path to sacct command"
    ).tag(config=True)

    # Comma-separated list of fields to request from sacct
    # Admins can adjust this to match their site configuration. Submit time is
    # included by default so users can distinguish jobs that share a name/id.
    sacct_fields = Unicode(
        default_value="JobID,Partition,JobName,User,State,Submit,Elapsed,NNodes,ExitCode",
        help="Comma-separated list of fields to request from sacct"
    ).tag(config=True)

    # Number of days of history to query from sacct (via -S now-<N>days).
    # Admins can widen or narrow this window to match their site's accounting retention.
    sacct_time_window_days = Integer(
        default_value=30,
        help="Number of days of job history to request from sacct"
    ).tag(config=True)

    def get_config(self):
        """Serialize all admin-configurable traits to a plain dict for web_app.settings."""
        return {name: getattr(self, name) for name in self.trait_names(config=True)}


# NOTE: `SlurmTesting` (the opt-in cluster compatibility harness config) now
# lives in `test_suite.py`, alongside `SlurmTestSuiteHandler`, so that both
# can be omitted entirely from a production build. See test_suite.py for
# details.


class SlurmUI(Configurable):
    """
    Deployment-only UI hints that should not be user-editable via the
    front-end settings schema. Admins configure these via the Jupyter
    server config (e.g., jupyter_server_config.py or *.d JSON files).

    These values can be exposed to the UI through a read-only API.
    """

    # Optional per-column display labels for the Squeue table.
    # Keys should match server column ids (e.g., 'JOBID', 'PARTITION',
    # 'NAME', 'USER', 'ST', 'TIME', 'NODES', 'NODELIST(REASON)').
    queue_column_labels = Dict(
        default_value={},
        help="Mapping of Squeue column ids to deployment-specific labels",
    ).tag(config=True)

    # Optional per-column sizing hints for the Squeue table.
    # Each value is a dict of numeric sizing properties like width,
    # minWidth, maxWidth, flex, and optional booleans such as wrapText.
    queue_column_sizing = Dict(
        default_value={},
        help="Per-column sizing hints (width/minWidth/maxWidth/flex/wrapText)",
    ).tag(config=True)

    # Optional per-column display labels for the Job History (sacct) table.
    # Keys should match sacct column ids configured by admins (e.g.,
    # 'JobID', 'JobName', 'Partition' (often labeled as QOS in some sites),
    # 'Account', 'AllocCPUS', 'State', 'ExitCode').
    history_column_labels = Dict(
        default_value={},
        help="Mapping of sacct (history) column ids to deployment-specific labels",
    ).tag(config=True)

    # Minimum allowed interval between squeue reloads (in milliseconds).
    # This acts as a server-enforced floor to prevent overly frequent polling
    # that could spam the Slurm controller.
    squeue_reload_limit_ms = Integer(
        default_value=5000,
        help="Minimum interval (ms) allowed between squeue reloads; the client will clamp to this floor",
    ).tag(config=True)

    # --- Job Details (configurable, server-driven UI hints) ---
    # Field grouping for the Job Details view: section name -> ordered list of fields
    details_field_groups = Dict(
        default_value={},
        help="Job Details: section name to ordered list of field ids",
    ).tag(config=True)

    # Per-field display labels for Job Details
    details_labels = Dict(
        default_value={},
        help="Job Details: mapping of field id to display label",
    ).tag(config=True)

    # Data sources for Job Details fields: scontrol | sacct | derive
    details_sources = Dict(
        default_value={},
        help="Job Details: mapping of field id to source (scontrol|sacct|derive)",
    ).tag(config=True)

    # Optional list of fields that are computed/available but hidden from primary sections
    details_hidden = Dict(
        default_value={},
        help="Job Details: optional mapping or list-like dict of fields to hide by default",
    ).tag(config=True)

    # --- Site hooks (ADMIN-ONLY) ---
    # Import paths in the form "module.submodule:callable". These are loaded once and
    # invoked around Slurm command execution to adapt behavior per-site without forking.
    site_hook_pre_build = Unicode(
        default_value="",
        help="Admin-only: import path for pre-build hook (pre_build(command_name, inputs, context))",
    ).tag(config=True)

    site_hook_pre_exec = Unicode(
        default_value="",
        help="Admin-only: import path for pre-exec hook (pre_exec(command_name, argv, env, context))",
    ).tag(config=True)

    site_hook_around_exec = Unicode(
        default_value="",
        help="Admin-only: import path for around-exec hook (around_exec(execute, command_name, argv, env, context))",
    ).tag(config=True)

    site_hook_post_process = Unicode(
        default_value="",
        help="Admin-only: import path for post-process hook (post_process(command_name, rc, out, err, parsed, context))",
    ).tag(config=True)

    site_hook_audit = Unicode(
        default_value="",
        help="Admin-only: import path for audit hook (audit(command_name, rc, duration_ms, argv, context))",
    ).tag(config=True)

    # Allow-list for hook modules (prefixes), e.g., ["perlmutter_hooks", "site_hooks"].
    site_hook_allowlist = List(
        Unicode(),
        default_value=[],
        help="Admin-only: list of allowed module prefixes for site hooks",
    ).tag(config=True)

    # If True, allow loading hooks from user-owned locations for development only.
    dev_mode = Bool(
        default_value=False,
        help="Development mode: relax admin-only checks for hooks to aid local testing",
    ).tag(config=True)

    # If False (default), ignore any user-scope attempts to set SlurmUI server-side policy.
    allow_user_hooks = Bool(
        default_value=False,
        help="If True, allow user-scope config to set site hooks (NOT recommended in production)",
    ).tag(config=True)

    def get_config(self):
        """Serialize all admin-configurable traits to a plain dict for web_app.settings."""
        return {name: getattr(self, name) for name in self.trait_names(config=True)}
