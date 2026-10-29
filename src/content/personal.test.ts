import assert from 'node:assert/strict';
import test from 'node:test';
import { validPersonalData, type PersonalData } from './personal.ts';

test('personal data validation preserves legacy content and rejects corrupt records', () => {
  const data: PersonalData = {
    supplements: [{ id: 'personal-1', title: '我的理解', markdown: '**理由**', page: 8, region: { x: .1, y: .2, width: .5, height: .1 } }],
    notes: { example: '复习这个条件' },
  };
  assert.equal(validPersonalData(JSON.parse(JSON.stringify(data))), true);
  assert.equal(validPersonalData({ supplements: [], notes: {} }), true);
  assert.equal(validPersonalData({ ...data, supplements: [{ ...data.supplements[0], page: null, region: null }] }), true);
  for (const invalid of [
    null,
    { ...data, supplements: [data.supplements[0], data.supplements[0]] },
    { ...data, notes: { x: 3 } },
    { ...data, supplements: [{ ...data.supplements[0], page: 203 }] },
    { ...data, supplements: [{ ...data.supplements[0], region: { x: .9, y: 0, width: .5, height: .1 } }] },
  ]) assert.equal(validPersonalData(invalid), false);
});
