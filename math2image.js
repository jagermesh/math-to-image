const colors = require('colors');
const commander = require('commander');
const fs = require('fs');

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

  var max;

  console.log('');
  console.log('Available configs:');
  var configs = [];
  var files = fs.readdirSync(__dirname);
  max = 0;
  for(var i = 0; i < files.length; i++) {
    if (/config.+?[.]js/.test(files[i])) {
      var filename = __dirname + '/' + files[i];
      var config = require(filename);
      configs.push(files[i]);
      max = Math.max(max, ('  node server.js --config ' + files[i]).length);
    }
  }

  for(var j = 0; j < configs.length; j++) {
    console.log(('  node server.js --config ' + configs[j]).padEnd(max, ' ') + ' ' + colors.yellow(configs[j]));
  }

}

commander
  .option('-c, --config [filename]', 'Config file name')
  .parse(process.argv);

try {
  if (commander.config) {
    var configFile = __dirname + '/config/' + commander.config;
    try {
      fs.statSync(configFile);
    } catch (error) {
      throw 'Can not load configuration from ' + commander.config + ':\n  ' + error;
    }
    switch(commander.args[0]) {
      case 'start':
        var application = new Application(commander.config);
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
