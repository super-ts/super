import { html, SuperElement } from '@super-ts/dom';

type Props = { name: string };
type Emits = { closed: { reason: string } };

/** Un composant .ts utilisé depuis le .super. */
export class Greeting extends SuperElement<{ props: Props; emits: Emits }> {
  static tag = 'srv-greeting';

  render() {
    return html`<p>Bonjour ${this.props.name}</p>`;
  }
}
