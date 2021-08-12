import React from 'react';
import {
  Accordion,
  Button,
  Card,
  Col,
  Dropdown,
  Form,
  Row,
  ToggleButton,
  ToggleButtonGroup
} from 'react-bootstrap';
import { BsCaretDownFill, BsCaretRightFill } from 'react-icons/bs';
import { FileBrowser } from '@jupyterlab/filebrowser';

namespace types {
  export type Props = {
    filebrowser: FileBrowser;
    submitJob: (input: string, inputType: string) => void;
    addAlert: (message: string, variant: string) => void;
    disabled?: boolean;
    theme: string;
  };

  export type State = {
    filebrowser: FileBrowser;
    fileitems: JSX.Element[];
    inputType: string;
    inputPathSelectType: string;
    filepath: string;
    inlineScript: string;
    inputTimeout: number;
  };
}

export default class JobSubmitForm extends React.Component<
  types.Props,
  types.State
> {
  constructor(props: types.Props) {
    super(props);
    this.state = {
      filebrowser: this.props.filebrowser,
      fileitems: [],
      inputType: 'path',
      inputPathSelectType: 'dropdown',
      filepath: '',
      inlineScript: '',
      inputTimeout: 0
    };

    this.updateFilepath = this.updateFilepath.bind(this);
    this.updateFileitems();
  }

  /*
   * Switch between submitting a file and creating a script in a text box
   * */
  changeInputType(inputType: string): void {
    this.setState({
      inputType,
      inputTimeout: 0
    });
  }

  /*
   * Handles selecting a file path from the current directory
   */
  handleFileSelect(event: React.ChangeEvent<HTMLInputElement>): void {
    this.setState({ filepath: event.target.value });
  }

  /*
   * Update the path to the batch script that will be submitted to sbatch
   * */
  updateFilepath(s: string): void {
    // any path validation here has to happen server-side
    this.setState({ filepath: s });
  }

  /*
   * Pick up typing changes from the batch script text box
   * */
  updateInlineScript(inlineScript: string): void {
    this.setState({ inlineScript });
  }

  handleInputType(t: string): void {
    this.setState({ inputType: t });
  }

  /*
   * User has clicked the submit job button
   */
  handleSubmit(): void {
    const { inputType, filepath, inlineScript } = this.state;
    const input = inputType === 'path' ? filepath : inlineScript;

    this.props.submitJob(input, inputType);

    const variant = 'success';
    this.props.addAlert('Job submitted', variant);
  }

  /*
   * Return a list of dropdown items that show files in the current directory
   */
  displayFiles(): React.ReactNode {
    const fileListing = [];
    const iter = this.state.filebrowser.model.items();
    let i = iter.next();
    while (i) {
      fileListing.push(i.path);
      i = iter.next();
    }

    return fileListing.map(x => {
      return <Dropdown.Item key={x}>{x}</Dropdown.Item>;
    });
  }

  private getFileItems(filebrowser: FileBrowser): JSX.Element[] {
    const fileListing = [];
    const iter = filebrowser.model.items();
    let i = iter.next();
    while (i) {
      if (i.type === 'file') {
        fileListing.push(i.path);
      }
      i = iter.next();
    }

    let fileItems;

    if (fileListing.length > 0) {
      fileItems = fileListing.map(x => {
        return <option key={x}>{x}</option>;
      });
    } else {
      fileItems = [<option key={''}>{''}</option>];
    }

    return fileItems;
  }

  private updateFileitems(): void {
    const currentFileItems = this.getFileItems(this.state.filebrowser);
    if (currentFileItems !== this.state.fileitems) {
      this.setState({ fileitems: currentFileItems });

      let i;
      let found = false;
      for (i = 0; i < currentFileItems.length; i++) {
        if (String(currentFileItems[i].key) === this.state.filepath) {
          found = true;
        }
      }
      // if the last selected filepath does not exist here, choose the first entry
      if (found === false) {
        this.setState({ filepath: String(currentFileItems[0].key) });
      }
    }
    setTimeout(() => {
      this.updateFileitems();
    }, 100);
  }

  render(): React.ReactNode {
    const inputType = this.state.inputType;

    return (
      <>
        <Form>
          <Row className={'justify-content-center jp-SlurmWidget-row'}>
            <h2>Submit a Batch Job</h2>
          </Row>
          <Row className={'justify-content-center'}>
            <ToggleButtonGroup
              type="radio"
              name="mode-selector"
              value={inputType}
              onChange={this.handleInputType.bind(this)}
            >
              <ToggleButton value="path" variant="outline-secondary">
                Submit a File
              </ToggleButton>
              <ToggleButton value="contents" variant="outline-secondary">
                Submit Text
              </ToggleButton>
            </ToggleButtonGroup>
          </Row>
          <Row className={'justify-content-center  jp-SlurmWidget-row'}>
            <Col sm={12}>
              {inputType === 'path' && (
                <Accordion defaultActiveKey={'1'}>
                  <Card>
                    <Accordion.Toggle
                      as={Card.Header}
                      eventKey={'0'}
                      onClick={() => {
                        this.setState({ inputPathSelectType: 'textfield' });
                      }}
                    >
                      {this.state.inputPathSelectType === 'textfield' && (
                        <BsCaretDownFill />
                      )}
                      {this.state.inputPathSelectType === 'dropdown' && (
                        <BsCaretRightFill />
                      )}
                      Type in the path to your slurm script
                    </Accordion.Toggle>
                    <Accordion.Collapse eventKey={'0'}>
                      <Card.Body>
                        <Form.Group>
                          <Form.Control
                            type="text"
                            placeholder={this.props.filebrowser.model.path}
                            onChange={e => {
                              const timeout = setTimeout(() => {
                                this.updateFilepath(e.target.value);
                              }, 250);
                              return () => {
                                clearTimeout(timeout);
                              };
                            }}
                            disabled={this.props.disabled}
                          />
                        </Form.Group>
                        <Button
                          variant="primary"
                          onClick={this.handleSubmit.bind(this)}
                          disabled={this.props.disabled}
                        >
                          Submit Job
                        </Button>
                      </Card.Body>
                    </Accordion.Collapse>
                  </Card>
                  <Card>
                    <Accordion.Toggle
                      as={Card.Header}
                      eventKey={'1'}
                      onClick={() => {
                        this.setState({ inputPathSelectType: 'dropdown' });
                      }}
                    >
                      {this.state.inputPathSelectType === 'dropdown' && (
                        <BsCaretDownFill />
                      )}
                      {this.state.inputPathSelectType === 'textfield' && (
                        <BsCaretRightFill />
                      )}
                      Choose a slurm script from your current directory
                    </Accordion.Toggle>
                    <Accordion.Collapse eventKey={'1'}>
                      <Card.Body>
                        <Form.Group>
                          <Form.Control
                            as="select"
                            id={'fileselect-dropdown'}
                            placeholder={'Select a file'}
                            value={this.state.filepath}
                            onChange={this.handleFileSelect.bind(this)}
                            disabled={this.props.disabled}
                          >
                            {this.state.fileitems}
                          </Form.Control>
                        </Form.Group>
                        <Button
                          variant="primary"
                          onClick={this.handleSubmit.bind(this)}
                          disabled={this.props.disabled}
                        >
                          Submit Job
                        </Button>
                      </Card.Body>
                    </Accordion.Collapse>
                  </Card>
                </Accordion>
              )}
              {inputType !== 'path' && (
                <Form.Group>
                  <Form.Label>Enter your Slurm script here</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={30}
                    onChange={e => this.updateInlineScript(e.target.value)}
                    disabled={this.props.disabled}
                  />
                  <Button
                    variant="primary"
                    onClick={this.handleSubmit.bind(this)}
                    disabled={this.props.disabled}
                  >
                    Submit Job
                  </Button>
                </Form.Group>
              )}
            </Col>
          </Row>
        </Form>
      </>
    );
  }
}
