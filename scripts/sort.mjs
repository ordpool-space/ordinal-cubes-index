/**
 * Canonical cube ordering — matches the original genesis CubeService.
 *
 * Sort key: blockHeight ascending, inscriptionNumber as tiebreaker. The
 * position in this sort is what becomes the "Ordinal Cube #N" label, so it
 * must be stable across rebuilds — changing it would renumber every cube
 * the public has already seen.
 *
 * Inscription number alone would be wrong: pre-Jubilee cursed inscriptions
 * got negative numbers but could land in any block, so e.g. the Donny
 * cube (number -265038, block 814583) is an outlier in the middle of the
 * sequence, not the genesis cube.
 */
export function compareByHeightThenNumber(a, b) {
  if (a.blockHeight !== b.blockHeight) return a.blockHeight - b.blockHeight;
  return a.inscriptionNumber - b.inscriptionNumber;
}

/** Strip any cached `name` and reassign positional names from sorted order. */
export function applyPositionalNames(cubes) {
  cubes.sort(compareByHeightThenNumber);
  return cubes.map((cube, index) => {
    const { name: _omit, ...rest } = cube;
    const titleTrait = cube.attributes?.find((a) => a.trait_type === 'Title');
    const name = titleTrait
      ? `Ordinal Cube #${index} (${titleTrait.value})`
      : `Ordinal Cube #${index}`;
    return { ...rest, name };
  });
}
