import {
    PageConfig, URLExt
} from '@jupyterlab/coreutils';

import {
    FileBrowser,
} from '@jupyterlab/filebrowser'

import {
    Widget
} from '@phosphor/widgets';

import {
    Message
} from '@phosphor/messaging';

import {renderTable} from './renderTable';

import * as $ from 'jquery';

import 'datatables.net';
import 'datatables.net-buttons-dt';
import 'datatables.net-buttons';
import 'datatables.net-select';

import * as config from './slurm-config/config.json';

export class SlurmWidget extends Widget {
  // The table element containing Slurm queue data.
  private queueTable: HTMLElement;
  // The column index of job ID
  readonly JOBID_IDX = 0;
  // The column index of the username
  readonly USER_IDX = 3;
  // A cache for storing global queue data
  public dataCache: DataTables.Api;
  // The system username, fetched from the server
  public user: string;
  // JupyterLab's file browser
  private filebrowser : FileBrowser;
  // path where JupyterLab is being run
  private serverRoot : string;

  constructor(filebrowser: FileBrowser) {
    super();
    this.id = 'jupyterlab-slurm';
    this.title.label = 'Slurm Queue Manager';
    this.title.closable = true;
    this.addClass('jp-SlurmWidget');

    this.filebrowser = filebrowser;
    this.serverRoot  = PageConfig.getOption('serverRoot');

    this.queueTable = document.createElement('table');
    this.queueTable.setAttribute('id', 'queue');
    this.queueTable.setAttribute('width', '100%');
    this.queueTable.setAttribute('style', 'font:14px');

    // These css class definitions are from the DataTables default styling package
    // See: https://datatables.net/manual/styling/classes#display
    this.queueTable.classList.add('order-column', 'cell-border');
    this.node.appendChild(this.queueTable);

    // Add thead to queueTable, and define column names;
    // this is required for DataTable's AJAX functionality.
    let tableHead = document.createElement('thead');
    this.queueTable.appendChild(tableHead);
    let headRow = tableHead.insertRow(0);
    let cols = config["queueCols"]; // ["JOBID", "PARTITION", "NAME", "USER", "ST", "TIME", "NODES", "NODELIST(REASON)"];
    for (let i = 0; i < cols.length; i++) {
      let h = document.createElement('th');
      let t = document.createTextNode(cols[i]);
      h.appendChild(t);
      headRow.appendChild(h);
    }

    // reference to this SlurmWidget object for use in functions where THIS
    // is overridden by a parent object
    var self = this;

    // Fetch the user name from the server extension; this will be
    // used in the initComplete method once this request completes,
    // and after the table is fully initialized.
    let userRequest = $.ajax({
      url: '/user',
      success: function(result) {
        self.user = result;
        console.log("user: ", self.user);
      }
    });
    renderTable(self, userRequest);
  }

  private reloadDataTable(dt: DataTables.Api) {
    // reload the data table
    dt.ajax.reload(null, false);
  }

  private submitRequest(cmd: string, requestType: string, body: string,
                        element: JQuery = null, jobCount: any = null) {
    // The base URL that prepends the command path -- necessary for hub functionality
    let baseUrl = PageConfig.getOption('baseUrl');
    // Prepend command with the base URL to yield the final endpoint
    let endpoint = URLExt.join(baseUrl, cmd);
    fetch(endpoint, {
      method: requestType,
      headers: {
        // add Jupyter authorization (XRSF) token to request header
        'Authorization': 'token ' + PageConfig.getToken(),
        // prevent it from enconding as plain-text UTF-8, which is the default and screws everything up
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body,
    }).then(response => {
      if (response.status !== 200) {
        throw Error(response.statusText);
      }
      return response.json();
    }).then(response => {
      this.setJobCompletedTasks(response, element, jobCount);
    }).catch(error => {
      console.log(error);
    });
  }

  public runOnSelectedRows(cmd: string, requestType: string, dt: DataTables.Api) {
    // Run CMD on all selected rows, by submitting a unique request for each
    // selected row. Eventually we may want to change the logic for this functionality
    // such that only one request is made with a list of Job IDs instead of one request
    // per selected job. Changes will need to be made on the back end for this to work

    let selected_data = dt.rows( { selected: true } ).data().toArray();
    dt.rows( {selected: true } ).deselect();
    let jobCount = { numJobs: selected_data.length, count: 0 };
    for (let i = 0; i < selected_data.length; i++) {
       let jobID = selected_data[i][this.JOBID_IDX];
       // Add the request pending classes to the selected row
       $("#"+jobID).addClass("pending");
       this.submitRequest(cmd, requestType, 'jobID='+jobID, $("#"+jobID), jobCount);

    }
  };

  private submitJob(input: string, inputType: string) {
    let fileBrowserRelativePath = this.filebrowser.model.path;
    if (this.serverRoot != '/') {
        var fileBrowserPath = this.serverRoot + '/' + fileBrowserRelativePath;
    } else {
        // Because paths are given relative to `` instead of `/` in this case for some reason
	var fileBrowserPath = this.serverRoot + fileBrowserRelativePath;}
    let queryArguments = {"inputType" : inputType, "outputDir" : encodeURIComponent(fileBrowserPath)};
    let queryString = 'inputType=' + queryArguments.inputType + '&' + 'outputDir=' + queryArguments.outputDir;
    this.submitRequest('/sbatch?' + queryString, 'POST', 'input=' + encodeURIComponent(input));
  }

  public submitJobPath(input: string) {
    this.submitJob(input, "path");
  };

  public submitJobScript(input: string) {
    this.submitJob(input, "contents");
  };


  private setJobCompletedTasks(response: any, element: JQuery, jobCount: any) {
    let alert = document.createElement('div');
    if (response.returncode == 0) {
      alert.classList.add('alert', 'alert-success', 'alert-dismissable', 'fade', 'show');
    }
    else {
      alert.classList.add('alert', 'alert-danger', 'alert-dismissable', 'fade', 'show');
    }
    let temp = document.createElement('div');
    let closeLink = '<a href="#" class="close" data-dismiss="alert" aria-label="close">&times;</a>';
    temp.innerHTML = closeLink;
    alert.appendChild(temp.firstChild);

    console.log(response.errorMessage);
    let alertText = document.createTextNode(response.responseMessage);
    alert.appendChild(alertText);
    $('#alertContainer').append(alert);

    // Remove request pending classes from the element;
    // the element may be a table row or the entire
    // extension panel
    if (element) {
      element.removeClass("pending");
    }

    // TODO: the alert and removing of the pending class
    // should probably occur after table reload completes,
    //  but we'll need to rework synchronization here..

    // If all current jobs have finished executing,
    // reload the queue (using squeue)
    if (jobCount) {
      // By the nature of javascript's sequential function execution,
      // this will not cause a race condition
      jobCount.count++;
      if (jobCount.numJobs == jobCount.count) {
        this.reloadDataTable($('#queue').DataTable());
      }
    }
    else {
        this.reloadDataTable($('#queue').DataTable());
    }
  };

  /**
  * Reloads the queue table by using DataTables
  * AJAX functionality, which reloads only the data that
  * is needed. NOTE: This method is called
  * when widget.update() is called, and the false
  * param passed to ajax.reload(..) indicates that the table's
  * pagination will not be reset upon reload, which does
  * require some overhead due to sorting, etc.
  */
  public onUpdateRequest(msg: Message) {
    this.reloadDataTable($('#queue').DataTable());
  };

} // class SlurmWidget