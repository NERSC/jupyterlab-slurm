#import subprocess
import json
import re
#import shlex
import asyncio

from notebook.utils import url_path_join
from notebook.base.handlers import IPythonHandler

class ShellExecutionHandler(IPythonHandler):
    # Use @asynchronous decorator?
    async def get(self, command):
        kill = re.search("kill/(.*)", command)
        if kill:
            await self.run_command(command)
            # can add response as the parameter to finish to send output
            # back to the extension, in case we want to display such info to
            # the user
            self.finish()
        else:
            data = await self.run_command(command)
            lines = data.split('\n')[1:] # exclude header row
            # col_names = lines[0].split()
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

    async def run_command(self, command):
        def split_into_arguments(command):
            #commands = shlex.split(command)
            commands = command.strip().split("/")
            return commands
        
        def bytes_to_strings(bytes):
            return bytes.decode().strip()

        def _log_function(self, message, stderr, stdout, returncode):
            self.log.error(message)
            self.log.error("STDERR: " + bytes_to_strings(stderr))
            self.log.debug("STDOUT: " + bytes_to_strings(stdout))
            self.log.debug("Return code: " + str(returncode))

        commands = split_into_arguments(command)

        process = await asyncio.create_subprocess_exec(*commands,
                                                           stdout=asyncio.subprocess.PIPE,
                                                           stderr=asyncio.subprocess.PIPE)
        
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=60.0)

        except Exception as e:
            process.kill()
            stdout, stderr = await process.communicate()
            _log_function(self, "Process failed to execute.", stderr, stdout, process.returncode)
            raise e
        else:
            if process.returncode != 0:
                _log_function(self, "Process exited with return code that was non-zero.", stderr, stdout, process.returncode)
                raise
            
        return bytes_to_strings(stdout)

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

