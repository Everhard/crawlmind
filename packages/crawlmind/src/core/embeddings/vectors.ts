/** Dot product; equals cosine similarity for normalized vectors. */
export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] as number) * (b[i] as number);
  return sum;
}

export function vectorToBlob(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function blobToVector(blob: Buffer): Float32Array {
  const copy = new Uint8Array(blob); // aligned copy
  return new Float32Array(copy.buffer, 0, copy.byteLength / 4);
}
