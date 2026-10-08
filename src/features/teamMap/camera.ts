export function fitTeamMap(
  width: number,
  height: number,
  mapWidth: number,
  mapHeight: number,
  nodeCount: number,
) {
  const zoom = Math.min(
    1,
    Math.max(
      nodeCount <= 8 ? 0.88 : 0.2,
      Math.min((width - 48) / mapWidth, (height - 48) / mapHeight),
    ),
  );
  return {
    zoom,
    x: Math.max(16, (width - mapWidth * zoom) / 2),
    y: Math.max(16, (height - mapHeight * zoom) / 2),
  };
}
