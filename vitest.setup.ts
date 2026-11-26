import { cleanup } from '@super-ts/testing';
import { afterEach } from 'vitest';

// Unmounts everything `mount()` mounted during the test.
afterEach(() => cleanup());
