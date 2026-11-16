/**
 * Optional real-data path: load a NIfTI T1 volume (e.g. a public MNI152 template)
 * with nifti-reader-js and upload it as an 8-bit 3D texture.
 *
 * Usage: drop the file in public/mri/ and open mri.html?nifti=mri/your_t1.nii.gz
 */
import * as THREE from 'three';
import * as nifti from 'nifti-reader-js';

export interface RawVolume {
  texture: THREE.Data3DTexture;
  /** Multiply cube coords [-1,1] by this to get [-1,1] raw coords (fits the 200 mm cube). */
  scale: THREE.Vector3;
  /** ±1 per axis to bring the data into RAS orientation. */
  flip: THREE.Vector3;
  dims: [number, number, number];
}

export async function loadNifti(url: string): Promise<RawVolume> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  let buf: ArrayBuffer = await res.arrayBuffer();
  if (nifti.isCompressed(buf)) buf = nifti.decompress(buf) as ArrayBuffer;
  if (!nifti.isNIFTI(buf)) throw new Error('not a NIfTI file');
  const hdr = nifti.readHeader(buf);
  if (!hdr) throw new Error('bad NIfTI header');
  const img = nifti.readImage(hdr, buf);
  const [nx, ny, nz] = [hdr.dims[1], hdr.dims[2], hdr.dims[3]];
  const n = nx * ny * nz;

  let src: ArrayLike<number>;
  switch (hdr.datatypeCode) {
    case nifti.NIFTI1.TYPE_UINT8: src = new Uint8Array(img); break;
    case nifti.NIFTI1.TYPE_INT16: src = new Int16Array(img); break;
    case nifti.NIFTI1.TYPE_UINT16: src = new Uint16Array(img); break;
    case nifti.NIFTI1.TYPE_INT32: src = new Int32Array(img); break;
    case nifti.NIFTI1.TYPE_FLOAT32: src = new Float32Array(img); break;
    case nifti.NIFTI1.TYPE_FLOAT64: src = new Float64Array(img); break;
    default: throw new Error(`unsupported NIfTI datatype ${hdr.datatypeCode}`);
  }
  const slope = hdr.scl_slope || 1;
  const inter = hdr.scl_inter || 0;

  // robust normalisation: map the 99.5th percentile to 1
  const sample: number[] = [];
  for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 200000))) sample.push(src[i] * slope + inter);
  sample.sort((a, b) => a - b);
  const hi = sample[Math.floor(sample.length * 0.995)] || 1;
  const lo = Math.min(0, sample[0]);
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) data[i] = Math.max(0, Math.min(255, ((src[i] * slope + inter - lo) / (hi - lo)) * 255));

  const tex = new THREE.Data3DTexture(data, nx, ny, nz);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;

  // physical extent (mm) → fraction of our 200 mm cube
  const px = [hdr.pixDims[1], hdr.pixDims[2], hdr.pixDims[3]].map((v) => v || 1);
  const ext = [nx * px[0], ny * px[1], nz * px[2]];
  const scale = new THREE.Vector3(200 / ext[0], 200 / ext[1], 200 / ext[2]);
  // orientation: use the sign of the sform/qform diagonal (radiological storage → flip x)
  const aff = hdr.affine;
  const flip = new THREE.Vector3(Math.sign(aff[0][0]) || 1, Math.sign(aff[1][1]) || 1, Math.sign(aff[2][2]) || 1);
  return { texture: tex, scale, flip, dims: [nx, ny, nz] };
}
