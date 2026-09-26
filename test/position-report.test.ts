import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePositionReport } from '../src/ais/position-report.js';
import { loadConfig } from '../src/config/env.js';

const receivedAt = new Date('2026-09-26T08:30:00.000Z');
const frame = {
  MessageType: 'PositionReport',
  MetaData: { MMSI: 368207620, ShipName: ' TEST SHIP ', Latitude: 25.7617, Longitude: -80.1918 },
  Message: { PositionReport: { UserID: 368207620, Valid: true, Sog: 12.4, Cog: 86.7 } },
};

test('parses valid reports and falls back to metadata coordinates', () => {
  assert.deepEqual(parsePositionReport(frame, receivedAt), {
    mmsi: 368207620, name: 'TEST SHIP', latitude: 25.7617, longitude: -80.1918,
    speed: 12.4, course: 86.7, receivedAt,
  });
});

test('uses report coordinates and treats AIS unavailable values as unknown', () => {
  const changed = structuredClone(frame);
  Object.assign(changed.Message.PositionReport, { Latitude: 26, Longitude: -81, Sog: 102.3, Cog: 360 });
  const result = parsePositionReport(changed, receivedAt);
  assert.equal(result?.latitude, 26);
  assert.equal(result?.longitude, -81);
  assert.equal(result?.speed, null);
  assert.equal(result?.course, null);
});

test('rejects invalid, mismatched, and bad-coordinate reports', () => {
  assert.equal(parsePositionReport({ ...frame, MessageType: 'ShipStaticData' }, receivedAt), null);
  assert.equal(parsePositionReport({ ...frame, MetaData: { ...frame.MetaData, MMSI: 123 } }, receivedAt), null);
  assert.equal(parsePositionReport({ ...frame, Message: { PositionReport: { ...frame.Message.PositionReport, Valid: false } } }, receivedAt), null);
  assert.equal(parsePositionReport({ ...frame, Message: { PositionReport: { ...frame.Message.PositionReport, Longitude: 181 } } }, receivedAt), null);
});

test('requires configuration and validates provider bounding boxes', () => {
  const env = {
    AISSTREAM_API_KEY: 'key', DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    AIS_BOUNDING_BOXES: '[[[25.835,-80.208],[25.603,-79.879]]]',
  };
  assert.equal(loadConfig(env).aisBoundingBoxes.length, 1);
  assert.throws(() => loadConfig({ ...env, AISSTREAM_API_KEY: '' }), /AISSTREAM_API_KEY/);
  assert.throws(() => loadConfig({ ...env, AIS_BOUNDING_BOXES: '[[[91,0],[0,1]]]' }), /AIS_BOUNDING_BOXES/);
});
