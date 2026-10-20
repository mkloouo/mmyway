import { FF3RequestError } from '../api/ff3/client';
import {
  describeFF3Error,
  describeFf3Error,
  duplicateOf,
  internalReferenceFor,
  serverUnavailable,
  splitReference,
} from './outboxErrors';

describe('outboxErrors', () => {
  describe('internalReferenceFor', () => {
    it('formats idempotency key with mmyway prefix', () => {
      expect(internalReferenceFor('client-123')).toBe('mmyway:client-123');
    });
  });

  describe('duplicateOf', () => {
    it('extracts transaction id from duplicate error message', () => {
      const err = new FF3RequestError(
        422,
        'Duplicate of transaction #456',
        'POST /v1/transactions',
      );
      expect(duplicateOf(err)).toBe('456');
    });

    it('returns null for non-422 errors or non-matching body', () => {
      expect(duplicateOf(new FF3RequestError(500, 'Server error'))).toBeNull();
      expect(duplicateOf(new FF3RequestError(422, 'Validation failed'))).toBeNull();
      expect(duplicateOf(new Error('Generic'))).toBeNull();
    });
  });

  describe('splitReference', () => {
    it('returns internal_reference of first transaction split if present', () => {
      const group: any = {
        attributes: {
          transactions: [{ internal_reference: 'mmyway:c1' }],
        },
      };
      expect(splitReference(group)).toBe('mmyway:c1');
    });

    it('returns null when transaction split or group is absent', () => {
      expect(splitReference(undefined)).toBeNull();
      expect(splitReference({ attributes: { transactions: [] } } as any)).toBeNull();
    });
  });

  describe('serverUnavailable', () => {
    it('identifies 5xx, 401, 403, 429 as unavailable', () => {
      expect(serverUnavailable(new FF3RequestError(500, 'Internal Error'))).toBe(true);
      expect(serverUnavailable(new FF3RequestError(502, 'Bad Gateway'))).toBe(true);
      expect(serverUnavailable(new FF3RequestError(401, 'Unauthorized'))).toBe(true);
      expect(serverUnavailable(new FF3RequestError(403, 'Forbidden'))).toBe(true);
      expect(serverUnavailable(new FF3RequestError(429, 'Too Many Requests'))).toBe(true);
    });

    it('identifies 400, 404, 422 as operation-specific', () => {
      expect(serverUnavailable(new FF3RequestError(400, 'Bad Request'))).toBe(false);
      expect(serverUnavailable(new FF3RequestError(404, 'Not Found'))).toBe(false);
      expect(serverUnavailable(new FF3RequestError(422, 'Unprocessable'))).toBe(false);
    });

    it('identifies network TypeErrors and timeout AbortErrors', () => {
      expect(serverUnavailable(new TypeError('Network request failed'))).toBe(true);
      const abort = new Error('The operation was aborted');
      abort.name = 'AbortError';
      expect(serverUnavailable(abort)).toBe(true);
      expect(serverUnavailable(new Error('Other error'))).toBe(false);
    });
  });

  describe('describeFF3Error', () => {
    it('formats structured validation JSON body', () => {
      const body = JSON.stringify({
        message: 'The given data was invalid.',
        errors: { name: ['The name field is required.'] },
      });
      const err = new FF3RequestError(422, body, 'POST /v1/rules');
      expect(describeFF3Error(err)).toBe(
        'The given data was invalid. — The name field is required. (422) — POST /v1/rules (name)',
      );
    });

    it('formats non-JSON raw body if short and not HTML', () => {
      const err = new FF3RequestError(400, 'Bad input parameters', 'GET /v1/test');
      expect(describeFF3Error(err)).toBe('Bad input parameters (400) — GET /v1/test');
    });

    it('falls back to status code for HTML error pages', () => {
      const err = new FF3RequestError(
        502,
        '<html><body>502 Bad Gateway</body></html>',
        'GET /v1/test',
      );
      expect(describeFF3Error(err)).toBe('Firefly III answered 502 — GET /v1/test');
    });

    it('has describeFf3Error alias', () => {
      expect(describeFf3Error).toBe(describeFF3Error);
    });
  });
});
