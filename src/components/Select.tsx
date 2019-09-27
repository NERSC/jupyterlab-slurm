// Note: React-bootstrap provices a similar component, consider dropping this
import React, { Component } from 'react';

namespace types {
  export type Props = {
    options: string[];
    onChange?: (string) => void;
  };

  export type State = {
    value: string;
  };
}

export default class Select extends Component<types.Props, types.State> {
  constructor(props: types.Props) {
    super(props);
    this.state = { value: this.props.options[0] };
  }

  handleChange(event) {
    const value = event.target.value;
    this.setState({ value });
    if (this.props.onChange) {
      this.props.onChange(value);
    }
  }

  render() {
    return (
      <select value={this.state.value} onChange={this.handleChange.bind(this)}>
        {this.props.options.map((o) => (
          <option value={o} key={o}>{o}</option>
        ))}
      </select>
    )
  }
}
