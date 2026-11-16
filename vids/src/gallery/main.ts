/**
 * Gallery page: one card per visual with a lazily-loaded live preview
 * (iframe at ?quality=low&hud=0, only mounted while the card is on screen).
 */
import { applyTokens } from '../shared/tokens';
import './gallery.css';

applyTokens();

interface Card {
  page: string;
  code: string;
  title: string;
  field: string;
  desc: string;
  accent: string;
}

const cards: Card[] = [
  { page: 'dna.html', code: 'VIZ-01', title: 'DNA Sequencing', field: 'GENOMICS', accent: 'cyan',
    desc: 'B-DNA double helix (10.5 bp/turn, true major/minor grooves). A read head scans base pairs into a live ACGT ticker and flags SNVs in a BRCA1-like locus.' },
  { page: 'protein.html', code: 'VIZ-02', title: 'Protein–Ligand Docking', field: 'DRUG DISCOVERY', accent: 'magenta',
    desc: 'HIV-1 protease (PDB 1HSG) as a cartoon. Indinavir samples docking poses, snaps into the catalytic site, and forms H-bonds as ΔG drops.' },
  { page: 'mri.html', code: 'VIZ-03', title: 'MRI · Healthy vs Glioma', field: 'NEURO-IMAGING', accent: 'amber',
    desc: 'Two synced volumetric brains with a sweeping slice plane and T1/T2 slices. The lesion side shows a segmented glioma with necrotic core and edema.' },
  { page: 'xray.html', code: 'VIZ-04', title: 'Chest X-ray Retrieval', field: 'RADIOLOGY AI', accent: 'cyan',
    desc: 'Scan, Grad-CAM attention, then similar-case retrieval from embedding space, with similarity scores counting up.' },
];

const grid = document.getElementById('grid')!;
const live = document.getElementById('live') as HTMLInputElement;

for (const c of cards) {
  const el = document.createElement('article');
  el.className = `g-card accent-${c.accent}`;
  el.innerHTML = `
    <a class="g-preview" href="${c.page}" aria-label="Open ${c.title}">
      <div class="g-ph"><span>${c.code}</span></div>
    </a>
    <div class="g-meta">
      <p class="g-code">${c.code} · ${c.field}</p>
      <h3><a href="${c.page}">${c.title}</a></h3>
      <p class="g-desc">${c.desc}</p>
      <nav class="g-links">
        <a href="${c.page}">open</a>
        <a href="${c.page}?hud=0">clean</a>
        <a href="${c.page}?bg=transparent">transparent</a>
        <a href="${c.page}?quality=low">low gpu</a>
      </nav>
    </div>`;
  grid.appendChild(el);
}

// Mount a live iframe only while a card is visible (saves GPU on small machines).
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      const preview = e.target as HTMLAnchorElement;
      const existing = preview.querySelector('iframe');
      if (e.isIntersecting && live.checked && !existing) {
        const f = document.createElement('iframe');
        f.src = `${preview.getAttribute('href')}?quality=low&hud=0`;
        f.title = 'live preview';
        f.tabIndex = -1;
        f.loading = 'lazy';
        preview.appendChild(f);
      } else if ((!e.isIntersecting || !live.checked) && existing) {
        existing.remove();
      }
    }
  },
  { threshold: 0.15 },
);
const previews = Array.from(document.querySelectorAll<HTMLAnchorElement>('.g-preview'));
previews.forEach((p) => io.observe(p));
live.addEventListener('change', () => {
  previews.forEach((p) => {
    io.unobserve(p);
    if (!live.checked) p.querySelector('iframe')?.remove();
    io.observe(p);
  });
});
