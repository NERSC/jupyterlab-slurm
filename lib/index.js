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
require("datatables.net-dt/css/jquery.dataTables.css");
require("datatables.net");
require("datatables.net-buttons-dt");
require("datatables.net-buttons");
require("datatables.net-select");
require("bootstrap/dist/css/bootstrap.css");
require("bootstrap/dist/js/bootstrap.js");
require("../style/index.css");
/**
 * The class names for the Slurm extension icon, for launcher and
 * tab, respectively
 */
var SLURM_ICON_CLASS_L = 'jp-NerscLaunchIcon';
var SLURM_ICON_CLASS_T = 'jp-NerscTabIcon';
// The number of milliseconds a user must wait in between Refresh requests
// This limits the number of times squeue is called, in order to avoid
// overloading the Slurm workload manager
var USER_SQUEUE_LIMIT = 60000;
// The interval (milliseconds) in which the queue data automatically reloads
// by calling squeue
var AUTO_SQUEUE_LIMIT = 60000;
var SlurmWidget = /** @class */ (function (_super) {
    __extends(SlurmWidget, _super);
    /* Construct a new Slurm widget. */
    function SlurmWidget() {
        var _this = _super.call(this) || this;
        // The column index of job ID
        _this.JOBID_IDX = 0;
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
        // reference to this SlurmWidget object for use in the jquery func below
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
                            name: 'Reload',
                            action: function (e, dt, node, config) {
                                dt.ajax.reload(null, false);
                                // Disable the button to avoid overloading Slurm with calls to squeue
                                // Note, this does not persist across a browser window refresh
                                dt.button('Reload:name').disable();
                                // Reactivate Refresh button after USER_SQUEUE_LIMIT milliseconds
                                setTimeout(function () { dt.button('Reload:name').enable(); }, USER_SQUEUE_LIMIT);
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
            // Set up and append the alert container -- an area for displaying request response 
            // messages as color coded, dismissable, alerts
            var alertContainer = document.createElement('div');
            alertContainer.setAttribute("id", "alertContainer");
            alertContainer.classList.add('container', 'alert-container');
            $('#jupyterlab-slurm').append(alertContainer);
        });
        return _this;
    }
    SlurmWidget.prototype._reload_data_table = function (dt) {
        // reload the data table
        dt.ajax.reload(null, false);
    };
    SlurmWidget.prototype._submit_request = function (cmd, requestType, body, jobCount) {
        if (jobCount === void 0) { jobCount = null; }
        var xhttp = new XMLHttpRequest();
        this._set_job_completed_tasks(xhttp, jobCount);
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
        // selected row. Eventually we may want to change the logic for this functionality
        // such that only one request is made with a list of Job IDs instead of one request
        // per selected job. Changes will need to be made on the back end for this to work
        var selected_data = dt.rows({ selected: true }).data().toArray();
        var jobCount = { numJobs: selected_data.length, count: 0 };
        for (var i = 0; i < selected_data.length; i++) {
            this._submit_request(cmd, requestType, 'jobID=' + selected_data[i][this.JOBID_IDX], jobCount);
        }
    };
    ;
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
    SlurmWidget.prototype._set_job_completed_tasks = function (xhttp, jobCount) {
        var _this = this;
        xhttp.onreadystatechange = function () {
            if (xhttp.readyState === xhttp.DONE && xhttp.status == 200) {
                var response = JSON.parse(xhttp.responseText);
                var alert_1 = document.createElement('div');
                if (response.returncode == 0) {
                    alert_1.classList.add('alert', 'alert-success', 'alert-dismissable', 'fade', 'show');
                }
                else {
                    alert_1.classList.add('alert', 'alert-danger', 'alert-dismissable', 'fade', 'show');
                }
                var temp = document.createElement('div');
                var closeLink = '<a href="#" class="close" data-dismiss="alert" aria-label="close">&times;</a>';
                temp.innerHTML = closeLink;
                alert_1.appendChild(temp.firstChild);
                var alertText = document.createTextNode(response.responseMessage);
                alert_1.appendChild(alertText);
                $('#alertContainer').append(alert_1);
                // If all current jobs have finished executing, 
                // reload the queue (using squeue)
                if (jobCount) {
                    // By the nature of javascript's sequential function execution,
                    // this will not cause a data race (not atomic, but still ok) 
                    jobCount.count++;
                    if (jobCount.numJobs == jobCount.count) {
                        _this._reload_data_table($('#queue').DataTable());
                    }
                }
                else {
                    _this._reload_data_table($('#queue').DataTable());
                }
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
                setInterval(function () { return widget.update(); }, AUTO_SQUEUE_LIMIT);
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
