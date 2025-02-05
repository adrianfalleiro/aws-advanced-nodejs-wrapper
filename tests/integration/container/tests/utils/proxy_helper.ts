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

import { TestEnvironment } from "./test_environment";
import { ProxyInfo } from "./proxy_info";
import { Bandwidth, ICreateToxicBody } from "toxiproxy-node-client";
import { DatabaseEngine } from "./database_engine";
import { logger } from "../../../../../common/logutils";

export class ProxyHelper {
  static async disableAllConnectivity(engine: DatabaseEngine) {
    const env = await TestEnvironment.getCurrent();
    for (let i = 0; i < env.proxyInfos.length; i++) {
      await ProxyHelper.disableProxyConnectivity(env.proxyInfos[i]);
    }
  }

  static async enableAllConnectivity() {
    const env = await TestEnvironment.getCurrent();
    env.proxyInfos.forEach((p) => ProxyHelper.enableProxyConnectivity(p));
  }

  static async disableConnectivity(engine: DatabaseEngine, instanceName: string) {
    const env = await TestEnvironment.getCurrent();
    logger.debug("disabling connectivity to: " + instanceName);
    await ProxyHelper.disableProxyConnectivity(env.getProxyInfo(instanceName));
  }

  static async enableConnectivity(instanceName: string) {
    const env = await TestEnvironment.getCurrent();
    await ProxyHelper.enableProxyConnectivity(env.getProxyInfo(instanceName));
  }

  private static async disableProxyConnectivity(proxyInfo: ProxyInfo) {
    const proxy = proxyInfo.proxy;

    if (proxy !== undefined) {
      await proxy.addToxic(<ICreateToxicBody<Bandwidth>>{
        attributes: <Bandwidth>{ rate: 0 },
        type: "bandwidth",
        name: "DOWN-STREAM",
        stream: "downstream",
        toxicity: 1
      });

      await proxy.addToxic(<ICreateToxicBody<Bandwidth>>{
        attributes: <Bandwidth>{ rate: 0 },
        type: "bandwidth",
        name: "UP-STREAM",
        stream: "upstream",
        toxicity: 1
      });
    }
  }

  private static async enableProxyConnectivity(proxyInfo: ProxyInfo) {
    const proxy = proxyInfo.proxy;

    if (proxy !== undefined) {
      try {
        const upstreamToxic = await proxy.getToxic("UP-STREAM");
        await upstreamToxic.remove();
        const downstreamToxic = await proxy.getToxic("DOWN-STREAM");
        await downstreamToxic.remove();
      } catch (e) {
        // Ignore
      }
    }
  }
}
