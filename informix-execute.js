const atomicSDK = require('@brobridge/atomic-sdk');

module.exports = function(RED) {

	function genQueryCmd() {
		//return arguments
		arguments[0] = arguments[0].join('?');
		arguments[1] = Array.prototype.slice.call(arguments, 1);
		return Array.from(arguments);
	}

	function genQueryCmdParameters(tpl, msg) {
		return eval('genQueryCmd`' + tpl + '`');
	}

	function sanitizedCmd(raw) {
		return raw.replaceAll('\`', '\\\`');
	}

    function ExecuteNode(config) {
        RED.nodes.createNode(this, config);

        var node = this;
		this.connection = RED.nodes.getNode(config.connection)
		this.config = config;
		this.config.outputPropType = config.outputPropType || 'msg';
		this.config.outputProp = config.outputProp || 'payload';
		this.tpl = sanitizedCmd(node.config.command) || '';

        this.config.maxbatchrecords = parseInt(config.maxbatchrecords) || 100;
        this.config.stream = (config.deliveryMethod == 'streaming') ? true : false;

        // Register the node as a Atomic Component
        atomicSDK.registerAtomicComponent(node);
        atomicSDK.enableSessionManager(node);

        // Get the session manager
        let sm = node.atomic.getModule('SessionManager');

        if (!this.connection) {
            node.status({
                fill: 'red',
                shape: 'ring',
                text: 'disconnected'
            });
            return;
        }

		node.on('input', async (msg, send, done) => {

            if (node.config.querySource === 'dynamic' && !msg.query)
                return;

            let conn = null;
            try {
                conn = await node.connection.getConnection();
            } catch (e) {
                console.error('[Informix Connect Error]', e.stack);
                node.status({ fill: 'red', shape: 'ring', text: e.toString() });
                done(e);
                return;
            }

            let tpl = node.tpl;
            if (msg.query) {
                // higher priority for msg.query
                tpl = sanitizedCmd(msg.query);
            }

            node.status({
                fill: 'blue',
                shape: 'dot',
                text: 'requesting'
            });

            // Prparing request
            let err = null;
            let rows = [];
            let request = {
                stream: true,
                conn: conn,
                cancelled: false
            };

            // Create a session for the reader
            let session = (node.config.stream) ? sm.createSession() : null;
            if (session) {
              session.request = request;
              session.on('resume', function() {
                if (request.streamObj && request.streamObj.readable) {
                    request.streamObj.resume();
                }
              });

              session.once('close', function() {
                request.cancelled = true;
                if (request.streamObj) {
                    request.streamObj.destroy();
                }
                if (request.conn) {
                    request.conn.close();
                }
                done();
              });
            }

            // Simulate request.on('row') event handling
            const handleRowEvent = (row) => {
                rows.push(row);

                // not streaming
                if (!node.config.stream)
                    return;

                if (rows.length < node.config.maxbatchrecords)
                    return;

                if (request.streamObj && request.streamObj.pause) {
                    request.streamObj.pause();
                }

                if (node.config.outputPropType == 'msg') {
                    let m = Object.assign({}, msg);
                    if (session) {
                      session.bindMessage(m);
                    }

                    m[node.config.outputProp] = {
                        results: rows,
                        rowsAffected: rows.length,
                        complete: false,
                    }

                    node.status({
                        fill: 'blue',
                        shape: 'dot',
                        text: 'streaming'
                    });

                    node.send(m);

                    // Reset buffer
                    rows = [];
                }
            };

            // Simulate request.on('done') event handling
            const handleDoneEvent = (returnedValue) => {
                if (err) {
                    done(err);
                    return;
                }

                node.status({
                    fill: 'green',
                    shape: 'dot',
                    text: 'done'
                });

                // Preparing result
                if (node.config.outputPropType == 'msg') {
                    msg[node.config.outputProp] = {
                        results: rows,
                        rowsAffected: returnedValue || rows.length,
                        complete: true,
                    }
                }

                node.send(msg);

                if (session) {
                  session.close();
                } else if (request.conn) {
                    request.conn.close();
                }

                // Reset buffer
                rows = [];

                done();
            };

            // Simulate request.on('error') event handling
            const handleErrorEvent = (e) => {
              console.error('[Informix Query Error Stack]', e.stack);

              if (session) {
                session.close();
              } else if (request.conn) {
                request.conn.close();
              }

              // Reset buffer
              rows = [];

              err = e;

              node.status({
                fill: 'red',
                shape: 'ring',
                text: err.toString()
              });

              msg.error = {
                code: err.sqlcode || err.code,
                lineNumber: err.lineNumber,
                message: err.message,
                name: err.name,
                number: err.number || err.sqlcode,
              };

              node.send(msg);
            };

            let sql = null;
            try {
                sql = genQueryCmdParameters(tpl, msg);
            } catch (e) {
                node.error(e);
                if (request.conn) {
                    request.conn.close();
                }
                done();
                return
            }

            // Execute SQL command - adapting Informix API to match MSSQL pattern
            if (node.config.stream) {
                try {
                    // Use queryStream for streaming, but wrap it to match MSSQL request pattern
                    request.streamObj = request.conn.queryStream(sql[0], sql[1] || []);
                    
                    request.streamObj.on('data', (row) => {
                        if (request.cancelled) return;
                        handleRowEvent(row);
                    });

                    request.streamObj.once('end', () => {
                        if (request.cancelled) return;
                        handleDoneEvent(rows.length);
                    });

                    request.streamObj.once('error', (e) => {
                        if (request.cancelled) return;
                        handleErrorEvent(e);
                    });

                } catch (e) {
                    handleErrorEvent(e);
                }
            } else {
                // For non-streaming, use callback but process through the same event handlers
                sql[2] = (queryErr, rs) => {
                    if (queryErr) {
                        handleErrorEvent(queryErr);
                        return;
                    }

                    // Process all rows through the row handler
                    if (rs && rs.length > 0) {
                        rs.forEach(row => handleRowEvent(row));
                    }

                    handleDoneEvent(rs ? rs.length : 0);
                };

                // Execute query
                request.conn.query.apply(request.conn, sql);
            }
        });

        node.on('close', async () => {

          // Release all sessions
          for (let session of sm.sessions) {
            session.close();
            if (session.request && session.request.conn) {
                session.request.conn.close();
            }
          }

          atomicSDK.releaseNode(node);
        });
    }

	// Admin API
	const api = require('./apis');
	api.init(RED);

    RED.nodes.registerType('Informix Execute', ExecuteNode, {
		credentials: {
		}
	});
}
