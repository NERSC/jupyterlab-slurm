from setuptools import setup, find_packages
from jupyterlab_slurm import __version__


long_description = 'A Jupyter Notebook server extension that implements \
                    common Slurm commands, which are executed in the server\'s shell; \
                    to be used in conjuction with the jupyterlab-slurm JupyterLab extension.'

# Allows automatic enabling of the server extension; see the docs:
# https://jupyter-notebook.readthedocs.io/en/stable/examples/Notebook/Distributing%20Jupyter%20Extensions%20as%20Python%20Packages.html
data_files = [
    ("etc/jupyter/jupyter_notebook_config.d", [
        "jupyter-config/jupyter_notebook_config.d/jupyterlab_slurm.json"
    ])
]       

setup(
    name='jupyterlab_slurm',
    version=__version__,
    description='A Jupyter Notebook server extension that implements common Slurm commands.',
    long_description=long_description,
    long_description_content_type="text/markdown",
    packages=find_packages(),
    include_package_data=True,
    data_files = data_files,
    author='NERSC, Jon Hays, William Krinsman',
    license='BSD 3-Clause',
    url='https://github.com/NERSC/jupyterlab-slurm',
    keywords=['Jupyter', 'Jupyterlab', 'Slurm', 'NERSC'],
    python_requires='>=3.6',
    install_requires=['notebook']
)
