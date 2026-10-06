'use strict';

/** Small helpers shared by the route layer. */

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (msg, details) => new HttpError(400, msg, details);
const notFound = (msg) => new HttpError(404, msg);
const upstream = (msg, details) => new HttpError(502, msg, details);

/** Wrap async route handlers so rejections reach the error middleware. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Central error handler: consistent JSON envelope + logged server-side. */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || (err.name === 'ZodError' ? 400 : 500);
  const payload = {
    error: err.name === 'ZodError' ? 'Validation failed' : err.message || 'Unexpected error',
    details: err.name === 'ZodError' ? err.issues : err.details,
  };
  if (status >= 500) console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  res.status(status).json(payload);
}

module.exports = { HttpError, badRequest, notFound, upstream, asyncHandler, errorHandler };
