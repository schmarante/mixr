import type { BlockNode, ResolvedTrack, TrackNode, VisualAst, VisualNode } from '../types/ast';
import { isTrackNode } from '../types/ast';

/** Reine Lesefunktionen auf dem AST – ohne Store-Abhängigkeit (testbar, SSR-sicher). */

export function findNode(ast: VisualAst, id: string): VisualNode | undefined {
  return ast.nodes.find((n) => n.id === id);
}

/** Folgt den Kanten ab der Spur und liefert die Block-IDs in Reihenfolge. */
export function chainIds(ast: VisualAst, trackId: string): string[] {
  const next = new Map(ast.edges.map((e) => [e.source, e.target]));
  const ids: string[] = [];
  const seen = new Set<string>([trackId]);
  let cur = next.get(trackId);
  while (cur !== undefined && !seen.has(cur)) {
    ids.push(cur);
    seen.add(cur);
    cur = next.get(cur);
  }
  return ids;
}

export function resolveTracks(ast: VisualAst): ResolvedTrack[] {
  const byId = new Map(ast.nodes.map((n) => [n.id, n]));
  return ast.nodes.filter(isTrackNode).map((track: TrackNode) => ({
    track,
    chain: chainIds(ast, track.id)
      .map((id) => byId.get(id))
      .filter((n): n is BlockNode => n !== undefined && !isTrackNode(n)),
  }));
}

/** Zu welcher Spur gehört ein Block? */
export function trackOfBlock(ast: VisualAst, blockId: string): string | undefined {
  return ast.nodes.filter(isTrackNode).find((t) => chainIds(ast, t.id).includes(blockId))?.id;
}
