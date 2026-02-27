// OpenAPI Smart Mock — public API surface

export type {
  JSONSchema,
  OpenAPIDocument,
  DereferencedSpec,
  HttpMethod,
  OpenAPIResponseDef,
  OpenAPIParam,
  OpenAPIRoute,
  RecordingEntry,
  RecordingFile,
  RequestSignature,
  RecordingStore,
  ValidationError,
  ValidationResult,
  RequestValidatorSet,
  MockGenerateResult,
  MockValidateResult,
} from './types.js';

export { loadAndDereferenceSpec, convertOpenApiPath } from './spec-loader.js';
export { generateResponseBody } from './response-generator.js';
export type { GenerateOptions } from './response-generator.js';
export { buildOpenAPIRoutes } from './route-builder.js';
export type { BuildRoutesConfig } from './route-builder.js';
export { compileValidators, validateRequest } from './request-validator.js';
export { RecordingStoreImpl, computeSignature, createRecordHandler } from './recorder.js';
export type { RecordHandlerOptions } from './recorder.js';
