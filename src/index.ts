import {
  JupyterLab, 
  JupyterLabPlugin, 
  ILayoutRestorer
} from '@jupyterlab/application';

import {
  ICommandPalette, 
  InstanceTracker
} from '@jupyterlab/apputils';

import { 
  ILauncher 
} from '@jupyterlab/launcher';

import {
  PageConfig, URLExt
} from '@jupyterlab/coreutils';

import {
  JSONExt 
} from '@phosphor/coreutils';

import {
  Message
} from '@phosphor/messaging';

import {
  Widget
} from '@phosphor/widgets';

import * as $ from 'jquery';
import 'datatables.net-dt/css/jquery.dataTables.css';
import 'datatables.net';
import 'datatables.net-buttons-dt';
import 'datatables.net-buttons';
import 'datatables.net-select';


import 'bootstrap/dist/css/bootstrap.css';
import 'bootstrap/dist/js/bootstrap.js';

import '../style/index.css';

/**
 * The class names for the Slurm extension icon, for launcher and
 * tab, respectively
 */
const SLURM_ICON_CLASS_L = 'jp-NerscLaunchIcon';
const SLURM_ICON_CLASS_T = 'jp-NerscTabIcon';

// The number of milliseconds a user must wait in between Refresh requests
// This limits the number of times squeue is called, in order to avoid
// overloading the Slurm workload manager

// The interval (milliseconds) in which the queue data automatically reloads
// by calling squeue
const AUTO_SQUEUE_LIMIT = 60000;


class SlurmWidget extends Widget {
  /**
  * The table element containing Slurm queue data. */ 
  private queue_table: HTMLElement;
  // The column index of job ID
  readonly JOBID_IDX = 0;

  /* Construct a new Slurm widget. */
  constructor() {
    super();
    this.id = 'jupyterlab-slurm';
    this.title.label = 'Slurm Queue Manager';
    this.title.closable = true;
    this.addClass('jp-SlurmWidget');

    this.queue_table = document.createElement('table');
    this.queue_table.setAttribute('id', 'queue');
    this.queue_table.setAttribute('width', '100%');
    this.queue_table.setAttribute('style', 'font:14px');

    // These css class definitions are from the DataTables default styling package
    // See: https://datatables.net/manual/styling/classes#display
    this.queue_table.classList.add('order-column', 'cell-border');
    this.node.appendChild(this.queue_table);

    // Add thead to queue_table, and define column names;
    // this is required for DataTable's AJAX functionality. 
    let tbl_head = document.createElement('thead');
    this.queue_table.appendChild(tbl_head);
    let head_row = tbl_head.insertRow(0);
    let cols = ['JOBID', 'PARTITION', 'NAME', 'USER', 'ST', 'TIME', 'NODES', 'NODELIST(REASON)'];
    for (let i = 0; i < cols.length; i++) {
      let h = document.createElement('th');
      let t = document.createTextNode(cols[i]);
      h.appendChild(t);
      head_row.appendChild(h);
    }

    // reference to this SlurmWidget object for use in the jquery func below
    var self = this;
    // The base URL that prepends commands -- necessary for hub functionality
    var baseUrl = PageConfig.getOption('baseUrl');

    // The ajax request URL for calling squeue; changes depending on whether 
    // we are in user view (default), or global view, as determined by the
    // toggleSwitch, defined below.
    var userViewURL = URLExt.join(baseUrl, '/squeue?userOnly=true');
    var globalViewURL = URLExt.join(baseUrl, '/squeue?userOnly=false');

    // Render table using DataTable's API
    $(document).ready(function() {
      var table = $('#queue').DataTable( {
        ajax: userViewURL,
        select: {
          style: 'os',
        },
        deferRender: true,        
        pageLength: 15,
        language: {
          search: 'User',
        },
        columns: [
        { name: 'JOBID', searchable: false },
        { name: 'PARTITION', searchable: false },
        { name: 'NAME', searchable: false },
        { name: 'USER', searchable: true },
        { name: 'ST', searchable: false },
        { name: 'TIME', searchable: false },
        { name: 'NODES', searchable: false },
        { name: 'NODELIST(REASON)', searchable: false },        
        ],
        columnDefs: [
          {
            className: 'dt-center', 
            targets: '_all'
          }
        ],
        // Set rowId to maintain selection after table reload 
        // (use primary key for rowId). 
        rowId: self.JOBID_IDX.toString(),
        autoWidth: true,
        scrollY: '400px',
        scrollX: true,
        scrollCollapse: true,
        // Element layout parameter
        dom: '<"toolbar"Bfr><t><lip>',
        buttons: { buttons: [
          {
            text: 'Reload',
            name: 'Reload',
            action: (e, dt, node, config) => {
              dt.ajax.reload(null, false);
              // NOTE: currently not using this feature -- may use again in the future.
              // Disable the button to avoid overloading Slurm with calls to squeue
              // Note, this does not persist across a browser window refresh
              // dt.button( 'Reload:name' ).disable();
              // Reactivate Refresh button after USER_SQUEUE_LIMIT milliseconds
              // setTimeout(function() { dt.button( 'Reload:name' ).enable() }, USER_SQUEUE_LIMIT);
            }
          },
          {
            extend: 'selected',
            text: 'Kill Selected Job(s)',
            action: (e, dt, node, config) => {
              self._run_on_selected('/scancel', 'DELETE', dt);
            }
          },
          {
            extend: 'selected',
            text: 'Hold Selected Job(s)',
            action: (e, dt, node, config) => {
              self._run_on_selected('/scontrol/hold', 'PATCH', dt);
            }  
          },
          {
            extend: 'selected',
            text: 'Release Selected Job(s)',
            action: (e, dt, node, config) => {
              self._run_on_selected('/scontrol/release', 'PATCH', dt);
            }  
          },
          {
            extend: 'selectNone'
          },
          // Job submission temporarily disabled
          // {
          //   text: 'Submit Slurm Script via File Path',
          //   action:  (e, dt, node, config) => {
          //     var scriptPath = window.prompt('Enter a Slurm script file path');
          //     self._submit_batch_script_path(scriptPath, dt)
          //   }
          // },
          // {
          //   text: 'Submit Slurm Script via File Contents',
          //   action: (e, dt, node, config) => {
          //     self._submit_batch_script_contents(dt);
          //   }
	  // }
       
        ],
        // https://datatables.net/reference/option/buttons.dom.button
        // make it easier to identify/grab buttons to change their appearance
        dom: {
          button: {
            tag: 'button',
            className: 'button',
          }
        }  }
      });

      // Add a switch that toggles between global and user queue (user by default)
      let toggleContainer = document.createElement("div");
      toggleContainer.classList.add("custom-control", "custom-switch");

      let toggleSwitch = document.createElement("input");
      toggleSwitch.classList.add("custom-control-input");
      toggleSwitch.setAttribute("type", "checkbox");
      toggleSwitch.setAttribute("id", "toggleSwitch");
      toggleSwitch.setAttribute("checked", "true");

      let toggleLabel = document.createElement("label");
      toggleLabel.classList.add("custom-control-label");
      toggleLabel.setAttribute("for", "toggleSwitch");
      toggleLabel.textContent = "Show my jobs only";

      toggleContainer.appendChild(toggleSwitch);
      toggleContainer.appendChild(toggleLabel);
      $('#jupyterlab-slurm').append(toggleContainer);


      $("#toggleSwitch").change(function () {
        if ((<HTMLInputElement>this).checked) {
          console.log("Toggle is checked!");
          table.ajax.url(userViewURL).load(null, true);
        }
        else {
          console.log("Toggle is now unchecked!");
          table.ajax.url(globalViewURL).load(null, true);
        }
      });


      // Set up and append the alert container -- an area for displaying request response 
      // messages as color coded, dismissable, alerts
      let alertContainer = document.createElement('div');
      alertContainer.setAttribute("id", "alertContainer");
      alertContainer.classList.add('container', 'alert-container');
      $('#jupyterlab-slurm').append(alertContainer);


    });
  }

  // private _toggle_user_view() {
  //   console.log("Toggler has been toggled!");
  // }

  private _reload_data_table(dt: DataTables.Api) {
    // reload the data table
    dt.ajax.reload(null, false);
  }


  private _submit_request(cmd: string, requestType: string, body: string, jobCount: any = null) {
    let xhttp = new XMLHttpRequest();
    this._set_job_completed_tasks(xhttp, jobCount);
    // The base URL that prepends the command path -- necessary for hub functionality
    let baseUrl = PageConfig.getOption('baseUrl');
    // Prepend command with the base URL to yield the final endpoint
    let endpoint = URLExt.join(baseUrl, cmd);
    xhttp.open(requestType, endpoint, true);
    // add Jupyter authorization (XRSF) token to request header
    xhttp.setRequestHeader('Authorization', 'token ' + PageConfig.getToken());
    // prevent it from enconding as plain-text UTF-8, which is the default and screws everything up
    xhttp.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    xhttp.send(body);
  }

  private _run_on_selected(cmd: string, requestType: string, dt: DataTables.Api) {
    // Run CMD on all selected rows, by submitting a unique request for each 
    // selected row. Eventually we may want to change the logic for this functionality
    // such that only one request is made with a list of Job IDs instead of one request
    // per selected job. Changes will need to be made on the back end for this to work

    let selected_data = dt.rows( { selected: true } ).data().toArray();
    let jobCount = { numJobs: selected_data.length, count: 0 };
    for (let i = 0; i < selected_data.length; i++) {
       this._submit_request(cmd, requestType, 'jobID='+selected_data[i][this.JOBID_IDX], jobCount);
    }
    
    
  };

  // NOTE: Job submission temporarily disabled -- this functions are working and ready to be used and/or refactored
  // private _submit_batch_script_path(script: string, dt: DataTables.Api) {
  //   this._submit_request('/sbatch?scriptIs=path', 'POST', 'script=' + encodeURIComponent(script));
  //   this._reload_data_table(dt);
  // };

  // private _submit_batch_script_contents(dt: DataTables.Api) {
  //   // TODO: clean up
  //   if ( $('#slurm_script').length == 0) {
  //    // at the end of the main queue table area, append a prompt message and a form submission area
  //   $('#queue_wrapper').append('<br><div id="submit_script"><span>'+
  //                              'Paste in the contents of a Slurm script file and submit them to be run </span><br><br>' +
  //                              '<textarea id="slurm_script" cols="50" rows="20"></textarea><br>');
  //   // after the form submission area, insert a submit button and then a cancel button
  //   $('#slurm_script').after('<div id="slurm_buttons">'+
  //                             '<button class="button slurm_button" id="submit_button"><span>Submit</span></button>' +
  //                             '<button class="button slurm_button" id="cancel_button"><span>Cancel</span></button>'+
  //                             '</div></div>');
  //   // message above textarea (form submission area), textarea itself, and the two buttons below
  //   var submitScript = $('#submit_script');
  //   // do the callback after clicking on the submit button
  //   $('#submit_button').click( () => {// grab contents of textarea, convert to string, then URI encode them
  //                                     var scriptContents = encodeURIComponent($('#slurm_script').val().toString()); 
  //                                     this._submit_request('/sbatch?scriptIs=contents', 'POST', 'script='+scriptContents);
  //                                     this._reload_data_table(dt);
  //                                     // remove the submit script prompt area
  //                                     submitScript.remove();
  //                                     } );
  //   // remove the submit script prompt area after clicking the cancel button
  //   $('#cancel_button').unbind().click( () => {submitScript.remove();} );
    
  //   }
  // };

  private _set_job_completed_tasks(xhttp: XMLHttpRequest, jobCount: any) {
    xhttp.onreadystatechange = () => {
      if (xhttp.readyState === xhttp.DONE && xhttp.status == 200) {
        let response = JSON.parse(xhttp.responseText);
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

        let alertText = document.createTextNode(response.responseMessage);
        alert.appendChild(alertText);
        $('#alertContainer').append(alert);

        // If all current jobs have finished executing, 
        // reload the queue (using squeue)
        if (jobCount) {
          // By the nature of javascript's sequential function execution,
          // this will not cause a data race (not atomic, but still ok) 
          jobCount.count++;
          if (jobCount.numJobs == jobCount.count) {
            this._reload_data_table($('#queue').DataTable());
          }
        }
        else {
           this._reload_data_table($('#queue').DataTable());
        }
      }
    };
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
    this._reload_data_table($('#queue').DataTable());
  };

} // class SlurmWidget


/**
 * Activate the Slurm widget extension.
 */
function activate(
  app: JupyterLab, 
  palette: ICommandPalette, 
  restorer: ILayoutRestorer,
  launcher: ILauncher | null) {

  // Declare a Slurm widget variable
  let widget: SlurmWidget; 

  // Add an application command
  const command: string = 'slurm:open';
  app.commands.addCommand(command, {
    label: args => (args['isPalette'] ? 'Open Slurm Queue Manager' : 'Slurm Queue'),
    iconClass: args => (args['isPalette'] ? '' : SLURM_ICON_CLASS_L),
    execute: () => {
      if (!widget) {
        // Instantiate a new widget if one does not exist
        widget = new SlurmWidget(); 
        widget.title.icon = SLURM_ICON_CLASS_T;
        // Reload table every 60 seconds
        setInterval(() => widget.update(), AUTO_SQUEUE_LIMIT);
      }
      if (!tracker.has(widget)) {
        // Track the state of the widget for later restoration
        tracker.add(widget);
      }
      if (!widget.isAttached) {
        // Attach the widget to the main work area if it's not there
        app.shell.addToMainArea(widget);
      } else {
        // Refresh the widget's state
        widget.update();
    }
      // Activate the widget
      app.shell.activateById(widget.id);
    }
  });

  // Add the command to the palette.
  palette.addItem({command, category: 'HPC Tools', args: { isPalette: true } })

  // Track and restore the widget state
  let tracker = new InstanceTracker<Widget>({ namespace: 'slurm'});
  restorer.restore(tracker, {
    command,
    args: () => JSONExt.emptyObject,
    name: () => 'slurm'
  });

    // Add a launcher item if the launcher is available.
  if (launcher) {
    launcher.add({
      command: 'slurm:open',
      rank: 1,
      category: 'HPC Tools'
    });
  }

} // activate

/**
 * Initialization data for the jupyterlab-slurm extension.
 */
const extension: JupyterLabPlugin<void> = {
  id: 'jupyterlab-slurm',
  autoStart: true,
  requires: [ICommandPalette, ILayoutRestorer],
  optional: [ILauncher],
  activate: activate
};

export default extension;
