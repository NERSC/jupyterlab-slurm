import subprocess

from notebook.utils import url_path_join
from notebook.base.handlers import IPythonHandler

class ShellExecutionHandler(IPythonHandler):
    # Use @asynchronous decorator?
    def get(self, command):
        response = run_command(command.strip().split("/"))
        # finish(chunk) writes chunk to the output buffer and ends the HTTP request
        self.finish(response.stdout.strip())

def load_jupyter_server_extension(nb_server_app):
    """
    Called when the extension is loaded.

    Args:
        nb_server_app (NotebookWebApplication): handle to the Notebook webserver instance.
    """
    print("extension loaded!")
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