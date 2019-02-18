# jupyterlab-slurm

A JupyterLab extension to interface with the Slurm Workload Manager.


## Prerequisites

* JupyterLab
* NodeJS
* Slurm


## Installation

### Create a conda environment with the prerequisites
```
conda create -n jupyterlab-slurm jupyterlab nodejs 
source activate jupyterlab-slurm
```
Note: If ```source activate``` doesn't work on your system, try ```conda activate```

### Get the code
```
git clone https://github.com/NERSC/jupyterlab-slurm.git
```

### Install the JupyterLab extension
```
jupyter labextension install jupyterlab-slurm
```

### Install the Jupyter Notebook server extension
```
cd jupyterlab-slurm
pip install .                      
jupyter serverextension enable --py jupyterlab-slurm --sys-prefix
```

After launching JupyterLab, the extension can be found in the command palette under
the name ```Slurm Queue Manager```, and is listed under the ```HPC TOOLS``` section
of the palette and the launcher.


## Development

For a development install (requires npm version 4 or later), do the following in the repository directory:

```bash
npm install
npm run build
jupyter labextension link .
```

To rebuild the package and the JupyterLab app (run these commands after making changes to the extension during development):

```bash
npm run build
jupyter lab build
```


For a development install of the server extension (jupyterlab-slurm/slurm.py),
follow the directions in the "Install the Jupyter Notebook server extension"
section above. To see changes made to the server extension during development,
the server extension will need to be reinstalled by running `pip install .` from
within the main repo directory. Note, the server extension will not need to be enabled
more than once.