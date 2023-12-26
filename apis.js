module.exports = {
	init: init 
};

function init(RED) {
	var prefix = '/nodes/atomic-informix/apis';

	RED.httpAdmin.post(prefix + '/execute', RED.auth.needsPermission('flows.write'), function(req, res) {

		let connection = RED.nodes.getNode(req.body.connection);
		if (!connection) {
			res.end();
			return;
		}

		(async () => {

			console.log('Executing query: ' + req.body.query);

			try {
				let rs = await request(connection, req.body.query);

				res.json({
					success: true,
					finished: rs.finished,
					results: rs.recordset || [],
					rowsAffected: rs.rowsAffected,
				});
			} catch(e) {
				console.error(e);

				res.json({
					success: false,
					error: {
						state: e.state,
						message: e.toString()
					}
				});
			}

		})();
	});
}

function request(connection, query) {

	return new Promise((resolve, reject) => {

		let opts = {
			sql: query,
			ArraySize: 1000,
		}

		// Create request
		connection.getConnection()
			.then(conn => {

				// Execute query
				conn.query(opts, (err, rows) => {

					if (err) {
						return reject(err);
					}

					// Return connection to pool
					conn.close((err) => {
						if (err) {
							node.error(err, msg);
						}
					});

					resolve({
						finished: true,
						recordset: rows,
						rowsAffected: rows.length,
						//rowsAffected: rowsAffected,
					});
				})
			})
			.catch(err => {
				reject(err);
			});
	});
}
