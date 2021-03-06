/* @requires mapshaper-common, mapshaper-geom */

MapShaper.ArcDataset = ArcDataset;

// An interface for managing a collection of paths.
// Constructor signatures:
//
// ArcDataset(arcs)
//    arcs is an array of polyline arcs; each arc is a two-element array: [[x0,x1,...],[y0,y1,...]
//
// ArcDataset(nn, xx, yy, zz)
//    nn is an array of arc lengths; xx, yy are arrays of concatenated coords;
//    zz (optional) is an array of concatenated simplification thresholds
//
function ArcDataset() {
  var _self = this;
  var _xx, _yy,  // coordinates data
      _ii, _nn,  // indexes, sizes
      _zz, _zlimit = 0, // simplification
      _bb, _allBounds, // bounding boxes
      _arcIter, _shapeIter; // path iterators

  if (arguments.length == 1) {
    initLegacyArcs(arguments[0]);  // want to phase this out
  } else if (arguments.length >= 3) {
    initPathData.apply(this, arguments);
  } else {
    error("ArcDataset() Invalid arguments");
  }

  function initLegacyArcs(coords) {
    var data = convertLegacyArcs(coords);
    initPathData(data.nn, data.xx, data.yy);
  }

  function initPathData(nn, xx, yy, zz) {
    var size = nn.length;
    _xx = xx;
    _yy = yy;
    _nn = nn;
    _zz = zz || new Float64Array(xx.length);

    // generate array of starting idxs of each arc
    _ii = new Uint32Array(size);
    for (var idx = 0, j=0; j<size; j++) {
      _ii[j] = idx;
      idx += nn[j];
    }

    if (idx != _xx.length || _xx.length != _yy.length || _xx.length != _zz.length) {
      error("ArcDataset#initPathData() Counting error");
    }

    initBounds();

    // Pre-allocate some path iterators for repeated use.
    _arcIter = new ArcIter(_xx, _yy, _zz);
    _shapeIter = new ShapeIter(_self);
    return this;
  }

  function initBounds() {
    var data = calcArcBounds(_xx, _yy, _ii, _nn);
    _bb = data.bb;
    _allBounds = data.bounds;
  }

  function calcArcBounds(xx, yy, ii, nn) {
    var numArcs = ii.length,
        bb = new Float64Array(numArcs * 4),
        j, b;
    for (var i=0; i<numArcs; i++) {
      b = MapShaper.calcArcBounds(xx, yy, ii[i], nn[i]);
      j = i * 4;
      bb[j++] = b[0];
      bb[j++] = b[1];
      bb[j++] = b[2];
      bb[j] = b[3];
    }
    var bounds = new Bounds();
    if (numArcs > 0) bounds.setBounds(MapShaper.calcArcBounds(xx, yy));
    return {
      bb: bb,
      bounds: bounds
    };
  }

  function convertLegacyArcs(coords) {
    var numArcs = coords.length;

    // Generate arrays of arc lengths and starting idxs
    var nn = new Uint32Array(numArcs),
        pointCount = 0,
        arc, arcLen;
    for (var i=0; i<numArcs; i++) {
      arc = coords[i];
      arcLen = arc && arc[0].length || 0;
      nn[i] = arcLen;
      pointCount += arcLen;
      if (arcLen === 0) error("#convertArcArrays() Empty arc:", arc);
    }

    // Copy x, y coordinates into long arrays
    var xx = new Float64Array(pointCount),
        yy = new Float64Array(pointCount),
        offs = 0;
    Utils.forEach(coords, function(arc, arcId) {
      var xarr = arc[0],
          yarr = arc[1],
          n = nn[arcId];
      for (var j=0; j<n; j++) {
        xx[offs + j] = xarr[j];
        yy[offs + j] = yarr[j];
      }
      offs += n;
    });

    return {
      xx: xx,
      yy: yy,
      nn: nn
    };
  }

  this.getCopy = function() {
    return new ArcDataset(new Int32Array(_nn), new Float64Array(_xx),
        new Float64Array(_yy), new Float64Array(_zz));
  };

  this.getFilteredCopy = function() {
    var len2 = this.getFilteredPointCount();
    if (len2 == this.getPointCount()) {
      return this.getCopy();
    }

    var xx2 = new Float64Array(len2),
        yy2 = new Float64Array(len2),
        zz2 = new Float64Array(len2),
        nn2 = new Int32Array(this.size()),
        i2 = 0;

    this.forEach2(function(i, n, xx, yy, zz, arcId) {
      var n2 = 0;
      for (var end = i+n; i < end; i++) {
        if (_zz[i] > _zlimit) {
          xx2[i2] = xx[i];
          yy2[i2] = yy[i];
          zz2[i2] = zz[i];
          i2++;
          n2++;
        }
      }
      if (n2 < 2) error("Collapsed arc"); // endpoints should be z == Infinity
      nn2[arcId] = n2;
    });

    return new ArcDataset(nn2, xx2, yy2, zz2);
  };

  // Return arcs as arrays of [x, y] points (intended for testing).
  this.toArray = function() {
    return Utils.map(Utils.range(this.size()), function(i) {
      return _self.getArc(i).toArray();
    });
  };

  // Snap coordinates to a grid of @quanta locations on both axes
  // This may snap nearby points to the same coordinates.
  // Consider a cleanup pass to remove dupes, make sure collapsed arcs are
  //   removed on export.
  //
  this.quantize = function(quanta) {
    var bb1 = this.getBounds(),
        bb2 = new Bounds(0, 0, quanta-1, quanta-1),
        transform = bb1.getTransform(bb2),
        inverse = transform.invert();

    this.applyTransform(transform, true);
    this.applyTransform(inverse);
  };

  // Return average magnitudes of dx, dy
  //
  this.getAverageSegment = function() {
    var count = 0,
        dx = 0,
        dy = 0;
    this.forEach2(function(i, n, xx, yy) {
      for (var end=i+n-1; i<end; i++) {
        dx += Math.abs(xx[i+1] - xx[i]);
        dy += Math.abs(yy[i+1] - yy[i]);
        count++;
      }
    });
    return [dx / count, dy / count];
  };

  // Apply a linear transform to the data, with or without rounding.
  //
  this.applyTransform = function(t, rounding) {
    var xx = _xx, yy = _yy, x, y;
    for (var i=0, n=xx.length; i<n; i++) {
      x = xx[i] * t.mx + t.bx;
      y = yy[i] * t.my + t.by;
      if (rounding) {
        x = Math.round(x);
        y = Math.round(y);
      }
      xx[i] = x;
      yy[i] = y;
    }
    initBounds();
  };

  // Return an ArcIter object for each path in the dataset
  //
  this.forEach = function(cb) {
    for (var i=0, n=this.size(); i<n; i++) {
      cb(this.getArcIter(i), i);
    }
  };

  // Iterate over arcs with access to low-level data
  //
  this.forEach2 = function(cb) {
    for (var arcId=0, n=this.size(); arcId<n; arcId++) {
      cb(_ii[arcId], _nn[arcId], _xx, _yy, _zz, arcId);
    }
  };

  // Remove arcs that don't pass a filter test and re-index arcs
  // Return array mapping original arc ids to re-indexed ids. If arr[n] == -1
  // then arc n was removed. arr[n] == m indicates that the arc at n was
  // moved to index m.
  // Return null if no arcs were re-indexed (and no arcs were removed)
  //
  this.filter = function(cb) {
    var map = new Int32Array(this.size()),
        goodArcs = 0,
        goodPoints = 0,
        iter;
    for (var i=0, n=this.size(); i<n; i++) {
      if (cb(this.getArcIter(i), i)) {
        map[i] = goodArcs++;
        goodPoints += _nn[i];
      } else {
        map[i] = -1;
      }
    }
    if (goodArcs === this.size()) {
      return null;
    } else {
      condenseArcs(map);
      if (goodArcs === 0) {
        // no remaining arcs
      }
      return map;
    }
  };

  function copyElements(src, i, dest, j, n) {
    if (src === dest && j > i) error ("copy error");
    var copied = 0;
    for (var k=0; k<n; k++) {
      copied++;
      dest[k + j] = src[k + i];
    }
  }

  function condenseArcs(map) {
    var goodPoints = 0,
        goodArcs = 0,
        k, arcLen;
    for (var i=0, n=map.length; i<n; i++) {
      k = map[i];
      arcLen = _nn[i];
      if (k > -1) {
        copyElements(_xx, _ii[i], _xx, goodPoints, arcLen);
        copyElements(_yy, _ii[i], _yy, goodPoints, arcLen);
        copyElements(_zz, _ii[i], _zz, goodPoints, arcLen);
        _nn[k] = arcLen;
        goodPoints += arcLen;
        goodArcs++;
      }
    }

    initPathData(_nn.subarray(0, goodArcs), _xx.subarray(0, goodPoints),
        _yy.subarray(0, goodPoints), _zz.subarray(0, goodPoints));
  }

  this.getArcIter = function(arcId) {
    var fw = arcId >= 0,
        i = fw ? arcId : ~arcId,
        start = _ii[i],
        len = _nn[i];

    _arcIter.init(start, len, fw, _zlimit || 0);
    return _arcIter;
  };

  this.getShapeIter = function(ids) {
    var iter = _shapeIter;
    iter.init(ids);
    return iter;
  };

  // Add simplification data to the dataset
  // @thresholds is an array of arrays of removal thresholds for each arc-vertex.
  //
  this.setThresholds = function(thresholds) {
    if (thresholds.length != this.size())
      error("ArcDataset#setThresholds() Mismatched arc/threshold counts.");
    var i = 0;
    Utils.forEach(thresholds, function(arr) {
      var zz = _zz;
      for (var j=0, n=arr.length; j<n; i++, j++) {
        zz[i] = arr[j];
      }
    });

    return this;
  };

  this.setRetainedInterval = function(z) {
    _zlimit = z;
    return this;
  };

  this.setRetainedPct = function(pct) {
    if (pct >= 1) {
      _zlimit = 0;
    } else {
      _zlimit = this.getThresholdByPct(pct);
    }
    return this;
  };

  // Return array of z-values that can be removed for simplification
  //
  this.getRemovableThresholds = function(nth) {
    if (!_zz) error("Missing simplification data");
    var skip = nth | 1,
        arr = new Float64Array(Math.ceil(_zz.length / skip)),
        z;
    for (var i=0, j=0, n=this.getPointCount(); i<n; i+=skip) {
      z = _zz[i];
      if (z != Infinity) {
        arr[j++] = z;
      }
    }
    return arr.subarray(0, j);
  };

  this.getThresholdByPct = function(pct) {
    if (pct <= 0 || pct >= 1) error("Invalid simplification pct:", pct);
    var tmp = this.getRemovableThresholds();
    var k = Math.floor((1 - pct) * tmp.length);
    return Utils.findValueByRank(tmp, k + 1); // rank starts at 1
  };

  this.arcIntersectsBBox = function(i, b1) {
    var b2 = _bb,
        j = i * 4;
    return b2[j] <= b1[2] && b2[j+2] >= b1[0] && b2[j+3] >= b1[1] && b2[j+1] <= b1[3];
  };

  this.arcIsSmaller = function(i, units) {
    var bb = _bb,
        j = i * 4;
    return bb[j+2] - bb[j] < units && bb[j+3] - bb[j+1] < units;
  };

  this.size = function() {
    return _ii && _ii.length || 0;
  };

  this.getPointCount = function() {
    return _xx && _xx.length || 0;
  };

  this.getFilteredPointCount = function() {
    if (!_zz || !_zlimit) return this.getPointCount();
    var count = 0;
    for (var i=0, n = _zz.length; i<n; i++) {
      if (_zz[i] > _zlimit) count++;
    }
    return count;
  };

  this.getBounds = function() {
    return _allBounds;
  };

  this.getArcs = function() {
    var arcs = [];
    for (var i=0, n=this.size(); i<n; i++) {
      arcs.push(new Arc(this).init(i));
    }
    return arcs;
  };

  this.getArc = function(id) {
    return new Arc(this).init(id);
  };

  this.getMultiPathShape = function(arr) {
    if (!arr || arr.length > 0 === false) {
      error("#getMultiPathShape() Missing arc ids");
    } else {
      return new MultiShape(this).init(arr);
    }
  };
}

function Arc(src) {
  this.src = src;
}

Arc.prototype = {
  init: function(id) {
    this.id = id;
    return this;
  },
  pathCount: 1,
  getPathIter: function(i) {
    return this.src.getArcIter(this.id);
  },

  inBounds: function(bbox) {
    return this.src.arcIntersectsBBox(this.id, bbox);
  },

  // Return arc coords as an array of [x, y] points
  toArray: function() {
    var iter = this.getPathIter(),
        coords = [];
    while (iter.hasNext()) {
      coords.push([iter.x, iter.y]);
    }
    return coords;
  },

  smallerThan: function(units) {
    return this.src.arcIsSmaller(this.id, units);
  }
};

//
function MultiShape(src) {
  this.src = src;
}

MultiShape.prototype = {
  init: function(parts) {
    this.pathCount = parts.length;
    this.parts = parts;
    return this;
  },
  getPathIter: function(i) {
    return this.src.getShapeIter(this.parts[i]);
  },
  getPath: function(i) {
    if (i < 0 || i >= this.parts.length) error("MultiShape#getPart() invalid part id:", i);
    return new SimpleShape(this.src).init(this.parts[i]);
  },
  // Return array of SimpleShape objects, one for each path
  getPaths: function() {
    return Utils.map(this.parts, function(ids) {
      return new SimpleShape(this.src).init(ids);
    }, this);
  }
};

function SimpleShape(src) {
  this.src = src;
}

SimpleShape.prototype = {
  pathCount: 1,
  init: function(ids) {
    this.ids = ids;
    return this;
  },
  getPathIter: function() {
    return this.src.getShapeIter(this.ids);
  }
};

// Iterate over the points of an arc
// properties: x, y)
// method: hasNext()
// usage:
//   while (iter.hasNext()) {
//     iter.x, iter.y; // do something w/ x & y
//   }
//
function ArcIter(xx, yy, zz) {
  var _xx = xx,
      _yy = yy,
      _zz = zz,
      _zlim, _len;
  var _i, _inc, _start, _stop;
  this.hasNext = null;

  this.init = function(i, len, fw, zlim) {
    _zlim = zlim;
    this.hasNext = zlim ? nextSimpleIdx : nextIdx;
    if (fw) {
      _start = i;
      _inc = 1;
      _stop = i + len;
    } else {
      _start = i + len - 1;
      _inc = -1;
      _stop = i - 1;
    }
    _i = _start;
  };

  function nextIdx() {
    var i = _i;
    if (i == _stop) return false;
    _i = i + _inc;
    this.x = _xx[i];
    this.y = _yy[i];
    return true;
  }

  function nextSimpleIdx() {
    // using local vars is significantly faster when skipping many points
    var zz = _zz,
        i = _i,
        j = i,
        zlim = _zlim,
        stop = _stop,
        inc = _inc;
    if (i == stop) return false;
    do {
      j += inc;
    } while (j != stop && zz[j] <= zlim);
    _i = j;
    this.x = _xx[i];
    this.y = _yy[i];
    return true;
  }
}

// Iterate along a path made up of one or more arcs.
// Similar interface to ArcIter()
//
function ShapeIter(arcs) {
  var _ids, _arc = null;
  var i, n;

  this.init = function(ids) {
    _ids = ids;
    i = -1;
    n = ids.length;
    _arc = nextArc();
  };

  function nextArc() {
    i += 1;
    return (i < n) ? arcs.getArcIter(_ids[i]) : null;
  }

  this.hasNext = function() {
    while (_arc) {
      if (_arc.hasNext()) {
        this.x = _arc.x;
        this.y = _arc.y;
        return true;
      } else {
        _arc = nextArc();
        if (_arc) _arc.hasNext(); // skip first point of arc
      }
    }
    return false;
  };
}
