"""JupyterLab Slurm : view and manage Slurm queue from JupyterLab """

from .slurm import ScancelHandler
from .slurm import ScontrolHandler
from .slurm import SbatchHandler
from .slurm import SqueueHandler
from .slurm import UserFetchHandler

from notebook.utils import url_path_join

__version__="0.1.0"

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

    web_app.add_handlers(host_pattern, [
        (url_path_join(base_url, '/squeue'), SqueueHandler),
        (url_path_join(base_url, '/scancel'), ScancelHandler),
        (url_path_join(base_url, '/scontrol/(?P<command>.*)'), ScontrolHandler),
        (url_path_join(base_url, '/sbatch'), SbatchHandler),
        (url_path_join(base_url, '/user'), UserFetchHandler)
        ])

