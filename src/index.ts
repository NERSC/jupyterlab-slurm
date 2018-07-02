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
import 'datatables.net-dt';
import 'datatables.net-dt/css/jquery.dataTables.css';

import '../style/index.css';



class SlurmWidget extends Widget {
  /**
  * The table element containing SLURM queue data.
  */ 
  private queue_table: HTMLElement;
  // private table: DataTables.Api;



  /**
  * Construct a new SLURM widget.
  */
  constructor() {
    super();
    console.log("constructor called");
    this.id = 'nersc-hpc-jupyterlab';
    this.title.label = 'SLURM Queue Monitor';
    this.title.closable = true;
    this.addClass('jp-queueWidget');

    this.queue_table = document.createElement('table');
    this.queue_table.setAttribute('id', 'queue');
    // this.queue_table.className = 'jp-queueTable';
    this.queue_table.classList.add('display', 'cell-border');
    this.node.appendChild(this.queue_table);


    // TODO: add thead (and maybe tbody?) to queue_table! It
    //       is required!!!

    // $(document).ready(function() {
    //   $('#queue').DataTable( {
    //     ajax: {
    //       url: "/shell/ps/aux",
    //       dataSrc: "data"
    //      },
    //     columns: [
    //     { data: 'name' },
    //     { data: 'position' },
    //     { data: 'salary' },
    //     { data: 'state_date' },
    //     { data: 'office' }
    // ]
    //   });
    // });

  }

  public onUpdateRequest(msg: Message) {
    console.log("update request called!")
    this._update_queue_table();
    // this._generate_queue_table();
  }

  // Pull queue data and populate queue_table
  private _update_queue_table() {
    fetch('/shell/ps/aux').then(response => {
      return response.text();
    }).then(data => this._populate_queue_table(data));
  }

  // public _generate_queue_table() {
  //   var table = $('#queue').DataTable( {
  //     ajax: {
  //       url: "/shell/ps/aux",
  //       dataSrc: "data"
  //     },
  //     columns: [
  //     { data: 'name' },
  //     { data: 'position' },
  //     { data: 'salary' },
  //     { data: 'state_date' },
  //     { data: 'office' }
  //     ]
  //   });
  //   table.ajax.reload();


    // $(this.queue_table).ready(function() {
    //   $('#queue').DataTable( {
    //     ajax: {
    //       url: "/shell/ps/aux",
    //       dataSrc: "data"
    //      }
    //   });
    // });
  // }



  // Generate HTML table and populate with queue_data
  private _populate_queue_table(data: string) {
    // Clear table content
    while (this.queue_table.hasChildNodes()) {
      this.queue_table.removeChild(this.queue_table.lastChild);
    }

    // Adding classes again, necessary? The clearing of the
    // table might be clearing the class list as well...
    this.queue_table.classList.add('display', 'cell-border');
    let lines = data.split('\n');

    // Create header and append to table
    let header_row = document.createElement("tr");
    let col_names = lines[0].split(/[\s]+/);
    for (let i = 0; i < 8; i++) {
      let headElem = document.createElement("th");
      let headerText = document.createTextNode(col_names[i]);
      headElem.appendChild(headerText);
      header_row.appendChild(headElem);
    }
    let tblHead = document.createElement("thead");
    tblHead.appendChild(header_row);
    this.queue_table.appendChild(tblHead);

    // Create table body and cells and append to table
    let tblBody = document.createElement("tbody");
    for (let i = 1; i < lines.length; i++) {
      let row_values = lines[i].split(/[\s]+/)
      let row = document.createElement('tr');
      for (let j = 0; j < 8; j++) {
        let cell = document.createElement('td');
        // cell.className = 'jp-queueTable';
        // cell.className = 'jquery.dataTables';

        let cellText = document.createTextNode(row_values[j]);
        cell.appendChild(cellText);
        row.appendChild(cell);
      } // for (inner)
      tblBody.appendChild(row);
    } // for (outer)
    this.queue_table.appendChild(tblBody);

    $(document).ready(function() {
      $('#queue').DataTable();
    } );
    



  } // _populate_queue_table


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
    label: 'SLURM Queue Monitor',
    execute: () => {
      console.log("execute function entered!")
      // So this function runs ONLY when the 'SLURM Queue Monitor' button
      // is pushed!
      if (!widget) {
        console.log("no widget region entered!")
        // Instantiate a new widget if one does not exist
        widget = new SlurmWidget();
        // widget.update() calls the onUpdateRequest method
        widget.update();
        // Refresh table every 60 seconds by default
        setInterval(() => widget.update(), 60000);
      }
      if (!tracker.has(widget)) {
        // Track the state of the widget for later restoration
        tracker.add(widget);
      }
      if (!widget.isAttached) {
        // Attach the widget to the main work area if it's not there
        app.shell.addToMainArea(widget);
        // set interval here?
      } else {
        // Refresh the widget's state
        console.log("else entered!")
        widget.update();
        // setInterval(() => widget.update(), 60000);
    }
      // Activate the widget
      app.shell.activateById(widget.id);
    }
  });

  // Add the command to the palette.
  palette.addItem({command, category: 'HPC Tools'})

  // Track and resotre the widget state
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
