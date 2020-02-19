## MEMO SUPPORT ADDED FOR File type 48 'Visual FoxPro'

DBFStream
===
This is a stream base .dbf Parser
Based on https://github.com/tamtakoe/node-dbf

# How to Add

### npm i dbfstreammemo
## OR
### yarn add dbfstreammemo

# Usage

### creat dbf stream:

@source: dbf file path / readable stream
`const dbf = dbfstream(source, encoding);`

```js
const dbfstream = require('dbfstream');

var dbf = dbfstream('./test.dbf', 'utf-8');
```

### get dbf file header:

```js
dbf.on('header', header => {
  console.log(header);
});
```

### get dbf file data:

```js
dbf.on('readable', () => {
  console.log(stream.read());
});

//or flowing mode
dbf.on('data', (data) => {
    console.log(data);
});
```

### get dbf file error

```js
dbf.on('error', (err) => {
  console.log(err);
});
```

* Due to how the parser is written, currently the only condition that emits an error is insufficient bytes in the header.  

### dbf file stream end:

```js
dbf.on('end', () => {
    console.log('stream end');
});
```
