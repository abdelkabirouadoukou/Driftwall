/**
 * Validates `.dwpkg` manifests against the canonical JSON Schema published by
 * `@driftwall/contracts`. The schema is the single source of truth; this module
 * only wires it to an `ajv` validator and normalises error output.
 */

import Ajv, { type AnySchema, type ErrorObject } from 'ajv';
import { manifestSchema, type DwpkgManifest } from '@driftwall/contracts';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const validate = ajv.compile<DwpkgManifest>(manifestSchema as AnySchema);

function formatError(error: ErrorObject): string {
  const path = error.instancePath || '/';
  return `${path} ${error.message ?? 'is invalid'}`.trim();
}

/** Validates an unknown value as a Driftwall manifest. */
export function validateManifest(input: unknown): ValidationResult {
  const valid = validate(input) === true;
  if (valid) return { valid: true, errors: [] };
  const errors = (validate.errors ?? []).map(formatError);
  return { valid: false, errors };
}

/** Type guard built on {@link validateManifest}. */
export function isManifest(input: unknown): input is DwpkgManifest {
  return validateManifest(input).valid;
}
