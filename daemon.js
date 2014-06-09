var express = require('express');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var cookieSession = require('cookie-session');
var cors = require('cors');
var request = require('superagent');
var _ = require('lodash');

var config = require('./config.json');

var daemon = express();

daemon.use(cors({ origin: true, credentials: true }));

// CORS Pre-Flight https://github.com/troygoode/node-cors#enabling-cors-pre-flight
daemon.options('*', cors());

daemon.use(bodyParser());
daemon.use(cookieParser(config.secrets.cookie));
daemon.use(cookieSession({ secret: config.secrets.session })); //FIXME CSRF

daemon.post('/auth/login', function(req, res){
  if(_.contains(config.audiences, req.headers.origin)){

    // persona verify
    request.post('https://verifier.login.persona.org/verify')
      .send({
        assertion: req.body.assertion,
        audience: req.headers.origin
      })
      .end(function(pres){ //FIXME extract into function

        // start session
        req.session.agent = {};
        req.session.agent.persona = pres.body;

        var email = pres.body.email;
        var domain = email.split('@')[1];

        // webfinger
        request.get('http://' + domain + '/.well-known/webfinger')
          .query({ resource: 'acct:' + email })
          .end(function(wres){
            req.session.agent.webfinger = wres.body;

            // profile
            var profileURL = _.select(wres.body.links, function(link){
              return link.rel === 'http://webfinger.net/rel/profile-page';
            })[0].href;

            request.get(profileURL)
              .accept('application/json')
              .end(function(profileRes){
                req.session.agent.profile = profileRes.body;
                res.json(req.session.agent);
              });
          });

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
