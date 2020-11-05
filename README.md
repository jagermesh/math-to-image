# System Watcher

## Setup

1) Add NPM package

```shell
npm init
npm install --save math-to-image
```

2) Create `math2image.js` with following code as an example

```javascript
const MathToImage = require(__dirname + '/index.js');

let mathToImage = new MathToImage();

mathToImage.start();
```

3) Create `config.js` with following code as an example

```javascript
module.exports = {
  port: 8000,
  redis: {
    lifespan: '30 min',
    connectString: 'redis://localhost:6379',
  },
};;
```

4) Run the service

```shell
node math2image.js start --config config.js
```

## Run using pm2 [http://pm2.keymetrics.io](http://pm2.keymetrics.io).

The best way to make sure service is always up and running is to use pm2.

1) Create `ecosystem.config.yml` using following code as an example:

```yaml
module.exports = {
  apps : [
    { name: 'Math2Image',
      script: 'math2image.js',
      args: 'start --config config.js',
      instances: 1,
      autorestart: true,
      watch: true,
      watch_delay: 1000,
      ignore_watch : ["node_modules", ".git", "config/.git"],
      max_memory_restart: '1G',
    }
  ]
};

```

2) Run service through pm2

```shell
pm2 start
```

3) Check it's running using

```shell
pm2 ls
```

4) Check logs using

```shell
pm2 logs
```
