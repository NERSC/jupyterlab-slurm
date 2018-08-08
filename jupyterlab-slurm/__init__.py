"""JupyterLab Slurm : view and manage Slurm queue from JupyterLab """

from .slurm import ScancelHandler
from .slurm import ScontrolHandler
from .slurm import SbatchHandler
from .slurm import SqueueHandler

from notebook.utils import url_path_join

def _jupyter_server_extension_paths():
    return [{
        "module": "jupyterlab-slurm"
        }]
        
def load_jupyter_server_extension(nb_server_app):
    """
    Called when the extension is loaded.

    Args:
        nb_server_app (NotebookWebApplication): handle to the Notebook webserver instance.
    """
    print('Server extension loaded!')
    web_app = nb_server_app.web_app
    host_pattern = '.*$'

    def create_full_route_pattern_from(end_of_url_pattern):
        return url_path_join(web_app.settings['base_url'], end_of_url_pattern)
    
    scancel_route_pattern = create_full_route_pattern_from('/scancel')
    scontrol_route_pattern = create_full_route_pattern_from('/scontrol/(?P<command>.*)')
    sbatch_route_pattern = create_full_route_pattern_from('/sbatch')
    squeue_route_pattern = create_full_route_pattern_from('/squeue')

    web_app.add_handlers(host_pattern, [
        (scancel_route_pattern, ScancelHandler),
        (scontrol_route_pattern, ScontrolHandler),
        (sbatch_route_pattern, SbatchHandler),
        (squeue_route_pattern, SqueueHandler),
        ])
