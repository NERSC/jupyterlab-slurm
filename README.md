# jupyterlab-slurm

A JupyterLab extension to interface with the Slurm workload manager.


## Prerequisites

* JupyterLab
* NodeJS

## Installation

```bash
jupyter labextension install jupyterlab-slurm
```

## Development

For a development install (requires npm version 4 or later) of both the underlying notebook server extension and of the JupyterLab extension, do the following in the repository directory:

```bash
pip install .
jupyter serverextension enable --py jupyterlab-slurm --sys-prefix

npm install
npm run build
jupyter labextension install .
```

To rebuild the JupyterLab extension and the JupyterLab app:

```bash
npm run build
jupyter lab build
```

