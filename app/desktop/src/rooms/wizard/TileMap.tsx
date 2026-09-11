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
                background: tileColor(t),
                boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.35)',
                outline: reach ? '2px solid rgba(56,189,248,0.7)' : undefined,
                outlineOffset: -2,
              }}
            >
              {burning.has(k) && <span className="absolute inset-0 flex items-center justify-center opacity-90">🔥</span>}
              {token && (
                <div
                  className={`relative flex items-center justify-center rounded-full font-bold text-white ${token.down ? 'opacity-50' : ''}`}
                  style={{
                    width: cell * 0.82,
                    height: cell * 0.82,
                    background: token.kind === 'pc' ? '#1d4ed8' : '#4c1d95',
                    border: isActive ? '2px solid #fbbf24' : '1px solid rgba(255,255,255,0.35)',
                    boxShadow: isActive ? '0 0 0 3px rgba(251,191,36,0.35)' : undefined,
                  }}
                >
                  <span style={{ fontSize: cell * 0.42, lineHeight: 1 }}>{token.down ? '✕' : token.label}</span>
                  {labels && (
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

function tileColor(t: string): string {
  switch (t) {
    case '~': return '#1e3a5f';
    case '.': return '#c2a15b';
    case '#': return '#3f3f46';
    case '=': return '#7c5a2f';
    case ':': return '#8a8a7a';
    default: return '#111';
  }
}
