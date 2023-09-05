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
				let rs = await request(pool, req.body.query);

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
						class: e.originalError.info.class,
						state: e.originalError.info.state,
						number: e.originalError.info.number,
						lineNumber: e.originalError.info.lineNumber,
						message: e.originalError.info.message
					}
				});
			}
		})();
	});
}

function request(pool, query) {

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
					return;
				}

				resolve({
					finished: true,
					recordset: rows,
					rowsAffected: rowsAffected,
				});
			});
		});
	});
}
