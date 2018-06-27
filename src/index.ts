// TODO: Add Refresh button (defualt refresh every one minute)
// 

import {
  JupyterLab, JupyterLabPlugin
} from '@jupyterlab/application';

import {
  ICommandPalette
} from '@jupyterlab/apputils';

import {
  Widget
} from '@phosphor/widgets';

import {
  Message
} from '@phosphor/messaging';

import '../style/index.css';

class SlurmWidget extends Widget {
  /**
  * The table element which contains SLURM queue data.
  */ 
  private queue_table: HTMLElement;

  
  /**
  * Construct a new SLURM widget.
  */
  constructor() {
    super();

    this.id = 'nersc-hpc-jupyterlab';
    this.title.label = 'SLURM Queue Monitor';
    this.title.closable = true;
    this.addClass('jp-queueWidget');

    this.queue_table = document.createElement('table');
    this.queue_table.className = 'jp-queueTable';
    this.node.appendChild(this.queue_table);

  }

  // Pull queue data and populate html table
  public populate_queue_table(queue_table: HTMLElement) {
    fetch('/shell/ps/aux').then(response => {
      return response.text();
    }).then(data => this.generate_table(queue_table, data));
  }

  public onUpdateRequest(msg: Message) {
    console.log("update request called!")
    this.populate_queue_table(this.queue_table);
  }

  // Generate HTML table and populate with queue_data
  private generate_table(queue_table: HTMLElement, data: string) {
    console.log("table refreshed!")
    let lines = data.split('\n');
    for (let i = 0; i < lines.length; i++) {
      let row_values = lines[i].split(/[\s]+/)
      let row = document.createElement('tr');
      for (let j = 0; j < row_values.length; j++) {
        let cell = document.createElement('td');
        cell.className = 'jp-queueTable';
        let cellText = document.createTextNode(row_values[j]);
        cell.appendChild(cellText);
        row.appendChild(cell);
      } // for (inner)
      queue_table.appendChild(row);
    } // for (outer)
  } // generate_table
} // class SlurmWidget


/**
 * Activate the SLURM widget extension.
 */
function activate(app: JupyterLab, palette: ICommandPalette) {
  console.log('JupyterLab extension jupyterlab_hpc is activated!');

  // Declare a new SLURM widget variable
  let widget: SlurmWidget = new SlurmWidget();

  // Add an application command
  const command: string = 'hpc:open';
  app.commands.addCommand(command, {
    label: 'SLURM Queue Monitor',
    execute: () => {
      if (!widget.isAttached) {
        // Attach the widget to the main work area if it's not there
        app.shell.addToMainArea(widget);
      }
      // Refresh the widget's state
      widget.update();
      // widget.update();
      // var update = widget.update;
      // setInterval(widget.populate_queue_table, 1000, widget.queue_table);
      // console.log("setInterval called correctly!");
      // Activate the widget
      app.shell.activateById(widget.id);
    }
  });
  // Add the command to the palette.
  palette.addItem({command, category: 'HPC Tools'})
} // activate


/**
 * Initialization data for the jupyterlab_hpc extension.
 */
const extension: JupyterLabPlugin<void> = {
  id: 'jupyterlab_hpc',
  autoStart: true,
  requires: [ICommandPalette],
  activate: activate
};


/**
 * Initialization data for the jupyterlab_hpc extension.
 */
//  const extension: JupyterLabPlugin<void> = {
//    id: 'jupyterlab_hpc',
//    autoStart: true,
//    requires: [ICommandPalette],
//    activate: (app: JupyterLab, palette: ICommandPalette) => {
//      console.log('JupyterLab extension jupyterlab_hpc is activated!');


//     // Create a single widget
//     let widget: Widget = new Widget();
//     widget.id = 'nersc-hpc-jupyterlab';
//     widget.title.label = 'SLURM Queue Monitor';
//     widget.title.closable = true;
//     widget.addClass('jp-queueWidget');

//     // Add a table element to the panel
//     let queue_table = document.createElement('table');
//     queue_table.className = 'jp-queueTable';

//     widget.node.appendChild(queue_table);
//     populate_queue_table(queue_table);

//     // Refresh table at specified interval
//     // setInterval(populate_queue_table, 2000, queue_table);



//     // Add an application command
//     const command: string = 'hpc:open';
//     app.commands.addCommand(command, {
//       label: 'SLURM Queue Monitor',
//       execute: () => {
//         if (!widget.isAttached) {
//                 // Attach the widget to the main work area if it's not there
//                 app.shell.addToMainArea(widget);
//               }
//             // Activate the widget
//             app.shell.activateById(widget.id);
//           }
//         });
//     // Add the command to the palette.
//     palette.addItem({command, category: 'NERSC Tools'})
//   }
// };

// // Pull queue data and populate html table
// function populate_queue_table(queue_table: HTMLElement) {
//   fetch('/shell/ps/aux').then(response => {
//     return response.text();
//   }).then(data => generate_table(queue_table, data))
// }

// function generate_table(queue_table: HTMLElement, data: string) {
//   console.log("table refreshed!")
//   let lines = data.split('\n');
//   for (let i = 0; i < lines.length; i++) {
//     let row_values = lines[i].split(/[\s]+/)
//     let row = document.createElement('tr');
//     for (let j = 0; j < row_values.length; j++) {
//       let cell = document.createElement('td');
//       cell.className = 'jp-queueTable';
//       let cellText = document.createTextNode(row_values[j]);
//       cell.appendChild(cellText);
//       row.appendChild(cell);
//     }
//     queue_table.appendChild(row);
//   }
// }

  export default extension;
