var express = require('express');
var cors = require('cors');
var request = require('superagent');

var config = require('./config.json');

var daemon = express();

daemon.use(cors({ origin: true, credentials: true }));

// CORS Pre-Flight https://github.com/troygoode/node-cors#enabling-cors-pre-flight
daemon.options('*', cors());

daemon.listen(config.port, function(){
  console.log('listening on ', config.port);
});
