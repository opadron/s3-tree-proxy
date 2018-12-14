
let S3 = require('aws-sdk/clients/s3');
let http = require('http');

let client = new S3();

const pullAttr = (key) => (obj) => obj[key];

function* iterS3Dir(bucket, prefix='', recursive=false) {
  if (prefix === '/') { prefix = ''; }

  const filter = (key) => (
    key !== prefix &&
    key !== '_' &&
    key.startsWith(prefix)
  );

  const popPrefix = ((n) => (key) => key.substr(n))(prefix.length);

  let args = { Bucket: bucket, Prefix: prefix };
  if (!recursive) {
    args.Delimiter = '/';
  }

  do {
    args.ContinuationToken = yield (
      client.listObjects(args).promise()
        .then(({
          CommonPrefixes: prefixes,
          NextContinuationToken: cToken,
          IsTruncated: truncated,
          Contents: cont
        }) => {
          return Promise.all(
            cont.map(pullAttr('Key')).filter(filter)
              .map(async (key) => {
                let { Grants } = (
                  await client.getObjectAcl({ Bucket: BUCKET, Key: key })
                    .promise());

                let found = false;
                for (let i=0, n=Grants.length; i<n; ++i) {
                  let { Grantee: { Type, URI }, Permission } = Grants[i];

                  found = (
                    Type === 'Group' &&
                    URI ===
                      'http://acs.amazonaws.com/groups/global/AllUsers' &&
                    (Permission === 'READ' || Permission === 'FULL_CONTROL')
                  )

                  if (found) { break; }
                }

                return [popPrefix(key), found];
              })
          ).then((data) => (
            data.filter(([key, found]) => found).map(([key, _]) => key)
          )).then((cont) => [
            cont,
            {
              prefixes: (
                prefixes.map(pullAttr('Prefix'))
                  .filter(filter).map(popPrefix)),
              cToken,
              truncated
            }
          ]);
        })
    );
  } while (args.ContinuationToken);
}


const listS3Dir = async ({bucket, prefix='', recursive=false}, cb) => {
  let iter = iterS3Dir(bucket, prefix, recursive);
  let first = true;

  let result = false;
  let token;

  for (;;) {
    let { value: promise, done } = (
      first ? iter.next() : iter.next(token));

    if (done) { break; }

    let [ keys, { prefixes, cToken } ] = await promise;
    if (first) {
      let n = prefixes.length;
      result = result || Boolean(n);

      for (let i=0; i<n; ++i) {
        cb({ name: prefixes[i], type: 'd' });
      }
    }

    let n = prefixes.length;
    if (first) {
      result = result || Boolean(n);
    }

    for (let i=0, n=keys.length; i<n; ++i) {
      cb({ name: keys[i], type: 'f' });
    }

    token = cToken;
    first = false;
  }

  return result;
};


const checkS3Dir = async (bucket, dir) => {
  if (dir === '/') { dir = ''; }
  let args = { Bucket: bucket, Prefix: dir, MaxKeys: 1 };
  let { Contents: arr } = await client.listObjects(args).promise();
  return Boolean(arr.length);
}


const checkS3Key = async (bucket, key) => {
  try {
    await client.getObject({ Bucket: bucket, Key: key }).promise();
    return true;
  } catch(e) {
    return false;
  }
}


const BUCKET = 'spack-public';
let srv = http.createServer(async (req, res) => {
  let path = req.url.substr(1);
  let dirSemantics = path.endsWith('/');

  if (dirSemantics) {
    path = path.substr(0, path.length - 1);
  }

  if (await checkS3Key(BUCKET, path)) {
    res.writeHead(
      301,
      {
        Location: [
          'http://',
          BUCKET,
          '.s3-website.us-east-2.amazonaws.com/',
          path
        ].join('')
      }
    );
    res.end();
    return;
  }

  let listPath = path + '/';
  let doListing = await checkS3Dir(BUCKET, listPath);

  if (!doListing) {
    let basename = path.replace(/.*\//, '');

    doListing = (basename === 'index.html' || basename === 'index.htm');

    if (doListing) {
      dirSemantics = true;
      listPath = path.substr(0, path.length - basename.length);
    }
  }

  if (doListing) {
    let localPrefix = '';
    if (!dirSemantics) {
      localPrefix = (
        listPath.substr(0, listPath.length - 1).replace(/.*\//, '') + '/');
    }

    res.writeHead(200, {'Content-Type': 'text/html'});

    let indexOfText = `Index of ${listPath}`;
    res.write(`<html><head><title>${ indexOfText }</title></head>`);
    res.write('<body>');
    res.write(`<h3>${ indexOfText }</h3>`);
    res.write('<table>');
    res.write('<tr><th></th><th>Name</th><th>Last modified</th></tr>');
    res.write('<tr><th colspan="3"><hr></th></tr>');

    if (path !== '') {
      res.write('<tr><td valign="top"><img src="');
      res.write('https://ftp.gnu.org/icons/back.gif" ');
      res.write('alt="[PARENTDIR]"></td><td><a href="');
      res.write('..">Parent Directory</a></td><td>&nbsp;</td></tr>');
    }

    await listS3Dir({ bucket: BUCKET, prefix: listPath }, ({ name, type }) => {
      res.write('<tr>');
      res.write('<td valign="top"><img ');
      res.write([
        'src="',
        type === 'f' ? 'https://ftp.gnu.org/icons/text.gif' :
        type === 'd' ? 'https://ftp.gnu.org/icons/folder.gif' :
                       'https://ftp.gnu.org/icons/icons.gif',
        '"'
      ].join(''));
      res.write(' alt="[    ]"></td>');

      if (type === 'd') {
        name = name.substr(0, name.length-1);
      }

      res.write([
        '<td><a href="',
        localPrefix + name,
        '">',
         name,
        '</a></td>'
      ].join(''))

      res.write('<td align="right">0000-00-00 00:00</td></tr>');
    });

    res.write('</table></body></html>');

    res.end();
    return;
  }

  res.writeHead(404, {'Content-Type': 'text/plain'});
  res.end();
});

srv.listen(8080, () => {
  console.log('Listening on port 8080');
});

