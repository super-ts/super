---
name: super-internals-stay-in-packages
description: "Super framework: framework plumbing and its tests belong in packages/@super, never in the user-land example"
metadata:
  node_type: memory
  type: feedback
  originSessionId: b44e98bc-e4c0-48b1-8adb-a4815d9bf6ba
  modified: 2026-11-23T15:08:52.712Z
---

In the Super framework project, anything that is Super's internal mechanics stays under the hood in `packages/`: no plumbing in user-land code (e.g. the user rejected a `declare module '@super-ts/dom' { interface Register }` augmentation in `routes.ts`), and no user-land tests that validate Super's behaviour (router typing, lazy screens). The example app only tests its own behaviour.

**Why:** the user wants the example to show what a real app writes, with Super guaranteeing its own contracts.

**How to apply:** when adding a framework feature, design the API so user-land writes no boilerplate, and put its runtime and type tests (`*.test-d.ts`) in the package. Related: [[super-lit-hidden]].
