/**
 * Unit tests for openapi/spec-loader module.
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { loadAndDereferenceSpec, convertOpenApiPath } from '../../../src/openapi/spec-loader.js';

const FIXTURES = path.resolve(import.meta.dirname, 'fixtures');

describe('spec-loader', () => {
  describe('convertOpenApiPath', () => {
    it('should convert single {param} to :param', () => {
      expect(convertOpenApiPath('/users/{id}')).toBe('/users/:id');
    });

    it('should convert multiple params', () => {
      expect(convertOpenApiPath('/users/{userId}/orders/{orderId}'))
        .toBe('/users/:userId/orders/:orderId');
    });

    it('should leave paths without params unchanged', () => {
      expect(convertOpenApiPath('/api/health')).toBe('/api/health');
    });
  });

  describe('loadAndDereferenceSpec', () => {
    it('should parse a valid YAML spec', async () => {
      const spec = await loadAndDereferenceSpec(path.join(FIXTURES, 'petstore.yaml'));
      expect(spec.title).toBe('Petstore API');
      expect(spec.openApiVersion).toBe('3.0.3');
      expect(spec.routes.length).toBeGreaterThan(0);
      expect(spec.specPath).toContain('petstore.yaml');
      expect(spec.parsedAt).toBeGreaterThan(0);
    });

    it('should parse a valid JSON spec', async () => {
      const spec = await loadAndDereferenceSpec(path.join(FIXTURES, 'petstore.json'));
      expect(spec.title).toBe('Petstore JSON');
      expect(spec.openApiVersion).toBe('3.0.3');
      expect(spec.routes.length).toBe(1);
    });

    it('should resolve $ref references and produce dereferenced routes', async () => {
      const spec = await loadAndDereferenceSpec(path.join(FIXTURES, 'petstore.yaml'));
      const getPets = spec.routes.find((r) => r.method === 'GET' && r.openApiPath === '/pets');
      expect(getPets).toBeDefined();
      const resp200 = getPets!.responses.get(200);
      expect(resp200).toBeDefined();
      expect(resp200!.schema).toBeDefined();
    });

    it('should extract all HTTP methods correctly', async () => {
      const spec = await loadAndDereferenceSpec(path.join(FIXTURES, 'petstore.yaml'));
      const methods = spec.routes.map((r) => `${r.method} ${r.openApiPath}`);
      expect(methods).toContain('GET /pets');
      expect(methods).toContain('POST /pets');
      expect(methods).toContain('GET /pets/{petId}');
      expect(methods).toContain('DELETE /pets/{petId}');
    });

    it('should convert path params to Fastify format', async () => {
      const spec = await loadAndDereferenceSpec(path.join(FIXTURES, 'petstore.yaml'));
      const getPet = spec.routes.find((r) => r.method === 'GET' && r.openApiPath === '/pets/{petId}');
      expect(getPet!.fastifyPath).toBe('/pets/:petId');
    });

    it('should extract path parameters', async () => {
      const spec = await loadAndDereferenceSpec(path.join(FIXTURES, 'petstore.yaml'));
      const getPet = spec.routes.find((r) => r.method === 'GET' && r.openApiPath === '/pets/{petId}');
      expect(getPet!.pathParams).toHaveLength(1);
      expect(getPet!.pathParams[0]!.name).toBe('petId');
      expect(getPet!.pathParams[0]!.required).toBe(true);
    });

    it('should extract query parameters', async () => {
      const spec = await loadAndDereferenceSpec(path.join(FIXTURES, 'petstore.yaml'));
      const listPets = spec.routes.find((r) => r.method === 'GET' && r.openApiPath === '/pets');
      expect(listPets!.queryParams).toHaveLength(1);
      expect(listPets!.queryParams[0]!.name).toBe('limit');
    });

    it('should select lowest 2xx as default status', async () => {
      const spec = await loadAndDereferenceSpec(path.join(FIXTURES, 'petstore.yaml'));
      const listPets = spec.routes.find((r) => r.method === 'GET' && r.openApiPath === '/pets');
      expect(listPets!.defaultStatus).toBe(200);

      const createPet = spec.routes.find((r) => r.method === 'POST' && r.openApiPath === '/pets');
      expect(createPet!.defaultStatus).toBe(201);
    });

    it('should extract request body schema', async () => {
      const spec = await loadAndDereferenceSpec(path.join(FIXTURES, 'petstore.yaml'));
      const createPet = spec.routes.find((r) => r.method === 'POST' && r.openApiPath === '/pets');
      expect(createPet!.requestBody).toBeDefined();
      expect(createPet!.requestBody!.required).toBe(true);
      expect(createPet!.requestBody!.contentType).toBe('application/json');
    });

    it('should throw on missing spec file', async () => {
      await expect(
        loadAndDereferenceSpec('/nonexistent/spec.yaml'),
      ).rejects.toThrow(/not found|ENOENT/i);
    });

    it('should extract example values from responses', async () => {
      const spec = await loadAndDereferenceSpec(path.join(FIXTURES, 'petstore.yaml'));
      const createPet = spec.routes.find((r) => r.method === 'POST' && r.openApiPath === '/pets');
      const resp201 = createPet!.responses.get(201);
      expect(resp201!.example).toEqual({ id: 1, name: 'Fido', tag: 'dog' });
    });
  });
});
