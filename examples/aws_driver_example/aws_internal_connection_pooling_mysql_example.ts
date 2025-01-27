/*
  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 
  Licensed under the Apache License, Version 2.0 (the "License").
  You may not use this file except in compliance with the License.
  You may obtain a copy of the License at
 
  http://www.apache.org/licenses/LICENSE-2.0
 
  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

import { AwsMySQLClient } from "../../mysql/lib";
import { FailoverFailedError, FailoverSuccessError, TransactionResolutionUnknownError } from "../../common/lib/utils/errors";
import { InternalPoolMapping } from "../../common/lib/utils/internal_pool_mapping";
import { HostInfo } from "../../common/lib/host_info";
import { WrapperProperties } from "../../common/lib/wrapper_property";
import { InternalPooledConnectionProvider } from "../../common/lib/internal_pooled_connection_provider";
import { ConnectionProviderManager } from "../../common/lib/connection_provider_manager";
import { AwsPoolConfig } from "../../common/lib/aws_pool_config";
import { PluginManager } from "../../common/lib";

const mysqlHost = "db-identifier.XYZ.us-east-2.rds.amazonaws.com";
const username = "john_smith";
const password = "employees";
const database = "database";
const port = 3306;

/**
 * Optional method: only use if configured to use internal connection pools.
 * The configuration in these methods are only examples - you can configure as you need in your own code.
 */
const myKeyFunc: InternalPoolMapping = {
  getPoolKey: (hostInfo: HostInfo, props: Map<string, any>) => {
    const user = props.get(WrapperProperties.USER.name);
    return hostInfo.url + user + "/" + props.get("dbUser");
  }
};

/**
 * Configure read-write splitting to use internal connection pools (the pool config and mapping
 * parameters are optional, see UsingTheReadWriteSplittingPlugin.md for more info).
 */
const poolConfig = new AwsPoolConfig({ maxConnections: 10, maxIdleConnections: 10, idleTimeoutMillis: 10000 });
const provider = new InternalPooledConnectionProvider(poolConfig, myKeyFunc);

const client = new AwsMySQLClient({
  // Configure connection parameters. Enable readWriteSplitting, failover, and efm plugins.
  host: mysqlHost,
  port: port,
  user: username,
  password: password,
  database: database,
  plugins: "readWriteSplitting,failover,efm",

  // Optional: PoolKey property value and connection provider used in internal connection pools.
  connectionProvider: provider,
  dbUser: "john_smith"
});

// Setup Step: Open connection and create tables - uncomment this section to create table and test values.
/* try {
  await client.connect();
  await setInitialSessionSettings(client);
  await queryWithFailoverHandling(client, "CREATE TABLE bank_test (id int primary key, name varchar(40), account_balance int)");
  await queryWithFailoverHandling(
    client,
    "INSERT INTO bank_test VALUES (0, 'Jane Doe', 200), (1, 'John Smith', 200), (2, 'Sally Smith', 200), (3, 'Joe Smith', 200)"
  );
} catch (error: any) {
  // Additional error handling can be added here. See transaction step for an example.
  throw error;
} */

// Transaction Step: Open connection and perform transaction.
try {
  await client.connect();
  await setInitialSessionSettings(client);

  // Example query
  const result = await queryWithFailoverHandling(client, "UPDATE bank_test SET account_balance=account_balance - 100 WHERE name='Jane Doe'");
  console.log(result);

  // Internally switch to a reader connection.
  await client.setReadOnly(true);

  for (let i = 0; i < 4; i++) {
    await queryWithFailoverHandling(client, "SELECT * FROM bank_test WHERE id = " + i);
  }
} catch (error) {
  if (error instanceof FailoverFailedError) {
    // User application should open a new connection, check the results of the failed transaction and re-run it if
    // needed. See:
    // https://github.com/aws/aws-advanced-nodejs-wrapper/blob/main/docs/using-the-nodejs-wrapper/using-plugins/UsingTheFailoverPlugin.md#failoverfailederror
    throw error;
  } else if (error instanceof TransactionResolutionUnknownError) {
    // User application should check the status of the failed transaction and restart it if needed. See:
    // https://github.com/aws/aws-advanced-nodejs-wrapper/blob/main/docs/using-the-nodejs-wrapper/using-plugins/UsingTheFailoverPlugin.md#transactionresolutionunknownerror
    throw error;
  } else {
    // Unexpected error unrelated to failover. This should be handled by the user application.
    throw error;
  }
} finally {
  await client.end();

  // Clean up resources used by the plugins.
  await PluginManager.releaseResources();

  // If configured to use internal connection pools, close them here.
  await provider.releaseResources();
}

async function setInitialSessionSettings(client: AwsMySQLClient) {
  // User can edit settings.
  await client.query({ sql: "SET time_zone = 'UTC'" });
}

async function queryWithFailoverHandling(client: AwsMySQLClient, query: string) {
  try {
    const result = await client.query({ sql: query });
    return result;
  } catch (error) {
    if (error instanceof FailoverFailedError) {
      // Connection failed, and Node.js wrapper failed to reconnect to a new instance.
      throw error;
    } else if (error instanceof FailoverSuccessError) {
      // Query execution failed and Node.js wrapper successfully failed over to a new elected writer instance.
      // Reconfigure the connection
      await setInitialSessionSettings(client);
      // Re-run query
      return await client.query({ sql: query });
    } else if (error instanceof TransactionResolutionUnknownError) {
      // Transaction resolution unknown. Please re-configure session state if required and try
      // restarting transaction.
      throw error;
    }
  }
}
