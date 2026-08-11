import { expect, type APIResponse } from '@playwright/test';

/**
 * Validates a successful Zero 2.0 API response structure.
 * All backend responses follow: { success, code, message, timestamp, data?, meta? }
 */
export async function expectSuccess(response: APIResponse, expectedCode = 200) {
  expect(response.status()).toBe(expectedCode);
  const body = await response.json();

  expect(body).toHaveProperty('success', true);
  expect(body).toHaveProperty('code', expectedCode);
  expect(body).toHaveProperty('message');
  expect(body).toHaveProperty('timestamp');
  expect(new Date(body.timestamp).getTime()).not.toBeNaN();

  return body;
}

/**
 * Validates a successful response and returns data field.
 */
export async function expectSuccessData(response: APIResponse, expectedCode = 200) {
  const body = await expectSuccess(response, expectedCode);
  expect(body).toHaveProperty('data');
  return body.data;
}

/**
 * Validates an error response from the API.
 */
export async function expectError(response: APIResponse, expectedCode: number) {
  expect(response.status()).toBe(expectedCode);
  const body = await response.json();

  expect(body).toHaveProperty('success', false);
  expect(body).toHaveProperty('code', expectedCode);
  expect(body).toHaveProperty('timestamp');
  expect(new Date(body.timestamp).getTime()).not.toBeNaN();

  return body;
}

/**
 * Validates paginated response has correct meta structure.
 */
export function expectPagination(meta: Record<string, unknown>) {
  expect(meta).toHaveProperty('totalItems');
  expect(meta).toHaveProperty('limit');
  expect(meta).toHaveProperty('page');
  expect(meta).toHaveProperty('totalPages');
  expect(meta).toHaveProperty('hasNextPage');
  expect(meta).toHaveProperty('hasPrevPage');

  expect(typeof meta.totalItems).toBe('number');
  expect(typeof meta.limit).toBe('number');
  expect(typeof meta.page).toBe('number');
  expect(typeof meta.totalPages).toBe('number');
  expect(typeof meta.hasNextPage).toBe('boolean');
  expect(typeof meta.hasPrevPage).toBe('boolean');
}

/**
 * Validates an ISO 8601 timestamp string.
 */
export function expectISO8601(value: unknown) {
  expect(typeof value).toBe('string');
  expect(new Date(value as string).getTime()).not.toBeNaN();
}

/**
 * Validates that a response body contains the standard auth response fields.
 */
export function expectAuthResponse(data: Record<string, unknown>) {
  expect(data).toHaveProperty('accessToken');
  expect(data).toHaveProperty('refreshToken');
  expect(typeof data.accessToken).toBe('string');
  expect(typeof data.refreshToken).toBe('string');
  expect((data.accessToken as string).length).toBeGreaterThan(10);
  expect((data.refreshToken as string).length).toBeGreaterThan(10);
}
