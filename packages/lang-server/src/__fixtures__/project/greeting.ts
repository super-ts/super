import { html, SuperElement } from '@super-ts/dom';

type Props = { name: string };
type Emits = { closed: { reason: string } };

/** A .ts component used from the .super file. */
export class Greeting extends SuperElement<{ props: Props; emits: Emits }> {
  static tag = 'srv-greeting';

  render() {
    return html`<p>Hello ${this.props.name}</p>`;
  }
}
