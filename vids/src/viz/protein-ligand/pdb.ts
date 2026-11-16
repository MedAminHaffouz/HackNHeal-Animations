/**
 * Minimal PDB parser for the fixed-column format: ATOM/HETATM, HELIX, SHEET, CONECT.
 * https://www.wwpdb.org/documentation/file-format-content/format33/v3.3.html
 */

export interface Atom {
  serial: number;
  name: string;
  resName: string;
  chain: string;
  resSeq: number;
  x: number;
  y: number;
  z: number;
  element: string;
  het: boolean;
}

export interface SSRange {
  kind: 'helix' | 'sheet';
  chain: string;
  start: number;
  end: number;
}

export interface Structure {
  atoms: Atom[];
  ss: SSRange[];
  conect: Map<number, number[]>;
}

const col = (l: string, a: number, b: number) => l.slice(a, b).trim();

export function parsePDB(text: string): Structure {
  const atoms: Atom[] = [];
  const ss: SSRange[] = [];
  const conect = new Map<number, number[]>();
  for (const line of text.split(/\r?\n/)) {
    const rec = line.slice(0, 6);
    if (rec === 'ATOM  ' || rec === 'HETATM') {
      const alt = line[16];
      if (alt !== ' ' && alt !== 'A' && alt !== undefined) continue; // keep first altloc only
      const name = col(line, 12, 16);
      let element = col(line, 76, 78);
      if (!element) element = name.replace(/[^A-Za-z]/g, '').slice(0, 1);
      atoms.push({
        serial: parseInt(col(line, 6, 11), 10),
        name,
        resName: col(line, 17, 20),
        chain: line[21] ?? ' ',
        resSeq: parseInt(col(line, 22, 26), 10),
        x: parseFloat(col(line, 30, 38)),
        y: parseFloat(col(line, 38, 46)),
        z: parseFloat(col(line, 46, 54)),
        element: element.toUpperCase(),
        het: rec === 'HETATM',
      });
    } else if (rec === 'HELIX ') {
      ss.push({ kind: 'helix', chain: line[19], start: parseInt(col(line, 21, 25), 10), end: parseInt(col(line, 33, 37), 10) });
    } else if (rec === 'SHEET ') {
      ss.push({ kind: 'sheet', chain: line[21], start: parseInt(col(line, 22, 26), 10), end: parseInt(col(line, 33, 37), 10) });
    } else if (rec === 'CONECT') {
      const a = parseInt(col(line, 6, 11), 10);
      const list: number[] = [];
      for (let c = 11; c < 31; c += 5) {
        const v = parseInt(col(line, c, c + 5), 10);
        if (Number.isFinite(v)) list.push(v);
      }
      conect.set(a, (conect.get(a) ?? []).concat(list));
    }
  }
  return { atoms, ss, conect };
}

/** Covalent bonds within a set of atoms: CONECT if available, else distance-based. */
export function inferBonds(atoms: Atom[], conect?: Map<number, number[]>): Array<[number, number]> {
  const bonds: Array<[number, number]> = [];
  const bySerial = new Map(atoms.map((a, i) => [a.serial, i]));
  if (conect && atoms.some((a) => conect.has(a.serial))) {
    const seen = new Set<string>();
    atoms.forEach((a, i) => {
      for (const s of conect.get(a.serial) ?? []) {
        const j = bySerial.get(s);
        if (j === undefined) continue;
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (!seen.has(key)) {
          seen.add(key);
          bonds.push([Math.min(i, j), Math.max(i, j)]);
        }
      }
    });
    return bonds;
  }
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const dx = atoms[i].x - atoms[j].x;
      const dy = atoms[i].y - atoms[j].y;
      const dz = atoms[i].z - atoms[j].z;
      const lim = atoms[i].element === 'S' || atoms[j].element === 'S' ? 2.0 : 1.9;
      if (dx * dx + dy * dy + dz * dz < lim * lim) bonds.push([i, j]);
    }
  }
  return bonds;
}

export const VDW: Record<string, number> = { C: 1.7, N: 1.55, O: 1.52, S: 1.8, P: 1.8, H: 1.1 };
