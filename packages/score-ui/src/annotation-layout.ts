/**
 * Where annotation text goes (RENDER_PLAYBACK_PORTS.md §2.7). Pure: from the
 * displayed score's annotations and the neutral LayoutMap of the same
 * rendering to label placements.
 *
 * Policy:
 * - an annotation's label goes in the reserved band of the first (top-most)
 *   system that holds one of its notes; it is never drawn inside staves or
 *   system bounds;
 * - labels sharing a band are stacked in annotation order, bottom-aligned on
 *   the band so the text sits right above the staff;
 * - the stack starts at the band's left edge and may use the surface's width
 *   (the same margin on the right as on the left), never less than the band:
 *   the band's height is reserved across the whole surface, so text past the
 *   end of a short, unjustified system covers nothing and wraps less;
 * - each label starts at the leftmost of its notes in that system, but never
 *   further right than half the stack, so it always keeps at least half the
 *   stack width to wrap in;
 * - an annotation none of whose notes is laid out (hidden player) gets no label.
 */
import type { Annotation } from '@sheet-music/music-domain';
import type { Bounds, LayoutMap, NoteLayout } from '@sheet-music/renderer-core';

export interface AnnotationLabel {
  readonly annotationId: string;
  readonly text: string;
  readonly color: string;
  /** CSS px from the stack's left edge to where the text starts. */
  readonly indent: number;
}

export interface AnnotationBandPlacement {
  readonly systemId: string;
  /** The system's annotation band, in LayoutMap coordinates. */
  readonly band: Bounds;
  /** Width of the label stack, which starts at `band.x` (at least `band.width`). */
  readonly width: number;
  /** In annotation order, top to bottom. */
  readonly labels: readonly AnnotationLabel[];
}

export function placeAnnotations(
  annotations: readonly Annotation[],
  layout: LayoutMap,
): AnnotationBandPlacement[] {
  const stackWidth = (band: Bounds): number => Math.max(band.width, layout.width - 2 * band.x);
  const labelsBySystem = new Map<string, AnnotationLabel[]>();
  for (const annotation of annotations) {
    const notes = annotation.noteIds.flatMap((id): NoteLayout[] => {
      const note = layout.notes.get(id);
      return note === undefined ? [] : [note];
    });
    const system = layout.systems.find((candidate) =>
      notes.some((note) => note.systemId === candidate.systemId),
    );
    if (system === undefined) {
      continue;
    }
    const band = system.annotationBand;
    const left = Math.min(
      ...notes.filter((note) => note.systemId === system.systemId).map((note) => note.bounds.x),
    );
    const labels = labelsBySystem.get(system.systemId) ?? [];
    labels.push({
      annotationId: annotation.id,
      text: annotation.text,
      color: annotation.color,
      indent: Math.min(Math.max(left - band.x, 0), stackWidth(band) / 2),
    });
    labelsBySystem.set(system.systemId, labels);
  }
  return layout.systems.flatMap((system) => {
    const labels = labelsBySystem.get(system.systemId);
    const band = system.annotationBand;
    return labels === undefined
      ? []
      : [{ systemId: system.systemId, band, width: stackWidth(band), labels }];
  });
}
