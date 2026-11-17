// @vitest-environment node
/**
 * The conflict rule, exhaustively: every relation of the two origins against every answer to
 * "who created it". The table is the specification; a row missing from it fails the count.
 */
import { describe, expect, it } from 'vitest';
import { isReportedConflict, resolveMigrationConflict, type ConflictResolution, type CreatorSide } from '../conflict-rule';

const MINE: string = 'a'.repeat(64);
const THEIRS: string = 'b'.repeat(64);

type Relation = 'peer-unknown' | 'same' | 'different';
const peerOriginOf = (relation: Relation): string | null => (relation === 'peer-unknown' ? null : relation === 'same' ? MINE : THEIRS);

const TABLE: ReadonlyArray<readonly [Relation, CreatorSide, ConflictResolution['kind'], boolean]> = [
  ['peer-unknown', 'local', 'keep-own', false],
  ['peer-unknown', 'peer', 'keep-own', false],
  ['peer-unknown', 'neither', 'keep-own', false],
  ['same', 'local', 'identical', false],
  ['same', 'peer', 'identical', false],
  ['same', 'neither', 'identical', false],
  ['different', 'local', 'creator-keeps', true],
  ['different', 'peer', 'adopt-creator', true],
  ['different', 'neither', 'await-creator', true],
];

describe('the creator wins a migration conflict', () => {
  it('covers every combination exactly once', () => {
    const relations: Relation[] = ['peer-unknown', 'same', 'different'];
    const creators: CreatorSide[] = ['local', 'peer', 'neither'];
    const keys: string[] = TABLE.map(([r, c]: readonly [Relation, CreatorSide, unknown, unknown]): string => `${r}/${c}`);
    expect(new Set(keys).size).toBe(relations.length * creators.length);
    expect(keys.length).toBe(relations.length * creators.length);
  });

  for (const [relation, creator, expected, reported] of TABLE) {
    it(`${relation} origins, creator ${creator}: ${expected}${reported ? ', reported' : ''}`, () => {
      const resolution: ConflictResolution = resolveMigrationConflict({ localOrigin: MINE, peerOrigin: peerOriginOf(relation), creator });
      expect(resolution.kind).toBe(expected);
      expect(isReportedConflict(resolution)).toBe(reported);
    });
  }

  it('is symmetric: when the two sides differ, exactly one of them keeps its own as the shared copy', () => {
    const local: ConflictResolution = resolveMigrationConflict({ localOrigin: MINE, peerOrigin: THEIRS, creator: 'local' });
    const peer: ConflictResolution = resolveMigrationConflict({ localOrigin: THEIRS, peerOrigin: MINE, creator: 'peer' });
    expect([local.kind, peer.kind]).toEqual(['creator-keeps', 'adopt-creator']);
  });
});
