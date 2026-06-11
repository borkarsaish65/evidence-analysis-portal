import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ENV } from '../../config/env';
import PropTypes from 'prop-types';
import Papa from 'papaparse';
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  ArcElement,
} from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { Download, Filter, BarChart3, Users, School, Building2, FileText, ChevronRight, ChevronDown } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import DistrictRelevanceMap from './DistrictRelevanceMap';
import './standard-report.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler
);

const REQUIRED_COLUMNS = [
  'UUID',
  'Declared State',
  'District',
  'Block',
  'School Name',
  'Tasks',
  'Project ID',
  'Project start date of the user',
  'Project completion date of the user',
  'Relevance Tag',
];

const RELEVANCE_TYPES = ['Relevant', 'Partially Relevant', 'Irrelevant'];
const MAX_TOP_HIERARCHY_ITEMS = 15;
const REQUIRED_ENROLLMENT_COLUMNS = [
  'Enrollment_2024',
  'Enrollment_2025',
  'Enrollment_Increase_Percentage',
];

const emptyFilters = {
  state: '',
  district: '',
  block: '',
  school: '',
  relevance: '',
};

const PDF_HEADER_HEIGHT_MM = 15;
const PDF_FOOTER_HEIGHT_MM = 15;
const PDF_MARGIN_MM = 10;
const PDF_SECTION_GAP_MM = 5;
const PDF_MAX_TABLE_ROWS = 200;

const formatPdfTimestamp = () => new Date().toLocaleString('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const relScore = (relevant, partiallyRelevant, total) => {
  if (!total) return 0;
  return ((relevant + partiallyRelevant * 0.5) / total) * 100;
};

const parseSubject = (task) => {
  if (!task) return 'Other';
  if (task.includes('विज्ञान')) return 'Science';
  if (task.includes('गणित')) return 'Math';
  if (task.includes('अंग्रेजी') || task.includes('English')) return 'English';
  return 'Other';
};

const parseGrade = (task) => {
  const match = (task || '').match(/कक्षा\s*(\d{1,2})/);
  return match ? `Grade ${match[1]}` : 'Unknown';
};

const normalizeValue = (value) => String(value || '').trim();

const getGroupKey = (dateStr, unit) => {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return null;

  if (unit === 'day') {
    return date.toISOString().split('T')[0];
  }

  if (unit === 'month') {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  const dayOfWeek = date.getDay();
  const startOfWeek = new Date(date);
  startOfWeek.setDate(date.getDate() - dayOfWeek);
  return startOfWeek.toISOString().split('T')[0];
};

const getTimelineUnit = (minDate, maxDate) => {
  if (!minDate || !maxDate) return 'month';
  if (
    minDate.getMonth() === maxDate.getMonth() &&
    minDate.getFullYear() === maxDate.getFullYear()
  ) {
    return 'day';
  }

  const diffMs = Math.abs(maxDate.getTime() - minDate.getTime());
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 183) return 'week';
  return 'month';
};

const sortEntries = (entries) => [...entries].sort((a, b) => a[0].localeCompare(b[0]));

const parseCsvText = (csvText) => {
  const parseResult = Papa.parse(csvText || '', {
    header: true,
    skipEmptyLines: true,
  });

  if (parseResult.errors?.length) {
    const message = parseResult.errors[0]?.message || 'Invalid CSV format.';
    return { error: message, rows: [], headers: [] };
  }

  const headers = (parseResult.meta?.fields || []).map((field, index) => {
    const cleaned = normalizeValue(field);
    return index === 0 ? cleaned.replace(/^\ufeff/, '') : cleaned;
  });

  if (!headers.length) {
    return { error: 'CSV header row is missing.', rows: [], headers: [] };
  }

  const missingColumns = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missingColumns.length) {
    return {
      error: `Missing required CSV columns: ${missingColumns.join(', ')}`,
      rows: [],
      headers,
    };
  }

  const rows = (parseResult.data || [])
    .map((row) => {
      const normalized = {};
      headers.forEach((header) => {
        normalized[header] = normalizeValue(row?.[header]);
      });
      return normalized;
    })
    .filter((row) => Object.values(row).some((value) => value !== ''));

  if (!rows.length) {
    return { error: 'CSV contains no data rows.', rows: [], headers };
  }

  return { error: '', rows, headers };
};

const createNode = () => ({
  total: 0,
  Relevant: 0,
  'Partially Relevant': 0,
  Irrelevant: 0,
});

const updateNode = (node, relevanceTag) => {
  node.total += 1;
  if (RELEVANCE_TYPES.includes(relevanceTag)) {
    node[relevanceTag] += 1;
  }
};

// Async version of computeReportData: processes rows in 5 000-row chunks, yielding between
// each chunk so the main thread stays responsive. Signature and return shape are identical.
const computeReportDataAsync = async (rows, onProgress) => {
  const CHUNK = 5_000;

  const relevanceCounts = { Relevant: 0, 'Partially Relevant': 0, Irrelevant: 0 };
  const statesSet = new Set();
  const usersSet = new Set();
  const schoolsSet = new Set();
  const districtsSet = new Set();
  const blocksSet = new Set();
  const subjectCounts = {};
  const gradeCounts = {};
  const taskCounts = {};
  const timeline = {
    day: { starts: {}, completions: {}, submissions: {}, relevant: {} },
    week: { starts: {}, completions: {}, submissions: {}, relevant: {} },
    month: { starts: {}, completions: {}, submissions: {}, relevant: {} },
  };
  const districtHierarchy = {};
  const stateSummaries = {};
  const stateDistrictStats = {};
  const teacherMap = {};
  const enrollment = {};
  let hasEnrollmentData = false;
  const customTaskHierarchy = {};
  let hasCustomTasks = false;
  let minDate = null;
  let maxDate = null;

  for (let offset = 0; offset < rows.length; offset += CHUNK) {
    const end = Math.min(offset + CHUNK, rows.length);

    for (let idx = offset; idx < end; idx++) {
      const row = rows[idx];

      const relevanceTag = normalizeValue(row['Relevance Tag']);
      const district = normalizeValue(row.District) || 'Unknown';
      const block = normalizeValue(row.Block) || 'Unknown';
      const school = normalizeValue(row['School Name']) || 'Unknown';
      const uuid = normalizeValue(row.UUID) || 'Unknown User';
      const task = (normalizeValue(row.Tasks).replace(/^'/, '').normalize('NFC')) || 'Unknown Task';
      const state = normalizeValue(row['Declared State']);
      if (state) statesSet.add(state.toUpperCase());
      const stateName = state || 'Unknown State';

      if (RELEVANCE_TYPES.includes(relevanceTag)) relevanceCounts[relevanceTag] += 1;
      if (uuid) usersSet.add(uuid);
      if (school) schoolsSet.add(school);
      if (district) districtsSet.add(district);
      if (block) blocksSet.add(block);

      if (!stateSummaries[stateName]) stateSummaries[stateName] = createNode();
      updateNode(stateSummaries[stateName], relevanceTag);

      if (!stateDistrictStats[stateName]) stateDistrictStats[stateName] = {};
      if (!stateDistrictStats[stateName][district]) stateDistrictStats[stateName][district] = createNode();
      updateNode(stateDistrictStats[stateName][district], relevanceTag);

      const subject = parseSubject(task);
      const grade = parseGrade(task);
      subjectCounts[subject] = (subjectCounts[subject] || 0) + 1;
      gradeCounts[grade] = (gradeCounts[grade] || 0) + 1;
      taskCounts[task] = (taskCounts[task] || 0) + 1;

      const startDate = new Date(row['Project start date of the user']);
      const completionDate = new Date(row['Project completion date of the user']);
      [startDate, completionDate].forEach((candidate) => {
        if (!Number.isNaN(candidate.getTime())) {
          if (!minDate || candidate < minDate) minDate = new Date(candidate);
          if (!maxDate || candidate > maxDate) maxDate = new Date(candidate);
        }
      });

      ['day', 'week', 'month'].forEach((unit) => {
        const startKey = getGroupKey(row['Project start date of the user'], unit);
        const completionKey = getGroupKey(row['Project completion date of the user'], unit);
        if (startKey) timeline[unit].starts[startKey] = (timeline[unit].starts[startKey] || 0) + 1;
        if (completionKey) {
          timeline[unit].completions[completionKey] = (timeline[unit].completions[completionKey] || 0) + 1;
          timeline[unit].submissions[completionKey] = (timeline[unit].submissions[completionKey] || 0) + 1;
          if (relevanceTag === 'Relevant') {
            timeline[unit].relevant[completionKey] = (timeline[unit].relevant[completionKey] || 0) + 1;
          }
        }
      });

      if (!districtHierarchy[district]) districtHierarchy[district] = { ...createNode(), blocks: {} };
      updateNode(districtHierarchy[district], relevanceTag);
      if (!districtHierarchy[district].blocks[block]) districtHierarchy[district].blocks[block] = { ...createNode(), schools: {} };
      updateNode(districtHierarchy[district].blocks[block], relevanceTag);
      if (!districtHierarchy[district].blocks[block].schools[school]) districtHierarchy[district].blocks[block].schools[school] = { ...createNode() };
      updateNode(districtHierarchy[district].blocks[block].schools[school], relevanceTag);

      const teacherKey = `${district}||${block}||${school}||${uuid}`;
      if (!teacherMap[teacherKey]) teacherMap[teacherKey] = { district, block, school, teacher: uuid, ...createNode() };
      updateNode(teacherMap[teacherKey], relevanceTag);

      const e2024 = Number.parseFloat(row.Enrollment_2024);
      const e2025 = Number.parseFloat(row.Enrollment_2025);
      const eGrowth = Number.parseFloat(row.Enrollment_Increase_Percentage);
      const hasEnrollmentRowData = Number.isFinite(e2024) || Number.isFinite(e2025) || Number.isFinite(eGrowth);

      if (hasEnrollmentRowData) {
        hasEnrollmentData = true;
        if (!enrollment[district]) enrollment[district] = { enrollment2024: 0, enrollment2025: 0, count2024: 0, count2025: 0, growthSum: 0, growthCount: 0, blocks: {} };
        if (!enrollment[district].blocks[block]) enrollment[district].blocks[block] = { enrollment2024: 0, enrollment2025: 0, count2024: 0, count2025: 0, growthSum: 0, growthCount: 0, schools: {} };
        if (!enrollment[district].blocks[block].schools[school]) enrollment[district].blocks[block].schools[school] = { enrollment2024: 0, enrollment2025: 0, count2024: 0, count2025: 0, growthSum: 0, growthCount: 0 };

        const dn = enrollment[district];
        const bn = enrollment[district].blocks[block];
        const sn = enrollment[district].blocks[block].schools[school];
        if (Number.isFinite(e2024)) { dn.enrollment2024 += e2024; dn.count2024 += 1; bn.enrollment2024 += e2024; bn.count2024 += 1; sn.enrollment2024 += e2024; sn.count2024 += 1; }
        if (Number.isFinite(e2025)) { dn.enrollment2025 += e2025; dn.count2025 += 1; bn.enrollment2025 += e2025; bn.count2025 += 1; sn.enrollment2025 += e2025; sn.count2025 += 1; }
        if (Number.isFinite(eGrowth)) { dn.growthSum += eGrowth; dn.growthCount += 1; bn.growthSum += eGrowth; bn.growthCount += 1; sn.growthSum += eGrowth; sn.growthCount += 1; }
      }

      if (normalizeValue(row['Task Type']) === 'User-Owned') {
        hasCustomTasks = true;
        if (!customTaskHierarchy[district]) customTaskHierarchy[district] = { ...createNode(), blocks: {} };
        updateNode(customTaskHierarchy[district], relevanceTag);
        if (!customTaskHierarchy[district].blocks[block]) customTaskHierarchy[district].blocks[block] = { ...createNode(), schools: {} };
        updateNode(customTaskHierarchy[district].blocks[block], relevanceTag);
        if (!customTaskHierarchy[district].blocks[block].schools[school]) customTaskHierarchy[district].blocks[block].schools[school] = { ...createNode() };
        updateNode(customTaskHierarchy[district].blocks[block].schools[school], relevanceTag);
      }
    }

    if (end < rows.length) {
      onProgress?.(Math.round((end / rows.length) * 100));
      // Yield to the event loop so the browser can repaint between chunks
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const timelineUnit = getTimelineUnit(minDate, maxDate);
  const starts = timeline[timelineUnit].starts;
  const completions = timeline[timelineUnit].completions;
  const submissions = timeline[timelineUnit].submissions;
  const relevant = timeline[timelineUnit].relevant;
  const timelineLabels = Array.from(new Set([...Object.keys(starts), ...Object.keys(completions)])).sort();
  const submissionLabels = Array.from(new Set([...Object.keys(submissions), ...Object.keys(relevant)])).sort();
  const taskEntries = Object.entries(taskCounts).filter(([t]) => t).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const sortedDistricts = sortEntries(Object.entries(districtHierarchy));

  const teachersBySchool = {};
  for (const t of Object.values(teacherMap)) {
    const key = `${t.district}||${t.block}||${t.school}`;
    if (!teachersBySchool[key]) teachersBySchool[key] = [];
    teachersBySchool[key].push(t);
  }

  const topHierarchy = sortedDistricts
    .map(([district, districtData]) => {
      const blocks = Object.entries(districtData.blocks)
        .map(([block, blockData]) => ({
          block,
          ...blockData,
          relevancePercent: relScore(blockData.Relevant, blockData['Partially Relevant'], blockData.total),
          schools: Object.entries(blockData.schools)
            .map(([school, schoolData]) => ({
              school,
              ...schoolData,
              relevancePercent: relScore(schoolData.Relevant, schoolData['Partially Relevant'], schoolData.total),
              teachers: (teachersBySchool[`${district}||${block}||${school}`] || [])
                .map((teacherRow) => ({ teacher: teacherRow.teacher, ...teacherRow, relevancePercent: relScore(teacherRow.Relevant, teacherRow['Partially Relevant'], teacherRow.total) }))
                .sort((a, b) => b.relevancePercent - a.relevancePercent)
                .slice(0, MAX_TOP_HIERARCHY_ITEMS),
            }))
            .sort((a, b) => b.relevancePercent - a.relevancePercent)
            .slice(0, MAX_TOP_HIERARCHY_ITEMS),
        }))
        .sort((a, b) => b.relevancePercent - a.relevancePercent)
        .slice(0, MAX_TOP_HIERARCHY_ITEMS);
      return { district, ...districtData, relevancePercent: relScore(districtData.Relevant, districtData['Partially Relevant'], districtData.total), blocks };
    })
    .sort((a, b) => b.relevancePercent - a.relevancePercent)
    .slice(0, 5);

  return {
    totalEvidence: rows.length,
    relevanceCounts,
    usersCount: usersSet.size,
    schoolsCount: schoolsSet.size,
    districtsCount: districtsSet.size,
    blocksCount: blocksSet.size,
    statesUpper: statesSet,
    subjectCounts,
    gradeCounts,
    timelineLabels,
    timelineStarts: timelineLabels.map((l) => starts[l] || 0),
    timelineCompletions: timelineLabels.map((l) => completions[l] || 0),
    submissionLabels,
    submissionTotal: submissionLabels.map((l) => submissions[l] || 0),
    submissionRelevant: submissionLabels.map((l) => relevant[l] || 0),
    taskEntries,
    districtHierarchy,
    stateSummaries,
    stateDistrictStats,
    sortedDistricts,
    topHierarchy,
    hasEnrollmentData,
    enrollment,
    hasCustomTasks,
    customTaskHierarchy,
  };
};

// Safe empty shape matching computeReportData's return; used while async computation is pending.
const EMPTY_REPORT_DATA = {
  totalEvidence: 0,
  relevanceCounts: { Relevant: 0, 'Partially Relevant': 0, Irrelevant: 0 },
  usersCount: 0,
  schoolsCount: 0,
  districtsCount: 0,
  blocksCount: 0,
  statesUpper: new Set(),
  subjectCounts: {},
  gradeCounts: {},
  timelineLabels: [],
  timelineStarts: [],
  timelineCompletions: [],
  submissionLabels: [],
  submissionTotal: [],
  submissionRelevant: [],
  taskEntries: [],
  districtHierarchy: {},
  stateSummaries: {},
  stateDistrictStats: {},
  sortedDistricts: [],
  topHierarchy: [],
  hasEnrollmentData: false,
  enrollment: {},
  hasCustomTasks: false,
  customTaskHierarchy: {},
};

const formatNumber = (value) => {
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString('en-IN');
};

const wrapChartLabel = (label, maxLineLength = 18, maxLines = 3) => {
  const words = String(label || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = '';

  words.forEach((word) => {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (nextLine.length > maxLineLength && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = nextLine;
    }
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  if (lines.length <= maxLines) {
    return lines;
  }

  const visibleLines = lines.slice(0, maxLines);
  visibleLines[maxLines - 1] = `${visibleLines[maxLines - 1].replace(/\.+$/, '')}...`;
  return visibleLines;
};

const mapSvgToCanvas = (svgElement) => new Promise((resolve, reject) => {
  const rect = svgElement.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width));
  const height = Math.max(1, Math.ceil(rect.height));
  const serializedSvg = new XMLSerializer().serializeToString(svgElement);
  const svgBlob = new Blob([serializedSvg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const image = new Image();

  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = width * 2;
    canvas.height = height * 2;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.className = svgElement.className?.baseVal || svgElement.className || '';
    const context = canvas.getContext('2d');
    context.scale(2, 2);
    context.drawImage(image, 0, 0, width, height);
    URL.revokeObjectURL(url);
    resolve(canvas);
  };

  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Unable to prepare map SVG for PDF capture.'));
  };

  image.src = url;
});

const replaceMapSvgsForPdf = async (rootElement) => {
  const replacements = [];
  const mapSvgs = Array.from(rootElement.querySelectorAll('.report-map-svg'));

  for (const svgElement of mapSvgs) {
    const canvas = await mapSvgToCanvas(svgElement);
    const parent = svgElement.parentNode;
    const nextSibling = svgElement.nextSibling;
    parent.replaceChild(canvas, svgElement);
    replacements.push({ parent, svgElement, canvas, nextSibling });
  }

  return () => {
    replacements.forEach(({ parent, svgElement, canvas, nextSibling }) => {
      if (canvas.parentNode === parent) {
        parent.replaceChild(svgElement, canvas);
      }
      if (nextSibling && svgElement.nextSibling !== nextSibling && nextSibling.parentNode === parent) {
        parent.insertBefore(svgElement, nextSibling);
      }
    });
  };
};

const StandardReportRenderer = ({ csvText, parsedRows, reportApiData, onFilterChange, sourceLabel = 'Report CSV' }) => {
  const reportRef = useRef(null);

  // True when the parent provides pre-aggregated API data (large-dataset path)
  const usingApiData = !!reportApiData?.summary;

  const [filters, setFilters] = useState(emptyFilters);
  // Ref keeps the latest filters value accessible in callbacks without stale closure
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const [expandedDistricts, setExpandedDistricts] = useState(new Set());
  const [expandedBlocks, setExpandedBlocks] = useState(new Set());
  const [topHierarchyCount, setTopHierarchyCount] = useState(5);
  const [expandedTopDistricts, setExpandedTopDistricts] = useState(new Set());
  const [expandedTopBlocks, setExpandedTopBlocks] = useState(new Set());
  const [expandedTopSchools, setExpandedTopSchools] = useState(new Set());
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfProgress, setPdfProgress] = useState(0);

  // Async computation state for the local CSV path
  const [computedData, setComputedData] = useState(null);
  const [isComputing, setIsComputing] = useState(false);
  const [computeProgress, setComputeProgress] = useState(0);

  useEffect(() => {
    // In API mode the parent (ReportView) controls filter state — skip local reset
    if (usingApiData) return;
    setFilters(emptyFilters);
    setExpandedDistricts(new Set());
    setExpandedBlocks(new Set());
    setTopHierarchyCount(5);
    setExpandedTopDistricts(new Set());
    setExpandedTopBlocks(new Set());
    setExpandedTopSchools(new Set());
    setComputedData(null);
  }, [csvText, parsedRows, usingApiData]);

  // Unified filter setter: updates local state and propagates to parent in API mode
  const handleFilterUpdate = useCallback((updater) => {
    const next = typeof updater === 'function' ? updater(filtersRef.current) : updater;
    setFilters(next);
    if (usingApiData && onFilterChange) {
      onFilterChange(next);
    }
  }, [usingApiData, onFilterChange]);

  const parsed = useMemo(() => {
    if (usingApiData) return { error: '', rows: [], headers: [] };
    // parsedRows is provided by the parent (already parsed off-thread via Papa.parse worker)
    if (parsedRows != null) {
      const headers = parsedRows.length > 0 ? Object.keys(parsedRows[0]) : [];
      return { error: '', rows: parsedRows, headers };
    }
    return parseCsvText(csvText);
  }, [csvText, parsedRows, usingApiData]);

  const filterOptions = useMemo(() => {
    // API mode: filter options are pre-computed by the backend
    if (usingApiData) {
      return reportApiData.summary.filterOptions || { states: [], districts: [], blocks: [], schools: [] };
    }

    const stateSet = new Set();
    const districtSet = new Set();
    const blockSet = new Set();
    const schoolSet = new Set();

    for (const row of parsed.rows) {
      const s = normalizeValue(row['Declared State']);
      const d = normalizeValue(row.District);
      const b = normalizeValue(row.Block);
      const sc = normalizeValue(row['School Name']);

      if (s) stateSet.add(s);
      if (!filters.state || s === filters.state) {
        if (d) districtSet.add(d);
        if (!filters.district || d === filters.district) {
          if (b) blockSet.add(b);
          if (!filters.block || b === filters.block) {
            if (sc) schoolSet.add(sc);
          }
        }
      }
    }

    return {
      states: [...stateSet].sort(),
      districts: [...districtSet].sort(),
      blocks: [...blockSet].sort(),
      schools: [...schoolSet].sort(),
    };
  }, [usingApiData, reportApiData?.summary?.filterOptions, filters.block, filters.district, filters.state, parsed.rows]);

  const filteredRows = useMemo(() => {
    // API mode: filtering is done server-side — no client-side pass needed
    if (usingApiData) return [];
    return parsed.rows.filter((row) => {
      if (filters.state && normalizeValue(row['Declared State']) !== filters.state) return false;
      if (filters.district && normalizeValue(row.District) !== filters.district) return false;
      if (filters.block && normalizeValue(row.Block) !== filters.block) return false;
      if (filters.school && normalizeValue(row['School Name']) !== filters.school) return false;
      if (filters.relevance && normalizeValue(row['Relevance Tag']) !== filters.relevance) return false;
      return true;
    });
  }, [usingApiData, filters.block, filters.district, filters.relevance, filters.school, filters.state, parsed.rows]);

  // Kick off async chunked computation whenever filteredRows changes (local CSV path only)
  useEffect(() => {
    if (usingApiData) return;
    if (!filteredRows.length) {
      setComputedData(null);
      setIsComputing(false);
      return;
    }

    let cancelled = false;
    setIsComputing(true);
    setComputeProgress(0);
    setComputedData(null);

    computeReportDataAsync(filteredRows, (pct) => {
      if (!cancelled) setComputeProgress(pct);
    }).then((result) => {
      if (!cancelled) {
        setComputedData(result);
        setIsComputing(false);
      }
    });

    return () => { cancelled = true; };
  }, [filteredRows, usingApiData]);

  const reportData = useMemo(() => {
    if (usingApiData) {
      // Convert statesUpper array → Set so the existing .has('BIHAR') check works
      const summary = reportApiData.summary;
      return { ...summary, statesUpper: new Set(summary.statesUpper || []) };
    }
    return computedData ?? EMPTY_REPORT_DATA;
  }, [usingApiData, reportApiData?.summary, computedData]);
  const hasRequiredEnrollmentColumns = useMemo(() => {
    // When rows are pre-parsed by the parent, derive headers from the first row's keys
    if (parsedRows != null && parsedRows.length > 0) {
      return REQUIRED_ENROLLMENT_COLUMNS.every((column) => column in parsedRows[0]);
    }
    return REQUIRED_ENROLLMENT_COLUMNS.every((column) => parsed.headers.includes(column));
  }, [parsedRows, parsed.headers]);

  const shouldShowSubjectGrade = reportData.statesUpper.has('BIHAR');

  const enrollmentDistrictRows = useMemo(() => {
    return Object.entries(reportData.enrollment).map(([district, districtData]) => {
      const growth =
        districtData.enrollment2024 > 0
          ? ((districtData.enrollment2025 - districtData.enrollment2024) / districtData.enrollment2024) * 100
          : 0;
      return {
        district,
        ...districtData,
        growth,
        difference: districtData.enrollment2025 - districtData.enrollment2024,
      };
    });
  }, [reportData.enrollment]);

  const enrollmentDistrictRowsSorted = useMemo(() => {
    return [...enrollmentDistrictRows].sort((a, b) => b.enrollment2025 - a.enrollment2025);
  }, [enrollmentDistrictRows]);

  const enrollmentSummary = useMemo(() => {
    return enrollmentDistrictRows.reduce(
      (accumulator, row) => ({
        enrollment2024: accumulator.enrollment2024 + row.enrollment2024,
        enrollment2025: accumulator.enrollment2025 + row.enrollment2025,
        districtCount: accumulator.districtCount + 1,
      }),
      {
        enrollment2024: 0,
        enrollment2025: 0,
        districtCount: 0,
      }
    );
  }, [enrollmentDistrictRows]);

  const visibleTopHierarchy = useMemo(() => {
    const trimTeachers = (teachers) => teachers.slice(0, topHierarchyCount);
    const trimSchools = (schools) =>
      schools.slice(0, topHierarchyCount).map((school) => ({
        ...school,
        teachers: trimTeachers(school.teachers),
      }));
    const trimBlocks = (blocks) =>
      blocks.slice(0, topHierarchyCount).map((block) => ({
        ...block,
        schools: trimSchools(block.schools),
      }));

    return reportData.topHierarchy.slice(0, topHierarchyCount).map((district) => ({
      ...district,
      blocks: trimBlocks(district.blocks),
    }));
  }, [reportData.topHierarchy, topHierarchyCount]);

  // Mirrors the top-level state filter: when the user picks a state in the main filter bar,
  // the hierarchy table narrows to districts that belong to that state only.
  const hierarchyFilteredData = useMemo(() => {
    if (!filters.state) return visibleTopHierarchy;
    const stateKey = Object.keys(reportData.stateDistrictStats).find(
      (s) => s.toLowerCase() === filters.state.toLowerCase()
    );
    if (!stateKey) return [];
    const districtSet = new Set(Object.keys(reportData.stateDistrictStats[stateKey]));
    return visibleTopHierarchy.filter((d) => districtSet.has(d.district));
  }, [visibleTopHierarchy, filters.state, reportData.stateDistrictStats]);

  const timelineChartData = useMemo(() => ({
    labels: reportData.timelineLabels,
    datasets: [
      {
        label: 'Project Starts',
        data: reportData.timelineStarts,
        borderColor: '#4facfe',
        backgroundColor: 'rgba(79, 172, 254, 0.2)',
        fill: true,
        tension: 0.35,
        borderWidth: 2,
      },
      {
        label: 'Project Completions',
        data: reportData.timelineCompletions,
        borderColor: '#42e695',
        backgroundColor: 'rgba(66, 230, 149, 0.2)',
        fill: true,
        tension: 0.35,
        borderWidth: 2,
      },
    ],
  }), [reportData.timelineLabels, reportData.timelineStarts, reportData.timelineCompletions]);

  const submissionChartData = useMemo(() => ({
    labels: reportData.submissionLabels,
    datasets: [
      {
        label: 'Total Evidence',
        data: reportData.submissionTotal,
        borderColor: '#4facfe',
        backgroundColor: 'rgba(79, 172, 254, 0.2)',
        fill: true,
        tension: 0.35,
        borderWidth: 2,
      },
      {
        label: 'Relevant Evidence',
        data: reportData.submissionRelevant,
        borderColor: '#ff6b6b',
        backgroundColor: 'rgba(255, 107, 107, 0.2)',
        fill: true,
        tension: 0.35,
        borderWidth: 2,
      },
    ],
  }), [reportData.submissionLabels, reportData.submissionTotal, reportData.submissionRelevant]);

  const subjectChartData = useMemo(() => ({
    labels: Object.keys(reportData.subjectCounts),
    datasets: [
      {
        data: Object.values(reportData.subjectCounts),
        backgroundColor: ['#ff6b6b', '#4ecdc4', '#45b7d1', '#feca57', '#96ceb4'],
        borderWidth: 2,
        borderColor: '#fff',
        hoverBorderWidth: 3,
        hoverBorderColor: '#fff',
        hoverOffset: 6,
      },
    ],
  }), [reportData.subjectCounts]);

  const gradeChartData = useMemo(() => ({
    labels: Object.keys(reportData.gradeCounts),
    datasets: [
      {
        data: Object.values(reportData.gradeCounts),
        backgroundColor: ['#a8e6cf', '#dcedc1', '#ffd3a5', '#fd9853', '#ff8a80'],
        borderWidth: 2,
        borderColor: '#fff',
        hoverBorderWidth: 3,
        hoverBorderColor: '#fff',
        hoverOffset: 6,
      },
    ],
  }), [reportData.gradeCounts]);

  const taskChartData = useMemo(() => ({
    labels: reportData.taskEntries.map(([task]) => task),
    datasets: [
      {
        label: 'Task Completion Count',
        data: reportData.taskEntries.map(([, count]) => count),
        backgroundColor: 'rgba(79, 172, 254, 0.8)',
        borderColor: '#4facfe',
        borderWidth: 2,
      },
    ],
  }), [reportData.taskEntries]);

  const enrollmentComparisonChartData = useMemo(() => ({
    labels: enrollmentDistrictRowsSorted.map((row) => row.district),
    datasets: [
      {
        label: 'Enrollment 2024',
        data: enrollmentDistrictRowsSorted.map((row) => row.enrollment2024),
        backgroundColor: 'rgba(79, 172, 254, 0.8)',
      },
      {
        label: 'Enrollment 2025',
        data: enrollmentDistrictRowsSorted.map((row) => row.enrollment2025),
        backgroundColor: 'rgba(66, 230, 149, 0.8)',
      },
    ],
  }), [enrollmentDistrictRowsSorted]);

  const enrollmentGrowthChartData = useMemo(() => ({
    labels: enrollmentDistrictRowsSorted.map((row) => row.district),
    datasets: [
      {
        label: 'Growth %',
        data: enrollmentDistrictRowsSorted.map((row) => row.growth),
        backgroundColor: enrollmentDistrictRowsSorted.map((row) =>
          row.growth >= 0 ? 'rgba(66, 230, 149, 0.8)' : 'rgba(255, 107, 107, 0.8)'
        ),
      },
    ],
  }), [enrollmentDistrictRowsSorted]);

  const toggleDistrict = (district) => {
    setExpandedDistricts((previous) => {
      const next = new Set(previous);
      if (next.has(district)) {
        next.delete(district);
      } else {
        next.add(district);
      }
      return next;
    });
  };

  const toggleBlock = (district, block) => {
    const key = `${district}||${block}`;
    setExpandedBlocks((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleTopDistrict = (districtName) => {
    setExpandedTopDistricts((previous) => {
      const next = new Set(previous);
      if (next.has(districtName)) {
        next.delete(districtName);
        setExpandedTopBlocks((previousBlocks) => {
          const nextBlocks = new Set(previousBlocks);
          Array.from(nextBlocks).forEach((key) => {
            if (key.startsWith(`${districtName}||`)) {
              nextBlocks.delete(key);
            }
          });
          return nextBlocks;
        });
        setExpandedTopSchools((previousSchools) => {
          const nextSchools = new Set(previousSchools);
          Array.from(nextSchools).forEach((key) => {
            if (key.startsWith(`${districtName}||`)) {
              nextSchools.delete(key);
            }
          });
          return nextSchools;
        });
      } else {
        next.add(districtName);
      }
      return next;
    });
  };

  const toggleTopBlock = (districtName, blockName) => {
    const key = `${districtName}||${blockName}`;
    setExpandedTopBlocks((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
        setExpandedTopSchools((previousSchools) => {
          const nextSchools = new Set(previousSchools);
          Array.from(nextSchools).forEach((schoolKey) => {
            if (schoolKey.startsWith(`${key}||`)) {
              nextSchools.delete(schoolKey);
            }
          });
          return nextSchools;
        });
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleTopSchool = (districtName, blockName, schoolName) => {
    const key = `${districtName}||${blockName}||${schoolName}`;
    setExpandedTopSchools((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const downloadPdf = async () => {
    if (!reportRef.current || pdfLoading) {
      return;
    }

    setPdfLoading(true);
    setPdfProgress(0);
    const reportElement = reportRef.current;

    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const contentWidth = pdfWidth - (PDF_MARGIN_MM * 2);
      const contentAreaHeight = pdfHeight - PDF_HEADER_HEIGHT_MM - PDF_FOOTER_HEIGHT_MM;
      const contentBottomY = PDF_HEADER_HEIGHT_MM + contentAreaHeight;

      const reportName = sourceLabel?.startsWith('Analysis Report - ')
        ? sourceLabel
        : `Analysis Report - ${sourceLabel || 'Unnamed Execution'}`;
      const timestamp = formatPdfTimestamp();
      const systemName = 'Evidence Analysis System';

      const addHeader = () => {
        pdf.setTextColor(15, 23, 42);
        pdf.setFontSize(10);
        pdf.setFont(undefined, 'bold');
        pdf.text(reportName, pdfWidth / 2, 10, { align: 'center' });
      };

      const addFooter = (currentPage, totalPages) => {
        const footerY = pdfHeight - 8;
        pdf.setTextColor(71, 85, 105);
        pdf.setFontSize(8);
        pdf.setFont(undefined, 'normal');
        pdf.setDrawColor(203, 213, 225);
        pdf.setLineWidth(0.5);
        pdf.line(PDF_MARGIN_MM, pdfHeight - PDF_FOOTER_HEIGHT_MM + 2, pdfWidth - PDF_MARGIN_MM, pdfHeight - PDF_FOOTER_HEIGHT_MM + 2);
        
        pdf.text(`Page ${currentPage} of ${totalPages}`, PDF_MARGIN_MM, footerY);
        pdf.text(`Generated: ${timestamp}`, pdfWidth / 2, footerY, { align: 'center' });
        pdf.text(systemName, pdfWidth - PDF_MARGIN_MM, footerY, { align: 'right' });
      };

      let yPosition = PDF_HEADER_HEIGHT_MM;

      const startNewPage = () => {
        if (pdf.internal.getNumberOfPages() > 1 || yPosition > PDF_HEADER_HEIGHT_MM) {
          pdf.addPage();
        }
        addHeader();
        yPosition = PDF_HEADER_HEIGHT_MM;
      };

      const renderSectionCanvas = (section) => html2canvas(section, {
        scale: 1.5,
        useCORS: true,
        backgroundColor: '#ffffff',
        removeContainer: true,
        windowWidth: Math.max(document.documentElement.clientWidth, section.scrollWidth),
        onclone: (clonedDocument, clonedSection) => {
          clonedSection.classList.add('report-pdf-section-clone');
          clonedDocument.querySelectorAll('.overflow-x-auto, .overflow-y-visible').forEach((el) => {
            el.style.overflow = 'visible';
          });
          clonedDocument.querySelectorAll('table').forEach((table) => {
            table.style.width = '100%';
            table.style.tableLayout = 'auto';
          });
          // Cap table rows to prevent recursive DOM traversal stack overflow on large datasets
          clonedDocument.querySelectorAll('tbody').forEach((tbody) => {
            const rows = Array.from(tbody.querySelectorAll('tr'));
            if (rows.length > PDF_MAX_TABLE_ROWS) {
              rows.slice(PDF_MAX_TABLE_ROWS).forEach((row) => row.remove());
              const note = clonedDocument.createElement('tr');
              note.innerHTML = `<td colspan="99" style="padding:6px 8px;font-size:11px;color:#64748b;text-align:center;font-style:italic;">… ${(rows.length - PDF_MAX_TABLE_ROWS).toLocaleString()} more rows — view full data online</td>`;
              tbody.appendChild(note);
            }
          });
        },
      });

      reportElement.classList.add('report-pdf-exporting');
      await new Promise((resolve) => requestAnimationFrame(resolve));

      const sections = Array.from(reportElement.children).filter((section) => {
        const rect = section.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      addHeader();

      // Process sections sequentially to avoid concurrent recursive DOM traversals that
      // overflow the call stack on large datasets. Yield between each to allow GC to run.
      const canvases = [];
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const restoreMapSvgs = await replaceMapSvgsForPdf(section);
        let canvas;
        try {
          canvas = await renderSectionCanvas(section);
        } finally {
          restoreMapSvgs();
        }
        canvases.push(canvas);
        setPdfProgress(Math.round(((i + 1) / sections.length) * 80));
        // Yield to let the event loop breathe and GC reclaim the previous canvas memory
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      // Place canvases onto PDF pages sequentially (order matters for layout)
      for (const canvas of canvases) {
        // JPEG at 0.85 quality: ~5× smaller than PNG, dramatically reduces PDF file size and
        // peak memory during encoding. Quality is visually indistinguishable for report content.
        const imageData = canvas.toDataURL('image/jpeg', 0.85);
        const naturalWidth = contentWidth;
        const naturalHeight = (canvas.height * naturalWidth) / canvas.width;
        let renderWidth = naturalWidth;
        let renderHeight = naturalHeight;

        if (renderHeight > contentAreaHeight) {
          const scaleToPage = contentAreaHeight / renderHeight;
          renderHeight = contentAreaHeight;
          renderWidth = naturalWidth * scaleToPage;
        }

        if (yPosition > PDF_HEADER_HEIGHT_MM && yPosition + renderHeight > contentBottomY) {
          startNewPage();
        }

        const xPosition = PDF_MARGIN_MM + ((contentWidth - renderWidth) / 2);
        pdf.addImage(imageData, 'JPEG', xPosition, yPosition, renderWidth, renderHeight);
        yPosition += renderHeight + PDF_SECTION_GAP_MM;
      }

      setPdfProgress(95);

      const totalPages = pdf.internal.getNumberOfPages();
      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        pdf.setPage(pageNum);
        addFooter(pageNum, totalPages);
      }

      setPdfProgress(100);
      pdf.save('evidence-analysis-report.pdf');
    } finally {
      reportElement.classList.remove('report-pdf-exporting');
      setPdfLoading(false);
      setPdfProgress(0);
    }
  };

  if (!usingApiData && parsed.error) {
    return (
      <div className="report-error">
        <p className="report-error-title">Unable to render report</p>
        <p className="report-error-body">{parsed.error}</p>
      </div>
    );
  }

  if (!usingApiData && !parsed.rows.length) {
    return null;
  }

  if (usingApiData && !reportApiData.summary) {
    return null;
  }

  // Guard: show progress bar during computation OR during the one render cycle that occurs
  // before the useEffect sets isComputing=true (when parsedRows just arrived and computedData
  // is still null). This prevents a render with EMPTY_REPORT_DATA reaching chart/map components.
  if (!usingApiData && (isComputing || (!computedData && parsed.rows.length > 0))) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-5">
          <p className="text-sm font-medium text-blue-800">
            Computing report data{computeProgress > 0 ? ` — ${computeProgress}%` : '…'}
          </p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-blue-200">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-200"
              style={{ width: `${computeProgress || 5}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-blue-600">
            Processing {parsed.rows.length.toLocaleString()} rows — page stays responsive during this step.
          </p>
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl sm:text-2xl font-semibold text-slate-800">Analysis Report</h2>
              <p className="mt-1 text-sm text-slate-600">{sourceLabel}</p>
            </div>
            <Button 
              type="button" 
              onClick={downloadPdf} 
              disabled={pdfLoading}
              className="bg-blue-600 text-white hover:bg-blue-700 w-full sm:w-auto"
            >
              <Download className="mr-2 h-4 w-4" />
              {pdfLoading ? `Generating PDF${pdfProgress > 0 ? ` — ${pdfProgress}%` : '…'}` : 'Download PDF'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg text-slate-800">
            <Filter className="h-4 w-4 text-blue-600" />
            Filter Report Data
          </CardTitle>
          <CardDescription>Refine report insights by location and relevance criteria.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
            <label className="space-y-1 text-sm text-slate-700">
              <span className="font-medium">State</span>
              <select
                value={filters.state}
                onChange={(event) => handleFilterUpdate((previous) => ({ ...previous, state: event.target.value, district: '', block: '', school: '' }))}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
              >
                <option value="">All States</option>
                {filterOptions.states.map((state) => (
                  <option key={state} value={state}>{state}</option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-sm text-slate-700">
              <span className="font-medium">District</span>
              <select
                value={filters.district}
                onChange={(event) => handleFilterUpdate((previous) => ({ ...previous, district: event.target.value, block: '', school: '' }))}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
              >
                <option value="">All Districts</option>
                {filterOptions.districts.map((district) => (
                  <option key={district} value={district}>{district}</option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-sm text-slate-700">
              <span className="font-medium">Block</span>
              <select
                value={filters.block}
                onChange={(event) => handleFilterUpdate((previous) => ({ ...previous, block: event.target.value, school: '' }))}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
              >
                <option value="">All Blocks</option>
                {filterOptions.blocks.map((block) => (
                  <option key={block} value={block}>{block}</option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-sm text-slate-700">
              <span className="font-medium">School</span>
              <select
                value={filters.school}
                onChange={(event) => handleFilterUpdate((previous) => ({ ...previous, school: event.target.value }))}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
              >
                <option value="">All Schools</option>
                {filterOptions.schools.map((school) => (
                  <option key={school} value={school}>{school}</option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-sm text-slate-700">
              <span className="font-medium">Relevance Tag</span>
              <select
                value={filters.relevance}
                onChange={(event) => handleFilterUpdate((previous) => ({ ...previous, relevance: event.target.value }))}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
              >
                <option value="">All Relevance</option>
                {RELEVANCE_TYPES.map((tag) => (
                  <option key={tag} value={tag}>{tag}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-4 flex justify-end">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => handleFilterUpdate(emptyFilters)}
              className="h-10 border-slate-300 text-slate-700 hover:bg-slate-100"
            >
              Clear Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4 sm:space-y-6" ref={reportRef}>
        <section className="grid gap-4 md:grid-cols-3">
          <Card className="border-slate-200 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Evidence</p>
                  <p className="mt-2 text-2xl sm:text-3xl font-semibold text-slate-800">{formatNumber(reportData.totalEvidence)}</p>
                </div>
                <div className="rounded-md border p-2 flex-shrink-0 text-blue-600 bg-blue-50 border-blue-100">
                  <FileText className="h-4 w-4 sm:h-5 sm:w-5" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
            <CardContent className="p-4 sm:p-5">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Relevance Distribution</p>
                <div className="space-y-1">
                  <p className="text-lg font-semibold text-emerald-700">{formatNumber(reportData.relevanceCounts.Relevant)} Relevant</p>
                  <p className="text-sm text-amber-700">{formatNumber(reportData.relevanceCounts['Partially Relevant'])} Partially</p>
                  <p className="text-sm text-rose-700">{formatNumber(reportData.relevanceCounts.Irrelevant)} Irrelevant</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Participation</p>
                  <p className="mt-2 text-2xl sm:text-3xl font-semibold text-slate-800">{formatNumber(reportData.usersCount)}</p>
                  <p className="mt-1 text-xs text-slate-600">Users with Evidence</p>
                </div>
                <div className="rounded-md border p-2 flex-shrink-0 text-blue-600 bg-blue-50 border-blue-100">
                  <Users className="h-4 w-4 sm:h-5 sm:w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg text-slate-800">Evidence Submission Overview</CardTitle>
            <CardDescription>Comprehensive view of submissions across locations</CardDescription>
          </CardHeader>
          <CardContent>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Card className="border-slate-200 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Schools</p>
                      <p className="mt-2 text-2xl font-semibold text-slate-800">{formatNumber(reportData.schoolsCount)}</p>
                    </div>
                    <div className="rounded-md border p-2 flex-shrink-0 text-emerald-600 bg-emerald-50 border-emerald-100">
                      <School className="h-4 w-4" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-slate-200 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Districts</p>
                      <p className="mt-2 text-2xl font-semibold text-slate-800">{formatNumber(reportData.districtsCount)}</p>
                    </div>
                    <div className="rounded-md border p-2 flex-shrink-0 text-amber-600 bg-amber-50 border-amber-100">
                      <Building2 className="h-4 w-4" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-slate-200 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Blocks</p>
                      <p className="mt-2 text-2xl font-semibold text-slate-800">{formatNumber(reportData.blocksCount)}</p>
                    </div>
                    <div className="rounded-md border p-2 flex-shrink-0 text-blue-600 bg-blue-50 border-blue-100">
                      <BarChart3 className="h-4 w-4" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>
          </CardContent>
        </Card>

        {/* Project Timeline Section */}
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg text-slate-800">Project Timeline</CardTitle>
            <CardDescription>Project starts and completions over time</CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <div className="w-full" style={{ height: '350px' }}>
              <Line
                data={timelineChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  interaction: {
                    mode: 'index',
                    intersect: false,
                  },
                  plugins: {
                    legend: {
                      position: 'top',
                      align: 'end',
                      labels: {
                        boxWidth: 12,
                        padding: 15,
                        font: {
                          size: 12,
                        },
                      },
                    },
                    tooltip: {
                      backgroundColor: 'rgba(0, 0, 0, 0.8)',
                      padding: 12,
                      titleFont: {
                        size: 13,
                      },
                      bodyFont: {
                        size: 12,
                      },
                    },
                  },
                  scales: {
                    x: {
                      grid: {
                        display: false,
                      },
                      ticks: {
                        font: {
                          size: 11,
                        },
                      },
                    },
                    y: {
                      beginAtZero: true,
                      grid: {
                        color: 'rgba(0, 0, 0, 0.05)',
                      },
                      ticks: {
                        font: {
                          size: 11,
                        },
                      },
                    },
                  },
                }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Submission Volume Section */}
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg text-slate-800">Submission Volume</CardTitle>
            <CardDescription>Total and relevant evidence submissions over time</CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <div className="w-full" style={{ height: '350px' }}>
              <Line
                data={submissionChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  interaction: {
                    mode: 'index',
                    intersect: false,
                  },
                  plugins: {
                    legend: {
                      position: 'top',
                      align: 'end',
                      labels: {
                        boxWidth: 12,
                        padding: 15,
                        font: {
                          size: 12,
                        },
                      },
                    },
                    tooltip: {
                      backgroundColor: 'rgba(0, 0, 0, 0.8)',
                      padding: 12,
                      titleFont: {
                        size: 13,
                      },
                      bodyFont: {
                        size: 12,
                      },
                    },
                  },
                  scales: {
                    x: {
                      grid: {
                        display: false,
                      },
                      ticks: {
                        font: {
                          size: 11,
                        },
                      },
                    },
                    y: {
                      beginAtZero: true,
                      grid: {
                        color: 'rgba(0, 0, 0, 0.05)',
                      },
                      ticks: {
                        font: {
                          size: 11,
                        },
                      },
                    },
                  },
                }}
              />
            </div>
          </CardContent>
        </Card>

        {shouldShowSubjectGrade && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card className="border-slate-200 shadow-sm overflow-hidden">
              <CardHeader className="pb-2 sm:pb-4">
                <CardTitle className="text-base sm:text-lg text-slate-800">Subject Distribution</CardTitle>
                <CardDescription className="text-xs sm:text-sm">Distribution of evidence across subjects</CardDescription>
              </CardHeader>
              <CardContent className="p-3 sm:p-6">
                {/* mx-auto + max-w keeps the donut from stretching too wide on large screens
                    while letting it shrink naturally on mobile */}
                <div className="mx-auto w-full max-w-[320px] sm:max-w-sm">
                  <Doughnut
                    data={subjectChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: true,
                      aspectRatio: 1.4,
                      plugins: {
                        legend: {
                          position: 'bottom',
                          labels: {
                            boxWidth: 10,
                            padding: 10,
                            font: { size: 11 },
                          },
                        },
                        tooltip: {
                          backgroundColor: 'rgba(0,0,0,0.8)',
                          padding: 10,
                          titleFont: { size: 12 },
                          bodyFont: { size: 11 },
                          callbacks: {
                            label: (ctx) => ` ${ctx.label}: ${ctx.parsed.toLocaleString()}`,
                          },
                        },
                      },
                    }}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-sm overflow-hidden">
              <CardHeader className="pb-2 sm:pb-4">
                <CardTitle className="text-base sm:text-lg text-slate-800">Grade Distribution</CardTitle>
                <CardDescription className="text-xs sm:text-sm">Distribution of evidence across grades</CardDescription>
              </CardHeader>
              <CardContent className="p-3 sm:p-6">
                <div className="mx-auto w-full max-w-[320px] sm:max-w-sm">
                  <Doughnut
                    data={gradeChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: true,
                      aspectRatio: 1.4,
                      plugins: {
                        legend: {
                          position: 'bottom',
                          labels: {
                            boxWidth: 10,
                            padding: 10,
                            font: { size: 11 },
                          },
                        },
                        tooltip: {
                          backgroundColor: 'rgba(0,0,0,0.8)',
                          padding: 10,
                          titleFont: { size: 12 },
                          bodyFont: { size: 11 },
                          callbacks: {
                            label: (ctx) => ` ${ctx.label}: ${ctx.parsed.toLocaleString()}`,
                          },
                        },
                      },
                    }}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Quality & Relevance Analysis Section */}
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg text-slate-800">Quality & Relevance Analysis</CardTitle>
            <CardDescription>Comprehensive relevance breakdown</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-3 font-semibold">Relevant</th>
                    <th className="px-2 py-3 font-semibold">Partially Relevant</th>
                    <th className="px-2 py-3 font-semibold">Irrelevant</th>
                    <th className="px-2 py-3 font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr className="hover:bg-slate-50 transition-colors">
                    <td className="px-2 py-3 text-sm text-slate-800 font-medium">{formatNumber(reportData.relevanceCounts.Relevant)}</td>
                    <td className="px-2 py-3 text-sm text-slate-800 font-medium">{formatNumber(reportData.relevanceCounts['Partially Relevant'])}</td>
                    <td className="px-2 py-3 text-sm text-slate-800 font-medium">{formatNumber(reportData.relevanceCounts.Irrelevant)}</td>
                    <td className="px-2 py-3 text-sm text-slate-800 font-medium">{formatNumber(reportData.totalEvidence)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardContent className="p-4 sm:p-6">
            <DistrictRelevanceMap
              selectedState={filters.state}
              stateSummaries={reportData.stateSummaries}
              stateDistrictStats={reportData.stateDistrictStats}
            />
          </CardContent>
        </Card>

        {/* Task Completion Analysis Section */}
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg text-slate-800">Task Completion Analysis</CardTitle>
            <CardDescription>Top tasks by completion count</CardDescription>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            <div className="w-full overflow-x-auto overflow-y-visible">
              <div style={{ 
                height: '560px',
                minWidth: `${Math.max(760, reportData.taskEntries.length * 150)}px`
              }}>
                <Bar
                  data={taskChartData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: {
                      padding: {
                        left: 20,
                        right: 30,
                        top: 15,
                        bottom: 20,
                      },
                    },
                    plugins: {
                      legend: {
                        display: false,
                      },
                      tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.85)',
                        padding: 14,
                        titleFont: {
                          size: 13,
                          weight: '600',
                        },
                        bodyFont: {
                          size: 12,
                        },
                        displayColors: false,
                        callbacks: {
                          title: (context) => context[0]?.label || '',
                          label: (context) => `Completions: ${formatNumber(context.parsed.y)}`,
                        },
                      },
                    },
                    scales: {
                      x: {
                        grid: {
                          display: false,
                        },
                        ticks: {
                          autoSkip: false,
                          maxRotation: 0,
                          minRotation: 0,
                          padding: 8,
                          font: {
                            size: 10,
                          },
                          callback: function callback(value) {
                            return wrapChartLabel(this.getLabelForValue(value));
                          },
                        },
                        title: {
                          display: true,
                          text: 'Tasks',
                          font: {
                            size: 12,
                            weight: '500',
                          },
                          padding: {
                            top: 14,
                          },
                        },
                      },
                      y: {
                        beginAtZero: true,
                        grid: {
                          color: 'rgba(0, 0, 0, 0.05)',
                        },
                        ticks: {
                          font: {
                            size: 11,
                          },
                          precision: 0,
                        },
                        title: {
                          display: true,
                          text: 'Number of Completions',
                          font: {
                            size: 12,
                            weight: '500',
                          },
                        },
                      },
                    },
                  }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg text-slate-800">District-wise Submission Quality & Insights</CardTitle>
            <CardDescription>Hierarchical view of evidence quality across districts, blocks, and schools</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-3 font-semibold">District / Block / School</th>
                    <th className="px-2 py-3 font-semibold">Total</th>
                    <th className="px-2 py-3 font-semibold">Relevant</th>
                    <th className="px-2 py-3 font-semibold">Partially Relevant</th>
                    <th className="px-2 py-3 font-semibold">Irrelevant</th>
                    <th className="px-2 py-3 font-semibold">% Relevant</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportData.sortedDistricts.map(([district, districtData]) => {
                    const districtScore = relScore(
                      districtData.Relevant,
                      districtData['Partially Relevant'],
                      districtData.total
                    );
                    const districtExpanded = expandedDistricts.has(district);

                    return (
                      <Fragment key={district}>
                        <tr 
                          className="cursor-pointer hover:bg-slate-50 transition-colors"
                          onClick={() => toggleDistrict(district)}
                        >
                          <td className="px-2 py-3 text-sm font-semibold text-slate-800">
                            <div className="flex items-center gap-2">
                              {districtExpanded ? <ChevronDown className="h-4 w-4 text-blue-600" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                              {district}
                            </div>
                          </td>
                          <td className="px-2 py-3 text-sm text-slate-700">{formatNumber(districtData.total)}</td>
                          <td className="px-2 py-3 text-sm text-emerald-700 font-medium">{formatNumber(districtData.Relevant)}</td>
                          <td className="px-2 py-3 text-sm text-amber-700 font-medium">{formatNumber(districtData['Partially Relevant'])}</td>
                          <td className="px-2 py-3 text-sm text-rose-700 font-medium">{formatNumber(districtData.Irrelevant)}</td>
                          <td className="px-2 py-3 text-sm">
                            <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 border border-blue-200">
                              {districtScore.toFixed(1)}%
                            </span>
                          </td>
                        </tr>

                        {districtExpanded && Object.entries(districtData.blocks).map(([block, blockData]) => {
                          const blockKey = `${district}||${block}`;
                          const blockExpanded = expandedBlocks.has(blockKey);
                          const blockScore = relScore(
                            blockData.Relevant,
                            blockData['Partially Relevant'],
                            blockData.total
                          );

                          return (
                            <Fragment key={blockKey}>
                              <tr 
                                className="cursor-pointer hover:bg-slate-50 transition-colors bg-slate-50/50"
                                onClick={() => toggleBlock(district, block)}
                              >
                                <td className="px-2 py-3 text-sm font-medium text-slate-700 pl-8">
                                  <div className="flex items-center gap-2">
                                    {blockExpanded ? <ChevronDown className="h-4 w-4 text-blue-600" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                                    {block}
                                  </div>
                                </td>
                                <td className="px-2 py-3 text-sm text-slate-600">{formatNumber(blockData.total)}</td>
                                <td className="px-2 py-3 text-sm text-emerald-600">{formatNumber(blockData.Relevant)}</td>
                                <td className="px-2 py-3 text-sm text-amber-600">{formatNumber(blockData['Partially Relevant'])}</td>
                                <td className="px-2 py-3 text-sm text-rose-600">{formatNumber(blockData.Irrelevant)}</td>
                                <td className="px-2 py-3 text-sm">
                                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                                    {blockScore.toFixed(1)}%
                                  </span>
                                </td>
                              </tr>

                              {blockExpanded && Object.entries(blockData.schools).map(([school, schoolData]) => {
                                const schoolScore = relScore(
                                  schoolData.Relevant,
                                  schoolData['Partially Relevant'],
                                  schoolData.total
                                );
                                return (
                                  <tr key={`${blockKey}||${school}`} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-2 py-3 text-sm text-slate-600 pl-14">{school}</td>
                                    <td className="px-2 py-3 text-sm text-slate-600">{formatNumber(schoolData.total)}</td>
                                    <td className="px-2 py-3 text-sm text-emerald-600">{formatNumber(schoolData.Relevant)}</td>
                                    <td className="px-2 py-3 text-sm text-amber-600">{formatNumber(schoolData['Partially Relevant'])}</td>
                                    <td className="px-2 py-3 text-sm text-rose-600">{formatNumber(schoolData.Irrelevant)}</td>
                                    <td className="px-2 py-3 text-sm">
                                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                                        {schoolScore.toFixed(1)}%
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {(!ENV.HIERARCHY_STATE_LOCK ||
          (filters.state &&
            filters.state.toLowerCase() === ENV.HIERARCHY_STATE_LOCK.toLowerCase())) && (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-lg text-slate-800">Top Relevance Hierarchy</CardTitle>
                <CardDescription>
                  Top performing Districts → Blocks → Schools → Teachers ranked by Relevance %
                </CardDescription>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <span className="font-medium">Show top:</span>
                <select
                  value={topHierarchyCount}
                  onChange={(event) => {
                    const nextTopN = Number.parseInt(event.target.value, 10) || 5;
                    setTopHierarchyCount(nextTopN);
                    setExpandedTopDistricts(new Set());
                    setExpandedTopBlocks(new Set());
                    setExpandedTopSchools(new Set());
                  }}
                  className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
                >
                  <option value={5}>Top 5</option>
                  <option value={10}>Top 10</option>
                  <option value={15}>Top 15</option>
                </select>
              </label>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-3 font-semibold">District / Block / School / Teacher</th>
                    <th className="px-2 py-3 font-semibold">Total Evidence</th>
                    <th className="px-2 py-3 font-semibold">% Relevant</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {hierarchyFilteredData.length > 0 ? (
                    hierarchyFilteredData.map((district, districtIndex) => {
                      const districtKey = district.district;
                      const districtExpanded = expandedTopDistricts.has(districtKey);

                      return (
                        <Fragment key={districtKey}>
                          <tr
                            className="cursor-pointer hover:bg-slate-50 transition-colors"
                            onClick={() => toggleTopDistrict(districtKey)}
                          >
                            <td className="px-2 py-3 text-sm font-semibold text-slate-800">
                              <div className="flex items-center gap-2">
                                {districtExpanded ? <ChevronDown className="h-4 w-4 text-blue-600" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold mr-1">
                                  {districtIndex + 1}
                                </span>
                                {district.district}
                              </div>
                            </td>
                            <td className="px-2 py-3 text-sm text-slate-700">{formatNumber(district.total)}</td>
                            <td className="px-2 py-3 text-sm">
                              <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 border border-emerald-200">
                                {district.relevancePercent.toFixed(1)}%
                              </span>
                            </td>
                          </tr>

                          {districtExpanded &&
                            district.blocks.map((block, blockIndex) => {
                              const blockKey = `${districtKey}||${block.block}`;
                              const blockExpanded = expandedTopBlocks.has(blockKey);

                              return (
                                <Fragment key={blockKey}>
                                  <tr
                                    className="cursor-pointer hover:bg-slate-50 transition-colors bg-slate-50/50"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      toggleTopBlock(districtKey, block.block);
                                    }}
                                  >
                                    <td className="px-2 py-3 text-sm font-medium text-slate-700 pl-8">
                                      <div className="flex items-center gap-2">
                                        {blockExpanded ? <ChevronDown className="h-4 w-4 text-blue-600" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-200 text-slate-700 text-xs font-semibold mr-1">
                                          {blockIndex + 1}
                                        </span>
                                        {block.block}
                                      </div>
                                    </td>
                                    <td className="px-2 py-3 text-sm text-slate-600">{formatNumber(block.total)}</td>
                                    <td className="px-2 py-3 text-sm">
                                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                                        {block.relevancePercent.toFixed(1)}%
                                      </span>
                                    </td>
                                  </tr>

                                  {blockExpanded &&
                                    block.schools.map((school, schoolIndex) => {
                                      const schoolKey = `${districtKey}||${block.block}||${school.school}`;
                                      const schoolExpanded = expandedTopSchools.has(schoolKey);

                                      return (
                                        <Fragment key={schoolKey}>
                                          <tr
                                            className="cursor-pointer hover:bg-slate-50 transition-colors"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              toggleTopSchool(districtKey, block.block, school.school);
                                            }}
                                          >
                                            <td className="px-2 py-3 text-sm text-slate-600 pl-14">
                                              <div className="flex items-center gap-2">
                                                {schoolExpanded ? <ChevronDown className="h-4 w-4 text-blue-600" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                                                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold mr-1">
                                                  {schoolIndex + 1}
                                                </span>
                                                {school.school}
                                              </div>
                                            </td>
                                            <td className="px-2 py-3 text-sm text-slate-600">{formatNumber(school.total)}</td>
                                            <td className="px-2 py-3 text-sm">
                                              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                                                {school.relevancePercent.toFixed(1)}%
                                              </span>
                                            </td>
                                          </tr>

                                          {schoolExpanded &&
                                            school.teachers.map((teacher, teacherIndex) => (
                                              <tr
                                                key={`${schoolKey}||${teacher.teacher}`}
                                                className="hover:bg-slate-50 transition-colors"
                                              >
                                                <td className="px-2 py-3 text-sm text-slate-600 pl-20">
                                                  <div className="flex items-center gap-2">
                                                    <Users className="h-3.5 w-3.5 text-slate-400" />
                                                    <span className="text-xs font-semibold text-slate-500 mr-1">#{teacherIndex + 1}</span>
                                                    <code className="text-xs bg-slate-100 px-2 py-0.5 rounded">{teacher.teacher}</code>
                                                  </div>
                                                </td>
                                                <td className="px-2 py-3 text-sm text-slate-600">{formatNumber(teacher.total)}</td>
                                                <td className="px-2 py-3 text-sm">
                                                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                                                    {teacher.relevancePercent.toFixed(1)}%
                                                  </span>
                                                </td>
                                              </tr>
                                            ))}
                                        </Fragment>
                                      );
                                    })}
                                </Fragment>
                              );
                            })}
                        </Fragment>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={3} className="px-2 py-8 text-center text-sm text-slate-500">
                        No hierarchy insights available for selected filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
        )}

        {hasRequiredEnrollmentColumns && reportData.hasEnrollmentData && (
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg text-slate-800">Enrollment Analytics</CardTitle>
              <CardDescription>Review enrollment trends, growth patterns, and district-level comparisons</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h4 className="text-base font-semibold text-slate-800 mb-3">Enrollment Comparison</h4>
                <p className="text-sm text-slate-600 mb-4">Compare 2024 and 2025 totals along with district-wise distribution.</p>

                <section className="grid gap-4 md:grid-cols-3 mb-6">
                  <Card className="border-slate-200 shadow-sm">
                    <CardContent className="p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Enrollment 2024</p>
                      <p className="mt-2 text-2xl font-semibold text-slate-800">{formatNumber(enrollmentSummary.enrollment2024)}</p>
                    </CardContent>
                  </Card>

                  <Card className="border-slate-200 shadow-sm">
                    <CardContent className="p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Enrollment 2025</p>
                      <p className="mt-2 text-2xl font-semibold text-slate-800">{formatNumber(enrollmentSummary.enrollment2025)}</p>
                    </CardContent>
                  </Card>

                  <Card className="border-slate-200 shadow-sm">
                    <CardContent className="p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Districts with Data</p>
                      <p className="mt-2 text-2xl font-semibold text-slate-800">{formatNumber(enrollmentSummary.districtCount)}</p>
                    </CardContent>
                  </Card>
                </section>

                <Card className="border-slate-200 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base text-slate-800">Enrollment 2024 vs 2025 by District</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[400px]">
                      <Bar
                        data={enrollmentComparisonChartData}
                        options={{ responsive: true, maintainAspectRatio: false }}
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div>
                <h4 className="text-base font-semibold text-slate-800 mb-3">Enrollment Growth</h4>
                <p className="text-sm text-slate-600 mb-4">Inspect district-level growth percentage between 2024 and 2025.</p>

                <Card className="border-slate-200 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base text-slate-800">Enrollment Growth (%) by District</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[400px]">
                      <Bar
                        data={enrollmentGrowthChartData}
                        options={{ responsive: true, maintainAspectRatio: false }}
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div>
                <h4 className="text-base font-semibold text-slate-800 mb-3">District Data Table</h4>
                <p className="text-sm text-slate-600 mb-4">View district totals, differences, and growth values in tabular form.</p>

                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-2 py-3 font-semibold">District</th>
                        <th className="px-2 py-3 font-semibold">Enrollment 2024</th>
                        <th className="px-2 py-3 font-semibold">Enrollment 2025</th>
                        <th className="px-2 py-3 font-semibold">Difference</th>
                        <th className="px-2 py-3 font-semibold">Growth %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {enrollmentDistrictRowsSorted.map((row) => (
                        <tr key={row.district} className="hover:bg-slate-50 transition-colors">
                          <td className="px-2 py-3 text-sm font-medium text-slate-800">{row.district}</td>
                          <td className="px-2 py-3 text-sm text-slate-700">{formatNumber(row.enrollment2024)}</td>
                          <td className="px-2 py-3 text-sm text-slate-700">{formatNumber(row.enrollment2025)}</td>
                          <td className="px-2 py-3 text-sm text-slate-700">{formatNumber(row.difference)}</td>
                          <td className="px-2 py-3 text-sm">
                            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                              row.growth >= 0 
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                                : 'bg-rose-50 text-rose-700 border border-rose-200'
                            }`}>
                              {row.growth.toFixed(2)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {reportData.hasCustomTasks && (
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg text-slate-800">User-Owned Tasks Analysis</CardTitle>
              <CardDescription>Analysis of custom user-created tasks and their relevance distribution</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-2 py-3 font-semibold">District</th>
                      <th className="px-2 py-3 font-semibold">Total Custom Tasks</th>
                      <th className="px-2 py-3 font-semibold">Relevant</th>
                      <th className="px-2 py-3 font-semibold">Partially Relevant</th>
                      <th className="px-2 py-3 font-semibold">Irrelevant</th>
                      <th className="px-2 py-3 font-semibold">% Relevant</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Object.entries(reportData.customTaskHierarchy).map(([district, districtData]) => {
                      const score = relScore(
                        districtData.Relevant,
                        districtData['Partially Relevant'],
                        districtData.total
                      );
                      return (
                        <tr key={district} className="hover:bg-slate-50 transition-colors">
                          <td className="px-2 py-3 text-sm font-medium text-slate-800">{district}</td>
                          <td className="px-2 py-3 text-sm text-slate-700">{formatNumber(districtData.total)}</td>
                          <td className="px-2 py-3 text-sm text-emerald-700 font-medium">{formatNumber(districtData.Relevant)}</td>
                          <td className="px-2 py-3 text-sm text-amber-700 font-medium">{formatNumber(districtData['Partially Relevant'])}</td>
                          <td className="px-2 py-3 text-sm text-rose-700 font-medium">{formatNumber(districtData.Irrelevant)}</td>
                          <td className="px-2 py-3 text-sm">
                            <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 border border-blue-200">
                              {score.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

StandardReportRenderer.propTypes = {
  csvText: PropTypes.string,
  parsedRows: PropTypes.array,
  reportApiData: PropTypes.object,
  onFilterChange: PropTypes.func,
  sourceLabel: PropTypes.string,
};

export default StandardReportRenderer;
