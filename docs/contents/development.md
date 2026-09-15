(development)=

# Development

If you want to set up a development installation of the extension, or
contribute to it, clone the [repository](https://github.com/NERSC/jupyterlab-slurm)
and follow the steps below.

## Development install

Requires [Node.js](https://nodejs.org/en/download) (for building the
frontend) in addition to a Python environment.

```bash
# Clone the repo, then from the repo root:
python -m venv .venv
source .venv/bin/activate
pip install --editable ".[test]"

# Link the development build with JupyterLab
jupyter labextension develop --overwrite .

# Rebuild the TypeScript source (repeat this after every change)
jlpm build
```

To watch the source and rebuild automatically while running JupyterLab in
another terminal:

```bash
jlpm watch
```

## Development uninstall

```bash
pip uninstall jupyterlab_slurm
```

You may also need to remove the symlink created by `jupyter labextension
develop`. Run `jupyter labextension list` to find the `labextensions`
folder, then remove the `jupyterlab-slurm` entry within it.

## Testing

- Python/server tests: `pytest -vv -r ap --cov jupyterlab_slurm`
- Frontend tests: `jlpm test`
- UI/integration tests (Playwright + Galata): see
  [`ui-tests/README.md`](https://github.com/NERSC/jupyterlab-slurm/blob/main/ui-tests/README.md)

Issues and pull requests are welcome on the
[GitHub repository](https://github.com/NERSC/jupyterlab-slurm).
