import { JupyterLabPlugin } from '@jupyterlab/application';
import 'datatables.net';
import 'datatables.net-buttons';
import 'datatables.net-select';
import 'datatables.net-dt/css/jquery.dataTables.css';
import '../style/index.css';
/**
 * Initialization data for the jupyterlab-slurm extension.
 */
declare const extension: JupyterLabPlugin<void>;
export default extension;
