#!/usr/bin/env node

const MathToImageService = require('./libs/MathToImageService.js');

let mathToImageService = new MathToImageService();
mathToImageService.start();