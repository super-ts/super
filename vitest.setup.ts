import { cleanup } from '@super-ts/testing';
import { afterEach } from 'vitest';

// Démonte tout ce que `mount()` a monté pendant le test.
afterEach(() => cleanup());
