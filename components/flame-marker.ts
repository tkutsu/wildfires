import {
  SEVERITY_SIZE,
  type FireCluster,
  type SeverityTier,
} from "@/lib/hotspot-clusters";

/**
 * Flame glyph, drawn once per cluster. Gradients live in a shared <defs>
 * sprite (see FlameDefs) so every marker reuses the same fills.
 */
const OUTER_FLAME =
  "M16 1.5C15 8.5 11.5 11.5 8.8 15.2 6.2 18.7 4.5 22.2 4.5 26c0 6.6 5.1 11.5 " +
  "11.5 11.5S27.5 32.6 27.5 26c0-3.4-1.3-6.8-3.5-9.6-.4 2.6-1.6 4.5-3.2 5.6 " +
  "1.2-5.8-.5-13.4-4.8-20.5Z";
const INNER_FLAME =
  "M16 19c-1.6 4-4.2 6.2-4.2 9.4 0 3.7 2.2 6 4.2 6s4.2-2.3 4.2-6C20.2 25.2 " +
  "17.6 23 16 19Z";

export function flameHtml(cluster: FireCluster): string {
  const size = SEVERITY_SIZE[cluster.severity];
  return `
    <svg viewBox="0 0 32 40" width="${size}" height="${size * 1.25}" aria-hidden="true">
      <path d="${OUTER_FLAME}" fill="url(#flame-hot)" />
      <path d="${INNER_FLAME}" fill="url(#flame-core)" opacity="0.95" />
    </svg>
  `;
}

export function flameIconOptions(cluster: FireCluster, animated = false) {
  const size = SEVERITY_SIZE[cluster.severity];
  const height = size * 1.25;
  return {
    className: `fire-flame fire-flame--${cluster.severity}${
      animated ? " fire-flame--entering" : ""
    }`,
    iconSize: [size, height] as [number, number],
    // Anchor at the flame's base so it "stands" on the coordinate.
    iconAnchor: [size / 2, height * 0.94] as [number, number],
    tooltipAnchor: [0, -height * 0.85] as [number, number],
  };
}

export function severityHeadline(severity: SeverityTier): string {
  return {
    spot: "Single detection",
    small: "Small fire",
    moderate: "Moderate fire",
    large: "Large fire",
    major: "Major fire",
  }[severity];
}
