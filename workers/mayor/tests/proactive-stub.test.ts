import { describe, expect, it } from 'vitest';
import {
  fetchBriefing, fetchSuggestions, fetchRoi,
  isNotLive, formatMoney, pluralize, formatClock, formatDuration,
  formatBriefingDate, formatAsOf, sparklinePoints,
} from '../web/proactive-stub';

const notFoundError = () => Object.assign(new Error('This service could not finish.'), { code: 'not_found' });
const otherError = () => Object.assign(new Error('Boom.'), { code: 'internal' });

describe('proactive-stub backend-not-live detection', () => {
  it('treats 404 not_found as backend-not-live', () => {
    expect(isNotLive(notFoundError())).toBe(true);
    expect(isNotLive(otherError())).toBe(false);
    expect(isNotLive(new Error('plain'))).toBe(false);
  });

  it('resolves null (never invented data) when routes are not registered', async () => {
    const api = async () => { throw notFoundError(); };
    await expect(fetchBriefing(api, 'tenant')).resolves.toBeNull();
    await expect(fetchSuggestions(api, 'tenant')).resolves.toBeNull();
    await expect(fetchRoi(api, 'tenant')).resolves.toBeNull();
  });

  it('passes real contract data through untouched', async () => {
    const briefing = { date: '2026-10-08', yesterday: { appointments: 3 } };
    const api = async (path: string) => path.endsWith('/briefing') ? briefing : { cards: [] };
    await expect(fetchBriefing(api, 'tenant')).resolves.toBe(briefing);
    await expect(fetchSuggestions(api, 'tenant')).resolves.toEqual([]);
  });

  it('still throws real failures so the UI can show retry', async () => {
    const api = async () => { throw otherError(); };
    await expect(fetchBriefing(api, 'tenant')).rejects.toThrow('Boom.');
  });
});

describe('proactive-stub formatters', () => {
  it('formats money', () => {
    expect(formatMoney(84000)).toBe('$840.00');
    expect(formatMoney(5)).toBe('$0.05');
    expect(formatMoney(0)).toBe('$0.00');
  });

  it('pluralizes', () => {
    expect(pluralize(1, 'appointment')).toBe('1 appointment');
    expect(pluralize(2, 'appointment')).toBe('2 appointments');
    expect(pluralize(0, 'no-show')).toBe('0 no-shows');
    expect(pluralize(1, 'person', 'people')).toBe('1 person');
    expect(pluralize(3, 'person', 'people')).toBe('3 people');
  });

  it('formats clock times in the business time zone', () => {
    expect(formatClock('2026-10-08T15:30:00Z', 'America/New_York')).toBe('11:30 AM');
    expect(formatClock('2026-10-08T00:05:00Z', 'America/New_York')).toBe('8:05 PM');
  });

  it('passes display strings through untouched', () => {
    expect(formatClock('11:30 AM', 'America/New_York')).toBe('11:30 AM');
    expect(formatClock('not-a-time', 'America/New_York')).toBe('not-a-time');
  });

  it('formats durations', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(102)).toBe('1m 42s');
    expect(formatDuration(3600)).toBe('1h 0m');
    expect(formatDuration(-5)).toBe('0s');
  });

  it('formats the briefing date headline', () => {
    expect(formatBriefingDate('2026-10-08')).toBe('Thursday, Oct 8');
    expect(formatBriefingDate('garbage')).toBe('garbage');
  });

  it('formats the as-of time', () => {
    expect(formatAsOf('2026-10-08T12:32:00Z', 'America/New_York')).toBe('8:32 AM');
    expect(formatAsOf('garbage', 'America/New_York')).toBe('');
  });

  it('builds sparkline points', () => {
    expect(sparklinePoints([])).toBe('');
    const points = sparklinePoints([{ rate: 0.1 }, { rate: 0.05 }, { rate: 0.2 }]);
    const pairs = points.split(' ');
    expect(pairs).toHaveLength(3);
    // highest rate maps to the smallest y (top of the 36-high box)
    const ys = pairs.map(p => parseFloat(p.split(',')[1]));
    expect(ys[2]).toBeLessThan(ys[0]);
    expect(ys[0]).toBeLessThan(ys[1]);
    for (const p of pairs) {
      const [x, y] = p.split(',').map(Number);
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(120);
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(36);
    }
  });
});
