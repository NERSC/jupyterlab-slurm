import React, { Component } from 'react';
import {
  Alert,
  AlertProps,
  Form,
} from 'react-bootstrap';

import {
  FileBrowser,
} from '@jupyterlab/filebrowser';

import {
  v4 as uuidv4
} from 'uuid';

// Local
import { makeRequest } from '../utils';
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
    userOnly: boolean
  };
}

export default class SlurmManager extends Component<types.Props, types.State> {
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
    };
  }

  private toggleUserOnly() {
    const { userOnly } = this.state;
    this.setState({ userOnly: !userOnly });
  }

  private showJobSubmitModal() {
    this.setState({ jobSubmitModalVisible: true });
  }

  private hideJobSubmitModal() {
    this.setState({ jobSubmitModalVisible: false });
  }

  private addAlert(alert: types.Alert) {
    const { alerts } = this.state;
    this.setState({ alerts: alerts.concat([alert]) });
  }

  private async makeJobRequest(route: string, method: string, body: string) {
    const beforeResponse = () => {
      const requestID = uuidv4();
      this.requestStatusTable.set(requestID, 'sent');
      return [requestID];
    }
    const afterResponse = async (response: Response, requestID: string) => {
      if (response.status !== 200) {
        this.requestStatusTable.set(requestID, 'error');
        throw Error(response.statusText);
      }
      else {
        const json = await response.json();
        let alert: types.Alert = { message: json.responseMessage };
        if (json.returncode === 0) {
          alert.variant = 'success';
          this.requestStatusTable.set(requestID, 'received');
        }
        else {
          alert.variant = 'danger';
          this.requestStatusTable.set(requestID, 'error');
          console.log(json.errorMessage);
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
          // TODO: this.reloadDataTable($('#queue').DataTable());
          console.log('All jobs finished.');
        }
      }
    }
    makeRequest({ route, method, body, beforeResponse, afterResponse } as const)
  }

  processSelectedJobs(action: types.JobAction, rows: string[][]) {
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

  async getData() {
    const { userOnly } = this.state;
    const data = await makeRequest({
      route: 'squeue',
      method: 'GET',
      query: `?userOnly=${userOnly}`,
      afterResponse: async (response) => {
        if (response.status !== 200) {
          throw Error(response.statusText);
        }
        else {
          let data = await response.json();
          return data.data;
        }
      },
    });
    return data;
  }

  private submitJob(input: string, inputType: string) {
    this.setState({ jobSubmitDisabled: true });
    let { serverRoot, filebrowser } = this.props;
    const fileBrowserRelativePath = filebrowser.model.path;
    if (serverRoot !== '/') { // Add trailing slash, but not to '/'
      serverRoot += '/';
    }
    const fileBrowserPath = serverRoot + fileBrowserRelativePath;
    const outputDir = encodeURIComponent(fileBrowserPath);
    makeRequest({
      route: 'sbatch',
      method: 'POST',
      query: `?inputType=${inputType}&outputDir=${outputDir}`,
      body: JSON.stringify({ "input": input }),
      afterResponse: async (response: Response) => {
        if (response.ok) {
          return await response.json();
        }
        return null;
      }
    }).then((result) => {
      if (result === null) {
        this.setState({
          jobSubmitError: "Unknown error encountered while submitting the script. Try again later.",
          jobSubmitDisabled: false
        })
      }
      if (result["returncode"] !== 0) {
        this.setState({
          jobSubmitError: result["errorMessage"] == "" ? result["responseMessage"] : result["errorMessage"],
          jobSubmitDisabled: false
        });
      } else {
        this.hideJobSubmitModal();
        this.setState({ jobSubmitDisabled: false });
      }
    });
  }

  render() {
    /** We should get rid of this. If we need a higher level item to perform actions, we can create a dispatch system */
    const buttons = [{
      name: 'Submit Job',
      id: 'submit-job',
      action: () => { this.showJobSubmitModal(); },
      props: {
        variant: 'primary' as const,
      },
    }, {
      action: 'reload' as const,
      id: 'reload',
      props: {
        variant: 'secondary' as const,
      },
    }, {
      action: 'clear-selected' as const,
      id: 'clear-selected',
      props: {
        variant: 'warning' as const,
      },
    }, {
      name: 'Kill Selected Job(s)',
      id: 'kill-selected',
      action: (rows) => { this.processSelectedJobs('kill', rows); },
      props: {
        variant: 'danger' as const,
      },
    }, {
      name: 'Hold Selected Job(s)',
      id: 'hold-selected',
      action: (rows) => { this.processSelectedJobs('hold', rows); },
      props: {
        variant: 'danger' as const,
      },
    }, {
      name: 'Release Selected Job(s)',
      id: 'release-selected',
      action: (rows) => { this.processSelectedJobs('release', rows); },
      props: {
        variant: 'danger' as const,
      },
    }];
    const { alerts, jobSubmitModalVisible } = this.state;
    return (
      <>
        <DataTable
          getRows={this.getData.bind(this)}
          buttons={buttons}
          availableColumns={config['queueCols']}
        />
        <div>
          <Form.Check
            type="checkbox"
            id="user-only-checkbox"
            label="Show my jobs only"
            onChange={this.toggleUserOnly.bind(this)}
          />
        </div>
        <div id="alertContainer" className="container alert-container">
          {alerts.map((alert, index) => (
            <Alert variant={alert.variant} key={`alert-${index}`} dismissible onClose={() => {
              this.state.alerts.splice(index, 1);
              this.setState({});
            }}>
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
