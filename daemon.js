var express = require('express');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var cookieSession = require('cookie-session');
var cors = require('cors');
var request = require('superagent');
var _ = require('lodash');
var Promise = require('es6-promise').Promise;

var config = require('./config.json');

var daemon = express();

daemon.use(cors({ origin: true, credentials: true }));

// CORS Pre-Flight https://github.com/troygoode/node-cors#enabling-cors-pre-flight
daemon.options('*', cors());

daemon.use(bodyParser());
daemon.use(cookieParser(config.secrets.cookie));
daemon.use(cookieSession({ secret: config.secrets.session })); //FIXME CSRF


function verifyPersona(assertion, origin){
  return new Promise(function(resolve, reject) {
    request.post('https://verifier.login.persona.org/verify')
      .send({
        assertion: assertion,
        audience: origin
      })
      .end(function(err, res){
        if(err) reject(err);
        if(res.ok){
          // debug
          console.log('persona verification', res.body);

          resolve(res.body);
        } else {
          reject(res.error);
        }
      });
  });
}

function discoverProfile(email){
  return new Promise(function(resolve, reject) {
    var domain = email.split('@')[1];
    request.get('http://' + domain + '/.well-known/webfinger')
      .query({ resource: 'acct:' + email })
      .end(function(err, res){
        if(err) reject(err);
        if(res.ok){
          // debug
          console.log('webfinger jrd', res.body);

          // #TODO save JRD

          var url = _.select(res.body.links, function(link){
            return link.rel === 'http://webfinger.net/rel/profile-page';
          })[0].href;

          resolve(url);
        } else {
          reject(res.error);
        }

      });
  });
}

function getProfile(url){
  return new Promise(function(resolve, reject) {
    request.get(url)
      .accept('application/json') // FIXME: application/ld+json
      .redirects(2)
      .end(function(err, res){
        if(err) return reject(err);
        if(res.ok){
          // debug
          console.log('profile', res.body);

          resolve(res.body);
        } else {
          reject(res.error);
        }

      });
  });
}

daemon.post('/auth/login', function(req, res){

  /*
   * check audience
   * https://developer.mozilla.org/en/Persona/Security_Considerations#Explicitly_specify_the_audience_parameter
   */
  if(_.contains(config.audiences, req.headers.origin)){

    // persona verify
    verifyPersona(req.body.assertion, req.headers.origin).then(function(verification){

      // start session
      req.session.agent = {};
      req.session.agent.persona = verification;

      // webfinger
      discoverProfile(verification.email).then(function(url){

        getProfile(url).then(function(profile){
          req.session.agent.profile = profile;
          res.json(req.session.agent);
        });
      });
    }).catch(function(error){
      console.log(error);
    });
  } else {
    res.send(403);
  }
});

daemon.post('/auth/logout', function(req, res){
  req.session = null;
  res.send(200);
});

daemon.listen(config.port, function(){
  console.log('listening on ', config.port);
});
