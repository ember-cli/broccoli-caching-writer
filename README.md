# Broccoli Caching Writer

[![Build Status](https://travis-ci.org/rwjblue/broccoli-caching-writer.svg?branch=master)](https://travis-ci.org/rwjblue/broccoli-caching-writer)

Adds a thin caching layer based on the computed hash of the input tree. If the input tree has changed,
the `updateCache` method will be called, otherwise (input is the same) the results of the last `updateCache`
call will be used instead.

If you would prefer to perform your plugins work in a non-synchronous way, simply return a promise from `updateCache`.

## Switching from `broccoli-writer`

If your broccoli plugin currently extends `broccoli-writer`,
and you wish to extend `broccoli-caching-writer` instead:

1. Switch the constructor
  - Require this module: `var cachingWriter  = require('broccoli-caching-writer');`
  - Change the prototype to use `cachingWriter`: `MyBroccoliWriter.prototype = Object.create(cachingWriter.prototype);`
  - In the constructor, ensure that you are setting the value `this.inputTree`, if you are not already: `this.inputTree = inputTree`
2. Switch `write` function for an `updateCache` function.
  - Switch the function signatures:
    - From: `MyBroccoliWriter.prototype.write = function(readTree, destDir) {`
    - To: `MyBroccoliWriter.prototype.updateCache = function(srcDir, destDir) {`
  - Get rid of `readTree`, as `srcDir` is already provided:
    - Code that looks like: `return readTree(this.inputTree).then(function (srcDir) { /* Do the main processing */ });`
    - Simply extract the code, `/* Do the main processing */`, and get rid of the function wrapping it.

## ZOMG!!! TESTS?!?!!?

I know, right?

Running the tests:

```javascript
npm install
npm test
```

## License

This project is distributed under the MIT license.
