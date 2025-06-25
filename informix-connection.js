
module.exports = function (RED) {

	function InformixConnectionNode(n) {
		RED.nodes.createNode(this, n)
		
		let node = this;

		const events = require('events');

		this.instance = new events.EventEmitter();
		this.client = null;
		this.dependencies = 0;
		this.status = 'disconnected';

		// Options
		this.connConfig = {
			server: n.server,
			port: Number(n.port),
			domain: n.domain,
			database: n.database,
			protocol: n.protocol || 'tcpip',
			/*
			connectionTimeout: Number(n.connectionTimeout) || 15000,
			requestTimeout: Number(n.requestTimeout) || 15000,
			*/
			connectionRetryInterval: Number(n.connectionRetryInterval) || 3000,
			// Locale settings
			client_locale: n.client_locale || 'en_us.utf8',
			db_locale: n.db_locale || 'en_us.utf8',
			// Authentication settings
			authentication: n.authentication || 'server',
			auth: {
				type: n.authType || 'default',
				username: this.credentials.username || 'sa',
				password: this.credentials.password || ''
			},
		};

		this.poolConfig = {
/*
			min: Number(n.poolMin) || 1,
			max: Number(n.poolMax) || 10,
			idleTimeoutMillis: Number(n.poolIdleTimeoutMillis) || 30000,
*/
		};

		// Create original client
		let Client = require('./client');

		this.client = new Client(null, {
			connection: this.connConfig,
			pool: this.poolConfig
		});

		// Setup events
		this.client.on('disconnect', () => {
			this.status = 'disconnected';
			node.log('Disconnected from server: ' + node.connConfig.server + ':' + node.connConfig.port);
		});

		this.client.on('reconnect', () => {
			this.status = 'reconnecting';
			node.log('Reconnecting to server: ' + node.connConfig.server + ':' + node.connConfig.port);
		});

		this.client.on('connected', (err) => {
			if (err) {
				node.log('Failed to connect to Informix server: ' + err)
				this.status = 'disconnected';
				return
			}

			node.log('Connected to Informix server: ' + node.connConfig.server + ':' + node.connConfig.port);
			this.status = 'connected';
		});

		this.client.on('error', (err) => {
			node.error(err)
		});

		node.log('Connecting to Informix server: ' + node.connConfig.server + ':' + node.connConfig.port);
		this.client.connect();

		this.getConnection = function() {
			return node.client.getConnection();
		};

		node.on('close', function() {
			node.client.disconnect();
		})
	}

	RED.nodes.registerType('Informix Connection', InformixConnectionNode, {
		credentials: {
            username: {
				type: 'text'
			},
            password: {
				type: 'password'
			}
		}
	})
}
