var express = require('express');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var cookieSession = require('cookie-session');
var cors = require('cors');
var request = require('superagent');
var fs = require('fs');
var _ = require('lodash');
var uuid = require('uuid');
var Promise = require('es6-promise').Promise;

var config = require('./config.json');

var daemon = express();

daemon.use(cors({ origin: true, credentials: true }));

// CORS Pre-Flight https://github.com/troygoode/node-cors#enabling-cors-pre-flight
daemon.options('*', cors());

daemon.use(bodyParser());
daemon.use(cookieParser(config.secrets.cookie));
daemon.use(cookieSession({ secret: config.secrets.session })); //FIXME CSRF

/*
 * Mozilla Persona
 */

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

/*
 * Webfinger
 */

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

/*
 * ## Wiki
 */
var pagesPath = './wiki/pages/';
var etherpadService = 'http://neocortex:9001/';
var etherpadApi = etherpadService + 'api/1/';
var etherpadPad = etherpadService + 'p/';

/*
 * Store
 */
var Store = function(){

  /**
   * gets page from its fileName
   * @param fileName String file name of requested page
   * @return {Object} instance of Page
   */
  this.getPage = function(fileName){
    return _.find(this.pages, function(page){ return page.fileName === fileName; });
  };

};

/**
 * create an instance
 */
var store = new Store();

/**
 * ### Page
 */
function Page(fileName, text){
  this.fileName = fileName;
  this.text = text;
}

function loadPage(fileName){
  return new Promise(function(resolve, reject){
    fs.readFile(pagesPath + fileName, function(err, data){
      if(err) return reject(err);
      resolve(new Page(fileName, data.toString()));
    });
  });
}

/*
 * loads pages from filesystem
 * TODO: watch filesystem for changes
 */

function loadPages(path){
  return new Promise(function(resolve, reject){
    fs.readdir(path, function(err, fileNames){
      if(err) return reject(err);

      // read all files using readFile
      Promise.all(fileNames.map(function(fileName){ return loadPage(fileName);}))
        .then(resolve)
        .catch(function(err){
          reject(err);
        });
    });
  });
}

loadPages(pagesPath).then(function(pages){
  store.pages = pages;
  console.log(store);
}).catch(function(err){
  console.log(err);
});

daemon.get('/edit/:fileName', function(req, res){
  var fileName = req.params.fileName;

  // debug
  console.log('edit', fileName);

  var page = store.getPage(fileName);

  // create uuid or reuse existing one (prevents creating new pad every time)
  // FIXME make it more inteligent and friendly for group editing
  if(!page.uuid) page.uuid = uuid.v4();
  var padUri = etherpadPad + page.uuid;
  console.log(page);
  request.get(etherpadApi + 'createPad').query({
    apikey: '3ee47370501d01403aaaf2274f7dafd1b2307d5eb579b2afd82daa1e204c44f6',
    padID: page.uuid,
    text: page.text
  }).end(function(response){
    if(response.ok){
      console.log('pushed to pad');
      res.redirect(307, padUri);
    } else {
      console.log('requesting pad creation error', response.errors);
    }
  });
});

daemon.get('/uuid/:fileName', function(req, res){
  var fileName = req.params.fileName;

  // debug
  console.log('uuid', fileName);

  var page = store.getPage(fileName);
  res.json(page);
});

daemon.listen(config.port, function(){
  console.log('listening on ', config.port);
});
