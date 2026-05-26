import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryStorage,
  getPreferredInitialRoute,
  markModelOnboardingDismissed,
  shouldShowModelOnboarding
} from './model-onboarding.js';

test('shouldShowModelOnboarding is true when backend says onboarding is needed and user has not dismissed it', () => {
  const storage = createMemoryStorage();
  assert.equal(
    shouldShowModelOnboarding(
      { needsOnboarding: true, activeConfigIsTest: true },
      'new-user',
      storage
    ),
    true
  );
});

test('dismissed test-config onboarding stops redirecting chat route to me', () => {
  const storage = createMemoryStorage();
  markModelOnboardingDismissed('new-user', storage);

  assert.equal(
    getPreferredInitialRoute(
      '',
      { needsOnboarding: true, activeConfigIsTest: true },
      'new-user',
      storage
    ),
    'chat'
  );
});

test('first login without dismissal redirects empty route to me', () => {
  const storage = createMemoryStorage();

  assert.equal(
    getPreferredInitialRoute(
      '',
      { needsOnboarding: true, activeConfigIsTest: true },
      'new-user',
      storage
    ),
    'me'
  );
});
