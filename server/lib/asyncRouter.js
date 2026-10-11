const express = require('express');

function wrapHandler(handler) {
  if (!handler || handler.constructor.name !== 'AsyncFunction') return handler;
  return function asyncRouteHandler(req, res, next) {
    return Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function wrapHandlers(value) {
  if (Array.isArray(value)) return value.map(wrapHandlers);
  return typeof value === 'function' ? wrapHandler(value) : value;
}

function createRouter() {
  const router = express.Router();
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all']) {
    const register = router[method].bind(router);
    router[method] = (...args) => register(...args.map(wrapHandlers));
  }
  return router;
}

module.exports = { createRouter };
