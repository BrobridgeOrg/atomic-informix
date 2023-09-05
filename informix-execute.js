module.exports = function(RED) {

	function genQueryCmd() {
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

		node.on('input', async (msg, send, done) => {

			if (node.config.querySource === 'dynamic' && !msg.query)
				return;

			let pool = node.connection.getPool();
			if (!pool)
				return;

			let tpl = node.tpl;
			if (msg.query) {
				// higher priority for msg.query
				tpl = sanitizedCmd(msg.query);
			}

			try {
				node.status({
					fill: 'blue',
					shape: 'dot',
					text: 'requesting'
				});

				let request = await pool.request();
				let rs = await request.query.apply(request, genQueryCmdParameters(tpl, msg));

				node.status({
					fill: 'green',
					shape: 'dot',
					text: 'done'
				});

				// Preparing result
				if (node.config.outputPropType == 'msg') {
					msg[node.config.outputProp] = {
						results: rs.recordset || [],
						rowsAffected: rs.rowsAffected,
					}
				}

				node.send(msg);

				done();
			} catch(e) {
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
			}
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
