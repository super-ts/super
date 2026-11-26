import { createRouter } from '@super-ts/dom';
import { flush, mount } from '@super-ts/testing';
import { AppShell } from '@components/app-shell';
import { CartStore } from '@core/cart/store';
import { CheckoutStore } from '@core/checkout/store';
import { CounterStore } from '@core/counter/store';
import { ErrorLogStore } from '@core/error-log/store';
import { ProfileStore } from '@core/profile/store';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import { createFakeOrderClient } from './adapters/fake-order-client';
import { createFakeProfileClient } from './adapters/fake-profile-client';
import { createLocalStorageCounterRepository } from './adapters/local-storage-counter-repository';
import { Router } from './routes';

// The whole app, assembled as in main.ts: real stores, adapters (simulated servers without latency),
// an in-memory router, and onError feeding the log of the "Errors" example.
async function startApp(initialPath = '/') {
  const counter = CounterStore.create({ counterRepository: createLocalStorageCounterRepository() });
  const profileClient = createFakeProfileClient({ delay: 0 });
  const profile = ProfileStore.create({ profileClient });
  const cart = CartStore.create();
  const orderClient = createFakeOrderClient({ delay: 0 });
  const checkout = CheckoutStore.create({ cart, orderClient });
  const errorLog = ErrorLogStore.create();
  const router = createRouter(Router, { mode: 'memory', initialPath, title: { default: 'Super · examples', suffix: ' · Super' } });
  const { container } = await mount(AppShell, {
    stores: [counter, profile, cart, checkout, errorLog],
    router,
    onError: (error, { tag, phase, caughtBy }) => errorLog.send('record', { message: error.message, tag, phase, caughtBy }),
  });
  await flush(); // lets `load` finish
  return { router, profileClient, orderClient, cart, ui: within(container) };
}

describe('examples app', () => {
  beforeEach(() => localStorage.clear());

  test('the home page lists the examples and leads to each one', async () => {
    const { router, ui } = await startApp();

    expect(ui.getByRole('heading', { name: 'Super examples' })).toBeTruthy();
    await userEvent.click(ui.getByRole('link', { name: 'Profile form' }));
    expect(router.state().name).toBe('profile');
  });

  test('the tab title follows the displayed screen, and the cart on the shop', async () => {
    const { router, cart } = await startApp('/shop');
    expect(document.title).toBe('Shop · Super');
    await cart.send('add', { sku: 'mug' });
    await flush();
    expect(document.title).toBe('Shop (1 in cart) · Super');
    router.send('navigate', { to: 'kit-forms' });
    await flush();
    expect(document.title).toBe('Forms and commands · Super'); // set by KitPage, which is not a screen
  });

  test('the counter list shows the persisted values', async () => {
    localStorage.setItem('super.counters', JSON.stringify({ pushups: 12 }));
    const { ui } = await startApp('/counters');

    expect(ui.getByRole('heading', { name: 'My counters' })).toBeTruthy();
    const pushUps = ui.getByRole('link', { name: 'Push-ups' });
    expect(pushUps.getAttribute('href')).toBe('/counters/pushups');
    expect(pushUps.parentElement!.textContent).toContain('12');
  });

  test('full counter journey: list, detail, increment, back', async () => {
    const { router, ui } = await startApp('/counters');

    await userEvent.click(ui.getByRole('link', { name: 'Coffees' }));
    expect(router.state()).toMatchObject({ path: '/counters/coffees', name: 'counter', params: { id: 'coffees' } });
    expect(ui.getByRole('heading', { name: 'Coffees' })).toBeTruthy();

    await userEvent.click(ui.getByRole('button', { name: 'Increment' }));
    await userEvent.click(ui.getByRole('button', { name: 'Increment' }));
    expect(await ui.findByText('Incremented: 2')).toBeTruthy();

    await userEvent.click(ui.getByRole('link', { name: '← All counters' }));
    expect(ui.getByRole('link', { name: 'Coffees' }).parentElement!.textContent).toContain('2');
    expect(JSON.parse(localStorage.getItem('super.counters')!)).toEqual({ coffees: 2 });
  });

  test('back returns to the previous screen', async () => {
    const { router, ui } = await startApp('/counters');
    await userEvent.click(ui.getByRole('link', { name: 'Books read' }));

    await router.send('back');
    await flush();

    expect(ui.getByRole('heading', { name: 'My counters' })).toBeTruthy();
  });

  test('an unknown path shows the not-found screen, which leads back to the examples', async () => {
    const { router, ui } = await startApp('/nowhere');

    expect(ui.getByRole('heading', { name: 'Page not found' })).toBeTruthy();
    await userEvent.click(ui.getByRole('button', { name: 'Back to the examples' }));
    await flush();

    expect(router.state().name).toBe('examples');
  });

  test('/form redirects to the profile form', async () => {
    const { router, ui } = await startApp('/form');

    expect(router.state()).toMatchObject({ path: '/profile', name: 'profile' });
    expect(ui.getByRole('heading', { name: 'Profile form' })).toBeTruthy();
  });

  test('the navigation marks the current section, including on a counter detail', async () => {
    const { ui } = await startApp('/counters/coffees');
    const nav = within(ui.getByRole('navigation', { name: 'Examples' }));

    expect(nav.getByRole('link', { name: 'Counters' }).getAttribute('aria-current')).toBe('page');
    expect(nav.getByRole('link', { name: 'Examples' }).hasAttribute('aria-current')).toBe(false);
  });

  test('the form saves to the simulated server', async () => {
    const { profileClient, ui } = await startApp('/profile');

    await userEvent.type(ui.getByLabelText('Name'), 'Ada');
    await userEvent.type(ui.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(ui.getByLabelText('Password'), 'longpassword');
    await userEvent.type(ui.getByLabelText('Confirmation'), 'longpassword');
    await userEvent.selectOptions(ui.getByLabelText('Languages'), ['fr']);
    await userEvent.type(ui.getByLabelText('Number'), '06 12 34 56 78');
    await new Promise((resolve) => setTimeout(resolve, 450)); // the address check
    await userEvent.click(ui.getByRole('button', { name: 'Save' }));

    expect(await ui.findByText('Profile saved (no. p1).')).toBeTruthy();
    expect(profileClient.saved[0]).toMatchObject({ name: 'Ada', email: 'ada@example.com', languages: ['fr'] });
  });

  test('shop: you cannot order an empty cart (guard), then an order empties the cart', async () => {
    const { router, orderClient, ui } = await startApp('/shop/checkout');
    expect(router.state().name).toBe('shop'); // redirected by the guard

    await userEvent.click(ui.getByRole('button', { name: 'Add Super mug' }));
    await userEvent.click(ui.getByRole('link', { name: 'Checkout' }));
    expect(router.state().name).toBe('checkout');

    await userEvent.type(ui.getByLabelText('Delivery address'), '12 Lilac Street, London');
    await userEvent.click(ui.getByRole('button', { name: 'Pay' }));

    expect(await ui.findByText('Order no. C0001, €12.00.')).toBeTruthy();
    expect(orderClient.orders[0]).toMatchObject({ lines: [{ sku: 'mug', quantity: 1 }], total: 1200 });
    await userEvent.click(ui.getByRole('link', { name: 'Back to the shop' }));
    expect(ui.getByText('No items yet.')).toBeTruthy(); // the cart was emptied by Checkout
  });

  test('errors: each case is caught at the right level and appears in the log', async () => {
    const { router, ui } = await startApp('/errors');
    const log = () => within(ui.getByRole('region', { name: 'onError log' }));

    await userEvent.click(ui.getByRole('button', { name: 'Break the block' }));
    expect(await ui.findByText(/This block crashed/)).toBeTruthy();
    expect(
      log()
        .getAllByText(/fragile-card/)[0]!
        .closest('li')!.textContent,
    ).toContain('caught by fragile-card');

    await userEvent.click(ui.getByRole('button', { name: 'Show the broken child' }));
    expect(await ui.findByText(/The parent caught its child's error/)).toBeTruthy();
    expect(
      log()
        .getByText(/broken-child/)
        .closest('li')!.textContent,
    ).toContain('caught by guarded-panel');

    await userEvent.click(ui.getByRole('button', { name: 'Click that crashes' }));
    await flush();
    expect(
      log()
        .getByText(/the click handler crashed/)
        .closest('li')!.textContent,
    ).toContain('phase event');

    await userEvent.click(ui.getByRole('button', { name: "Break everything ('!' screen)" }));
    await flush();
    expect(ui.getByRole('heading', { name: 'This page ran into a problem' })).toBeTruthy();
    expect(router.state().name).toBe('errors'); // still on the same route: the '!' screen replaces the screen
  });

  test("errors: after the '!' screen, clicking 'Errors' again or going through another page brings back the original screen", async () => {
    const { ui } = await startApp('/errors');
    const nav = () => within(ui.getByRole('navigation', { name: 'Examples' }));
    const crash = async () => {
      await userEvent.click(ui.getByRole('button', { name: "Break everything ('!' screen)" }));
      await flush();
      expect(ui.getByRole('heading', { name: 'This page ran into a problem' })).toBeTruthy();
    };

    await crash();
    await userEvent.click(nav().getByRole('link', { name: 'Errors' })); // same path
    await flush();
    expect(ui.getByRole('heading', { name: 'Errors' })).toBeTruthy();

    await crash();
    await userEvent.click(nav().getByRole('link', { name: 'Widget' }));
    await userEvent.click(nav().getByRole('link', { name: 'Errors' }));
    await flush();
    expect(ui.getByRole('heading', { name: 'Errors' })).toBeTruthy();
    expect(ui.getByText('Ready.')).toBeTruthy(); // a fresh screen: the block is no longer broken
  });
});
