PYTHONPATH=$(pwd):$PYTHONPATH jupyter lab --ip=0.0.0.0 --watch --NotebookApp.nbserver_extensions="{'jupyter_shell_ext':True}"
