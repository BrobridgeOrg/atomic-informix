var ibmdb = require('ibm_db');

let connStr = 'DRIVER={DB2};PROTOCOL=TCPIP;DATABASE=sysadmin;HOSTNAME=localhost;PORT=9088;UID=informix;PWD=ifx_pas';
ibmdb.open(connStr, function (err,conn) {
  if (err) return console.log(err);

  conn.query('select * from staff where id = ?', [10], function (err, data) {
    if (err) console.log(err);

    console.log(data);

    conn.close(function () {
      console.log('done');
    });
  });
});
