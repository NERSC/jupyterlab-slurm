import React from 'react';
import { Alert, Badge, Tab, Tabs } from 'react-bootstrap';
import { FileBrowser } from '@jupyterlab/filebrowser';
import { v4 as uuidv4 } from 'uuid';
import { uniqueId } from 'lodash';

// Local
import { requestAPI } from '../handler';
import SqueueDataTable from './SqueueDataTable';
import JobSubmitForm from './JobSubmitForm';
import { ISlurmUserSettings, JobAction } from '../types';

namespace types {
  // Delineate vs request status
  export type JobStatus = 'sent' | 'received' | 'error';
  export type RequestStatusTable = Map<string, JobStatus>;

  export type Props = {
    filebrowser: FileBrowser;
    settings: ISlurmUserSettings;
    serverRoot: string;
    user: string;
  };

  export type State = {
    activeTab: string;
    alerts: React.ReactElement[];
    jobSubmitModalVisible: boolean;
    jobSubmitDisabled?: boolean;
    jobsPending: number;
    jobErrors: Array<string>;
    userOnly: boolean;
    queueCols: Array<string>;
    reloadQueue: boolean;
    autoReload: boolean;
    autoReloadRate: number;
    theme: string;
  };
}

export default class SlurmManager extends React.Component<
  types.Props,
  types.State
> {
  // The column index of job ID
  private JOBID_IDX: string;
  // A Map of UUID to request status
  private requestStatusTable: types.RequestStatusTable;

  constructor(props: types.Props) {
    super(props);
    this.requestStatusTable = new Map<string, types.JobStatus>();

    const userOnly: boolean = props.settings.userOnly as boolean;
    const autoReload: boolean = props.settings.autoReload as boolean;
    const autoReloadRate: number = props.settings.autoReloadRate as number;
    const queueCols: Array<string> = props.settings.queueCols as Array<string>;
    this.JOBID_IDX = queueCols[0];

    // bind the functions for passing to child components
    this.processSelectedJobs = this.processSelectedJobs.bind(this);
    this.makeJobRequest = this.makeJobRequest.bind(this);
    this.addAlert = this.addAlert.bind(this);
    this.submitJob = this.submitJob.bind(this);

    this.state = {
      activeTab: 'jobQueue',
      alerts: [],
      jobSubmitModalVisible: false,
      userOnly: userOnly,
      jobsPending: 0,
      jobErrors: [],
      queueCols: queueCols,
      reloadQueue: false,
      autoReload: autoReload,
      autoReloadRate: autoReloadRate,
      theme: 'default'
    };
  }

  addAlert(message: string, variant: string): void {
    const alert_id: string = uniqueId('jp-SlurmWidget-alert');
    const alert = (
      <Alert
        id={alert_id}
        variant={variant}
        onClose={() => this.removeAlert(alert_id)}
        dismissible
      >
        {message}
      </Alert>
    );
    this.setState(prevState => {
      // add new alert to previous alerts
      return { alerts: this.state.alerts.concat([alert]) };

      // reset alerts to be only 1 element
      // return { alerts: [alert] };
    });
  }

  removeAlert(id: string): void {
    const updated_alerts: React.ReactElement[] = [];
    let i;
    for (i = 0; i < this.state.alerts.length; i++) {
      if (this.state.alerts[i].props.id !== id) {
        updated_alerts.push(this.state.alerts[i]);
      }
    }
    this.setState(prevState => {
      return { alerts: updated_alerts };
    });
  }

  private async makeJobRequest(
    route: string,
    method: string,
    jobID: string
  ): Promise<void> {
    const requestID = uuidv4();
    const body = JSON.stringify({ jobID: jobID });

    try {
      //console.log(`Request for ${method} ${route}`);
      this.requestStatusTable.set(requestID, 'sent');
      requestAPI<any>(route, new URLSearchParams(), {
        body: body,
        method: method,
        headers: { 'Content-Type': 'application/json' }
      }).then(async result => {
        //console.log('makeJobRequest()', result);

        if (result.returncode === 0) {
          this.addAlert(result.responseMessage, 'success');
          this.requestStatusTable.set(requestID, 'received');
          // trigger a refresh of the table
          this.setState({ reloadQueue: true });
        } else {
          console.error(result.errorMessage);
          this.addAlert(result.errorMessage, 'danger');
          this.requestStatusTable.set(requestID, 'error');
        }
      });
    } catch (reason) {
      console.error(`Error on ${method} ${route}\n${reason}`);
      this.addAlert(`Error on ${method} ${route}\n${reason}`, 'danger');
      this.requestStatusTable.set(requestID, 'error');
    }
  }

  async processSelectedJobs(
    action: JobAction,
    rows: Record<string, unknown>[]
  ): Promise<void> {
    //console.log(`processSelectedJobs(${action}, rows)`);
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
    // TODO: Decide if it makes sense to combine requests for fewer calls
    rows.map(async row => {
      const jobID = String(row[this.JOBID_IDX]);
      this.setState(prevState => {
        return { jobsPending: prevState.jobsPending + 1 };
      });
      await this.makeJobRequest(route, method, jobID).then(() => {
        if (this.state.jobsPending > 0) {
          this.setState(prevState => {
            return { jobsPending: prevState.jobsPending - 1 };
          });
        }
      });
    });
  }

  private submitJob(input: string, inputType: string) {
    this.setState(prevState => {
      return {
        jobSubmitDisabled: true,
        jobsPending: this.state.jobsPending + 1
      };
    });
    let serverRoot = this.props.serverRoot;
    let contents;
    const filebrowser = this.props.filebrowser;
    if (serverRoot !== '/') {
      // Add trailing slash, but not to '/'
      serverRoot += '/';
    }
    const fileBrowserPath = serverRoot + filebrowser.model.path;
    const outputDir = encodeURIComponent(fileBrowserPath);

    if (inputType === 'path' && !input.startsWith('/')) {
      contents = serverRoot + input;
    } else {
      contents = input;
    }

    //console.log('submitJob() ', serverRoot, fileBrowserPath);
    console.log('Submitting new batch job: ', inputType, contents);

    requestAPI<any>(
      'sbatch',
      new URLSearchParams(`?inputType=${inputType}&outputDir=${outputDir}`),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: contents })
      }
    )
      .then(result => {
        let reload = true;
        //console.log('sbatch result', result);
        if (result['returncode'] !== 0) {
          this.addAlert(
            result['errorMessage'] === ''
              ? result['responseMessage']
              : result['errorMessage'],
            'danger'
          );
          reload = false;
        }
        this.setState(prevState => {
          return {
            reloadQueue: reload,
            jobSubmitDisabled: false,
            jobsPending: prevState.jobsPending - 1
          };
        });
      })
      .catch(error => {
        this.addAlert(
          'Unknown error encountered while submitting the script. Try again later. Error: ' +
            error,
          'danger'
        );
        this.setState(prevState => {
          return {
            jobSubmitDisabled: false,
            jobsPending: prevState.jobsPending - 1
          };
        });
      });
  }

  componentDidUpdate(
    prevProps: Readonly<types.Props>,
    prevState: Readonly<types.State>
  ): void {
    if (
      this.state.reloadQueue &&
      this.state.jobsPending === 0 &&
      prevState.jobsPending === 0
    ) {
      this.setState({ reloadQueue: false });
    }
  }

  render(): React.ReactNode {
    const alerts = this.state.alerts;

    return (
      <div className={'jp-SlurmWidget-main'}>
        <Tabs
          id="slurm-tabs"
          activeKey={this.state.activeTab}
          onSelect={k => {
            this.setState({ activeTab: k });
          }}
        >
          <Tab title="Slurm Queue" eventKey="jobQueue">
            <SqueueDataTable
              processJobAction={this.processSelectedJobs}
              availableColumns={this.state.queueCols}
              userOnly={this.state.userOnly}
              processing={this.state.jobsPending > 0}
              reloadQueue={this.state.reloadQueue}
              reloadRate={this.state.autoReloadRate}
              autoReload={this.state.autoReload}
              itemsPerPage={this.props.settings.itemsPerPage}
              itemsPerPageOptions={this.props.settings.itemsPerPageOptions}
            />
          </Tab>
          <Tab title="Submit Jobs" eventKey="jobSubmit">
            <JobSubmitForm
              filebrowser={this.props.filebrowser}
              submitJob={this.submitJob.bind(this)}
              disabled={this.state.jobSubmitDisabled}
              addAlert={this.addAlert}
              active={this.state.activeTab === 'jobSubmit'}
            />
          </Tab>
          <Tab
            className={'jp-SlurmWidget-JobNotifications'}
            title={
              <React.Fragment>
                Job Notifications
                <Badge className="ml-2" variant="info">
                  {this.state.alerts.length}
                </Badge>
              </React.Fragment>
            }
            eventKey="jobHistory"
          >
            {alerts}
          </Tab>
        </Tabs>
      </div>
    );
  }
}
