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

        // Track last message state to avoid duplicate complete messages
        this.lastMessageComplete = false;

        // Register the node as a Atomic Component
        atomicSDK.registerAtomicComponent(node);
        atomicSDK.enableSessionManager(node);

        // Get the session manager
        let sm = node.atomic.getModule('SessionManager');

        // Helper function to update node status
        const updateStatus = (fill, shape, text) => {
            node.status({
                fill: fill,
                shape: shape,
                text: text
            });
        };

        if (!this.connection) {
            updateStatus('red', 'ring', 'no connection configured');
            return;
        }

        // Test connection and update status accordingly
        const testConnection = async () => {
            updateStatus('yellow', 'ring', 'testing connection');
            
            try {
                // Test if we can get a connection
                const testConn = await node.connection.getConnection();
                if (testConn) {
                    testConn.close(); // Close test connection immediately
                    updateStatus('green', 'ring', 'connection ready');
                    return true;
                }
            } catch (e) {
                console.log('[Informix Connection Test]', e.message);
                updateStatus('red', 'ring', 'connection failed');
                return false;
            }
        };

        // Initial connection test
        testConnection();

        // Monitor connection status changes
        if (this.connection.client) {
            this.connection.client.on('connected', () => {
                updateStatus('green', 'ring', 'connection ready');
            });

            this.connection.client.on('disconnect', () => {
                updateStatus('red', 'ring', 'disconnected');
            });

            this.connection.client.on('reconnect', () => {
                updateStatus('yellow', 'ring', 'reconnecting');
            });

            this.connection.client.on('error', (err) => {
                updateStatus('red', 'ring', `connection error: ${err.message}`);
            });
        }

		node.on('input', async (msg, send, done) => {

            if (node.config.querySource === 'dynamic' && !msg.query) {
                updateStatus('yellow', 'ring', 'no query provided');
                return;
            }

            let conn = null;
            try {
                updateStatus('blue', 'ring', 'getting connection');
                conn = await node.connection.getConnection();
                updateStatus('blue', 'dot', 'connection acquired');
            } catch (e) {
                console.error('[Informix Connect Error]', e.stack);
                updateStatus('red', 'ring', 'connection failed');
                done(e);
                return;
            }

            let tpl = node.tpl;
            if (msg.query) {
                // higher priority for msg.query
                tpl = sanitizedCmd(msg.query);
            }

            updateStatus('blue', 'dot', 'starting execution');

            // Reset last message state for new execution
            node.lastMessageComplete = false;

            // Preparing request
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
                updateStatus('blue', 'dot', 'execution resumed');
                if (request.streamObj && request.streamObj.readable) {
                    request.streamObj.resume();
                }
              });

              session.once('close', function() {
                updateStatus('yellow', 'ring', 'session closing');
                request.cancelled = true;
                
                // Only send break signal if last message was not complete
                if (!node.lastMessageComplete && node.config.outputPropType == 'msg') {
                    let breakMsg = Object.assign({}, msg);
                    breakMsg[node.config.outputProp] = {
                        results: [],
                        rowsAffected: 0,
                        complete: true,
                        break: true
                    };
                    node.send(breakMsg);
                    updateStatus('yellow', 'dot', 'break signal sent');
                } else {
                    updateStatus('yellow', 'dot', 'session closed (no break needed)');
                }
                
                if (request.streamObj) {
                    request.streamObj.destroy();
                }
                if (request.conn) {
                    request.conn.close();
                }
                updateStatus('grey', 'ring', 'session closed');
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
                    updateStatus('blue', 'ring', 'stream paused');
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

                    // Track message state
                    node.lastMessageComplete = false;

                    updateStatus('blue', 'dot', `streaming (${rows.length} records)`);

                    node.send(m);

                    // Reset buffer
                    rows = [];
                }
            };

            // Simulate request.on('done') event handling
            const handleDoneEvent = (returnedValue) => {
                if (err) {
                    updateStatus('red', 'ring', 'execution failed');
                    done(err);
                    return;
                }

                updateStatus('green', 'dot', `completed (${returnedValue || rows.length} records)`);

                // Preparing result
                if (node.config.outputPropType == 'msg') {
                    msg[node.config.outputProp] = {
                        results: rows,
                        rowsAffected: returnedValue || rows.length,
                        complete: true,
                    }

                    // Track that we sent a complete message
                    node.lastMessageComplete = true;
                }

                node.send(msg);

                if (session) {
                  session.close();
                } else if (request.conn) {
                    request.conn.close();
                }

                // Reset buffer
                rows = [];

                // Return to ready state after completion
                setTimeout(() => {
                    updateStatus('green', 'ring', 'ready');
                }, 1000);

                done();
            };

            // Simulate request.on('error') event handling
            const handleErrorEvent = (e) => {
              console.error('[Informix Query Error Stack]', e.stack);

              updateStatus('red', 'ring', `error: ${e.message || e.toString()}`);

              if (session) {
                session.close();
              } else if (request.conn) {
                request.conn.close();
              }

              // Reset buffer
              rows = [];

              err = e;

              msg.error = {
                code: err.sqlcode || err.code,
                lineNumber: err.lineNumber,
                message: err.message,
                name: err.name,
                number: err.number || err.sqlcode,
              };

              // Mark that we didn't send a complete message due to error
              node.lastMessageComplete = false;

              node.send(msg);

              // Return to ready state after error handling
              setTimeout(() => {
                  updateStatus('yellow', 'ring', 'error handled');
                  // Test connection again after error
                  setTimeout(() => {
                      testConnection();
                  }, 1000);
              }, 2000);
            };

            let sql = null;
            try {
                updateStatus('blue', 'dot', 'preparing query');
                sql = genQueryCmdParameters(tpl, msg);
            } catch (e) {
                updateStatus('red', 'ring', 'query preparation failed');
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
                    updateStatus('blue', 'dot', 'starting stream');
                    // Use queryStream for streaming, but wrap it to match MSSQL request pattern
                    request.streamObj = request.conn.queryStream(sql[0], sql[1] || []);
                    
                    request.streamObj.on('data', (row) => {
                        if (request.cancelled) return;
                        handleRowEvent(row);
                    });

                    request.streamObj.once('end', () => {
                        if (request.cancelled) return;
                        updateStatus('blue', 'dot', 'stream completed');
                        handleDoneEvent(rows.length);
                    });

                    request.streamObj.once('error', (e) => {
                        if (request.cancelled) return;
                        updateStatus('red', 'ring', 'stream error');
                        handleErrorEvent(e);
                    });

                } catch (e) {
                    updateStatus('red', 'ring', 'stream creation failed');
                    handleErrorEvent(e);
                }
            } else {
                // For non-streaming, use callback but process through the same event handlers
                updateStatus('blue', 'dot', 'executing query');
                sql[2] = (queryErr, rs) => {
                    if (queryErr) {
                        updateStatus('red', 'ring', 'query execution failed');
                        handleErrorEvent(queryErr);
                        return;
                    }

                    updateStatus('blue', 'dot', 'processing results');

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
          updateStatus('grey', 'ring', 'shutting down');

          // Release all sessions
          for (let session of sm.sessions) {
            session.close();
            if (session.request && session.request.conn) {
                session.request.conn.close();
            }
          }

          atomicSDK.releaseNode(node);
          updateStatus('grey', 'ring', 'shutdown complete');
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
