import { defaultParams } from '../../blocks/catalog';
import type { BlockNode, BlockType, ParamValues, TrackNode, TrackParams, VisualAst } from '../../types/ast';

export interface TestBlock {
  type: BlockType;
  params?: ParamValues;
  bypassed?: boolean;
}

export interface TestTrack {
  track?: Partial<TrackParams>;
  blocks: TestBlock[];
}

/** Baut einen AST wie actions.ts (Kette track → b1 → b2 …), deterministische IDs t1, t1-b1 … */
export function buildTestAst(tracks: TestTrack[]): VisualAst {
  const ast: VisualAst = { nodes: [], edges: [] };
  tracks.forEach((t, i) => {
    const track: TrackNode = {
      id: `t${i + 1}`,
      type: 'track',
      params: { name: `Spur ${i + 1}`, color: 'violet', volume: 0.8, muted: false, solo: false, ...t.track },
    };
    const blocks: BlockNode[] = t.blocks.map((b, j) => ({
      id: `${track.id}-b${j + 1}`,
      type: b.type,
      params: { ...defaultParams(b.type), ...b.params },
      ...(b.bypassed ? { bypassed: true } : {}),
    }));
    ast.nodes.push(track, ...blocks);
    const ids = [track.id, ...blocks.map((b) => b.id)];
    for (let k = 0; k < ids.length - 1; k++) {
      ast.edges.push({ id: `e-${ids[k]}-${ids[k + 1]}`, source: ids[k]!, target: ids[k + 1]! });
    }
  });
  return ast;
}

export const SETTINGS = { bpm: 120 };
