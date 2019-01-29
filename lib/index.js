"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
        return extendStatics(d, b);
    }
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var application_1 = require("@jupyterlab/application");
var apputils_1 = require("@jupyterlab/apputils");
var launcher_1 = require("@jupyterlab/launcher");
var coreutils_1 = require("@jupyterlab/coreutils");
var coreutils_2 = require("@phosphor/coreutils");
var widgets_1 = require("@phosphor/widgets");
var $ = require("jquery");
require("datatables.net");
require("datatables.net-buttons");
require("datatables.net-select");
require("datatables.net-dt/css/jquery.dataTables.css");
require("../style/index.css");
/**
 * The class names for the Slurm extension icon, for launcher and
 * tab, respectively
 */
var SLURM_ICON_CLASS_L = 'jp-NerscLaunchIcon';
var SLURM_ICON_CLASS_T = 'jp-NerscTabIcon';
var SlurmWidget = /** @class */ (function (_super) {
    __extends(SlurmWidget, _super);
    /* Construct a new Slurm widget. */
    function SlurmWidget() {
        var _this = _super.call(this) || this;
        // The column index of job ID
        _this.JOBID_IDX = 0;
        console.log('constructor called');
        console.log('testing!');
        _this.id = 'jupyterlab-slurm';
        _this.title.label = 'Slurm Queue Manager';
        _this.title.closable = true;
        _this.addClass('jp-SlurmWidget');
        _this.queue_table = document.createElement('table');
        _this.queue_table.setAttribute('id', 'queue');
        _this.queue_table.setAttribute('width', '100%');
        _this.queue_table.setAttribute('style', 'font:14px');
        // These css class definitions are from the DataTables default styling package
        // See: https://datatables.net/manual/styling/classes#display
        _this.queue_table.classList.add('order-column', 'cell-border');
        _this.node.appendChild(_this.queue_table);
        // Add thead to queue_table, and define column names;
        // this is required for DataTable's AJAX functionality. 
        var tbl_head = document.createElement('thead');
        _this.queue_table.appendChild(tbl_head);
        var head_row = tbl_head.insertRow(0);
        var cols = ['JOBID', 'PARTITION', 'NAME', 'USER', 'ST', 'TIME', 'NODES', 'NODELIST(REASON)'];
        for (var i = 0; i < cols.length; i++) {
            var h = document.createElement('th');
            var t = document.createTextNode(cols[i]);
            h.appendChild(t);
            head_row.appendChild(h);
        }
        // reference to this object for use in the jquery func below
        var self = _this;
        // The base URL that prepends commands -- necessary for hub functionality
        var baseUrl = coreutils_1.PageConfig.getOption('baseUrl');
        // Render table using DataTable's API
        $(document).ready(function () {
            $('#queue').DataTable({
                ajax: coreutils_1.URLExt.join(baseUrl, '/squeue'),
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
                            action: function (e, dt, node, config) {
                                dt.ajax.reload(null, false);
                            }
                        },
                        {
                            extend: 'selected',
                            text: 'Kill Selected Job(s)',
                            action: function (e, dt, node, config) {
                                self._run_on_selected('/scancel', 'DELETE', dt);
                            }
                        },
                        {
                            extend: 'selected',
                            text: 'Hold Selected Job(s)',
                            action: function (e, dt, node, config) {
                                self._run_on_selected('/scontrol/hold', 'PATCH', dt);
                            }
                        },
                        {
                            extend: 'selected',
                            text: 'Release Selected Job(s)',
                            action: function (e, dt, node, config) {
                                self._run_on_selected('/scontrol/release', 'PATCH', dt);
                            }
                        },
                        {
                            extend: 'selectNone'
                        },
                        {
                            text: 'Submit Slurm Script via File Path',
                            action: function (e, dt, node, config) {
                                var scriptPath = window.prompt('Enter a Slurm script file path');
                                self._submit_batch_script_path(scriptPath, dt);
                                alert(scriptPath);
                            }
                        },
                        {
                            text: 'Submit Slurm Script via File Contents',
                            action: function (e, dt, node, config) {
                                self._submit_batch_script_contents(dt);
                            }
                        }
                    ],
                    // https://datatables.net/reference/option/buttons.dom.button
                    // make it easier to identify/grab buttons to change their appearance
                    dom: {
                        button: {
                            tag: 'button',
                            className: 'button',
                        }
                    } }
            });
        });
        return _this;
    }
    SlurmWidget.prototype._reload_data_table = function (dt) {
        // reload the data table
        dt.ajax.reload(null, false);
    };
    SlurmWidget.prototype._submit_request = function (cmd, requestType, body, addJobAlert) {
        var xhttp = new XMLHttpRequest();
        if (addJobAlert === true) {
            this._add_job_completed_alert(xhttp);
        }
        ;
        // The base URL that prepends the command path -- necessary for hub functionality
        var baseUrl = coreutils_1.PageConfig.getOption('baseUrl');
        // Prepend command with the base URL to yield the final endpoint
        var endpoint = coreutils_1.URLExt.join(baseUrl, cmd);
        xhttp.open(requestType, endpoint, true);
        // add Jupyter authorization (XRSF) token to request header
        xhttp.setRequestHeader('Authorization', 'token ' + coreutils_1.PageConfig.getToken());
        // prevent it from enconding as plain-text UTF-8, which is the default and screws everything up
        xhttp.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        xhttp.send(body);
    };
    SlurmWidget.prototype._run_on_selected = function (cmd, requestType, dt) {
        // Run CMD on all selected rows, by submitting a unique request for each 
        // selected row
        var selected_data = dt.rows({ selected: true }).data().toArray();
        for (var i = 0; i < selected_data.length; i++) {
            this._submit_request(cmd, requestType, 'jobID=' + selected_data[i][this.JOBID_IDX], false);
        }
        this._reload_data_table(dt);
    };
    ;
    SlurmWidget.prototype._submit_batch_script_path = function (script, dt) {
        this._submit_request('/sbatch?scriptIs=path', 'POST', 'script=' + encodeURIComponent(script), true);
        this._reload_data_table(dt);
    };
    ;
    SlurmWidget.prototype._submit_batch_script_contents = function (dt) {
        var _this = this;
        // TODO: clean up
        if ($('#slurm_script').length == 0) {
            // at the end of the main queue table area, append a prompt message and a form submission area
            $('#queue_wrapper').append('<br><div id="submit_script"><span>' +
                'Paste in the contents of a Slurm script file and submit them to be run </span><br><br>' +
                '<textarea id="slurm_script" cols="50" rows="20"></textarea><br>');
            // after the form submission area, insert a submit button and then a cancel button
            $('#slurm_script').after('<div id="slurm_buttons">' +
                '<button class="button slurm_button" id="submit_button"><span>Submit</span></button>' +
                '<button class="button slurm_button" id="cancel_button"><span>Cancel</span></button>' +
                '</div></div>');
            // message above textarea (form submission area), textarea itself, and the two buttons below
            var submitScript = $('#submit_script');
            // do the callback after clicking on the submit button
            $('#submit_button').click(function () {
                var scriptContents = encodeURIComponent($('#slurm_script').val().toString());
                _this._submit_request('/sbatch?scriptIs=contents', 'POST', 'script=' + scriptContents, true);
                _this._reload_data_table(dt);
                // remove the submit script prompt area
                submitScript.remove();
            });
            // remove the submit script prompt area after clicking the cancel button
            $('#cancel_button').unbind().click(function () { submitScript.remove(); });
        }
    };
    ;
    SlurmWidget.prototype._add_job_completed_alert = function (xhttp) {
        // TODO: change to _set_job_completed_message(request, message)
        xhttp.onreadystatechange = function () {
            // alert the user of the job's number after submitting
            if (xhttp.readyState === xhttp.DONE) {
                alert("Submitted batch job " + xhttp.responseText.toString());
            }
        };
    };
    ;
    /**
    * Reloads the queue table by using DataTables
    * AJAX functionality, which reloads only the data that
    * is needed. NOTE: This method is called
    * when widget.update() is called, and the false
    * param passed to ajax.reload(..) indicates that the table's
    * pagination will not be reset upon reload, which does
    * require some overhead due to sorting, etc.
    */
    SlurmWidget.prototype.onUpdateRequest = function (msg) {
        this._reload_data_table($('#queue').DataTable());
    };
    ;
    return SlurmWidget;
}(widgets_1.Widget)); // class SlurmWidget
/**
 * Activate the Slurm widget extension.
 */
function activate(app, palette, restorer, launcher) {
    // Declare a Slurm widget variable
    var widget;
    // Add an application command
    var command = 'slurm:open';
    app.commands.addCommand(command, {
        label: function (args) { return (args['isPalette'] ? 'Open Slurm Queue Manager' : 'Slurm Queue'); },
        iconClass: function (args) { return (args['isPalette'] ? '' : SLURM_ICON_CLASS_L); },
        execute: function () {
            if (!widget) {
                // Instantiate a new widget if one does not exist
                widget = new SlurmWidget();
                widget.title.icon = SLURM_ICON_CLASS_T;
                // Reload table every 60 seconds
                setInterval(function () { return widget.update(); }, 60000);
            }
            if (!tracker.has(widget)) {
                // Track the state of the widget for later restoration
                tracker.add(widget);
            }
            if (!widget.isAttached) {
                // Attach the widget to the main work area if it's not there
                app.shell.addToMainArea(widget);
            }
            else {
                // Refresh the widget's state
                widget.update();
            }
            // Activate the widget
            app.shell.activateById(widget.id);
        }
    });
    // Add the command to the palette.
    palette.addItem({ command: command, category: 'HPC Tools', args: { isPalette: true } });
    // Track and restore the widget state
    var tracker = new apputils_1.InstanceTracker({ namespace: 'slurm' });
    restorer.restore(tracker, {
        command: command,
        args: function () { return coreutils_2.JSONExt.emptyObject; },
        name: function () { return 'slurm'; }
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
var extension = {
    id: 'jupyterlab-slurm',
    autoStart: true,
    requires: [apputils_1.ICommandPalette, application_1.ILayoutRestorer],
    optional: [launcher_1.ILauncher],
    activate: activate
};
exports.default = extension;
