import { JupyterLabPlugin } from '@jupyterlab/application';
import 'datatables.net-dt/css/jquery.dataTables.css';
import 'datatables.net';
import 'datatables.net-buttons-dt';
import 'datatables.net-buttons';
import 'datatables.net-select';
import 'bootstrap/dist/css/bootstrap.css';
import 'bootstrap/dist/js/bootstrap.js';
import '../style/index.css';
/**
 * Initialization data for the jupyterlab-slurm extension.
 */
declare const extension: JupyterLabPlugin<void>;
export default extension;
