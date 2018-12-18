# jupyterlab-slurm

A JupyterLab extension to interface with the Slurm Workload Manager.


## Prerequisites

* JupyterLab
* NodeJS
* Slurm


Note that if you are using JupyterLabHub, currently (v0.1.0) the locations of the:
- hub server
- single-user JupyterLab servers
- Slurm installation

all have to be the same as each other for this extension to work. [We are looking for a fix for this.](https://github.com/jupyterhub/jupyterlab-hub/issues/70) Suggestions are welcome.

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
of the palette. A launcher icon for this extension is coming soon.


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

During development it is best to leave the server extension uninstalled. Instead, temporarily enable it when starting up JupyterLab for testing. To do this, use the following command to start JupyterLab:

```bash
jupyter lab --NotebookApp.nbserver_extensions="{'jupyterlab-slurm':True}"
```
It's handy to have this command in a .sh file during development.

