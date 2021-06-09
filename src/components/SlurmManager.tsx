import React from 'react';
import { Alert, AlertProps, Form } from 'react-bootstrap';

import { FileBrowser } from '@jupyterlab/filebrowser';

import { v4 as uuidv4 } from 'uuid';

// Local
import { requestAPI } from '../handler';
import DataTable from './DataTable';
import JobSubmitModal from './JobSubmitModal';

import * as config from '../slurm-config/config.json';

namespace types {
  // Delineate vs request status
  export type JobAction = 'kill' | 'hold' | 'release';
  export type JobStatus = 'sent' | 'received' | 'error';
  export type RequestStatusTable = Map<string, JobStatus>;

  export type Alert = AlertProps & {
    message: string;
  };

  export type Props = {
    filebrowser: FileBrowser;
    serverRoot: string;
    user: string;
  };

  export type State = {
    alerts: Alert[];
    jobSubmitModalVisible: boolean;
    jobSubmitError?: string;
    jobSubmitDisabled?: boolean;
    processingJobs: boolean;
    userOnly: boolean;
    reloading: boolean;
    userSubmit: boolean;
  };
}

export default class SlurmManager extends React.Component<
  types.Props,
  types.State
> {
  // The column index of job ID
  readonly JOBID_IDX = 0;
  // The column index of the username
  readonly USER_IDX = 3;
  // A Map of UUID to request status
  private requestStatusTable: types.RequestStatusTable;

  constructor(props: types.Props) {
    super(props);
    this.requestStatusTable = new Map<string, types.JobStatus>();
    this.state = {
      alerts: [],
      jobSubmitModalVisible: false,
      userOnly: config['userOnly'],
      processingJobs: false,
      reloading: false,
      userSubmit: false
    };
  }

  private toggleUserOnly() {
    const { userOnly } = this.state;
    this.setState({ userOnly: !userOnly });
  }

  private showJobSubmitModal() {
    this.setState({ jobSubmitModalVisible: true, userSubmit: false });
  }

  private hideJobSubmitModal() {
    this.setState({ jobSubmitModalVisible: false });
  }

  private addAlert(alert: types.Alert) {
    const { alerts } = this.state;
    this.setState({ alerts: alerts.concat([alert]) });
  }

  private async makeJobRequest(route: string, method: string, body: string) {
    const requestID = uuidv4();

    try {
      console.log(`Request for ${method} ${route}`);
      this.setState({ processingJobs: true });
      this.requestStatusTable.set(requestID, 'sent');
      requestAPI<any>(route, new URLSearchParams(), {
        body: body,
        method: method,
        headers: { 'Content-Type': 'application/json' }
      }).then(async result => {
        console.log('makeJobRequest()', result);
        //const result = await response.json();
        const alert: types.Alert = {
          message:
            result.responseMessage.length > 0
              ? result.responseMessage
              : result.errorMessage
        };
        if (result.returncode === 0) {
          alert.variant = 'success';
          this.requestStatusTable.set(requestID, 'received');
          // trigger a refresh of the table
          this.setState({ userSubmit: true });
        } else {
          alert.variant = 'danger';
          this.requestStatusTable.set(requestID, 'error');
          console.error(result.errorMessage);
        }
        this.addAlert(alert);
        // Remove request pending classes from the element;
        // the element may be a table row or the entire
        // extension panel
        // TODO: do something to row with matching job id
        // if (element) {
        //   element.removeClass("pending");
        // }
        // TODO: the alert and removing of the pending class
        // should probably occur after table reload completes,
        //  but we'll need to rework synchronization here..
        // If all current jobs have finished executing,
        // reload the queue (using squeue)
        let allJobsFinished = true;
        this.requestStatusTable.forEach((status, requestID) => {
          if (status === 'sent' || status === 'error') {
            allJobsFinished = false;
          }
        });
        if (allJobsFinished) {
          console.log('All jobs finished.');
        }
      });
    } catch (reason) {
      this.requestStatusTable.set(requestID, 'error');
      console.error(`Error on ${method} ${route}\n${reason}`);
    } finally {
      this.setState({ processingJobs: false, userSubmit: false });
    }
  }

  processSelectedJobs(action: types.JobAction, rows: string[][]): void {
    console.log(`processSelectedJobs(${action}, ${rows})`);
    const { route, method } = (action => {
      switch (action) {
        case 'kill':
          return { route: 'scancel', method: 'DELETE' };
        case 'hold':
          return { route: 'scontrol/hold', method: 'PATCH' };
        case 'release':
          return { route: 'scontrol/release', method: 'PATCH' };
      }
    })(action);
    // TODO: Change backend and do all of this in a single request
    rows.map(row => {
      const jobID = row[this.JOBID_IDX];
      this.makeJobRequest(route, method, JSON.stringify({ jobID }));
    });
  }

  private submitJob(input: string, inputType: string) {
    this.setState({ jobSubmitDisabled: true, processingJobs: true });
    let serverRoot = this.props.serverRoot;
    const filebrowser = this.props.filebrowser;
    //const fileBrowserRelativePath = filebrowser.model.path;
    if (serverRoot !== '/') {
      // Add trailing slash, but not to '/'
      serverRoot += '/';
    }
    const fileBrowserPath = serverRoot + filebrowser.model.path;
    const outputDir = encodeURIComponent(fileBrowserPath);

    console.log('input', input);
    console.log('inputType', inputType);

    requestAPI<any>(
      'sbatch',
      new URLSearchParams(`?inputType=${inputType}&outputDir=${outputDir}`),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: input })
      }
    )
      .then(result => {
        console.log('sbatch result', result);
        if (result['returncode'] !== 0) {
          this.setState({
            jobSubmitError:
              result['errorMessage'] === ''
                ? result['responseMessage']
                : result['errorMessage'],
            jobSubmitDisabled: false,
            processingJobs: false,
            userSubmit: false
          });
        } else {
          this.setState({ userSubmit: true });
          this.hideJobSubmitModal();
          this.setState({
            jobSubmitDisabled: false,
            processingJobs: false,
            userSubmit: true
          });
        }
      })
      .catch(error => {
        this.setState({
          jobSubmitError: `Unknown error encountered while submitting the script. Try again later. Error: ${error}`,
          jobSubmitDisabled: false,
          processingJobs: false,
          userSubmit: false
        });
      });
  }

  render(): React.ReactNode {
    /** TODO - We should get rid of this. If we need a higher level item to perform actions, we can create a dispatch system */
    const buttons = [
      {
        name: 'Submit Job',
        id: 'submit-job',
        action: () => {
          this.showJobSubmitModal();
        },
        props: {
          variant: 'primary' as const
        }
      },
      {
        action: 'reload' as const,
        id: 'reload',
        props: {
          variant: 'secondary' as const
        }
      },
      {
        action: 'clear-selected' as const,
        id: 'clear-selected',
        props: {
          variant: 'warning' as const
        }
      },
      {
        name: 'Kill Selected Job(s)',
        id: 'kill-selected',
        action: (rows: string[][]) => {
          this.processSelectedJobs('kill', rows);
        },
        props: {
          variant: 'danger' as const
        }
      },
      {
        name: 'Hold Selected Job(s)',
        id: 'hold-selected',
        action: (rows: string[][]) => {
          this.processSelectedJobs('hold', rows);
        },
        props: {
          variant: 'danger' as const
        }
      },
      {
        name: 'Release Selected Job(s)',
        id: 'release-selected',
        action: (rows: string[][]) => {
          this.processSelectedJobs('release', rows);
        },
        props: {
          variant: 'danger' as const
        }
      }
    ];
    const { alerts, jobSubmitModalVisible } = this.state;
    return (
      <>
        <DataTable
          buttons={buttons}
          availableColumns={config['queueCols']}
          userOnly={this.state.userOnly}
          processing={this.state.processingJobs}
          reloading={this.state.reloading}
          userSubmit={this.state.userSubmit}
        />
        <div>
          <Form.Check
            type="checkbox"
            id="user-only-checkbox"
            label="Show my jobs only"
            onChange={this.toggleUserOnly.bind(this)}
            defaultChecked={config['userOnly']}
          />
        </div>
        <div id="alertContainer" className="container alert-container">
          {alerts.map((alert, index) => (
            <Alert
              variant={alert.variant}
              key={`alert-${index}`}
              dismissible
              onClose={() => {
                this.state.alerts.splice(index, 1);
                this.setState({});
              }}
            >
              {alert.message}
            </Alert>
          ))}
        </div>
        <JobSubmitModal
          show={jobSubmitModalVisible}
          error={this.state.jobSubmitError}
          onHide={this.hideJobSubmitModal.bind(this)}
          submitJob={this.submitJob.bind(this)}
          disabled={this.state.jobSubmitDisabled}
        />
      </>
    );
  }
}
