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

		if (!this.connection) {
			node.status({
				fill: 'red',
				shape: 'ring',
				text: 'disconnected'
			});
			return;
		}

		node.on('input', (msg, send, done) => {

			if (node.config.querySource === 'dynamic' && !msg.query)
				return;

			let tpl = node.tpl;
			if (msg.query) {
				// higher priority for msg.query
				tpl = sanitizedCmd(msg.query);
			}

			node.connection.getConnection()
				.then(conn => {

					node.status({
						fill: 'blue',
						shape: 'dot',
						text: 'requesting'
					});

					let q = genQueryCmdParameters(tpl, msg);

					// append callback function
					q[2] = (err, rs) => {
						if (err) {
							node.status({
								fill: 'red',
								shape: 'ring',
								text: err.toString()
							});

							msg.errorCode = err.sqlcode;
							node.error(err, msg);
							return done();
						}

						node.status({
							fill: 'green',
							shape: 'dot',
							text: 'done'
						});

						// Preparing result
						if (node.config.outputPropType == 'msg') {
							msg[node.config.outputProp] = {
								results: rs || [],
							}
						}

						// Return connection to pool
						conn.close((err) => {
							if (err) {
								node.error(err, msg);
							}
						});

						node.send(msg);
						done();
					};

					// execute query
					conn.query.apply(conn, q);

				})
				.catch(e => {
					node.status({
						fill: 'red',
						shape: 'ring',
						text: e.toString()
					});

					node.send({
						error: e
					})

					console.log(e.code);

					done(e);
				})
		});

		node.on('close', async () => {
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
