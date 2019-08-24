export var modal = `
      <div class="modal fade" id="submitJobModal" tabindex="-1" role="dialog" aria-labelledby="submitJobModalTitle" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered" role="document">
          <div class="modal-content">
            <div class="modal-header">
              <h3 class="modal-title" id="submitJobModalTitle">Submit a Batch Job</h3>
              <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            <form id="jobSubmitForm" name="jobSubmit" role="form">
              <div class="modal-body">
                <div class="form-group">
                  <label for="path">Enter a file path containing a batch script</label>
                  <input type="text" name="path" id="batchPath" class="form-control">
                  <input type="submit" class="btn btn-primary" id="submitPath">
                </div>
                <div class="form-group">
                  <label for="script">Enter a new batch script</label>
                  <textarea name="script" id="batchScript" rows="10" class="form-control"></textarea>
                  <input type="submit" class="btn btn-primary" id="submitScript">
                  <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
      `;