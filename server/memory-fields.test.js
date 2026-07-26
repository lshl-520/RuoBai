import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryTypeLabel, normalizeMemoryFields } from './memory-fields.js';

test('legacy memories remain ordinary life memories and retain their pin state', () => {
  const fields = normalizeMemoryFields({}, { memory_type: '', is_important: 1, weight: 70 });
  assert.equal(fields.memory_type, 'life');
  assert.equal(fields.is_important, 1);
  assert.equal(fields.weight, 70);
});

test('future appointments keep date and lifecycle status', () => {
  const fields = normalizeMemoryFields({
    memory_type: 'appointment', appointment_at: '2026-08-10T20:00', appointment_status: 'pending', weight: 91,
  });
  assert.equal(fields.memory_type, 'appointment');
  assert.equal(fields.appointment_at, '2026-08-10 20:00:00');
  assert.equal(fields.appointment_status, 'pending');
  assert.equal(fields.is_important, 1);
  assert.equal(fields.weight, 91);
});

test('changing an appointment back to life clears appointment-only fields', () => {
  const fields = normalizeMemoryFields({ memory_type: 'life' }, {
    memory_type: 'appointment', appointment_at: '2026-08-10 20:00:00', appointment_status: 'pending', is_important: 1,
  });
  assert.equal(fields.appointment_at, null);
  assert.equal(fields.appointment_status, null);
  assert.equal(memoryTypeLabel('shared_experience'), '共同经历');
});
