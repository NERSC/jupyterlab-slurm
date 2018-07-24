#import subprocess
import json
import re
import shlex
import asyncio

from notebook.utils import url_path_join
from notebook.base.handlers import IPythonHandler
from tornado.web import MissingArgumentError

class ShellExecutionHandler(IPythonHandler):
    async def run_command(self, command=None, stdin=None):
        self.log.debug("command: "+str(command))
        self.log.debug("stdin: "+str(stdin))
        def split_into_arguments(command):
            commands = shlex.split(command)
            #commands = command.strip().split(' ')
            return commands

        def bytes_to_strings(bytes):
            return bytes.decode().strip()
        
        def _log_function(self, message, stderr, stdout, returncode):
            self.log.error(message)
            self.log.error('STDERR: ' + bytes_to_strings(stderr))
            self.log.debug('STDOUT: ' + bytes_to_strings(stdout))
            self.log.debug('Return code: ' + str(returncode))

        commands = split_into_arguments(command)
        self.log.debug("commands: "+str(commands))

        process = await asyncio.create_subprocess_exec(*commands,
                                                           stdout=asyncio.subprocess.PIPE,
                                                           stderr=asyncio.subprocess.PIPE,
                                                           stdin=stdin)
        
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=60.0)

        except Exception as e:
            process.kill()
            stdout, stderr = await process.communicate()
            _log_function(self, 'Process failed to execute.', stderr, stdout, process.returncode)
            raise e
        else:
            if process.returncode != 0:
                _log_function(self, 'Process exited with return code that was non-zero.', stderr, stdout, process.returncode)
                raise
            
        return (bytes_to_strings(stdout), bytes_to_strings(stderr))

### Conventions:
## Query arguments: always settings for how to use or options provided by a SLURM command.
## Body arguments: always job designators, e.g. job ID, paths to SLURM scripts, input streams of SLURM script contents, etc.
## Path arguments: always commands (including commands sent to `scontrol`, e.g. `scontrol hold`/`scontrol resume`)

# Since this is idempotent, hypothetically one could also use PUT instead of DELETE here.
class ScancelHandler(ShellExecutionHandler):
    # Add `-H "Authorization: token <token>"` to the curl command for any DELETE request
    async def delete(self):
        jobIDs = self.get_body_arguments('jobID')
        self.log.debug("jobIDs: "+str(jobIDs))
        self.log.debug("command before joining: "+str(['scancel'] + jobIDs))
        stdout, stderr = await self.run_command(' '.join(['scancel'] + jobIDs))
        self.finish()

# scontrol isn't idempotent, so PUT isn't appropriate, and in general scontrol only modifies a subset of properties, so POST also is not ideal
class ScontrolHandler(ShellExecutionHandler):
    # Add `-H "Authorization: token <token>"` to the curl command for any PATCH request
    async def patch(self, command):
        job_list = ','.join(self.get_body_arguments('jobID'))
        self.log.debug("job_list: "+str(job_list))
        if command == 'hold' or command == 'release':
            stdout, stderr = await self.run_command(' '.join(['scontrol', command, job_list]))
            self.finish()
        else:
            raise NotImplementedError

# sbatch clearly isn't idempotent, and resource ID (i.e. job ID) isn't known when running it, so only POST works for the C in CRUD here, not PUT
class SbatchHandler(ShellExecutionHandler):
    # Add `-H "Authorization: token <token>"` to the curl command for any POST request
    async def post(self):
        def string_to_file(string):
            file_object = open('temporary_file.temporary', 'w')
            file_object.write(string)
            file_object.close()
            return
        
        scriptIs = self.get_query_argument('scriptIs')
        # Have two options to specify SLURM script in the request body: either with a path to the script, or with the script's text contents
        if scriptIs:
            if scriptIs == 'path':
                script_path = self.get_body_argument('script')
                stdout, stderr = await self.run_command('sbatch '+script_path)
            elif scriptIs == 'contents':
                self.log.debug("Body arguments: "+str(self.request.body_arguments))
                script_contents = self.get_body_argument('script')
                self.log.debug("script_contents: "+script_contents)
                string_to_file(script_contents)
                stdout, stderr = await self.run_command('sbatch', stdin=open('temporary_file.temporary','rb'))
                import os
                os.remove('temporary_file.temporary')
            else:
                self.log.debug("Body arguments: "+str(self.request.body_arguments))
                self.log.debug("Query arguments: "+str(self.request.query_arguments))
                raise Exception('The query argument scriptIs needs to be either \'path\' or \'contents\'.')

        else:
            self.log.debug("Body arguments: "+str(self.request.body_arguments))
            self.log.debug("Query arguments: "+str(self.request.query_arguments))
            raise MissingArgumentError('scriptIs')
        
        jobID = re.compile('([0-9]+)$').search(stdout).group(1)
        return jobID

# all squeue does is request information from SLURM scheduler, which is idempotent (for the "server-side"), so clearly GET request is appropriate here
class SqueueHandler(ShellExecutionHandler):
    async def get(self):
        data, stderr = await self.run_command('squeue')
        lines = data.split('\n')[1:] # exclude header row
        data_dict = {}
        data_list = []
        for line in lines:
            data_list += [[entry for entry in line.split()[:8]]]
        data_dict['data'] = data_list[:]
        # finish(chunk) writes chunk (any?) to the output 
        # buffer and ends the HTTP request
        self.finish(json.dumps(data_dict))
        
def load_jupyter_server_extension(nb_server_app):
    """
    Called when the extension is loaded.

    Args:
        nb_server_app (NotebookWebApplication): handle to the Notebook webserver instance.
    """
    print('Server extension loaded!')
    web_app = nb_server_app.web_app
    host_pattern = '.*$'

    def create_full_route_pattern_from(end_of_url_pattern):
        return url_path_join(web_app.settings['base_url'], end_of_url_pattern)
    
    scancel_route_pattern = create_full_route_pattern_from('/scancel')
    scontrol_route_pattern = create_full_route_pattern_from('/scontrol/(?P<command>.*)')
    sbatch_route_pattern = create_full_route_pattern_from('/sbatch')
    squeue_route_pattern = create_full_route_pattern_from('/squeue')

    web_app.add_handlers(host_pattern, [
        (scancel_route_pattern, ScancelHandler),
        (scontrol_route_pattern, ScontrolHandler),
        (sbatch_route_pattern, SbatchHandler),
        (squeue_route_pattern, SqueueHandler),
        ])
