/**
 * Created by Alexander Knapstein on 15.08.2014
 * INSPIRATIONlabs GmbH
 * http://www.inspirationlabs.com
 */
var _ = require('underscore');
var fs = require('fs');
var async = require('async');
var url = require('url');
var sharp = require('sharp');

var molecuel;


/**
 * image - Constructor of image module
 */
var image = function image() {
  var self = this;
  self.elements = null;
  self.files = null;
  self.styles = {};

  // is application middleware already registered
  this.appInitialized = false;

  // emit molecuel image pre init event
  molecuel.emit('mlcl::image::init:pre', self);

  // default Style definition directory
  this.configDir = __dirname + '/Styles';

  /**
   * Style directory config
   */
  if (molecuel.config.image && molecuel.config.image.configDir) {
    this.configDir = molecuel.config.image.configDir;
  }

  //load definitions
  self.loadStyles();

  molecuel.on('mlcl::elements::init:pre', function(module) {
    self.elements = module;
  });

  molecuel.on('mlcl::files::init:post', function(module) {
    self.files = module;
  });

  return this;
};

/**
 * Init function for the molecuel module
 * @param app the express app
 */
image.prototype.initApplication = function initApplication() {
  // send init event
  molecuel.emit('mlcl::image::initApplication:pre', this);

  molecuel.emit('mlcl::image::initApplication:post', this);
};


/**
 * get - Express middleware - sends the manipulated image
 *
 * @param  {type} req  description
 * @param  {type} res  description
 * @param  {type} next description
 * @return {type}      description
 */
image.prototype.get = function get(req, res, next) {
  var self = this;
  //load style settings
  var name = req.params.style;
  var style = self.getStyle(name);
  if(!style) {
    return res.send(500, "style not found: " + name);
  }
  //get image paths + outputformat
  var url = '/' + req.params[0];
  var reg = /(.*)\.(webp|png|jpeg|jpg)\.(webp|png|jpeg|jpg)$/;
  var d = url.match(reg);
  var format;
  if(d) {
    url = d[1] + '.' + d[2];
    format = d[3];
    if(format) {
      style.output = format;
    }
  }

  self.elements.searchByUrl(url, "", function(err, result) {
    if(err) {
      return callback(err);
    }
    if (result && result.hits && result.hits.hits && result.hits.hits[0]) {
      var object = result.hits.hits[0];
      var source = result.hits.hits[0]._source;
      var type = result.hits.hits[0]._type;

      if(object && type == 'file') {
        var grid = self.files.grid;
        grid.getFileStream(object._id, function(err, filestream) {
          if(!filestream) {
              return res.send(500);
          } else {
            self.process(style, function(err, transform) {
              filestream.pipe(transform).pipe(res);
            });
          }
        });
      } else {
        return res.send(500);
      }
    }
  });
};

image.prototype.metadata = function metadata(options, callback) {
  var self = this;
  var obj;
  if(_.isString(options)) {
    self.loadByUrl(options, function(err, buffer) {
      if(err) {
        return callback(err);
      }
      if(buffer) {
        sharp(buffer).metadata(function(err, meta) {
          if(err) {
            return callback(err);
          }
          return callback(null, meta);
        });
      }
    })
  }
}

/**
 * loadByUrl - Gets an image as buffer object based on its url
 *
 * @param  {type} url      url of the image
 * @param  {type} callback description
 */
image.prototype.loadByUrl = function loadByUrl(url, callback) {
  var self = this;
  self.elements.searchByUrl(url, "", function(err, result) {
    if(err) {
      return callback(err);
    }
    if (result && result.hits && result.hits.hits && result.hits.hits[0]) {
      var object = result.hits.hits[0];
      var source = result.hits.hits[0]._source;
      var type = result.hits.hits[0]._type;

      if(object && type == 'file') {
        var grid = self.files.grid;
        grid.getFileStream(object._id, function(err, filestream) {
          if(!filestream) {
            next();
          } else {
            var buffer = [];
            filestream.on('err', function(err) {
              return callback(err);
            });
            filestream.on('data', function(chunk) {
              buffer.push(chunk);
            });
            filestream.on('end', function(chunk) {
              return callback(null, Buffer.concat(buffer));
            });
          }
        });
      }
    } else {
      return callback('No result found for url: ' + url);
    }
  });
};

/**
 * Load the definitions
 * @todo load from configuration
 */
image.prototype.loadStyles = function getDefinitions() {
  molecuel.emit('mlcl::image::preGetDefinitions', this);
  var self = this;

  /**
   * Load schema definitions
   * @type {*}
   */
  var defFiles = fs.readdirSync(this.configDir);
  defFiles.forEach(function (entry) {
    var currentConfig = require(self.configDir + '/' + entry)(self);
    self.registerStyle(currentConfig);
  });
  molecuel.emit('mlcl::image::postGetDefinitions', this);
};


/**
 * registerStyle - Registers an image style configuration
 *
 * @param  {type} config description
 * @return {type}        description
 */
image.prototype.registerStyle = function registerStyle(config) {
  var name = config.name.toLowerCase();

  if (!this.styles[name]) {
    this.styles[name] = config;
  }
};


/**
 * getStyle - Returns the image style configuration by name from loaded configs
 *
 * @param  {type} name description
 * @return {type}      description
 */
image.prototype.getStyle = function getStyle(name) {
  var name = name || '';
  if(this.styles[name.toLowerCase()]) {
    return _.clone(this.styles[name.toLowerCase()]);
  }
  return false;
}

/**
 * Converts an image based on the style configuration
 *
 * @param  {type} source   imagepath | Buffer
 * @param  {type} style    configuration object
 * @param  {type} callback callback(err, OutputBuffer, metadata)
 */
image.prototype.process = function process(style, callback) {
  var obj = sharp();

  _.each(style.transformations, function(prop) {
    if(prop.resize) {
      obj = obj.resize(prop.resize.width, prop.resize.height);
    }
    if(prop.max) {
      obj = obj.max();
    }
    if(prop.embedWhite) {
      obj = obj.embedWhite();
    }
  });
  if(style.output) {
    if(style.output == 'webp') {
      obj = obj.webp();
    } else if(style.output == 'jpeg' || style.output == 'jpg') {
      obj = obj.jpeg();
    }
  }
  callback(null, obj);
}

/* ************************************************************************
 SINGLETON CLASS DEFINITION
 ************************************************************************ */
image.instance = null;

/**
 * Singleton getInstance definition
 * @return singleton class
 */
image.getInstance = function () {
  if (this.instance === null) {
    this.instance = new image();
  }
  return this.instance;
};

var init = function (m) {
  // store molecuel instance
  molecuel = m;
  return image.getInstance();
};

module.exports = init;
