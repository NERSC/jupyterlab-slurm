.. _usage:

.. role:: python(code)
   :language: python

Usage
-----
Proper usage of this extension requires prerequisite knowledge of using the Slurm Workload Manager, and writing batch scripts for job submission. For more information please visit the `Slurm Documentation <https://slurm.schedmd.com/>`_ page, or seek further instruction through your institution's resources. 

Getting Started
~~~~~~~~~~~~~~~

After installing the extension and launching JupyterLab, the extension can be found in the command palette under
the name :python:`Slurm Queue Manager`, and is listed under the :python:`HPC TOOLS` section
of the palette and the JupyterLab launcher. Open the extension through either of these two access points. 

.. only:: html

   .. figure:: ../animations/getting_started.gif

      Launching the extension

User view vs. global view
~~~~~~~~~~~~~~~~~~~~~~~~~

By default, the extension will be launched in "user view", meaning only jobs registered under your username in the system will be displayed in the queue. If you wish to view the entire queue, click the toggle labelled "Show my jobs only", and the queue will be switched to "global view". Note that the underlying Slurm command for retrieving queue data, ``squeue``, is much more responsive for a smaller subset of jobs rather than the entire queue, so user view should be preferred unless you need to view other's jobs. 

.. only:: html

   .. figure:: ../animations/view_and_search.gif

      View switch and searching


.. note::
    Every field of the queue table is searchable via the :python:`Search` entry box on the top right of the extension's GUI. You can sort the table based off any column as well. This means it is very simple to show only your active jobs, held jobs, etc.  


Managing existing jobs in the queue
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

This extension provides an interface to three of the most common actions on existing jobs: :python:`Kill Job(s)`, :python:`Hold Job(s)`, and :python:`Release Job(s)`. The underlying Slurm commands used are ``scancel``, ``scontrol hold``, and ``scontrol release``, respectively. To carry out one of these actions on an existing job, simply select the row corresponding to the job, and click the appropriate button to submit the action. Multiple jobs can be selected by holding **Command**/**Ctrl** or **Shift** clicking, and then the same action can be requested on all selected jobs. Rows will become temporarily disabled until the request has finished. After a request completes, a manually dismissable alert will appear just beneath the queue, with background color corresponding to success (green) or failure (red).  

.. only:: html

   .. figure:: ../animations/manage_existing.gif

      Performing some actions on existing jobs. An action on another user's job fails.


Submitting new batch jobs
~~~~~~~~~~~~~~~~~~~~~~~~~

The Slurm extension also allows users to submit new jobs to the queue. The interface for doing so is accessed by clicking the :python:`Submit Job` button. This button will launch a form that provides two different methods of job submission. After the job submission request completes, a success/failure alert will be displayed. 

Submitting a job via path to existing batch script
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

The first field of the job submission form requires an absolute or relative path to an existing file that contains a valid batch script. The relative path is easy to acquire via the JupyterLab file browser, by right-clicking the desired file and selecting :python:`Copy Path`.

.. only:: html

   .. figure:: ../animations/submit_path.gif

      Submitting a job via existing file


Submitting a job via raw batch script
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

The second field of the job submission form will take in a raw batch script. This field can be good for writing a one-off script, or for pasting in an existing batch script and changing parameters on the fly.

.. only:: html

   .. figure:: ../animations/submit_script.gif

      Editing a batch script on the fly, and submitting the raw code

.. note::
    Sometimes submitting a job can take a long time! An alert message will appear once the job submission request has completed. We plan to add more visual feedback to indicate that a job submission is pending (e.g, a spinner) in the near future. 



