import subprocess
import json
import re

from notebook.utils import url_path_join
from notebook.base.handlers import IPythonHandler

class ShellExecutionHandler(IPythonHandler):
    # Use @asynchronous decorator?
    def get(self, command):
        kill = re.search("kill/(.*)", command)
        if kill:
            run_command(command.strip().split('/'))
            # can add response as the parameter to finish to send output
            # back to the extension, in case we want to display such info to
            # the user
            self.finish(command)
        else:
            response = run_command(command.strip().split("/"))
            data = response.stdout.strip()
            lines = data.split('\n')[1:] # exclude header row
            col_names = lines[0].split()
            data_dict = {}
            data_list = []
            for line in lines:
                # TODO: remove the hard coding of five elements per line
                #       this was just in place to temporarily deal with
                #       ps aux's messy output
                data_list += [[entry for entry in line.split()[:8]]]
            data_dict["data"] = data_list[:]
            # finish(chunk) writes chunk (any?) to the output 
            # buffer and ends the HTTP request
            self.finish(json.dumps(data_dict))

def load_jupyter_server_extension(nb_server_app):
    """
    Called when the extension is loaded.

    Args:
        nb_server_app (NotebookWebApplication): handle to the Notebook webserver instance.
    """
    print("server extension loaded!")
    web_app = nb_server_app.web_app
    host_pattern = '.*$'
    route_pattern = url_path_join(web_app.settings['base_url'], '/shell/(.*)')
    web_app.add_handlers(host_pattern, [(route_pattern, ShellExecutionHandler)])

def run_command(cmd):
    try:
        return subprocess.run(cmd,
            stderr=subprocess.PIPE,
            stdout=subprocess.PIPE,
            check=True, timeout=60, encoding="utf-8")
    except subprocess.CalledProcessError as e:
        print("Error:", e.stderr)
        raise e 
        # maybe catch 404 errors, and handle them with
        # tornado.web.Finish, an exception which doesn't 
        # produce an error response (maybe put try/catch
        # in get method)

        