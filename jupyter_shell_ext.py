import subprocess
import json

from notebook.utils import url_path_join
from notebook.base.handlers import IPythonHandler

class ShellExecutionHandler(IPythonHandler):
    # Use @asynchronous decorator?
    def get(self, command):
        response = run_command(command.strip().split("/"))
        # finish(chunk) writes chunk to the output buffer and ends the HTTP request
        # Should probably process data here (on the server) and put it in a nice
        # format for loading into a table, instead of on the server!!!!
        data = response.stdout.strip()

        
        lines = data.split('\n')
        col_names = lines[0].split()
        data_dict = {}
        data_list = []

        for line in lines:
            data_list += [[entry for entry in line.split()[:5]]]
        data_dict["data"] = data_list[:]

        # for line in lines:
        #     data_list += {col_names[i]: entry 
        #     for i, entry in enumerate(line.split()[:5])}
        # data_dict["data"] = data_list[:]

        # print("GET called!")
        # self.finish(response.stdout.strip())
        # self.finish(json.dumps(data_list))
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