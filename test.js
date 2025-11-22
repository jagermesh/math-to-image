#!/usr/bin/env node

import MathToImageService from './index.js';

let mathToImageService = new MathToImageService({
  port: 8000,
  redis: {
    lifespan: '30 min',
    connectString: 'redis://localhost:6379',
  },
});
mathToImageService.start();