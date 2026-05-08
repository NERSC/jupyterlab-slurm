# Slurm JupyterLab Extension

A JupyterLab extension that interfaces with the Slurm Workload Manager,
providing simple and intuitive controls for viewing and managing jobs on the queue.

![Slurm Extension](./docs/images/slurm.png)

## Prerequisites

- JupyterLab >= 4.0.0
- Slurm

## Architecture

This extension consists of two main parts:

- **Backend (Python)**: A Jupyter Server extension that provides a REST API to interface with Slurm commands (`squeue`, `sbatch`, `scancel`, `scontrol`, `sacct`).
  - Handlers are located in `jupyterlab_slurm/handlers.py`.
  - It uses a base class `SlurmCommandHandler` to execute shell commands and handle errors.
  - Job details use a specialized `JobDetailsHandler` that normalizes data from both `scontrol` and `sacct`.
- **Frontend (TypeScript/React)**: A JupyterLab extension that provides the UI.
  - Built with React, MUI (Material UI), and `ag-grid-react` for high-performance table rendering.
  - Main components: `SlurmWidget` (top-level), `SqueueDataTable` (live queue), `SlurmJobHistory` (completed jobs), and `JobDetailsPanel` (detailed inspection).
  - State management handles polling, selection snapshots, and navigation between job details.

## Installation

This extension includes both a client-side JupyterLab extension and a server-side
Jupyter notebook server extension. Install these using the command line with

```bash
pip install jupyterlab_slurm
```

If you are running Notebook 5.2 or earlier, enable the server extension by running

```bash
jupyter serverextension enable --py --sys-prefix jupyterlab_slurm
```

After launching JupyterLab, the extension can be found in the command palette under
the name `Slurm Queue Manager`, and is listed under the `HPC TOOLS` section
of the palette and the launcher.

### Development install

As described in the [JupyterLab documentation](https://jupyterlab.readthedocs.io/en/stable/extension/extension_dev.html#extension-authoring) for a development install of the labextension you can run the following in this directory:

### Setup a local slurm cluster

```bash
git clone https://github.com/giovtorres/slurm-docker-cluster
cd slurm-docker-cluster
git clone --branch lab3 https://github.com/NERSC/jupyterlab-slurm.git
cp jupyterlab-slurm/slurm_cluster/docker-compose.yml .
# from slurm-docker-cluster README
docker build -t slurm-docker-cluster:19.05.1 .
# if you encounter an error with the PGP key step
# update line 46 with gpg --keyserver pgp.mit.edu ...
# this will build the jupyterlab image minimal-notebook with a slurm client
docker-compose build
# start the cluster
docker-compose up -d
# register the slurm cluster
./register_cluster.sh
# run munged on the jupyterlab instance to get the slurm commands to connect
docker-compose exec jupyterlab bash
runuser -u slurm -- munged
# test that squeue comes back with a header, if it gets stuck you can't connect
squeue
```

### Install jupyterlab-slurm into your environment

```bash
docker-compose exec -u jovyan jupyterlab bash
cd /usr/local/jupyterlab-slurm/
# install jupyter_packaging which is a missing dependency
pip install jupyter_packaging
# this command takes a while the first it is run
pip install -e .
# point the labextension dev install at current dir
jupyter labextension develop --overwrite .

# rerun this if there are updates:
jlpm run build
```

### Restart the jupyterlab docker container

```bash
docker compose restart jupyterlab

# rerun munged on the jupyterlab instance
docker compose exec jupyterlab bash
runuser -u slurm -- munged
```
