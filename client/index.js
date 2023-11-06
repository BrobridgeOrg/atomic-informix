const events = require('events');
const util = require('util');
const ibmdb = require('ibm_db');
const genericPool = require("generic-pool");

module.exports = class Client extends events.EventEmitter {

	constructor(conn = null, opts = {}) {
		super();

		this.opts = Object.assign({
			server: '0.0.0.0',
			port: 9088,
			database: '',
			maxPoolSize: 10,
			minPoolSize: 1,
			connectionRetryInterval: 3000,
		}, opts.connection, {
			auth: Object.assign({
				type: 'default',
				username: '',
				password: '',
			}, opts.connection.auth || {})
		});

		this.status = 'disconnected';
		this.timer = null;
		this.pool = genericPool.createPool(this.prepareFactory(), {
			min: this.opts.minPoolSize,
			max: this.opts.maxPoolSize,
		});
	}

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

	getPool() {
		return {
			request: () => {
				return this.pool.acquire();
			}
		};
	}

	releasePool(conn) {
		this.pool.release(conn);
	}

	createClient() {
		console.log('createClient', this.getConnectionConfigs());
		return ibmdb.open(this.getConnectionConfigs());
	}

	connect() {
		console.log('connect');
		this.pool.acquire()
			.then(conn => {
		console.log('connected');
				this.conn = conn;
				this.emit('connected');
			})
			.catch((e) => {

				console.log(e);

				this.conn = null;
				this.emit('error', e);

				// Reconnecting
				this.timer = setTimeout(() => {

					this.emit('reconnect')
					this.connect();
				}, this.opts.connectionRetryInterval);
			});
	}

	disconnect() {
		clearTimeout(this.timer);
		this.pool.drain().then(() => {
		  this.pool.clear();
		});
	}
};
