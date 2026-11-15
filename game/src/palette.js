// palette.js — SALTLINE: a salt terminal at dawn.
// Palette: pale salt white, warm sand, deep lagoon teal, one amber dawn accent.
// Every colour in the game comes from here, so the scene reads at a glance.
export const PALETTE = {
  salt: 0xe8e2d4,      // pale salt flats — ground, open lanes
  sand: 0xc9a86a,      // warm sand — crates, low walls
  sandDark: 0x8a6f45,  // weathered timber / dark sand
  teal: 0x1f5f5b,      // lagoon teal — defender structures, site B
  tealDark: 0x143f3d,  // deep teal — containers
  amber: 0xf0a830,     // dawn amber — the single accent: site A, lights, HUD
  amberSoft: 0xd98a1f,
  rust: 0x9a4a2a,      // rusted steel — site A structures
  ink: 0x22201c,       // near-black — roofs, gunmetal
  concrete: 0x9b968a,  // concrete walls
  sky: 0xf2d9a8,       // dawn sky haze
  fog: 0xe6d3ae,
  teamAtk: 0xf0a830,   // attackers wear amber
  teamDef: 0x2e8b8b,   // defenders wear teal
};

export const CSS = {
  canvas: '#141210',
  surface: '#1e1c18',
  hairline: '#3a342a',
  ink: '#efe8d8',
  muted: '#a89e88',
  accent: '#f0a830',
  teal: '#2e8b8b',
  danger: '#e0523a',
};
