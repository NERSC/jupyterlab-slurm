import React, { Component, ReactNode } from 'react';
import { Modal, Form, Button } from 'react-bootstrap';

namespace types {
  export type Props = {
    show: boolean;
    onHide: () => void;
    submitJob: (input: string, inputType: string) => void;
    error?: string;
    disabled?: boolean;
  };

  export type State = {
    inputType: string;
    filepath: string;
    inlineScript: string;
  };
}

export default class JobSubmitModal extends Component<
  types.Props,
  types.State
> {
  constructor(props: types.Props) {
    super(props);
    this.state = {
      inputType: 'path',
      filepath: '',
      inlineScript: ''
    };
  }

  changeInputType(inputType: string): void {
    this.setState({ inputType, filepath: '', inlineScript: '' });
  }

  updateFilepath(filepath: string): void {
    this.setState({ filepath });
  }

  updateInlineScript(inlineScript: string): void {
    this.setState({ inlineScript });
  }

  handleSubmit(): void {
    const { inputType, filepath, inlineScript } = this.state;
    const input = inputType === 'path' ? filepath : inlineScript;
    this.props.submitJob(input, inputType);
  }

  render(): ReactNode {
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
            <Form.Control
              as="select"
              onChange={e => this.changeInputType(e.target.value)}
              value={this.state.inputType}
              disabled={this.props.disabled}
            >
              <option value="path">File</option>
              <option value="contents">Text input</option>
            </Form.Control>
          </Form.Group>
          {inputType === 'path' && (
            <Form.Group controlId="filepath-input">
              <Form.Label>File path</Form.Label>
              <Form.Control
                type="text"
                placeholder="Path to Slurm script"
                onChange={e => this.updateFilepath(e.target.value)}
                disabled={this.props.disabled}
              />
            </Form.Group>
          )}
          {inputType !== 'path' && (
            <Form.Group>
              <Form.Label>Enter your Slurm script here</Form.Label>
              <Form.Control
                as="textarea"
                rows={10}
                onChange={e => this.updateInlineScript(e.target.value)}
                disabled={this.props.disabled}
              />
            </Form.Group>
          )}
          <div>{this.props.error}</div>
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={onHide}
            disabled={this.props.disabled}
          >
            Close
          </Button>
          <Button
            variant="primary"
            onClick={this.handleSubmit.bind(this)}
            disabled={this.props.disabled}
          >
            Submit Job
          </Button>
        </Modal.Footer>
      </Modal>
    );
  }
}
