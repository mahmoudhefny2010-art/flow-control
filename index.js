// Vercel Express entry point. Static assets are served from public/ by Vercel.
const express = require('express');
const { createApplication } = require('./server/app');

module.exports = createApplication(express).app;
