import os

c = get_config()  # noqa: F821

# Test-only config: point the extension at the local slurm-docker-cluster
# stand-in (via docker exec wrapper scripts) instead of the __mocks__ fixtures,
# so the real backend + real Slurm daemon can be exercised end-to-end,
# including the new GPU/GRES parsing against the fake GPU worker node.
_wrappers = os.path.dirname(os.path.abspath(__file__))
c.SlurmCommandPaths.squeue_path = f"{_wrappers}/squeue"
c.SlurmCommandPaths.scancel_path = f"{_wrappers}/scancel"
c.SlurmCommandPaths.scontrol_path = f"{_wrappers}/scontrol"
c.SlurmCommandPaths.sbatch_path = f"{_wrappers}/sbatch"
c.SlurmCommandPaths.sacct_path = f"{_wrappers}/sacct"

c.SlurmTesting.enabled = True
c.SlurmTesting.allow_mutations = True
c.SlurmTesting.test_directory = "/tmp"

c.ServerApp.ip = "127.0.0.1"
c.ServerApp.port = 8899
c.ServerApp.open_browser = False
c.ServerApp.token = "realclusterdockertest"
c.ServerApp.disable_check_xsrf = False
