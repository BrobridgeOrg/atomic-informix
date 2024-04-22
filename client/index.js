const events = require('events');
const util = require('util');
const ibmdb = require('ibm_db');

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
		this.isClosed = false;

		this.pool = new ibmdb.Pool();
		this.pool.setMaxPoolSize(this.opts.maxPoolSize);
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

	async getAvailableConnection() {

    for (let i = 0; i <= this.opts.maxPoolSize; i++) {

      let conn = await this.pool.open(this.getConnectionConfigs());

      // not used in 60 seconds
      if (conn.usedAt > 0 && conn.usedAt + 1000 * 60 < Date.now()) {
        try {

          // Testing connection
          await conn.query('SELECT 1 FROM (SELECT 1 AS dual FROM systables WHERE (tabid = 1)) AS dual');

        } catch (e) {
          // Connection is dead so open next one
          continue;
        }
      }

      conn.usedAt = Date.now();

      return conn;
    }
  }

	getConnection() {
    return this.getAvailableConnection();
	}

	attemptReconnect() {

		clearTimeout(this.timer);

		if (this.isClosed)
			return;

		// Reconnecting
		this.timer = setTimeout(() => {

			if (this.isClosed)
				return;

			this.emit('reconnect')
			this.connect();
		}, this.opts.connectionRetryInterval);
	}

	connect() {

		this.isClosed = false;

		console.log('connecing', this.getConnectionConfigs());

		this.pool.open(this.getConnectionConfigs(), (err, db) => {

			if (this.isClosed)
				return;

			if (err) {
				this.status = 'disconnected';

				console.log('Failed to connect to database');
				console.log(err);

				this.emit('error', err);

				this.attemptReconnect();

				return;
			}

			if (this.status !== 'connected') {
				this.status = 'connected';
				this.emit('connected');
			}
		});
	}

	disconnect() {
		this.isClosed = true;
		this.status = 'disconnected';
		clearTimeout(this.timer);
		this.pool.close();
	}
};
