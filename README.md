# atomic-informix

Informix Database Module for Brobridge Atomic (Compatible with Node-RED).

## Overview

`@brobridge/atomic-informix` is an Informix database module designed specifically for Atomic, fully compatible with the Node-RED development environment. It provides main nodes:

- **Informix Connection**: Connection configuration and pool manager  
- **Informix Execute**: Query execution with streaming support  
- **Flow Control**: Control flow node for streaming data (requires `@brobridge/atomic-flowcontrol`)

## Installation

```sh
npm install @brobridge/atomic-informix
```

For flow control functionality, also install:
```sh
npm install @brobridge/atomic-flowcontrol
```

## Features

- Efficient connection management with IBM DB2 driver
- Static or dynamic SQL execution via `msg.query`
- Delivery options:
  - `direct`: returns all results at once
  - `streaming`: sends rows in batches using Informix queryStream API
- SQL Playground UI to test queries interactively
- Supports `continue` and `break` controls for streaming sessions (with Flow Control node)
- Memory-efficient streaming that doesn't load entire result sets into memory

## Nodes

### Informix Connection

Manages database configuration and connection settings.

- Required fields: `server`, `port`, `database`, `username`, `password`
- Secure connection management with connection pooling

### Informix Execute

Executes SQL queries with flexible query sources and delivery modes.

- **Query Source**:
  - `auto`: Uses embedded SQL command
  - `dynamic`: Uses `msg.query` as input
- **Delivery Mode**:
  - `direct`: Entire result set is returned
  - `streaming`: Sends rows in batches with session control using `conn.queryStream()`
- **Output**:
  - Output to `msg.payload` or custom property
- SQL Playground for testing queries interactively in the editor

### Flow Control

Controls flow when using `streaming` mode in Informix Execute node.

- `continue`: Resume the session
- `break`: Cancel the session
- Supports targeting specific Execute nodes

**Note**: Flow Control functionality requires the `@brobridge/atomic-flowcontrol` package.

## Streaming Mode

The streaming mode uses Informix's native `queryStream()` API to efficiently process large datasets:

```javascript
const stream = conn.queryStream(sql, parameters);
stream.on('data', (row) => {
    // Process row by row without loading entire result set
});
```

This approach:
- Prevents memory overflow with large datasets
- Provides real-time data processing
- Allows flow control to pause/resume streams
- Maintains safe connection handling

## Example Flow: Streaming Data Processing

The streaming mode allows you to process large datasets in batches:

1. Configure Informix Execute node with `streaming` delivery method
2. Set appropriate batch size (Max Records)
3. Use Flow Control node to manage stream processing
4. Implement your data processing logic between batches

## Variable Substitution

SQL queries support variable substitution using template literals:

```sql
SELECT * FROM users WHERE id = ${msg.payload.userId}
```

## Flow Control Usage

When using streaming mode:

1. Set Informix Execute node to "Streaming" delivery method
2. Connect your processing logic after the Informix Execute node
3. Add a Flow Control node to continue or break the stream
4. Configure the Flow Control node to target your Informix Execute node

Example message structure for streaming:
```javascript
{
  payload: {
    results: [...],      // Batch of rows
    rowsAffected: 100,   // Number of rows in this batch
    complete: false      // false for batches, true for final batch
  }
}
```

## Dependencies

- Node.js >= 18
- Node-RED >= 2.0.0
- IBM DB2 Driver (ibm_db)
- @brobridge/atomic-sdk for flow control functionality

## License

Licensed under the Apache License

## Authors

Copyright(c) 2023 Fred Chien <<fred@brobridge.com>>
