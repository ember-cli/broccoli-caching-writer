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
    var inputTreeKeys = relativeKeysForTree(srcDir);
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

function relativeKeysForTree (root, relativePath, _stack, _followSymlink) {
  var stats, statKeys
  if (!relativePath) { relativePath = ''; }
  var fullPath = path.join(root, relativePath);
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
          childKeys = childKeys.concat(relativeKeysForTree(root, path.join(relativePath, entries[i]), _stack))
        }
      }
    }
    statKeys = ['dir - stats', stats.mode, stats.size];
  } else if (stats && stats.isSymbolicLink()) {
    if (_stack == null) {
      // From here on in the traversal, we need to guard against symlink
      // directory loops. _stack is kept null in the absence of symlinks to we
      // don't have to deal with Windows for now, as long as it doesn't use
      // symlinks.
      _stack = []
    }
    childKeys = relativeKeysForTree(root, relativePath, _stack, true) // follow symlink
  }

  if (!statKeys) {
    statKeys = ['stats', stats.mode, stats.size, stats.mtime.getTime()];
  }
  // Perhaps we should not use basename to infer the file name
  return ['path', path.basename(relativePath)]
    .concat(stats ? statKeys : ['stat failed'])
    .concat(childKeys)
}
