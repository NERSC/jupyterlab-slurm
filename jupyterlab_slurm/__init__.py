"""JupyterLab Slurm : view and manage Slurm queue from JupyterLab """

from .slurm import ScancelHandler
from .slurm import ScontrolHandler
from .slurm import SbatchHandler
from .slurm import SqueueHandler
from .slurm import UserFetchHandler

from notebook.utils import url_path_join
from os import path

__version__ = "2.0.0-dev"


def _jupyter_server_extension_paths():
    return [{
        "module": "jupyterlab_slurm"
    }]


def load_jupyter_server_extension(nb_server_app):
    """
    Called when the extension is loaded.

    Args:
        nb_server_app (NotebookWebApplication): handle to the Notebook webserver instance.
    """
    print('jupyterlab_slurm server extension loaded')
    web_app = nb_server_app.web_app
    host_pattern = '.*$'

    base_url = web_app.settings['base_url']

    temporary_directory = web_app.settings['temporary_directory'] if 'temporary_directory' in web_app.settings else None

    spath = path.normpath(
        web_app.settings['spath']) + "/" if 'spath' in web_app.settings else ''

    def obtain_path(method):
        return web_app.settings[method + '_path'] if method + '_path' in web_app.settings else spath + method

    squeue_path = obtain_path("squeue")
    scancel_path = obtain_path("scancel")
    scontrol_path = obtain_path("scontrol")
    sbatch_path = obtain_path("sbatch")

    print("Starting up....", squeue_path, scancel_path,
          scontrol_path, sbatch_path, sep='\n')

    web_app.add_handlers(host_pattern, [
        (url_path_join(base_url, '/squeue'),
         SqueueHandler, dict(squeue=squeue_path)),
        (url_path_join(base_url, '/scancel'),
         ScancelHandler, dict(scancel=scancel_path)),
        (url_path_join(base_url, '/scontrol/(?P<command>.*)'),
         ScontrolHandler, dict(scontrol=scontrol_path)),
        (url_path_join(base_url, '/sbatch'),
         SbatchHandler, dict(sbatch=sbatch_path, temporary_directory=temporary_directory)),
        (url_path_join(base_url, '/user'), UserFetchHandler)
    ])
