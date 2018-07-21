#import subprocess
import json
import re
#import shlex
import asyncio

from notebook.utils import url_path_join
from notebook.base.handlers import IPythonHandler

class ShellExecutionHandler(IPythonHandler):
    async def run_command(self, command=None, stdin=None):
        def split_into_arguments(command):
            #commands = shlex.split(command)
            commands = command.strip().split('/')
            return commands
        
        def bytes_to_strings(bytes):
            return bytes.decode().strip()

        def _log_function(self, message, stderr, stdout, returncode):
            self.log.error(message)
            self.log.error('STDERR: ' + bytes_to_strings(stderr))
            self.log.debug('STDOUT: ' + bytes_to_strings(stdout))
            self.log.debug('Return code: ' + str(returncode))

        commands = split_into_arguments(command)

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
        stdout, stderr = await self.run_command(' '.join(jobIDs.insert(0, 'scancel')))
        self.finish()

# scontrol isn't idempotent, so PUT isn't appropriate, and in general scontrol only modifies a subset of properties, so POST also is not ideal
class ScontrolHandler(ShellExecutionHandler):
    # Add `-H "Authorization: token <token>"` to the curl command for any PATCH request
    async def patch(self, command):
        job_list = ','.join(self.get_body_arguments('jobID'))
        if command == 'hold' or command == 'release':
            stdout, stderr = await self.run_command(' '.join(['scontrol', command, job_list]))
            self.finish()
        else:
            raise NotImplementedError

# sbatch clearly isn't idempotent, and resource ID (i.e. job ID) isn't known when running it, so only POST works for the C in CRUD here, not PUT
class SbatchHandler(ShellExecutionHandler):
    # Add `-H "Authorization: token <token>"` to the curl command for any POST request
    async def post(self):
        # Have two options to specify SLURM script in the request body: either with a path to the script, or with the script's text contents
        scriptIs = self.get_query_argument('scriptIs')

        if scriptIs == 'path':
            script_path = self.get_body_argument('script')
            stdout, stderr = await self.run_command('sbatch '+script_path)


        if scriptIs == 'contents':
            script_contents = self.get_body_argument('script')
            stdout, stderr = await self.run_command('sbatch', stdin=script_contents.encode())

        else:
            raise tornado.web.MissingArgumentError('scriptIs')
        
        jobID = re.compile('([0-9]+)$').search(stdout).group(1)
        return jobID

# just requesting information from SLURM scheduler which is idempotent (for the "server-side"), so clearly GET request is appropriate here
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
