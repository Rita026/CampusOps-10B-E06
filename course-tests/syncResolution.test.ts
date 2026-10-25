import { deduplicateOperations, resolveSync } from '../src/course-evaluation';
import { canonicalJson } from '../src/application/sync/syncResolution';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const base = deepFreeze({
  id: 'campus-inc-001',
  version: 1,
  fields: { work: { assignedTechnicianId: 'technician-1', status: 'assigned' }, priority: 'medium', notes: [] },
});

test('compares JSON content, not object identity or key order', () => {
  expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  const local = deepFreeze({ ...base, fields: { ...base.fields, work: { status: 'assigned', assignedTechnicianId: 'technician-1' } } });
  expect(resolveSync(base, local, base)).toEqual({ kind: 'merged', fields: base.fields });
});

test('the same change on both sides is accepted once, not reported as conflict', () => {
  const work = { assignedTechnicianId: 'technician-1', status: 'in_progress' };
  const local = deepFreeze({ ...base, fields: { ...base.fields, work } });
  const remote = deepFreeze({ ...base, version: 2, fields: { ...base.fields, work: { ...work } } });
  expect(resolveSync(base, local, remote)).toEqual({ kind: 'merged', fields: { ...base.fields, work } });
});

test('offline start plus remote reassignment conflicts on work while independent fields still merge', () => {
  const local = deepFreeze({ ...base, fields: { ...base.fields, work: { assignedTechnicianId: 'technician-1', status: 'in_progress' } } });
  const remote = deepFreeze({
    ...base,
    version: 3,
    fields: { ...base.fields, priority: 'high', work: { assignedTechnicianId: 'technician-2', status: 'assigned' } },
  });
  expect(resolveSync(base, local, remote)).toEqual({ kind: 'conflict', fields: ['work'] });
  expect(resolveSync(base, { ...local, fields: { ...local.fields, work: base.fields.work } }, remote))
    .toEqual({ kind: 'merged', fields: remote.fields });
});

test('reports every conflicting field sorted by name', () => {
  const local = deepFreeze({ id: 'r1', version: 1, fields: { zeta: 'L', alpha: 'L', middle: 'same' } });
  const remote = deepFreeze({ id: 'r1', version: 2, fields: { zeta: 'R', alpha: 'R', middle: 'same' } });
  const start = deepFreeze({ id: 'r1', version: 1, fields: { zeta: 'B', alpha: 'B', middle: 'same' } });
  expect(resolveSync(start, local, remote)).toEqual({ kind: 'conflict', fields: ['alpha', 'zeta'] });
});

test('added and removed fields are changes too; deleting on one side and editing on the other conflicts', () => {
  const start = deepFreeze({ id: 'r1', version: 1, fields: { title: 'A', diagnosis: 'x' } });
  expect(resolveSync(
    start,
    { id: 'r1', version: 1, fields: { title: 'A', diagnosis: 'x', note: 'nueva' } },
    { id: 'r1', version: 2, fields: { title: 'A' } },
  )).toEqual({ kind: 'merged', fields: { title: 'A', note: 'nueva' } });
  expect(resolveSync(
    start,
    { id: 'r1', version: 1, fields: { title: 'A' } },
    { id: 'r1', version: 2, fields: { title: 'A', diagnosis: 'y' } },
  )).toEqual({ kind: 'conflict', fields: ['diagnosis'] });
  expect(resolveSync(
    start,
    { id: 'r1', version: 1, fields: { title: 'A', diagnosis: null } },
    { id: 'r1', version: 2, fields: { title: 'A' } },
  )).toEqual({ kind: 'conflict', fields: ['diagnosis'] });
});

test('merged values are copies: changing the result does not reach the inputs', () => {
  const remote = { id: base.id, version: 2, fields: { ...base.fields, priority: 'high' } };
  const result = resolveSync(base, base, remote);
  expect(result.kind).toBe('merged');
  if (result.kind !== 'merged') return;
  (result.fields.work as { status: string }).status = 'closed';
  expect(base.fields.work.status).toBe('assigned');
  expect(remote.fields.work.status).toBe('assigned');
});

test('refuses to combine versions of different incidents', () => {
  expect(() => resolveSync(base, { ...base, id: 'campus-inc-002' }, base)).toThrow('misma entidad');
});

test('deduplication keeps the first occurrence, preserves order and does not mutate the input', () => {
  const operations = deepFreeze([
    { operationId: 'op-b', value: 1 },
    { operationId: 'op-a', value: 2 },
    { operationId: 'op-b', value: 3 },
    { operationId: 'op-a', value: 4 },
  ]);
  const result = deduplicateOperations(operations);
  expect(result).toEqual([{ operationId: 'op-b', value: 1 }, { operationId: 'op-a', value: 2 }]);
  expect(result[0]).toBe(operations[0]);
  expect(result).not.toBe(operations);
  expect(operations).toHaveLength(4);
  expect(deduplicateOperations([])).toEqual([]);
});
