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

		let pool = connection.getPool();
		if (!pool)
			return;


		(async () => {

			try {
				let rs = await request(connection, pool, req.body.query);

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

function request(connection, pool, query) {

	return new Promise((resolve, reject) => {

		let opts = {
			sql: query,
			ArraySize: 1000,
		}

		// Create request
		pool.request().then(conn => {
			conn.query(opts, (err, rows) => {

				if (err) {

					reject(err);
				} else {

					resolve({
						finished: true,
						recordset: rows,
						rowsAffected: rows.length,
						//rowsAffected: rowsAffected,
					});
				}
			});
			connection.releasePool(conn);
		});
	});
}
