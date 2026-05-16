import http from 'k6/http';
import { sleep } from 'k6';
import { BASE_URL, API, THRESHOLDS, jsonHeaders, expectStatus, expectSuccess } from './config.js';

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: THRESHOLDS,
};

export default function () {
  // Health check
  const health = http.get(`${BASE_URL}/health`);
  expectStatus(health, 200, 'health check');
  expectSuccess(health, 'health check');

  sleep(0.5);

  // Metrics endpoint
  const metrics = http.get(`${BASE_URL}/metrics`);
  expectStatus(metrics, 200, 'metrics endpoint');

  sleep(0.5);

  // 404 on unknown route returns correct shape
  const notFound = http.get(`${API}/does-not-exist`);
  expectStatus(notFound, 404, 'unknown route');

  sleep(1);
}
