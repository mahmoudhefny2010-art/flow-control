// Tiny validation helper (no external deps)
// Rules per field: { type:'string'|'email'|'number'|'enum'|'array'|'object', required, min, max, oneOf, pattern }
function validate(input, rules) {
  const errors = {};
  for (const [field, rule] of Object.entries(rules)) {
    const value = input ? input[field] : undefined;
    const missing = value === undefined || value === null || value === '';
    if (rule.required && missing) {
      errors[field] = `${field} is required`;
      continue;
    }
    if (missing) continue;
    if (rule.type === 'string' && typeof value !== 'string') {
      errors[field] = `${field} must be a string`;
    } else if (rule.type === 'number' && (typeof value !== 'number' || Number.isNaN(value))) {
      errors[field] = `${field} must be a number`;
    } else if (rule.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors[field] = `${field} must be a valid email`;
    } else if (rule.type === 'enum' && !rule.enum.includes(value)) {
      errors[field] = `${field} must be one of: ${rule.enum.join(', ')}`;
    } else if (rule.oneOf && !rule.oneOf.includes(value)) {
      errors[field] = `${field} must be one of: ${rule.oneOf.join(', ')}`;
    } else if (rule.pattern && !rule.pattern.test(value)) {
      errors[field] = `${field} has an invalid format`;
    } else if (rule.type === 'string' && rule.min && value.length < rule.min) {
      errors[field] = `${field} must be at least ${rule.min} characters`;
    } else if (rule.type === 'string' && rule.max && value.length > rule.max) {
      errors[field] = `${field} must be at most ${rule.max} characters`;
    } else if (rule.type === 'number' && rule.min !== undefined && value < rule.min) {
      errors[field] = `${field} must be >= ${rule.min}`;
    } else if (rule.type === 'number' && rule.max !== undefined && value > rule.max) {
      errors[field] = `${field} must be <= ${rule.max}`;
    } else if (rule.type === 'array' && !Array.isArray(value)) {
      errors[field] = `${field} must be an array`;
    } else if (rule.type === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
      errors[field] = `${field} must be an object`;
    }
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

function badRequest(res, errors) {
  return res.status(400).json({ error: 'Validation failed', details: errors });
}

module.exports = { validate, badRequest };
