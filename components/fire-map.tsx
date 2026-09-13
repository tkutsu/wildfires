"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  GeoJSON as GeoJSONLayer,
  Layer,
  LayerGroup,
  Map as LeafletMap,
  Marker,
  TileLayer,
} from "leaflet";
import { flameHtml, flameIconOptions, severityHeadline } from "@/components/flame-marker";
import type { DangerPoint } from "@/hooks/use-fire-danger";
import { clusterHotspots } from "@/lib/hotspot-clusters";
import type { BurntScar, BurntScarsPayload, Hotspot } from "@/lib/types";

const GREECE_CENTER: [number, number] = [38.4, 23.9];
export const GREECE_MAP_BOUNDS: [[number, number], [number, number]] = [
  [33.8, 18.6],
  [42.4, 29.2],
];
// Scars sit above the base tiles but below the flames.
const SCAR_PANE = "burn-scars";
// Satellite imagery goes over the base map, under everything drawn on it.
const IMAGERY_PANE = "satellite";

/**
 * NASA's daily global mosaic, free and keyless, addressed by the day it was
 * taken, which is exactly what the timeline is scrubbing. The M11-I2-I1 band
 * combination is the one to look at: shortwave infrared puts an active fire
 * front in orange and a fresh burn scar in brown, through the smoke that
 * hides both in true colour.
 *
 * WMTS numbers its tiles row before column, the other way round from Leaflet.
 */
const IMAGERY_URL =
  "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/" +
  "VIIRS_NOAA20_CorrectedReflectance_BandsM11-I2-I1/default/{day}/" +
  "GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg";
// The mosaic is 250 m; past this Leaflet upscales rather than asking for more.
const IMAGERY_MAX_NATIVE_ZOOM = 8;

const PIN_HTML = `
  <svg viewBox="0 0 24 32" width="24" height="32" aria-hidden="true">
    <path d="M12 1.5c-5 0-9 3.9-9 8.8 0 6.5 9 20.2 9 20.2s9-13.7 9-20.2c0-4.9-4-8.8-9-8.8Z"
      fill="var(--signal)" stroke="var(--paper)" stroke-width="1.6" />
    <circle cx="12" cy="10.2" r="3.1" fill="var(--paper)" />
  </svg>`;

/** A GeoJSON sub-layer carrying the day its fire started. */
type DatedLayer = Layer & {
  scarDate?: string;
  getElement?: () => Element | undefined;
};

// Kept under the 220 ms playback step so a day's flames finish leaving
// before the next day's have settled.
const FLAME_FADE_MS = 200;

interface FireMapProps {
  hotspots: readonly Hotspot[];
  /** This season's burnt-area perimeters, or null while they load. */
  scars: BurntScarsPayload | null;
  /** Scars that had not started by this UTC day stay hidden. */
  scarDay: string;
  /** Playback is running, so days should transition rather than cut. */
  animated: boolean;
  /** Where the fire-danger pin sits, or null when there is none. */
  pin: DangerPoint | null;
  /** Called when the map is clicked somewhere that is not a burn scar. */
  onPickPoint: (point: DangerPoint) => void;
  /** Show NASA's satellite mosaic for the day on show. */
  imagery: boolean;
  /** Reports whether the mosaic has a pass for that day yet. */
  onImageryLoaded: (available: boolean) => void;
}

function formatArea(hectares: number): string {
  // EFFIS rounds sub-hectare fires down to 0, which reads as "nothing burnt".
  if (hectares < 1) return "Under 1 hectare";
  const rounded = Math.round(hectares);
  return `${rounded.toLocaleString("en-GB")} hectare${rounded === 1 ? "" : "s"}`;
}

function scarPopupHtml(scar: BurntScar): string {
  const { areaHa, commune, firedate, landCover, naturaPct, province } =
    scar.properties;
  const started = new Date(firedate);
  const dateLabel = Number.isNaN(started.getTime())
    ? firedate
    : started.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
  const place = [commune, province].filter(Boolean).join(", ");
  const cover = landCover
    .slice(0, 4)
    .map(
      (slice) =>
        `<li><span>${slice.label}</span><span>${Math.round(slice.percent)}%</span></li>`,
    )
    .join("");

  return `
    <div class="scar-popup">
      <p class="scar-popup__area">${formatArea(areaHa)} burnt</p>
      ${place ? `<p class="scar-popup__place">${place}</p>` : ""}
      <p class="scar-popup__date">Started ${dateLabel}</p>
      ${cover ? `<ul class="scar-popup__cover">${cover}</ul>` : ""}
      ${
        naturaPct >= 1
          ? `<p class="scar-popup__natura">${Math.round(naturaPct)}% inside a Natura 2000 protected site</p>`
          : ""
      }
    </div>
  `;
}

/** Shared gradient definitions for every flame marker on the map. */
function FlameDefs() {
  return (
    <svg aria-hidden="true" className="absolute size-0 overflow-hidden">
      <defs>
        <linearGradient id="flame-hot" x1="0.5" x2="0.5" y1="0" y2="1">
          <stop offset="0%" stopColor="#ffc53d" />
          <stop offset="45%" stopColor="#f5761a" />
          <stop offset="100%" stopColor="#c01c07" />
        </linearGradient>
        <linearGradient id="flame-core" x1="0.5" x2="0.5" y1="0" y2="1">
          <stop offset="0%" stopColor="#fff6c8" />
          <stop offset="100%" stopColor="#ffb020" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Renders the Leaflet map with burn scars and flame markers. */
export function FireMap({
  hotspots,
  scars,
  scarDay,
  animated,
  pin,
  onPickPoint,
  imagery,
  onImageryLoaded,
}: FireMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<LayerGroup | null>(null);
  const retiringRef = useRef<{
    group: LayerGroup;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  // Read inside the effects below, so toggling playback does not itself
  // rebuild the markers. Declared first so it is current when they run.
  const animatedRef = useRef(animated);
  const scarLayerRef = useRef<GeoJSONLayer | null>(null);
  const pinRef = useRef<Marker | null>(null);
  const imageryRef = useRef<TileLayer | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  // The map is built once, so the click handler reads the callback from here.
  const onPickPointRef = useRef(onPickPoint);
  const onImageryLoadedRef = useRef(onImageryLoaded);
  const [mapReady, setMapReady] = useState(false);

  const clusters = useMemo(() => clusterHotspots(hotspots), [hotspots]);

  useEffect(() => {
    animatedRef.current = animated;
  }, [animated]);

  useEffect(() => {
    onPickPointRef.current = onPickPoint;
  }, [onPickPoint]);

  useEffect(() => {
    onImageryLoadedRef.current = onImageryLoaded;
  }, [onImageryLoaded]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let cancelled = false;

    const initialize = async () => {
      const L = await import("leaflet");
      if (cancelled || !containerRef.current) return;

      leafletRef.current = L;
      const map = L.map(containerRef.current, {
        center: GREECE_CENTER,
        zoom: 7,
        minZoom: 6,
        maxZoom: 15,
        maxBounds: GREECE_MAP_BOUNDS,
        maxBoundsViscosity: 1,
        zoomControl: true,
      });

      map.attributionControl.setPrefix(false);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' +
          ' &middot; Data &copy; <a href="https://effis.emergency.copernicus.eu">Copernicus EFFIS</a>',
        className: "fire-map-tiles",
        maxZoom: 19,
      }).addTo(map);

      map.createPane(IMAGERY_PANE).style.zIndex = "250";
      map.createPane(SCAR_PANE).style.zIndex = "400";

      // Leaflet does not fire this for clicks that land on a scar or a flame,
      // so the pin never fights with a popup.
      map.on("click", (event) => {
        onPickPointRef.current({
          latitude: event.latlng.lat,
          longitude: event.latlng.lng,
        });
      });

      mapRef.current = map;
      setMapReady(true);

      const resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          if (!cancelled) map.invalidateSize({ animate: false, pan: false });
        });
      });
      resizeObserver.observe(containerRef.current);
      return () => resizeObserver.disconnect();
    };

    let disconnectResizeObserver: (() => void) | undefined;
    void initialize().then((disconnect) => {
      if (cancelled) {
        disconnect?.();
        return;
      }
      disconnectResizeObserver = disconnect;
    });

    return () => {
      cancelled = true;
      disconnectResizeObserver?.();
      mapRef.current?.remove();
      mapRef.current = null;
      markersRef.current = null;
      if (retiringRef.current) {
        clearTimeout(retiringRef.current.timer);
        retiringRef.current = null;
      }
      scarLayerRef.current = null;
      pinRef.current = null;
      imageryRef.current = null;
      setMapReady(false);
    };
    // The map instance is deliberately created only once.
  }, []);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || !mapReady) return;

    // Retire the previous day's flames: fade them out during playback, drop
    // them outright when the timeline is being scrubbed by hand.
    const previous = markersRef.current;
    if (retiringRef.current) {
      clearTimeout(retiringRef.current.timer);
      retiringRef.current.group.remove();
      retiringRef.current = null;
    }
    if (previous) {
      if (animatedRef.current) {
        previous.eachLayer((layer) => {
          (layer as DatedLayer)
            .getElement?.()
            ?.classList.add("fire-flame--leaving");
        });
        const timer = setTimeout(() => {
          previous.remove();
          retiringRef.current = null;
        }, FLAME_FADE_MS);
        retiringRef.current = { group: previous, timer };
      } else {
        previous.remove();
      }
    }

    const markers = L.layerGroup().addTo(map);
    markersRef.current = markers;

    for (const cluster of clusters) {
      const marker = L.marker([cluster.latitude, cluster.longitude], {
        icon: L.divIcon({
          ...flameIconOptions(cluster, animatedRef.current),
          html: flameHtml(cluster),
        }),
        riseOnHover: true,
        // Bigger fires stack above smaller ones.
        zIndexOffset: Math.min(cluster.detections, 500),
      });

      const seenAt = new Date(cluster.latestAt).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Athens",
      });
      const spread =
        cluster.spanKm >= 1
          ? ` &middot; ${cluster.spanKm.toFixed(cluster.spanKm >= 10 ? 0 : 1)} km across`
          : "";
      // Radiative power is how hard it is burning, not how much has burnt.
      const power =
        cluster.frpMw >= 1
          ? ` &middot; ${Math.round(cluster.frpMw).toLocaleString("en-GB")} MW`
          : "";
      marker
        .bindTooltip(
          `<strong>${severityHeadline(cluster.severity)}</strong><br />` +
            `${cluster.detections} detection${cluster.detections === 1 ? "" : "s"}${spread}${power}<br />` +
            `<span class="opacity-70">last seen ${seenAt}</span>`,
          { direction: "top", className: "fire-tooltip" },
        )
        .addTo(markers);
    }
  }, [clusters, mapReady]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || !mapReady) return;

    scarLayerRef.current?.remove();
    scarLayerRef.current = null;
    if (!scars) return;

    const layer = L.geoJSON(scars, {
      pane: SCAR_PANE,
      // Colours live in CSS so the scars follow the theme.
      // A thin outline disappears at country zoom, where a big fire is ~25 px.
      style: { className: "burn-scar", weight: 1.5 },
      onEachFeature: (feature, target) => {
        const scar = feature as BurntScar;
        (target as DatedLayer).scarDate = scar.properties.firedate.slice(0, 10);
        target.bindPopup(scarPopupHtml(scar), {
          className: "scar-popup-shell",
          closeButton: false,
        });
      },
    });
    layer.addTo(map);
    scarLayerRef.current = layer;
  }, [scars, mapReady]);

  /**
   * Scars accumulate as the timeline advances. Only a class is toggled: the
   * geometry is built once, so scrubbing never re-parses 130 polygons.
   */
  useEffect(() => {
    scarLayerRef.current?.eachLayer((layer) => {
      const dated = layer as DatedLayer;
      const element = dated.getElement?.();
      if (!element) return;
      const unburnt = (dated.scarDate ?? "") > scarDay;
      const wasUnburnt = element.classList.contains("burn-scar--unburnt");
      element.classList.toggle("burn-scar--unburnt", unburnt);
      // Wipe the scar on left to right the day its fire starts. Hidden scars
      // carry no animation, so re-showing one always starts it afresh.
      element.classList.toggle(
        "burn-scar--igniting",
        !unburnt && wasUnburnt && animatedRef.current,
      );
    });
  }, [scars, scarDay, mapReady]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || !mapReady) return;

    imageryRef.current?.remove();
    imageryRef.current = null;
    if (!imagery) return;

    // NASA publishes a day's mosaic a few hours after the satellite passes,
    // so today's is usually missing until the afternoon. Count what arrives
    // and say so, rather than leaving the map mysteriously bare.
    let loaded = 0;
    const layer = L.tileLayer(IMAGERY_URL.replace("{day}", scarDay), {
      attribution:
        'Imagery <a href="https://worldview.earthdata.nasa.gov">NASA EOSDIS GIBS</a>',
      bounds: GREECE_MAP_BOUNDS,
      className: "fire-map-imagery",
      maxNativeZoom: IMAGERY_MAX_NATIVE_ZOOM,
      pane: IMAGERY_PANE,
    })
      .on("tileload", () => {
        loaded += 1;
      })
      .on("load", () => onImageryLoadedRef.current(loaded > 0))
      .addTo(map);
    imageryRef.current = layer;

    return () => {
      layer.remove();
    };
  }, [imagery, scarDay, mapReady]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || !mapReady) return;

    if (!pin) {
      pinRef.current?.remove();
      pinRef.current = null;
      return;
    }

    const position: [number, number] = [pin.latitude, pin.longitude];
    if (pinRef.current) {
      pinRef.current.setLatLng(position);
      return;
    }
    pinRef.current = L.marker(position, {
      icon: L.divIcon({
        className: "fire-pin",
        html: PIN_HTML,
        iconSize: [24, 32],
        iconAnchor: [12, 31],
      }),
      keyboard: false,
      zIndexOffset: 600,
    }).addTo(map);
  }, [pin, mapReady]);

  return (
    <div className="relative z-0 min-h-0 w-full flex-1">
      <FlameDefs />
      <div
        aria-label="Map of fire detections in Greece"
        className="size-full"
        ref={containerRef}
      />
    </div>
  );
}
