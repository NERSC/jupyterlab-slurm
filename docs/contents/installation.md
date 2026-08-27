(installation)=

# Installation

`jupyterlab-slurm` ships as a single Python package. It bundles a prebuilt
JupyterLab frontend extension alongside a Jupyter Server extension, so a
single `pip install` is enough — there is no separate frontend package to
install.

## Requirements

- JupyterLab >= 4.0.0
- Slurm client commands (`squeue`, `sbatch`, `scancel`, `scontrol`, `sacct`)
  available on the machine running the Jupyter server

## Install

```bash
pip install jupyterlab_slurm
```

After installing, restart JupyterLab. The extension appears in the command
palette and launcher as **Slurm Dashboard**, under the **HPC TOOLS**
section.

## Uninstall

```bash
pip uninstall jupyterlab_slurm
```

## Troubleshoot

If the frontend extension does not appear, check that the server extension
is enabled:

```bash
jupyter server extension list
```

and that the frontend extension is installed:

```bash
jupyter labextension list
```

For a development install (editable source, rebuilding from TypeScript),
see {ref}`development`.
