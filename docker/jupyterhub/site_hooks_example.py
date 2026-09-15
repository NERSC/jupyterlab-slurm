"""
Example site-hooks module, used by the JupyterHub + Slurm test rig
(`docker/jupyterhub/`) to exercise the admin-only `SlurmUI.site_hook_*`
config points end-to-end against a real deployment-shaped server config,
before documenting them for a real NERSC deployment.

Real deployments would ship something like this as an installed package
(e.g. `perlmutter_hooks`) referenced via
`c.SlurmUI.site_hook_audit = "perlmutter_hooks:audit"` and added to
`c.SlurmUI.site_hook_allowlist`.
"""
import logging

logger = logging.getLogger("jupyterlab_slurm.site_hooks_example")


def audit(command_name, rc, duration_ms, argv, context):
    """Called after every Slurm command invocation. Log-only; never raises."""
    logger.info(
        "slurm-audit user=%s command=%s rc=%s duration_ms=%s argv=%s",
        (context or {}).get("user"), command_name, rc, duration_ms, argv,
    )


def pre_exec(command_name, argv, env, context):
    """Called immediately before a Slurm command is executed.

    Returning None leaves argv/env unchanged; a real site hook could add
    site-specific environment variables (e.g. site-specific SLURM_CONF) here.
    """
    logger.info("slurm-pre-exec command=%s argv=%s", command_name, argv)
    return None
