import os

class SlurmControllerMock:

    def __init__(self):
        # Backing data lives in tests/data to be shared across mock commands
        data_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'squeue_test_data.txt')
        data_path = os.path.normpath(data_path)
        # We always read from the file which was initialized by the test fixture
        with open(data_path, 'r') as f:
            self.raw_data = f.read()
            
        self.jobs = {}
        for line in self.raw_data.splitlines():
            job_info = line.split()
            if not job_info: continue
            job_id = job_info[0]
            self.jobs[job_id] = job_info

    def get_queued_jobs(self):
        return self.raw_data

    def submit_job(self, job=None):
        print('submit: ' + job)
        print(list(self.jobs.items())[0])
        self.jobs['999000'] = ['999000', 'test_user', 'test_submit_job', '/home/test', 'PD', '1', '']
        return '999000'

    def cancel_job(self, job_ids=None):
        if job_ids is None:
            job_ids = []
        print('cancel: ' + job_ids)
        for ji in job_ids:
            del self.jobs[ji]

    def pause_job(self, job_ids=None):
        if job_ids is None:
            job_ids = []
        print('pause: ' + job_ids)
        for ji in job_ids:
            self.jobs[ji][-3] = 'H'

    def resume_job(self, job_ids=None):
        if job_ids is None:
            job_ids = []
        print('resume: ' + job_ids)
        for ji in job_ids:
            self.jobs[ji][-3] = 'R'
