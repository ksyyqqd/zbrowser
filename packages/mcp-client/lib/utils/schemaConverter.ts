import { z } from 'zod';
import type { JSONSchema } from '../types/tool';

/**
 * Convert a JSON Schema to a Zod schema
 * Used to convert MCP tool input schemas to Zod for Nanobrowser action validation
 */
export function convertJSONSchemaToZod(schema: JSONSchema): z.ZodType {
  // Handle oneOf (union)
  if (schema.oneOf && schema.oneOf.length > 0) {
    const unionSchemas = schema.oneOf.map(convertJSONSchemaToZod);
    if (unionSchemas.length >= 2) {
      return z.union(unionSchemas as [z.ZodType, z.ZodType, ...z.ZodType[]]);
    }
    return unionSchemas[0] ?? z.unknown();
  }

  // Handle anyOf (union)
  if (schema.anyOf && schema.anyOf.length > 0) {
    const unionSchemas = schema.anyOf.map(convertJSONSchemaToZod);
    if (unionSchemas.length >= 2) {
      return z.union(unionSchemas as [z.ZodType, z.ZodType, ...z.ZodType[]]);
    }
    return unionSchemas[0] ?? z.unknown();
  }

  // Handle allOf (intersection - merge schemas)
  if (schema.allOf && schema.allOf.length > 0) {
    const mergedSchema = schema.allOf.reduce((acc: JSONSchema, s: JSONSchema) => {
      return mergeJSONSchemas(acc, s);
    }, {});
    return convertJSONSchemaToZod(mergedSchema);
  }

  // Handle type
  const types = Array.isArray(schema.type) ? schema.type : [schema.type ?? 'object'];

  let zodType: z.ZodType;

  // Build appropriate Zod type based on JSON schema type
  if (types.includes('string')) {
    zodType = buildStringSchema(schema);
  } else if (types.includes('number') || types.includes('integer')) {
    zodType = buildNumberSchema(schema);
  } else if (types.includes('boolean')) {
    zodType = z.boolean();
  } else if (types.includes('array')) {
    zodType = buildArraySchema(schema);
  } else if (types.includes('object')) {
    zodType = buildObjectSchema(schema);
  } else if (types.includes('null')) {
    zodType = z.null();
  } else if (types.includes('any') || types.length === 0) {
    zodType = z.unknown();
  } else {
    // Handle multiple types by creating union
    const typeSchemas = types.map(t => convertJSONSchemaToZod({ type: t }));
    if (typeSchemas.length >= 2) {
      zodType = z.union(typeSchemas as [z.ZodType, z.ZodType, ...z.ZodType[]]);
    } else {
      zodType = typeSchemas[0] ?? z.unknown();
    }
  }

  // Add description
  if (schema.description) {
    zodType = zodType.describe(schema.description);
  }

  // Handle default value
  if (schema.default !== undefined) {
    zodType = zodType.default(schema.default);
  }

  return zodType;
}

/**
 * Build a string Zod schema from JSON schema
 */
function buildStringSchema(schema: JSONSchema): z.ZodType {
  let zodString = z.string();

  if (schema.enum && schema.enum.length > 0) {
    // Filter to only string values for enum
    const stringEnums = schema.enum.filter((e): e is string => typeof e === 'string');
    if (stringEnums.length > 0) {
      return z.enum(stringEnums as [string, ...string[]]);
    }
  }

  if (schema.minLength !== undefined) {
    zodString = zodString.min(schema.minLength);
  }

  if (schema.maxLength !== undefined) {
    zodString = zodString.max(schema.maxLength);
  }

  if (schema.pattern) {
    try {
      zodString = zodString.regex(new RegExp(schema.pattern));
    } catch {
      // Invalid regex pattern, skip
    }
  }

  return zodString;
}

/**
 * Build a number Zod schema from JSON schema
 */
function buildNumberSchema(schema: JSONSchema): z.ZodType {
  let zodNumber = schema.type === 'integer' ? z.number().int() : z.number();

  if (schema.minimum !== undefined) {
    zodNumber = zodNumber.min(schema.minimum);
  }

  if (schema.maximum !== undefined) {
    zodNumber = zodNumber.max(schema.maximum);
  }

  // Handle exclusiveMinimum/exclusiveMaximum if present
  // (these are not standard JSON Schema but sometimes used)

  return zodNumber;
}

/**
 * Build an array Zod schema from JSON schema
 */
function buildArraySchema(schema: JSONSchema): z.ZodType {
  const itemSchema = schema.items ? convertJSONSchemaToZod(schema.items) : z.unknown();
  let zodArray = z.array(itemSchema);

  // Note: minItems/maxItems not directly supported in zod, but we can handle via refinement
  // For simplicity, we just return the array schema

  return zodArray;
}

/**
 * Build an object Zod schema from JSON schema
 */
function buildObjectSchema(schema: JSONSchema): z.ZodType {
  if (!schema.properties) {
    // Empty object or additionalProperties only
    if (schema.additionalProperties === true || schema.additionalProperties === undefined) {
      return z.record(z.string(), z.unknown());
    }
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      const valueSchema = convertJSONSchemaToZod(schema.additionalProperties);
      return z.record(z.string(), valueSchema);
    }
    return z.object({});
  }

  const shape: Record<string, z.ZodType> = {};
  const requiredSet = new Set(schema.required ?? []);

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    let propZod = convertJSONSchemaToZod(propSchema);

    // Make optional if not in required array
    if (!requiredSet.has(key)) {
      propZod = propZod.optional();
    }

    shape[key] = propZod;
  }

  return z.object(shape);
}

/**
 * Merge two JSON schemas (for allOf handling)
 */
function mergeJSONSchemas(a: JSONSchema, b: JSONSchema): JSONSchema {
  const result: JSONSchema = { ...a, ...b };

  // Merge properties
  if (a.properties && b.properties) {
    result.properties = { ...a.properties, ...b.properties };
  }

  // Merge required arrays
  if (a.required && b.required) {
    result.required = [...a.required, ...b.required];
  } else if (a.required) {
    result.required = a.required;
  } else if (b.required) {
    result.required = b.required;
  }

  return result;
}

/**
 * Convert MCP tool input schema to a Zod schema with intent field
 * Used directly for Action schema in Nanobrowser
 */
export function convertMCPToolSchemaToActionSchema(toolSchema: JSONSchema): z.ZodType {
  const convertedSchema = convertJSONSchemaToZod(toolSchema);

  // Wrap in object with intent field (following Nanobrowser action pattern)
  return z.object({
    intent: z.string().default('').describe('purpose of this action'),
    arguments: convertedSchema.describe('Tool arguments'),
  });
}
