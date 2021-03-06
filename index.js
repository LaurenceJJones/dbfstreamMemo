const fs = require('fs');
const iconv = require('iconv-lite');
const util = require('util');
const EventEmitter = require('events').EventEmitter;
const Readable = require('stream').Readable;
const isStream = require('is-stream');
const MemoFile = require('memo_file');

let memoFile;
let stream;

const fileTypes = {
  2: 'FoxBASE',
  3: 'FoxBASE+/Dbase III plus, no memo',
  48: 'Visual FoxPro',
  49: 'Visual FoxPro, autoincrement enabled',
  50: 'Visual FoxPro with field type Varchar or Varbinary',
  67: 'dBASE IV SQL table files, no memo',
  99: 'dBASE IV SQL system files, no memo',
  131: 'FoxBASE+/dBASE III PLUS, with memo',
  139: 'dBASE IV with memo',
  203: 'dBASE IV SQL table files, with memo',
  245: 'FoxPro 2.x (or earlier) with memo',
  229: 'HiPer-Six format with SMT memo file',
  251: 'FoxBASE',
};

const parseFileType = (buffer) => fileTypes[buffer.readUInt8(0, true)] ?
  fileTypes[buffer.readUInt8(0, true)] :
  'uknown';

const parseDate = (buffer) => new Date(
  buffer.readUInt8(0, true) + 1900, // year
  buffer.readUInt8(1, true) - 1, // month
  buffer.readUInt8(2, true) // date
);

// 12 – 27: Reserved
// 28: Table flags
// 29: Code page mark
// 30 - 31: Reserved, contains 0x00
const getHeader = (readStream) => {
  const buffer = readStream.read(32);

  if (!buffer) {
    throw `Unable to parse first 32 bytes from null header`;
  }
  if (buffer.length < 32) {
    throw `Unable to parse first 32 bytes from header, found ${buffer.length} byte(s)`;
  }

  return {
    type: parseFileType(buffer),
    dateUpdated: parseDate(buffer.slice(1, 4)),
    numberOfRecords: buffer.readInt32LE(4, true),
    bytesOfHeader: buffer.readInt16LE(8, true),
    LengthPerRecord: buffer.readInt16LE(10, true),
  };
};

// 19 - 22	Value of autoincrement Next value
// 23	Value of autoincrement Step value
// 24 – 31	Reserved
const getField = (buffer) => (
  buffer.length < 32 ?
  undefined : {
    name: buffer.toString('utf-8', 0, 11).replace(/[\u0000]+$/, ''),
    type: buffer.toString('utf-8', 11, 12),
    displacement: buffer.readInt32LE(12, true),
    length: buffer.readUInt8(16, true),
    decimalPlaces: buffer.readUInt8(17, true),
    flag: buffer.readUInt8(18, true),
  }
);

const getListOfFields = (readStream, bytesOfHeader) => {
  const buffer = readStream.read(bytesOfHeader - 32);
  const ListOfFields = [];

  for (let i = 0, len = buffer.length; i < len; i += 32) {
    let field;
    if (field = getField(buffer.slice(i, i + 32))) {
      ListOfFields.push(field);
    }
  }
  return ListOfFields;
};

const dataTypes = {
  C(data) {
    return data;
  },
  N(data) {
    return +data;
  },
  L(data) {
    return data.toLowerCase() === 't';
  },
  M(data) {
    try {
      return data !== 0 && memoFile !== null ? memoFile.getBlockContentAt(parseInt(data)).replace(/[\u0000]+$/, '').trim() : '';
    }catch(err){
      stream.emit('error', err);
      return '';
    }
  }
};

const parseDataByType = (data, type) => (
  dataTypes[type] ?
  dataTypes[type](data) :
  data // default
);

const convertToObject = (data, ListOfFields, encoding, numOfRecord) => {
  const row = {
    '@numOfRecord': numOfRecord,
    '@deleted': data.slice(0, 1)[0] !== 32,
  };

  ListOfFields.reduce(function (acc, now) {
    const value = iconv
      .decode(data.slice(acc, acc + now.length), encoding)
      .replace(/^\s+|\s+$/g, '');
    try {
      // Added test of now.length to try to catch sometimes when the memo field can be a string with ten length
      row[now.name] = parseDataByType(now.type !== 'M' && now.length !== 4 ? value.replace(/[\u0000]+$/, '').trim() : data.readInt32LE(acc, true), now.type);
    } catch (err) {
      stream.emit('error', err);
      //if error on buffer most likely set buffer to result 0 //temp fix//
      row[now.name] = parseDataByType(now.type !== 'M' && now.length === 4 ? value.replace(/[\u0000]+$/, '').trim() : 0, now.type);
    }
    return acc + now.length;
  }, 1);

  return row;
};

const dbfStream = (source, encoding = 'utf-8') => {
  util.inherits(Readable, EventEmitter);
  stream = new Readable({
    objectMode: true
  });
  // check if source is stream
  const isReadable = isStream.readable(source)
  // if source is already a readableStream, use it, otherwise treat as a filename
  const readStream = isReadable  ? source : fs.createReadStream(source);
  const filePath = isReadable ? source.path : source;
  
  let path = `${filePath.slice(0, filePath.indexOf('.'))}.fpt`;
  // check if path fpt exists if not throw err else try read
  fs.access(path, fs.constants.F_OK, (err) => {
    if (err){
      stream.emit('error', `No FPT found at ${path}`)
      return;
    }
    try {
      memoFile = new MemoFile(path)
    }catch(err){
      memoFile = null;
      stream.emit('error', `FPT found at ${path} but failed to load`)
    }
  });


  let numOfRecord = 1; //row number numOfRecord

  const onData = () => {
    if (stream.header) {
      let chunk;
      while (null !== (chunk = readStream.read(stream.header.LengthPerRecord))) {
        stream.push(convertToObject(chunk, stream.header.listOfFields, encoding, numOfRecord++));
      }
    }
  }

  readStream._maxListeners = Infinity;
  //read file header first
  readStream.once('readable', () => {
    try {
      stream.header = getHeader(readStream);
      stream.header.listOfFields = getListOfFields(readStream, stream.header.bytesOfHeader);
      stream.emit('header', stream.header);
    } catch (err) {
      stream.emit('error', err);
    }
  });

  readStream.once('end', () => {
    readStream.removeListener('readable', onData);
    stream.push(null)
  });

  stream._read = () => {
    readStream.on('readable', onData);
  };

  return stream;
};

module.exports = dbfStream;