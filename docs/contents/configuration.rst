.. _configuration:

Configuration
-------------

The `project repository <https://github.com/NERSC/jupyterlab-slurm>`_ contains a configuration file used for setting various parameters for the front end JupyterLab extension, ``src/slurm-config/config.json``. The following extension parameters are currently configurable:

* ``squeueURL``: The string appended to the ``baseUrl`` to create the endpoint for retrieving queue data from the server extension. The default value is ``/squeue``.
* ``autoReload``: If ``true``, the queue data will be reloaded automatically at a set interval. The default is ``false``.
* ``autoReloadRate``: The set time interval (in ms) for which the table will be automatically reloaded. The default is value is ``60000``.
* ``queueCols``: The names of the queue table's columns that will be displayed in the header; must be length 8. Default values correspond to the output of ``squeue``.
* ``cutoff``: The number of characters allowed to be displayed in a table cell before being truncated with an ellipses. The full output can be viewed through a tooltip when hovering over a truncated cell. The default value is ``16`` characters.
* ``wordbreak``: If ``true``, the content of a cell will be truncated at a word boundary. the default value is ``true``.
* ``escapeHtml``: If ``true``, the following characters are escaped for truncated cell data: ``<``, ``>``, ``&``, and ``"``. The default value is ``true``. 


More configuration options will likely be added in the future. To setup the extension with configuration parameters other than the defaults listed above, you will need to navigate to the `project repository <https://github.com/NERSC/jupyterlab-slurm>`_  and follow the directions for a development install of the JupyterLab extension. The server extension can still be installed directly from PyPi using ``pip``, since it is not configurable at this point. 