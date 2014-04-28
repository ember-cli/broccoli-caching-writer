var fs = require('fs');
var path = require('path');
var mkdirp = require('mkdirp')
var quickTemp = require('quick-temp')
var Writer = require('broccoli-writer');
var helpers = require('broccoli-kitchen-sink-helpers')

CachingWriter.prototype = Object.create(Writer.prototype);
CachingWriter.prototype.constructor = CachingWriter;
function CachingWriter (inputTree, options) {
  if (!(this instanceof CachingWriter)) return new CachingWriter(inputTree, options);

  this.inputTree = inputTree;

  options = options || {};

  for (var key in options) {
    if (options.hasOwnProperty(key)) {
      this[key] = options[key]
    }
  }
};

CachingWriter.prototype.getCacheDir = function () {
  return quickTemp.makeOrReuse(this, 'tmpCacheDir')
}

CachingWriter.prototype.getCleanCacheDir = function () {
  return quickTemp.makeOrRemake(this, 'tmpCacheDir')
}

CachingWriter.prototype.write = function (readTree, destDir) {
  var self = this

  return readTree(this.inputTree).then(function (srcDir) {
    var inputTreeKeys = keysForTree(srcDir);
    var inputTreeHash = helpers.hashStrings(inputTreeKeys);

    if (inputTreeHash !== self._cacheHash) {
      self.updateCache(srcDir, self.getCleanCacheDir());

      self._cacheHash     = inputTreeHash;
      self._cacheTreeKeys = inputTreeKeys;
    }

    helpers.copyRecursivelySync(self.getCacheDir(), destDir);
  })
};

CachingWriter.prototype.cleanup = function () {
  quickTemp.remove(this, 'tmpCacheDir')
  Writer.prototype.cleanup.call(this)
}

CachingWriter.prototype.updateCache = function (srcDir, destDir) {
  throw new Error('You must implement updateCache.');
}

module.exports = CachingWriter;

function keysForTree (fullPath, options) {
  options = options || {}

  var _stack         = options._stack
  var _followSymlink = options._followSymlink
  var relativePath   = options.relativePath || '.'
  var stats
  var statKeys

  try {
    if (_followSymlink) {
      stats = fs.statSync(fullPath)
    } else {
      stats = fs.lstatSync(fullPath)
    }
  } catch (err) {
    console.warn('Warning: failed to stat ' + fullPath)
    // fullPath has probably ceased to exist. Leave `stats` undefined and
    // proceed hashing.
  }
  var childKeys = []
  if (stats) {
    statKeys = ['stats', stats.mode, stats.size]
  } else {
    statKeys = ['stat failed']
  }
  if (stats && stats.isDirectory()) {
    var fileIdentity = stats.dev + '\x00' + stats.ino
    if (_stack != null && _stack.indexOf(fileIdentity) !== -1) {
      console.warn('Symlink directory loop detected at ' + fullPath + ' (note: loop detection may have false positives on Windows)')
    } else {
      if (_stack != null) _stack = _stack.concat([fileIdentity])
      var entries
      try {
        entries = fs.readdirSync(fullPath).sort()
      } catch (err) {
        console.warn('Warning: Failed to read directory ' + fullPath)
        console.warn(err.stack)
        childKeys = ['readdir failed']
        // That's all there is to say about this directory.
      }
      if (entries != null) {
        for (var i = 0; i < entries.length; i++) {

          var keys = keysForTree(path.join(fullPath, entries[i]), {
            _stack: _stack,
            relativePath: path.join(relativePath, entries[i])
          })
          childKeys = childKeys.concat(keys)
        }
      }
    }
  } else if (stats && stats.isSymbolicLink()) {
    if (_stack == null) {
      // From here on in the traversal, we need to guard against symlink
      // directory loops. _stack is kept null in the absence of symlinks to we
      // don't have to deal with Windows for now, as long as it doesn't use
      // symlinks.
      _stack = []
    }
    childKeys = keysForTree(fullPath, {_stack: _stack, relativePath: relativePath, _followSymlink: true}) // follow symlink
    statKeys.push(stats.mtime.getTime())
  } else if (stats && stats.isFile()) {
    statKeys.push(stats.mtime.getTime())
  }

  // Perhaps we should not use basename to infer the file name
  return ['path', relativePath]
    .concat(statKeys)
    .concat(childKeys)
}
