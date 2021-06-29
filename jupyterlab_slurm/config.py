from traitlets import Unicode
from traitlets.config import Configurable


class SlurmCommandPaths(Configurable):
    squeue_path = Unicode(
        default_value="squeue",
        help=""
    ).tag(config=True)

    scancel_path = Unicode(
        default_value="scancel",
        help=""
    ).tag(config=True)

    scontrol_path = Unicode(
        default_value="scontrol",
        help=""
    ).tag(config=True)

    sbatch_path = Unicode(
        default_value="sbatch",
        help=""
    ).tag(config=True)

    # add spath as trait

    def get_paths(self):
        return {
            'squeue_path': self.squeue_path,
            'scancel_path': self.scancel_path,
            'scontrol_path': self.scontrol_path,
            'sbatch_path': self.sbatch_path
        }
