export const TEAM_MAP_COMPACT_ZOOM = 0.7;

export const teamMapCompact = (zoom: number) => zoom < TEAM_MAP_COMPACT_ZOOM;

export function fitTeamMap(
  width: number,
  height: number,
  mapWidth: number,
  mapHeight: number,
  _nodeCount?: number,
) {
  const zoom = Math.min(1, Math.min(
    Math.max(1, width - 48) / Math.max(1, mapWidth),
    Math.max(1, height - 48) / Math.max(1, mapHeight),
  ));
  return {
    zoom,
    x: (width - mapWidth * zoom) / 2,
    y: (height - mapHeight * zoom) / 2,
  };
}

export function focusTeamMap(
  width: number,
  height: number,
  bounds: { x: number; y: number; width: number; height: number },
) {
  const zoom = Math.min(1.5, Math.min(
    Math.max(1, width - 48) / Math.max(1, bounds.width),
    Math.max(1, height - 48) / Math.max(1, bounds.height),
  ));
  return {
    zoom,
    x: (width - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: (height - bounds.height * zoom) / 2 - bounds.y * zoom,
  };
}
