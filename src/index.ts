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

// import * as fs from 'fs';

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
  // The table element containing Slurm queue data. 
  private queue_table: HTMLElement;
  // The column index of job ID
  readonly JOBID_IDX = 0;
  // The column index of the username
  readonly USER_IDX = 3;
  // A cache for storing global queue data
  private dataCache: DataTables.Api;
  // The system username, fetched from the server
  private user: string;
  // URL for calling squeue -u, used for user view
  private userViewURL: string;
  // URL for calling squeue, used for global view
  private globalViewURL: string;

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

    // reference to this SlurmWidget object for use in functions where THIS
    // is overridden by a parent object
    var self = this;

    // The base URL that prepends commands -- necessary for hub functionality
    var baseUrl = PageConfig.getOption('baseUrl');

    // The ajax request URL for calling squeue; changes depending on whether 
    // we are in user view (default), or global view, as determined by the
    // toggleSwitch, defined below.
    this.userViewURL = URLExt.join(baseUrl, '/squeue?userOnly=true');
    this.globalViewURL = URLExt.join(baseUrl, '/squeue?userOnly=false');

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

    // Render table using the DataTables API
    $(document).ready(function() {
      $('#queue').DataTable( {
        ajax: self.globalViewURL,
        initComplete: function(settings, json) {
          self.initComplete(userRequest);
        },
        select: {
          style: 'os',
        },
        deferRender: true,        
        pageLength: 15,
        columns: [
        { name: 'JOBID', searchable: true },
        { name: 'PARTITION', searchable: true },
        { name: 'NAME', searchable: true },
        { name: 'USER', searchable: true },
        { name: 'ST', searchable: true },
        { name: 'TIME', searchable: true },
        { name: 'NODES', searchable: true },
        { name: 'NODELIST(REASON)', searchable: true },        
        ],
        columnDefs: [
          {
            className: 'dt-center', 
            targets: '_all'
          }
        ],
        // Set rowId to maintain selection after table reload 
        // (use the queue's primary key (JOBID) for rowId). 
        rowId: self.JOBID_IDX.toString(),
        autoWidth: true,
        scrollY: '400px',
        scrollX: true,
        scrollCollapse: true,
        // Element layout parameter
        dom: '<"toolbar"Bfr><t><lip>',
        buttons: { 
          buttons: [
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
              self.runOnSelected('/scancel', 'DELETE', dt);
            }
          },
          {
            extend: 'selected',
            text: 'Hold Selected Job(s)',
            action: (e, dt, node, config) => {
              self.runOnSelected('/scontrol/hold', 'PATCH', dt);
            }  
          },
          {
            extend: 'selected',
            text: 'Release Selected Job(s)',
            action: (e, dt, node, config) => {
              self.runOnSelected('/scontrol/release', 'PATCH', dt);
            }  
          },
          {
            extend: 'selectNone'
          },
          {
            text: "Submit Job",
            action: (e, dt, node, config) => {
              self.launchSubmitModal();
            }
          }
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
          }  
        }
      });

      // Add a switch that toggles between global and user view (user by default)
      let toggleContainer = document.createElement("div");
      toggleContainer.classList.add("custom-control", "custom-switch", "toggle-switch");

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
     
      // Set up and append the alert container -- an area for displaying request response 
      // messages as color coded, dismissable, alerts
      let alertContainer = document.createElement('div');
      alertContainer.setAttribute("id", "alertContainer");
      alertContainer.classList.add('container', 'alert-container');
      $('#jupyterlab-slurm').append(alertContainer);

      let modal = 
      `
      <div class="modal fade" id="exampleModalCenter" tabindex="-1" role="dialog" aria-labelledby="exampleModalCenterTitle" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered" role="document">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title" id="exampleModalLongTitle">Modal title</h5>
              <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            <div class="modal-body">
              ...
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-dismiss="modal">Close</button>
              <button type="button" class="btn btn-primary">Save changes</button>
            </div>
          </div>
        </div>
      </div>
      `;


      // let modal = 
      // `
      // <div id="jobSubmitModal" class="modal fade" role="dialog">
      //   <div class="modal-dialog">
      //     <div class="modal-content">
      //       <div class="modal-header">
      //         <a class="close" data-dismiss="modal">×</a>
      //         <h3>Submit a Job</h3>
      //       </div>
      //       <form id="jobSubmitForm" name="jobSubmit" role="form">
      //         <div class="modal-body">        
      //           <div class="form-group">
      //             <label for="name">Name</label>
      //             <input type="text" name="name" class="form-control">
      //           </div>         
      //         </div>
      //         <div class="modal-footer">          
      //           <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>
      //           <input type="submit" class="btn btn-success" id="submit">
      //         </div>
      //       </form>
      //     </div>
      //   </div>
      // </div>
      // `;
      // let modalHtml = $.parseHTML(modal);

      let modalContainer = document.createElement('div');
      modalContainer.innerHTML = modal;
      // document.appendChild(modalContainer);
      // $('#jp-main-dock-panel').append(modalContainer);
      $('#jupyterlab-slurm').append(modalContainer);

    }); 
  }

  private launchSubmitModal() {
    (<any>$('#exampleModalCenter')).modal('show');
  }

  /**
  * This method is triggered when the table is fully initialized.
  * Waits for username request to finish, and then defines functionality
  * for switching between user and global view. The switch function is 
  * called immediately after it is defined, which makes it so user view
  * is the default. 
  */
  private initComplete(userRequest: any) {
    var self = this;
    var table = $('#queue').DataTable();
    $.when(userRequest).done(function () {
      $("#toggleSwitch").change(function () {
        if ((<HTMLInputElement>this).checked) {
          table.ajax.url(self.userViewURL);
          self.dataCache = table.rows().data();
          let filteredData = self.dataCache
              .filter(function(value, index) {
                return value[self.USER_IDX] == self.user;
              });
          table.clear();
          table.rows.add(filteredData.toArray());
          table.draw();
        }
        else {
          table.ajax.url(self.globalViewURL);
          let userData = table.data(); 
          let filteredData = self.dataCache
              .filter(function(value, index) {
                return value[self.USER_IDX] != self.user;
              })
          table.clear();
          table.rows.add(filteredData.toArray());
          table.rows.add(userData.toArray());
      	  table.draw();
        }
      });
      $("#toggleSwitch").change();
    });
  }


  private reloadDataTable(dt: DataTables.Api) {
    // reload the data table
    dt.ajax.reload(null, false);
  }


  private submitRequest(cmd: string, requestType: string, body: string, jobCount: any = null) {
    let xhttp = new XMLHttpRequest();
    this.setJobCompletedTasks(xhttp, jobCount);
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

  private runOnSelected(cmd: string, requestType: string, dt: DataTables.Api) {
    // Run CMD on all selected rows, by submitting a unique request for each 
    // selected row. Eventually we may want to change the logic for this functionality
    // such that only one request is made with a list of Job IDs instead of one request
    // per selected job. Changes will need to be made on the back end for this to work

    let selected_data = dt.rows( { selected: true } ).data().toArray();
    let jobCount = { numJobs: selected_data.length, count: 0 };
    for (let i = 0; i < selected_data.length; i++) {
       this.submitRequest(cmd, requestType, 'jobID='+selected_data[i][this.JOBID_IDX], jobCount);
    }
    
    
  };

  // NOTE: Job submission temporarily disabled -- this functions are working and ready to be used and/or refactored
  // private _submit_batch_script_path(script: string, dt: DataTables.Api) {
  //   this.submitRequest('/sbatch?scriptIs=path', 'POST', 'script=' + encodeURIComponent(script));
  //   this.reloadDataTable(dt);
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
  //                                     this.submitRequest('/sbatch?scriptIs=contents', 'POST', 'script='+scriptContents);
  //                                     this.reloadDataTable(dt);
  //                                     // remove the submit script prompt area
  //                                     submitScript.remove();
  //                                     } );
  //   // remove the submit script prompt area after clicking the cancel button
  //   $('#cancel_button').unbind().click( () => {submitScript.remove();} );
    
  //   }
  // };

  private setJobCompletedTasks(xhttp: XMLHttpRequest, jobCount: any) {
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
            this.reloadDataTable($('#queue').DataTable());
          }
        }
        else {
           this.reloadDataTable($('#queue').DataTable());
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
    this.reloadDataTable($('#queue').DataTable());
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
