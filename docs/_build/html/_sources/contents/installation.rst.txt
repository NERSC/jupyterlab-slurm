.. _installation:

Installation
------------

The jupyterlab-slurm extension requires both a client-side `JupyterLab extension <https://www.npmjs.com/package/jupyterlab-slurm>`__ and a server-side
Jupyter `notebook server extension <https://pypi.org/project/jupyterlab-slurm/>`__.

Prerequisites
~~~~~~~~~~~~~
Make sure you have the following prerequisites installed on your system before getting started.

* JupyterLab >= 0.35
* Node.js 5+
* Slurm 

Install the notebook server extension from PyPi using ``pip``
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
.. code:: bash

    pip install jupyterlab_slurm

If you are running Notebook 5.2 or earlier, enable the server extension by running

.. code:: bash

    jupyter serverextension enable --py --sys-prefix jupyterlab_slurm

Install the JupyterLab extension from NPM
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
.. code:: bash

    jupyter labextension install jupyterlab-slurm

Now you should be all set. After launching JupyterLab, the extension can be found in the command palette under
the name ``Slurm Queue Manager``, and is listed under the ``HPC TOOLS`` section
of the palette and the launcher.
