const events = require('events');
const util = require('util');
const ibmdb = require('ibm_db');
//const genericPool = require("generic-pool");

module.exports = class Client extends events.EventEmitter {

	constructor(conn = null, opts = {}) {
		super();

		this.opts = Object.assign({
			server: '0.0.0.0',
			port: 9088,
			database: '',
			maxPoolSize: 10,
			minPoolSize: 1,
			connectionRetryInterval: 10000,
		}, opts.connection, {
			auth: Object.assign({
				type: 'default',
				username: '',
				password: '',
			}, opts.connection.auth || {})
		});

		this.status = 'disconnected';
		this.timer = null;
/*
		this.pool = genericPool.createPool(this.prepareFactory(), {
			min: this.opts.minPoolSize,
			max: this.opts.maxPoolSize,
		});
*/
		this.pool = new ibmdb.Pool();
	}
/*
	prepareFactory() {
		return {
			create: () => {
				return this.createClient();
			},
			destroy: (conn) => {
				conn.close();
			}
		};
	}
*/
	getConnectionConfigs() {

		// Preparing configurations
		let configs = {
			PROTOCOL: 'TCPIP',
			DATABASE: this.opts.database,
			HOSTNAME: this.opts.server,
			PORT: this.opts.port,
			UID: this.opts.auth.username || '',
			PWD: this.opts.auth.password || '',
		}

		return Object.entries(configs)
			.map(entry => {
				return entry.join('=');
			})
			.join(';');
	}
/*
	acquire() {
		return new Promise(async (resolve, reject) => {

			if (this.status == 'disconnected') {

				// Waiting for connecting
				this.on('connected', () => {
					let conn = await this.pool.acquire();
					resolve(conn);
				});

				return;
			}

			let conn = await this.pool.acquire();
			resolve(conn);
		});
	}

	getPool() {
		return {
			request: () => {
				return this.pool.acquire();
			}
		};
	}
	*/

	releasePool(conn) {
		this.pool.release(conn);
	}

	createClient() {
		return ibmdb.open(this.getConnectionConfigs());
	}

	getConnection() {
		return this.pool.open(this.getConnectionConfigs());
	}

	attemptReconnect() {

		clearTimeout(this.timer);

		// Reconnecting
		this.timer = setTimeout(() => {

			this.emit('reconnect')
			this.connect();
		}, this.opts.connectionRetryInterval);
	}

	connect() {

		console.log('connecing', this.getConnectionConfigs());

		this.pool.open(this.getConnectionConfigs(), (err, db) => {

			if (err) {
				this.status = 'disconnected';

				console.log('Failed to connect to database');
				console.log(err);

				this.emit('error', err);

				this.attemptReconnect();

				return;
			}

			this.status = 'connected';
			this.emit('connected');
		});
/*
		this.pool.acquire()
			.then(conn => {
				this.status = 'connected';
				this.emit('connected');
			})
			.catch((e) => {

				this.status = 'disconnected';

				console.log('Failed to connect to database');
				console.log(e);

				this.emit('error', e);

				this.attemptReconnect();
		});
*/
	}

	disconnect() {
		this.status = 'disconnected';
		clearTimeout(this.timer);
		this.pool.close();
		/*
		this.pool.drain().then(() => {
		  this.pool.clear();
		})
		*/;
	}
};
