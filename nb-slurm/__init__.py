"""JupyterLab Slurm : view and manage Slurm queue from JupyterLab """

from .slurm import ScancelHandler
from .slurm import ScontrolHandler
from .slurm import SbatchHandler
from .slurm import SqueueHandler

from notebook.utils import url_path_join

def _jupyter_server_extension_paths():
    return [{
        "module": "nb-slurm"
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
    
    scancel_route_pattern =      create_full_route_pattern_from('/scancel')
    scancel_hub_route_pattern1 = create_full_route_pattern_from('/hub/scancel')
    scancel_hub_route_pattern2 = create_full_route_pattern_from('/lab/user/scancel')
    scancel_hub_route_pattern3 = create_full_route_pattern_from('/lab/scancel')
    
    scontrol_route_pattern =     create_full_route_pattern_from('/scontrol/(?P<command>.*)')
    scontrol_hub_route_pattern1 =create_full_route_pattern_from('/hub/scontrol/(?P<command>.*)')
    scontrol_hub_route_pattern2 =create_full_route_pattern_from('/lab/user/scontrol/(?P<command>.*)')
    scontrol_hub_route_pattern3 =create_full_route_pattern_from('/lab/scontrol/(?P<command>.*)')
    
    sbatch_route_pattern =       create_full_route_pattern_from('/sbatch')
    sbatch_hub_route_pattern1 =  create_full_route_pattern_from('/hub/sbatch')
    sbatch_hub_route_pattern2 =  create_full_route_pattern_from('/lab/user/sbatch')
    sbatch_hub_route_pattern3 =  create_full_route_pattern_from('/lab/sbatch')
    
    squeue_route_pattern =       create_full_route_pattern_from('/squeue')
    squeue_hub_route_pattern1 =  create_full_route_pattern_from('/hub/squeue')
    squeue_hub_route_pattern2 =  create_full_route_pattern_from('/lab/user/squeue')
    squeue_hub_route_pattern3 =  create_full_route_pattern_from('/lab/squeue')

    web_app.add_handlers(host_pattern, [
        (scancel_route_pattern, ScancelHandler),
        (scancel_hub_route_pattern1, ScancelHandler),
        (scancel_hub_route_pattern2, ScancelHandler),
        (scancel_hub_route_pattern3, ScancelHandler),
        (scontrol_route_pattern, ScontrolHandler),
        (scontrol_hub_route_pattern1, ScontrolHandler),
        (scontrol_hub_route_pattern2, ScontrolHandler),
        (scontrol_hub_route_pattern3, ScontrolHandler),
        (sbatch_route_pattern, SbatchHandler),
        (sbatch_hub_route_pattern1, SbatchHandler),
        (sbatch_hub_route_pattern2, SbatchHandler),
        (sbatch_hub_route_pattern3, SbatchHandler),
        (squeue_route_pattern, SqueueHandler),
        (squeue_hub_route_pattern1, SqueueHandler),
        (squeue_hub_route_pattern2, SqueueHandler),
        (squeue_hub_route_pattern3, SqueueHandler),
        ])
