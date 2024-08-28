try:
    from ._version import __version__
except ImportError:
    # Fallback when using the package in dev mode without installing
    # in editable mode with pip. It is highly recommended to install
    # the package from a stable release or in editable mode: https://pip.pypa.io/en/stable/topics/local-project-installs/#editable-installs
    import warnings
    warnings.warn("Importing 'jupyterlab_slurm' outside a proper installation.")
    __version__ = "dev"

from .config import SlurmCommandPaths
from .handlers import setup_handlers


def _jupyter_labextension_paths():
    return [{
        "src": "labextension",
        "dest": "jupyterlab-slurm"
    }]


def _jupyter_server_extension_points():
    return [{
        "module": "jupyterlab_slurm"
    }]


def _load_jupyter_server_extension(server_app):
    """Registers the API handler to receive HTTP requests from the frontend extension.

    Parameters
    ----------
    server_app: jupyterlab.labapp.LabApp
        JupyterLab application instance
    """
    name = "jupyterlab_slurm"
    server_app.log.info(f"Registered {name} server extension")
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
