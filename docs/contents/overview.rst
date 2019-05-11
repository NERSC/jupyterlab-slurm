.. _overview:

Overview
--------

The ``jupyterlab-slurm`` extension provides a graphical user interface for interacting with the Slurm Workload Manager from within a JupyterLab session. The main focal point of the GUI is the Slurm queue, organized in an interactive table. Each row of the table corresponds to a pending job in the queue, while each column represents a particular field of metadata associated with each job (e.g, job ID, number of nodes allocated, job status, etc.).

.. image:: ../images/slurm.png
   :align: center

The extension implements a few of the most common user operations in a Slurm system:

* Holding (or pausing) a job
* Releasing (or continuing) a job
* Killing a job
* Submitting new jobs

This extension was originally designed and built by student interns and staff at the National Energy Research Scientific Computing Center (NERSC), a high performance computing facility based out of Lawrence Berkeley National Laboratory (LBL). Our aim is to make the extension portable to any high performance computing system that uses Slurm.



