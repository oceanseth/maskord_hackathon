import type { CharacterState, CreatureState, Fire, Position, TileMap as TileMapData } from '../../../../../www/convex/wizard/types';
import { PREGENS } from '../../../../../www/convex/wizard/pregens';

/**
 * The board. One square is 5 ft. Renders as a CSS grid so it scales from the
 * thumbnail in the room panel to the full second screen without a canvas.
 */
export function TileMap({
  map,
  characters,
  creatures,
  fires = [],
  activeId,
  highlight,
  onSquare,
  cell = 28,
  labels = true,
  theme,
}: {
  map: TileMapData;
  characters: CharacterState[];
  creatures: CreatureState[];
  fires?: Fire[];
  activeId?: string | null;
  /** Squares to mark as reachable, "x,y" keys. */
  highlight?: Set<string>;
  onSquare?: (p: Position) => void;
  cell?: number;
  labels?: boolean;
  /** 'kf' desaturates the ground to torchlit stone and lets the active token glow. */
  theme?: 'kf';
}) {
  const tokens = new Map<string, { kind: 'pc' | 'npc'; label: string; title: string; hp: number; hpMax: number; id: string; down: boolean }>();
  for (const c of characters) {
    const sheet = PREGENS[c.sheetKey];
    tokens.set(`${c.pos.x},${c.pos.y}`, {
      kind: 'pc',
      label: sheet.glyph,
      title: `${c.name} — ${sheet.className} ${c.hp}/${sheet.hpMax} HP`,
      hp: c.hp,
      hpMax: sheet.hpMax,
      id: `pc:${c.sheetKey}`,
      down: c.hp <= 0,
    });
  }
  for (const z of creatures) {
    if (z.conditions.includes('dead')) continue;
    tokens.set(`${z.pos.x},${z.pos.y}`, { kind: 'npc', label: 'Z', title: `${z.name} ${z.hp}/${z.hpMax} HP`, hp: z.hp, hpMax: z.hpMax, id: `npc:${z.key}`, down: false });
  }
  const burning = new Set(fires.map((f) => `${f.pos.x},${f.pos.y}`));

  return (
    <div
      className="inline-grid select-none"
      style={{ gridTemplateColumns: `repeat(${map.width}, ${cell}px)`, gridAutoRows: `${cell}px`, fontSize: Math.max(9, cell * 0.5) }}
    >
      {map.rows.flatMap((row, y) =>
        row.split('').map((t, x) => {
          const k = `${x},${y}`;
          const token = tokens.get(k);
          const reach = highlight?.has(k);
          const isActive = token && token.id === activeId;
          return (
            <div
              key={k}
              title={token?.title ?? map.legend[t]?.name}
              onClick={onSquare ? () => onSquare({ x, y }) : undefined}
              className={`relative flex items-center justify-center ${onSquare && reach ? 'cursor-pointer' : ''}`}
              style={{
                background: tileColor(t, theme),
                boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.35)',
                outline: reach ? '2px solid rgba(56,189,248,0.7)' : undefined,
                outlineOffset: -2,
              }}
            >
              {burning.has(k) && <span className="absolute inset-0 flex items-center justify-center opacity-90">🔥</span>}
              {token && theme && labels && (
                <div className="absolute left-1 right-1" style={{ bottom: 1, height: 2, background: 'rgba(0,0,0,0.6)' }}>
                  <div style={{ width: `${Math.max(0, Math.min(100, (token.hp / token.hpMax) * 100))}%`, height: '100%', background: token.hp / token.hpMax > 0.5 ? '#6b7a5e' : token.hp / token.hpMax > 0.25 ? '#c9a35a' : '#7a2f2a' }} />
                </div>
              )}
              {token && (
                <div
                  className={`relative flex items-center justify-center font-bold text-white ${theme ? '' : 'rounded-full'} ${token.down ? 'opacity-50' : ''} ${isActive && theme ? 'kf-token-active' : ''}`}
                  style={{
                    width: cell * 0.82,
                    height: cell * 0.82,
                    background: theme ? (token.kind === 'pc' ? '#2f3d3a' : '#4a2a2a') : token.kind === 'pc' ? '#1d4ed8' : '#4c1d95',
                    border: theme ? (isActive ? '1px solid #c9a35a' : '1px solid #8a6a3a') : isActive ? '2px solid #fbbf24' : '1px solid rgba(255,255,255,0.35)',
                    boxShadow: theme ? (isActive ? undefined : 'inset 1px 1px 0 rgba(255,255,255,0.15), inset -1px -1px 0 rgba(0,0,0,0.6)') : isActive ? '0 0 0 3px rgba(251,191,36,0.35)' : undefined,
                    transform: theme ? 'rotate(45deg) scale(0.8)' : undefined,
                  }}
                >
                  <span style={{ fontSize: cell * 0.42, lineHeight: 1, transform: theme ? 'rotate(-45deg) scale(1.2)' : undefined }}>{token.down ? '✕' : token.label}</span>
                  {labels && !theme && (
                    <div className="absolute left-0 right-0" style={{ bottom: -3, height: 3, background: 'rgba(0,0,0,0.5)' }}>
                      <div style={{ width: `${Math.max(0, Math.min(100, (token.hp / token.hpMax) * 100))}%`, height: '100%', background: token.hp / token.hpMax > 0.5 ? '#22c55e' : token.hp / token.hpMax > 0.25 ? '#f59e0b' : '#ef4444' }} />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        }),
      )}
    </div>
  );
}

function tileColor(t: string, theme?: 'kf'): string {
  if (theme === 'kf') {
    switch (t) {
      case '~': return '#141c24';
      case '.': return '#4d4331';
      case '#': return '#221f1c';
      case '=': return '#3a2c1c';
      case ':': return '#3c3a33';
      default: return '#0b0a0c';
    }
  }
  switch (t) {
    case '~': return '#1e3a5f';
    case '.': return '#c2a15b';
    case '#': return '#3f3f46';
    case '=': return '#7c5a2f';
    case ':': return '#8a8a7a';
    default: return '#111';
  }
}
