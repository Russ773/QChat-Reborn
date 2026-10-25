import { useMemo, useRef, useState } from 'react';
import type { DayStat, HealthInfo } from '@qchat/shared';
import { adminApi } from './adminApi.js';
import { useLoad } from './useLoad.js';

type Metric = 'messages' | 'active' | 'signups' | 'peakOnline';

const METRICS: { key: Metric; title: string; unit: string; color: string; total: 'sum' | 'max' }[] = [
  { key: 'messages', title: 'Messages', unit: 'messages', color: 'var(--blue)', total: 'sum' },
  { key: 'active', title: 'Active members', unit: 'members', color: 'var(--green)', total: 'max' },
  { key: 'signups', title: 'New members', unit: 'sign ups', color: 'var(--gold)', total: 'sum' },
  { key: 'peakOnline', title: 'Busiest moment', unit: 'online at once', color: 'var(--pink)', total: 'max' },
];

const compact = (n: number): string => (n >= 1000 ? `${Math.round(n / 100) / 10}K` : String(n));
const niceMax = (v: number): number => {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * pow) return m * pow;
  return 10 * pow;
};
const fmtDay = (d: string): string => new Date(d + 'T00:00:00Z').toLocaleDateString([], { day: 'numeric', month: 'short', timeZone: 'UTC' });

const W = 600;
const H = 150;
const PAD = { l: 34, r: 12, t: 10, b: 22 };

/** One line chart (with a faint area) for a single measure. Hover for the exact day; a table view is below. */
function Trend({ days, metric }: { days: DayStat[]; metric: (typeof METRICS)[number] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const box = useRef<SVGSVGElement | null>(null);

  const values = days.map((d) => d[metric.key]);
  const total = metric.total === 'sum' ? values.reduce((a, b) => a + b, 0) : Math.max(0, ...values);
  const top = niceMax(Math.max(0, ...values));
  const x = (i: number) => PAD.l + (days.length <= 1 ? 0 : (i / (days.length - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);

  const line = useMemo(() => values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '), [values, top]); // eslint-disable-line react-hooks/exhaustive-deps
  const area = `${line} L${x(values.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const ticks = [0, top / 2, top];
  const xLabels = days.length > 1 ? [0, Math.floor((days.length - 1) / 2), days.length - 1] : [0];

  const onMove = (e: React.MouseEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || days.length === 0) return;
    const vx = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((vx - PAD.l) / (W - PAD.l - PAD.r)) * (days.length - 1));
    setHover(Math.max(0, Math.min(days.length - 1, i)));
  };

  const shown = hover ?? days.length - 1;
  const last = days[days.length - 1];

  return (
    <div className="panel chart-card">
      <div className="chart-head">
        <div>
          <div className="panel-title">{metric.title}</div>
          <div className="chart-total">
            {compact(total)} <span>{metric.total === 'sum' ? `${metric.unit} in this period` : `${metric.unit}, best day`}</span>
          </div>
        </div>
        <button type="button" className="mini" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          {table ? 'Chart' : 'Table'}
        </button>
      </div>

      {table ? (
        <div className="chart-table" tabIndex={0} aria-label={`${metric.title} by day`}>
          <table>
            <thead>
              <tr><th>Day</th><th>{metric.title}</th></tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d.day}><td>{fmtDay(d.day)}</td><td>{d[metric.key]}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-wrap">
          <svg
            ref={box}
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`${metric.title}: ${compact(total)} ${metric.unit}. Hover to see each day, or use the Table button.`}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="chart-grid" />
                <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="chart-axis">{compact(Math.round(t * 10) / 10)}</text>
              </g>
            ))}
            {xLabels.map((i, k) => (
              <text key={i} x={x(i)} y={H - 5} textAnchor={k === 0 ? 'start' : k === xLabels.length - 1 && xLabels.length > 1 ? 'end' : 'middle'} className="chart-axis">
                {fmtDay(days[i].day)}
              </text>
            ))}
            <path d={area} fill={metric.color} opacity={0.1} />
            <path d={line} fill="none" stroke={metric.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {hover !== null && (
              <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={y(0)} className="chart-cross" />
            )}
            {values.length > 0 && (
              <circle cx={x(shown)} cy={y(values[shown])} r={4} fill={metric.color} className="chart-dot" />
            )}
          </svg>
          {hover !== null && (
            <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
              <b>{fmtDay(days[hover].day)}</b>
              <span><i style={{ background: metric.color }} /> {days[hover][metric.key]} {metric.unit}</span>
            </div>
          )}
        </div>
      )}
      {!table && last && <div className="chart-sub">Latest day: {last[metric.key]} {metric.unit}</div>}
    </div>
  );
}

/** The activity charts on the dashboard. */
export function ActivityCharts({ token }: { token: string }) {
  const [range, setRange] = useState<7 | 30 | 90>(30);
  const data = useLoad<DayStat[]>(() => adminApi.charts(token, range), [token, range]);
  return (
    <section aria-label="Activity over time">
      <div className="chart-bar">
        <h2 className="chart-heading">Activity</h2>
        <div className="seg" role="group" aria-label="Time range">
          {([7, 30, 90] as const).map((r) => (
            <button key={r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>{r} days</button>
          ))}
        </div>
      </div>
      {data.error && <p className="pm-error">{data.error}</p>}
      {!data.data && !data.error && <p className="muted">Loading…</p>}
      {data.data && (
        <div className="chart-grid-2">
          {METRICS.map((m) => (
            <Trend key={m.key} days={data.data!} metric={m} />
          ))}
        </div>
      )}
      <p className="muted small">Days are counted in UTC. Message and online counts start from when this feature was switched on.</p>
    </section>
  );
}

const fmtUptime = (s: number): string => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const fmtMb = (mb: number | null): string => (mb === null ? 'unknown' : mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);

/** How the server is doing: uptime, memory, disk space, and recent errors. */
export function HealthPanel({ token }: { token: string }) {
  const h = useLoad<HealthInfo>(() => adminApi.health(token), [token]);
  const d = h.data;
  const diskPct = d && d.diskFreeMb !== null && d.diskTotalMb ? Math.round((d.diskFreeMb / d.diskTotalMb) * 100) : null;
  const diskTone = diskPct === null ? 'blue' : diskPct < 10 ? 'red' : diskPct < 20 ? 'gold' : 'green';
  const cards = d
    ? [
        { label: 'Status', value: d.errorsLastHour === 0 ? 'Healthy' : `${d.errorsLastHour} error${d.errorsLastHour === 1 ? '' : 's'}`, sub: 'in the last hour', tone: d.errorsLastHour === 0 ? 'green' : 'red' },
        { label: 'Running for', value: fmtUptime(d.uptimeSec), sub: `since ${new Date(d.startedAt).toLocaleString()}`, tone: 'blue' },
        { label: 'Disk space free', value: fmtMb(d.diskFreeMb), sub: diskPct === null ? 'not available here' : `${diskPct}% of ${fmtMb(d.diskTotalMb)}`, tone: diskTone },
        { label: 'Memory', value: fmtMb(d.memoryMb), sub: 'used by the server', tone: 'purple' },
        { label: 'Database', value: fmtMb(d.dbMb), sub: 'messages, members, settings', tone: 'gold' },
        { label: 'Pictures', value: fmtMb(d.picturesMb), sub: 'photos and shared pictures', tone: 'pink' },
        { label: 'Online now', value: String(d.online), sub: 'members connected', tone: 'green' },
      ]
    : [];
  return (
    <>
      <div className="chart-bar">
        <div>
          <h2 className="chart-heading">Server health</h2>
          {d && <span className="muted small">QChat {d.version} on Node {d.node}</span>}
        </div>
        <button className="mini" onClick={h.reload}>Refresh</button>
      </div>
      {h.error && <p className="pm-error">{h.error}</p>}
      {d && diskPct !== null && diskPct < 15 && (
        <p className="gate-warn" role="alert">Disk space is running low ({diskPct}% free). Old backups or pictures may need clearing.</p>
      )}
      <div className="stat-grid">
        {cards.map((c) => (
          <div key={c.label} className={`stat-card tone-${c.tone}`}>
            <div className="stat-value">{c.value}</div>
            <div className="stat-label">{c.label}</div>
            <div className="stat-sub">{c.sub}</div>
          </div>
        ))}
      </div>
      <div className="panel">
        <div className="panel-title">Recent errors</div>
        {d && d.errors.length === 0 && <p className="muted">No errors recorded. 🎉</p>}
        {d?.errors.map((e) => (
          <div className="activity-row" key={e.id}>
            <span className="activity-what"><b>{e.kind}</b> {e.message}</span>
            <span className="activity-when">{new Date(e.ts).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </>
  );
}
