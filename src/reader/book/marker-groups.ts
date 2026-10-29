type Marker = { id: string; x: number; y: number };

// Coordinates are display pixels. Merge connected overlaps without moving source anchors.
export function groupMarkers(markers: Marker[], size: number): Marker[][] {
  const groups: Marker[][] = [];
  for (const marker of [...markers].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const overlaps = groups.filter((group) => group.some((other) => Math.abs(marker.x - other.x) < size && Math.abs(marker.y - other.y) < size));
    if (!overlaps.length) groups.push([marker]);
    else {
      const first = overlaps[0]!;
      first.push(marker);
      for (const group of overlaps.slice(1)) {
        first.push(...group);
        groups.splice(groups.indexOf(group), 1);
      }
      first.sort((a, b) => a.y - b.y || a.x - b.x);
    }
  }
  return groups;
}
