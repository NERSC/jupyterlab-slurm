// TODO: Add Refresh button (defualt refresh every one minute)
// 

import {
  JupyterLab, JupyterLabPlugin, ILayoutRestorer
} from '@jupyterlab/application';

import {
  ICommandPalette, InstanceTracker
} from '@jupyterlab/apputils';

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
import 'datatables.net';
// import 'datatables.net-dt';
import 'datatables.net-buttons';
import 'datatables.net-select';
import 'datatables.net-dt/css/jquery.dataTables.css';
// import 'datatables.net/1.10.19/css/jquery.dataTables.css';

import '../style/index.css';



class SlurmWidget extends Widget {
  /**
  * The table element containing SLURM queue data.
  */ 
  private queue_table: HTMLElement;
  // The column index of job ID
  readonly JOBID_IDX = 1;

  /**
  * Construct a new SLURM widget.
  */
  constructor() {
    super();
    console.log("constructor called");
    this.id = 'nersc-hpc-jupyterlab';
    this.title.label = 'SLURM Queue Manager';
    this.title.closable = true;
    this.addClass('jp-queueWidget');

    this.queue_table = document.createElement('table');
    this.queue_table.setAttribute('id', 'queue');
    this.queue_table.setAttribute('width', '100%');
    this.queue_table.setAttribute('style', 'font:14px');
    // this.queue_table.setAttribute('height', '80%');

    // These class definitions are from the
    // DataTables default styling package
    this.queue_table.classList.add('display', 'cell-border');
    this.node.appendChild(this.queue_table);

    // Add thead to queue_table; this is required 
    // for DataTable's AJAX functionality. 
    let tbl_head = document.createElement('thead');
    this.queue_table.appendChild(tbl_head);
    let head_row = tbl_head.insertRow(0);
    let cols = ["User", "PID", "%CPU", "%MEM", "VSZ", "RSS", "TT", "STAT"];
    for (let i = 0; i < cols.length; i++) {
      let h = document.createElement('th');
      let t = document.createTextNode(cols[i]);
      h.appendChild(t);
      head_row.appendChild(h);
    }

    // reference to this object for use in the jquery func below
    var self = this;

    // Render table using DataTable's API
    $(document).ready(function() {
      $('#queue').DataTable( {
        ajax: '/shell/ps/aux',
        select: true,
        pageLength: 15,
        language: {
          search: "User"
        },
        columns: [
        { name: 'User', searchable: true },
        { name: 'PID', searchable: false },
        { name: '%CPU', searchable: false },
        { name: '%MEM', searchable: false },
        { name: 'VSZ', searchable: false },
        { name: 'RSS', searchable: false },
        { name: 'TT', searchable: false },
        { name: 'STAT', searchable: false },        
        ],
        columnDefs: [
          {
            className: "dt-center", 
            targets: "_all"
          }
        ],
        autoWidth: true,
        scrollY: "400px",
        scrollX: true,
        scrollCollapse: true,
        // Table element layout parameter
        dom: '<Bfr<t><li>p>',//'<"top"Bf>lrt<"bottom"pi><"clear">',//'Bfrtip',
        buttons: [
          {
            text: "Reload",
            action: function (e, dt, node, config) {
              dt.ajax.reload(null, false);
            }
          },
          {
            extend: 'selected',
            text: 'Kill Selected Job(s)',
            action: function (e, dt, node, config) {
              var selected_data = dt.rows( { selected: true } ).data().toArray();
              for (let i = 0; i < selected_data.length; i++) {
                let xhttp = new XMLHttpRequest();
                // killing is restricted for certain processes, but this is
                // irrelevant for this toy version, and this is good enough 
                // to see the desired functionality
                xhttp.open("GET", "/shell/kill" + selected_data[i][1], true);
                console.log(xhttp.send());
                console.log(selected_data[i][1]);
              }
              dt.ajax.reload(null, false);
              // SlurmWidget._reload_queue_table();

              // var data = table.rows( { selected: true }).data().toArray(); //, PID:name ).data(); //.cells(PID:name);
              // This (below) should work dammit!
              // var data = table.cells(null, 'PID:name', { selected: true } ).data().toArray();
              // var pid = data.columns('PID:name').data().toArray();
              // var data = table.cells('', 'PID:name', <any>{ selected: true }).data().toArray();

              // var pid = data.PID
              // var data = table.cells(, pid:name);
            }
          },
          {
            extend: 'selected',
            text: 'Pause Selected Job(s)',
            action: (e, dt, node, config) => {
              self._run_on_selected("/shell/kill/-STOP", dt);
            }  
          }
          
        ]             
      })
    })
    console.log("button added?")
  }

  private _reload_queue_table() {
    $('#queue').DataTable().ajax.reload(null, false);
    console.log("searchable");
  }

  private _run_on_selected(cmd: string, dt: DataTables.Api) {
    let selected_data = dt.rows( { selected: true } ).data().toArray();
    for (let i = 0; i < selected_data.length; i++) {
      let xhttp = new XMLHttpRequest();
      // killing is restricted for certain processes, but this is
      // irrelevant for this toy version, and this is good enough 
      // to see the desired functionality
      xhttp.open("GET", cmd + '/' + selected_data[i][this.JOBID_IDX], true);
      xhttp.send();
      console.log(selected_data[i][1]);
    }
    this._reload_queue_table();
    // dt.ajax.reload(null, false);
  }

  /**
  * Reloads the queue table by using DataTables
  * AJAX functionality, which reloads only the data that 
  * is needed. IMPORTANT: This method is called
  * when widget.update() is called, and . The false
  * param passed to ajax.reload(..) indicates that the table's
  * pagination will not be reset upon reload, which does 
  * require some overhead due to sorting, etc.
  */
  public onUpdateRequest(msg: Message) {
    // $('#queue').DataTable().ajax.reload(null, false);
    this._reload_queue_table();
  }

} // class SlurmWidget


/**
 * Activate the SLURM widget extension.
 */
function activate(app: JupyterLab, palette: ICommandPalette, restorer: ILayoutRestorer) {
  console.log('JupyterLab extension jupyterlab_hpc is activated!');

  // Declare a SLURM widget variable
  let widget: SlurmWidget; 

  // Add an application command
  const command: string = 'hpc:open';
  app.commands.addCommand(command, {
    label: 'SLURM Queue Manager',
    execute: () => {
      console.log("execute function entered!")
      if (!widget) {
        console.log("no widget region entered!")
        // Instantiate a new widget if one does not exist
        widget = new SlurmWidget(); 
        // Reload table every 60 seconds
        setInterval(() => widget.update(), 60000);
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
        console.log("else entered!")
        widget.update();
    }
      // Activate the widget
      app.shell.activateById(widget.id);
    }
  });

  // Add the command to the palette.
  palette.addItem({command, category: 'HPC Tools'})

  // Track and restore the widget state
  let tracker = new InstanceTracker<Widget>({ namespace: 'hpc'});
  restorer.restore(tracker, {
    command,
    args: () => JSONExt.emptyObject,
    name: () => 'hpc'
  });

} // activate

/**
 * Initialization data for the jupyterlab_hpc extension.
 */
const extension: JupyterLabPlugin<void> = {
  id: 'jupyterlab_hpc',
  autoStart: true,
  requires: [ICommandPalette, ILayoutRestorer],
  activate: activate
};

  export default extension;
