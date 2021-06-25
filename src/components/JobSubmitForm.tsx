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
    inputType: string;
    inputPathSelectType: string;
    filepath: string;
    inlineScript: string;
  };
}

/*
function delayUserInput(
  input: string,
  callback: (s: string) => any,
  delay: number
) {
  console.log('inside delayUserInput()', input);
  const timeout: number = setTimeout(callback(input), delay);
  return () => {
    clearTimeout(timeout);
  };
}
*/

export default class JobSubmitForm extends React.Component<
  types.Props,
  types.State
> {
  constructor(props: types.Props) {
    super(props);
    this.state = {
      inputType: 'path',
      inputPathSelectType: 'dropdown',
      filepath: '',
      inlineScript: ''
    };

    this.updateFilepath = this.updateFilepath.bind(this);
  }

  /*
   * Switch between submitting a file and creating a script in a text box
   * */
  changeInputType(inputType: string): void {
    this.setState({ inputType, filepath: '', inlineScript: '' });
  }

  /*
   * Handles selecting a file path from the current directory
   */
  handleFileSelect(): void {
    const items = this.props.filebrowser.model.items();
    let path =
      'Select a path containing your script from the filebrowser on the left';
    try {
      const i = items.next();
      console.log(`handleFileSelect() ${i}`);
      if (i && i.type === 'file') {
        path = i.path;
      } else {
        const message = 'No files in ' + this.props.filebrowser.model.path;
        const variant = 'warning';
        this.props.addAlert(message, variant);
      }
    } catch (e) {
      console.error(e);
      const variant = 'warning';
      this.props.addAlert(e.message, variant);
    }
    console.log(`handleFileSelect() path=${path}`);
    this.setState({ filepath: path });
  }

  /*
   * Update the path to the batch script that will be submitted to sbatch
   * */
  updateFilepath(s: string): void {
    console.log('updateFilepath() ', s);
    const userPath = s;
    console.log('updateFilepath() userPath=', userPath);
    const userFilename = userPath.split('/')[-1];
    const userBasePath = userPath.split(userFilename)[0];

    try {
      // try to find userPath with filebrowser
      this.props.filebrowser.model.cd(userBasePath).then(() => {
        // check that this is a file
        const iter = this.props.filebrowser.model.items();
        let i = iter.next();
        while (i) {
          if (i.name === userFilename && i.type !== 'file') {
            this.props.addAlert(
              'This path does not reference a file! name=' +
                userFilename +
                ' type=' +
                i.type,
              'danger'
            );
          }
          i = iter.next();
        }
        this.setState({ filepath: userPath });
      });
    } finally {
      console.log(`No errors with ${userPath}`);
    }
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
  }

  /*
   * Return a list of dropdown items that show files in the current directory
   */
  displayFiles(): React.ReactNode {
    const fileListing = [];
    const iter = this.props.filebrowser.model.items();
    let i = iter.next();
    while (i) {
      fileListing.push(i.path);
      i = iter.next();
    }

    console.log('displayFiles', fileListing);
    return fileListing.map(x => {
      return <Dropdown.Item key={x}>{x}</Dropdown.Item>;
    });
  }

  render(): React.ReactNode {
    const inputType = this.state.inputType;
    const fileListing = [];
    const iter = this.props.filebrowser.model.items();
    let i = iter.next();
    while (i) {
      if (i.type === 'file') {
        fileListing.push(i.path);
      }
      i = iter.next();
    }

    const fileItems = fileListing.map(x => {
      return <option key={x}>{x}</option>;
    });
    console.log(fileItems);
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
                            defaultValue={this.props.filebrowser.model.path}
                            value={this.state.filepath}
                            onChange={e => {
                              /*
                              console.log('calling delayUserInput()');
                              delayUserInput(
                                e.target.value,
                                this.updateFilepath,
                                500
                              );
                              */
                              this.updateFilepath(e.target.value);
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
                            onClick={this.handleFileSelect.bind(this)}
                            disabled={this.props.disabled}
                          >
                            {fileItems}
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
