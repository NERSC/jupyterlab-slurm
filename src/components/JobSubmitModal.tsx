import React, { Component } from 'react';
import {
  Modal,
  Form,
  Button,
} from 'react-bootstrap';
// Local
// import Select from './Select';

namespace types {
  export type Props = {
    show: boolean,
    onHide: () => void;
    submitJob: (input: string, inputType: string) => void;
  };

  export type State = {
    inputType: string;
    filepath: string;
    inlineScript: string;
  };
}

export default class JobSubmitModal extends Component<types.Props, types.State> {
  constructor(props) {
    super(props);
    this.state = {
      inputType: 'path',
      filepath: '',
      inlineScript: '',
    };
  }

  changeInputType(inputType: string) {
    this.setState({ inputType, filepath: '', inlineScript: '' });
  }

  updateFilepath(filepath: string) {
    this.setState({ filepath });
  }

  updateInlineScript(inlineScript: string) {
    this.setState({ inlineScript });
  }

  handleSubmit() {
    const { inputType, filepath, inlineScript } = this.state;
    const input = inputType === 'path' ? filepath : inlineScript;
    this.props.submitJob(input, inputType);
  }

  render() {
    const { show, onHide } = this.props;
    const { inputType } = this.state;
    return (
      <Modal show={show} size="lg" onHide={onHide} centered>
        <Modal.Header closeButton>
          <Modal.Title>Submit a Batch Job</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group controlId="mode-selector">
            <Form.Label>Script type</Form.Label>
            <Form.Control as="select" onChange={this.changeInputType.bind(this)}>
              <option value="path">File</option>
              <option value="contents">Text input</option>
            </Form.Control>
            {/* <Select options={['file', 'text Input']}/> */}
          </Form.Group>
          {inputType === 'path' &&
            <Form.Group controlId="filepath-input">
              <Form.Label>File path</Form.Label>
              <Form.Control
                type="text"
                placeholder="path relative to filebrowser"
                onChange={this.updateFilepath.bind(this)}
              />
            </Form.Group>
          }
          {inputType !== 'path' &&
            <Form.Group>
              <Form.Label>Write your script here</Form.Label>
              <Form.Control
                as="textarea"
                rows={10}
                onChange={this.updateInlineScript.bind(this)}
              />
            </Form.Group>
          }
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onHide}>Close</Button>
          <Button variant="primary" onClick={this.handleSubmit.bind(this)}>Submit Job</Button>
        </Modal.Footer>
      </Modal>
    );
  }
}
