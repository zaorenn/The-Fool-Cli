import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { PALETTES } from '@/common/theme/palettes';
import { contrastRatio, derivePalette, SURFACE_STYLES, type SurfaceStyleId } from '@/common/theme/surfaceStyle';

describe('probe', () => {
  it('dumps palettes', () => {
    const rows: unknown[] = [];
    const materials = Object.keys(SURFACE_STYLES) as SurfaceStyleId[];
    for (const palette of PALETTES) {
      for (const material of materials) {
        for (const dark of [true, false]) {
          const p = derivePalette(palette.seed, material, dark);
          rows.push({
            palette: palette.id,
            material,
            appearance: dark ? 'dark' : 'light',
            ground: p.ground,
            card: p.card,
            ink: p.ink,
            accent: p.accent,
            accentOnGround: Math.round(contrastRatio(p.accent, p.ground) * 100) / 100,
            accentOnCard: Math.round(contrastRatio(p.accent, p.card) * 100) / 100,
            inkOnCard: Math.round(contrastRatio(p.ink, p.card) * 100) / 100,
            groundVsCard: Math.round(contrastRatio(p.ground, p.card) * 100) / 100,
          });
        }
      }
    }
    writeFileSync(
      'C:/Users/sarhen/AppData/Local/Temp/claude/C--Fool-AionUI--claude-worktrees-session-analysis-ui-issues-89f6b5/1efdfc28-d867-4e58-bfd1-ba4c19cefb1c/scratchpad/palettes.json',
      JSON.stringify(rows, null, 2)
    );
  });
});
