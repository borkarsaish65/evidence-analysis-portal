import { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';

const MAP_MATCH_THRESHOLD = 0.35;
const MAP_WIDTH = 800;
const MAP_HEIGHT = 600;
const MAP_PADDING = 20;

const SCORE_COLORS = {
  high: '#42e695',
  medium: '#feca57',
  low: '#ff6b6b',
  none: '#cbd5e1',
};

const DISTRICT_PROPERTY_KEYS = [
  'DISTRICT',
  'ST_NM',
  'district_name',
  'district',
  'District',
  'dtname',
  'DT_NAME',
  'NAME_2',
  'name',
  'NAME',
];

const DISTRICT_ALIASES = {
  bihar: {
    'west champaran': ['pashchim champaran', 'w champaran'],
    'east champaran': ['purba champaran', 'e champaran'],
    kaimur: ['kaimur bhabua'],
  },
  haryana: {
    gurugram: ['gurgaon'],
    'charkhi dadri': ['dadri'],
  },
};

const STATE_SLUG_ALIASES = {
  'andaman-and-nicobar-island': 'andaman-and-nicobar-islands',
  'andaman-nicobar-island': 'andaman-and-nicobar-islands',
  'andaman-nicobar-islands': 'andaman-and-nicobar-islands',
  'arunanchal-pradesh': 'arunachal-pradesh',
  'dadra-nagar-haveli-and-daman-diu': 'dadra-and-nagar-haveli-and-daman-and-diu',
  'dadra-and-nagar-haveli-daman-and-diu': 'dadra-and-nagar-haveli-and-daman-and-diu',
  delhi: 'delhi',
  'nct-of-delhi': 'delhi',
  orissa: 'odisha',
  pondicherry: 'puducherry',
  uttaranchal: 'uttarakhand',
  'jammu-kashmir': 'jammu-and-kashmir',
  'jammu-and-kashmir': 'jammu-and-kashmir',
};

const cloneNode = (node) => ({
  total: node?.total || 0,
  Relevant: node?.Relevant || 0,
  'Partially Relevant': node?.['Partially Relevant'] || 0,
  Irrelevant: node?.Irrelevant || 0,
});

const normalizeMapName = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/\bdistrict\b/g, '')
  .replace(/[^a-zA-Z0-9]+/g, ' ')
  .trim();

const slugifyState = (stateName) => {
  const slug = normalizeMapName(stateName).replace(/\s+/g, '-');
  return STATE_SLUG_ALIASES[slug] || slug;
};

const getScore = (stats) => {
  if (!stats?.total) return 0;
  return ((stats.Relevant + stats['Partially Relevant'] * 0.5) / stats.total) * 100;
};

const getScoreColor = (score, hasData = true) => {
  if (!hasData) return SCORE_COLORS.none;
  if (score >= 60) return SCORE_COLORS.high;
  if (score >= 40) return SCORE_COLORS.medium;
  return SCORE_COLORS.low;
};

const formatScore = (stats) => getScore(stats).toFixed(1);

const getTooltipLines = (name, stats) => {
  if (!stats?.total) {
    return [name, 'No data'];
  }

  return [
    name,
    `${formatScore(stats)}% Relevant`,
    `Total: ${stats.total}`,
    `Relevant: ${stats.Relevant}`,
    `Partially: ${stats['Partially Relevant']}`,
    `Irrelevant: ${stats.Irrelevant}`,
  ];
};

const getGeoDistrictName = (feature) => {
  const properties = feature?.properties || {};
  const key = DISTRICT_PROPERTY_KEYS.find((candidate) => properties[candidate]);
  return key ? String(properties[key]) : 'Unknown';
};

const buildDistrictLookup = (districtStats, stateSlug) => {
  const lookup = new Map();

  Object.entries(districtStats || {}).forEach(([districtName, stats]) => {
    const normalized = normalizeMapName(districtName);
    lookup.set(normalized, { name: districtName, stats });

    const aliases = DISTRICT_ALIASES[stateSlug]?.[normalized] || [];
    aliases.forEach((alias) => {
      lookup.set(normalizeMapName(alias), { name: districtName, stats });
    });
  });

  return lookup;
};

const collectAllCoords = (feature) => {
  const coords = [];
  const geometry = feature?.geometry;
  if (!geometry) return coords;

  if (geometry.type === 'Polygon') {
    geometry.coordinates.forEach((ring) => ring.forEach((point) => coords.push(point)));
  }

  if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach((polygon) => {
      polygon.forEach((ring) => ring.forEach((point) => coords.push(point)));
    });
  }

  return coords;
};

const buildPathData = (feature, projectPoint) => {
  const geometry = feature?.geometry;
  if (!geometry) return '';

  const buildFromRings = (rings) => rings.map((ring) => ring.map((coord, index) => {
    const [x, y] = projectPoint(coord);
    return index === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
  }).join(' ') + ' Z').join(' ');

  if (geometry.type === 'Polygon') {
    return buildFromRings(geometry.coordinates);
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.map((polygon) => buildFromRings(polygon)).join(' ');
  }

  return '';
};

const buildGeoPaths = (geoJson, districtStats, stateSlug) => {
  const features = Array.isArray(geoJson?.features) ? geoJson.features : [];
  const points = features.flatMap(collectAllCoords);
  if (!features.length || !points.length) {
    return { paths: [], matchedDistrictCount: 0 };
  }

  const bounds = points.reduce((acc, point) => {
    const [x, y] = point;
    return {
      minX: Math.min(acc.minX, x),
      minY: Math.min(acc.minY, y),
      maxX: Math.max(acc.maxX, x),
      maxY: Math.max(acc.maxY, y),
    };
  }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

  if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)) {
    return { paths: [], matchedDistrictCount: 0 };
  }

  const scale = Math.min(
    (MAP_WIDTH - 2 * MAP_PADDING) / (bounds.maxX - bounds.minX || 1),
    (MAP_HEIGHT - 2 * MAP_PADDING) / (bounds.maxY - bounds.minY || 1)
  );

  const projectPoint = ([x, y]) => [
    (x - bounds.minX) * scale + MAP_PADDING,
    MAP_HEIGHT - ((y - bounds.minY) * scale + MAP_PADDING),
  ];

  const lookup = buildDistrictLookup(districtStats, stateSlug);
  const matchedDistricts = new Set();

  const paths = features.map((feature, index) => {
    const geoDistrictName = getGeoDistrictName(feature);
    const matched = lookup.get(normalizeMapName(geoDistrictName));
    const stats = matched?.stats;
    const districtName = matched?.name || geoDistrictName;
    if (matched?.name) {
      matchedDistricts.add(matched.name);
    }

    return {
      id: `${geoDistrictName}-${index}`,
      districtName,
      pathData: buildPathData(feature, projectPoint),
      stats,
      tooltipLines: getTooltipLines(districtName, stats),
    };
  }).filter((path) => path.pathData);

  return { paths, matchedDistrictCount: matchedDistricts.size };
};

const useStateGeoJson = (stateName) => {
  const [geoJson, setGeoJson] = useState(null);
  const [status, setStatus] = useState('idle');
  const stateSlug = slugifyState(stateName);

  useEffect(() => {
    if (!stateSlug) {
      setGeoJson(null);
      setStatus('missing');
      return undefined;
    }

    const controller = new AbortController();
    setStatus('loading');
    setGeoJson(null);

    const indexUrl = `${import.meta.env.BASE_URL}maps/states/index.json`;
    const localUrl = `${import.meta.env.BASE_URL}maps/states/${stateSlug}.geojson`;

    const loadLocalAsset = async () => {
      try {
        const indexResponse = await fetch(indexUrl, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        if (!indexResponse.ok) {
          throw new Error(`Map index unavailable (${indexResponse.status})`);
        }

        const mapIndex = await indexResponse.json();
        const hasStateAsset = Array.isArray(mapIndex?.states)
          && mapIndex.states.some((state) => state.slug === stateSlug);

        if (!hasStateAsset) {
          throw new Error(`Map asset not listed for ${stateSlug}`);
        }

        const geoJsonResponse = await fetch(localUrl, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        if (!geoJsonResponse.ok) {
          throw new Error(`Local map asset unavailable (${geoJsonResponse.status})`);
        }

        const nextGeoJson = await geoJsonResponse.json();
        setGeoJson(nextGeoJson);
        setStatus('ready');
      } catch (error) {
        if (error.name !== 'AbortError') {
          setStatus('missing');
          setGeoJson(null);
        }
      }
    };

    loadLocalAsset();

    return () => controller.abort();
  }, [stateSlug]);

  return { geoJson, status, stateSlug };
};

const useMapTooltip = () => {
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, lines: [] });

  return {
    tooltip,
    showTooltip: (event, lines) => {
      setTooltip({
        visible: true,
        x: event.clientX + 12,
        y: event.clientY + 12,
        lines,
      });
    },
    moveTooltip: (event) => {
      setTooltip((previous) => ({
        ...previous,
        x: event.clientX + 12,
        y: event.clientY + 12,
      }));
    },
    hideTooltip: () => setTooltip((previous) => ({ ...previous, visible: false })),
  };
};

const Legend = () => (
  <div className="report-map-legend" aria-label="Map relevance legend">
    <span><i style={{ backgroundColor: SCORE_COLORS.high }} />≥60% Relevant</span>
    <span><i style={{ backgroundColor: SCORE_COLORS.medium }} />40-60% Relevant</span>
    <span><i style={{ backgroundColor: SCORE_COLORS.low }} />&lt;40% Relevant</span>
    <span><i style={{ backgroundColor: '#e0e0e0' }} />No Data</span>
  </div>
);

const Tooltip = ({ tooltip }) => (
  <div
    className={`report-map-tooltip ${tooltip.visible ? 'is-visible' : ''}`}
    style={{ left: tooltip.x, top: tooltip.y }}
  >
    {tooltip.lines.map((line, index) => (
      <div key={`${line}-${index}`}>{line}</div>
    ))}
  </div>
);

Tooltip.propTypes = {
  tooltip: PropTypes.shape({
    visible: PropTypes.bool.isRequired,
    x: PropTypes.number.isRequired,
    y: PropTypes.number.isRequired,
    lines: PropTypes.arrayOf(PropTypes.string).isRequired,
  }).isRequired,
};

const SchematicMap = ({ title, statsByName, tooltipHandlers }) => {
  const entries = Object.entries(statsByName || {})
    .map(([name, stats]) => ({ name, stats: cloneNode(stats), score: getScore(stats) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  if (!entries.length) {
    return (
      <div className="report-map-empty">
        No geographic data available for the selected report filters.
      </div>
    );
  }

  const columns = Math.ceil(Math.sqrt(entries.length * 1.6));
  const cellWidth = 110;
  const cellHeight = 64;
  const gap = 8;
  const rows = Math.ceil(entries.length / columns);
  const width = columns * (cellWidth + gap) + gap;
  const height = rows * (cellHeight + gap) + gap + 24;

  return (
    <svg
      className="report-map-svg"
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      {entries.map(({ name, stats, score }, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const x = gap + col * (cellWidth + gap);
        const y = gap + row * (cellHeight + gap);
        const label = name.length > 14 ? `${name.slice(0, 13)}...` : name;
        const tooltipLines = getTooltipLines(name, stats);

        return (
          <g
            key={name}
            className="report-map-region"
            onMouseEnter={(event) => tooltipHandlers.showTooltip(event, tooltipLines)}
            onMouseMove={tooltipHandlers.moveTooltip}
            onMouseLeave={tooltipHandlers.hideTooltip}
          >
            <rect
              x={x}
              y={y}
              width={cellWidth}
              height={cellHeight}
              rx="6"
              fill={getScoreColor(score)}
              stroke="#ffffff"
              strokeWidth="2"
            />
            <text x={x + cellWidth / 2} y={y + 24} fill="#ffffff" fontSize="10" fontWeight="600" textAnchor="middle">
              {label}
            </text>
            <text x={x + cellWidth / 2} y={y + 45} fill="#ffffff" fontSize="14" fontWeight="700" textAnchor="middle">
              {score.toFixed(1)}%
            </text>
            <title>{tooltipLines.join('\n')}</title>
          </g>
        );
      })}
    </svg>
  );
};

SchematicMap.propTypes = {
  title: PropTypes.string.isRequired,
  statsByName: PropTypes.objectOf(PropTypes.shape({
    total: PropTypes.number,
    Relevant: PropTypes.number,
    'Partially Relevant': PropTypes.number,
    Irrelevant: PropTypes.number,
  })).isRequired,
  tooltipHandlers: PropTypes.shape({
    showTooltip: PropTypes.func.isRequired,
    moveTooltip: PropTypes.func.isRequired,
    hideTooltip: PropTypes.func.isRequired,
  }).isRequired,
};

const GeoMap = ({ title, geoJson, districtStats, stateSlug, tooltipHandlers }) => {
  const { paths, matchedDistrictCount } = useMemo(
    () => buildGeoPaths(geoJson, districtStats, stateSlug),
    [districtStats, geoJson, stateSlug]
  );

  const districtCount = Object.keys(districtStats || {}).length;
  const matchRate = districtCount ? matchedDistrictCount / districtCount : 0;

  if (!paths.length || matchRate < MAP_MATCH_THRESHOLD) {
    return (
      <SchematicMap
        title={title}
        statsByName={districtStats}
        tooltipHandlers={tooltipHandlers}
      />
    );
  }

  return (
    <svg
      className="report-map-svg"
      viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
      width="100%"
      height={MAP_HEIGHT}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      {paths.map(({ id, districtName, pathData, stats, tooltipLines }) => {
        const hasData = Boolean(stats?.total);
        const score = getScore(stats);
        return (
          <path
            key={id}
            className="report-map-region"
            d={pathData}
            fill={getScoreColor(score, hasData)}
            stroke="#ffffff"
            strokeWidth="1"
            data-district={districtName}
            onMouseEnter={(event) => tooltipHandlers.showTooltip(event, tooltipLines)}
            onMouseMove={tooltipHandlers.moveTooltip}
            onMouseLeave={tooltipHandlers.hideTooltip}
          >
            <title>{tooltipLines.join('\n')}</title>
          </path>
        );
      })}
    </svg>
  );
};

GeoMap.propTypes = {
  title: PropTypes.string.isRequired,
  geoJson: PropTypes.shape({
    features: PropTypes.array,
  }).isRequired,
  districtStats: SchematicMap.propTypes.statsByName,
  stateSlug: PropTypes.string.isRequired,
  tooltipHandlers: SchematicMap.propTypes.tooltipHandlers,
};

const DistrictRelevanceMap = ({ selectedState = '', stateSummaries, stateDistrictStats }) => {
  const stateNames = useMemo(() => Object.keys(stateSummaries || {}).sort(), [stateSummaries]);
  const activeState = selectedState || (stateNames.length === 1 ? stateNames[0] : '');
  const { geoJson, status, stateSlug } = useStateGeoJson(activeState);
  const tooltipHandlers = useMapTooltip();

  if (!stateNames.length) {
    return null;
  }

  const showStateOverview = !activeState && stateNames.length > 1;
  const title = showStateOverview ? 'State Relevance Overview' : `${activeState} District Relevance Map`;

  const content = showStateOverview ? (
    <SchematicMap
      title={title}
      statsByName={stateSummaries}
      tooltipHandlers={tooltipHandlers}
    />
  ) : status === 'loading' ? (
    <div className="report-map-empty">Loading local map asset...</div>
  ) : geoJson ? (
    <GeoMap
      title={title}
      geoJson={geoJson}
      districtStats={stateDistrictStats[activeState] || {}}
      stateSlug={stateSlug}
      tooltipHandlers={tooltipHandlers}
    />
  ) : (
    <SchematicMap
      title={title}
      statsByName={stateDistrictStats[activeState] || {}}
      tooltipHandlers={tooltipHandlers}
    />
  );

  return (
    <div className="report-map-section">
      <h3 className="report-map-title">{title}</h3>
      <div className="report-map-frame">
        {content}
      </div>
      <Legend />
      <Tooltip tooltip={tooltipHandlers.tooltip} />
    </div>
  );
};

DistrictRelevanceMap.propTypes = {
  selectedState: PropTypes.string,
  stateSummaries: PropTypes.objectOf(PropTypes.shape({
    total: PropTypes.number,
    Relevant: PropTypes.number,
    'Partially Relevant': PropTypes.number,
    Irrelevant: PropTypes.number,
  })).isRequired,
  stateDistrictStats: PropTypes.objectOf(SchematicMap.propTypes.statsByName).isRequired,
};

export default DistrictRelevanceMap;
