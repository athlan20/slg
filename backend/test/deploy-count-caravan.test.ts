// 交易所商队不带兵，不占校场名额（deployCountOf 不计 purpose='caravan' 的行军）
import assert from 'node:assert/strict';
import test from 'node:test';
import { deployCountOf, type MarchRow } from '../api/src/views';

const march = (purpose: string) => ({ purpose }) as MarchRow;

test('deployCountOf 不计商队，仍计其他行军、占领野地与协防外派', () => {
  const snap = {
    marches: [march('plunder'), march('return'), march('caravan'), march('caravan')],
    territory: [{}],
    assistsOut: [{}],
  } as unknown as Parameters<typeof deployCountOf>[0];
  assert.equal(deployCountOf(snap), 4);
});

test('只有商队在途时在外部队数为 0', () => {
  const snap = { marches: [march('caravan')], territory: [] } as unknown as Parameters<typeof deployCountOf>[0];
  assert.equal(deployCountOf(snap), 0);
});
