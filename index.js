var Buffer = require('buffer').Buffer;

function WBuf() {
  this.buffers = [];
  this.toReserve = 0;
  this.size = 0;
  this.maxSize = 0;
  this.avail = 0;

  this.last = null;
  this.offset = 0;

  // Mostly a constant
  this.reserveRate = 64;
}
module.exports = WBuf;

WBuf.prototype.reserve = function reserve(n) {
  this.toReserve += n;
};

WBuf.prototype._ensure = function _ensure(n) {
  if (this.avail >= n)
    return;

  if (this.toReserve === 0)
    this.toReserve = this.reserveRate;

  this.toReserve = Math.max(n - this.avail, this.toReserve);

  if (this.avail === 0)
    this._next();
};

WBuf.prototype._next = function _next() {
  var buf = new Buffer(this.toReserve);
  this.toReserve = 0;

  this.buffers.push(buf);
  this.avail = buf.length;
  this.offset = 0;
  this.last = buf;
};

WBuf.prototype._rangeCheck = function _rangeCheck() {
  if (this.maxSize !== 0 && this.size > this.maxSize)
    throw new RangeError('WBuf overflow');
};

WBuf.prototype._move = function _move(n) {
  this.size += n;
  this.avail -= n;
  if (this.avail === 0)
    this.last = null;

  this._rangeCheck();
};

WBuf.prototype.slice = function slice(start, end) {
  if (this.last === null)
    this._next();

  var res = new WBuf();
  res.buffers.push(this.last);
  res.last = this.last;
  res.offset = this.offset;
  res.maxSize = end - start;
  res.avail = res.maxSize;

  return res;
};

WBuf.prototype.skip = function skip(n) {
  if (n === 0)
    return;
  this._ensure(n);

  var res = this.slice(this.size, this.size + n);

  var left = n;
  while (left > 0) {
    var toSkip = Math.min(left, this.avail);
    left -= toSkip;
    this.size += toSkip;
    if (toSkip === this.avail) {
      if (left !== 0)
        this._next();
      else
        this.avail -= toSkip;
    } else {
      this.offset += toSkip;
      this.avail -= toSkip;
    }
  }

  this._rangeCheck();

  return res;
};

WBuf.prototype.write = function write(str) {
  var len = 0;
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c > 255)
      len += 2;
    else
      len += 1;
  }
  this.reserve(len);
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    var hi = c >>> 8;
    var lo = c & 0xff;

    if (hi)
      this.writeUInt8(hi);
    this.writeUInt8(lo);
  }
};

WBuf.prototype.copyFrom = function copyFrom(buf, start, end) {
  var off = start === undefined ? 0 : start;
  var len = end === undefined ? buf.length : end;
  if (off === len)
    return;

  this._ensure(len - off);
  while (off < len) {
    var toCopy = Math.min(len - off, this.avail);
    buf.copy(this.last, this.offset, off, off + toCopy);
    off += toCopy;
    this.size += toCopy;
    if (toCopy === this.avail) {
      if (off !== len)
        this._next();
      else
        this.avail = 0;
    } else {
      this.offset += toCopy;
      this.avail -= toCopy;
    }
  }

  this._rangeCheck();
};

WBuf.prototype.writeUInt8 = function writeUInt8(v) {
  this._ensure(1);

  this.last[this.offset++] = v;
  this._move(1);
};

WBuf.prototype.writeUInt16BE = function writeUInt16BE(v) {
  this._ensure(2);

  // Fast case - everything fits into the last buffer
  if (this.avail >= 2) {
    this.last.writeUInt16BE(v, this.offset, true);
    this.offset += 2;

  // One byte here, one byte there
  } else {
    this.last[this.offset] = (v >>> 8);
    this._next();
    this.last[this.offset++] = v & 0xff;
  }

  this._move(2);
};

WBuf.prototype.writeUInt24BE = function writeUInt24BE(v) {
  this._ensure(3);

  // Fast case - everything fits into the last buffer
  if (this.avail >= 3) {
    this.last.writeUInt16BE(v >>> 8, this.offset, true);
    this.last[this.offset + 2] = v & 0xff;
    this.offset += 3;
    this._move(3);

  // Two bytes here
  } else if (this.avail >= 2) {
    this.last.writeUInt16BE(v >>> 8, this.offset, true);
    this._next();
    this.last[this.offset++] = v & 0xff;
    this._move(3);

  // Just one byte here
  } else {
    this.last[this.offset] = v >>> 16;
    this._move(1);
    this._next();
    this.writeUInt16BE(v & 0xffff);
  }
};

WBuf.prototype.writeUInt32BE = function writeUInt32BE(v) {
  this._ensure(4);

  // Fast case - everything fits into the last buffer
  if (this.offset + 4 <= this.last.length) {
    this.last.writeUInt32BE(v, this.offset, true);
    this.offset += 4;
    this._move(4);

  // Three bytes here
  } else if (this.offset + 3 <= this.last.length) {
    this.writeUInt24BE(v >>> 8);
    this.last[this.offset++] = v & 0xff;
    this._move(1);

  // Slow case, who cares
  } else {
    this.writeUInt16BE(v >>> 16);
    this.writeUInt16BE(v & 0xffff);
  }
};

WBuf.prototype.render = function render() {
  var left = this.size;
  var out = [];

  for (var i = 0; i < this.buffers.length && left >= 0; i++) {
    var buf = this.buffers[i];
    left -= buf.length;
    if (left >= 0) {
      out.push(buf);
    } else {
      out.push(buf.slice(0, left));
    }
  }

  return out;
};
