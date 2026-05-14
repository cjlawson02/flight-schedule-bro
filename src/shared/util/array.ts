/**
 * Array utility functions
 */

/**
 * Chunk an array into smaller arrays of specified size
 *
 * This is primarily used to work around the Flight Schedule Pro API's hard limit
 * of 3 instructors per availability request.
 *
 * @param arr - The array to chunk
 * @param size - The size of each chunk
 * @returns An array of chunks
 *
 * @example
 * chunk([1, 2, 3, 4, 5], 2) // [[1, 2], [3, 4], [5]]
 * chunk(['a', 'b', 'c'], 3) // [['a', 'b', 'c']]
 */
export function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
