import { useQuery } from '@tanstack/react-query';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { useI18n } from '../app/I18nContext';
import { useApplyServerLocaleSetting } from '../app/useApplyServerLocaleSetting';
import {
  fetchLatency,
  fetchHomepage,
  fetchPublicDayContext,
  fetchPublicIncidentDetail,
  fetchPublicMonitorOutages,
} from '../api/client';
import type {
  Incident,
  IncidentSummary,
  Outage,
  PublicHomepageResponse,
} from '../api/types';
import { DayDowntimeModal } from '../components/DayDowntimeModal';
import { Markdown } from '../components/Markdown';
import { incidentImpactLabel, incidentStatusLabel } from '../i18n/labels';
import { formatDateTime, getBrowserTimeZone } from '../utils/datetime';
import { Badge, Card, MODAL_OVERLAY_CLASS, MODAL_PANEL_CLASS } from '../components/ui';

type BannerStatus = PublicHomepageResponse['banner']['status'];
type IncidentCardData = IncidentSummary | Incident;

const LatencyChart = lazy(async () => {
  const mod = await import('../components/LatencyChart');
  return { default: mod.LatencyChart };
});

function getBannerConfig(status: BannerStatus, t: ReturnType<typeof useI18n>['t']) {
  const configs = {
    operational: {
      iconBg: 'bg-emerald-500',
      text: t('status_page.all_systems_operational'),
      icon: '✓',
    },
    partial_outage: {
      iconBg: 'bg-amber-500',
      text: t('status_page.partial_system_outage'),
      icon: '!',
    },
    major_outage: {
      iconBg: 'bg-red-500',
      text: t('status_page.major_system_outage'),
      icon: '✕',
    },
    maintenance: {
      iconBg: 'bg-blue-500',
      text: t('status_page.scheduled_maintenance'),
      icon: '⚙',
    },
    unknown: {
      iconBg: 'bg-slate-500',
      text: t('status_page.status_unknown'),
      icon: '?',
    },
  };
  return configs[status] || configs.unknown;
}

function monitorGroupLabel(groupName: string | null | undefined, ungroupedLabel: string): string {
  const trimmed = groupName?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : ungroupedLabel;
}

function getLatencyText(monitor: PublicHomepageResponse['monitors'][number]) {
  const values = (monitor.heartbeat_strip?.latency_ms ?? []).filter(
    (value): value is number => value != null,
  );
  if (values.length === 0) {
    return '—';
  }
  return `${Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)}ms`;
}

function MonitorDetail({ monitorId, onClose }: { monitorId: number; onClose: () => void }) {
  const { t } = useI18n();
  const { data, isLoading } = useQuery({
    queryKey: ['latency', monitorId],
    queryFn: () => fetchLatency(monitorId),
  });

  return (
    <div className={MODAL_OVERLAY_CLASS} onClick={onClose}>
      <div
        className={`${MODAL_PANEL_CLASS} sm:max-w-2xl p-5 sm:p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            {data?.monitor.name ?? t('common.loading')}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {isLoading ? (
          <div className="h-[200px] flex items-center justify-center text-slate-500 dark:text-slate-400">
            {t('status_page.loading_chart')}
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:gap-6 mb-6">
              <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg px-3 sm:px-4 py-2.5 sm:py-3">
                <div className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
                  {t('status_page.avg_latency')}
                </div>
                <div className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {data.avg_latency_ms ?? '-'}ms
                </div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg px-3 sm:px-4 py-2.5 sm:py-3">
                <div className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
                  {t('status_page.p95_latency')}
                </div>
                <div className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {data.p95_latency_ms ?? '-'}ms
                </div>
              </div>
            </div>
            <Suspense
              fallback={
                <div className="h-[200px] flex items-center justify-center text-slate-500 dark:text-slate-400">
                  {t('status_page.loading_chart')}
                </div>
              }
            >
              <LatencyChart points={data.points} />
            </Suspense>
          </>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-slate-500 dark:text-slate-400">
            {t('status_page.failed_load_data')}
          </div>
        )}
      </div>
    </div>
  );
}

function IncidentCard({
  incident,
  onClick,
  timeZone,
}: {
  incident: IncidentCardData;
  onClick: () => void;
  timeZone: string;
}) {
  const { locale, t } = useI18n();

  return (
    <button
      onClick={onClick}
      className="ui-panel ui-panel-hover w-full rounded-xl p-3.5 sm:p-5 text-left"
    >
      <div className="flex items-start justify-between gap-4 mb-2">
        <h4 className="font-semibold text-slate-900 dark:text-slate-100">{incident.title}</h4>
        <Badge
          variant={
            incident.impact === 'critical'
              ? 'down'
              : incident.impact === 'major'
                ? 'down'
                : 'paused'
          }
        >
          {incidentImpactLabel(incident.impact, t)}
        </Badge>
      </div>
      <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400 mb-3">
        <Badge variant="info">{incidentStatusLabel(incident.status, t)}</Badge>
        <span>{formatDateTime(incident.started_at, timeZone, locale)}</span>
      </div>
      {incident.message && (
        <p className="text-sm text-slate-600 dark:text-slate-300 line-clamp-2">
          {incident.message}
        </p>
      )}
    </button>
  );
}

function IncidentDetail({
  incident,
  monitorNames,
  onClose,
  timeZone,
  isLoadingDetails,
  hasDetailsError,
}: {
  incident: Incident;
  monitorNames: Map<number, string>;
  onClose: () => void;
  timeZone: string;
  isLoadingDetails: boolean;
  hasDetailsError: boolean;
}) {
  const { locale, t } = useI18n();

  return (
    <div className={MODAL_OVERLAY_CLASS} onClick={onClose}>
      <div
        className={`${MODAL_PANEL_CLASS} sm:max-w-2xl p-5 sm:p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-4 sm:mb-6">
          <div>
            <h2 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">
              {incident.title}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  incident.impact === 'critical' || incident.impact === 'major' ? 'down' : 'paused'
                }
              >
                {incidentImpactLabel(incident.impact, t)}
              </Badge>
              <Badge variant="info">{incidentStatusLabel(incident.status, t)}</Badge>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="space-y-2 sm:space-y-3 text-sm text-slate-600 dark:text-slate-300 mb-4 sm:mb-6 pb-4 sm:pb-6 border-b border-slate-100 dark:border-slate-700">
          <div className="flex flex-col sm:flex-row sm:gap-2">
            <span className="text-slate-400 dark:text-slate-500 sm:w-20 text-xs sm:text-sm">
              {t('common.affected')}:
            </span>
            <span className="text-sm">
              {incident.monitor_ids.length > 0
                ? incident.monitor_ids.map((id) => monitorNames.get(id) ?? `#${id}`).join(', ')
                : isLoadingDetails
                  ? t('common.loading')
                  : hasDetailsError
                    ? t('status_page.failed_load_data')
                    : '-'}
            </span>
          </div>
          <div className="flex flex-col sm:flex-row sm:gap-2">
            <span className="text-slate-400 dark:text-slate-500 sm:w-20 text-xs sm:text-sm">
              {t('common.started')}:
            </span>
            <span className="text-sm">{formatDateTime(incident.started_at, timeZone, locale)}</span>
          </div>
          {incident.resolved_at && (
            <div className="flex flex-col sm:flex-row sm:gap-2">
              <span className="text-slate-400 dark:text-slate-500 sm:w-20 text-xs sm:text-sm">
                {t('common.resolved')}:
              </span>
              <span className="text-sm">
                {formatDateTime(incident.resolved_at, timeZone, locale)}
              </span>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {incident.message && (
            <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-4">
              <div className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
                {t('status_page.initial_report')}
              </div>
              <Markdown text={incident.message} />
            </div>
          )}

          {incident.updates.map((u) => (
            <div key={u.id} className="border-l-2 border-slate-200 dark:border-slate-600 pl-4">
              <div className="flex items-center gap-3 mb-2">
                {u.status && <Badge variant="info">{incidentStatusLabel(u.status, t)}</Badge>}
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  {formatDateTime(u.created_at, timeZone, locale)}
                </span>
              </div>
              <Markdown text={u.message} />
            </div>
          ))}

          {incident.updates.length === 0 && isLoadingDetails && (
            <div className="text-sm text-slate-500 dark:text-slate-400">
              {t('common.loading')}
            </div>
          )}

          {incident.updates.length === 0 && hasDetailsError && (
            <div className="text-sm text-red-600 dark:text-red-400">
              {t('status_page.failed_load_data')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MonitorListItem({
  monitor,
  onSelect,
}: {
  monitor: PublicHomepageResponse['monitors'][number];
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const isDown = monitor.status === 'down';
  const isMaintenance = monitor.status === 'maintenance';
  const isPaused = monitor.status === 'paused';
  const accentClass = isDown
    ? 'border-red-800/60 bg-red-950/10'
    : isMaintenance
      ? 'border-amber-500/30 bg-amber-500/10'
      : isPaused
        ? 'border-neutral-800 bg-neutral-900/70'
        : 'border-neutral-800 bg-neutral-900/70';
  const dotClass = isDown
    ? 'bg-red-500 shadow-[0_0_0_6px_rgba(248,113,113,0.16)]'
    : isMaintenance
      ? 'bg-amber-500 shadow-[0_0_0_6px_rgba(245,158,11,0.16)]'
      : isPaused
        ? 'bg-neutral-500 shadow-[0_0_0_6px_rgba(115,115,115,0.14)]'
        : 'bg-emerald-500 shadow-[0_0_0_6px_rgba(16,185,129,0.16)]';
  const statusText = isDown ? 'TIMEOUT' : isMaintenance ? 'MAINT' : isPaused ? 'PAUSED' : 'ONLINE';
  const latencyText = getLatencyText(monitor);
  const uptimeBars = (monitor.uptime_day_strip?.uptime_pct_milli ?? []).slice(-10);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-4 border px-4 py-3 text-left transition-colors hover:border-neutral-700 ${accentClass}`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className={`mt-1 h-2.5 w-2.5 rounded-full ${dotClass}`} />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-neutral-100">{monitor.name}</div>
          <div className="mt-1 truncate font-mono text-[11px] uppercase tracking-[0.2em] text-neutral-500">
            {monitor.display_url ?? t('status_page.services')}
          </div>
        </div>
      </div>

      <div className="hidden flex-1 items-end justify-center gap-1 sm:flex">
        {uptimeBars.length > 0
          ? uptimeBars.map((value, index) => {
              const percent = Math.max(16, Math.min(100, (value ?? 0) / 1000));
              const barClass = isDown
                ? 'bg-red-500/80'
                : isMaintenance
                  ? 'bg-amber-500/80'
                  : isPaused
                    ? 'bg-neutral-600'
                    : 'bg-emerald-500/80';
              return (
                <div key={`${monitor.id}-${index}`} className="flex h-8 w-1.5 items-end rounded-full bg-neutral-800">
                  <div className={`w-full rounded-full ${barClass}`} style={{ height: `${percent}%` }} />
                </div>
              );
            })
          : Array.from({ length: 8 }).map((_, index) => (
              <div key={`${monitor.id}-placeholder-${index}`} className="h-8 w-1.5 rounded-full bg-neutral-800" />
            ))}
      </div>

      <div className="text-right">
        <div className="font-mono text-sm font-medium text-neutral-100">{latencyText}</div>
        <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-500">{statusText}</div>
      </div>
    </button>
  );
}

function StatusPageSkeleton() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/95 backdrop-blur dark:border-slate-700/80 dark:bg-slate-800/95">
        <div className="mx-auto max-w-5xl px-4 py-3 sm:px-6 sm:py-4 lg:px-8 flex justify-between items-center">
          <div className="ui-skeleton h-6 w-28 rounded" />
          <div className="ui-skeleton h-8 w-20 rounded-full" />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-4 sm:px-6 sm:py-7 lg:px-8">
        <div className="ui-skeleton h-16 sm:h-24 rounded-2xl mb-6 sm:mb-8" />

        <section>
          <div className="h-6 w-24 bg-slate-200 dark:bg-slate-700 rounded mb-4" />
          <div className="grid gap-2.5 sm:gap-3 md:grid-cols-2">
            {Array.from({ length: 6 }).map((_, idx) => (
              <Card key={idx} className="p-4 sm:p-5">
                <div className="mb-2.5 flex items-start justify-between">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="h-3 w-3 rounded-full bg-slate-200 dark:bg-slate-700" />
                    <div className="min-w-0">
                      <div className="mb-1.5 h-4 w-32 rounded bg-slate-200 dark:bg-slate-700" />
                      <div className="h-3 w-12 rounded bg-slate-200 dark:bg-slate-700" />
                    </div>
                  </div>
                  <div className="h-5 w-14 rounded-full bg-slate-200 dark:bg-slate-700" />
                </div>
                <div className="mb-2.5 h-5 rounded bg-slate-200 dark:bg-slate-700" />
                <div className="flex justify-between">
                  <div className="h-3.5 w-20 rounded bg-slate-200 dark:bg-slate-700" />
                  <div className="h-3.5 w-24 rounded bg-slate-200 dark:bg-slate-700" />
                </div>
              </Card>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

export function StatusPage() {
  const { locale, t } = useI18n();
  const [selectedMonitorId, setSelectedMonitorId] = useState<number | null>(null);
  const [selectedIncidentRequest, setSelectedIncidentRequest] = useState<{
    incident: IncidentCardData;
    resolvedOnly: boolean;
  } | null>(null);
  const [selectedDay, setSelectedDay] = useState<{ monitorId: number; dayStartAt: number } | null>(
    null,
  );

  const homepageQuery = useQuery({
    queryKey: ['homepage'],
    queryFn: fetchHomepage,
    staleTime: 30_000,
    refetchInterval: 30_000,
    // Keep a recent injected homepage bootstrap stable through the current monitor window.
    // Immediate mount refetch can temporarily downgrade recent artifact data to UNKNOWN
    // before the next scheduled check has refreshed monitor_state/snapshots.
    refetchOnMount: (query) => {
      const data = query.state.data as PublicHomepageResponse | undefined;
      if (!data || typeof data.generated_at !== 'number') {
        return true;
      }
      return Date.now() - data.generated_at * 1000 > 60_000;
    },
  });

  const derivedTitle = homepageQuery.data?.site_title || 'Uptimer';
  const derivedTimeZone = getBrowserTimeZone() || homepageQuery.data?.site_timezone || 'UTC';

  useApplyServerLocaleSetting(homepageQuery.data?.site_locale);

  useEffect(() => {
    document.title = derivedTitle;
  }, [derivedTitle]);

  const outagesQuery = useQuery({
    queryKey: ['public-monitor-outages', selectedDay?.monitorId, selectedDay?.dayStartAt],
    queryFn: () =>
      fetchPublicMonitorOutages(selectedDay?.monitorId as number, { range: '30d', limit: 200 }),
    enabled: selectedDay !== null,
  });

  const dayContextQuery = useQuery({
    queryKey: ['public-day-context', selectedDay?.monitorId, selectedDay?.dayStartAt],
    queryFn: () =>
      fetchPublicDayContext(selectedDay?.monitorId as number, selectedDay?.dayStartAt as number),
    enabled: selectedDay !== null,
  });

  const currentDayOutages = useMemo((): Outage[] => {
    if (!selectedDay) return [];
    const all = outagesQuery.data?.outages ?? [];
    const dayStart = selectedDay.dayStartAt;
    const dayEnd = dayStart + 86400;
    return all.filter((o) => o.started_at < dayEnd && (o.ended_at ?? dayEnd) > dayStart);
  }, [outagesQuery.data?.outages, selectedDay]);

  const incidentDetailQuery = useQuery({
    queryKey: [
      'public-incident-detail',
      selectedIncidentRequest?.incident.id,
      selectedIncidentRequest?.resolvedOnly,
    ],
    queryFn: () => {
      const resolvedOnly = selectedIncidentRequest?.resolvedOnly;
      return fetchPublicIncidentDetail(
        selectedIncidentRequest?.incident.id as number,
        resolvedOnly === undefined ? {} : { resolvedOnly },
      );
    },
    enabled: selectedIncidentRequest !== null,
  });

  const selectedIncident =
    incidentDetailQuery.data ??
    (selectedIncidentRequest
      ? {
          ...selectedIncidentRequest.incident,
          monitor_ids: [],
          updates: [],
        }
      : null);

  const resolvedIncidentPreview = homepageQuery.data?.resolved_incident_preview ?? null;
  const maintenanceHistoryPreview = homepageQuery.data?.maintenance_history_preview ?? null;

  const groupedMonitors = useMemo(() => {
    const groups = new Map<string, PublicHomepageResponse['monitors']>();
    for (const monitor of homepageQuery.data?.monitors ?? []) {
      const key = monitorGroupLabel(monitor.group_name, t('status_page.group_ungrouped'));
      const list = groups.get(key) ?? [];
      list.push(monitor);
      groups.set(key, list);
    }

    return [...groups.entries()].map(([name, monitors]) => ({ name, monitors }));
  }, [homepageQuery.data?.monitors, t]);
  const monitorNames = useMemo(
    () => new Map((homepageQuery.data?.monitors ?? []).map((m) => [m.id, m.name] as const)),
    [homepageQuery.data?.monitors],
  );

  if (homepageQuery.isLoading && !homepageQuery.data) {
    return <StatusPageSkeleton />;
  }

  if (!homepageQuery.data) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">
            {t('status_page.unable_to_load_status')}
          </h2>
          <p className="text-slate-500 dark:text-slate-400">{t('status_page.check_connection')}</p>
        </div>
      </div>
    );
  }

  const data = homepageQuery.data;
  const bannerConfig = getBannerConfig(data.banner.status, t);
  const activeIncidents = data.active_incidents;

  const siteTitle = derivedTitle;
  const timeZone = derivedTimeZone;
  const overviewTitle =
    data.banner.status === 'major_outage' || data.banner.status === 'partial_outage'
      ? 'Systems Incident Reported.'
      : 'All Systems Operational.';
  const overviewDescription =
    data.banner.status === 'major_outage'
      ? 'Critical signals are active across the monitored surface. Updates are being collected and surfaced as the incident evolves.'
      : data.banner.status === 'partial_outage'
        ? 'A limited set of monitors is under strain, and the current response is being watched closely.'
        : data.banner.status === 'maintenance'
          ? 'A planned maintenance window is in place and the network remains under active observation.'
          : 'Every monitored endpoint is returning healthy responses, and the global surface is staying within expected thresholds.';
  const globalUptime =
    data.monitors.length > 0
      ? `${(
          data.monitors.reduce((total, monitor) => total + (monitor.uptime_30d?.uptime_pct ?? 0), 0) /
          data.monitors.length
        ).toFixed(2)}%`
      : '—';
  const avgLatency =
    data.monitors.length > 0
      ? (() => {
          const values = data.monitors.flatMap((monitor) =>
            (monitor.heartbeat_strip?.latency_ms ?? []).filter(
              (value): value is number => value != null,
            ),
          );
          return values.length > 0
            ? `${Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)}ms`
            : '—';
        })()
      : '—';

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="sticky top-0 z-20 border-b border-neutral-800/90 bg-neutral-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-end justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.4em] text-neutral-500">
              AUTOMATIC INFRASTRUCTURE MONITOR
            </p>
            <Link to="/" className="mt-1 block text-2xl font-semibold uppercase tracking-[0.35em] text-neutral-100 sm:text-3xl">
              {siteTitle.toUpperCase()} //
            </Link>
          </div>
          <div className="flex items-center gap-2 border border-neutral-800 bg-neutral-900/80 px-3 py-2 text-[10px] uppercase tracking-[0.35em] text-neutral-400">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            STATUS: ONLINE
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="relative overflow-hidden border border-neutral-800 bg-neutral-900/70 p-6 sm:p-8">
            <div className="absolute left-0 top-0 h-16 w-1 bg-emerald-500" />
            <div className="absolute right-0 top-0 h-px w-24 bg-neutral-800" />
            <p className="text-[10px] uppercase tracking-[0.35em] text-neutral-500">GLOBAL OVERVIEW</p>
            <h2 className="mt-5 text-3xl font-semibold leading-[0.95] tracking-tight text-neutral-50 sm:text-4xl">
              {overviewTitle}
            </h2>
            <p className="mt-4 max-w-lg text-sm leading-7 text-neutral-400">{overviewDescription}</p>

            <div className="mt-8 border-t border-neutral-800 pt-5">
              <div className="grid gap-6 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.35em] text-neutral-500">GLOBAL UPTIME</p>
                  <p className="mt-2 font-mono text-2xl text-neutral-100">{globalUptime}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.35em] text-neutral-500">AVG LATENCY</p>
                  <p className="mt-2 font-mono text-2xl text-neutral-100">{avgLatency}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {groupedMonitors.map((group) => (
              <div key={group.name} className="border border-neutral-800 bg-neutral-900/70 p-3">
                <div className="mb-3 flex items-center justify-between border-b border-neutral-800 pb-2">
                  <h3 className="text-[10px] uppercase tracking-[0.35em] text-neutral-500">
                    {group.name}
                  </h3>
                  <span className="font-mono text-[11px] text-neutral-500">{group.monitors.length}</span>
                </div>
                <div className="space-y-2">
                  {group.monitors.map((monitor) => (
                    <MonitorListItem
                      key={monitor.id}
                      monitor={monitor}
                      onSelect={() => setSelectedMonitorId(monitor.id)}
                    />
                  ))}
                </div>
              </div>
            ))}

            {data.monitors.length === 0 && (
              <div className="border border-neutral-800 bg-neutral-900/70 p-6 text-center text-sm text-neutral-500">
                {t('status_page.no_monitors')}
              </div>
            )}
          </div>
        </section>

        {(data.maintenance_windows.active.length > 0 ||
          data.maintenance_windows.upcoming.length > 0) && (
          <section className="mt-6 border-t border-neutral-800 pt-5">
            <h3 className="text-[10px] uppercase tracking-[0.35em] text-neutral-500 mb-3">
              {t('status_page.scheduled_maintenance')}
            </h3>
            <div className="space-y-3">
              {data.maintenance_windows.active.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-[0.35em] text-neutral-600 mb-2">
                    {t('common.active')}
                  </div>
                  <div className="space-y-2">
                    {data.maintenance_windows.active.map((w) => (
                      <div
                        key={w.id}
                        className="border border-blue-500/40 bg-blue-950/20 px-4 py-3"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-2">
                          <span className="text-sm font-medium text-neutral-100">{w.title}</span>
                          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-neutral-500 whitespace-nowrap">
                            {formatDateTime(w.starts_at, timeZone, locale)} – {formatDateTime(w.ends_at, timeZone, locale)}
                          </span>
                        </div>
                        <div className="text-[11px] text-neutral-400">
                          {t('common.affected')}: {w.monitor_ids.map((id) => monitorNames.get(id) ?? `#${id}`).join(', ')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {data.maintenance_windows.upcoming.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-[0.35em] text-neutral-600 mb-2">
                    {t('common.upcoming')}
                  </div>
                  <div className="space-y-2">
                    {data.maintenance_windows.upcoming.map((w) => (
                      <div
                        key={w.id}
                        className="border border-neutral-700 bg-neutral-900/50 px-4 py-3"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-2">
                          <span className="text-sm font-medium text-neutral-100">{w.title}</span>
                          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-neutral-500 whitespace-nowrap">
                            {formatDateTime(w.starts_at, timeZone, locale)} – {formatDateTime(w.ends_at, timeZone, locale)}
                          </span>
                        </div>
                        <div className="text-[11px] text-neutral-400">
                          {t('common.affected')}: {w.monitor_ids.map((id) => monitorNames.get(id) ?? `#${id}`).join(', ')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {activeIncidents.length > 0 && (
          <section className="mt-6 border-t border-neutral-800 pt-5">
            <h3 className="text-[10px] uppercase tracking-[0.35em] text-neutral-500 mb-3">
              {t('status_page.active_incidents')}
            </h3>
            <div className="space-y-2">
              {activeIncidents.map((incident) => (
                <button
                  key={incident.id}
                  type="button"
                  onClick={() =>
                    setSelectedIncidentRequest({
                      incident,
                      resolvedOnly: false,
                    })
                  }
                  className="flex w-full items-center justify-between border border-amber-500/40 bg-amber-950/20 px-4 py-3 text-left hover:border-amber-500/60 transition-colors"
                >
                  <span className="text-sm text-neutral-200">{incident.title}</span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-neutral-500">
                    {formatDateTime(incident.started_at, timeZone, locale)}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {resolvedIncidentPreview && (
          <section className="mt-6 border-t border-neutral-800 pt-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[10px] uppercase tracking-[0.35em] text-neutral-500">
                {t('status_page.incident_history')}
              </h3>
              <Link
                to="/history/incidents"
                className="text-[11px] uppercase tracking-[0.2em] text-neutral-600 hover:text-neutral-400 transition-colors"
              >
                {t('common.view_more')}
              </Link>
            </div>
            <button
              type="button"
              onClick={() =>
                setSelectedIncidentRequest({
                  incident: resolvedIncidentPreview,
                  resolvedOnly: true,
                })
              }
              className="flex w-full items-center justify-between border border-neutral-700 bg-neutral-900/50 px-4 py-3 text-left hover:border-neutral-600 transition-colors"
            >
              <span className="text-sm text-neutral-200">{resolvedIncidentPreview.title}</span>
              <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-neutral-500">
                {formatDateTime(resolvedIncidentPreview.started_at, timeZone, locale)}
              </span>
            </button>
          </section>
        )}

        {maintenanceHistoryPreview && (
          <section className="mt-6 border-t border-neutral-800 pt-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[10px] uppercase tracking-[0.35em] text-neutral-500">
                {t('status_page.maintenance_history')}
              </h3>
              <Link
                to="/history/maintenance"
                className="text-[11px] uppercase tracking-[0.2em] text-neutral-600 hover:text-neutral-400 transition-colors"
              >
                {t('common.view_more')}
              </Link>
            </div>
            <div className="border border-neutral-700 bg-neutral-900/50 px-4 py-3">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-2">
                <span className="text-sm font-medium text-neutral-100">{maintenanceHistoryPreview.title}</span>
                <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-neutral-500 whitespace-nowrap">
                  {formatDateTime(maintenanceHistoryPreview.starts_at, timeZone, locale)} – {formatDateTime(maintenanceHistoryPreview.ends_at, timeZone, locale)}
                </span>
              </div>
              <div className="text-[11px] text-neutral-400">
                {t('common.affected')}: {maintenanceHistoryPreview.monitor_ids.map((id) => monitorNames.get(id) ?? `#${id}`).join(', ')}
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="border-t border-neutral-800 bg-neutral-950/70">
        <div className="mx-auto max-w-7xl px-4 py-4 text-left text-[11px] uppercase tracking-[0.35em] text-neutral-600 sm:px-6 lg:px-8">
          POWERED BY CLOUDFLARE WORKERS & D1 // DESIGN BY LXY
        </div>
      </footer>

      {/* Modals */}
      {selectedMonitorId !== null && (
        <MonitorDetail monitorId={selectedMonitorId} onClose={() => setSelectedMonitorId(null)} />
      )}

      {selectedIncident && (
        <IncidentDetail
          incident={selectedIncident}
          monitorNames={monitorNames}
          timeZone={timeZone}
          isLoadingDetails={incidentDetailQuery.isLoading}
          hasDetailsError={incidentDetailQuery.isError}
          onClose={() => setSelectedIncidentRequest(null)}
        />
      )}

      {selectedDay && (
        <DayDowntimeModal
          dayStartAt={selectedDay.dayStartAt}
          outages={currentDayOutages}
          maintenanceWindows={dayContextQuery.data?.maintenance_windows ?? []}
          incidents={dayContextQuery.data?.incidents ?? []}
          timeZone={timeZone}
          onClose={() => setSelectedDay(null)}
        />
      )}

      {selectedDay && outagesQuery.isLoading && (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-slate-900/80 text-white text-sm px-3 py-2 rounded-lg">
            {t('status_page.loading_outages')}
          </div>
        </div>
      )}

      {selectedDay && outagesQuery.isError && (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-red-600/90 text-white text-sm px-3 py-2 rounded-lg">
            {t('status_page.failed_load_outages')}
          </div>
        </div>
      )}

      {selectedDay && dayContextQuery.isLoading && (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-slate-900/80 text-white text-sm px-3 py-2 rounded-lg">
            {t('status_page.loading_context')}
          </div>
        </div>
      )}

      {selectedDay && dayContextQuery.isError && (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-red-600/90 text-white text-sm px-3 py-2 rounded-lg">
            {t('status_page.failed_load_context')}
          </div>
        </div>
      )}
    </div>
  );
}
