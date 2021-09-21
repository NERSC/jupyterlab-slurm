"""JupyterLab Slurm : view and manage Slurm queue from JupyterLab """
import json
import logging
from pathlib import Path
from .config import SlurmCommandPaths

from .handlers import setup_handlers

HERE = Path(__file__).parent.resolve()

with (HERE / "labextension" / "package.json").open() as fid:
    data = json.load(fid)


def _jupyter_labextension_paths():
    return [{"src": "labextension", "dest": data["name"]}]


def _jupyter_server_extension_points():
    return [{"module": "jupyterlab_slurm"}]


def _load_jupyter_server_extension(server_app):
    """
    Called when the extension is loaded.

    Args:
        server_app (): handle to the JupyterLab webserver instance.
    """

    server_app.log.info('jupyterlab_slurm server extension loaded')
    slurm_commands = SlurmCommandPaths(parent=server_app)
    server_app.log.info(slurm_commands.get_paths())

    web_app = server_app.web_app
    web_app.settings.update(slurm_commands.get_paths())

    temporary_directory = web_app.settings['temporary_directory'] if 'temporary_directory' in web_app.settings else None
    #server_app.log.addHandler(logging.FileHandler('/tmp/jupyter_debug'))
    #server_app.log.setLevel(logging.DEBUG)

    # add get_example url
    setup_handlers(
        web_app, temporary_directory=temporary_directory, log=server_app.log)


# classic notebook backward compatibility
load_jupyter_server_extension = _load_jupyter_server_extension
