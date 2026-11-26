import { html, SuperElement } from '@super-ts/dom';
import { hotReplace } from '@super-ts/dom/internal';
import { flush, mount } from '@super-ts/testing';
import { describe, expect, test, vi } from 'vitest';

/** Two versions of the same component, as after its module is modified. */
function versions(tag: string) {
  class V1 extends SuperElement {
    static tag = tag;
    local = this.state({ clicks: 0 });
    render() {
      return html`<button @click=${() => this.local.set((s) => ({ clicks: s.clicks + 1 }))}>v1 ${this.local.get().clicks}</button>`;
    }
  }
  class V2 extends SuperElement {
    static tag = tag;
    local = this.state({ clicks: 0 });
    render() {
      return html`<button @click=${() => this.local.set((s) => ({ clicks: s.clicks + 10 }))}>v2 ${this.local.get().clicks}</button>`;
    }
  }
  return { V1, V2 };
}

describe('hot replacement', () => {
  test('the new methods apply to displayed elements, which keep their state', async () => {
    const { V1, V2 } = versions('hot-methods');
    const { container } = await mount(V1);
    container.querySelector('button')!.click();
    await flush();
    expect(container.textContent).toContain('v1 1');

    const reload = vi.fn();
    hotReplace([V2], { reload });
    await flush();
    expect(reload).not.toHaveBeenCalled();
    expect(container.textContent).toContain('v2 1'); // new render, same state

    container.querySelector('button')!.click();
    await flush();
    expect(container.textContent).toContain('v2 11'); // new handler
    expect(V2.create()).toBeInstanceOf(V2); // subsequent creations use the new version
    // A parent that was not reloaded still holds V1: it gets the new version anyway.
    expect(V1.create()).toBeInstanceOf(V2);
  });

  test('changed fields: full reload', async () => {
    const { V1 } = versions('hot-fields');
    class V2 extends SuperElement {
      static tag = 'hot-fields';
      local = this.state({ clicks: 0 });
      label = this.state({ text: 'new field' });
      render() {
        return html`<p>${this.label.get().text}</p>`;
      }
    }
    await mount(V1);
    const reload = vi.fn();
    hotReplace([V2], { reload });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('a modified arrow field handler: full reload', async () => {
    class V1 extends SuperElement {
      static tag = 'hot-arrow';
      onClick = () => 1;
      render() {
        return html`<p></p>`;
      }
    }
    class V2 extends SuperElement {
      static tag = 'hot-arrow';
      onClick = () => 2;
      render() {
        return html`<p></p>`;
      }
    }
    await mount(V1);
    const reload = vi.fn();
    hotReplace([V2], { reload });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('#private fields: full reload', async () => {
    const { V1, V2 } = versions('hot-private');
    await mount(V1);
    const reload = vi.fn();
    hotReplace([V2], { privateFields: true, reload });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('outside hot replacement, two classes for the same tag remain an error', () => {
    const { V1, V2 } = versions('hot-duplicate');
    V1.create();
    expect(() => V2.create()).toThrow('already used by another component');
  });
});
