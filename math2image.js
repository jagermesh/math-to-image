const colors = require('colors');
const commander = require('commander');
const fs = require('fs');
const path = require('path');

const Application = require('./libs/Application.js');

function showHelp() {

  console.log('Usage');
  console.log('  node server.js <command> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  node server.js start ' + colors.yellow('Start server'));
  console.log('');
  console.log('Options:');
  console.log('  -c, --config ' + colors.yellow('Config file name'));

  console.log('');
  console.log('Available configs:');
  let configs = [];
  let files = fs.readdirSync(__dirname);
  let max = 0;
  for(let i = 0; i < files.length; i++) {
    if (/config.+?[.]js/.test(files[i])) {
      let filename = __dirname + '/' + files[i];
      let config = require(filename);
      configs.push(files[i]);
      max = Math.max(max, ('  node server.js --config ' + files[i]).length);
    }
  }

  for(let j = 0; j < configs.length; j++) {
    console.log(('  node server.js --config ' + configs[j]).padEnd(max, ' ') + ' ' + colors.yellow(configs[j]));
  }

}

commander
  .option('-c, --config [filename]', 'Config file name')
  .parse(process.argv);

try {
  if (commander.config) {
    let configFile = commander.config;
    if (configFile.indexOf('/') == -1) {
      configFile = 'config/' + configFile;
    }
    configFile = path.resolve(configFile);
    try {
      fs.statSync(configFile);
    } catch (error) {
      throw 'Can not load configuration from ' + configFile + ':\n  ' + error;
    }
    switch(commander.args[0]) {
      case 'start':
        let application = new Application(configFile);
        application.run();
        break;
      default:
        throw 'Validation error:\n  Missing or unknown <command> parameter';
    }
  } else {
    throw 'Validation error:\n  Missing --config option';
  }
} catch (error) {
  showHelp();
  console.log('');
  console.log(colors.red(error));
}
