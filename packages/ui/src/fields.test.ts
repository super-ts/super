import { html, SuperElement } from '@super-ts/dom';
import { fakeStore, flush, mount } from '@super-ts/testing';
import { Checkbox, Field, fieldOf, RadioGroup, Select } from '@super-ts/ui';
import { describe, expect, test } from 'vitest';
import './__fixtures__/ui-contracts.ts';

class Profile extends SuperElement {
  static tag = 'ui-t-profile';
  library = this.contract('ui-library');
  edit = this.form({
    initial: { name: '', age: null as number | null, country: 'FR', newsletter: false, tags: [] as string[], plan: 'free' },
    rules: { name: (v) => v.trim() !== '' || 'Name required' },
    checks: {
      name: { command: 'checkName', toInput: (name) => ({ name }), accept: ({ available }) => available || 'Already taken', delay: 0 },
    },
    submit: { to: this.library, command: 'save', toInput: (values) => values },
    failures: { fields: {}, form: { network: 'Cannot connect' } },
  });

  render() {
    const { edit } = this;
    return html`<form ${edit.bind()}>
      ${Field.create({ field: fieldOf(edit, 'name'), label: 'Name', hint: 'As displayed' })}
      ${Field.create({ field: fieldOf(edit, 'age'), label: 'Age', type: 'number' })}
      ${Select.create({
        field: fieldOf(edit, 'country'),
        label: 'Country',
        options: [
          { value: 'FR', label: 'France' },
          { value: 'BE', label: 'Belgium' },
        ],
      })}
      ${Checkbox.create({ field: fieldOf(edit, 'newsletter'), label: 'Newsletter' })}
      ${Checkbox.create({ field: fieldOf(edit, 'tags'), label: 'Sport', value: 'sport' })}
      ${RadioGroup.create({
        field: fieldOf(edit, 'plan'),
        label: 'Plan',
        options: [
          { value: 'free', label: 'Free' },
          { value: 'pro', label: 'Pro' },
        ],
      })}
      <button type="submit">Save</button>
    </form>`;
  }
}

const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('fields bound to a form', () => {
  async function setup() {
    const library = fakeStore('ui-library', {
      state: { books: [], total: 0, suggestions: [] },
      commands: { checkName: async () => ({ available: true }), save: async () => ({ id: '1' }) },
    });
    const { container, element } = await mount(Profile, { stores: [library] });
    const byLabel = (text: string) => {
      const label = [...container.querySelectorAll('label, legend')].find((l) => l.textContent!.trim() === text)!;
      return container.querySelector<HTMLInputElement>(`#${label.getAttribute('for')}`)!;
    };
    return { container, element, library, byLabel };
  }

  test('the label names the field, the hint describes it', async () => {
    const { container, byLabel } = await setup();
    const name = byLabel('Name');
    expect(name.tagName).toBe('INPUT');
    const hint = container.querySelector('.super-field-hint')!;
    expect(name.getAttribute('aria-describedby')).toBe(hint.id);
    expect(name.hasAttribute('aria-invalid')).toBe(false);
  });

  test('typing fills the form, with the type of each field', async () => {
    const { element, byLabel } = await setup();
    type(byLabel('Name'), 'Ada');
    type(byLabel('Age'), '36');
    const country = byLabel('Country') as unknown as HTMLSelectElement;
    country.value = 'BE';
    country.dispatchEvent(new Event('change', { bubbles: true }));
    byLabel('Newsletter').click();
    byLabel('Sport').click();
    await flush();

    expect(element.edit.values()).toMatchObject({ name: 'Ada', age: 36, country: 'BE', newsletter: true, tags: ['sport'] });
  });

  test('one radio per option, in a fieldset whose legend is the label', async () => {
    const { container, element } = await setup();
    const radios = container.querySelectorAll<HTMLInputElement>('.super-radio-group input[type=radio]');
    expect(container.querySelector('.super-radio-group legend')!.textContent).toBe('Plan');
    expect([...radios].map((r) => r.checked)).toEqual([true, false]);
    radios[1]!.click();
    await flush();
    expect(element.edit.values().plan).toBe('pro');
  });

  test('the rule error is shown under the field, which becomes invalid and described by it', async () => {
    const { container, byLabel } = await setup();
    container.querySelector('form')!.requestSubmit();
    await flush();

    const name = byLabel('Name');
    const error = container.querySelector('.super-field-error')!;
    expect(error.textContent).toBe('Name required');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(name.getAttribute('aria-describedby')!.split(' ')).toContain(error.id);
  });
});
