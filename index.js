'use strict';

var fs = require('fs');
var path = require('path');
var RSVP = require('rsvp');
var rimraf = RSVP.denodeify(require('rimraf'));
var helpers = require('broccoli-kitchen-sink-helpers');
var symlinkOrCopy = require('symlink-or-copy');
var assign = require('lodash-node/modern/object/assign');
var Plugin = require('broccoli-plugin');
var debugGenerator = require('debug');
var Key = require('./key');
var canUseInputFiles = require('./can-use-input-files');
var walkSync = require('walk-sync');

CachingWriter.prototype = Object.create(Plugin.prototype);
CachingWriter.prototype.constructor = CachingWriter;
function CachingWriter (inputNodes, options) {
  options = options || {};

  Plugin.call(this, inputNodes, {
    name: options.name,
    annotation: options.annotation,
    persistentOutput: true
  });

  this._cachingWriterPersistentOutput = !!options.persistentOutput;

  this._lastKeys = null;
  this._shouldBeIgnoredCache = Object.create(null);
  this._resetStats();

  this._cacheInclude = options.cacheInclude || [];
  this._cacheExclude = options.cacheExclude || [];
  this._inputFiles = options.inputFiles || {};

  if (!Array.isArray(this._cacheInclude)) {
    throw new Error('Invalid cacheInclude option, it must be an array or undefined.');
  }

  if (!Array.isArray(this._cacheExclude)) {
    throw new Error('Invalid cacheExclude option, it must be an array or undefined.');
  }
}

CachingWriter.prototype.debug = function() {
  return this._debug || (this._debug = debugGenerator(
    'broccoli-caching-writer:' +
    this._name +
    (this._annotation ? (' > [' + this._annotation + ']') : '')));
};

CachingWriter.prototype._resetStats = function() {
  this._stats = {
    stats: 0,
    files: 0
  };
};

CachingWriter.prototype.getCallbackObject = function() {
  return {
    build: this._conditionalBuild.bind(this)
  };
};

CachingWriter.prototype._conditionalBuild = function () {
  var writer = this;
  var start = new Date();

  var invalidateCache = false;
  var key, dir;
  var lastKeys = [];

  if (!writer._lastKeys) {
    writer._lastKeys = [];
    // Force initial build even if inputNodes is []
    invalidateCache = true;
  }

  function shouldNotBeIgnored(relativePath) {
    /*jshint validthis:true */
    return !this.shouldBeIgnored(relativePath);
  }

  function keyForFile(relativePath) {
    var fullPath =  dir + '/' + relativePath;
    /*jshint validthis:true */
    this._stats.stats++;
    return new Key('file', fullPath, relativePath, fs.statSync(fullPath), this.debug());
  }

  for (var i = 0, l = writer.inputPaths.length; i < l; i++) {
    dir = writer.inputPaths[i];

    var inputFiles;

    if (canUseInputFiles(this._inputFiles)) {
      inputFiles = this._inputFiles;
    } else {
      inputFiles = walkSync(dir,  this.inputFiles);
    }

    var files = inputFiles.filter(shouldNotBeIgnored, this).map(keyForFile, this);
    this._stats.files += files.length;

    key = new Key('dir', dir, '/', fs.statSync(dir), files, this.debug());

    var lastKey = writer._lastKeys[i];
    lastKeys.push(key);

    if (!invalidateCache /* short circuit */ && !key.equal(lastKey)) {
      invalidateCache = true;
    }
  }

  this._stats.inputPaths = writer.inputPaths;
  this.debug()('rebuild %o in %dms', this._stats, new Date() - start);
  this._resetStats();

  if (invalidateCache) {
    writer._lastKeys = lastKeys;

    var promise = RSVP.Promise.resolve();
    if (!this._cachingWriterPersistentOutput) {
      promise = promise.then(function() {
        return rimraf(writer.outputPath);
      }).then(function() {
        fs.mkdirSync(writer.outputPath);
      });
    }
    return promise.then(function() {
      return writer.build();
    });
  }
};

// Takes in a path and { include, exclude }. Tests the path using regular expressions and
// returns true if the path does not match any exclude patterns AND matches atleast
// one include pattern.
CachingWriter.prototype.shouldBeIgnored = function (fullPath) {
  if (this._shouldBeIgnoredCache[fullPath] !== undefined) {
    return this._shouldBeIgnoredCache[fullPath];
  }

  var excludePatterns = this._cacheExclude;
  var includePatterns = this._cacheInclude;
  var i = null;

  // Check exclude patterns
  for (i = 0; i < excludePatterns.length; i++) {
    // An exclude pattern that returns true should be ignored
    if (excludePatterns[i].test(fullPath) === true) {
      return (this._shouldBeIgnoredCache[fullPath] = true);
    }
  }

  // Check include patterns
  if (includePatterns !== undefined && includePatterns.length > 0) {
    for (i = 0; i < includePatterns.length; i++) {
      // An include pattern that returns true (and wasn't excluded at all)
      // should _not_ be ignored
      if (includePatterns[i].test(fullPath) === true) {
        return (this._shouldBeIgnoredCache[fullPath] = false);
      }
    }

    // If no include patterns were matched, ignore this file.
    return (this._shouldBeIgnoredCache[fullPath] = true);
  }

  // Otherwise, don't ignore this file
  return (this._shouldBeIgnoredCache[fullPath] = false);
};

module.exports = CachingWriter;
